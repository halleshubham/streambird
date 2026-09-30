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
import { Server, Socket } from 'socket.io';
import { StudioSessionsService } from './studio-sessions.service';
import { AccountsService } from '../accounts/accounts.service';

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

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly studioSessionsService: StudioSessionsService,
    private readonly accountsService: AccountsService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      // Credentials (apiKey, invite token) travel in the socket.io `auth`
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
    const { sessionId, apiKey, displayName } = client.handshake.auth as {
      sessionId?: string;
      apiKey?: string;
      displayName?: string;
    };
    if (!sessionId || !apiKey) {
      throw new Error('host connections require sessionId and apiKey');
    }

    const account = await this.accountsService.findByApiKey(apiKey);
    if (!account) throw new Error('invalid apiKey');

    // Throws if the session doesn't exist or isn't owned by this account.
    await this.studioSessionsService.findByIdOrThrow(sessionId, account.id);

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
    const targetSocket = this.server.sockets.sockets.get(body.to);
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
