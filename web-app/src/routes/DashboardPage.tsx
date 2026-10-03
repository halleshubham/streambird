import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio } from 'lucide-react';
import { getMyAccount } from '../api/accounts';
import { listStreams } from '../api/streams';
import { listConnections } from '../api/connections';
import { UsageMeter } from '../components/UsageMeter';
import { BirdLoader } from '../components/BirdLoader';
import { StreamListItem } from '../components/StreamListItem';
import { UpcomingStreamItem } from '../components/UpcomingStreamItem';
import { confirmAndDelete } from '../lib/deleteUpcoming';
import { PlatformBadge } from '../components/PlatformBadge';
import type { Account, PlatformConnection, StreamListItem as StreamListItemType } from '../types/api';

export function DashboardPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [connections, setConnections] = useState<PlatformConnection[] | null>(null);
  const [streams, setStreams] = useState<StreamListItemType[] | null>(null);
  const [upcoming, setUpcoming] = useState<StreamListItemType[]>([]);
  const [error, setError] = useState<string | null>(null);

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

      <section>
        <div className="section-header">
          <h2>Connections</h2>
          <Link to="/connections">Manage</Link>
        </div>
        {hasConnections ? (
          <div className="connections-summary">
            {connections.map((c) => (
              <PlatformBadge key={c.id} platform={c.platform} />
            ))}
          </div>
        ) : (
          <p className="empty-state">
            No platforms connected yet. <Link to="/connections">Connect one</Link> before you can go
            live.
          </p>
        )}
      </section>

      <section>
        <div className="section-header">
          <h2>Upcoming streams</h2>
          {upcoming.length > 0 ? <Link to="/streams/upcoming">View all</Link> : null}
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
            Nothing scheduled. {hasConnections ? <Link to="/streams/new">Schedule a stream</Link> : 'Connect a platform to schedule one.'}
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
              <Link to="/streams/new">Create your first stream</Link>
            ) : (
              'Connect a platform to get started.'
            )}
          </p>
        )}
      </section>
    </div>
  );
}
