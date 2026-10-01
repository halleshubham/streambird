import { SuperadminAnalyticsService } from './superadmin-analytics.service';
import { StreamStatus } from '../common/enums/stream-status.enum';
import { DestinationStatus } from '../common/enums/destination-status.enum';
import { PlanTier } from '../common/enums/plan-tier.enum';

function account(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'acc_1',
    name: 'Acme',
    currentTier: PlanTier.PRO,
    includedHoursPerMonth: '30.00',
    streamHourUsageCurrentPeriod: '10.00',
    ...overrides,
  } as any;
}

describe('SuperadminAnalyticsService', () => {
  function buildService(opts?: {
    liveStreamCount?: jest.Mock;
    destinationsFind?: jest.Mock;
    accountsFind?: jest.Mock;
  }) {
    const liveStreams = {
      count: opts?.liveStreamCount ?? jest.fn().mockResolvedValue(0),
    };
    const destinations = {
      find: opts?.destinationsFind ?? jest.fn().mockResolvedValue([]),
    };
    const accounts = {
      find: opts?.accountsFind ?? jest.fn().mockResolvedValue([]),
    };
    const service = new SuperadminAnalyticsService(
      liveStreams as any,
      destinations as any,
      accounts as any,
    );
    return { service, liveStreams, destinations, accounts };
  }

  describe('getOverview', () => {
    it('counts streamsToday and streamsThisWeek using createdAt windows, and currentlyLive by status', async () => {
      const liveStreamCount = jest
        .fn()
        // streamsToday
        .mockResolvedValueOnce(3)
        // streamsThisWeek
        .mockResolvedValueOnce(12)
        // currentlyLive
        .mockResolvedValueOnce(2);

      const { service, liveStreams } = buildService({ liveStreamCount });

      const result = await service.getOverview();

      expect(result.streamsToday).toBe(3);
      expect(result.streamsThisWeek).toBe(12);
      expect(result.currentlyLive).toBe(2);

      // Verify the three distinct queries: today window, week window, live status.
      expect(liveStreams.count).toHaveBeenCalledTimes(3);
      const [todayCall, weekCall, liveCall] = liveStreams.count.mock.calls.map((c) => c[0]);
      expect(todayCall.where.createdAt).toBeDefined();
      expect(weekCall.where.createdAt).toBeDefined();
      expect(liveCall.where.status).toBe(StreamStatus.LIVE);
    });

    it('computes destinationFailureRate as the fraction of recent destinations that failed', async () => {
      const destinationsFind = jest.fn().mockResolvedValue([
        { status: DestinationStatus.FAILED },
        { status: DestinationStatus.LIVE },
        { status: DestinationStatus.FAILED },
        { status: DestinationStatus.READY },
      ]);

      const { service } = buildService({ destinationsFind });

      const result = await service.getOverview();

      expect(result.destinationFailureRate).toBe(0.5);
    });

    it('returns a 0 failure rate (not NaN) when there are no recent destinations', async () => {
      const { service } = buildService({ destinationsFind: jest.fn().mockResolvedValue([]) });

      const result = await service.getOverview();

      expect(result.destinationFailureRate).toBe(0);
    });

    it('ranks topAccountsByUsage by streamHourUsageCurrentPeriod descending, capped at 10', async () => {
      const accountsList = Array.from({ length: 15 }, (_, i) =>
        account({
          id: `acc_${i}`,
          name: `Account ${i}`,
          streamHourUsageCurrentPeriod: String(i),
        }),
      );
      const { service } = buildService({ accountsFind: jest.fn().mockResolvedValue(accountsList) });

      const result = await service.getOverview();

      expect(result.topAccountsByUsage).toHaveLength(10);
      expect(result.topAccountsByUsage[0].accountId).toBe('acc_14');
      expect(result.topAccountsByUsage[0].streamHourUsageCurrentPeriod).toBe('14');
      expect(result.topAccountsByUsage[9].streamHourUsageCurrentPeriod).toBe('5');
      // Strictly descending.
      const usages = result.topAccountsByUsage.map((a) => Number(a.streamHourUsageCurrentPeriod));
      expect(usages).toEqual([...usages].sort((a, b) => b - a));
    });
  });

  describe('getUsageAlerts', () => {
    it('buckets an account at or above 100% usage as over_limit', async () => {
      const accountsList = [account({ includedHoursPerMonth: '10', streamHourUsageCurrentPeriod: '10' })];
      const { service } = buildService({ accountsFind: jest.fn().mockResolvedValue(accountsList) });

      const result = await service.getUsageAlerts();

      expect(result).toHaveLength(1);
      expect(result[0].bucket).toBe('over_limit');
      expect(result[0].ratio).toBe(1);
    });

    it('buckets an account at or above 80% (but below 100%) usage as near_limit', async () => {
      const accountsList = [account({ includedHoursPerMonth: '10', streamHourUsageCurrentPeriod: '8' })];
      const { service } = buildService({ accountsFind: jest.fn().mockResolvedValue(accountsList) });

      const result = await service.getUsageAlerts();

      expect(result).toHaveLength(1);
      expect(result[0].bucket).toBe('near_limit');
      expect(result[0].ratio).toBeCloseTo(0.8);
    });

    it('omits accounts below 80% usage', async () => {
      const accountsList = [account({ includedHoursPerMonth: '10', streamHourUsageCurrentPeriod: '5' })];
      const { service } = buildService({ accountsFind: jest.fn().mockResolvedValue(accountsList) });

      const result = await service.getUsageAlerts();

      expect(result).toHaveLength(0);
    });

    it('skips accounts with includedHoursPerMonth of 0 rather than dividing by zero', async () => {
      const accountsList = [
        account({ id: 'acc_zero', includedHoursPerMonth: '0', streamHourUsageCurrentPeriod: '5' }),
      ];
      const { service } = buildService({ accountsFind: jest.fn().mockResolvedValue(accountsList) });

      const result = await service.getUsageAlerts();

      expect(result).toHaveLength(0);
    });

    it('sorts results by ratio descending', async () => {
      const accountsList = [
        account({ id: 'acc_a', includedHoursPerMonth: '10', streamHourUsageCurrentPeriod: '8' }), // 0.8
        account({ id: 'acc_b', includedHoursPerMonth: '10', streamHourUsageCurrentPeriod: '15' }), // 1.5
      ];
      const { service } = buildService({ accountsFind: jest.fn().mockResolvedValue(accountsList) });

      const result = await service.getUsageAlerts();

      expect(result.map((r) => r.accountId)).toEqual(['acc_b', 'acc_a']);
    });
  });
});
