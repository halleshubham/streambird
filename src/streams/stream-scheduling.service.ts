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
import { BroadcastMeta } from '../providers/stream-provider.interface';
import { StreamThumbnail } from './entities/stream-thumbnail.entity';
import { ThumbnailImage, parseThumbnail } from './thumbnail.util';
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
  /** Whether the platform broadcasts (YouTube, Facebook) are created now rather than at start. */
  precreateOnPlatforms: boolean;
  hasThumbnail: boolean;
  /** Changes whenever the thumbnail is replaced -- for cache-busting the preview. */
  thumbnailUpdatedAt: Date | null;
  destinations: Array<{
    id: string;
    platformConnectionId: string;
    platform: string;
    label: string;
    /** This destination's platform can hold a scheduled broadcast ahead of time. */
    canPrecreate: boolean;
    /** The broadcast already exists on the platform. */
    onPlatform: boolean;
    watchUrl: string | null;
    errorMessage: string | null;
  }>;
  guests: ScheduleGuest[];
  /** Shareable link not tied to any email -- what "Copy invitation" includes. */
  generalJoinUrl: string | null;
  /** Plaintext invitation, generated from the same template as the email. */
  invitationText: string;
  /** Present on responses that sent email: which addresses failed. */
  emailFailures?: string[];
  /** Present on responses that touched the platforms: what couldn't be created/updated/removed there. */
  platformWarnings?: string[];
}

interface DetailExtras {
  emailFailures?: string[];
  platformWarnings?: string[];
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
    @InjectRepository(StreamThumbnail) private readonly thumbnails: Repository<StreamThumbnail>,
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
        precreateOnPlatforms: !!dto.createOnPlatforms,
        status: StreamStatus.SCHEDULED,
      }),
    );

    const rows = await this.destinations.save(
      connections.map((c) =>
        this.destinations.create({
          liveStreamId: stream.id,
          platformConnectionId: c.id,
          status: DestinationStatus.PENDING,
        }),
      ),
    );

    // Done before the invites go out so the emails can carry the watch links.
    let platformWarnings: string[] | undefined;
    if (dto.createOnPlatforms) {
      platformWarnings = await this.precreate(stream, rows, connections);
    }

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
    return this.buildDetail(account, stream.id, { emailFailures: failures, platformWarnings });
  }

  guestCounts(liveStreamIds: string[]): Promise<Map<string, number>> {
    return this.studioSessions.countGuestsByStream(liveStreamIds);
  }

  async getDetail(account: Account, streamId: string): Promise<ScheduleDetail> {
    return this.buildDetail(account, streamId);
  }

  async update(account: Account, streamId: string, dto: UpdateScheduleDto): Promise<ScheduleDetail> {
    const stream = await this.loadScheduledOrThrow(account.id, streamId);
    const before = { title: stream.title, scheduledAt: stream.scheduledAt?.getTime(), description: stream.description, notes: stream.guestNotes, duration: stream.expectedDurationMinutes, visibility: stream.visibility };
    const platformWarnings: string[] = [];

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

    const wasPrecreated = stream.precreateOnPlatforms;
    if (dto.createOnPlatforms !== undefined) stream.precreateOnPlatforms = dto.createOnPlatforms;
    await this.liveStreams.save(stream);

    // Destinations: drop removed ones (and their platform broadcast), add new ones.
    if (dto.destinationConnectionIds) {
      const wanted = await this.loadOwnedConnections(account.id, dto.destinationConnectionIds);
      const wantedIds = new Set(wanted.map((c) => c.id));
      const existing = await this.loadDestinations(stream.id);

      const removed = existing.filter((r) => !wantedIds.has(r.platformConnectionId));
      platformWarnings.push(...(await this.removeFromPlatform(removed)));
      if (removed.length > 0) await this.destinations.delete({ id: In(removed.map((r) => r.id)) as any });

      const have = new Set(existing.map((r) => r.platformConnectionId));
      const added = wanted.filter((c) => !have.has(c.id));
      if (added.length > 0) {
        await this.destinations.save(
          added.map((c) => this.destinations.create({ liveStreamId: stream.id, platformConnectionId: c.id, status: DestinationStatus.PENDING })),
        );
      }
    }

    // Platform broadcasts: create / remove / re-sync to match the (possibly changed) settings.
    const rows = await this.loadDestinations(stream.id);
    // What the platforms show (title, time, description, privacy) vs. what a
    // guest's invitation shows (no privacy setting) -- a visibility-only
    // change re-syncs the platforms but never emails anyone.
    const guestVisibleChanged =
      before.title !== stream.title ||
      before.scheduledAt !== stream.scheduledAt?.getTime() ||
      before.description !== stream.description;
    const detailsChanged = guestVisibleChanged || before.visibility !== stream.visibility;

    if (stream.precreateOnPlatforms) {
      const missing = rows.filter((r) => !r.platformBroadcastId);
      platformWarnings.push(...(await this.precreate(stream, missing)));
      if (detailsChanged) {
        platformWarnings.push(...(await this.syncToPlatform(stream, rows.filter((r) => !!r.platformBroadcastId && !missing.includes(r)))));
      }
    } else if (wasPrecreated) {
      platformWarnings.push(...(await this.removeFromPlatform(rows)));
    }

    const watchLinksChanged = wasPrecreated !== stream.precreateOnPlatforms;
    const changed =
      guestVisibleChanged ||
      watchLinksChanged ||
      before.notes !== stream.guestNotes ||
      before.duration !== stream.expectedDurationMinutes;

    let emailFailures: string[] | undefined;
    if (changed && dto.notifyGuests !== false) {
      const session = await this.studioSessions.findByLiveStreamId(stream.id);
      const invites = (await this.studioSessions.listActiveInvites(session!.id, account.id)).filter((i) => i.email);
      emailFailures = await this.sendInvites(account, stream, invites, 'update', invites.some((i) => !!i.passwordHash));
    }
    return this.buildDetail(account, stream.id, { emailFailures, platformWarnings: platformWarnings.length ? platformWarnings : undefined });
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
    return this.buildDetail(account, stream.id, { emailFailures: failures });
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
    return this.buildDetail(account, stream.id, { emailFailures: failures });
  }

  /** Cancels a stream that hasn't started: tells every invited guest, then ends it (which also revokes every link). */
  async cancel(account: Account, streamId: string): Promise<void> {
    const stream = await this.loadScheduledOrThrow(account.id, streamId);
    const session = await this.studioSessions.findByLiveStreamId(stream.id);
    const invites = (await this.studioSessions.listActiveInvites(session!.id, account.id)).filter((i) => i.email);

    await this.sendInvites(account, stream, invites, 'cancelled', invites.some((i) => !!i.passwordHash));

    // A cancelled stream must not linger as an upcoming broadcast on the platforms.
    await this.removeFromPlatform(await this.loadDestinations(stream.id));

    stream.cancelledAt = new Date();
    await this.liveStreams.save(stream);
    await this.streamsService.end(stream.id, account.id);
  }

  /**
   * Silently discards a scheduled stream that never started -- no emails
   * (unlike cancel(), which tells the guests). Meant for streams whose time
   * has already passed, where a "cancelled" notice would only confuse
   * people. Everything hanging off it (destinations, studio session,
   * invites, host tokens) goes with it via ON DELETE CASCADE; nothing was
   * ever created on a platform or billed for a stream that never started.
   */
  async delete(account: Account, streamId: string): Promise<void> {
    const stream = await this.loadScheduledOrThrow(account.id, streamId);
    await this.removeFromPlatform(await this.loadDestinations(stream.id));
    await this.liveStreams.delete({ id: stream.id, accountId: account.id });
  }

  // ---- thumbnail ------------------------------------------------------

  /**
   * Stores the stream's thumbnail (replacing any previous one) and pushes it
   * to every broadcast that already exists on a platform. A platform
   * refusing it (YouTube: unverified channel; Facebook: not accepted on an
   * existing scheduled live) is a warning -- the image is still saved and
   * is applied to broadcasts created later.
   */
  async setThumbnail(account: Account, streamId: string, file: Buffer | undefined): Promise<ScheduleDetail> {
    const stream = await this.loadScheduledOrThrow(account.id, streamId);
    const image = parseThumbnail(file);
    await this.thumbnails.save(
      this.thumbnails.create({ liveStreamId: stream.id, contentType: image.contentType, data: image.data, width: image.width, height: image.height }),
    );
    const warnings = await this.applyThumbnail(await this.loadDestinations(stream.id), image);
    return this.buildDetail(account, stream.id, { platformWarnings: warnings.length ? warnings : undefined });
  }

  async getThumbnail(account: Account, streamId: string): Promise<{ contentType: string; data: Buffer; updatedAt: Date }> {
    const stream = await this.liveStreams.findOne({ where: { id: streamId, accountId: account.id } });
    if (!stream || !stream.isScheduledEvent) throw new NotFoundException(`Scheduled stream ${streamId} not found`);
    const row = await this.thumbnails.findOne({ where: { liveStreamId: stream.id } });
    if (!row) throw new NotFoundException('This stream has no thumbnail');
    return { contentType: row.contentType, data: row.data, updatedAt: row.updatedAt };
  }

  async removeThumbnail(account: Account, streamId: string): Promise<ScheduleDetail> {
    const stream = await this.loadScheduledOrThrow(account.id, streamId);
    await this.thumbnails.delete({ liveStreamId: stream.id });

    // No platform lets an app clear a thumbnail it set; say so rather than imply it's gone.
    const rows = await this.loadDestinations(stream.id);
    const warnings = rows
      .filter((r) => r.platformBroadcastId && r.platformConnection && this.streamsService.resolveProvider(r.platformConnection).setBroadcastThumbnail)
      .map((r) => `${this.describe(r)}: the image already sent can't be removed through the API -- replace it in the platform's own studio if needed.`);
    return this.buildDetail(account, stream.id, { platformWarnings: warnings.length ? warnings : undefined });
  }

  // ---- helpers --------------------------------------------------------

  private async loadThumbnail(streamId: string): Promise<ThumbnailImage | null> {
    const row = await this.thumbnails.findOne({ where: { liveStreamId: streamId } });
    return row ? { contentType: row.contentType as ThumbnailImage['contentType'], data: row.data, width: row.width, height: row.height } : null;
  }

  /** Sends the image to each destination that has a platform broadcast and can take one; failures come back as warnings. */
  private async applyThumbnail(rows: LiveStreamDestination[], image: ThumbnailImage): Promise<string[]> {
    const warnings: string[] = [];
    await Promise.all(
      rows.map(async (row) => {
        const conn = row.platformConnection;
        if (!conn || !row.platformBroadcastId) return;
        const provider = this.streamsService.resolveProvider(conn);
        if (!provider.setBroadcastThumbnail) return;
        try {
          await provider.setBroadcastThumbnail(conn, row.platformBroadcastId, image);
        } catch (err) {
          warnings.push(`${this.describe(row)}: couldn't set the thumbnail (${(err as Error).message}).`);
        }
      }),
    );
    return warnings;
  }



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

  private async loadDestinations(streamId: string): Promise<LiveStreamDestination[]> {
    return this.destinations.find({ where: { liveStreamId: streamId }, relations: ['platformConnection'] });
  }

  private broadcastMeta(stream: LiveStream): BroadcastMeta {
    return {
      title: stream.title,
      description: stream.description ?? undefined,
      scheduledAt: stream.scheduledAt ?? undefined,
      visibility: (stream.visibility as BroadcastMeta['visibility']) ?? undefined,
      precreate: true,
    };
  }

  private describe(row: LiveStreamDestination, conn?: PlatformConnection): string {
    const c = conn ?? row.platformConnection;
    return c ? `${platformLabel(c.platform)} (${c.label})` : 'a destination';
  }

  /**
   * Creates the platform-side broadcast now, scheduled for the stream's
   * start time, for every given destination whose platform can hold one
   * (YouTube, Facebook). The rest -- Twitch -- are left PENDING and created
   * when the stream starts. A failure never fails the schedule: it's
   * recorded on that destination and reported back as a warning, and start()
   * simply creates a fresh broadcast for it.
   */
  private async precreate(stream: LiveStream, rows: LiveStreamDestination[], connections?: PlatformConnection[]): Promise<string[]> {
    const warnings: string[] = [];
    await Promise.all(
      rows.map(async (row) => {
        const conn = connections?.find((c) => c.id === row.platformConnectionId) ?? row.platformConnection;
        if (!conn || row.platformBroadcastId) return;
        const provider = this.streamsService.resolveProvider(conn);
        if (!provider.canPrescheduleBroadcast) return;

        // Facebook only accepts a scheduled live up to 7 days ahead -- say so
        // instead of sending a call that is bound to fail.
        const leadMs = (stream.scheduledAt?.getTime() ?? 0) - Date.now();
        if (provider.maxPrescheduleLeadMs && leadMs > provider.maxPrescheduleLeadMs) {
          const days = Math.floor(provider.maxPrescheduleLeadMs / 86_400_000);
          warnings.push(
            `${this.describe(row, conn)}: the platform only allows scheduling up to ${days} days ahead, so it will be created when you start the stream (or turn "Create on platforms now" on again within ${days} days of the start time).`,
          );
          return;
        }

        try {
          const result = await provider.createBroadcast(conn, this.broadcastMeta(stream));
          Object.assign(row, {
            platformBroadcastId: result.platformBroadcastId,
            ingestUrl: result.ingestUrl,
            streamKey: result.streamKey,
            watchUrl: result.watchUrl,
            status: DestinationStatus.READY,
            errorMessage: null,
          });
          const image = await this.loadThumbnail(stream.id);
          if (image) warnings.push(...(await this.applyThumbnail([row], image)));
        } catch (err) {
          const message = (err as Error).message;
          row.errorMessage = message;
          warnings.push(`${this.describe(row, conn)}: couldn't create it on the platform now (${message}). It will be created when you start the stream.`);
        }
        await this.destinations.save(row);
      }),
    );
    return warnings;
  }

  /** Pushes the stream's current title/description/time/visibility to broadcasts that already exist on the platforms. */
  private async syncToPlatform(stream: LiveStream, rows: LiveStreamDestination[]): Promise<string[]> {
    const warnings: string[] = [];
    await Promise.all(
      rows.map(async (row) => {
        const conn = row.platformConnection;
        if (!conn || !row.platformBroadcastId) return;
        const provider = this.streamsService.resolveProvider(conn);
        try {
          await provider.updateBroadcast?.(conn, row.platformBroadcastId, this.broadcastMeta(stream));
        } catch (err) {
          warnings.push(`${this.describe(row)}: couldn't update it on the platform (${(err as Error).message}).`);
        }
      }),
    );
    return warnings;
  }

  /** Deletes pre-created platform broadcasts (best effort) and resets those rows to "will be created at start". */
  private async removeFromPlatform(rows: LiveStreamDestination[]): Promise<string[]> {
    const warnings: string[] = [];
    await Promise.all(
      rows.map(async (row) => {
        const conn = row.platformConnection;
        if (!conn || !row.platformBroadcastId) return;
        const provider = this.streamsService.resolveProvider(conn);
        try {
          await provider.deleteBroadcast?.(conn, row.platformBroadcastId);
        } catch (err) {
          warnings.push(`${this.describe(row)}: couldn't remove it from the platform (${(err as Error).message}). You may need to delete it there yourself.`);
        }
        Object.assign(row, { platformBroadcastId: null, ingestUrl: null, streamKey: null, watchUrl: null, status: DestinationStatus.PENDING, errorMessage: null });
        await this.destinations.save(row);
      }),
    );
    return warnings;
  }

  /** Public watch links for the invite -- not for a private stream, whose link only works for the owner. */
  private watchLinks(stream: LiveStream, rows: LiveStreamDestination[]): Array<{ platform: string; url: string }> {
    if (stream.visibility === 'private') return [];
    return rows
      .filter((r) => !!r.watchUrl && r.platformConnection)
      .map((r) => ({ platform: platformLabel(r.platformConnection.platform), url: r.watchUrl! }));
  }

  private inviteData(
    account: Account,
    stream: LiveStream,
    kind: StreamInviteData['kind'],
    joinUrl: string,
    passwordProtected: boolean,
    platforms: string[],
    watchLinks: Array<{ platform: string; url: string }> = [],
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
      watchLinks,
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
    const destRows = await this.loadDestinations(stream.id);
    const platforms = [...new Set(destRows.map((r) => r.platformConnection?.platform).filter((p): p is NonNullable<typeof p> => !!p))].map(platformLabel);
    const watchLinks = this.watchLinks(stream, destRows);

    const results = await Promise.allSettled(
      invites.map(async (invite) => {
        await this.email.sendStreamInvite(
          invite.email!,
          this.inviteData(account, stream, kind, this.studioSessions.joinUrlFor(invite.token), passwordProtected, platforms, watchLinks),
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

  private async buildDetail(account: Account, streamId: string, extras: DetailExtras = {}): Promise<ScheduleDetail> {
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

    const destRows = await this.loadDestinations(stream.id);
    const platforms = [...new Set(destRows.map((d) => d.platformConnection?.platform).filter(Boolean) as string[])].map(platformLabel);
    const thumbnailMeta = await this.thumbnails.findOne({ where: { liveStreamId: stream.id }, select: ['liveStreamId', 'updatedAt'] });

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
      precreateOnPlatforms: stream.precreateOnPlatforms,
      hasThumbnail: !!thumbnailMeta,
      thumbnailUpdatedAt: thumbnailMeta?.updatedAt ?? null,
      destinations: destRows.map((d) => ({
        id: d.id,
        platformConnectionId: d.platformConnectionId,
        platform: d.platformConnection?.platform ?? 'unknown',
        label: d.platformConnection?.label ?? '',
        canPrecreate: d.platformConnection ? !!this.streamsService.resolveProvider(d.platformConnection).canPrescheduleBroadcast : false,
        onPlatform: !!d.platformBroadcastId,
        watchUrl: d.watchUrl,
        errorMessage: d.errorMessage,
      })),
      guests,
      generalJoinUrl,
      invitationText: buildInvitationText(
        this.inviteData(account, stream, 'invite', generalJoinUrl ?? '(link will appear once created)', passwordProtected, platforms, this.watchLinks(stream, destRows)),
      ),
      ...(extras.emailFailures ? { emailFailures: extras.emailFailures } : {}),
      ...(extras.platformWarnings ? { platformWarnings: extras.platformWarnings } : {}),
    };
  }
}
