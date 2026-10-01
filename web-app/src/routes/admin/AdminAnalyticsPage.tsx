import { useEffect, useState } from 'react';
import * as superadminApi from '../../api/superadmin';
import { ApiError } from '../../api/client';
import { UsageBar } from '../../components/UsageMeter';
import { BirdLoader } from '../../components/BirdLoader';
import type { AnalyticsOverview, UsageAlert } from '../../types/api';

/** Live-stream activity snapshot + usage/overage alerts. Shell/nav is
 * AdminShell (see App.tsx). Thresholds for usage alerts (80% near_limit,
 * 100% over_limit) mirror PRICING.md's overage-handling recommendation --
 * see SuperadminAnalyticsService server-side. */
export function AdminAnalyticsPage() {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [alerts, setAlerts] = useState<UsageAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([superadminApi.getAnalyticsOverview(), superadminApi.listUsageAlerts()])
      .then(([o, a]) => {
        setOverview(o);
        setAlerts(a);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load analytics.'));
  }, []);

  if (error) {
    return <p className="error">{error}</p>;
  }

  if (!overview || !alerts) {
    return <BirdLoader loading compact label="Loading analytics…" />;
  }

  return (
    <>
      <h1>Analytics</h1>

      <div className="stat-card-row">
        <StatCard label="Streams today" value={overview.streamsToday} />
        <StatCard label="Streams this week" value={overview.streamsThisWeek} />
        <StatCard label="Currently live" value={overview.currentlyLive} />
        <StatCard
          label="Destination failure rate (7d)"
          value={`${(overview.destinationFailureRate * 100).toFixed(1)}%`}
        />
      </div>

      <section>
        <h2>Top accounts by usage</h2>
        {overview.topAccountsByUsage.length === 0 ? (
          <p className="empty-state">No accounts yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Tier</th>
                <th>Stream hours used</th>
                <th>Included hours</th>
              </tr>
            </thead>
            <tbody>
              {overview.topAccountsByUsage.map((a) => (
                <tr key={a.accountId}>
                  <td>{a.accountName}</td>
                  <td>{a.currentTier}</td>
                  <td>{Number(a.streamHourUsageCurrentPeriod).toFixed(1)}</td>
                  <td>{Number(a.includedHoursPerMonth).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Usage alerts</h2>
        {alerts.length === 0 ? (
          <p className="empty-state">No accounts are near or over their included hours.</p>
        ) : (
          <div className="usage-alert-list">
            {alerts.map((a) => (
              <UsageAlertRow key={a.accountId} alert={a} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat-card">
      <span className="stat-card-value">{value}</span>
      <span className="stat-card-label">{label}</span>
    </div>
  );
}

function UsageAlertRow({ alert }: { alert: UsageAlert }) {
  const used = Number(alert.streamHourUsageCurrentPeriod);
  const included = Number(alert.includedHoursPerMonth);
  const isOverLimit = alert.bucket === 'over_limit';

  return (
    <div className="usage-alert-row">
      <div className="usage-alert-row-header">
        <span className="usage-alert-account">
          {alert.accountName} <span className="usage-alert-tier">({alert.currentTier})</span>
        </span>
        <span className={`badge ${isOverLimit ? 'badge-danger' : 'badge-warning'}`}>
          {isOverLimit ? 'Over limit' : 'Near limit'} · {(alert.ratio * 100).toFixed(0)}%
        </span>
      </div>
      <UsageBar used={used} included={included} />
    </div>
  );
}
