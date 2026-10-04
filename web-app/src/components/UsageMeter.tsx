import { useEffect, useState } from 'react';
import type { Account, EffectiveLimits } from '../types/api';
import { getMyLimits } from '../api/plans';

/** Compact, color-coded usage bar (green/warning/danger by threshold) for
 * anywhere a numeric used/included pair needs to be scannable at a glance
 * rather than read as plain "X / Y" text -- e.g. a superadmin table row.
 * Thresholds match AdminAnalyticsPage's own near/over-limit buckets (80%/
 * 100%), so a given account reads the same way wherever it's shown. */
export function UsageBar({ used, included, compact = false }: { used: number; included: number; compact?: boolean }) {
  const pct = included > 0 ? Math.min(100, (used / included) * 100) : 0;
  const isOverLimit = included > 0 && used >= included;
  const isNearLimit = included > 0 && used / included >= 0.8;
  const variant = isOverLimit ? 'danger' : isNearLimit ? 'warning' : null;

  return (
    <div className={`usage-meter${compact ? ' usage-meter--compact' : ''}`}>
      <div className="usage-meter-track">
        <div
          className={`usage-meter-fill${variant ? ` usage-meter-fill--${variant}` : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="usage-meter-tier">
        {used.toFixed(1)} / {included.toFixed(1)} hrs
      </p>
    </div>
  );
}

export function UsageMeter({ account }: { account: Account }) {
  const [limits, setLimits] = useState<EffectiveLimits | null>(null);
  useEffect(() => {
    getMyLimits().then(setLimits).catch(() => {});
  }, []);

  const used = Number(account.streamHourUsageCurrentPeriod);
  const unlimited = limits ? limits.includedHours === null : false;
  const included = limits && limits.includedHours !== null ? limits.includedHours : Number(account.includedHoursPerMonth);
  const pct = included > 0 ? Math.min(100, (used / included) * 100) : 0;

  return (
    <div className="usage-meter">
      <div className="usage-meter-header">
        <span>Stream hours this period</span>
        <span>
          {unlimited ? `${used.toFixed(1)} hrs · unlimited` : `${used.toFixed(1)} / ${included.toFixed(1)} hrs`}
        </span>
      </div>
      <div className="usage-meter-track">
        <div className="usage-meter-fill" style={{ width: `${unlimited ? 0 : pct}%` }} />
      </div>
      <p className="usage-meter-tier">
        {limits ? limits.planName : account.currentTier} plan
        {limits && (
          <>
            {' '}· up to {limits.maxDestinations} destination{limits.maxDestinations === 1 ? '' : 's'} · {limits.maxGuests} guest
            {limits.maxGuests === 1 ? '' : 's'}
            {limits.dayPass && <> · {limits.dayPass.name} until {new Date(limits.dayPass.expiresAt).toLocaleString()}</>}
          </>
        )}
      </p>
    </div>
  );
}
