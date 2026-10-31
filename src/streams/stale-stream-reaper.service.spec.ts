import { StaleStreamReaperService } from './stale-stream-reaper.service';
import { StreamStatus } from '../common/enums/stream-status.enum';

const ID = '11111111-1111-4111-8111-111111111111';
const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 31, 12, 0, 0);

type Stats = Map<string, { ready: boolean; inboundBytes: number | null }> | null;

describe('StaleStreamReaperService', () => {
  let stats: Stats;
  let streams: any[];
  let watching: Set<string>;
  let mediaMtx: { listPathStats: jest.Mock };
  let streamsService: { end: jest.Mock };
  let service: StaleStreamReaperService;
  let settings: Record<string, unknown>;

  const liveStream = (over: Record<string, unknown> = {}) => ({
    id: ID,
    accountId: 'acc_1',
    status: StreamStatus.LIVE,
    whipUrl: 'https://mtx.example/' + ID + '/whip',
    startedAt: new Date(T0),
    createdAt: new Date(T0),
    ...over,
  });

  beforeEach(() => {
    stats = new Map();
    streams = [liveStream()];
    watching = new Set();
    settings = { 'staleStreams.enabled': true, 'staleStreams.noPublisherMinutes': 30, 'staleStreams.frozenMinutes': 5, 'staleStreams.checkSeconds': 30 };
    mediaMtx = { listPathStats: jest.fn(async () => stats) };
    streamsService = { end: jest.fn(async () => undefined) };
    const repo = { find: jest.fn(async () => streams) };
    const config = { get: (k: string) => settings[k] };
    const glitch = { isWatching: (id: string) => watching.has(id) };
    service = new StaleStreamReaperService(config as any, mediaMtx as any, streamsService as any, glitch as any, repo as any);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  });

  describe('a stream whose picture never arrived', () => {
    it('is left alone before the limit and ended exactly at it, billing nothing when watched from the start', async () => {
      await service.tick(T0 + 1000); // first look, soon after going live
      await service.tick(T0 + 30 * MIN - 1);
      expect(streamsService.end).not.toHaveBeenCalled();

      await service.tick(T0 + 30 * MIN);
      expect(streamsService.end).toHaveBeenCalledTimes(1);
      const [id, account, opts] = streamsService.end.mock.calls[0];
      expect([id, account]).toEqual([ID, 'acc_1']);
      expect(opts.reason).toMatch(/no video arrived within 30 minutes/);
      expect(opts.usageUntil).toEqual(new Date(T0)); // zero hours
    });

    it('after a backend restart (no history) ends it but bills normally instead of guessing', async () => {
      await service.tick(T0 + 3 * 60 * MIN); // first look is hours after it went live
      expect(streamsService.end).toHaveBeenCalledTimes(1);
      expect(streamsService.end.mock.calls[0][2].usageUntil).toBeUndefined();
    });

    it('is left to the glitch recovery once a publisher has been seen and has dropped', async () => {
      stats = new Map([[ID, { ready: true, inboundBytes: 10 }]]);
      await service.tick(T0 + 1000);
      stats = new Map(); // publisher gone, slate takes over
      await service.tick(T0 + 31 * MIN);
      expect(streamsService.end).not.toHaveBeenCalled();
    });

    it('is left alone while the glitch recovery is watching it', async () => {
      watching.add(ID);
      await service.tick(T0 + 1000);
      await service.tick(T0 + 2 * 60 * MIN);
      expect(streamsService.end).not.toHaveBeenCalled();
    });

    it('can be switched off with a limit of 0', async () => {
      settings['staleStreams.noPublisherMinutes'] = 0;
      await service.tick(T0 + 1000);
      await service.tick(T0 + 10 * 60 * 60_000);
      expect(streamsService.end).not.toHaveBeenCalled();
    });
  });

  describe('a publisher that is connected but sends nothing', () => {
    it('is ended after the frozen limit, billed up to the last moment data moved', async () => {
      stats = new Map([[ID, { ready: true, inboundBytes: 1000 }]]);
      await service.tick(T0 + MIN);
      stats = new Map([[ID, { ready: true, inboundBytes: 2000 }]]);
      await service.tick(T0 + 2 * MIN); // data moved here
      stats = new Map([[ID, { ready: true, inboundBytes: 2000 }]]);
      await service.tick(T0 + 2 * MIN + 5 * MIN - 1);
      expect(streamsService.end).not.toHaveBeenCalled();

      await service.tick(T0 + 2 * MIN + 5 * MIN);
      expect(streamsService.end).toHaveBeenCalledTimes(1);
      const opts = streamsService.end.mock.calls[0][2];
      expect(opts.reason).toMatch(/no video data arrived for 5 minutes/);
      expect(opts.usageUntil).toEqual(new Date(T0 + 2 * MIN));
    });

    it('a counter that keeps advancing is never ended', async () => {
      for (let i = 1; i <= 60; i++) {
        stats = new Map([[ID, { ready: true, inboundBytes: i * 1000 }]]);
        await service.tick(T0 + i * MIN);
      }
      expect(streamsService.end).not.toHaveBeenCalled();
    });

    it('does nothing when this MediaMTX reports no byte counter (and says so once)', async () => {
      stats = new Map([[ID, { ready: true, inboundBytes: null }]]);
      await service.tick(T0 + MIN);
      await service.tick(T0 + 60 * MIN);
      await service.tick(T0 + 120 * MIN);
      expect(streamsService.end).not.toHaveBeenCalled();
      expect(((service as any).logger.warn as jest.Mock).mock.calls.filter((c) => /no byte counter/.test(String(c[0])))).toHaveLength(1);
    });

    it('can be switched off with a limit of 0', async () => {
      settings['staleStreams.frozenMinutes'] = 0;
      stats = new Map([[ID, { ready: true, inboundBytes: 5 }]]);
      await service.tick(T0);
      await service.tick(T0 + 3 * 60 * MIN);
      expect(streamsService.end).not.toHaveBeenCalled();
    });
  });

  describe('never acts on what it cannot see', () => {
    it('does nothing when MediaMTX cannot be reached', async () => {
      stats = null;
      await service.tick(T0 + 5 * 60 * MIN);
      expect(streamsService.end).not.toHaveBeenCalled();
    });

    it('skips streams without a MediaMTX path (no whipUrl)', async () => {
      streams = [liveStream({ whipUrl: null })];
      await service.tick(T0 + 1000);
      await service.tick(T0 + 5 * 60 * MIN);
      expect(streamsService.end).not.toHaveBeenCalled();
    });

    it('survives a failing end() and keeps checking', async () => {
      streamsService.end.mockRejectedValueOnce(new Error('boom'));
      await service.tick(T0 + 1000);
      await expect(service.tick(T0 + 31 * MIN)).resolves.toBeUndefined();
      expect(streamsService.end).toHaveBeenCalledTimes(1);
    });

    it('forgets streams that are no longer live', async () => {
      await service.tick(T0 + 1000);
      streams = [];
      await service.tick(T0 + 2000);
      expect((service as any).seen.size).toBe(0);
    });
  });
});
