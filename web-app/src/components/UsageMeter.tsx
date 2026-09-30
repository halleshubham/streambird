import type { Account } from '../types/api';

export function UsageMeter({ account }: { account: Account }) {
  const used = Number(account.streamHourUsageCurrentPeriod);
  const included = Number(account.includedHoursPerMonth);
  const pct = included > 0 ? Math.min(100, (used / included) * 100) : 0;

  return (
    <div className="usage-meter">
      <div className="usage-meter-header">
        <span>Stream hours this period</span>
        <span>
          {used.toFixed(1)} / {included.toFixed(1)} hrs
        </span>
      </div>
      <div className="usage-meter-track">
        <div className="usage-meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="usage-meter-tier">{account.currentTier} plan</p>
    </div>
  );
}
