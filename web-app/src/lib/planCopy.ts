import type { PublicPlan } from '../types/api';

/** Plans with this many included hours or more are described as "fair use" (200 h/mo on Pro and Business). */
const FAIR_USE_FROM_HOURS = 100;

/** The streaming-time line for a monthly plan, shared by the home page and the Billing page so they never disagree. */
export function monthlyHoursLabel(p: Pick<PublicPlan, 'includedHoursPerMonth'>, unit = 'stream-hours/mo'): string {
  if (p.includedHoursPerMonth === null) return 'Unlimited streaming (fair use)';
  const hours = Number(p.includedHoursPerMonth);
  return `${hours} ${unit}${hours >= FAIR_USE_FROM_HOURS ? ' (fair use)' : ''}`;
}
