import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LiveStream } from './entities/live-stream.entity';
import { LiveStreamDestination } from './entities/live-stream-destination.entity';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { StudioGuestInvite } from '../studio/entities/studio-guest-invite.entity';
import { StudioSessionsService } from '../studio/studio-sessions.service';
import { StreamsService } from './streams.service';
import { EMAIL_SERVICE, EmailService } from '../email/email.interface';
import { StreamInviteData, buildInvitationText } from '../email/stream-invite.template';
import { StreamStatus } from '../common/enums/stream-status.enum';
import { DestinationStatus } from '../common/enums/destination-status.enum';
import { Account } from '../accounts/entities/account.entity';
import {
  AddScheduleGuestsDto,
  MAX_GUESTS_PER_STREAM,
  ScheduleStreamDto,
  UpdateScheduleDto,
} from './dto/schedule-stream.dto';

/** A start time must be at least this far ahead -- guards typos like "today 9:00" entered at 9:30. */
const MIN_LEAD_MS = 60_000;
const GENERAL_LINK_LABEL = 'General link';

const PLATFORM_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  twitch: 'Twitch',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
};
const platformLabel = (platform: string) => PLATFORM_LABELS[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1);

export interface ScheduleGuest {
  id: string;
  email: string;
  joinUrl: string;
  emailedAt: Date | null;
}

export interface ScheduleDetail {
  id: string;
  title: string;
  description: string | null;
  visibility: string | null;
  status: StreamStatus;
  scheduledAt: Date;
  timezone: string;
  durationMinutes: number | null;
  guestNotes: string | null;
  studioSessionId: string;
  passwordProtected: boolean;
  destinations: Array<{ id: string; platformConnectionId: string; platform: string; label: string }>;
  guests: ScheduleGuest[];
  /** Shareable link not tied to any email -- what "Copy invitation" includes. */
  generalJoinUrl: string | null;
  /** Plaintext invitation, generated from the same template as the email. */
  invitationText: string;
  /** Present on responses that sent email: which addresses failed. */
  emailFailures?: string[];
}

/**
 * Scheduling a stream ahead of time, and inviting guests to it by email.
 *
 * A scheduled stream is a LiveStream row (status SCHEDULED, isScheduledEvent)
 * plus its destinations as PENDING placeholders, a studio session, and one
 * invite per address (plus a general shareable link). Nothing is created on
 * any platform, and nothing is billed, until StreamsService.start().
 */
@Injectable()
export class StreamSchedulingService {
  private readonly logger = new Logger(StreamSchedulingService.name);

  constructor(
    @InjectRepository(LiveStream) private readonly liveStreams: Repository<LiveStream>,
    @InjectRepository(LiveStreamDestination) private readonly destinations: Repository<LiveStreamDestination>,
    @InjectRepository(PlatformConnection) private readonly platformConnections: Repository<PlatformConnection>,
    private readonly studioSessions: StudioSessionsService,
    private readonly streamsService: StreamsService,
    @Inject(EMAIL_SERVICE) private readonly email: EmailService,
  ) {}

  async schedule(account: Account, dto: ScheduleStreamDto): Promise<ScheduleDetail> {
    const scheduledAt = this.parseFutureDate(dto.scheduledAt);
    this.assertValidTimezone(dto.timezone);
    const connections = await this.loadOwnedConnections(account.id, dto.destinationConnectionIds);

    const stream = await this.liveStreams.save(
      this.liveStreams.create({
        accountId: account.id,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        scheduledAt,
        timezone: dto.timezone,
        expectedDurationMinutes: dto.durationMinutes ?? null,
        guestNotes: dto.guestNotes?.trim() || null,
        visibility: dto.visibility ?? null,
        isScheduledEvent: true,
        status: StreamStatus.SCHEDULED,
      }),
    );

    await this.destinations.save(
      connections.map((c) =>
        this.destinations.create({
          liveStreamId: stream.id,
          platformConnectionId: c.id,
          status: DestinationStatus.PENDING,
        }),
      ),
    );

    const session = await this.studioSessions.createForStream(stream);

    await this.studioSessions.createInvite(session.id, account.id, {
      label: GENERAL_LINK_LABEL,
      password: dto.invitePassword,
    });

    const emails = [...new Set(dto.guestEmails ?? [])];
    const invites: StudioGuestInvite[] = [];
    for (const address of emails) {
      invites.push(await this.studioSessions.createEmailInvite(session.id, account.id, { email: address, password: dto.invitePassword }));
    }

    const failures = await this.sendInvites(account, stream, invites, 'invite', !!dto.invitePassword);
    return this.buildDetail(account, stream.id, failures);
  }

  guestCounts(liveStreamIds: string[]): Promise<Map<string, number>> {
    return this.studioSessions.countGuestsByStream(liveStreamIds);
  }

  async getDetail(account: Account, streamId: string): Promise<ScheduleDetail> {
    return this.buildDetail(account, streamId);
  }

  async update(account: Account, streamId: string, dto: UpdateScheduleDto): Promise<ScheduleDetail> {
    const stream = await this.loadScheduledOrThrow(account.id, streamId);
    const before = { title: stream.title, scheduledAt: stream.scheduledAt?.getTime(), description: stream.description, notes: stream.guestNotes, duration: stream.expectedDurationMinutes };

    if (dto.title !== undefined) stream.title = dto.title.trim();
    if (dto.description !== undefined) stream.description = dto.description.trim() || null;
    if (dto.scheduledAt !== undefined) stream.scheduledAt = this.parseFutureDate(dto.scheduledAt);
    if (dto.timezone !== undefined) {
      this.assertValidTimezone(dto.timezone);
      stream.timezone = dto.timezone;
    }
    if (dto.durationMinutes !== undefined) stream.expectedDurationMinutes = dto.durationMinutes;
    if (dto.guestNotes !== undefined) stream.guestNotes = dto.guestNotes.trim() || null;
    if (dto.visibility !== undefined) stream.visibility = dto.visibility;
    await this.liveStreams.save(stream);

    if (dto.destinationConnectionIds) {
      await this.replaceDestinations(account.id, stream.id, dto.destinationConnectionIds);
    }

    const changed =
      before.title !== stream.title ||
      before.scheduledAt !== stream.scheduledAt?.getTime() ||
      before.description !== stream.description ||
      before.notes !== stream.guestNotes ||
      before.duration !== stream.expectedDurationMinutes;

    let failures: string[] | undefined;
    if (changed && dto.notifyGuests !== false) {
      const session = await this.studioSessions.findByLiveStreamId(stream.id);
      const invites = (await this.studioSessions.listActiveInvites(session!.id, account.id)).filter((i) => i.email);
      failures = await this.sendInvites(account, stream, invites, 'update', invites.some((i) => !!i.passwordHash));
    }
    return this.buildDetail(account, stream.id, failures);
  }

  async addGuests(account: Account, streamId: string, dto: AddScheduleGuestsDto): Promise<ScheduleDetail> {
    const stream = await this.loadScheduledOrThrow(account.id, streamId);
    const session = await this.studioSessions.findByLiveStreamId(stream.id);
    const existing = await this.studioSessions.listActiveInvites(session!.id, account.id);

    const have = new Set(existing.map((i) => i.email).filter(Boolean));
    const fresh = [...new Set(dto.emails)].filter((e) => !have.has(e));
    if (existing.filter((i) => i.email).length + fresh.length > MAX_GUESTS_PER_STREAM) {
      throw new BadRequestException(`A stream can have at most ${MAX_GUESTS_PER_STREAM} invited guests.`);
    }

    // New guests inherit the stream's password (all links share one).
    const protectedByPassword = existing.some((i) => !!i.passwordHash);
    const passwordHash = existing.find((i) => i.passwordHash)?.passwordHash ?? null;

    const invites: StudioGuestInvite[] = [];
    for (const address of fresh) {
      invites.push(await this.studioSessions.createEmailInvite(session!.id, account.id, { email: address, passwordHash }));
    }

    const failures = await this.sendInvites(account, stream, invites, 'invite', protectedByPassword);
    return this.buildDetail(account, stream.id, failures);
  }

  async removeGuest(account: Account, streamId: string, inviteId: string): Promise<ScheduleDetail> {
    const stream = await this.loadScheduledOrThrow(account.id, streamId);
    const session = await this.studioSessions.findByLiveStreamId(stream.id);
    await this.studioSessions.revokeInvite(session!.id, inviteId, account.id);
    return this.buildDetail(account, stream.id);
  }

  async resendInvite(account: Account, streamId: string, inviteId: string): Promise<ScheduleDetail> {
    const stream = await this.loadScheduledOrThrow(account.id, streamId);
    const session = await this.studioSessions.findByLiveStreamId(stream.id);
    const invite = (await this.studioSessions.listActiveInvites(session!.id, account.id)).find(
      (i) => i.id === inviteId && i.email,
    );
    if (!invite) throw new NotFoundException('Guest invite not found');

    const failures = await this.sendInvites(account, stream, [invite], 'invite', !!invite.passwordHash);
    return this.buildDetail(account, stream.id, failures);
  }

  /** Cancels a stream that hasn't started: tells every invited guest, then ends it (which also revokes every link). */
  async cancel(account: Account, streamId: string): Promise<void> {
    const stream = await this.loadScheduledOrThrow(account.id, streamId);
    const session = await this.studioSessions.findByLiveStreamId(stream.id);
    const invites = (await this.studioSessions.listActiveInvites(session!.id, account.id)).filter((i) => i.email);

    await this.sendInvites(account, stream, invites, 'cancelled', invites.some((i) => !!i.passwordHash));

    stream.cancelledAt = new Date();
    await this.liveStreams.save(stream);
    await this.streamsService.end(stream.id, account.id);
  }

  // ---- helpers --------------------------------------------------------

  private parseFutureDate(iso: string): Date {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('scheduledAt is not a valid date');
    if (date.getTime() < Date.now() + MIN_LEAD_MS) {
      throw new BadRequestException('Pick a start time in the future.');
    }
    return date;
  }

  private assertValidTimezone(timezone: string) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      throw new BadRequestException(`"${timezone}" is not a valid IANA timezone`);
    }
  }

  private async loadOwnedConnections(accountId: string, ids: string[]): Promise<PlatformConnection[]> {
    const unique = [...new Set(ids)];
    const connections = await this.platformConnections.find({ where: { id: In(unique), accountId } });
    if (connections.length !== unique.length) {
      throw new UnprocessableEntityException('One or more destinationConnectionIds do not belong to this account');
    }
    return connections;
  }

  private async loadScheduledOrThrow(accountId: string, streamId: string): Promise<LiveStream> {
    const stream = await this.liveStreams.findOne({ where: { id: streamId, accountId } });
    if (!stream || !stream.isScheduledEvent) throw new NotFoundException(`Scheduled stream ${streamId} not found`);
    if (stream.status !== StreamStatus.SCHEDULED) {
      throw new UnprocessableEntityException('This stream has already started or ended and can no longer be changed.');
    }
    return stream;
  }

  private async replaceDestinations(accountId: string, streamId: string, connectionIds: string[]) {
    const connections = await this.loadOwnedConnections(accountId, connectionIds);
    await this.destinations.delete({ liveStreamId: streamId });
    await this.destinations.save(
      connections.map((c) =>
        this.destinations.create({ liveStreamId: streamId, platformConnectionId: c.id, status: DestinationStatus.PENDING }),
      ),
    );
  }

  private async platformNames(streamId: string): Promise<string[]> {
    const rows = await this.destinations.find({ where: { liveStreamId: streamId }, relations: ['platformConnection'] });
    return [...new Set(rows.map((r) => r.platformConnection?.platform).filter((p): p is NonNullable<typeof p> => !!p))].map(platformLabel);
  }

  private inviteData(
    account: Account,
    stream: LiveStream,
    kind: StreamInviteData['kind'],
    joinUrl: string,
    passwordProtected: boolean,
    platforms: string[],
  ): StreamInviteData {
    return {
      kind,
      streamId: stream.id,
      title: stream.title,
      description: stream.description,
      notes: stream.guestNotes,
      startsAt: stream.scheduledAt!,
      timezone: stream.timezone ?? 'UTC',
      durationMinutes: stream.expectedDurationMinutes,
      hostName: account.name,
      joinUrl,
      passwordProtected,
      platforms,
    };
  }

  /** Emails each invite its personal link. A send failure is reported, never thrown -- the invites exist either way. */
  private async sendInvites(
    account: Account,
    stream: LiveStream,
    invites: StudioGuestInvite[],
    kind: StreamInviteData['kind'],
    passwordProtected: boolean,
  ): Promise<string[]> {
    if (invites.length === 0) return [];
    const platforms = await this.platformNames(stream.id);

    const results = await Promise.allSettled(
      invites.map(async (invite) => {
        await this.email.sendStreamInvite(
          invite.email!,
          this.inviteData(account, stream, kind, this.studioSessions.joinUrlFor(invite.token), passwordProtected, platforms),
        );
        if (kind !== 'cancelled') await this.studioSessions.markInviteEmailed(invite.id);
      }),
    );

    const failures: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        failures.push(invites[i].email!);
        this.logger.warn(`Failed to email ${kind} for stream ${stream.id} to ${invites[i].email}: ${(r.reason as Error).message}`);
      }
    });
    return failures;
  }

  private async buildDetail(account: Account, streamId: string, emailFailures?: string[]): Promise<ScheduleDetail> {
    const stream = await this.liveStreams.findOne({ where: { id: streamId, accountId: account.id } });
    if (!stream || !stream.isScheduledEvent) throw new NotFoundException(`Scheduled stream ${streamId} not found`);

    const session = await this.studioSessions.findByLiveStreamId(stream.id);
    if (!session) throw new NotFoundException('Studio session missing for this stream');

    const invites = await this.studioSessions.listActiveInvites(session.id, account.id);
    const general = invites.find((i) => !i.email);
    const guests = invites
      .filter((i) => i.email)
      .map((i) => ({ id: i.id, email: i.email!, joinUrl: this.studioSessions.joinUrlFor(i.token), emailedAt: i.emailedAt }));
    const passwordProtected = invites.some((i) => !!i.passwordHash);

    const destRows = await this.destinations.find({ where: { liveStreamId: stream.id }, relations: ['platformConnection'] });
    const platforms = [...new Set(destRows.map((d) => d.platformConnection?.platform).filter(Boolean) as string[])].map(platformLabel);

    const generalJoinUrl = general ? this.studioSessions.joinUrlFor(general.token) : null;
    return {
      id: stream.id,
      title: stream.title,
      description: stream.description,
      visibility: stream.visibility,
      status: stream.status,
      scheduledAt: stream.scheduledAt!,
      timezone: stream.timezone ?? 'UTC',
      durationMinutes: stream.expectedDurationMinutes,
      guestNotes: stream.guestNotes,
      studioSessionId: session.id,
      passwordProtected,
      destinations: destRows.map((d) => ({
        id: d.id,
        platformConnectionId: d.platformConnectionId,
        platform: d.platformConnection?.platform ?? 'unknown',
        label: d.platformConnection?.label ?? '',
      })),
      guests,
      generalJoinUrl,
      invitationText: buildInvitationText(
        this.inviteData(account, stream, 'invite', generalJoinUrl ?? '(link will appear once created)', passwordProtected, platforms),
      ),
      ...(emailFailures ? { emailFailures } : {}),
    };
  }
}
