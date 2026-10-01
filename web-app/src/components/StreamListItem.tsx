import { Link } from 'react-router-dom';
import type { StreamListItem as StreamListItemType } from '../types/api';
import { PlatformBadge } from './PlatformBadge';

const STATUS_LABELS: Record<StreamListItemType['status'], string> = {
  scheduled: 'Scheduled',
  live: 'Live',
  ended: 'Ended',
  failed: 'Failed',
};

// Every stream links to its detail page (destinations, real platform
// status, watch URLs) -- that page itself offers an "Open studio" button
// when the stream is live/scheduled, rather than this list item having two
// different link targets depending on status.
export function StreamListItem({ stream }: { stream: StreamListItemType }) {
  const date = stream.startedAt ?? stream.scheduledAt ?? stream.createdAt;

  const content = (
    <>
      <div className="stream-list-item-main">
        <span className={`status-dot status-${stream.status}`} />
        <span className="stream-title">{stream.title}</span>
        <span className="stream-status">{STATUS_LABELS[stream.status]}</span>
      </div>
      <div className="stream-list-item-meta">
        <span className="stream-date">{new Date(date).toLocaleString()}</span>
        <span className="stream-destinations">
          {stream.destinationsSummary.map((d, i) => (
            <PlatformBadge key={`${d.platform}-${i}`} platform={d.platform} />
          ))}
        </span>
      </div>
    </>
  );

  return (
    <Link to={`/streams/${stream.id}`} className={`stream-list-item status-${stream.status}`}>
      {content}
    </Link>
  );
}
