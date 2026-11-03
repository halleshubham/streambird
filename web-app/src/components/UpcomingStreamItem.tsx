import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import type { StreamListItem } from '../types/api';
import { PLATFORM_LABELS } from './PlatformBadge';
import { timeUntil } from '../lib/schedule';
import { Badge, buttonClass } from './ui';

/**
 * One row of the Upcoming list. `variant="full"` (Upcoming page) shows the time column and "Open studio" + "Details";
 * `variant="compact"` (dashboard) shows a date tile and a single "Open" link. Both link to the schedule panel.
 */
export function UpcomingStreamItem({
  stream,
  onDelete,
  variant = 'full',
}: {
  stream: StreamListItem;
  /** When given, an overdue stream shows a Delete button (silent -- no guest emails). */
  onDelete?: (stream: StreamListItem) => void;
  variant?: 'full' | 'compact';
}) {
  if (!stream.scheduledAt) return null;
  const when = new Date(stream.scheduledAt);
  const { label, overdue } = timeUntil(stream.scheduledAt);
  const guests = stream.guestCount ?? 0;
  const destinations = [...new Set(stream.destinationsSummary.map((d) => PLATFORM_LABELS[d.platform] ?? d.platform))].join(', ');
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const guestText = guests === 0 ? 'No guests' : `${guests} ${guests === 1 ? 'guest' : 'guests'} invited`;

  return (
    <li className="ha-up-row">
      {variant === 'compact' ? (
        <div className="ha-date" aria-hidden="true">
          <small>{when.toLocaleDateString(undefined, { month: 'short' })}</small>
          <b>{when.getDate()}</b>
        </div>
      ) : (
        <span className="ha-up-time">{time}</span>
      )}
      <div className="ha-list-main">
        <h3 className="stream-title">{stream.title}</h3>
        <p className="stream-date">
          {variant === 'compact' ? `${time} · ` : ''}
          {[destinations, guestText].filter(Boolean).join(' · ')}
        </p>
      </div>
      {variant === 'full' && <Badge tone={overdue ? 'warning' : 'scheduled'}>{label}</Badge>}
      <div className="ha-list-actions">
        {variant === 'full' && (
          <Link to={`/streams/${stream.id}/studio`} className={buttonClass('secondary')} aria-label={`Open studio for ${stream.title}`}>
            Open studio
          </Link>
        )}
        <Link
          to={`/streams/${stream.id}`}
          className={variant === 'full' ? 'ha-quiet' : buttonClass('secondary')}
          aria-label={variant === 'full' ? `Details for ${stream.title}` : `Open ${stream.title}`}
        >
          {variant === 'full' ? 'Details' : 'Open'}
        </Link>
        {overdue && onDelete && (
          <button
            type="button"
            className="ha-quiet ha-quiet--danger upcoming-delete"
            onClick={() => onDelete(stream)}
            title="Delete this overdue stream (guests are not emailed)"
            aria-label={`Delete ${stream.title}`}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}
