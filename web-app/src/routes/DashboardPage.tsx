import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio } from 'lucide-react';
import { getMyAccount } from '../api/accounts';
import { listStreams } from '../api/streams';
import { listConnections } from '../api/connections';
import { listPresets } from '../api/presets';
import { listBrandKits } from '../api/assets';
import { getMyLimits } from '../api/plans';
import { PresetsSection } from '../components/PresetsSection';
import { UpgradeNudge } from '../components/UpgradeNudge';
import { UsageMeter } from '../components/UsageMeter';
import { BirdLoader } from '../components/BirdLoader';
import { StreamListItem } from '../components/StreamListItem';
import { UpcomingStreamItem } from '../components/UpcomingStreamItem';
import { PageHeader } from '../components/host/HostKit';
import { confirmAndDelete } from '../lib/deleteUpcoming';
import { PLATFORM_LABELS } from '../components/PlatformBadge';
import { Card, EmptyState, buttonClass, cx } from '../components/ui';
import type { Account, BrandKit, EffectiveLimits, Platform, PlatformConnection, StreamListItem as StreamListItemType, StreamPreset } from '../types/api';

/** The platforms the Connections card offers a "Connect" row for when none is connected yet. */
const OFFERED: Platform[] = ['youtube', 'facebook', 'twitch'];

export function DashboardPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [connections, setConnections] = useState<PlatformConnection[] | null>(null);
  const [streams, setStreams] = useState<StreamListItemType[] | null>(null);
  const [upcoming, setUpcoming] = useState<StreamListItemType[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Presets are a convenience: if any of these three fail the dashboard still works without the section.
  const [presets, setPresets] = useState<StreamPreset[] | null>(null);
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [limits, setLimits] = useState<EffectiveLimits | null>(null);

  useEffect(() => {
    Promise.all([listPresets(), listBrandKits().catch(() => [] as BrandKit[]), getMyLimits().catch(() => null)])
      .then(([p, k, l]) => {
        setPresets(p);
        setKits(k);
        setLimits(l);
      })
      .catch(() => setPresets(null));
  }, []);

  useEffect(() => {
    Promise.all([getMyAccount(), listConnections(), listStreams(10, 0), listStreams(10, 0, 'upcoming')])
      .then(([acc, conns, streamsRes, upcomingRes]) => {
        setAccount(acc);
        setConnections(conns);
        setStreams(streamsRes.items.filter((s) => !(s.isScheduledEvent && s.status === 'scheduled')));
        setUpcoming(upcomingRes.items);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard.'));
  }, []);

  const loading = !account || !connections || !streams;

  if (error) {
    return (
      <div className="ha-page">
        <EmptyState
          tone="error"
          title="We couldn't load your dashboard"
          action={
            <button type="button" className={buttonClass('secondary')} onClick={() => window.location.reload()}>
              Try again
            </button>
          }
        >
          {error}
        </EmptyState>
      </div>
    );
  }

  if (loading) {
    return <BirdLoader loading compact label="Loading your dashboard…" />;
  }

  const hasConnections = connections.length > 0;

  if (!hasConnections) {
    return (
      <div className="ha-page dashboard">
        <PageHeader title="Welcome to StreamBird" subtitle="Two quick steps and you can go live to every platform at once." />
        <section className="ha-hero" aria-labelledby="first-run-title">
          <div className="ha-hero-main">
            <h2 id="first-run-title">Connect where you stream</h2>
            <p>Link YouTube, Facebook or Twitch once. After that, going live is one tap.</p>
            <div className="ha-hero-actions">
              <Link to="/connections" className={buttonClass('primary', 'lg')}>
                Connect a platform
              </Link>
              <Link to="/connections#rtmp" className="ha-hero-link">
                Use a custom RTMP address
              </Link>
            </div>
          </div>
          <ol className="ha-steps" aria-label="Setup steps">
            <li>
              <span className="ha-step-n">1</span>
              <span>Connect a platform</span>
            </li>
            <li>
              <span className="ha-step-n">2</span>
              <span>Save your first preset</span>
            </li>
            <li>
              <span className="ha-step-n">3</span>
              <span>Go live</span>
            </li>
          </ol>
        </section>

        <section aria-labelledby="presets-title">
          <h2 id="presets-title" style={{ marginBottom: 16 }}>
            Ready when you are
          </h2>
          <Card>
            <h3 style={{ fontSize: 18 }}>No presets yet</h3>
            <p className="ha-muted" style={{ marginTop: 6 }}>
              A preset remembers your title, destinations and look, so next time you only tap Go live now. Connect a platform first to save one.
            </p>
          </Card>
        </section>

        <div className="ha-dash-grid ha-dash-grid--pair">
          <Card as="section" aria-labelledby="up-title">
            <h3 id="up-title">Upcoming streams</h3>
            <p className="ha-muted ha-sm" style={{ marginTop: 4 }}>
              Nothing scheduled. Connect a platform to schedule one and share a join link with guests.
            </p>
          </Card>
          <Card as="section" aria-labelledby="rc-title">
            <h3 id="rc-title">Recent streams</h3>
            <p className="ha-muted ha-sm" style={{ marginTop: 4 }}>
              Your streams will show up here after you go live.
            </p>
          </Card>
        </div>

        <div className="ha-usage-row">
          <UsageMeter account={account} />
          <UpgradeNudge account={account} />
        </div>
      </div>
    );
  }

  const missing = OFFERED.filter((p) => !connections.some((c) => c.platform === p));

  return (
    <div className="ha-page dashboard">
      <PageHeader
        title="Welcome back"
        subtitle="Pick a preset and you are live in one tap."
        actions={
          <Link to="/streams/new" className={cx(buttonClass('secondary'), 'go-live-cta')}>
            <Radio size={16} aria-hidden="true" /> New stream
          </Link>
        }
      />

      {presets && <PresetsSection connections={connections} kits={kits} limits={limits} presets={presets} onChange={setPresets} />}

      <div className="ha-dash-grid">
        <Card as="section" aria-labelledby="up-title">
          <div className="ha-section-head" style={{ marginBottom: 0 }}>
            <h2 id="up-title">Upcoming streams</h2>
            {upcoming.length > 0 && (
              <Link to="/streams/upcoming" className="ha-quiet">
                See all
              </Link>
            )}
          </div>
          {upcoming.length > 0 ? (
            <ul className="ha-list" style={{ marginTop: 8 }}>
              {upcoming.slice(0, 5).map((s) => (
                <UpcomingStreamItem
                  key={s.id}
                  variant="compact"
                  stream={s}
                  onDelete={(x) => void confirmAndDelete(x, setError).then((ok) => ok && setUpcoming((prev) => prev.filter((u) => u.id !== x.id)))}
                />
              ))}
            </ul>
          ) : (
            <>
              <p className="ha-muted ha-sm" style={{ marginTop: 4 }}>
                Nothing scheduled. Schedule a stream to share a join link with guests.
              </p>
              <Link to="/streams/new" className="ha-quiet" style={{ paddingLeft: 0 }}>
                Schedule a stream
              </Link>
            </>
          )}
        </Card>

        <Card as="section" aria-labelledby="cn-title">
          <div className="ha-section-head" style={{ marginBottom: 0 }}>
            <h2 id="cn-title">Connections</h2>
            <Link to="/connections" className="ha-quiet">
              Manage
            </Link>
          </div>
          <ul className="ha-list" style={{ marginTop: 8 }}>
            {connections.map((c) => (
              <li key={c.id}>
                <span className="ha-dot ha-dot--ok" aria-hidden="true" />
                <span className="ha-b ha-list-main">{PLATFORM_LABELS[c.platform] ?? c.platform}</span>
                <span className="ha-sm ha-muted">Connected</span>
              </li>
            ))}
            {missing.map((p) => (
              <li key={p}>
                <span className="ha-dot" aria-hidden="true" />
                <span className="ha-b ha-list-main">{PLATFORM_LABELS[p]}</span>
                <Link to="/connections" className="ha-quiet" aria-label={`Connect ${PLATFORM_LABELS[p]}`}>
                  Connect
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card as="section" aria-labelledby="recent-title">
        <h2 id="recent-title">Recent streams</h2>
        {streams.length > 0 ? (
          <ul className="ha-list" style={{ marginTop: 8 }}>
            {streams.map((s) => (
              <StreamListItem key={s.id} stream={s} />
            ))}
          </ul>
        ) : (
          <p className="ha-muted ha-sm" style={{ marginTop: 4 }}>
            Your streams will show up here after you go live.
          </p>
        )}
      </Card>

      <div className="ha-usage-row">
        <UsageMeter account={account} />
        <UpgradeNudge account={account} />
      </div>
    </div>
  );
}
