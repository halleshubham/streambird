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
import { CLOUDFLARE_RELAY } from '../relay/cloudflare-relay.interface';
import { CloudflareRelay } from '../relay/cloudflare-relay.interface';
import { StudioSessionsService } from '../studio/studio-sessions.service';

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
    @Inject(CLOUDFLARE_RELAY)
    private readonly relay: CloudflareRelay,
    private readonly studioSessions: StudioSessionsService,
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
      status: StreamStatus.SCHEDULED,
    });
    await this.liveStreams.save(stream);

    // Every stream gets a studio session up front, independent of whether
    // destination fan-out below ultimately succeeds — the guest-join room
    // is a property of "this go-live attempt," not of any one destination.
    const studioSession = await this.studioSessions.createForStream(stream);
    stream.studioSessionId = studioSession.id;

    // Fan out createBroadcast() in parallel; a rejection here never blocks
    // the destinations that succeeded — that is the whole point of
    // Promise.allSettled over Promise.all for this step.
    const settled = await Promise.allSettled(
      connections.map(async (conn) => {
        const provider = this.resolveProvider(conn);
        const result = await provider.createBroadcast(conn, { title: dto.title, description: dto.description });
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

    const liveInput = await this.relay.createLiveInput({ name: stream.id });
    stream.relayLiveInputId = liveInput.uid;
    stream.ingestUrl = liveInput.ingestUrl;
    stream.streamKey = liveInput.streamKey;
    stream.whipUrl = liveInput.whipUrl;

    for (const row of destinationRows) {
      if (row.status !== DestinationStatus.READY) continue;
      const output = await this.relay.addOutput(liveInput.uid, {
        url: row.ingestUrl!,
        streamKey: row.streamKey!,
      });
      row.cloudflareOutputUid = output.uid;
      row.status = DestinationStatus.LIVE;
    }

    await this.destinations.save(destinationRows);

    stream.status = StreamStatus.LIVE;
    stream.startedAt = new Date();
    await this.liveStreams.save(stream);

    return this.findByIdOrThrow(stream.id, accountId);
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
  ): Promise<{ items: LiveStream[]; total: number }> {
    const [items, total] = await this.liveStreams.findAndCount({
      where: { accountId },
      relations: ['destinations', 'destinations.platformConnection'],
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { items, total };
  }

  async getStatus(id: string, accountId: string) {
    const stream = await this.findByIdOrThrow(id, accountId);

    // Best-effort viewer-count refresh: a failed read never flips stored
    // status, it just leaves viewerCount as last known.
    await Promise.allSettled(
      stream.destinations
        .filter((d) => d.status === DestinationStatus.LIVE)
        .map(async (d) => {
          const conn = await this.platformConnections.findOneOrFail({
            where: { id: d.platformConnectionId },
          });
          const provider = this.resolveProvider(conn);
          if (!provider.getViewerCount || !d.platformBroadcastId) return;
          const count = await provider.getViewerCount(conn, d.platformBroadcastId);
          d.viewerCount = count;
          await this.destinations.save(d);
        }),
    );

    return {
      status: stream.status,
      destinations: stream.destinations.map((d) => ({
        id: d.id,
        platformConnectionId: d.platformConnectionId,
        status: d.status,
        viewerCount: d.viewerCount,
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
      const result = await provider.createBroadcast(conn, { title: stream.title, description: stream.description ?? undefined });
      destination.platformBroadcastId = result.platformBroadcastId;
      destination.ingestUrl = result.ingestUrl;
      destination.streamKey = result.streamKey;
      destination.errorMessage = null;
      destination.retryCount += 1;

      if (stream.relayLiveInputId) {
        const output = await this.relay.addOutput(stream.relayLiveInputId, {
          url: result.ingestUrl,
          streamKey: result.streamKey,
        });
        destination.cloudflareOutputUid = output.uid;
        destination.status = DestinationStatus.LIVE;
      } else {
        destination.status = DestinationStatus.READY;
      }
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

    stream.status = StreamStatus.ENDED;
    stream.endedAt = new Date();
    await this.liveStreams.save(stream);

    return this.findByIdOrThrow(id, accountId);
  }

  private describeError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
