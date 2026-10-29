import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Account, EffectiveLimits, PublicPlan } from '../types/api';
import { getMyLimits, getPublicPlans } from '../api/plans';
import { monthlyHoursLabel } from '../lib/planCopy';

/** Share of the included hours at which the nudge appears. */
export const NUDGE_FROM = 0.8;

/**
 * The nearest paid monthly plan above `currentKey` (public plans arrive sorted by sort order) that includes more
 * hours, or null when the account is on the top plan. Names, hours and prices all come from the plans table.
 */
export function nextPlanWithMoreHours(plans: PublicPlan[], currentKey: string, includedHours: number): PublicPlan | null {
  const monthly = plans.filter((p) => p.kind === 'monthly');
  const i = monthly.findIndex((p) => p.key === currentKey);
  if (i < 0) return null;
  return (
    monthly.slice(i + 1).find((p) => (p.priceInr ?? 0) > 0 && (p.includedHoursPerMonth === null || p.includedHoursPerMonth > includedHours)) ?? null
  );
}

/** A slim banner shown once 80% of the month's included hours are used. Renders nothing for unlimited or top-plan accounts. */
export function UpgradeNudge({ account }: { account: Account }) {
  const [state, setState] = useState<{ limits: EffectiveLimits; plans: PublicPlan[] } | null>(null);
  useEffect(() => {
    Promise.all([getMyLimits(), getPublicPlans()]).then(([limits, plans]) => setState({ limits, plans })).catch(() => {});
  }, []);
  if (!state || state.limits.includedHours === null || state.limits.includedHours <= 0) return null;
  const included = state.limits.includedHours;
  const used = Number(account.streamHourUsageCurrentPeriod);
  if (!(used / included >= NUDGE_FROM)) return null;
  const next = nextPlanWithMoreHours(state.plans, state.limits.planKey, included);
  if (!next) return null;
  const fmt = (n: number) => String(Math.round(n * 10) / 10);
  return (
    <div className="upgrade-nudge" role="status" aria-label="Upgrade suggestion" data-testid="upgrade-nudge">
      <span>
        You've used {fmt(used)} of {fmt(included)} hours this month. {next.name} (₹{next.priceInr}/mo) gives you{' '}
        {monthlyHoursLabel(next, 'hours')}.
      </span>
      <Link to="/billing" className="upgrade-nudge-link">Upgrade</Link>
    </div>
  );
}
