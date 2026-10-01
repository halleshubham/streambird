import { useEffect, useState } from 'react';
import * as superadminApi from '../../api/superadmin';
import { ApiError } from '../../api/client';
import { UsageBar } from '../../components/UsageMeter';
import { BirdLoader } from '../../components/BirdLoader';
import type { AnalyticsOverview, LiveStreamRow, UsageAlert } from '../../types/api';

// A legitimate broadcast running this long is rare -- past this, a stream
// still marked LIVE is more likely a hung row (host's browser closed/
// crashed without ever reconnecting) than a real marathon stream. Purely
// a visual flag for the superadmin to look twice at, not an automatic cutoff.
const LIKELY_STUCK_HOURS = 4;

function formatLiveDuration(startedAt: string | null, now: number): string {
  if (!startedAt) return 'not yet started';
  const ms = now - new Date(startedAt).getTime();
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

/** Live-stream activity snapshot + usage/overage alerts. Shell/nav is
 * AdminShell (see App.tsx). Thresholds for usage alerts (80% near_limit,
 * 100% over_limit) mirror PRICING.md's overage-handling recommendation --
 * see SuperadminAnalyticsService server-side. */
export function AdminAnalyticsPage() {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [alerts, setAlerts] = useState<UsageAlert[] | null>(null);
  const [liveStreams, setLiveStreams] = useState<LiveStreamRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);
  // Re-renders the live-duration column once a minute so "Live for" and
  // the "Possibly stuck" flag actually tick forward on their own, rather
  // than only updating whenever something else happens to re-render the
  // page -- also keeps Date.now() out of the render body itself.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  function load() {
    return Promise.all([
      superadminApi.getAnalyticsOverview(),
      superadminApi.listUsageAlerts(),
      superadminApi.listLiveStreams(),
    ])
      .then(([o, a, l]) => {
        setOverview(o);
        setAlerts(a);
        setLiveStreams(l);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load analytics.'));
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleForceEnd(stream: LiveStreamRow) {
    if (
      !window.confirm(
        `Force-end "${stream.title}" (${stream.accountName})? Only do this if you've confirmed it's actually a hung stream, not a real broadcast still in progress.`,
      )
    ) {
      return;
    }
    setEndingId(stream.id);
    try {
      await superadminApi.forceEndStream(stream.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to end that stream.');
    } finally {
      setEndingId(null);
    }
  }

  if (error) {
    return <p className="error">{error}</p>;
  }

  if (!overview || !alerts || !liveStreams) {
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
        <h2>Live streams</h2>
        {liveStreams.length === 0 ? (
          <p className="empty-state">Nothing is currently live.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Title</th>
                  <th>Live for</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {liveStreams.map((s) => {
                  const ms = s.startedAt ? now - new Date(s.startedAt).getTime() : 0;
                  const likelyStuck = ms > LIKELY_STUCK_HOURS * 3_600_000;
                  return (
                    <tr key={s.id}>
                      <td>{s.accountName}</td>
                      <td>{s.title}</td>
                      <td>
                        {formatLiveDuration(s.startedAt, now)}
                        {likelyStuck && (
                          <>
                            {' '}
                            <span className="badge badge-warning">Possibly stuck</span>
                          </>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="danger-button"
                          disabled={endingId !== null}
                          onClick={() => void handleForceEnd(s)}
                        >
                          {endingId === s.id ? 'Ending…' : 'Force end'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Top accounts by usage</h2>
        {overview.topAccountsByUsage.length === 0 ? (
          <p className="empty-state">No accounts yet.</p>
        ) : (
          <div className="table-scroll">
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
          </div>
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
