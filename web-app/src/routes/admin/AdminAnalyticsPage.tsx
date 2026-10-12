import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as superadminApi from '../../api/superadmin';
import { ApiError } from '../../api/client';
import { UsageBar } from '../../components/UsageMeter';
import { BirdLoader } from '../../components/BirdLoader';
import type { AnalyticsOverview, LiveStreamRow, UsageAlert } from '../../types/api';
import { BirdBusy } from '../../components/BirdBusy';
import { Badge, DataTable, Empty, PageHeader, Section, planLabel } from '../../components/admin/adminKit';

const TOP_ROWS = 10;

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
  const [refreshing, setRefreshing] = useState(false);
  const [endingId, setEndingId] = useState<string | null>(null);
  // Result of the last Force end: shown above the table, so a failure never replaces the page and the row stays to retry.
  const [actionNote, setActionNote] = useState<{ text: string; isError: boolean } | null>(null);
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
    setActionNote(null);
    try {
      await superadminApi.forceEndStream(stream.id);
      setActionNote({ text: `Ended "${stream.title}" (${stream.accountName}).`, isError: false });
      await load();
    } catch (err) {
      setActionNote({
        text: `Could not end "${stream.title}": ${err instanceof ApiError ? err.message : 'the request failed. Try again, and check your connection.'}`,
        isError: true,
      });
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

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const failurePct = overview.destinationFailureRate * 100;

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="What is live right now, who is close to their hours, and how destinations are doing."
        actions={
          <button type="button" className="btn-sm btn-ghost" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing && <BirdBusy />} Refresh
          </button>
        }
      />

      <div className="admin-stats">
        <StatCard label="Currently live" value={overview.currentlyLive} />
        <StatCard label="Streams today" value={overview.streamsToday} />
        <StatCard label="Streams this week" value={overview.streamsThisWeek} />
        <StatCard label="Destination failure rate (7d)" value={`${failurePct.toFixed(1)}%`} tone={failurePct >= 10 ? 'danger' : failurePct >= 3 ? 'warning' : undefined} />
      </div>

      <Section title="Live streams">
        {actionNote && (
          <p className={actionNote.isError ? 'error' : 'success'} role={actionNote.isError ? 'alert' : 'status'} data-testid="force-end-note">
            {actionNote.text}
          </p>
        )}
        {liveStreams.length === 0 ? (
          <Empty>Nothing is currently live.</Empty>
        ) : (
          <>
            <DataTable caption="Live streams" tall>
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Title</th>
                  <th scope="col">Live for</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {liveStreams.map((s) => {
                  const ms = s.startedAt ? now - new Date(s.startedAt).getTime() : 0;
                  const likelyStuck = ms > LIKELY_STUCK_HOURS * 3_600_000;
                  return (
                    <tr key={s.id}>
                      <td><Link to={`/admin/accounts/${s.accountId}`} className="admin-link">{s.accountName}</Link></td>
                      <td>{s.title}</td>
                      <td className="nowrap">
                        {formatLiveDuration(s.startedAt, now)}
                        {likelyStuck && (
                          <>
                            {' '}
                            <Badge tone="warning">Possibly stuck</Badge>
                          </>
                        )}
                      </td>
                      <td className="actions">
                        <button
                          type="button"
                          className="btn-sm danger-button"
                          disabled={endingId !== null}
                          aria-label={`Force end ${s.title}`}
                          onClick={() => void handleForceEnd(s)}
                        >
                          {endingId === s.id ? <BirdBusy /> : null} {endingId === s.id ? 'Ending…' : 'Force end'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          </>
        )}
      </Section>

      <Section title="Usage alerts" hint="Accounts at 80% of their included hours or more.">
        {alerts.length === 0 ? (
          <Empty>No accounts are near or over their included hours.</Empty>
        ) : (
          <div className="usage-alert-list">
            {alerts.map((a) => (
              <UsageAlertRow key={a.accountId} alert={a} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Top accounts by usage">
        {overview.topAccountsByUsage.length === 0 ? (
          <Empty>No accounts yet.</Empty>
        ) : (
          <DataTable caption="Top accounts by usage">
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col">Plan</th>
                <th scope="col" className="num">Hours used</th>
                <th scope="col" className="num">Included</th>
              </tr>
            </thead>
            <tbody>
              {overview.topAccountsByUsage.slice(0, TOP_ROWS).map((a) => {
                const included = Number(a.includedHoursPerMonth);
                return (
                  <tr key={a.accountId}>
                    <td><Link to={`/admin/accounts/${a.accountId}`} className="admin-link">{a.accountName}</Link></td>
                    <td>{planLabel(a.currentTier)}</td>
                    <td className="num">{Number(a.streamHourUsageCurrentPeriod).toFixed(1)}</td>
                    <td className="num">{included > 0 ? included.toFixed(1) : 'Unlimited'}</td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Section>
    </>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number | string; tone?: 'warning' | 'danger' }) {
  return (
    <div className="stat-card">
      <span className={`stat-card-value${tone ? ` stat-card-value--${tone}` : ''}`}>{value}</span>
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
        <Link to={`/admin/accounts/${alert.accountId}`} className="usage-alert-account admin-link">
          {alert.accountName} <span className="usage-alert-tier">({planLabel(alert.currentTier)})</span>
        </Link>
        <Badge tone={isOverLimit ? 'danger' : 'warning'}>
          {isOverLimit ? 'Over limit' : 'Near limit'} · {(alert.ratio * 100).toFixed(0)}%
        </Badge>
      </div>
      <UsageBar used={used} included={included} />
    </div>
  );
}
