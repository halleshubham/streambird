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
  Presentation,
  ChevronLeft,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import { useHostStudio, RESOLUTIONS } from '../../studio/useHostStudio';
import type { StreamResolution, LayoutMode } from '../../studio/useHostStudio';
import { BRANDING_RANGES, LAYOUTS, LAYOUT_BY_ID, THEMES, getTheme } from '../../studio/compose';
import { PlatformBadge } from '../../components/PlatformBadge';
import { BirdLoader } from '../../components/BirdLoader';
import { DocsLink } from '../../components/DocsLink';
import { BirdBusy, isInProgress } from '../../components/BirdBusy';

const RESOLUTION_ORDER: StreamResolution[] = ['sd', 'hd', 'fhd'];

export function HostStudioPage() {
  const { streamId } = useParams<{ streamId: string }>();
  const [requireInvitePassword, setRequireInvitePassword] = useState(false);
  const [invitePassword, setInvitePassword] = useState('');
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
    themeId,
    slides,
    slideIndex,
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
  const onStageCount = participants.filter((p) => p.onStage && !p.isScreenShare).length;

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

      <div className="studio-video-wrap">
        <canvas
          ref={canvasRef}
          width={RESOLUTIONS[resolution].width}
          height={RESOLUTIONS[resolution].height}
          className="studio-canvas"
        />
      </div>

      <div className="panel">
        <div className="studio-toolbar-group">
          <span className="studio-toolbar-group-label">Setup</span>
          <div className="studio-toolbar">
            <button type="button" className="icon-btn" onClick={() => void actions.startCamera()} disabled={cameraStarting || cameraStarted}>
              <Camera size={16} /> {cameraStarted ? 'Camera on' : 'Start my camera'}
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => void actions.createInviteLink(requireInvitePassword ? invitePassword : undefined)}
            >
              <Copy size={16} /> Create guest invite
            </button>
            <label className="studio-resolution-select" title={isLive ? 'Locked while live -- end the stream to change it' : undefined}>
              <Gauge size={16} />
              <select
                value={resolution}
                disabled={isLive}
                onChange={(e) => actions.setResolution(e.target.value as StreamResolution)}
              >
                {Object.entries(RESOLUTIONS)
                  .filter(([value]) => RESOLUTION_ORDER.indexOf(value as StreamResolution) <= RESOLUTION_ORDER.indexOf(maxResolution))
                  .map(([value, r]) => (
                    <option key={value} value={value}>
                      {r.label}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </div>

        <div className="studio-toolbar-group">
          <span className="studio-toolbar-group-label">Live controls</span>
          <div className="studio-toolbar">
            <button type="button" className="icon-btn" onClick={actions.toggleLayout}>
              {layoutMode === 'grid' ? <LayoutGrid size={16} /> : <Focus size={16} />} Toggle layout ({layoutMode})
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => (screenSharing ? actions.stopScreenShare() : void actions.startScreenShare())}
            >
              {screenSharing ? <MonitorOff size={16} /> : <MonitorUp size={16} />} {screenSharing ? 'Stop sharing' : 'Share screen'}
            </button>
          </div>
        </div>

        <div className="studio-invite-controls">
          <label>
            <input
              type="checkbox"
              checked={requireInvitePassword}
              onChange={(e) => setRequireInvitePassword(e.target.checked)}
            />
            {' '}Require a password to join
          </label>
          {requireInvitePassword && (
            <input
              type="text"
              placeholder="Invite password"
              value={invitePassword}
              onChange={(e) => setInvitePassword(e.target.value)}
            />
          )}
        </div>

        <div className="studio-golive-row">
          <button
            type="button"
            className={`go-live-button${isLive ? ' go-live-button--live' : ''}`}
            onClick={() => void actions.goLive()}
            disabled={!stream.whipUrl || isLive}
          >
            <Radio size={20} /> {isLive ? 'Live' : 'Go live'}
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--small icon-btn--danger"
            onClick={() => {
              if (window.confirm('End the stream for everyone watching? This cannot be undone.')) void actions.endStream();
            }}
            disabled={ending}
          >
            <PhoneOff size={14} /> End stream
          </button>
        </div>
      </div>

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
        <label className="studio-section-label" htmlFor="layoutSelect">
          <Palette size={14} /> Layout and canvas style
        </label>
        <label htmlFor="layoutSelect">Layout</label>
        <select id="layoutSelect" value={layoutMode} onChange={(e) => actions.setLayout(e.target.value as LayoutMode)}>
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
        <p className="docs-hint">
          {LAYOUT_BY_ID[layoutMode].description}
          {screenSharing && !LAYOUT_BY_ID[layoutMode].hasSlide && layoutMode !== 'grid' && layoutMode !== 'spotlight' &&
            ' Your screen share only shows in layouts with a slide area (or Grid and Spotlight).'}
          {onStageCount > LAYOUT_BY_ID[layoutMode].maxPeople &&
            ` This layout has room for ${LAYOUT_BY_ID[layoutMode].maxPeople} ${LAYOUT_BY_ID[layoutMode].maxPeople === 1 ? 'person' : 'people'}; the others stay in the audio mix but are not drawn.`}
        </p>

        <label htmlFor="themeSelect">Canvas style</label>
        <select id="themeSelect" value={themeId} onChange={(e) => actions.setTheme(e.target.value)}>
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
        <p className="docs-hint">
          {getTheme(themeId).id === 'vanilla'
            ? 'Vanilla is the original plain look. Styles show around the tiles of the framed layouts (everything except Grid and Spotlight).'
            : 'The style shows around the tiles of the framed layouts; Grid and Spotlight fill the whole frame.'}
        </p>
      </div>

      <div className="panel">
        <label className="studio-section-label" htmlFor="slidesInput">
          <Presentation size={14} /> Slides
        </label>
        <input
          id="slidesInput"
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            void actions.addSlides(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="studio-toolbar">
          <button type="button" className="icon-btn icon-btn--small" disabled={slideIndex <= 0} onClick={actions.prevSlide}>
            <ChevronLeft size={14} /> Previous
          </button>
          <span data-testid="slide-counter">{slides.length === 0 ? 'No slides' : `Slide ${slideIndex + 1} / ${slides.length}`}</span>
          <button type="button" className="icon-btn icon-btn--small" disabled={slideIndex >= slides.length - 1} onClick={actions.nextSlide}>
            Next <ChevronRight size={14} />
          </button>
          {slides.length > 0 && (
            <button type="button" className="icon-btn icon-btn--small icon-btn--danger" onClick={actions.clearSlides}>
              <Trash2 size={14} /> Clear
            </button>
          )}
        </div>
        <p className="docs-hint">
          {slides.length > 0 ? `${slides[slideIndex]?.name ?? ''} -- ` : ''}
          Images only (export a deck or PDF as images first). Left and right arrow keys change slide. A screen share replaces the slide while it is on.
          {!LAYOUT_BY_ID[layoutMode].hasSlide && ' Pick a layout with slides to show them.'}
        </p>
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
