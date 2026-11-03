import { useCallback, useEffect, useState } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { Clapperboard, ExternalLink, RotateCw } from 'lucide-react';
import { getStream, getStreamStatus, retryDestination } from '../api/streams';
import { listConnections } from '../api/connections';
import { PLATFORM_LABELS } from '../components/PlatformBadge';
import { PageHeader, PlatformTile } from '../components/host/HostKit';
import { Badge, Button, Card, EmptyState, buttonClass } from '../components/ui';
import type { BadgeTone } from '../components/ui';
import { BirdLoader } from '../components/BirdLoader';
import { LiveThumbnailPanel } from '../components/LiveThumbnailPanel';
import { ScheduledStreamPanel } from '../components/ScheduledStreamPanel';
import { ApiError } from '../api/client';
import type { PlatformConnection, Stream, StreamStatusResponse } from '../types/api';

const STATUS_LABELS: Record<Stream['status'], string> = {
  scheduled: 'Scheduled',
  live: 'Live',
  ended: 'Ended',
  failed: 'Failed',
};

// StreamsService.getStatus polls each provider for its OWN real lifecycle
// status (e.g. YouTube's created/ready/testing/live/complete) -- while
// polling matters, auto-refresh every 10s so a destination that's
// configured-but-not-yet-receiving-data (StreamBird says LIVE, the
// platform says "testing") visibly catches up once real data arrives.
const STATUS_POLL_MS = 10_000;

export function StreamDetailPage() {
  const { streamId } = useParams<{ streamId: string }>();
  const location = useLocation();
  const justScheduled = (location.state as { justScheduled?: boolean; emailFailures?: string[]; platformWarnings?: string[] } | null) ?? null;
  const [stream, setStream] = useState<Stream | null>(null);
  const [status, setStatus] = useState<StreamStatusResponse | null>(null);
  const [connectionById, setConnectionById] = useState<Map<string, PlatformConnection>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const refreshStatus = useCallback(() => {
    if (!streamId) return;
    getStreamStatus(streamId).then(setStatus).catch(() => {
      // Best-effort -- a failed poll just leaves the last known status
      // on screen rather than erroring the whole page.
    });
  }, [streamId]);

  useEffect(() => {
    if (!streamId) return;
    Promise.all([getStream(streamId), listConnections()])
      .then(([s, conns]) => {
        setStream(s);
        setConnectionById(new Map(conns.map((c) => [c.id, c])));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load stream.'));
    refreshStatus();
  }, [streamId, refreshStatus]);

  useEffect(() => {
    if (stream?.status !== 'live') return;
    const interval = setInterval(refreshStatus, STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, [stream?.status, refreshStatus]);

  async function handleRetry(destinationId: string) {
    if (!streamId) return;
    setRetryingId(destinationId);
    try {
      await retryDestination(streamId, destinationId);
      refreshStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Retry failed.');
    } finally {
      setRetryingId(null);
    }
  }

  if (error && !stream) {
    return (
      <div className="ha-page">
        <EmptyState
          tone="error"
          title="We couldn't load this stream"
          action={
            <Link to="/dashboard" className={buttonClass('secondary')}>
              Back to dashboard
            </Link>
          }
        >
          {error}
        </EmptyState>
      </div>
    );
  }
  if (!stream) return <BirdLoader loading compact label="Loading stream…" />;

  // Normalize to one shape regardless of whether the live status poll has
  // landed yet -- Destination (from the plain GET) has no platformStatus,
  // StreamStatusDestination (from the status poll) does.
  const destinations =
    status?.destinations ??
    stream.destinations.map((d) => ({ ...d, platformStatus: null as string | null }));
  const canOpenStudio = stream.status === 'live' || stream.status === 'scheduled';
  const shape = stream.orientation === 'portrait' ? 'Portrait 9:16' : 'Landscape 16:9';

  // A deliberately scheduled stream that hasn't started: the schedule panel
  // (time, guests, invitation, start/cancel) replaces the live-stream view.
  if (stream.isScheduledEvent && stream.status === 'scheduled') {
    const failures = justScheduled?.emailFailures ?? [];
    const warnings = justScheduled?.platformWarnings ?? [];
    return (
      <div className="ha-page stream-detail-page">
        <PageHeader
          back={<Link to="/streams/upcoming">&larr; Upcoming</Link>}
          title={
            <span className="ha-title-row">
              {stream.title} <Badge tone="scheduled">Scheduled</Badge>
            </span>
          }
        />
        <ScheduledStreamPanel
          streamId={stream.id}
          shapeLabel={shape}
          initialNotice={
            justScheduled?.justScheduled
              ? failures.length > 0 || warnings.length > 0
                ? {
                    text: [
                      'Stream scheduled.',
                      failures.length > 0 ? `We couldn't email: ${failures.join(', ')} (use "Resend").` : '',
                      ...warnings,
                    ]
                      .filter(Boolean)
                      .join(' '),
                    isError: true,
                  }
                : { text: 'Stream scheduled. Invitations were emailed to your guests.', isError: false }
              : null
          }
        />
      </div>
    );
  }

  const statusLabel = stream.cancelledAt ? 'Cancelled' : STATUS_LABELS[stream.status];
  const statusTone: BadgeTone = stream.cancelledAt ? 'neutral' : stream.status === 'live' ? 'live' : stream.status === 'scheduled' ? 'scheduled' : stream.status === 'ended' ? 'ended' : 'warning';
  const meta = [
    shape,
    stream.visibility ? `Visibility: ${stream.visibility}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="ha-page stream-detail-page">
      <PageHeader
        back={<Link to="/dashboard">&larr; Dashboard</Link>}
        title={
          <span className="ha-title-row">
            {stream.title}{' '}
            <Badge tone={statusTone} dot={stream.status === 'live' && !stream.cancelledAt}>
              {statusLabel}
            </Badge>
          </span>
        }
        subtitle={meta}
        actions={
          canOpenStudio ? (
            <Link to={`/streams/${stream.id}/studio`} className={buttonClass('primary')}>
              <Clapperboard size={16} aria-hidden="true" /> Open studio
            </Link>
          ) : undefined
        }
      />

      {error && (
        <p className="ha-error" role="alert">
          {error}
        </p>
      )}

      <div className="ha-detail-grid">
        <Card as="section" aria-labelledby="dest-title">
          <div className="ha-section-head" style={{ marginBottom: 0 }}>
            <h2 id="dest-title">Destinations</h2>
            <span className="ha-sm ha-muted">
              {destinations.length} destination{destinations.length === 1 ? '' : 's'}
            </span>
          </div>
          <ul className="ha-list" style={{ marginTop: 8 }}>
            {destinations.map((d) => {
              const connection = connectionById.get(d.platformConnectionId);
              const platformStatus = d.platformStatus;
              const dot = d.status === 'live' ? 'ok' : d.status === 'failed' ? 'bad' : d.status === 'ended' ? '' : 'warn';
              return (
                <li key={d.id} >
                  {connection ? <PlatformTile platform={connection.platform} size={36} /> : <span className={`ha-dot ha-dot--${dot}`} aria-hidden="true" />}
                  <div className="ha-list-main">
                    <h3>{connection ? PLATFORM_LABELS[connection.platform] : 'Destination'}</h3>
                    <p>
                      {connection?.label}
                      {platformStatus ? ` · platform reports: ${platformStatus}` : ''}
                      {d.viewerCount !== null ? ` · ${d.viewerCount} viewers` : ''}
                    </p>
                    {d.errorMessage && <p className="ha-dest-fail">{d.errorMessage}</p>}
                  </div>
                  <span className="ha-dest-status">
                    <span className={`ha-dot ha-dot--${dot}`} aria-hidden="true" /> {d.status}
                  </span>
                  <div className="ha-list-actions">
                    {d.watchUrl && (
                      <a href={d.watchUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'sm')}>
                        <ExternalLink size={14} aria-hidden="true" /> Watch
                      </a>
                    )}
                    {d.status === 'failed' && (
                      <Button variant="secondary" size="sm" busy={retryingId === d.id} icon={<RotateCw size={14} aria-hidden="true" />} onClick={() => void handleRetry(d.id)}>
                        Retry
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        {stream.status === 'live' && <LiveThumbnailPanel streamId={stream.id} />}
      </div>
    </div>
  );
}
