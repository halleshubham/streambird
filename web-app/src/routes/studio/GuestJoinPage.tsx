import { NameBadge } from '../../components/NameBadge';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Mic, MicOff, Video, VideoOff, LogOut, Link2Off, CameraOff, AlertCircle } from 'lucide-react';
import '../../styles/guest.css';
import { useGuestStudio } from '../../studio/useGuestStudio';
import { MediaStreamVideo } from '../../components/MediaStreamVideo';
import { BirdLoader } from '../../components/BirdLoader';
import { BirdBusy, isInProgress } from '../../components/BirdBusy';

export function GuestJoinPage() {
  const { token } = useParams<{ token: string }>();
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const {
    mode,
    joinError,
    passwordRequired,
    previewing,
    previewError,
    callStatus,
    callIsError,
    tiles,
    micEnabled,
    cameraEnabled,
    joining,
    refs,
    actions,
  } = useGuestStudio(token);
  const { setLocalVideoEl } = refs;

  const inCall = mode === 'in-call';
  const statusTone = callIsError ? 'bad' : /^(Connected|Reconnected|Joined)/.test(callStatus) ? 'good' : /host disconnected/i.test(callStatus) ? 'warn' : 'neutral';

  return (
    <div className={`studio-page guest-page${inCall ? ' guest-page--call' : mode === 'ready-to-join' ? ' guest-page--join' : ' guest-page--card'}`}>
      <header className="guest-head">
        <h1 className="brand-heading guest-brand">
          <img src="/logo-256.png" alt="" className="brand-logo" /> {inCall ? <span className="ui-sr-only">Join as a guest</span> : 'Join as a guest'}
          {inCall && <span aria-hidden="true">StreamBird</span>}
        </h1>
        {inCall && (
          <p className={`guest-status guest-status--${statusTone}${callIsError ? ' error' : ''}`} role="status">
            {isInProgress(callStatus) ? <BirdBusy overlay={false} /> : <span className="guest-status-dot" aria-hidden="true" />}
            {callStatus}
          </p>
        )}
      </header>

      {mode === 'checking-invite' && <BirdLoader loading compact label="Checking your invite…" />}

      {mode === 'invite-invalid' && (
        <main className="guest-card">
          <div className="guest-card-icon" aria-hidden="true">
            <Link2Off size={30} />
          </div>
          <h2>This invite doesn’t work</h2>
          <p className="error">{joinError ?? 'This invite link is missing or invalid.'}</p>
          <p>The link may have expired, the host may have ended the stream, or it was copied incompletely. Ask the host to send you a fresh link.</p>
          <button type="button" className="guest-primary" onClick={() => window.location.reload()}>
            Try the link again
          </button>
        </main>
      )}

      {mode === 'ready-to-join' && (
        <div className="guest-join">
          <div className="guest-preview">
            <div className="studio-video-wrap guest-preview-frame">
              <video ref={setLocalVideoEl} autoPlay muted playsInline className="studio-local-video" />
              {!previewError && <BirdLoader loading={!previewing} label="Requesting camera & mic access…" />}
              {previewing && (
                <span className="guest-ready-chip">
                  <span className="guest-status-dot" aria-hidden="true" /> Camera and mic ready
                </span>
              )}
              {previewing && (
                <div className="guest-preview-controls">
                  <button type="button" className="guest-round" onClick={actions.toggleMic} aria-pressed={!micEnabled} title={micEnabled ? 'Mute mic' : 'Unmute mic'}>
                    {micEnabled ? <Mic size={20} aria-hidden="true" /> : <MicOff size={20} aria-hidden="true" />} <span>{micEnabled ? 'Mute mic' : 'Unmute mic'}</span>
                  </button>
                  <button type="button" className="guest-round" onClick={actions.toggleCamera} aria-pressed={!cameraEnabled} title={cameraEnabled ? 'Disable camera' : 'Enable camera'}>
                    {cameraEnabled ? <Video size={20} aria-hidden="true" /> : <VideoOff size={20} aria-hidden="true" />} <span>{cameraEnabled ? 'Disable camera' : 'Enable camera'}</span>
                  </button>
                </div>
              )}
              {previewError && (
                <section className="guest-perm" role="alert">
                  <div className="guest-perm-icon" aria-hidden="true">
                    <CameraOff size={30} />
                  </div>
                  <h2>We can’t use your camera or microphone</h2>
                  <p className="error">{previewError}</p>
                  <button type="button" className="guest-primary" onClick={() => void actions.startPreview()}>
                    Try again
                  </button>
                </section>
              )}
            </div>
          </div>

          <main className="guest-form">
            <h2 className="guest-form-title">Check your camera &amp; mic before joining</h2>
            <p className="guest-form-sub">No account needed. Pick your name, check yourself in the preview, then join.</p>
            <label htmlFor="displayName">Your name</label>
            <input
              id="displayName"
              type="text"
              placeholder="e.g. Alex"
              maxLength={100}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            {passwordRequired && (
              <>
                <label htmlFor="invitePassword">Invite password</label>
                <input
                  id="invitePassword"
                  type="password"
                  value={password}
                  aria-invalid={joinError ? true : undefined}
                  aria-describedby={joinError ? 'guestJoinError' : undefined}
                  className={joinError ? 'guest-invalid' : undefined}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </>
            )}
            {joinError && (
              <p id="guestJoinError" className="error guest-error" role="alert">
                <AlertCircle size={16} aria-hidden="true" /> {joinError}
              </p>
            )}
            <button
              type="button"
              className="guest-primary guest-join-btn"
              disabled={joining}
              onClick={() => void actions.join(displayName.trim() || 'Guest', passwordRequired ? password : undefined)}
            >
              {joining && <BirdBusy />} Join
            </button>
            <p className="guest-fine">By joining you agree your camera and voice may be broadcast live.</p>
          </main>
        </div>
      )}

      {inCall && (
        <div className="guest-call">
          <div className="meeting-grid">
            <div className="meeting-tile meeting-tile--self">
              <video ref={setLocalVideoEl} autoPlay muted playsInline />
              <span className="meeting-tile-name"><NameBadge name="You" size={20} /><span>You</span></span>
            </div>
            {tiles.map((tile) => (
              <div key={tile.participantId} className="meeting-tile">
                <MediaStreamVideo stream={tile.stream} unmute />
                <span className="meeting-tile-name"><NameBadge name={tile.displayName} size={20} /><span>{tile.displayName}</span></span>
              </div>
            ))}
          </div>
          <div className="studio-toolbar guest-call-bar" role="toolbar" aria-label="Call controls">
            <button type="button" className="icon-btn guest-round" onClick={actions.toggleMic} aria-pressed={!micEnabled}>
              {micEnabled ? <Mic size={20} aria-hidden="true" /> : <MicOff size={20} aria-hidden="true" />} <span>{micEnabled ? 'Mute mic' : 'Unmute mic'}</span>
            </button>
            <button type="button" className="icon-btn guest-round" onClick={actions.toggleCamera} aria-pressed={!cameraEnabled}>
              {cameraEnabled ? <Video size={20} aria-hidden="true" /> : <VideoOff size={20} aria-hidden="true" />} <span>{cameraEnabled ? 'Disable camera' : 'Enable camera'}</span>
            </button>
            <button type="button" className="icon-btn guest-leave" onClick={actions.leave}>
              <LogOut size={18} aria-hidden="true" /> Leave room
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
