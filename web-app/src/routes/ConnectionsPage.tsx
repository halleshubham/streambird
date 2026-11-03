import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import {
  listConnections,
  connectTwitchManual,
  removeConnection,
  listFacebookPendingPages,
  type FacebookPendingPage,
  selectFacebookPage,
} from '../api/connections';
import { PLATFORM_LABELS } from '../components/PlatformBadge';
import { PlatformLogo } from '../components/PlatformLogo';
import { BirdLoader } from '../components/BirdLoader';
import { ApiError } from '../api/client';
import type { PlatformConnection } from '../types/api';
import { DocsLink } from '../components/DocsLink';
import { Notice, PageHeader, PlatformTile } from '../components/host/HostKit';
import { Button, Card, Input, buttonClass, confirm, toast } from '../components/ui';
import { docsUrl } from '../docs';

const OAUTH_NOTICE_ERRORS: Record<string, string> = {
  youtube_oauth_failed: "Connecting YouTube failed. Please try again.",
  youtube_no_channel: "That Google account doesn't have a YouTube channel to connect.",
  facebook_oauth_failed: 'Connecting Facebook failed. Please try again.',
  facebook_no_pages: "We couldn't find a Facebook Page you manage. In the Facebook dialog choose 'Edit settings' and tick your Page, make sure you're logged in as the Page's admin, then try again.",
};

interface PageNotice {
  text: string;
  isError: boolean;
  /** Set for the "Facebook returned no Page" help, which has its own layout. */
  code?: 'facebook_no_pages';
  /** Which platform a success notice is about, to name the connection in it. */
  platform?: 'youtube' | 'facebook';
}

/** The one permanent link a host shares: opens their live stream while live, their channel/page otherwise. */
function LiveLink({ connection }: { connection: PlatformConnection }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const url = connection.liveLinkUrl;
  if (!url) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url!);
      setFailed(false);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true); // clipboard blocked: the link is selectable text right above, so nothing is lost
    }
  }

  return (
    <div className="ha-live-link live-link" data-testid="live-link">
      <div className="ha-row live-link-row">
        <code className="live-link-url ha-list-main">{url}</code>
        <Button variant="secondary" size="sm" aria-label={`Copy live link for ${connection.label}`} icon={copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="ha-hint live-link-hint">
        Share this one link. It opens your live stream when you are live, and your channel otherwise.
        {failed && ' Copy did not work here; select the link above and copy it.'}
      </p>
    </div>
  );
}

export function ConnectionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hash } = useLocation();
  const [connections, setConnections] = useState<PlatformConnection[] | null>(null);
  const [label, setLabel] = useState('');
  const [ingestServerUrl, setIngestServerUrl] = useState('');
  const [streamKey, setStreamKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [oauthNotice, setOauthNotice] = useState<PageNotice | null>(() => {
    const err = searchParams.get('error');
    if (err && OAUTH_NOTICE_ERRORS[err]) {
      return { text: OAUTH_NOTICE_ERRORS[err], isError: true, code: err === 'facebook_no_pages' ? 'facebook_no_pages' : undefined };
    }
    const connected = searchParams.get('connected');
    if (connected === 'youtube' || connected === 'facebook') {
      return { text: `${connected === 'youtube' ? 'YouTube' : 'Facebook'} connected.`, isError: false, platform: connected };
    }
    return null;
  });
  const [facebookPendingPages, setFacebookPendingPages] = useState<FacebookPendingPage[] | null>(null);
  const [chosenPageId, setChosenPageId] = useState<string | null>(null);
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
          setChosenPageId(pages[0].id);
        })
        .catch(() => setOauthNotice({ text: 'Could not load your Facebook Pages. Please try connecting again.', isError: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "#rtmp" links from other pages (dashboard, new stream) land on the custom RTMP card.
  useEffect(() => {
    if (hash === '#rtmp') document.getElementById('rtmp')?.scrollIntoView({ block: 'start' });
  }, [hash, connections]);

  function cancelFacebookPageSelection() {
    setFacebookPendingPages(null);
    setSearchParams({}, { replace: true });
  }

  async function handleSelectFacebookPage(pageId: string) {
    setSelectingPageId(pageId);
    try {
      await selectFacebookPage(pageId);
      setFacebookPendingPages(null);
      setOauthNotice({ text: 'Facebook connected.', isError: false, platform: 'facebook' });
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
    listConnections()
      .then((c) => {
        setConnections(c);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Could not load your connections.'));
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
      toast.success('Connection saved');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to connect Twitch.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(id: string, label: string) {
    const ok = await confirm({
      title: `Remove ${label}?`,
      body: 'StreamBird will revoke its access (for YouTube) and delete the stored credentials. Any stream using it must be reconnected before going live again. You can reconnect any time.',
      confirmLabel: 'Remove connection',
      destructive: true,
    });
    if (!ok) return;
    setRemovingId(id);
    try {
      await removeConnection(id);
      refresh();
      toast.success(`${label} removed`);
    } finally {
      setRemovingId(null);
    }
  }

  const connectedNames = (p: 'youtube' | 'facebook') => (connections ?? []).filter((c) => c.platform === p).map((c) => c.label);

  return (
    <div className="ha-page connections-page">
      <PageHeader
        title="Connections"
        subtitle={
          <>
            Platforms StreamBird can send your stream to.{' '}
            <DocsLink page="connect-platforms">How to connect YouTube, Facebook and other platforms</DocsLink>
          </>
        }
      />

      {oauthNotice?.code === 'facebook_no_pages' ? (
        <Notice tone="error" title="We couldn't find a Facebook Page you manage" onDismiss={() => setOauthNotice(null)} testId="facebook-no-pages">
          <p>StreamBird can only stream to Pages, not personal profiles. This usually means one of these:</p>
          <ul>
            <li>You are not an admin of any Page. Log in as the Page's admin (or ask the admin to give you access), then try again.</li>
            <li>You unticked your Page when Facebook asked what to share. In the Facebook dialog choose &lsquo;Edit settings&rsquo; and tick your Page.</li>
          </ul>
          <span className="ha-notice-actions" style={{ marginTop: 12 }}>
            <a className={buttonClass('primary')} href="/api/platform-connections/facebook/connect">
              Try Facebook again
            </a>
            <a className="ha-quiet" href={docsUrl('connect-platforms')} target="_blank" rel="noopener noreferrer">
              How to set up a Page
            </a>
          </span>
        </Notice>
      ) : (
        oauthNotice && (
          <Notice
            tone={oauthNotice.isError ? 'error' : 'success'}
            title={oauthNotice.isError ? undefined : oauthNotice.text.replace(/\.$/, '')}
            onDismiss={() => setOauthNotice(null)}
          >
            {oauthNotice.isError
              ? oauthNotice.text
              : oauthNotice.platform && connectedNames(oauthNotice.platform).length > 0
                ? `${connectedNames(oauthNotice.platform).join(', ')} is ready. You can pick it as a destination on any stream.`
                : 'You can pick it as a destination on any stream.'}
          </Notice>
        )
      )}

      {facebookPendingPages && facebookPendingPages.length > 0 && (
        <Card as="section" aria-labelledby="pp-title" style={{ maxWidth: 640 }}>
          <h2 id="pp-title">Which Page should StreamBird use?</h2>
          <p className="ha-sm ha-muted" style={{ margin: '4px 0 16px' }}>
            Choose which Facebook Page to connect. You can add more later.
          </p>
          <div role="radiogroup" aria-labelledby="pp-title" className="ha-stack" style={{ gap: 10 }}>
            {facebookPendingPages.map((p) => (
              <label key={p.id} className={`ha-pick${chosenPageId === p.id ? ' is-sel' : ''}`}>
                <input type="radio" name="fb-page" checked={chosenPageId === p.id} disabled={selectingPageId !== null} onChange={() => setChosenPageId(p.id)} />
                {p.pictureUrl ? (
                  <img src={p.pictureUrl} alt="" className="page-choice-pic" referrerPolicy="no-referrer" />
                ) : (
                  <span className="ha-pick-pic">
                    <PlatformLogo platform="facebook" size={20} />
                  </span>
                )}
                <span className="ha-pick-text">
                  <span>{p.name}</span>
                  <span>Page ID {p.id}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="ha-row ha-row--wrap" style={{ marginTop: 20 }}>
            <Button busy={selectingPageId !== null} disabled={!chosenPageId} onClick={() => chosenPageId && void handleSelectFacebookPage(chosenPageId)}>
              Use this Page
            </Button>
            <Button variant="ghost" disabled={selectingPageId !== null} onClick={cancelFacebookPageSelection}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      <Card as="section" aria-labelledby="cd-title">
        <h2 id="cd-title">Connected</h2>
        {loadError ? (
          <p className="ha-error" role="alert" style={{ marginTop: 8 }}>
            {loadError}
          </p>
        ) : !connections ? (
          <BirdLoader loading compact label="Loading your connections…" />
        ) : connections.length === 0 ? (
          <p className="ha-muted" style={{ marginTop: 6 }}>
            No platforms connected yet. Connect one below to pick it as a destination.
          </p>
        ) : (
          <ul className="ha-list connection-list" style={{ marginTop: 8 }}>
            {connections.map((c) => (
              <li key={c.id} className="ha-conn-item" style={{ flexWrap: 'wrap' }}>
                <PlatformTile platform={c.platform} />
                <div className="ha-list-main">
                  <h3>{PLATFORM_LABELS[c.platform]}</h3>
                  <p className="connection-label">{c.label}</p>
                </div>
                <button
                  type="button"
                  className="ha-quiet ha-quiet--danger"
                  aria-label={`Remove ${c.label}`}
                  disabled={removingId !== null}
                  onClick={() => void handleRemove(c.id, c.label)}
                >
                  Remove
                </button>
                <LiveLink connection={c} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div>
        <h2 style={{ marginBottom: 16 }}>Add a platform</h2>
        <div className="ha-add-grid">
          <Card as="section" className="ha-connect-card" aria-labelledby="yt-title">
            <div className="ha-row">
              <PlatformTile platform="youtube" />
              <h2 id="yt-title">Connect YouTube</h2>
            </div>
            <p>
              Connect a YouTube channel to schedule and go live directly from StreamBird. This is a separate permission from any "Sign in with Google" login you may
              already use. Google will ask you to allow StreamBird to{' '}
              <strong>"See, edit, and permanently delete your YouTube videos, ratings, comments and captions"</strong> (the <code>youtube.force-ssl</code> permission), the
              narrowest permission Google offers that lets an app create and run a live broadcast.
            </p>
            <div className="ha-explain youtube-permission-note" data-testid="youtube-permission-note">
              <b>What StreamBird uses it for</b>
              <ul>
                <li>Create the live broadcast and its stream for your event, and connect the two.</li>
                <li>Update the title, description, privacy, start time and thumbnail you set in StreamBird.</li>
                <li>Start the broadcast when you go live, end it when you end the stream, and read its status so you can see whether it is live.</li>
                <li>Delete a scheduled broadcast that StreamBird created, if you cancel that stream.</li>
                <li>Read your channel's name, so you can see which channel is connected.</li>
              </ul>
              <p style={{ marginTop: 8 }}>
                <b style={{ display: 'inline' }}>What it never does:</b> read or post comments, change captions or ratings, upload, edit or delete videos you already have, or touch anything except
                the broadcasts StreamBird itself created. Disconnecting a channel here revokes the access with Google.
              </p>
            </div>
            <div>
              <a className={buttonClass('primary')} href="/api/platform-connections/youtube/connect">
                <PlatformLogo platform="youtube" /> Connect YouTube
              </a>
            </div>
          </Card>

          <Card as="section" className="ha-connect-card" aria-labelledby="fb-title">
            <div className="ha-row">
              <PlatformTile platform="facebook" />
              <h2 id="fb-title">Connect Facebook</h2>
            </div>
            <p>Connect a Facebook Page to go live there directly from StreamBird. This requests permission to post live video as a Page you manage -- a personal profile can't be connected, only Pages.</p>
            <div className="ha-explain">
              <b>You will need</b>
              Admin access to at least one Facebook Page. You pick which Page to use after signing in.
            </div>
            <div>
              {facebookPendingPages && facebookPendingPages.length > 0 ? (
                <p className="ha-sm ha-muted">Choose a Page above to finish connecting.</p>
              ) : (
                <a className={buttonClass('primary')} href="/api/platform-connections/facebook/connect">
                  <PlatformLogo platform="facebook" /> Connect Facebook
                </a>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Card as="section" id="rtmp" aria-labelledby="rtmp-title">
        <div className="ha-row ha-row--wrap">
          <h2 id="rtmp-title">Twitch and custom RTMP</h2>
          <span className="ha-sp" />
          <span className="ha-sm ha-muted">For any platform that gives you a server and stream key</span>
        </div>
        <p className="ha-sm ha-muted" style={{ marginTop: 6 }}>
          Twitch doesn't expose your stream key through its API -- copy it from your Twitch dashboard (Creator Dashboard → Settings → Stream) and paste it below. The same works for any
          other RTMP address.
        </p>
        <form onSubmit={handleConnect} className="connect-form" style={{ marginTop: 16 }}>
          <div className="ha-rtmp-form">
            <Input id="label" label="Label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My Twitch channel" />
            <Input id="ingestServerUrl" label="Ingest server URL" type="text" required value={ingestServerUrl} onChange={(e) => setIngestServerUrl(e.target.value)} placeholder="rtmp://live.twitch.tv/app" />
            <Input id="streamKey" label="Stream key" type="password" required value={streamKey} onChange={(e) => setStreamKey(e.target.value)} placeholder="live_xxxxxxxx" />
            <Button type="submit" busy={busy} disabled={!ingestServerUrl.trim() || !streamKey.trim()} style={{ marginBottom: 2 }}>
              Connect
            </Button>
          </div>
          {error && (
            <p className="ha-error" role="alert" style={{ marginTop: 12 }}>
              {error}
            </p>
          )}
        </form>
      </Card>

      <Card as="section" aria-labelledby="op-title">
        <h2 id="op-title">Other platforms</h2>
        <p className="ha-muted" style={{ marginTop: 4 }}>
          LinkedIn Live is coming soon. Until then, any platform that gives you an RTMP server and stream key works with{' '}
          <Link to="#rtmp" className="ha-quiet" style={{ minHeight: 0, padding: 0 }}>
            the form above
          </Link>
          .
        </p>
      </Card>
    </div>
  );
}
