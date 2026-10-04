import { SessionLimitService } from './session-limit.service';

describe('SessionLimitService', () => {
  const NOW = new Date('2026-10-05T12:00:00Z');
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

  function build(streams: any[], capByAccount: Record<string, number | null>) {
    const repo = { find: jest.fn(async () => streams) };
    const streamsService = { end: jest.fn(async () => undefined) };
    const accountsService = { getLimits: jest.fn(async (id: string) => ({ maxSessionHours: capByAccount[id] })) };
    const svc = new SessionLimitService(repo as any, streamsService as any, accountsService as any);
    jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
    return { svc, streamsService, accountsService };
  }

  it('ends only streams past their plan cap; capless plans and young streams are left alone', async () => {
    const { svc, streamsService } = build(
      [
        { id: 's_old', accountId: 'a_capped', startedAt: hoursAgo(12.1) },
        { id: 's_young', accountId: 'a_capped', startedAt: hoursAgo(3) },
        { id: 's_uncapped', accountId: 'a_free', startedAt: hoursAgo(40) },
        { id: 's_never_started', accountId: 'a_capped', startedAt: null },
      ],
      { a_capped: 12, a_free: null },
    );

    expect(await svc.enforce(NOW)).toBe(1);
    expect(streamsService.end).toHaveBeenCalledTimes(1);
    expect(streamsService.end).toHaveBeenCalledWith('s_old', 'a_capped');
  });

  it('reads each account\'s limits once, however many of its streams are live', async () => {
    const { svc, accountsService } = build(
      [
        { id: 'a', accountId: 'acc', startedAt: hoursAgo(1) },
        { id: 'b', accountId: 'acc', startedAt: hoursAgo(2) },
      ],
      { acc: 12 },
    );
    await svc.enforce(NOW);
    expect(accountsService.getLimits).toHaveBeenCalledTimes(1);
  });

  it('never throws: a failing check is logged and the loop carries on next minute', async () => {
    const { svc } = build([], {});
    (svc as any).liveStreams.find = jest.fn(async () => { throw new Error('db'); });
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(svc.enforce(NOW)).resolves.toBe(0);
  });
});
