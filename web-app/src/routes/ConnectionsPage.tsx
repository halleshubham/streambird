import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import {
  listConnections,
  connectTwitchManual,
  removeConnection,
  listFacebookPendingPages,
  type FacebookPendingPage,
  selectFacebookPage,
} from '../api/connections';
import { PlatformBadge } from '../components/PlatformBadge';
import { PlatformLogo } from '../components/PlatformLogo';
import { BirdLoader } from '../components/BirdLoader';
import { ApiError } from '../api/client';
import type { PlatformConnection } from '../types/api';
import { BirdBusy } from '../components/BirdBusy';
import { DocsLink } from '../components/DocsLink';

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
  const [removingId, setRemovingId] = useState<string | null>(null);
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
  const [facebookPendingPages, setFacebookPendingPages] = useState<FacebookPendingPage[] | null>(null);
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

  async function handleRemove(id: string, label: string) {
    if (!window.confirm(`Remove the connection "${label}"? StreamBird will revoke its access (for YouTube) and delete the stored credentials. Any stream using it will need to be reconnected before going live again.`)) return;
    setRemovingId(id);
    try {
      await removeConnection(id);
      refresh();
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="connections-page">
      <h1>Connections</h1>
      <p className="docs-hint">
        Need help? <DocsLink page="connect-platforms">How to connect YouTube, Facebook and other platforms</DocsLink>
      </p>

      {oauthNotice && <p className={oauthNotice.isError ? 'error' : 'success'}>{oauthNotice.text}</p>}

      <section>
        <h2>Connected platforms</h2>
        {!connections ? (
          <BirdLoader loading compact label="Loading your connections…" />
        ) : connections.length === 0 ? (
          <p className="empty-state">No platforms connected yet.</p>
        ) : (
          <ul className="connection-list">
            {connections.map((c) => (
              <li key={c.id}>
                <PlatformBadge platform={c.platform} />
                <span className="connection-label">{c.label}</span>
                <button
                  type="button"
                  className="link-button icon-btn"
                  disabled={removingId !== null}
                  onClick={() => void handleRemove(c.id, c.label)}
                >
                  {removingId === c.id ? <BirdBusy /> : <Trash2 size={14} />} Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>
          <PlatformLogo platform="youtube" size={18} /> Connect YouTube
        </h2>
        <p>
          Connect a YouTube channel to schedule and go live directly from StreamBird. This is a
          separate permission from any "Sign in with Google" login you may already use. Google
          will ask you to allow StreamBird to <strong>"See, edit, and permanently delete your
          YouTube videos, ratings, comments and captions"</strong> (the <code>youtube.force-ssl</code>{' '}
          permission), the narrowest permission Google offers that lets an app create and run a
          live broadcast.
        </p>
        <div className="youtube-permission-note" data-testid="youtube-permission-note">
          <p><strong>What StreamBird uses it for</strong></p>
          <ul>
            <li>Create the live broadcast and its stream for your event, and connect the two.</li>
            <li>Update the title, description, privacy, start time and thumbnail you set in StreamBird.</li>
            <li>Start the broadcast when you go live, end it when you end the stream, and read its status so you can see whether it is live.</li>
            <li>Delete a scheduled broadcast that StreamBird created, if you cancel that stream.</li>
            <li>Read your channel's name and picture, so you can see which channel is connected.</li>
          </ul>
          <p>
            <strong>What it never does:</strong> read or post comments, change captions or ratings,
            upload, edit or delete videos you already have, or touch anything except the broadcasts
            StreamBird itself created. Disconnecting a channel here revokes the access with Google.
          </p>
        </div>
        <a
          className="button-like icon-btn"
          style={{ display: 'inline-flex', width: 'auto' }}
          href="/api/platform-connections/youtube/connect"
        >
          <PlatformLogo platform="youtube" /> Connect YouTube
        </a>
      </section>

      <section>
        <h2>
          <PlatformLogo platform="facebook" size={18} /> Connect Facebook
        </h2>
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
                className="icon-btn page-choice"
                disabled={selectingPageId !== null}
                onClick={() => void handleSelectFacebookPage(p.id)}
              >
                {p.pictureUrl ? (
                  <img src={p.pictureUrl} alt="" className="page-choice-pic" referrerPolicy="no-referrer" />
                ) : (
                  <span className="page-choice-pic page-choice-pic--empty">
                    <PlatformLogo platform="facebook" />
                  </span>
                )}
                <span className="page-choice-text">
                  <span className="page-choice-name">{p.name}</span>
                  <span className="page-choice-id">Page ID {p.id}</span>
                </span>
                {selectingPageId === p.id && <BirdBusy />}
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
            <PlatformLogo platform="facebook" /> Connect Facebook
          </a>
        )}
      </section>

      <section>
        <h2>
          <PlatformLogo platform="twitch" size={18} /> Connect Twitch
        </h2>
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
            {busy ? <BirdBusy /> : <PlatformLogo platform="twitch" />} Connect
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
