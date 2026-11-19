import * as crypto from 'crypto';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Inject, Logger, OnModuleDestroy, OnModuleInit, forwardRef } from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import { StudioSessionsService } from './studio-sessions.service';
import { StreamsService } from '../streams/streams.service';
import { GlitchRecoveryService } from '../streams/glitch-recovery.service';
import { StreamStatus } from '../common/enums/stream-status.enum';
import { AccountsService } from '../accounts/accounts.service';
import { ImpersonationService } from '../impersonation/impersonation.service';
import { SupportControlService } from './support/support-control.service';
import { PhoneRemoteService } from './support/phone-remote.service';
import { toPhoneCommand } from './support/phone-mapping';
import type { SanitizedSupportState } from './support/support-state';
import { sanitizeSupportState } from './support/support-state';
import {
  SUPPORT_ACK_TIMEOUT_MS,
  SUPPORT_RATE_LIMIT,
  SUPPORT_STATE_MAX_BYTES,
  SUPPORT_MAX_SOCKETS_PER_SESSION,
  SUPPORT_STATE_MIN_INTERVAL_MS,
  SlidingWindowLimiter,
  parseSupportCommand,
  summarizeCommand,
  type SupportCommand,
} from './support/support-command';

interface SocketState {
  sessionId: string;
  participantId: string;
  role: 'host' | 'guest';
  displayName?: string;
}

/**
 * A superadmin support session attached to a LIVE stream (act mode only). Deliberately NOT in `socketState`: it is not a
 * participant, never joins the participants room (`session:<id>`), so it gets no peer-joined / signal / media traffic
 * and no guest ever sees it. It only sends whitelisted commands (relayed to the host) and receives the host's state.
 */
interface SupportSocketState {
  studioSessionId: string;
  streamId: string;
  accountId: string;
  impersonationSessionId: string;
  adminUserId: string;
  endReason?: string;
}

interface PendingSupportCommand {
  supportSocketId: string;
  studioSessionId: string;
  hostSocketIds: Set<string>;
  commandId: string;
  /** Relayed to the Android app's long poll instead of a host socket. */
  phone?: boolean;
  /** The id the PHONE knows this command by: generated here, so two support sockets reusing one client id never collide. */
  phoneId?: string;
  type: string;
  summary: string;
  impersonationSessionId: string;
  adminUserId: string;
  accountId: string;
  streamId: string;
  timer: ReturnType<typeof setTimeout>;
}

const SUPPORT_REVALIDATE_MS = 5000;
const SUPPORT_END_LINGER_MS = 100;

// How long to wait after a host's socket disconnects before treating the
// stream as actually over, rather than ending it the instant the socket
// drops. socket.io-client auto-reconnects by default on a brief network
// blip -- without this grace window, that alone would end an otherwise
// healthy live stream. Long enough to cover a real reconnect, short
// enough that a genuinely abandoned stream (closed tab, crash) doesn't
// stay marked LIVE -- and billed as using hours -- for long after.
const HOST_DISCONNECT_GRACE_MS = 60_000;

/**
 * Pure signaling relay — SDP offers/answers and ICE candidates pass
 * through here as opaque JSON, but no media ever touches this server.
 * That's deliberate: it's what keeps the client-side-compositing default
 * near-zero marginal server cost (see the implementation plan's cost
 * model). Role-agnostic by design: `handleSignal` only checks sender and
 * target share a session, so it already supports a full mesh between
 * every participant (host and every guest, directly), not just a
 * host<->guest star — fine up to a handful of guests, and swappable for a
 * real SFU later without touching this relay's message shape.
 */
@WebSocketGateway({ namespace: '/studio', cors: { origin: '*' } })
export class StudioSignalingGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StudioSignalingGateway.name);
  private readonly socketState = new Map<string, SocketState>();
  private readonly supportSockets = new Map<string, SupportSocketState>();
  private readonly pendingSupportCommands = new Map<string, PendingSupportCommand>();
  /** Last state snapshot the host published per studio session (controllable settings only), for a support socket that connects later. */
  private readonly lastSupportState = new Map<string, { rev: number; state: unknown }>();
  /** The server stamps `rev` itself (monotonic per studio session for the process lifetime), so a host reload that restarts ITS counter can never make the control page ignore fresh state. */
  private readonly supportStateRev = new Map<string, number>();
  /** Snapshot coalescing: at most one relay per SUPPORT_STATE_MIN_INTERVAL_MS per session, the latest wins. */
  private readonly supportStateGate = new Map<string, { lastAt: number; timer: ReturnType<typeof setTimeout> | null; latest: unknown; present: () => boolean }>();
  private readonly supportLimiter = new SlidingWindowLimiter(SUPPORT_RATE_LIMIT.limit, SUPPORT_RATE_LIMIT.windowMs);
  private supportTimer: ReturnType<typeof setInterval> | null = null;
  private offSessionEnded: (() => void) | null = null;
  /** Overridable in tests. */
  supportAckTimeoutMs = SUPPORT_ACK_TIMEOUT_MS;
  // Keyed by sessionId, not socket id -- a reconnecting host gets a brand
  // new socket id, so this has to survive that to be cancellable.
  private readonly pendingHostEndTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Typed as Namespace, not the root Server -- NestJS's IoAdapter binds a
  // namespaced gateway's server to server.of(namespace), so this really is
  // a Namespace instance at runtime. Namespace.sockets is already the flat
  // Map<string, Socket>; Server.sockets is a Namespace (the default '/'
  // one) with its own nested .sockets Map, which is a different shape --
  // typing this as Server let a call site silently target the wrong,
  // always-undefined property (see handleSignal below).
  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly studioSessionsService: StudioSessionsService,
    @Inject(forwardRef(() => StreamsService))
    private readonly streamsService: StreamsService,
    @Inject(forwardRef(() => GlitchRecoveryService))
    private readonly glitchRecovery: GlitchRecoveryService,
    private readonly accountsService: AccountsService,
    private readonly impersonation: ImpersonationService,
    private readonly supportControl: SupportControlService,
    private readonly phone: PhoneRemoteService,
  ) {}

  onModuleInit(): void {
    // A support session that ends (Exit, expiry, logout, replaced, customer deleted) cuts its sockets at once; the
    // timer is the backstop (the stream may also have ended meanwhile).
    this.offSessionEnded = this.impersonation.onSessionEnded((id, reason) => this.endSupportSockets(id, reason));
    this.supportTimer = setInterval(() => void this.revalidateSupportSockets().catch((e) => this.logger.warn(`support revalidation failed: ${(e as Error).message}`)), SUPPORT_REVALIDATE_MS);
    this.supportTimer.unref();
    // The Android app's long-poll channel (PhoneRemoteService) feeds the same support-room events as a web host socket.
    this.phone.onHost((e) => {
      const room = this.supportRoom(e.studioSessionId);
      // A connected web host studio always wins: the phone's presence changes nothing the support page shows.
      const webHost = this.hostSocketIds(e.studioSessionId).length > 0;
      if (!e.connected) this.failPendingPhone(e.streamId, 'The phone app is not connected');
      if (webHost) return;
      if (e.connected) {
        this.server?.to(room).emit('support:host', { connected: true, kind: 'phone' });
        const state = this.phone.getState(e.streamId);
        if (state && this.supportCount(e.studioSessionId) > 0) this.queueSupportState(e.studioSessionId, state, () => this.phone.isActive(e.streamId));
      } else {
        this.lastSupportState.delete(e.studioSessionId);
        this.server?.to(room).emit('support:host', { connected: false, kind: 'phone' });
      }
    });
    this.phone.onState((e) => {
      if (this.hostSocketIds(e.studioSessionId).length > 0) return; // web host wins
      if (this.supportCount(e.studioSessionId) > 0) this.queueSupportState(e.studioSessionId, e.state, () => this.phone.isActive(e.streamId));
    });
    this.phone.onAck((e) => {
      for (const [key, p] of this.pendingSupportCommands) {
        if (p.phone && p.streamId === e.streamId && p.phoneId === e.id) {
          this.resolvePending(key, e.ok ? { ok: true, hostReported: true, appliedAt: e.appliedAt } : { ok: false, hostReported: true, error: e.error || 'The phone app could not apply it' });
          return;
        }
      }
    });
  }

  onModuleDestroy(): void {
    this.offSessionEnded?.();
    if (this.supportTimer) clearInterval(this.supportTimer);
    for (const p of this.pendingSupportCommands.values()) clearTimeout(p.timer);
    this.pendingSupportCommands.clear();
    for (const g of this.supportStateGate.values()) if (g.timer) clearTimeout(g.timer);
    this.supportStateGate.clear();
  }

  async handleConnection(client: Socket) {
    try {
      // Credentials (hostToken, invite token) travel in the socket.io `auth`
      // payload, not `query` — query strings are URL-visible and end up
      // in server access logs; `auth` is sent once in the handshake body.
      const { role } = client.handshake.auth as { role?: string };

      if (role === 'host') {
        await this.handleHostConnection(client);
      } else if (role === 'guest') {
        await this.handleGuestConnection(client);
      } else if (role === 'support') {
        await this.handleSupportConnection(client);
      } else {
        throw new Error("query param 'role' must be 'host', 'guest' or 'support'");
      }
    } catch (err) {
      this.logger.warn(`Rejecting socket ${client.id}: ${(err as Error).message}`);
      client.emit('error', { message: (err as Error).message });
      client.disconnect(true);
    }
  }

  private async handleHostConnection(client: Socket) {
    const { sessionId, hostToken, displayName } = client.handshake.auth as {
      sessionId?: string;
      hostToken?: string;
      displayName?: string;
    };
    if (!sessionId || !hostToken) {
      throw new Error('host connections require sessionId and hostToken');
    }

    // Throws if the token is unknown, revoked, or expired. The account's
    // real API key never travels into client-side socket code — minting
    // this token already proved account ownership of the session (see
    // StudioSessionsController.mintHostToken), so we only need to confirm
    // it actually belongs to the session this socket claims to join.
    const tokenRow = await this.studioSessionsService.resolveHostToken(hostToken);
    if (tokenRow.studioSessionId !== sessionId) {
      throw new Error('hostToken does not match sessionId');
    }

    const participant = await this.studioSessionsService.recordHostJoined(
      sessionId,
      displayName || 'Host',
    );

    this.socketState.set(client.id, { sessionId, participantId: participant.id, role: 'host' });
    await client.join(this.roomName(sessionId));

    // The host is back (a fresh connection after a drop, or just the
    // first one) -- cancel any end-the-stream timer still pending from a
    // previous disconnect of this same session.
    const pendingEnd = this.pendingHostEndTimers.get(sessionId);
    if (pendingEnd) {
      clearTimeout(pendingEnd);
      this.pendingHostEndTimers.delete(sessionId);
    }

    client.emit('joined', { sessionId, participantId: participant.id, role: 'host' });
    this.server.to(this.supportRoom(sessionId)).emit('support:host', { connected: true });
    // A support socket is already watching: give it a fresh snapshot from this (new) host connection.
    if (this.supportCount(sessionId) > 0) {
      client.emit('support:watching', { on: true });
      client.emit('support:state-request', {});
    }

    // A host that reloaded (or lost its connection long enough to lose its
    // peer connections) has no memory of the guests already in the room,
    // and guests only announce themselves once, on their own connect.
    // Replay them as ordinary 'peer-joined' events so the host's existing
    // handler re-requests an offer from each -- it skips any guest it
    // still has a healthy connection to, so a mere signaling blip is a no-op.
    for (const [socketId, state] of this.socketState) {
      if (state.sessionId !== sessionId || state.role !== 'guest' || socketId === client.id) continue;
      client.emit('peer-joined', {
        socketId,
        participantId: state.participantId,
        role: 'guest',
        displayName: state.displayName ?? 'Guest',
      });
    }
  }

  private async handleGuestConnection(client: Socket) {
    const { token, displayName, password } = client.handshake.auth as {
      token?: string;
      displayName?: string;
      password?: string;
    };
    if (!token) {
      throw new Error('guest connections require an invite token');
    }

    // Plan guest cap: the number of guests in the studio at once. Checked
    // before the join is recorded so a refused guest leaves no participant row.
    // An unknown/expired token falls through to joinAsGuest's own clear error.
    const invite = await this.studioSessionsService.resolveInviteToken(token);
    await this.assertGuestCapacity(invite.studioSessionId);

    // Throws (caught by handleConnection, which disconnects the socket with
    // a clear error message) if the token is unknown/revoked/expired, or if
    // the invite requires a password and none/the wrong one was supplied.
    // Does NOT revoke the invite -- a guest whose connection drops can
    // reconnect with the same token and displayName.
    const participant = await this.studioSessionsService.joinAsGuest(
      token,
      displayName || 'Guest',
      password,
    );

    const sessionId = participant.studioSessionId;
    this.socketState.set(client.id, {
      sessionId,
      participantId: participant.id,
      role: 'guest',
      displayName: displayName || 'Guest',
    });
    await client.join(this.roomName(sessionId));

    client.emit('joined', { sessionId, participantId: participant.id, role: 'guest' });

    // Let the host (and any other participants) know a new guest is
    // available to negotiate a peer connection with.
    client.to(this.roomName(sessionId)).emit('peer-joined', {
      socketId: client.id,
      participantId: participant.id,
      role: 'guest',
      displayName: displayName || 'Guest',
    });
  }

  /** Throws when the session's account plan caps simultaneous guests and the studio is already full. Fails open if limits can't be read. */
  private async assertGuestCapacity(sessionId: string): Promise<void> {
    let maxGuests: number;
    let planName: string;
    try {
      const session = await this.studioSessionsService.findByIdWithLiveStream(sessionId);
      if (!session) return;
      const limits = await this.accountsService.getLimits(session.liveStream.accountId);
      maxGuests = limits.maxGuests;
      planName = limits.planName;
    } catch (err) {
      this.logger.warn(`Could not read plan limits for session ${sessionId}; allowing guest: ${(err as Error).message}`);
      return;
    }
    let current = 0;
    for (const state of this.socketState.values()) {
      if (state.sessionId === sessionId && state.role === 'guest') current++;
    }
    if (current >= maxGuests) {
      throw new Error(`This studio is full: the host's ${planName} plan allows ${maxGuests} guest${maxGuests === 1 ? '' : 's'} at a time.`);
    }
  }

  async handleDisconnect(client: Socket) {
    const support = this.supportSockets.get(client.id);
    if (support) {
      this.supportSockets.delete(client.id);
      for (const [key, p] of this.pendingSupportCommands) {
        if (p.supportSocketId === client.id) {
          clearTimeout(p.timer);
          if (p.phone && p.phoneId) this.phone.cancel(p.streamId, p.phoneId);
          this.pendingSupportCommands.delete(key);
        }
      }
      await this.impersonation
        .recordStudioControl(
          'impersonated_studio_control',
          support.adminUserId,
          support.accountId,
          { event: 'disconnected', sessionId: support.impersonationSessionId, streamId: support.streamId, reason: support.endReason ?? 'closed' },
          false,
        )
        .catch(() => undefined);
      this.notifyWatching(support.studioSessionId);
      return;
    }
    const state = this.socketState.get(client.id);
    if (!state) return;
    this.socketState.delete(client.id);

    await this.studioSessionsService.recordParticipantLeft(state.participantId);
    client.to(this.roomName(state.sessionId)).emit('peer-left', {
      socketId: client.id,
      participantId: state.participantId,
      role: state.role,
    });

    if (state.role === 'host') {
      this.scheduleStreamEndIfHostGone(state.sessionId);
      if (!this.hostSocketIds(state.sessionId).length) {
        // No host any more: whatever it last reported is stale (the studio may come back reloaded, with other state).
        this.lastSupportState.delete(state.sessionId);
        this.server.to(this.supportRoom(state.sessionId)).emit('support:host', { connected: false });
        this.failPendingForHost(state.sessionId, client.id, 'The host studio disconnected');
      }
    }
  }

  /**
   * Confirmed live: hung LIVE streams in the admin "currently live" count
   * that were actually long over -- the host's browser closed/crashed
   * without ever hitting "End stream", so nothing ever called
   * StreamsService.end() and the row just stayed LIVE forever (never
   * billed its usage hours either, since that's also recorded in end()).
   * A stream that never started publishing has nothing to recover, so once
   * the grace window above elapses with no reconnect, it really is over.
   * (One that has been publishing is handled by GlitchRecoveryService.)
   */
  private scheduleStreamEndIfHostGone(sessionId: string): void {
    const existing = this.pendingHostEndTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pendingHostEndTimers.delete(sessionId);
      void (async () => {
        try {
          const session = await this.studioSessionsService.findByIdWithLiveStream(sessionId);
          if (!session || session.liveStream.status !== StreamStatus.LIVE) return;
          // A stream that has been publishing is owned by GlitchRecoveryService
          // now: it shows a "technical difficulties" slate and gives the host
          // up to 5 minutes to come back before ending it. This timer only
          // still ends streams that never started publishing at all.
          if (this.glitchRecovery.isWatching(session.liveStreamId)) return;
          await this.streamsService.end(session.liveStreamId, session.liveStream.accountId);
          this.logger.log(
            `Auto-ended stream ${session.liveStreamId} -- host disconnected and never reconnected within ${HOST_DISCONNECT_GRACE_MS}ms`,
          );
        } catch (err) {
          this.logger.warn(`Failed to auto-end stream for session ${sessionId}: ${(err as Error).message}`);
        }
      })();
    }, HOST_DISCONNECT_GRACE_MS);

    this.pendingHostEndTimers.set(sessionId, timer);
  }

  /**
   * Generic SDP/ICE relay. Payload carries the target socket id directly
   * (learned from a 'peer-joined' event, or from a 'request-offer' this
   * socket itself sent/received) — this server never inspects or modifies
   * the payload, it only checks sender and target are in the same session
   * room before forwarding.
   */
  @SubscribeMessage('signal')
  handleSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: { to: string; type: 'offer' | 'answer' | 'ice-candidate' | 'request-offer' | 'kicked'; payload: unknown },
  ) {
    const senderState = this.socketState.get(client.id);
    // this.server is the '/studio' Namespace (NestJS's IoAdapter binds a
    // namespaced gateway's server to server.of(namespace)), whose own
    // .sockets is already the flat Map<string, Socket> -- not the extra
    // nesting Server.sockets.sockets has for the *default* namespace. The
    // extra .sockets here was always undefined, so every signal relay
    // (offer/answer/ice-candidate) silently failed to find its target.
    const targetSocket = this.server.sockets.get(body.to);
    if (!senderState || !targetSocket) return;

    const targetState = this.socketState.get(body.to);
    if (!targetState || targetState.sessionId !== senderState.sessionId) {
      this.logger.warn(`Dropped cross-session signal from ${client.id} to ${body.to}`);
      return;
    }

    targetSocket.emit('signal', {
      from: client.id,
      type: body.type,
      payload: body.payload,
    });
  }

  /**
   * Pure diagnostics: this server is a signaling relay only (see the class
   * doc comment) and never otherwise learns whether a P2P connection it
   * helped set up actually ended up carrying media -- WebRTC's ICE/
   * connection state only exists in each browser. The host and each guest
   * now self-report theirs here specifically so a connection that's stuck
   * or failed (the exact signature of a NAT/firewall STUN alone can't
   * traverse -- there's no TURN server configured, see the client-side
   * ICE_SERVERS) actually shows up in production logs after the fact,
   * instead of only ever existing in a browser console nobody was
   * watching live.
   */
  @SubscribeMessage('rtc-state')
  handleRtcState(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { about: string; iceConnectionState: string; connectionState: string },
  ) {
    const state = this.socketState.get(client.id);
    if (!state) return;

    const isTrouble = body.iceConnectionState === 'failed' || body.connectionState === 'failed';
    const message = `[rtc-state] session=${state.sessionId} reporter=${state.role}:${state.participantId} about=${body.about} ice=${body.iceConnectionState} connection=${body.connectionState}`;
    if (isTrouble) {
      this.logger.warn(message);
    } else {
      this.logger.log(message);
    }
  }

  private roomName(sessionId: string): string {
    return `session:${sessionId}`;
  }

  /** The room support sockets live in: separate from the participants room, so they never receive participant / media traffic. */
  private supportRoom(sessionId: string): string {
    return `support:${sessionId}`;
  }

  private hostSocketIds(sessionId: string): string[] {
    const ids: string[] = [];
    for (const [socketId, st] of this.socketState) if (st.sessionId === sessionId && st.role === 'host') ids.push(socketId);
    return ids;
  }

  // ---- Support control (superadmin support session, act mode) ----------------------------------------------

  private async handleSupportConnection(client: Socket) {
    const { sessionId, controlToken } = client.handshake.auth as { sessionId?: string; controlToken?: string };
    if (!sessionId || !controlToken) throw new Error('support connections require sessionId and controlToken');
    const row = this.supportControl.resolve(controlToken);
    if (!row || row.studioSessionId !== sessionId) throw new Error('Invalid or expired control token');
    // On connect AND before every command: the support session must still be active, in ACT mode, the same admin and customer.
    const check = await this.impersonation.checkControlSession(row.impersonationSessionId);
    if (!check.ok) throw new Error('The support session is no longer active');
    if (check.session.adminUserId !== row.adminUserId || check.session.targetAccountId !== row.accountId) throw new Error('The control token does not match the support session');
    if (!(await this.supportControl.isLive(row.studioSessionId, row.accountId))) throw new Error('The stream is not live');
    if (this.supportCount(row.studioSessionId) >= SUPPORT_MAX_SOCKETS_PER_SESSION) throw new Error('Too many control windows are open for this stream');

    // Fail closed: no audit entry, no connection.
    await this.impersonation.recordStudioControl(
      'impersonated_studio_control',
      row.adminUserId,
      row.accountId,
      { event: 'connected', sessionId: row.impersonationSessionId, streamId: row.streamId },
      true,
    );
    // The socket may have dropped during the awaits above: handleDisconnect already ran and would never clean this entry up.
    if (!client.connected) {
      await this.impersonation
        .recordStudioControl('impersonated_studio_control', row.adminUserId, row.accountId, { event: 'disconnected', sessionId: row.impersonationSessionId, streamId: row.streamId, reason: 'dropped_while_connecting' }, false)
        .catch(() => undefined);
      return;
    }
    this.supportSockets.set(client.id, {
      studioSessionId: row.studioSessionId,
      streamId: row.streamId,
      accountId: row.accountId,
      impersonationSessionId: row.impersonationSessionId,
      adminUserId: row.adminUserId,
    });
    await client.join(this.supportRoom(row.studioSessionId));
    const hosts = this.hostSocketIds(row.studioSessionId);
    const phoneHost = hosts.length === 0 && this.phone.isActive(row.streamId);
    client.emit('support:joined', { streamId: row.streamId, hostConnected: hosts.length > 0 || phoneHost, hostKind: phoneHost ? 'phone' : hosts.length > 0 ? 'web' : this.phone.wasPhone(row.streamId) ? 'phone' : null });
    const last = this.lastSupportState.get(row.studioSessionId);
    if (last && (hosts.length || phoneHost)) client.emit('support:state', last);
    else if (phoneHost) {
      const state = this.phone.getState(row.streamId);
      if (state) this.queueSupportState(row.studioSessionId, state, () => this.phone.isActive(row.streamId));
    }
    // Ask the host studio for a fresh snapshot (only the server can emit this; the host ignores anything else).
    for (const id of hosts) {
      this.server.sockets.get(id)?.emit('support:watching', { on: true });
      this.server.sockets.get(id)?.emit('support:state-request', {});
    }
  }

  private supportCount(sessionId: string): number {
    let n = 0;
    for (const st of this.supportSockets.values()) if (st.studioSessionId === sessionId) n++;
    return n;
  }

  /** Tells the host(s) whether any support socket is watching, so the studio publishes snapshots only then. */
  private notifyWatching(sessionId: string): void {
    if (this.supportCount(sessionId) > 0) return; // still watched: nothing changes
    for (const id of this.hostSocketIds(sessionId)) this.server.sockets.get(id)?.emit('support:watching', { on: false });
  }

  /** Cuts every support socket of an ended support session ("support:ended"). */
  private endSupportSockets(impersonationSessionId: string, reason: string): void {
    this.supportControl.revokeForSession(impersonationSessionId);
    this.supportLimiter.forget(impersonationSessionId);
    for (const [socketId, st] of this.supportSockets) {
      if (st.impersonationSessionId === impersonationSessionId) this.endSupportSocket(socketId, reason);
    }
  }

  private endSupportSocket(socketId: string, reason: string): void {
    const st = this.supportSockets.get(socketId);
    const socket = this.server.sockets.get(socketId);
    if (st) st.endReason = reason;
    socket?.emit('support:ended', { reason });
    // A short linger so the ack of the command that found the session over still reaches the client first.
    if (socket) setTimeout(() => socket.disconnect(true), SUPPORT_END_LINGER_MS).unref?.();
  }

  private async revalidateSupportSockets(): Promise<void> {
    for (const [socketId, st] of [...this.supportSockets]) {
      if (!this.server.sockets.get(socketId)) {
        // A ghost entry (the socket is gone): drop it instead of querying the DB for it every 5 s.
        this.supportSockets.delete(socketId);
        this.notifyWatching(st.studioSessionId);
        continue;
      }
      const check = await this.impersonation.checkControlSession(st.impersonationSessionId);
      if (!check.ok) {
        this.endSupportSocket(socketId, check.reason);
      } else if (!(await this.supportControl.isLive(st.studioSessionId, st.accountId))) {
        this.endSupportSocket(socketId, 'stream_ended');
      }
    }
  }

  /**
   * A whitelisted command from a support socket, relayed ONLY to the host socket(s) of that stream. The return value is
   * the socket.io ack: `{ok:true}` = relayed (the host's own result follows as `support:ack`), `{ok:false,error}` = refused.
   * An event with this name from ANY other socket (a guest, the host) is dropped: only the server may relay it.
   */
  @SubscribeMessage('support:command')
  async handleSupportCommand(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<{ ok: boolean; error?: string } | undefined> {
    const st = this.supportSockets.get(client.id);
    if (!st) {
      this.logger.warn(`Dropped support:command from non-support socket ${client.id}`);
      return undefined;
    }
    const refuse = async (error: string, command?: string): Promise<{ ok: false; error: string }> => {
      await this.impersonation
        .recordStudioControl(
          'impersonated_studio_command',
          st.adminUserId,
          st.accountId,
          { phase: 'rejected', sessionId: st.impersonationSessionId, streamId: st.streamId, command: command ?? 'invalid', error: error.slice(0, 100) },
          false,
        )
        .catch(() => undefined);
      return { ok: false, error };
    };

    if (!this.supportLimiter.allow(st.impersonationSessionId, Date.now())) return { ok: false, error: 'Too many commands: slow down' };

    const parsed = parseSupportCommand(body);
    if (!parsed.ok) {
      const type = typeof (body as { type?: unknown })?.type === 'string' ? String((body as { type: string }).type).slice(0, 32) : 'invalid';
      return refuse(parsed.error, type);
    }
    const cmd: SupportCommand = parsed.command;
    if (cmd.type === 'kit.apply') cmd.payload.kitId = String(cmd.payload.kitId).toLowerCase(); // uuids compare lower-case everywhere (check, audit, phone)

    // Re-validated before EVERY command: ended / expired / view mode / customer suspended / stream over -> cut off.
    const check = await this.impersonation.checkControlSession(st.impersonationSessionId);
    if (!check.ok) {
      this.endSupportSocket(client.id, check.reason);
      return { ok: false, error: 'The support session has ended' };
    }
    if (!(await this.supportControl.isLive(st.studioSessionId, st.accountId))) {
      this.endSupportSocket(client.id, 'stream_ended');
      return { ok: false, error: 'The stream is not live' };
    }
    if (cmd.type === 'kit.apply' && !(await this.supportControl.kitBelongsTo(st.accountId, String(cmd.payload.kitId)))) {
      return refuse('Unknown brand kit', cmd.type);
    }
    const hosts = this.hostSocketIds(st.studioSessionId);
    // No web host studio: the host may be the Android app, which receives commands through its long poll.
    const viaPhone = hosts.length === 0 && this.phone.isActive(st.streamId);
    if (!hosts.length && !viaPhone) return refuse(this.phone.wasPhone(st.streamId) ? 'The phone app is not connected' : 'The host studio is not connected', cmd.type);
    const key = `${client.id}:${cmd.id}`;
    if (this.pendingSupportCommands.has(key)) return { ok: false, error: 'Duplicate command id' };

    const summary = summarizeCommand(cmd);
    try {
      // Fail closed: the intent is recorded (strict) before anything reaches the host.
      await this.impersonation.recordStudioControl(
        'impersonated_studio_command',
        st.adminUserId,
        st.accountId,
        { phase: 'intent', sessionId: st.impersonationSessionId, streamId: st.streamId, commandId: cmd.id, command: cmd.type, summary },
        true,
      );
    } catch {
      return { ok: false, error: 'Audit log unavailable; command refused' };
    }

    const phoneId = crypto.randomUUID();
    const timer = setTimeout(() => this.resolvePending(key, { ok: false, error: viaPhone ? 'The phone app did not respond' : 'The host studio did not respond' }), this.supportAckTimeoutMs);
    timer.unref?.();
    this.pendingSupportCommands.set(key, {
      supportSocketId: client.id,
      studioSessionId: st.studioSessionId,
      hostSocketIds: new Set(hosts),
      commandId: cmd.id,
      ...(viaPhone ? { phone: true, phoneId: phoneId } : {}),
      type: cmd.type,
      summary,
      impersonationSessionId: st.impersonationSessionId,
      adminUserId: st.adminUserId,
      accountId: st.accountId,
      streamId: st.streamId,
      timer,
    });
    if (viaPhone) {
      const mapped = toPhoneCommand(cmd, this.phone.getState(st.streamId)?.phoneCaps);
      // Commands the phone cannot do are answered here (saves a round trip); the intent above and the result below are still audited.
      if (!mapped.supported) setTimeout(() => this.resolvePending(key, { ok: false, error: mapped.error }), 0).unref?.();
      else {
        const queued = this.phone.enqueue(st.streamId, { id: phoneId, type: mapped.type, payload: mapped.payload });
        if (!queued.ok) setTimeout(() => this.resolvePending(key, { ok: false, error: queued.error }), 0).unref?.();
      }
      return { ok: true };
    }
    const relayed = { id: cmd.id, type: cmd.type, payload: cmd.payload, at: Date.now(), source: 'support-session' };
    for (const id of hosts) this.server.sockets.get(id)?.emit('support:command', relayed);
    return { ok: true };
  }

  /** The host's result for a relayed command, passed back to the support socket that sent it. Only a host socket of the same session counts. */
  @SubscribeMessage('support:ack')
  handleSupportAck(@ConnectedSocket() client: Socket, @MessageBody() body: { id?: unknown; ok?: unknown; error?: unknown; appliedAt?: unknown }) {
    const st = this.socketState.get(client.id);
    if (!st || st.role !== 'host' || typeof body?.id !== 'string' || typeof body.ok !== 'boolean') return;
    for (const [key, p] of this.pendingSupportCommands) {
      if (p.studioSessionId === st.sessionId && p.commandId === body.id && p.hostSocketIds.has(client.id)) {
        const error = typeof body.error === 'string' ? body.error.slice(0, 200) : undefined;
        this.resolvePending(key, body.ok ? { ok: true, hostReported: true, appliedAt: typeof body.appliedAt === 'number' ? body.appliedAt : Date.now() } : { ok: false, hostReported: true, error: error || 'The host studio could not apply it' });
        return;
      }
    }
  }

  /**
   * The host studio publishes a compact snapshot of the controllable settings. It is untrusted input: rebuilt from a strict
   * shape (malformed = dropped), re-stamped with the server's own monotonic `rev`, coalesced to at most one relay per
   * SUPPORT_STATE_MIN_INTERVAL_MS (the latest wins) and relayed to support sockets only.
   */
  @SubscribeMessage('support:state')
  handleSupportState(@ConnectedSocket() client: Socket, @MessageBody() body: { rev?: unknown; state?: unknown }) {
    const st = this.socketState.get(client.id);
    if (!st || st.role !== 'host' || typeof body?.state !== 'object' || body.state === null) return;
    if (this.supportCount(st.sessionId) === 0) return;
    let size = 0;
    try {
      size = Buffer.byteLength(JSON.stringify(body.state));
    } catch {
      return;
    }
    if (size > SUPPORT_STATE_MAX_BYTES) return;
    const clean = sanitizeSupportState(body.state);
    if (!clean) {
      this.logger.warn(`Dropped a malformed support state snapshot from host ${client.id}`);
      return;
    }
    this.queueSupportState(st.sessionId, clean, () => this.hostSocketIds(st.sessionId).length > 0);
  }

  /** Coalesces a sanitised snapshot (from a web host socket or the phone channel): at most one relay per interval, the latest wins. */
  private queueSupportState(sessionId: string, clean: SanitizedSupportState, present: () => boolean): void {
    const gate = this.supportStateGate.get(sessionId) ?? { lastAt: 0, timer: null, latest: null, present };
    this.supportStateGate.set(sessionId, gate);
    gate.latest = clean;
    gate.present = present;
    const wait = gate.lastAt + SUPPORT_STATE_MIN_INTERVAL_MS - Date.now();
    if (wait <= 0) this.flushSupportState(sessionId);
    else if (!gate.timer) {
      gate.timer = setTimeout(() => this.flushSupportState(sessionId), wait);
      gate.timer.unref?.();
    }
  }

  private flushSupportState(sessionId: string): void {
    const gate = this.supportStateGate.get(sessionId);
    if (!gate || gate.latest === null) return;
    if (gate.timer) clearTimeout(gate.timer);
    gate.timer = null;
    const state = gate.latest;
    gate.latest = null;
    gate.lastAt = Date.now();
    if (!gate.present()) return; // the host left while this waited: it is stale
    const rev = (this.supportStateRev.get(sessionId) ?? 0) + 1;
    this.supportStateRev.set(sessionId, rev);
    const snapshot = { rev, state };
    this.lastSupportState.set(sessionId, snapshot);
    if (this.lastSupportState.size > 500) this.lastSupportState.delete(this.lastSupportState.keys().next().value as string);
    this.server.to(this.supportRoom(sessionId)).emit('support:state', snapshot);
  }

  private resolvePending(key: string, result: { ok: boolean; error?: string; appliedAt?: number; hostReported?: boolean }): void {
    const p = this.pendingSupportCommands.get(key);
    if (!p) return;
    clearTimeout(p.timer);
    this.pendingSupportCommands.delete(key);
    if (p.phone && p.phoneId) this.phone.cancel(p.streamId, p.phoneId); // answered / timed out: the phone must not apply it later
    this.server.sockets.get(p.supportSocketId)?.emit('support:ack', { id: p.commandId, ok: result.ok, ...(result.error ? { error: result.error } : {}), appliedAt: result.appliedAt ?? Date.now() });
    void this.impersonation
      .recordStudioControl(
        'impersonated_studio_command',
        p.adminUserId,
        p.accountId,
        { phase: 'result', sessionId: p.impersonationSessionId, streamId: p.streamId, commandId: p.commandId, command: p.type, summary: p.summary, applied: result.ok, hostReported: result.hostReported === true, ...(result.ok ? {} : { error: String(result.error ?? '').slice(0, 100) }) },
        false,
      )
      .catch(() => undefined);
  }

  private failPendingPhone(streamId: string, error: string): void {
    for (const [key, p] of this.pendingSupportCommands) if (p.phone && p.streamId === streamId) this.resolvePending(key, { ok: false, error });
  }

  private failPendingForHost(sessionId: string, hostSocketId: string, error: string): void {
    for (const [key, p] of this.pendingSupportCommands) {
      if (p.studioSessionId !== sessionId || !p.hostSocketIds.has(hostSocketId)) continue;
      p.hostSocketIds.delete(hostSocketId);
      if (p.hostSocketIds.size === 0) this.resolvePending(key, { ok: false, error });
    }
  }
}
