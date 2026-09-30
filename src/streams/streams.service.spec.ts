import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnprocessableEntityException } from '@nestjs/common';
import { StreamsService } from './streams.service';
import { LiveStream } from './entities/live-stream.entity';
import { LiveStreamDestination } from './entities/live-stream-destination.entity';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { STREAM_PROVIDERS } from '../providers/provider.tokens';
import { CLOUDFLARE_RELAY } from '../relay/cloudflare-relay.interface';
import { FakeCloudflareRelay } from '../relay/fake-cloudflare-relay';
import { Platform } from '../common/enums/platform.enum';
import { StreamStatus } from '../common/enums/stream-status.enum';
import { DestinationStatus } from '../common/enums/destination-status.enum';
import { StreamProvider } from '../providers/stream-provider.interface';

function inMemoryRepo<T extends { id?: string }>() {
  const rows = new Map<string, T>();
  let counter = 0;
  return {
    rows,
    create: jest.fn((v: Partial<T>) => ({ ...v }) as T),
    save: jest.fn(async (v: T | T[]) => {
      const list = Array.isArray(v) ? v : [v];
      for (const row of list) {
        if (!row.id) row.id = `id_${++counter}`;
        rows.set(row.id, row);
      }
      return v;
    }),
    find: jest.fn(async ({ where }: any) => {
      const idFilter = where.id;
      const ids: string[] = Array.isArray(idFilter) ? idFilter : idFilter.value;
      return [...rows.values()].filter(
        (r: any) => ids.includes(r.id) && r.accountId === where.accountId,
      );
    }),
    findOne: jest.fn(async ({ where }: any) => {
      return (
        [...rows.values()].find((r: any) =>
          Object.entries(where).every(([k, v]) => r[k] === v),
        ) ?? null
      );
    }),
    findOneOrFail: jest.fn(async ({ where }: any) => {
      const found = [...rows.values()].find((r: any) =>
        Object.entries(where).every(([k, v]) => r[k] === v),
      );
      if (!found) throw new Error('not found');
      return found;
    }),
  };
}

function fakeProvider(identifier: Platform, behavior: 'succeed' | 'fail'): StreamProvider {
  return {
    identifier,
    createBroadcast: jest.fn(async () => {
      if (behavior === 'fail') throw new Error(`${identifier} token expired`);
      return {
        ingestUrl: `rtmp://${identifier}/ingest`,
        streamKey: `${identifier}-key`,
        platformBroadcastId: `${identifier}-broadcast-1`,
      };
    }),
    endBroadcast: jest.fn(async () => undefined),
    getViewerCount: jest.fn(async () => 10),
  };
}

describe('StreamsService', () => {
  async function build(providers: StreamProvider[]) {
    const liveStreamRepo = inMemoryRepo<LiveStream>();
    const destinationRepo = inMemoryRepo<LiveStreamDestination>();
    const connectionRepo = inMemoryRepo<PlatformConnection>();
    const relay = new FakeCloudflareRelay();

    // findByIdOrThrow relies on TypeORM's `relations: ['destinations']` to
    // populate the nested array; the mocked repo has no such feature, so
    // stitch it in manually from the (separately mocked) destinations repo.
    const baseFindOne = liveStreamRepo.findOne;
    (liveStreamRepo.findOne as jest.Mock) = jest.fn(async (opts: any) => {
      const stream: any = await baseFindOne(opts);
      if (!stream) return null;
      stream.destinations = [...destinationRepo.rows.values()].filter(
        (d: any) => d.liveStreamId === stream.id,
      );
      return stream;
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        StreamsService,
        { provide: getRepositoryToken(LiveStream), useValue: liveStreamRepo },
        { provide: getRepositoryToken(LiveStreamDestination), useValue: destinationRepo },
        { provide: getRepositoryToken(PlatformConnection), useValue: connectionRepo },
        { provide: STREAM_PROVIDERS, useValue: providers },
        { provide: CLOUDFLARE_RELAY, useValue: relay },
      ],
    }).compile();

    return {
      service: moduleRef.get(StreamsService),
      connectionRepo,
      relay,
    };
  }

  function makeConnection(id: string, platform: Platform, accountId = 'acc_1'): PlatformConnection {
    return { id, platform, accountId, externalAccountId: `${platform}-ext` } as PlatformConnection;
  }

  it('goes live when at least one of several destinations succeeds (partial failure)', async () => {
    const { service, connectionRepo } = await build([
      fakeProvider(Platform.YOUTUBE, 'succeed'),
      fakeProvider(Platform.FACEBOOK, 'succeed'),
      fakeProvider(Platform.TWITCH, 'succeed'),
      fakeProvider(Platform.LINKEDIN, 'fail'),
    ]);

    const conns = [
      makeConnection('c1', Platform.YOUTUBE),
      makeConnection('c2', Platform.FACEBOOK),
      makeConnection('c3', Platform.TWITCH),
      makeConnection('c4', Platform.LINKEDIN),
    ];
    for (const c of conns) connectionRepo.rows.set(c.id, c);

    const stream = await service.create('acc_1', {
      title: 'Partial failure test',
      destinationConnectionIds: conns.map((c) => c.id),
    });

    expect(stream.status).toBe(StreamStatus.LIVE);
    expect(stream.ingestUrl).toMatch(/^rtmps:\/\/fake\.local\//);

    const statuses = stream.destinations.map((d) => d.status).sort();
    expect(statuses).toEqual(
      [DestinationStatus.LIVE, DestinationStatus.LIVE, DestinationStatus.LIVE, DestinationStatus.FAILED].sort(),
    );

    const failed = stream.destinations.find((d) => d.platformConnectionId === 'c4');
    expect(failed?.errorMessage).toMatch(/linkedin token expired/);
  });

  it('throws 422 and never creates a Cloudflare live input when zero destinations succeed', async () => {
    const { service, connectionRepo, relay } = await build([
      fakeProvider(Platform.YOUTUBE, 'fail'),
      fakeProvider(Platform.FACEBOOK, 'fail'),
    ]);

    const conns = [makeConnection('c1', Platform.YOUTUBE), makeConnection('c2', Platform.FACEBOOK)];
    for (const c of conns) connectionRepo.rows.set(c.id, c);

    await expect(
      service.create('acc_1', {
        title: 'All fail test',
        destinationConnectionIds: conns.map((c) => c.id),
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(relay.liveInputs.size).toBe(0);
  });

  it('rejects destinationConnectionIds that do not belong to the requesting account', async () => {
    const { service, connectionRepo } = await build([fakeProvider(Platform.YOUTUBE, 'succeed')]);
    const conn = makeConnection('c1', Platform.YOUTUBE, 'someone_elses_account');
    connectionRepo.rows.set(conn.id, conn);

    await expect(
      service.create('acc_1', { title: 'x', destinationConnectionIds: ['c1'] }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('end() calls endBroadcast on every live destination and tears down the live input', async () => {
    const youtube = fakeProvider(Platform.YOUTUBE, 'succeed');
    const { service, connectionRepo, relay } = await build([youtube]);
    const conn = makeConnection('c1', Platform.YOUTUBE);
    connectionRepo.rows.set(conn.id, conn);

    const stream = await service.create('acc_1', {
      title: 'End test',
      destinationConnectionIds: ['c1'],
    });
    expect(relay.liveInputs.size).toBe(1);

    const ended = await service.end(stream.id, 'acc_1');

    expect(ended.status).toBe(StreamStatus.ENDED);
    expect(youtube.endBroadcast).toHaveBeenCalledWith(conn, 'youtube-broadcast-1');
    expect(relay.liveInputs.size).toBe(0);
  });
});
