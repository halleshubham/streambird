import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarPlus, Plug, Radio, Settings2 } from 'lucide-react';
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
import { confirmAndDelete } from '../lib/deleteUpcoming';
import { PlatformBadge } from '../components/PlatformBadge';
import type { Account, BrandKit, EffectiveLimits, PlatformConnection, StreamListItem as StreamListItemType, StreamPreset } from '../types/api';

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
    return <p className="error">{error}</p>;
  }

  if (loading) {
    return <BirdLoader loading compact label="Loading your dashboard…" />;
  }

  const hasConnections = connections.length > 0;

  return (
    <div className="dashboard">
      <UpgradeNudge account={account} />
      <div className="dashboard-top">
        <UsageMeter account={account} />
        <Link
          to="/streams/new"
          className={`go-live-cta ${!hasConnections ? 'disabled' : ''}`}
          aria-disabled={!hasConnections}
          onClick={(e) => {
            if (!hasConnections) e.preventDefault();
          }}
        >
          <Radio size={16} /> Go live
        </Link>
      </div>

      {hasConnections && presets && <PresetsSection connections={connections} kits={kits} limits={limits} presets={presets} onChange={setPresets} />}

      <section>
        <div className="section-header">
          <h2>Connections</h2>
          <Link to="/connections" className="chip-link"><Settings2 size={14} /> Manage</Link>
        </div>
        {hasConnections ? (
          <div className="connections-summary">
            {connections.map((c) => (
              <PlatformBadge key={c.id} platform={c.platform} />
            ))}
          </div>
        ) : (
          <p className="empty-state">
            No platforms connected yet. <Link to="/connections" className="chip-link chip-link--sm"><Plug size={14} /> Connect one</Link> before you can go
            live.
          </p>
        )}
      </section>

      <section>
        <div className="section-header">
          <h2>Upcoming streams</h2>
          {upcoming.length > 0 ? <Link to="/streams/upcoming" className="chip-link">View all <ArrowRight size={14} /></Link> : null}
        </div>
        {upcoming.length > 0 ? (
          <div className="stream-list">
            {upcoming.slice(0, 5).map((s) => (
              <UpcomingStreamItem
                key={s.id}
                stream={s}
                onDelete={(x) => void confirmAndDelete(x, setError).then((ok) => ok && setUpcoming((prev) => prev.filter((u) => u.id !== x.id)))}
              />
            ))}
          </div>
        ) : (
          <p className="empty-state">
            Nothing scheduled. {hasConnections ? <Link to="/streams/new" className="chip-link chip-link--sm"><CalendarPlus size={14} /> Schedule a stream</Link> : 'Connect a platform to schedule one.'}
          </p>
        )}
      </section>

      <section>
        <h2>Recent streams</h2>
        {streams.length > 0 ? (
          <div className="stream-list">
            {streams.map((s) => (
              <StreamListItem key={s.id} stream={s} />
            ))}
          </div>
        ) : (
          <p className="empty-state">
            No streams yet.{' '}
            {hasConnections ? (
              <Link to="/streams/new" className="chip-link chip-link--sm"><Radio size={14} /> Create your first stream</Link>
            ) : (
              'Connect a platform to get started.'
            )}
          </p>
        )}
      </section>
    </div>
  );
}
