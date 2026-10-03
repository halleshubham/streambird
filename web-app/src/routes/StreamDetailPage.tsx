import { useCallback, useEffect, useState } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { Clapperboard, ExternalLink, RotateCw } from 'lucide-react';
import { getStream, getStreamStatus, retryDestination } from '../api/streams';
import { listConnections } from '../api/connections';
import { PlatformBadge } from '../components/PlatformBadge';
import { BirdLoader } from '../components/BirdLoader';
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

  if (error) return <p className="error">{error}</p>;
  if (!stream) return <BirdLoader loading compact label="Loading stream…" />;

  // Normalize to one shape regardless of whether the live status poll has
  // landed yet -- Destination (from the plain GET) has no platformStatus,
  // StreamStatusDestination (from the status poll) does.
  const destinations =
    status?.destinations ??
    stream.destinations.map((d) => ({ ...d, platformStatus: null as string | null }));
  const canOpenStudio = stream.status === 'live' || stream.status === 'scheduled';

  // A deliberately scheduled stream that hasn't started: the schedule panel
  // (time, guests, invitation, start/cancel) replaces the live-stream view.
  if (stream.isScheduledEvent && stream.status === 'scheduled') {
    const failures = justScheduled?.emailFailures ?? [];
    const warnings = justScheduled?.platformWarnings ?? [];
    return (
      <div className="stream-detail-page">
        <div className="section-header">
          <h1>{stream.title}</h1>
          <span><span className="status-dot status-scheduled" /> Scheduled</span>
        </div>
        <ScheduledStreamPanel
          streamId={stream.id}
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

  return (
    <div className="stream-detail-page">
      <div className="section-header">
        <h1>{stream.title}</h1>
        <span className={`status-dot status-${stream.status}`} /> {stream.cancelledAt ? 'Cancelled' : STATUS_LABELS[stream.status]}
      </div>

      {stream.visibility && (
        <p className="empty-state">Visibility: {stream.visibility}</p>
      )}

      {canOpenStudio && (
        <Link to={`/streams/${stream.id}/studio`} className="icon-btn icon-btn--accent" style={{ display: 'inline-flex', marginBottom: 16 }}>
          <Clapperboard size={16} /> Open studio
        </Link>
      )}

      <h2>Destinations</h2>
      <div className="connection-list">
        {destinations.map((d) => {
          const connection = connectionById.get(d.platformConnectionId);
          const platformStatus = d.platformStatus;
          return (
            <div key={d.id} className="destination-detail-row">
              <div className="destination-detail-main">
                {connection && <PlatformBadge platform={connection.platform} />}
                {connection && <span className="connection-label">{connection.label}</span>}
                <span className={`status-dot status-${d.status}`} />
                <span>{d.status}</span>
                {platformStatus && (
                  <span className="empty-state">platform reports: {platformStatus}</span>
                )}
                {d.viewerCount !== null && <span className="empty-state">{d.viewerCount} viewers</span>}
              </div>
              <div className="destination-detail-actions">
                {d.watchUrl && (
                  <a href={d.watchUrl} target="_blank" rel="noopener noreferrer" className="icon-btn icon-btn--small">
                    <ExternalLink size={14} /> Watch
                  </a>
                )}
                {d.status === 'failed' && (
                  <button
                    type="button"
                    className="icon-btn icon-btn--small"
                    disabled={retryingId === d.id}
                    onClick={() => void handleRetry(d.id)}
                  >
                    <RotateCw size={14} /> {retryingId === d.id ? 'Retrying…' : 'Retry'}
                  </button>
                )}
              </div>
              {d.errorMessage && <p className="error">{d.errorMessage}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
