import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus } from 'lucide-react';
import { listStreams } from '../api/streams';
import { BirdLoader } from '../components/BirdLoader';
import { UpcomingStreamItem } from '../components/UpcomingStreamItem';
import { PageHeader } from '../components/host/HostKit';
import { dayHeading } from '../lib/schedule';
import { confirmAndDelete } from '../lib/deleteUpcoming';
import { Card, EmptyState, buttonClass } from '../components/ui';
import type { StreamListItem } from '../types/api';

export function UpcomingStreamsPage() {
  const [items, setItems] = useState<StreamListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listStreams(100, 0, 'upcoming')
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load upcoming streams.'));
  }, []);

  const handleDelete = async (stream: StreamListItem) => {
    if (await confirmAndDelete(stream, setError)) setItems((prev) => prev?.filter((s) => s.id !== stream.id) ?? prev);
  };

  if (error && !items) {
    return (
      <div className="ha-page">
        <EmptyState
          tone="error"
          title="We couldn't load your upcoming streams"
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
  if (!items) return <BirdLoader loading compact label="Loading upcoming streams…" />;

  // Soonest first (the API already sorts), bucketed by local calendar day.
  const groups: Array<{ heading: string; streams: StreamListItem[] }> = [];
  for (const s of items) {
    if (!s.scheduledAt) continue;
    const heading = dayHeading(s.scheduledAt);
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) last.streams.push(s);
    else groups.push({ heading, streams: [s] });
  }

  return (
    <div className="ha-page upcoming-page">
      <PageHeader
        title="Upcoming streams"
        subtitle="Scheduled streams, soonest first."
        actions={
          <Link to="/streams/new" className={buttonClass('primary')}>
            <CalendarPlus size={16} aria-hidden="true" /> Schedule a stream
          </Link>
        }
      />

      {error && (
        <p className="ha-error" role="alert">
          {error}
        </p>
      )}

      {groups.length === 0 ? (
        <EmptyState
          icon={<CalendarPlus size={28} />}
          title="Nothing scheduled yet"
          action={
            <Link to="/streams/new" className={buttonClass('primary')}>
              Schedule a stream
            </Link>
          }
        >
          Schedule a stream and invite your guests by email.
        </EmptyState>
      ) : (
        groups.map((g) => (
          <section key={g.heading} className="ha-day" aria-label={g.heading}>
            <h2 className="upcoming-day">{g.heading}</h2>
            <Card style={{ padding: '8px 24px' }}>
              <ul className="ha-list">
                {g.streams.map((s) => (
                  <UpcomingStreamItem key={s.id} stream={s} onDelete={(x) => void handleDelete(x)} />
                ))}
              </ul>
            </Card>
          </section>
        ))
      )}
    </div>
  );
}
