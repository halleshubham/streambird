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
} from 'lucide-react';
import { useHostStudio } from '../../studio/useHostStudio';

export function HostStudioPage() {
  const { streamId } = useParams<{ streamId: string }>();
  const [requireInvitePassword, setRequireInvitePassword] = useState(false);
  const [invitePassword, setInvitePassword] = useState('');
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
    cameraStarting,
    cameraStarted,
    isLive,
    ending,
    actions,
  } = useHostStudio(streamId);

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
        <p className="status">Loading…</p>
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
      </h1>

      <canvas ref={canvasRef} width={1280} height={720} className="studio-canvas" />

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
        <button type="button" className="icon-btn" onClick={actions.toggleLayout}>
          {layoutMode === 'grid' ? <LayoutGrid size={16} /> : <Focus size={16} />} Toggle layout ({layoutMode})
        </button>
        <button type="button" className="icon-btn icon-btn--accent" onClick={() => void actions.goLive()} disabled={!stream.whipUrl || isLive}>
          <Radio size={16} /> {isLive ? 'Live' : 'Go live'}
        </button>
        <button type="button" className="icon-btn icon-btn--danger" onClick={() => void actions.endStream()} disabled={ending}>
          <PhoneOff size={16} /> End stream
        </button>
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

      {status && <p className={`status${status.isError ? ' error' : ''}`}>{status.text}</p>}
      {inviteMessage && <p className={`status${inviteMessage.isError ? ' error' : ''}`}>{inviteMessage.text}</p>}

      <label className="studio-section-label">Participants</label>
      <div className="participant-list">
        {participants.map((p) => (
          <div key={p.id} className="participant-row">
            <span>{p.displayName}</span>
            <button type="button" className="icon-btn icon-btn--small" onClick={() => actions.toggleParticipantAudio(p.id)}>
              {p.audioEnabled === false ? <MicOff size={14} /> : <Mic size={14} />}
              {p.audioEnabled === false ? 'Unmute' : 'Mute'}
            </button>
            <button type="button" className="icon-btn icon-btn--small" onClick={() => actions.toggleParticipantVideo(p.id)}>
              {p.videoEnabled === false ? <VideoOff size={14} /> : <Video size={14} />}
              {p.videoEnabled === false ? 'Enable camera' : 'Disable camera'}
            </button>
            {!p.isLocal && (
              <button type="button" className="icon-btn icon-btn--small icon-btn--danger" onClick={() => actions.dropParticipant(p.id)}>
                <UserX size={14} /> Remove
              </button>
            )}
          </div>
        ))}
      </div>

      <label className="studio-section-label" htmlFor="logoInput">
        <ImageIcon size={14} /> Logo (shown top-left)
      </label>
      <input id="logoInput" type="file" accept="image/*" onChange={(e) => actions.setLogoFile(e.target.files?.[0] ?? null)} />

      <label htmlFor="logoSizeInput">Logo size (px height)</label>
      <input
        id="logoSizeInput"
        type="number"
        min={16}
        max={240}
        defaultValue={60}
        onChange={(e) => actions.setLogoSize(parseInt(e.target.value, 10))}
      />

      <label htmlFor="newsInput">News ticker text (shown at the bottom)</label>
      <input
        id="newsInput"
        type="text"
        placeholder="Breaking: ..."
        onChange={(e) => actions.setNewsText(e.target.value)}
      />

      <label htmlFor="nameFontSizeInput">Name label size (px)</label>
      <input
        id="nameFontSizeInput"
        type="number"
        min={8}
        max={48}
        defaultValue={14}
        onChange={(e) => actions.setNameFontSize(parseInt(e.target.value, 10))}
      />
    </div>
  );
}
