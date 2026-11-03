import { Link } from 'react-router-dom';
import type { StreamListItem as StreamListItemType } from '../types/api';
import { PLATFORM_LABELS } from './PlatformBadge';
import { Badge, buttonClass } from './ui';
import type { BadgeTone } from './ui';

const STATUS_LABELS: Record<StreamListItemType['status'], string> = {
  scheduled: 'Scheduled',
  live: 'Live',
  ended: 'Ended',
  failed: 'Failed',
};

const STATUS_TONE: Record<StreamListItemType['status'], BadgeTone> = {
  scheduled: 'scheduled',
  live: 'live',
  ended: 'ended',
  failed: 'warning',
};

/** "Oct 31 · 1 h 12 min" -- how long a finished stream ran, when both ends are known. */
function runLength(s: StreamListItemType): string | null {
  if (!s.startedAt || !s.endedAt) return null;
  const mins = Math.max(0, Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60_000));
  if (mins < 1) return 'under a minute';
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
}

// Every stream links to its detail page (destinations, real platform
// status, watch URLs) -- that page itself offers an "Open studio" button
// when the stream is live/scheduled, rather than this list item having two
// different link targets depending on status.
export function StreamListItem({ stream }: { stream: StreamListItemType }) {
  const date = new Date(stream.startedAt ?? stream.scheduledAt ?? stream.createdAt);
  const destinations = [...new Set(stream.destinationsSummary.map((d) => PLATFORM_LABELS[d.platform] ?? d.platform))].join(', ');
  const length = runLength(stream);
  const meta = [date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), length, destinations].filter(Boolean).join(' · ');
  const label = stream.cancelledAt ? 'Cancelled' : STATUS_LABELS[stream.status];

  return (
    <li className={`stream-list-item ha-stream-row status-${stream.status}`}>
      <div className="ha-list-main">
        <h3 className="stream-title">{stream.title}</h3>
        <p className="stream-date" title={date.toLocaleString()}>
          {meta}
        </p>
      </div>
      <Badge tone={stream.cancelledAt ? 'neutral' : STATUS_TONE[stream.status]} dot={stream.status === 'live' && !stream.cancelledAt}>
        {label}
      </Badge>
      <Link to={`/streams/${stream.id}`} className={buttonClass('secondary', 'md')} aria-label={`View ${stream.title}`}>
        View
      </Link>
    </li>
  );
}
