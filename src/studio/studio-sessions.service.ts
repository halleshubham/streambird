import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { StudioSession } from './entities/studio-session.entity';
import { StudioGuestInvite } from './entities/studio-guest-invite.entity';
import { StudioParticipant, ParticipantRole } from './entities/studio-participant.entity';
import { StudioHostToken } from './entities/studio-host-token.entity';
import { CreateInviteDto } from './dto/create-invite.dto';
import { LiveStream } from '../streams/entities/live-stream.entity';

const DEFAULT_INVITE_TTL_MINUTES = 60;
const HOST_TOKEN_TTL_HOURS = 6;

@Injectable()
export class StudioSessionsService {
  constructor(
    @InjectRepository(StudioSession)
    private readonly sessions: Repository<StudioSession>,
    @InjectRepository(StudioGuestInvite)
    private readonly invites: Repository<StudioGuestInvite>,
    @InjectRepository(StudioParticipant)
    private readonly participants: Repository<StudioParticipant>,
    @InjectRepository(StudioHostToken)
    private readonly hostTokens: Repository<StudioHostToken>,
    private readonly config: ConfigService,
  ) {}

  async createForStream(liveStream: LiveStream): Promise<StudioSession> {
    const session = this.sessions.create({
      liveStreamId: liveStream.id,
      layoutConfig: { layout: 'grid', overlays: [] },
    });
    return this.sessions.save(session);
  }

  async findByLiveStreamId(liveStreamId: string): Promise<StudioSession | null> {
    return this.sessions.findOne({ where: { liveStreamId } });
  }

  /** Account-scoped: verifies the session's LiveStream belongs to this account. */
  async findByIdOrThrow(sessionId: string, accountId: string): Promise<StudioSession> {
    const session = await this.sessions.findOne({
      where: { id: sessionId },
      relations: ['liveStream'],
    });
    if (!session || session.liveStream.accountId !== accountId) {
      throw new NotFoundException(`StudioSession ${sessionId} not found`);
    }
    return session;
  }

  async createInvite(
    sessionId: string,
    accountId: string,
    dto: CreateInviteDto,
  ): Promise<{ token: string; joinUrl: string; expiresAt: Date }> {
    const session = await this.findByIdOrThrow(sessionId, accountId);

    const token = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(
      Date.now() + (dto.expiresInMinutes ?? DEFAULT_INVITE_TTL_MINUTES) * 60_000,
    );

    const invite = this.invites.create({
      studioSessionId: session.id,
      token,
      label: dto.label ?? null,
      expiresAt,
    });
    await this.invites.save(invite);

    const baseUrl = this.config.get<string>('publicBaseUrl');
    const joinUrl = `${baseUrl}/studio/guest.html?token=${token}`;

    return { token, joinUrl, expiresAt };
  }

  async revokeInvite(sessionId: string, inviteId: string, accountId: string): Promise<void> {
    await this.findByIdOrThrow(sessionId, accountId); // ownership check
    const result = await this.invites.update(
      { id: inviteId, studioSessionId: sessionId },
      { revokedAt: new Date() },
    );
    if (result.affected === 0) {
      throw new NotFoundException(`Invite ${inviteId} not found on session ${sessionId}`);
    }
  }

  async listParticipants(sessionId: string, accountId: string): Promise<StudioParticipant[]> {
    await this.findByIdOrThrow(sessionId, accountId);
    return this.participants.find({ where: { studioSessionId: sessionId } });
  }

  async updateLayout(
    sessionId: string,
    accountId: string,
    layoutConfig: Record<string, unknown>,
  ): Promise<StudioSession> {
    const session = await this.findByIdOrThrow(sessionId, accountId);
    session.layoutConfig = layoutConfig;
    return this.sessions.save(session);
  }

  /**
   * Public (no API key) — used by the guest join page and the signaling
   * gateway to validate a token before a guest is let into the room.
   * Does not consume the token; call consumeInviteAndJoin for that.
   */
  async resolveInviteToken(token: string): Promise<StudioGuestInvite> {
    const invite = await this.invites.findOne({ where: { token } });
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }
    if (invite.revokedAt) {
      throw new BadRequestException('This invite has already been used or was revoked');
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This invite has expired');
    }
    return invite;
  }

  /**
   * Single-use: consumes the invite (revokedAt = now) and records the
   * guest as a StudioParticipant. Called only once the guest's WebRTC
   * signaling connection actually opens, not on a simple page-load GET.
   */
  async consumeInviteAndJoin(token: string, displayName: string): Promise<StudioParticipant> {
    const invite = await this.resolveInviteToken(token);

    invite.revokedAt = new Date();
    await this.invites.save(invite);

    const participant = this.participants.create({
      studioSessionId: invite.studioSessionId,
      role: ParticipantRole.GUEST,
      displayName,
      joinedAt: new Date(),
    });
    return this.participants.save(participant);
  }

  async recordParticipantLeft(participantId: string): Promise<void> {
    await this.participants.update({ id: participantId }, { leftAt: new Date() });
  }

  async recordHostJoined(sessionId: string, displayName: string): Promise<StudioParticipant> {
    const participant = this.participants.create({
      studioSessionId: sessionId,
      role: ParticipantRole.HOST,
      displayName,
      joinedAt: new Date(),
    });
    return this.participants.save(participant);
  }

  /**
   * Mints a fresh host token for this session, revoking any prior
   * non-revoked one first — one active host token per session, same as
   * only the latest browser tab should be able to drive a live show.
   * Unlike a guest invite, this token is reusable until expiry/revocation
   * (the host's page may reconnect the socket repeatedly during a show),
   * so it must never be sent anywhere but this authenticated response.
   */
  async mintHostToken(
    sessionId: string,
    accountId: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const session = await this.findByIdOrThrow(sessionId, accountId);

    // Re-stamping an already-revoked row's revokedAt is harmless, so this
    // doesn't need an IS NULL filter to stay correct.
    await this.hostTokens.update({ studioSessionId: session.id }, { revokedAt: new Date() });

    const token = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + HOST_TOKEN_TTL_HOURS * 60 * 60_000);

    const hostToken = this.hostTokens.create({
      studioSessionId: session.id,
      token,
      expiresAt,
    });
    await this.hostTokens.save(hostToken);

    return { token, expiresAt };
  }

  /**
   * Used only by the signaling gateway to authenticate a host socket
   * connection — mirrors resolveInviteToken's checks but, unlike a guest
   * invite, is NOT consumed here: the host may reconnect many times
   * before the token expires or is revoked.
   */
  async resolveHostToken(token: string): Promise<StudioHostToken> {
    const hostToken = await this.hostTokens.findOne({ where: { token } });
    if (!hostToken) {
      throw new NotFoundException('Host token not found');
    }
    if (hostToken.revokedAt) {
      throw new BadRequestException('This host token has been revoked');
    }
    if (hostToken.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This host token has expired');
    }
    return hostToken;
  }

  /** Called from StreamsService.end() so a token can't outlive its stream. */
  async revokeHostTokensForStream(liveStreamId: string): Promise<void> {
    const session = await this.findByLiveStreamId(liveStreamId);
    if (!session) return;
    await this.hostTokens.update({ studioSessionId: session.id }, { revokedAt: new Date() });
  }
}
