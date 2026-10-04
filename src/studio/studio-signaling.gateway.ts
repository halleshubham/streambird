import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import { StudioSessionsService } from './studio-sessions.service';
import { StreamsService } from '../streams/streams.service';
import { GlitchRecoveryService } from '../streams/glitch-recovery.service';
import { StreamStatus } from '../common/enums/stream-status.enum';
import { AccountsService } from '../accounts/accounts.service';

interface SocketState {
  sessionId: string;
  participantId: string;
  role: 'host' | 'guest';
  displayName?: string;
}

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
export class StudioSignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(StudioSignalingGateway.name);
  private readonly socketState = new Map<string, SocketState>();
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
  ) {}

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
      } else {
        throw new Error("query param 'role' must be 'host' or 'guest'");
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
}
