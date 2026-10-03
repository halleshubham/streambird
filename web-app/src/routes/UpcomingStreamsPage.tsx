import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import { listStreams } from '../api/streams';
import { BirdLoader } from '../components/BirdLoader';
import { UpcomingStreamItem } from '../components/UpcomingStreamItem';
import { dayHeading } from '../lib/schedule';
import type { StreamListItem } from '../types/api';

export function UpcomingStreamsPage() {
  const [items, setItems] = useState<StreamListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listStreams(100, 0, 'upcoming')
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load upcoming streams.'));
  }, []);

  if (error) return <p className="error">{error}</p>;
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
    <div className="upcoming-page">
      <div className="section-header">
        <h1>Upcoming streams</h1>
        <Link to="/streams/new" className="icon-btn icon-btn--accent">
          <CalendarClock size={16} /> Schedule a stream
        </Link>
      </div>

      {groups.length === 0 ? (
        <p className="empty-state">
          Nothing scheduled yet. <Link to="/streams/new">Schedule a stream</Link> and invite your guests by email.
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.heading}>
            <h2 className="upcoming-day">{g.heading}</h2>
            <div className="stream-list">
              {g.streams.map((s) => (
                <UpcomingStreamItem key={s.id} stream={s} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
