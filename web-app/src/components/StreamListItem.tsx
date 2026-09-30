import type { StreamListItem as StreamListItemType } from '../types/api';
import { PlatformBadge } from './PlatformBadge';

const STATUS_LABELS: Record<StreamListItemType['status'], string> = {
  scheduled: 'Scheduled',
  live: 'Live',
  ended: 'Ended',
  failed: 'Failed',
};

// A stream detail page doesn't exist yet -- a live/scheduled stream (the
// only ones with anywhere useful to go) opens its studio page directly,
// same as CreateStreamPage's post-create redirect.
export function StreamListItem({ stream }: { stream: StreamListItemType }) {
  const date = stream.startedAt ?? stream.scheduledAt ?? stream.createdAt;
  const canOpenStudio = stream.status === 'live' || stream.status === 'scheduled';

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

  if (!canOpenStudio) {
    return <div className={`stream-list-item status-${stream.status}`}>{content}</div>;
  }

  return (
    <a
      href={`/studio/host.html?streamId=${stream.id}`}
      className={`stream-list-item status-${stream.status}`}
    >
      {content}
    </a>
  );
}
