import { NameBadge } from '../../components/NameBadge';
import { formatWhen } from '../../lib/schedule';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Camera,
  Copy,
  LayoutGrid,
  Focus,
  Radio,
  PhoneOff,
  UserX,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Image as ImageIcon,
  MonitorUp,
  MonitorOff,
  Save,
  Clapperboard,
  ExternalLink,
  Pin,
  PinOff,
  Eye,
  EyeOff,
  Gauge,
  Palette,
  Trash2,
  ImagePlus,
  Lock,
  Check,
} from 'lucide-react';
import { useHostStudio, RESOLUTIONS, MAX_SLIDES } from '../../studio/useHostStudio';
import { SlideControls } from '../../components/SlideControls';
import type { StreamResolution, LayoutMode } from '../../studio/useHostStudio';
import { BRANDING_RANGES, LAYOUTS, LAYOUT_BY_ID, THEMES, WALLPAPER_RANGES, aspectLabel, canvasSizeFor, describeWallpaperFit, getTheme } from '../../studio/compose';
import { PlatformBadge } from '../../components/PlatformBadge';
import { BirdLoader } from '../../components/BirdLoader';
import { DocsLink } from '../../components/DocsLink';
import { BirdBusy, isInProgress } from '../../components/BirdBusy';

const RESOLUTION_ORDER: StreamResolution[] = ['sd', 'hd', 'fhd'];

export function HostStudioPage() {
  const { streamId } = useParams<{ streamId: string }>();
  const [requireInvitePassword, setRequireInvitePassword] = useState(false);
  const [invitePassword, setInvitePassword] = useState('');
  // The password that new invite links actually use. Typing in the box changes nothing until Save.
  const [savedInvitePassword, setSavedInvitePassword] = useState('');
  const [inviteOptionsOpen, setInviteOptionsOpen] = useState(false);
  const [inviteOptionsNote, setInviteOptionsNote] = useState<string | null>(null);
  const [copiedDestinationId, setCopiedDestinationId] = useState<string | null>(null);
  const {
    canvasRef,
    loading,
    loadError,
    needsLogin,
    stream,
    status,
    inviteMessage,
    participants,
    layoutMode,
    orientation,
    themeId,
    slides,
    slideIndex,
    wallpaper,
    wallpaperFocus,
    wallpaperDim,
    resolution,
    maxResolution,
    cameraStarting,
    cameraStarted,
    isLive,
    ending,
    screenSharing,
    branding,
    scenes,
    activeSceneName,
    destinations,
    connectionById,
    audioBlocked,
    resumeAttempted,
    startingScheduled,
    actions,
  } = useHostStudio(streamId);
  const canvasSize = canvasSizeFor(RESOLUTIONS[resolution], orientation);
  const onStageCount = participants.filter((p) => p.onStage && !p.isScreenShare).length;

  const passwordUnsaved = requireInvitePassword && invitePassword.trim() !== savedInvitePassword;

  function saveInvitePassword() {
    const value = invitePassword.trim();
    if (!value) {
      setInviteOptionsNote('Type a password first.');
      return;
    }
    setSavedInvitePassword(value);
    setInviteOptionsNote(null);
  }

  function toggleInvitePassword(on: boolean) {
    setRequireInvitePassword(on);
    setInviteOptionsNote(null);
    if (!on) {
      setSavedInvitePassword('');
      setInvitePassword('');
    }
  }

  function createInvite() {
    if (requireInvitePassword && passwordUnsaved) {
      setInviteOptionsOpen(true);
      setInviteOptionsNote(savedInvitePassword ? 'You changed the password but have not saved it. Press Save, then create the invite.' : 'Press Save to set the password, then create the invite.');
      return;
    }
    void actions.createInviteLink(requireInvitePassword ? savedInvitePassword : undefined);
  }

  async function copyWatchUrl(id: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedDestinationId(id);
      setTimeout(() => setCopiedDestinationId((cur) => (cur === id ? null : cur)), 2000);
    } catch {
      // Clipboard access can be denied (permissions, non-HTTPS, etc.) --
      // not worth surfacing as an error, the Watch link still works.
    }
  }

  if (needsLogin) {
    return (
      <div className="studio-page">
        <p>
          You need to be logged in. <a href="/login">Log in</a>
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="studio-page">
        <BirdLoader loading compact />
      </div>
    );
  }

  if (loadError || !stream) {
    return (
      <div className="studio-page">
        <p className="error">{loadError ?? 'Could not load this stream.'}</p>
      </div>
    );
  }

  return (
    <div className="studio-page">
      <h1 className="brand-heading">
        <img src="/logo.png" alt="" className="brand-logo" /> StreamBird studio host
        <DocsLink page="host-studio" className="studio-docs-link">Studio guide</DocsLink>
      </h1>

      {stream?.status === 'scheduled' && (
        <div className="panel studio-resume-banner" role="status">
          <span>
            This stream is scheduled
            {stream.scheduledAt ? ` for ${formatWhen(stream.scheduledAt, stream.timezone ?? 'UTC')}` : ''}. You can let guests join now (camera optional);
            start the stream when you are ready to go on air.
          </span>
          <button type="button" className="icon-btn icon-btn--accent" disabled={startingScheduled} onClick={() => void actions.startScheduledStream()}>
            {startingScheduled && <BirdBusy />} Start stream
          </button>
        </div>
      )}

      {((resumeAttempted && !isLive) || (isLive && audioBlocked)) && (
        <div className="panel studio-resume-banner" role="status">
          <span>
            {isLive
              ? 'Your browser is blocking audio — viewers can’t hear you yet.'
              : 'Your stream is still live, and viewers are seeing a “technical difficulties” screen. Resume to get back on air.'}
          </span>
          <button type="button" className="icon-btn icon-btn--accent" onClick={() => void actions.resumeLive()}>
            {isLive ? 'Enable audio' : 'Resume stream'}
          </button>
        </div>
      )}

      <div className="studio-topbar" role="toolbar" aria-label="Studio controls">
        <div className="studio-topbar-group">
          <button
            type="button"
            className="tb-btn"
            aria-label={cameraStarted ? 'Camera on' : 'Start my camera'}
            title={cameraStarted ? 'Camera is on' : 'Start my camera'}
            onClick={() => void actions.startCamera()}
            disabled={cameraStarting || cameraStarted}
          >
            <Camera size={18} /> <span className="tb-label">{cameraStarted ? 'Camera on' : 'Camera'}</span>
          </button>
          <button
            type="button"
            className={`tb-btn${screenSharing ? ' tb-btn--on' : ''}`}
            aria-label={screenSharing ? 'Stop sharing' : 'Share screen'}
            title={screenSharing ? 'Stop sharing your screen' : 'Share your screen'}
            onClick={() => (screenSharing ? actions.stopScreenShare() : void actions.startScreenShare())}
          >
            {screenSharing ? <MonitorOff size={18} /> : <MonitorUp size={18} />} <span className="tb-label">{screenSharing ? 'Stop' : 'Share'}</span>
          </button>
          <button
            type="button"
            className="tb-btn"
            aria-label="Toggle layout"
            title={`Toggle layout (now ${layoutMode})`}
            onClick={actions.toggleLayout}
          >
            {layoutMode === 'grid' ? <LayoutGrid size={18} /> : <Focus size={18} />} <span className="tb-label tb-label--wide">Layout</span>
          </button>
        </div>

        <div className="studio-topbar-group studio-invite-group">
          <button type="button" className="tb-btn" aria-label="Create guest invite" title="Create a guest invite link and copy it" onClick={createInvite}>
            <Copy size={18} /> <span className="tb-label">Invite</span>
          </button>
          <button
            type="button"
            className={`tb-btn tb-btn--icon${requireInvitePassword && savedInvitePassword ? ' tb-btn--on' : ''}`}
            aria-label="Invite password options"
            aria-expanded={inviteOptionsOpen}
            title={requireInvitePassword && savedInvitePassword ? 'Invite links need a password' : 'Set a password for invite links'}
            onClick={() => setInviteOptionsOpen((o) => !o)}
          >
            <Lock size={16} />
          </button>
          {inviteOptionsOpen && (
            <div className="studio-popover" role="dialog" aria-label="Invite link settings">
              <label className="checkbox-row">
                <input type="checkbox" checked={requireInvitePassword} onChange={(e) => toggleInvitePassword(e.target.checked)} />
                Require a password to join
              </label>
              {requireInvitePassword && (
                <>
                  <div className="studio-password-row">
                    <input
                      type="text"
                      aria-label="Invite password"
                      placeholder="Invite password"
                      autoComplete="off"
                      value={invitePassword}
                      onChange={(e) => {
                        setInvitePassword(e.target.value);
                        setInviteOptionsNote(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveInvitePassword();
                      }}
                    />
                    <button type="button" className="icon-btn" disabled={!invitePassword.trim() || !passwordUnsaved} onClick={saveInvitePassword}>
                      <Save size={16} /> Save
                    </button>
                  </div>
                  {savedInvitePassword && !passwordUnsaved ? (
                    <p className="studio-popover-note studio-popover-note--ok">
                      <Check size={14} /> Password saved. Every new guest invite asks for it.
                    </p>
                  ) : (
                    <p className="studio-popover-note">Press Save (or Enter) to use this password. Nothing changes until you do.</p>
                  )}
                </>
              )}
              {inviteOptionsNote && <p className="studio-popover-note studio-popover-note--warn">{inviteOptionsNote}</p>}
              <p className="studio-popover-note">
                {requireInvitePassword ? 'Invite links you already copied keep the setting they were made with.' : 'Guests can join with the link alone.'}
              </p>
            </div>
          )}
        </div>

        <div className="studio-topbar-group studio-topbar-selects">
          <label className="studio-resolution-select" title={isLive ? 'Locked while live -- end the stream to change it' : 'Stream quality'}>
            <Gauge size={16} />
            <select
              aria-label="Stream quality"
              value={resolution}
              disabled={isLive}
              onChange={(e) => actions.setResolution(e.target.value as StreamResolution)}
            >
              {Object.entries(RESOLUTIONS)
                .filter(([value]) => RESOLUTION_ORDER.indexOf(value as StreamResolution) <= RESOLUTION_ORDER.indexOf(maxResolution))
                .map(([value, r]) => {
                  const dims = canvasSizeFor(r, orientation);
                  return (
                    <option key={value} value={value}>
                      {orientation === 'portrait' ? `${r.label.replace(/\s*\(.*\)/, '')} vertical (${dims.width}x${dims.height})` : r.label}
                    </option>
                  );
                })}
            </select>
          </label>
          <label className="tb-select" title="Layout">
            <LayoutGrid size={16} />
            <select id="layoutSelect" aria-label="Layout" value={layoutMode} onChange={(e) => actions.setLayout(e.target.value as LayoutMode)}>
              {[...new Set(LAYOUTS.map((l) => l.group))].map((group) => (
                <optgroup key={group} label={group}>
                  {LAYOUTS.filter((l) => l.group === group).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label
            className="tb-select"
            title={
              getTheme(themeId).id === 'vanilla'
                ? 'Canvas style. Vanilla is the original plain look; styles show around the tiles of the framed layouts.'
                : 'Canvas style, shown around the tiles of the framed layouts (Grid and Spotlight fill the whole frame).'
            }
          >
            <Palette size={16} />
            <select id="themeSelect" aria-label="Canvas style" value={themeId} onChange={(e) => actions.setTheme(e.target.value)}>
              {[...new Set(THEMES.map((t) => t.group))].map((group) => (
                <optgroup key={group} label={group}>
                  {THEMES.filter((t) => t.group === group).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>

        <div className="studio-topbar-group studio-topbar-live">
          <button
            type="button"
            className={`go-live-button go-live-button--bar${isLive ? ' go-live-button--live' : ''}`}
            onClick={() => void actions.goLive()}
            disabled={!stream.whipUrl || isLive}
          >
            <Radio size={18} /> {isLive ? 'Live' : 'Go live'}
          </button>
          <button
            type="button"
            className="tb-btn tb-btn--danger"
            aria-label="End stream"
            title="End the stream for everyone"
            onClick={() => {
              if (window.confirm('End the stream for everyone watching? This cannot be undone.')) void actions.endStream();
            }}
            disabled={ending}
          >
            <PhoneOff size={18} /> <span className="tb-label">End</span>
          </button>
        </div>
      </div>

      <div className="studio-video-wrap">
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          className={`studio-canvas${orientation === 'portrait' ? ' studio-canvas--portrait' : ''}`}
        />
      </div>

      <p className="docs-hint studio-layout-note">
        {LAYOUT_BY_ID[layoutMode].description}
        {screenSharing && !LAYOUT_BY_ID[layoutMode].hasSlide && layoutMode !== 'grid' && layoutMode !== 'spotlight' &&
          ' Your screen share only shows in layouts with a slide area (or Grid and Spotlight).'}
        {orientation === 'portrait' && ' Vertical stream: a landscape webcam is cropped to the middle of the frame, so keep yourself centred (a phone camera held upright fills it).'}
        {onStageCount > LAYOUT_BY_ID[layoutMode].maxPeople &&
          ` This layout has room for ${LAYOUT_BY_ID[layoutMode].maxPeople} ${LAYOUT_BY_ID[layoutMode].maxPeople === 1 ? 'person' : 'people'}; the others stay in the audio mix but are not drawn.`}
      </p>

      <SlideControls
        slides={slides}
        slideIndex={slideIndex}
        layoutHasSlide={LAYOUT_BY_ID[layoutMode].hasSlide}
        screenSharing={screenSharing}
        maxSlides={MAX_SLIDES}
        onAdd={(files) => void actions.addSlides(files)}
        onPrev={actions.prevSlide}
        onNext={actions.nextSlide}
        onGoto={actions.gotoSlide}
        onClear={actions.clearSlides}
        onUseSlideLayout={() => actions.setLayout((LAYOUTS.find((l) => l.hasSlide) ?? LAYOUTS[0]).id as LayoutMode)}
      />

      {(status || inviteMessage) && (
        <div className="studio-status-toast">
          {status && (
            <p className={`status${status.isError ? ' error' : ''}`}>
              {isInProgress(status.text) && <BirdBusy />}
              {status.text}
            </p>
          )}
          {inviteMessage && <p className={`status${inviteMessage.isError ? ' error' : ''}`}>{inviteMessage.text}</p>}
        </div>
      )}

      {destinations.length > 0 && (
        <div className="panel">
          <label className="studio-section-label">
            <Radio size={14} /> Destinations
          </label>
          <div className="connection-list">
            {destinations.map((d) => {
              const connection = connectionById.get(d.platformConnectionId);
              return (
                <div key={d.id} className="destination-detail-row">
                  <div className="destination-detail-main">
                    {connection && <PlatformBadge platform={connection.platform} />}
                    {connection && <span className="connection-label">{connection.label}</span>}
                    <span className={`status-dot status-${d.status}`} />
                    <span>{d.status}</span>
                    {d.platformStatus && <span className="empty-state">platform reports: {d.platformStatus}</span>}
                    {d.viewerCount !== null && <span className="empty-state">{d.viewerCount} viewers</span>}
                  </div>
                  <div className="destination-detail-actions">
                    {d.watchUrl && (
                      <>
                        <a href={d.watchUrl} target="_blank" rel="noopener noreferrer" className="icon-btn icon-btn--small">
                          <ExternalLink size={14} /> Watch
                        </a>
                        <button
                          type="button"
                          className="icon-btn icon-btn--small"
                          onClick={() => void copyWatchUrl(d.id, d.watchUrl!)}
                        >
                          <Copy size={14} /> {copiedDestinationId === d.id ? 'Copied!' : 'Copy link'}
                        </button>
                      </>
                    )}
                  </div>
                  {d.errorMessage && <p className="error">{d.errorMessage}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="panel">
        <label className="studio-section-label">Participants</label>
        <div className="participant-list">
          {participants.map((p) => (
            <div key={p.id} className="participant-row">
              <span className="participant-row-name"><NameBadge name={p.displayName} /><span>{p.displayName}</span></span>
              {!p.isScreenShare && (
                <span className={`badge${p.onStage ? '' : ' badge-warning'}`}>{p.onStage ? 'On stage' : 'Backstage'}</span>
              )}
              {p.pinned && <span className="badge badge-accent">Pinned</span>}
              {(!p.isScreenShare || p.hasAudio) && (
                <>
                  {p.audioEnabled === false && <MicOff size={14} className="participant-row-muted-icon" />}
                  <button type="button" className="icon-btn icon-btn--small" onClick={() => actions.toggleParticipantAudio(p.id)}>
                    {p.audioEnabled === false ? <MicOff size={14} /> : <Mic size={14} />}
                    {p.audioEnabled === false ? 'Unmute' : 'Mute'}
                  </button>
                </>
              )}
              {!p.isScreenShare && (
                <button type="button" className="icon-btn icon-btn--small" onClick={() => actions.toggleParticipantVideo(p.id)}>
                  {p.videoEnabled === false ? <VideoOff size={14} /> : <Video size={14} />}
                  {p.videoEnabled === false ? 'Enable camera' : 'Disable camera'}
                </button>
              )}
              <button
                type="button"
                className={`icon-btn icon-btn--small${p.pinned ? ' icon-btn--accent' : ''}`}
                onClick={() => actions.togglePin(p.id)}
              >
                {p.pinned ? <PinOff size={14} /> : <Pin size={14} />} {p.pinned ? 'Unpin' : 'Pin to spotlight'}
              </button>
              {!p.isScreenShare && (
                <>
                  <button
                    type="button"
                    className={`icon-btn icon-btn--small${p.onStage ? '' : ' icon-btn--accent'}`}
                    onClick={() => actions.toggleOnStage(p.id)}
                  >
                    {p.onStage ? <EyeOff size={14} /> : <Eye size={14} />} {p.onStage ? 'Send backstage' : 'Bring on stage'}
                  </button>
                </>
              )}
              {p.isScreenShare ? (
                <button type="button" className="icon-btn icon-btn--small icon-btn--danger" onClick={() => actions.stopScreenShare()}>
                  <MonitorOff size={14} /> Stop sharing
                </button>
              ) : (
                !p.isLocal && (
                  <button
                    type="button"
                    className="icon-btn icon-btn--small icon-btn--danger"
                    onClick={() => {
                      if (window.confirm(`Remove ${p.displayName} from the studio?`)) actions.dropParticipant(p.id);
                    }}
                  >
                    <UserX size={14} /> Remove
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <label className="studio-section-label" htmlFor="wallpaperInput">
          <ImagePlus size={14} /> Wallpaper
        </label>
        <p className="docs-hint">
          Best: an image of exactly <strong>{canvasSize.width}x{canvasSize.height}</strong> ({aspectLabel(canvasSize.width, canvasSize.height)}, for the selected quality). Any other image is
          cropped to fit, and you choose what stays. It shows behind the tiles in every layout; the canvas style still sets the ticker and tile colours.
        </p>
        <input
          id="wallpaperInput"
          type="file"
          accept="image/*"
          onChange={(e) => {
            void actions.setWallpaperFile(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
        {wallpaper && (
          <>
            <p className="docs-hint" data-testid="wallpaper-fit">
              <strong>{wallpaper.name}</strong>: {describeWallpaperFit(wallpaper.width, wallpaper.height, canvasSize.width, canvasSize.height).message}
            </p>
            <label htmlFor="wallpaperFocusX">Crop position, left to right: {wallpaperFocus.x}%</label>
            <input
              id="wallpaperFocusX"
              type="range"
              min={WALLPAPER_RANGES.focus.min}
              max={WALLPAPER_RANGES.focus.max}
              value={wallpaperFocus.x}
              onChange={(e) => actions.setWallpaperFocus(parseInt(e.target.value, 10), wallpaperFocus.y)}
            />
            <label htmlFor="wallpaperFocusY">Crop position, top to bottom: {wallpaperFocus.y}%</label>
            <input
              id="wallpaperFocusY"
              type="range"
              min={WALLPAPER_RANGES.focus.min}
              max={WALLPAPER_RANGES.focus.max}
              value={wallpaperFocus.y}
              onChange={(e) => actions.setWallpaperFocus(wallpaperFocus.x, parseInt(e.target.value, 10))}
            />
            <label htmlFor="wallpaperDim">Darken: {wallpaperDim}%</label>
            <input
              id="wallpaperDim"
              type="range"
              min={WALLPAPER_RANGES.dim.min}
              max={WALLPAPER_RANGES.dim.max}
              value={wallpaperDim}
              onChange={(e) => actions.setWallpaperDim(parseInt(e.target.value, 10))}
            />
            <button type="button" className="icon-btn icon-btn--small icon-btn--danger" onClick={actions.clearWallpaper}>
              <Trash2 size={14} /> Remove wallpaper
            </button>
          </>
        )}
      </div>

      <div className="panel">
        <label className="studio-section-label" htmlFor="logoInput">
          <ImageIcon size={14} /> Logo (shown top-left)
        </label>
        <input id="logoInput" type="file" accept="image/*" onChange={(e) => actions.setLogoFile(e.target.files?.[0] ?? null)} />

        <label htmlFor="logoSizeInput">Logo size: {branding.logoSize}px</label>
        <input
          id="logoSizeInput"
          type="range"
          min={BRANDING_RANGES.logoSize.min}
          max={BRANDING_RANGES.logoSize.max}
          value={branding.logoSize}
          onChange={(e) => actions.setLogoSize(parseInt(e.target.value, 10))}
        />

        <label htmlFor="newsInput">News ticker text (shown at the bottom)</label>
        <input
          id="newsInput"
          type="text"
          placeholder="Breaking: ..."
          value={branding.newsText}
          onChange={(e) => actions.setNewsText(e.target.value)}
        />

        <label htmlFor="nameFontSizeInput">Name label size: {branding.nameFontSize}px</label>
        <input
          id="nameFontSizeInput"
          type="range"
          min={BRANDING_RANGES.nameFontSize.min}
          max={BRANDING_RANGES.nameFontSize.max}
          value={branding.nameFontSize}
          onChange={(e) => actions.setNameFontSize(parseInt(e.target.value, 10))}
        />

        <label htmlFor="newsFontSizeInput">News ticker text size: {branding.newsFontSize}px</label>
        <input
          id="newsFontSizeInput"
          type="range"
          min={BRANDING_RANGES.newsFontSize.min}
          max={BRANDING_RANGES.newsFontSize.max}
          value={branding.newsFontSize}
          onChange={(e) => actions.setNewsFontSize(parseInt(e.target.value, 10))}
        />
      </div>

      <div className="panel">
        <label className="studio-section-label">
          <Clapperboard size={14} /> Scenes
        </label>
        <div className="studio-toolbar">
          <button
            type="button"
            className="icon-btn icon-btn--small"
            onClick={() => {
              const name = window.prompt('Name this scene:');
              if (name && name.trim()) actions.saveScene(name);
            }}
          >
            <Save size={14} /> Save current as scene
          </button>
          {scenes.map((scene) => (
            <button
              key={scene.name}
              type="button"
              className={`icon-btn icon-btn--small${scene.name === activeSceneName ? ' icon-btn--accent' : ''}`}
              onClick={() => actions.applyScene(scene.name)}
            >
              <Clapperboard size={14} /> {scene.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
