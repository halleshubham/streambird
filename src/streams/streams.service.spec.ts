import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { StreamsService } from './streams.service';
import { LiveStream } from './entities/live-stream.entity';
import { LiveStreamDestination } from './entities/live-stream-destination.entity';
import { StreamThumbnail } from './entities/stream-thumbnail.entity';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { STREAM_PROVIDERS } from '../providers/provider.tokens';
import { RELAY_PROVIDER } from '../relay/relay-provider.interface';
import { FakeRelayProvider } from '../relay/fake-relay-provider';
import { MediaMtxService } from '../relay/mediamtx.service';
import { Platform } from '../common/enums/platform.enum';
import { StreamStatus } from '../common/enums/stream-status.enum';
import { DestinationStatus } from '../common/enums/destination-status.enum';
import { StreamProvider } from '../providers/stream-provider.interface';
import { StudioSessionsService } from '../studio/studio-sessions.service';
import { AccountsService } from '../accounts/accounts.service';

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
    delete: jest.fn(async (where: any) => {
      for (const [key, row] of [...rows.entries()]) {
        if (Object.entries(where).every(([k, v]) => (row as any)[k] === v)) rows.delete(key);
      }
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
        watchUrl: `https://watch.example/${identifier}-broadcast-1`,
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
    const relay = new FakeRelayProvider();
    const thumbnailRows = new Map<string, any>();
    const thumbnailRepo = { findOne: jest.fn(async ({ where }: any) => thumbnailRows.get(where.liveStreamId) ?? null) };

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
        { provide: getRepositoryToken(StreamThumbnail), useValue: thumbnailRepo },
        { provide: STREAM_PROVIDERS, useValue: providers },
        { provide: RELAY_PROVIDER, useValue: relay },
        {
          provide: MediaMtxService,
          useValue: {
            registerForward: jest.fn(async () => 'https://fake.local/whip'),
            updateForward: jest.fn(async () => undefined),
            removeForward: jest.fn(async () => undefined),
          },
        },
        {
          provide: StudioSessionsService,
          useValue: {
            createForStream: jest.fn(async () => ({ id: 'studio_session_1' })),
            findByLiveStreamId: jest.fn(async () => ({ id: 'studio_session_1' })),
            revokeHostTokensForStream: jest.fn(async () => undefined),
            revokeInvitesForStream: jest.fn(async () => undefined),
          },
        },
        {
          provide: AccountsService,
          useValue: {
            assertCanStartStream: jest.fn(async () => undefined),
            recordStreamUsage: jest.fn(async () => undefined),
          },
        },
      ],
    }).compile();

    return {
      service: moduleRef.get(StreamsService),
      connectionRepo,
      liveStreamRepo,
      destinationRepo,
      thumbnailRows,
      relay,
      studioSessions: moduleRef.get(StudioSessionsService),
      accountsService: moduleRef.get(AccountsService),
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
    expect(stream.studioSessionId).toBe('studio_session_1');

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
    const { service, connectionRepo, relay, studioSessions } = await build([youtube]);
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
    // Guest invites no longer carry their own TTL -- ending the stream is
    // now the only thing that stops an outstanding invite link from working.
    expect(studioSessions.revokeInvitesForStream).toHaveBeenCalledWith(stream.id);
  });

  it('passes visibility through to the provider and persists both it and the returned watchUrl', async () => {
    const youtube = fakeProvider(Platform.YOUTUBE, 'succeed');
    const { service, connectionRepo } = await build([youtube]);
    const conn = makeConnection('c1', Platform.YOUTUBE);
    connectionRepo.rows.set(conn.id, conn);

    const stream = await service.create('acc_1', {
      title: 'Visibility test',
      destinationConnectionIds: ['c1'],
      visibility: 'public',
    });

    expect(youtube.createBroadcast).toHaveBeenCalledWith(
      conn,
      expect.objectContaining({ visibility: 'public' }),
    );
    expect(stream.destinations[0].watchUrl).toBe('https://watch.example/youtube-broadcast-1');
  });

  it('getStatus surfaces the provider-reported platformStatus alongside the (possibly optimistic) internal status', async () => {
    const youtube = fakeProvider(Platform.YOUTUBE, 'succeed');
    (youtube as any).getBroadcastStatus = jest.fn(async () => 'testing');
    const { service, connectionRepo } = await build([youtube]);
    const conn = makeConnection('c1', Platform.YOUTUBE);
    connectionRepo.rows.set(conn.id, conn);

    const stream = await service.create('acc_1', {
      title: 'Status test',
      destinationConnectionIds: ['c1'],
    });

    const status = await service.getStatus(stream.id, 'acc_1');

    expect(status.destinations[0].status).toBe(DestinationStatus.LIVE);
    expect(status.destinations[0].platformStatus).toBe('testing');
    expect(status.destinations[0].watchUrl).toBe('https://watch.example/youtube-broadcast-1');
  });

  it("getStatus leaves platformStatus null when the provider doesn't support reading it (e.g. Twitch)", async () => {
    const twitch = fakeProvider(Platform.TWITCH, 'succeed');
    const { service, connectionRepo } = await build([twitch]);
    const conn = makeConnection('c1', Platform.TWITCH);
    connectionRepo.rows.set(conn.id, conn);

    const stream = await service.create('acc_1', {
      title: 'No platform status test',
      destinationConnectionIds: ['c1'],
    });

    const status = await service.getStatus(stream.id, 'acc_1');

    expect(status.destinations[0].platformStatus).toBeNull();
  });

  it('create() refuses to even start when the account is blocked on usage, before touching any provider', async () => {
    const youtube = fakeProvider(Platform.YOUTUBE, 'succeed');
    const { service, connectionRepo, accountsService } = await build([youtube]);
    (accountsService.assertCanStartStream as jest.Mock).mockRejectedValue(
      new ForbiddenException("You've used all your included stream hours for this billing period."),
    );
    const conn = makeConnection('c1', Platform.YOUTUBE);
    connectionRepo.rows.set(conn.id, conn);

    await expect(
      service.create('acc_1', { title: 'Blocked test', destinationConnectionIds: ['c1'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(youtube.createBroadcast).not.toHaveBeenCalled();
  });

  it('end() records the stream\'s actual elapsed duration as usage against the account', async () => {
    const youtube = fakeProvider(Platform.YOUTUBE, 'succeed');
    const { service, connectionRepo, liveStreamRepo, accountsService } = await build([youtube]);
    const conn = makeConnection('c1', Platform.YOUTUBE);
    connectionRepo.rows.set(conn.id, conn);

    const stream = await service.create('acc_1', {
      title: 'Usage test',
      destinationConnectionIds: ['c1'],
    });
    (liveStreamRepo.rows.get(stream.id) as any).startedAt = new Date(Date.now() - 2 * 3_600_000);

    await service.end(stream.id, 'acc_1');

    expect(accountsService.recordStreamUsage).toHaveBeenCalledWith('acc_1', expect.any(Number));
    const [, hours] = (accountsService.recordStreamUsage as jest.Mock).mock.calls[0];
    expect(hours).toBeCloseTo(2, 1);
  });

  describe('start() (scheduled streams)', () => {
    async function scheduled(providers: StreamProvider[]) {
      const ctx = await build(providers);
      ctx.connectionRepo.rows.set('conn_1', makeConnection('conn_1', Platform.TWITCH));
      ctx.liveStreamRepo.rows.set('stream_1', {
        id: 'stream_1',
        accountId: 'acc_1',
        title: 'Launch',
        description: 'desc',
        visibility: 'unlisted',
        status: StreamStatus.SCHEDULED,
        isScheduledEvent: true,
        scheduledAt: new Date(Date.now() + 3_600_000),
      } as any);
      ctx.destinationRepo.rows.set('dest_1', {
        id: 'dest_1',
        liveStreamId: 'stream_1',
        platformConnectionId: 'conn_1',
        status: DestinationStatus.PENDING,
      } as any);
      return ctx;
    }

    it('provisions the broadcasts, replaces the pending placeholders and goes LIVE', async () => {
      const { service, destinationRepo, accountsService } = await scheduled([fakeProvider(Platform.TWITCH, 'succeed')]);

      const stream = await service.start('stream_1', 'acc_1');

      expect(accountsService.assertCanStartStream).toHaveBeenCalledWith('acc_1');
      expect(stream.status).toBe(StreamStatus.LIVE);
      expect(stream.startedAt).toBeInstanceOf(Date);
      expect(stream.whipUrl).toBe('https://fake.local/whip');
      const rows = [...destinationRepo.rows.values()] as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe(DestinationStatus.LIVE);
      expect(rows[0].platformBroadcastId).toBe('twitch-broadcast-1');
    });

    it('puts the stream back to SCHEDULED with its pending destinations if every destination fails', async () => {
      const { service, liveStreamRepo, destinationRepo } = await scheduled([fakeProvider(Platform.TWITCH, 'fail')]);

      await expect(service.start('stream_1', 'acc_1')).rejects.toBeInstanceOf(UnprocessableEntityException);

      expect((liveStreamRepo.rows.get('stream_1') as any).status).toBe(StreamStatus.SCHEDULED);
      const rows = [...destinationRepo.rows.values()] as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe(DestinationStatus.PENDING);
      expect(rows[0].platformConnectionId).toBe('conn_1');
    });

    it('refuses to start a stream that is not a scheduled event, or already started', async () => {
      const { service, liveStreamRepo } = await scheduled([fakeProvider(Platform.TWITCH, 'succeed')]);

      (liveStreamRepo.rows.get('stream_1') as any).status = StreamStatus.LIVE;
      await expect(service.start('stream_1', 'acc_1')).rejects.toBeInstanceOf(UnprocessableEntityException);

      (liveStreamRepo.rows.get('stream_1') as any).status = StreamStatus.SCHEDULED;
      (liveStreamRepo.rows.get('stream_1') as any).isScheduledEvent = false;
      await expect(service.start('stream_1', 'acc_1')).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('never starts a blocked account\'s stream', async () => {
      const { service, accountsService } = await scheduled([fakeProvider(Platform.TWITCH, 'succeed')]);
      (accountsService.assertCanStartStream as jest.Mock).mockRejectedValueOnce(new ForbiddenException('suspended'));

      await expect(service.start('stream_1', 'acc_1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    describe('thumbnail at start', () => {
      const image = { liveStreamId: 'stream_1', contentType: 'image/png', data: Buffer.from([1, 2, 3]), width: 1280, height: 720 };

      function withThumbnailSupport(appliesWhenLive: boolean, fails = false) {
        const p: any = fakeProvider(Platform.TWITCH, 'succeed');
        p.thumbnailAppliesWhenLive = appliesWhenLive;
        p.setBroadcastThumbnail = jest.fn(async () => {
          if (fails) throw new Error('403 not verified');
        });
        return p;
      }

      it('sets it on a freshly created broadcast where it still matters once live', async () => {
        const provider = withThumbnailSupport(true);
        const { service, thumbnailRows } = await scheduled([provider]);
        thumbnailRows.set('stream_1', image);

        await service.start('stream_1', 'acc_1');

        expect(provider.setBroadcastThumbnail).toHaveBeenCalledWith(expect.anything(), 'twitch-broadcast-1', expect.objectContaining({ contentType: 'image/png' }));
      });

      it('skips platforms where it is only the scheduled lobby image, and does nothing without a saved thumbnail', async () => {
        const lobbyOnly = withThumbnailSupport(false);
        const a = await scheduled([lobbyOnly]);
        a.thumbnailRows.set('stream_1', image);
        await a.service.start('stream_1', 'acc_1');
        expect(lobbyOnly.setBroadcastThumbnail).not.toHaveBeenCalled();

        const none = withThumbnailSupport(true);
        const b = await scheduled([none]);
        await b.service.start('stream_1', 'acc_1');
        expect(none.setBroadcastThumbnail).not.toHaveBeenCalled();
      });

      it('a thumbnail failure never fails or undoes a stream that is live', async () => {
        const provider = withThumbnailSupport(true, true);
        const { service, thumbnailRows } = await scheduled([provider]);
        thumbnailRows.set('stream_1', image);

        const stream = await service.start('stream_1', 'acc_1');

        expect(stream.status).toBe(StreamStatus.LIVE);
      });
    });

    describe('reusing broadcasts pre-created while scheduling', () => {
      function precreatedProvider(status: string | null | Error) {
        const p: any = fakeProvider(Platform.TWITCH, 'succeed');
        p.getBroadcastStatus = jest.fn(async () => {
          if (status instanceof Error) throw status;
          return status;
        });
        return p;
      }

      async function scheduledWithPrecreated(provider: StreamProvider) {
        const ctx = await scheduled([provider]);
        const row: any = ctx.destinationRepo.rows.get('dest_1');
        Object.assign(row, {
          status: DestinationStatus.READY,
          platformBroadcastId: 'pre-bc',
          ingestUrl: 'rtmp://pre/ingest',
          streamKey: 'pre-key',
          watchUrl: 'https://watch.example/pre-bc',
        });
        return ctx;
      }

      it('reuses a live pre-created broadcast: no new broadcast, same key and watch link', async () => {
        const provider = precreatedProvider('ready');
        const { service, destinationRepo } = await scheduledWithPrecreated(provider);

        const stream = await service.start('stream_1', 'acc_1');

        expect(provider.createBroadcast).not.toHaveBeenCalled();
        expect(stream.status).toBe(StreamStatus.LIVE);
        const row = [...destinationRepo.rows.values()][0] as any;
        expect(row).toMatchObject({ status: DestinationStatus.LIVE, platformBroadcastId: 'pre-bc', streamKey: 'pre-key', watchUrl: 'https://watch.example/pre-bc' });
      });

      it.each([['complete'], [null], [new Error('404 not found')]])(
        'creates a fresh broadcast when the pre-created one is dead (%s)',
        async (status) => {
          const provider = precreatedProvider(status as any);
          const { service, destinationRepo } = await scheduledWithPrecreated(provider);

          await service.start('stream_1', 'acc_1');

          expect(provider.createBroadcast).toHaveBeenCalledTimes(1);
          expect(([...destinationRepo.rows.values()][0] as any).platformBroadcastId).toBe('twitch-broadcast-1');
        },
      );

      it('a failed start restores the pre-created destination exactly as it was', async () => {
        const provider = precreatedProvider('ready');
        const ctx = await scheduledWithPrecreated(provider);
        // The pre-created broadcast is reusable, but persisting the LIVE stream fails.
        (ctx.liveStreamRepo.save as jest.Mock).mockImplementationOnce(async () => {
          throw new Error('db down');
        });

        await expect(ctx.service.start('stream_1', 'acc_1')).rejects.toThrow();

        expect((ctx.liveStreamRepo.rows.get('stream_1') as any).status).toBe(StreamStatus.SCHEDULED);
        const rows = [...ctx.destinationRepo.rows.values()] as any[];
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ status: DestinationStatus.READY, platformBroadcastId: 'pre-bc', streamKey: 'pre-key' });
      });
    });
  });
});
