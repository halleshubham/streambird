import { Link } from 'react-router-dom';
import { CalendarClock, Users } from 'lucide-react';
import type { StreamListItem } from '../types/api';
import { PlatformBadge } from './PlatformBadge';
import { timeUntil } from '../lib/schedule';

/** One row of the Upcoming list: when, countdown, guests, destinations. Links to the schedule panel. */
export function UpcomingStreamItem({ stream }: { stream: StreamListItem }) {
  if (!stream.scheduledAt) return null;
  const when = new Date(stream.scheduledAt);
  const { label, overdue } = timeUntil(stream.scheduledAt);
  const guests = stream.guestCount ?? 0;

  return (
    <Link to={`/streams/${stream.id}`} className="stream-list-item status-scheduled upcoming-item">
      <div className="stream-list-item-main">
        <CalendarClock size={16} />
        <span className="stream-title">{stream.title}</span>
        <span className={`badge${overdue ? ' badge-warning' : ' badge-accent'}`}>{label}</span>
      </div>
      <div className="stream-list-item-meta">
        <span className="stream-date">
          {when.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </span>
        <span className="upcoming-guests" title="Guests invited by email">
          <Users size={14} /> {guests} {guests === 1 ? 'guest' : 'guests'}
        </span>
        <span className="stream-destinations">
          {stream.destinationsSummary.map((d, i) => (
            <PlatformBadge key={`${d.platform}-${i}`} platform={d.platform} />
          ))}
        </span>
      </div>
    </Link>
  );
}
