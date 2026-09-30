import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Trash2, Plug } from 'lucide-react';
import { listConnections, connectTwitchManual, removeConnection } from '../api/connections';
import { PlatformBadge } from '../components/PlatformBadge';
import { ApiError } from '../api/client';
import type { PlatformConnection } from '../types/api';

export function ConnectionsPage() {
  const [connections, setConnections] = useState<PlatformConnection[] | null>(null);
  const [label, setLabel] = useState('');
  const [ingestServerUrl, setIngestServerUrl] = useState('');
  const [streamKey, setStreamKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    listConnections().then(setConnections);
  }

  useEffect(refresh, []);

  async function handleConnect(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await connectTwitchManual({
        label: label.trim() || 'Twitch',
        ingestServerUrl: ingestServerUrl.trim(),
        streamKey: streamKey.trim(),
      });
      setLabel('');
      setIngestServerUrl('');
      setStreamKey('');
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to connect Twitch.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(id: string) {
    await removeConnection(id);
    refresh();
  }

  return (
    <div className="connections-page">
      <h1>Connections</h1>

      <section>
        <h2>Connected platforms</h2>
        {!connections ? (
          <p>Loading…</p>
        ) : connections.length === 0 ? (
          <p className="empty-state">No platforms connected yet.</p>
        ) : (
          <ul className="connection-list">
            {connections.map((c) => (
              <li key={c.id}>
                <PlatformBadge platform={c.platform} />
                <span className="connection-label">{c.label}</span>
                <button type="button" className="link-button icon-btn" onClick={() => void handleRemove(c.id)}>
                  <Trash2 size={14} /> Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Connect Twitch</h2>
        <p>
          Twitch doesn't expose your stream key through its API -- copy it from your Twitch
          dashboard (Creator Dashboard → Settings → Stream) and paste it below.
        </p>
        <form onSubmit={handleConnect} className="connect-form">
          <label htmlFor="label">Label</label>
          <input
            id="label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="My Twitch channel"
          />

          <label htmlFor="ingestServerUrl">Ingest server URL</label>
          <input
            id="ingestServerUrl"
            type="text"
            required
            value={ingestServerUrl}
            onChange={(e) => setIngestServerUrl(e.target.value)}
            placeholder="rtmp://live.twitch.tv/app"
          />

          <label htmlFor="streamKey">Stream key</label>
          <input
            id="streamKey"
            type="password"
            required
            value={streamKey}
            onChange={(e) => setStreamKey(e.target.value)}
            placeholder="live_xxxxxxxx"
          />

          {error && <p className="error">{error}</p>}
          <button type="submit" className="icon-btn" disabled={busy || !ingestServerUrl.trim() || !streamKey.trim()}>
            <Plug size={16} /> {busy ? 'Connecting…' : 'Connect'}
          </button>
        </form>
      </section>

      <section>
        <h2>Other platforms</h2>
        <p className="empty-state">YouTube, Facebook, and LinkedIn Live are coming soon.</p>
      </section>
    </div>
  );
}
