import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { listConnections } from '../api/connections';
import { createStream } from '../api/streams';
import { PlatformBadge } from '../components/PlatformBadge';
import { ApiError } from '../api/client';
import type { PlatformConnection } from '../types/api';

export function CreateStreamPage() {
  const [connections, setConnections] = useState<PlatformConnection[] | null>(null);
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listConnections().then(setConnections);
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (selected.size === 0) {
      setError('Pick at least one destination.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const stream = await createStream({
        title: title.trim() || 'Untitled stream',
        destinationConnectionIds: [...selected],
      });
      // The studio compositor is a separate static app (web/host.html),
      // reached by a full page navigation -- not (yet) ported into this
      // SPA. See the implementation plan's "Studio Reachability" section.
      window.location.href = `/studio/host.html?streamId=${stream.id}`;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create stream.');
      setBusy(false);
    }
  }

  if (connections !== null && connections.length === 0) {
    return (
      <div>
        <h1>Create a stream</h1>
        <p className="empty-state">
          Connect at least one platform before creating a stream. <Link to="/connections">Connect one</Link>.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>Create a stream</h1>
      <form onSubmit={handleSubmit} className="create-stream-form">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled stream"
        />

        <label>Destinations</label>
        {!connections ? (
          <p>Loading…</p>
        ) : (
          <div className="destination-checkboxes">
            {connections.map((c) => (
              <label key={c.id} className="destination-checkbox">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <PlatformBadge platform={c.platform} />
                {c.label}
              </label>
            ))}
          </div>
        )}

        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create and open studio'}
        </button>
      </form>
    </div>
  );
}
