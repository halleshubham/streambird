import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Trash2, Plug, SquarePlay } from 'lucide-react';
import {
  listConnections,
  connectTwitchManual,
  removeConnection,
  listFacebookPendingPages,
  selectFacebookPage,
} from '../api/connections';
import { PlatformBadge } from '../components/PlatformBadge';
import { ApiError } from '../api/client';
import type { PlatformConnection } from '../types/api';

const OAUTH_NOTICE_ERRORS: Record<string, string> = {
  youtube_oauth_failed: "Connecting YouTube failed. Please try again.",
  youtube_no_channel: "That Google account doesn't have a YouTube channel to connect.",
  facebook_oauth_failed: 'Connecting Facebook failed. Please try again.',
  facebook_no_pages: "That Facebook account doesn't manage any Pages to connect.",
};

export function ConnectionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [connections, setConnections] = useState<PlatformConnection[] | null>(null);
  const [label, setLabel] = useState('');
  const [ingestServerUrl, setIngestServerUrl] = useState('');
  const [streamKey, setStreamKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthNotice, setOauthNotice] = useState<{ text: string; isError: boolean } | null>(
    () => {
      const err = searchParams.get('error');
      if (err && OAUTH_NOTICE_ERRORS[err]) {
        return { text: OAUTH_NOTICE_ERRORS[err], isError: true };
      }
      const connected = searchParams.get('connected');
      if (connected === 'youtube' || connected === 'facebook') {
        return { text: `${connected === 'youtube' ? 'YouTube' : 'Facebook'} connected.`, isError: false };
      }
      return null;
    },
  );
  const [facebookPendingPages, setFacebookPendingPages] = useState<{ id: string; name: string }[] | null>(null);
  const [selectingPageId, setSelectingPageId] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get('facebookPagesPending') === '1') {
      listFacebookPendingPages()
        .then((pages) => {
          if (pages.length === 0) {
            // The pending-pages cookie (10 min lifetime) has expired, or
            // this URL was revisited later -- nothing left to pick, so
            // drop back to the plain "Connect Facebook" button instead of
            // leaving the page stuck showing an empty picker forever.
            setSearchParams({}, { replace: true });
            setOauthNotice({ text: 'That Facebook sign-in expired. Please connect again.', isError: true });
            return;
          }
          setFacebookPendingPages(pages);
        })
        .catch(() => setOauthNotice({ text: 'Could not load your Facebook Pages. Please try connecting again.', isError: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cancelFacebookPageSelection() {
    setFacebookPendingPages(null);
    setSearchParams({}, { replace: true });
  }

  async function handleSelectFacebookPage(pageId: string) {
    setSelectingPageId(pageId);
    try {
      await selectFacebookPage(pageId);
      setFacebookPendingPages(null);
      setOauthNotice({ text: 'Facebook connected.', isError: false });
      setSearchParams({}, { replace: true });
      refresh();
    } catch (err) {
      setOauthNotice({ text: err instanceof ApiError ? err.message : 'Failed to connect that Facebook Page.', isError: true });
    } finally {
      setSelectingPageId(null);
    }
  }

  useEffect(() => {
    // Clear connect/error query params from the URL once shown, so a page
    // refresh doesn't keep re-displaying a stale notice.
    if (searchParams.get('connected') || searchParams.get('error')) {
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      {oauthNotice && <p className={oauthNotice.isError ? 'error' : 'success'}>{oauthNotice.text}</p>}

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
        <h2>Connect YouTube</h2>
        <p>
          Connect a YouTube channel to schedule and go live directly from StreamBird. This
          requests the YouTube scope on your Google account, separate from any "Sign in with
          Google" login you may already use.
        </p>
        <a
          className="button-like icon-btn"
          style={{ display: 'inline-flex', width: 'auto' }}
          href="/api/platform-connections/youtube/connect"
        >
          <SquarePlay size={16} /> Connect YouTube
        </a>
      </section>

      <section>
        <h2>Connect Facebook</h2>
        <p>
          Connect a Facebook Page to go live there directly from StreamBird. This requests
          permission to post live video as a Page you manage -- a personal profile can't be
          connected, only Pages.
        </p>
        {facebookPendingPages && facebookPendingPages.length > 0 ? (
          <div className="connect-form">
            <p>Choose which Facebook Page to connect:</p>
            {facebookPendingPages.map((p) => (
              <button
                key={p.id}
                type="button"
                className="icon-btn"
                disabled={selectingPageId !== null}
                onClick={() => void handleSelectFacebookPage(p.id)}
              >
                <Plug size={16} /> {selectingPageId === p.id ? 'Connecting…' : p.name}
              </button>
            ))}
            <button type="button" className="link-button" disabled={selectingPageId !== null} onClick={cancelFacebookPageSelection}>
              Cancel / start over
            </button>
          </div>
        ) : (
          <a
            className="button-like icon-btn"
            style={{ display: 'inline-flex', width: 'auto' }}
            href="/api/platform-connections/facebook/connect"
          >
            <Plug size={16} /> Connect Facebook
          </a>
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
        <p className="empty-state">LinkedIn Live is coming soon.</p>
      </section>
    </div>
  );
}
