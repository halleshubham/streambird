import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import { StudioSessionsService } from './studio-sessions.service';

interface SocketState {
  sessionId: string;
  participantId: string;
  role: 'host' | 'guest';
}

/**
 * Pure signaling relay — SDP offers/answers and ICE candidates pass
 * through here as opaque JSON, but no media ever touches this server.
 * That's deliberate: it's what keeps the client-side-compositing default
 * near-zero marginal server cost (see the implementation plan's cost
 * model). This is a direct host<->guest mesh for the MVP, not a real SFU
 * — fine up to a handful of guests, and swappable later without touching
 * the compositor or this relay's message shape.
 */
@WebSocketGateway({ namespace: '/studio', cors: { origin: '*' } })
export class StudioSignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(StudioSignalingGateway.name);
  private readonly socketState = new Map<string, SocketState>();

  // Typed as Namespace, not the root Server -- NestJS's IoAdapter binds a
  // namespaced gateway's server to server.of(namespace), so this really is
  // a Namespace instance at runtime. Namespace.sockets is already the flat
  // Map<string, Socket>; Server.sockets is a Namespace (the default '/'
  // one) with its own nested .sockets Map, which is a different shape --
  // typing this as Server let a call site silently target the wrong,
  // always-undefined property (see handleSignal below).
  @WebSocketServer()
  server!: Namespace;

  constructor(private readonly studioSessionsService: StudioSessionsService) {}

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

    client.emit('joined', { sessionId, participantId: participant.id, role: 'host' });
  }

  private async handleGuestConnection(client: Socket) {
    const { token, displayName } = client.handshake.auth as {
      token?: string;
      displayName?: string;
    };
    if (!token) {
      throw new Error('guest connections require an invite token');
    }

    const participant = await this.studioSessionsService.consumeInviteAndJoin(
      token,
      displayName || 'Guest',
    );

    const sessionId = participant.studioSessionId;
    this.socketState.set(client.id, { sessionId, participantId: participant.id, role: 'guest' });
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

  async handleDisconnect(client: Socket) {
    const state = this.socketState.get(client.id);
    if (!state) return;
    this.socketState.delete(client.id);

    await this.studioSessionsService.recordParticipantLeft(state.participantId);
    client.to(this.roomName(state.sessionId)).emit('peer-left', {
      socketId: client.id,
      participantId: state.participantId,
    });
  }

  /**
   * Generic SDP/ICE relay. Payload carries the target socket id directly
   * (learned from a 'peer-joined' event) — this server never inspects or
   * modifies the SDP/candidate, it only checks sender and target are in
   * the same session room before forwarding.
   */
  @SubscribeMessage('signal')
  handleSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { to: string; type: 'offer' | 'answer' | 'ice-candidate'; payload: unknown },
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

  private roomName(sessionId: string): string {
    return `session:${sessionId}`;
  }
}
