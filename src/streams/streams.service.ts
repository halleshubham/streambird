import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LiveStream } from './entities/live-stream.entity';
import { LiveStreamDestination } from './entities/live-stream-destination.entity';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { CreateStreamDto } from './dto/create-stream.dto';
import { StreamStatus } from '../common/enums/stream-status.enum';
import { DestinationStatus } from '../common/enums/destination-status.enum';
import { STREAM_PROVIDERS } from '../providers/provider.tokens';
import { StreamProvider } from '../providers/stream-provider.interface';
import { RELAY_PROVIDER, RelayProvider, RelayLiveInput } from '../relay/relay-provider.interface';
import { MediaMtxService } from '../relay/mediamtx.service';
import { StudioSessionsService } from '../studio/studio-sessions.service';
import { AccountsService } from '../accounts/accounts.service';

@Injectable()
export class StreamsService {
  constructor(
    @InjectRepository(LiveStream)
    private readonly liveStreams: Repository<LiveStream>,
    @InjectRepository(LiveStreamDestination)
    private readonly destinations: Repository<LiveStreamDestination>,
    @InjectRepository(PlatformConnection)
    private readonly platformConnections: Repository<PlatformConnection>,
    @Inject(STREAM_PROVIDERS)
    private readonly providers: StreamProvider[],
    @Inject(RELAY_PROVIDER)
    private readonly relay: RelayProvider,
    private readonly mediaMtx: MediaMtxService,
    private readonly studioSessions: StudioSessionsService,
    private readonly accountsService: AccountsService,
  ) {}

  private resolveProvider(connection: PlatformConnection): StreamProvider {
    const provider = this.providers.find((p) => p.identifier === connection.platform);
    if (!provider) {
      throw new UnprocessableEntityException(
        `No StreamProvider registered for platform '${connection.platform}'`,
      );
    }
    return provider;
  }

  async create(accountId: string, dto: CreateStreamDto): Promise<LiveStream> {
    // Checked before anything else -- a blocked account shouldn't even
    // reach the point of creating a LiveStream row or touching a
    // provider's API. Never blocks a stream that's already running (see
    // AccountsService.assertCanStartStream's docstring).
    await this.accountsService.assertCanStartStream(accountId);

    const connections = await this.platformConnections.find({
      where: { id: In(dto.destinationConnectionIds), accountId },
    });

    if (connections.length !== dto.destinationConnectionIds.length) {
      throw new UnprocessableEntityException(
        'One or more destinationConnectionIds do not belong to this account',
      );
    }

    const stream = this.liveStreams.create({
      accountId,
      title: dto.title,
      description: dto.description ?? null,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      visibility: dto.visibility ?? null,
      status: StreamStatus.SCHEDULED,
    });
    await this.liveStreams.save(stream);

    // Every stream gets a studio session up front, independent of whether
    // destination fan-out below ultimately succeeds — the guest-join room
    // is a property of "this go-live attempt," not of any one destination.
    const studioSession = await this.studioSessions.createForStream(stream);
    stream.studioSessionId = studioSession.id;

    return this.provision(stream, connections, {
      title: dto.title,
      description: dto.description,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
      visibility: dto.visibility,
    });
  }

  /**
   * Creates the platform broadcasts, registers the MediaMTX forward and
   * flips the stream LIVE -- the part of going live that talks to the
   * outside world. Shared by create() (go live now) and start() (a
   * previously scheduled stream whose time has come).
   */
  private async provision(
    stream: LiveStream,
    connections: PlatformConnection[],
    meta: { title: string; description?: string; scheduledAt?: Date; visibility?: 'public' | 'unlisted' | 'private' },
  ): Promise<LiveStream> {
    // Fan out createBroadcast() in parallel; a rejection here never blocks
    // the destinations that succeeded — that is the whole point of
    // Promise.allSettled over Promise.all for this step.
    const settled = await Promise.allSettled(
      connections.map(async (conn) => {
        const provider = this.resolveProvider(conn);
        const result = await provider.createBroadcast(conn, {
          title: meta.title,
          description: meta.description,
          scheduledAt: meta.scheduledAt,
          visibility: meta.visibility,
        });
        return { conn, result };
      }),
    );

    const succeeded: Array<{ conn: PlatformConnection; result: Awaited<ReturnType<StreamProvider['createBroadcast']>> }> = [];
    const destinationRows: LiveStreamDestination[] = [];

    settled.forEach((outcome, index) => {
      const conn = connections[index];
      if (outcome.status === 'fulfilled') {
        succeeded.push(outcome.value);
        destinationRows.push(
          this.destinations.create({
            liveStreamId: stream.id,
            platformConnectionId: conn.id,
            platformBroadcastId: outcome.value.result.platformBroadcastId,
            ingestUrl: outcome.value.result.ingestUrl,
            streamKey: outcome.value.result.streamKey,
            watchUrl: outcome.value.result.watchUrl,
            status: DestinationStatus.READY,
          }),
        );
      } else {
        destinationRows.push(
          this.destinations.create({
            liveStreamId: stream.id,
            platformConnectionId: conn.id,
            status: DestinationStatus.FAILED,
            errorMessage: this.describeError(outcome.reason),
          }),
        );
      }
    });

    if (succeeded.length === 0) {
      await this.destinations.save(destinationRows);
      stream.status = StreamStatus.FAILED;
      await this.liveStreams.save(stream);
      throw new UnprocessableEntityException(
        'Could not create a broadcast on any requested destination',
      );
    }

    // A RelayProvider is optional and only used for its own value-add
    // (hosted preview, recording) -- skip creating a live input at all
    // when it isn't actually configured, rather than let every call to an
    // unconfigured provider's API fail.
    let liveInput: RelayLiveInput | null = null;
    if (this.relay.isConfigured()) {
      liveInput = await this.relay.createLiveInput({ name: stream.id });
      stream.relayLiveInputId = liveInput.uid;
      stream.ingestUrl = liveInput.ingestUrl;
      stream.streamKey = liveInput.streamKey;
    }

    // The browser host studio always publishes WHIP through our own
    // MediaMTX instance, never straight to a platform or RelayProvider --
    // see MediaMtxService for why. MediaMTX forwards the same stream on as
    // RTMP directly to every ready destination's own ingest, plus the
    // configured RelayProvider's ingest too, if there is one.
    const forwardDests = destinationRows
      .filter((row) => row.status === DestinationStatus.READY)
      .map((row) => `${row.ingestUrl!.replace(/\/$/, '')}/${row.streamKey}`);

    if (liveInput) {
      forwardDests.push(`${liveInput.ingestUrl.replace(/\/$/, '')}/${liveInput.streamKey}`);
    }

    stream.whipUrl = await this.mediaMtx.registerForward(stream.id, forwardDests);

    for (const row of destinationRows) {
      if (row.status === DestinationStatus.READY) {
        row.status = DestinationStatus.LIVE;
      }
    }

    await this.destinations.save(destinationRows);

    stream.status = StreamStatus.LIVE;
    stream.startedAt = new Date();
    await this.liveStreams.save(stream);

    return this.findByIdOrThrow(stream.id, stream.accountId);
  }

  /**
   * Starts a scheduled stream: creates the broadcasts on every chosen
   * destination and flips it LIVE (billing starts here, not when it was
   * scheduled). If every destination fails, the stream goes back to
   * SCHEDULED with its destinations intact so the host can fix the
   * connection and try again.
   */
  async start(id: string, accountId: string): Promise<LiveStream> {
    const stream = await this.findByIdOrThrow(id, accountId);
    if (!stream.isScheduledEvent || stream.status !== StreamStatus.SCHEDULED) {
      throw new UnprocessableEntityException('Only a scheduled stream that has not started yet can be started.');
    }

    await this.accountsService.assertCanStartStream(accountId);

    const connectionIds = stream.destinations.map((d) => d.platformConnectionId);
    const connections = await this.platformConnections.find({ where: { id: In(connectionIds), accountId } });
    if (connections.length === 0) {
      throw new UnprocessableEntityException('None of this stream\'s destinations are connected any more.');
    }

    // Placeholder rows would collide with the real ones (unique per
    // stream + connection), so clear them for the provisioning run. Then
    // re-read the stream WITHOUT its destinations relation: saving the
    // already-loaded entity after its placeholders are gone makes TypeORM
    // try to null out their foreign keys (a NOT NULL violation).
    await this.destinations.delete({ liveStreamId: stream.id });
    const fresh = await this.liveStreams.findOne({ where: { id: stream.id, accountId } });
    if (!fresh) throw new NotFoundException(`LiveStream ${id} not found`);

    try {
      return await this.provision(fresh, connections, {
        title: fresh.title,
        description: fresh.description ?? undefined,
        visibility: (fresh.visibility as 'public' | 'unlisted' | 'private' | null) ?? undefined,
      });
    } catch (err) {
      // provision() marked it FAILED and left FAILED destination rows --
      // undo that so a scheduled stream is never lost to one bad start.
      await this.destinations.delete({ liveStreamId: stream.id });
      await this.destinations.save(
        connections.map((c) =>
          this.destinations.create({
            liveStreamId: stream.id,
            platformConnectionId: c.id,
            status: DestinationStatus.PENDING,
          }),
        ),
      );
      fresh.status = StreamStatus.SCHEDULED;
      await this.liveStreams.save(fresh);
      throw err;
    }
  }

  async findByIdOrThrow(id: string, accountId: string): Promise<LiveStream> {
    const stream = await this.liveStreams.findOne({
      where: { id, accountId },
      relations: ['destinations'],
    });
    if (!stream) {
      throw new NotFoundException(`LiveStream ${id} not found`);
    }

    // studioSessionId isn't a persisted column on this table (see the entity
    // comment) — look it up by liveStreamId every time so it survives a
    // reload, not just the one create() response that happened to set it
    // on this in-memory instance.
    const studioSession = await this.studioSessions.findByLiveStreamId(stream.id);
    stream.studioSessionId = studioSession?.id;

    return stream;
  }

  async findAllForAccount(
    accountId: string,
    limit: number,
    offset: number,
    upcomingOnly = false,
  ): Promise<{ items: LiveStream[]; total: number }> {
    // "Upcoming" = deliberately scheduled, not yet started, soonest first.
    const [items, total] = await this.liveStreams.findAndCount({
      where: upcomingOnly
        ? { accountId, isScheduledEvent: true, status: StreamStatus.SCHEDULED }
        : { accountId },
      relations: ['destinations', 'destinations.platformConnection'],
      order: upcomingOnly ? { scheduledAt: 'ASC' } : { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { items, total };
  }

  async getStatus(id: string, accountId: string) {
    const stream = await this.findByIdOrThrow(id, accountId);

    // Best-effort viewer-count + real-platform-status refresh: a failed read
    // never flips stored status, it just leaves the last known values. The
    // platform status (platformStatus below) is fetched fresh every call,
    // not persisted -- it's the ground truth for "is this destination
    // actually receiving data and airing," which our own `status` column
    // (LIVE as soon as forwarding is configured, regardless of whether the
    // platform has seen a single byte yet) deliberately does not track.
    const platformStatuses = new Map<string, string | null>();
    await Promise.allSettled(
      stream.destinations
        .filter((d) => d.status === DestinationStatus.LIVE)
        .map(async (d) => {
          const conn = await this.platformConnections.findOneOrFail({
            where: { id: d.platformConnectionId },
          });
          const provider = this.resolveProvider(conn);
          if (!d.platformBroadcastId) return;

          if (provider.getViewerCount) {
            const count = await provider.getViewerCount(conn, d.platformBroadcastId);
            d.viewerCount = count;
            await this.destinations.save(d);
          }
          if (provider.getBroadcastStatus) {
            platformStatuses.set(d.id, await provider.getBroadcastStatus(conn, d.platformBroadcastId));
          }
        }),
    );

    // Whether the optional RelayProvider's own live input is connected --
    // platform destinations are delivered by MediaMTX directly now (see
    // create()), so this is just the RelayProvider's own preview/recording
    // health, not a per-destination status.
    let relayInputStatus: 'idle' | 'connected' | null = null;
    if (stream.relayLiveInputId) {
      try {
        relayInputStatus = (await this.relay.getLiveInputStatus(stream.relayLiveInputId)).status;
      } catch {
        // Best-effort -- a RelayProvider API hiccup here shouldn't break
        // the whole status response, it just omits this extra detail.
      }
    }

    return {
      status: stream.status,
      relayInputStatus,
      destinations: stream.destinations.map((d) => ({
        id: d.id,
        platformConnectionId: d.platformConnectionId,
        status: d.status,
        // Real platform-reported lifecycle status (e.g. YouTube's created/
        // ready/testing/live/complete) when the provider supports reading
        // it, so "StreamBird says LIVE" and "YouTube says testing/no data
        // yet" are both visible instead of only the former.
        platformStatus: platformStatuses.get(d.id) ?? null,
        viewerCount: d.viewerCount,
        watchUrl: d.watchUrl,
        errorMessage: d.errorMessage,
      })),
    };
  }

  async retryDestination(streamId: string, destinationId: string, accountId: string) {
    const stream = await this.findByIdOrThrow(streamId, accountId);
    const destination = stream.destinations.find((d) => d.id === destinationId);
    if (!destination) {
      throw new NotFoundException(`Destination ${destinationId} not found on stream ${streamId}`);
    }

    const conn = await this.platformConnections.findOneOrFail({
      where: { id: destination.platformConnectionId },
    });
    const provider = this.resolveProvider(conn);

    try {
      const result = await provider.createBroadcast(conn, {
        title: stream.title,
        description: stream.description ?? undefined,
        scheduledAt: stream.scheduledAt ?? undefined,
        visibility: (stream.visibility as 'public' | 'unlisted' | 'private' | null) ?? undefined,
      });
      destination.platformBroadcastId = result.platformBroadcastId;
      destination.ingestUrl = result.ingestUrl;
      destination.streamKey = result.streamKey;
      destination.watchUrl = result.watchUrl;
      destination.errorMessage = null;
      destination.retryCount += 1;
      destination.status = DestinationStatus.LIVE;

      // MediaMTX's forward list is a full replace, not an append -- so a
      // retry recomputes every currently-live destination's ingest (this
      // one included, with its freshly minted key) plus the RelayProvider's
      // ingest if one is configured, same as create().
      const forwardDests = stream.destinations
        .filter((d) => d.ingestUrl && d.streamKey && d.status !== DestinationStatus.FAILED)
        .map((d) => `${d.ingestUrl!.replace(/\/$/, '')}/${d.streamKey}`);

      if (stream.relayLiveInputId && stream.ingestUrl && stream.streamKey) {
        forwardDests.push(`${stream.ingestUrl.replace(/\/$/, '')}/${stream.streamKey}`);
      }

      await this.mediaMtx.updateForward(stream.id, forwardDests);
    } catch (err) {
      destination.status = DestinationStatus.FAILED;
      destination.errorMessage = this.describeError(err);
      destination.retryCount += 1;
    }

    await this.destinations.save(destination);
    return destination;
  }

  async end(id: string, accountId: string): Promise<LiveStream> {
    const stream = await this.findByIdOrThrow(id, accountId);

    await Promise.allSettled(
      stream.destinations
        .filter((d) => d.status === DestinationStatus.LIVE && d.platformBroadcastId)
        .map(async (d) => {
          const conn = await this.platformConnections.findOneOrFail({
            where: { id: d.platformConnectionId },
          });
          const provider = this.resolveProvider(conn);
          await provider.endBroadcast(conn, d.platformBroadcastId!);
          d.status = DestinationStatus.ENDED;
          await this.destinations.save(d);
        }),
    );

    if (stream.relayLiveInputId) {
      await this.relay.deleteLiveInput(stream.relayLiveInputId);
    }
    if (stream.whipUrl) {
      await this.mediaMtx.removeForward(stream.id);
    }

    // A host token can't outlive the stream it authenticates studio access
    // for -- otherwise a leaked token from an ended show would still work.
    await this.studioSessions.revokeHostTokensForStream(stream.id);

    // Guest invites no longer carry their own TTL (they're valid for the
    // whole stream) -- this is now the only thing that ends their lifetime.
    await this.studioSessions.revokeInvitesForStream(stream.id);

    stream.status = StreamStatus.ENDED;
    stream.endedAt = new Date();
    await this.liveStreams.save(stream);

    // Usage is recorded by actual wall-clock duration, only for a stream
    // that really went live (startedAt is only ever set once create()
    // reaches StreamStatus.LIVE) -- a stream that failed before going live
    // never accrues usage. Best-effort: a failure here shouldn't block the
    // stream from ending.
    if (stream.startedAt) {
      const hours = (stream.endedAt.getTime() - stream.startedAt.getTime()) / 3_600_000;
      await this.accountsService.recordStreamUsage(accountId, hours).catch(() => {});
    }

    return this.findByIdOrThrow(id, accountId);
  }

  private describeError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
