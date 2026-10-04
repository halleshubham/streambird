import { NameBadge } from '../../components/NameBadge';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Mic, MicOff, Video, VideoOff, LogOut } from 'lucide-react';
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

  return (
    <div className={`studio-page${mode === 'in-call' ? '' : ' studio-page--narrow'}`}>
      <h1 className="brand-heading">
        <img src="/logo.png" alt="" className="brand-logo" /> Join as a guest
      </h1>

      {mode === 'checking-invite' && <BirdLoader loading compact label="Checking your invite…" />}

      {mode === 'invite-invalid' && <p className="error">{joinError ?? 'This invite link is missing or invalid.'}</p>}

      {mode === 'ready-to-join' && (
        <div className="panel">
          <label>Check your camera &amp; mic before joining</label>
          <div className="studio-video-wrap">
            <video ref={setLocalVideoEl} autoPlay muted playsInline className="studio-local-video" />
            {!previewError && <BirdLoader loading={!previewing} label="Requesting camera & mic access…" />}
          </div>
          {previewing ? (
            <div className="studio-toolbar">
              <button type="button" className="icon-btn" onClick={actions.toggleMic}>
                {micEnabled ? <Mic size={16} /> : <MicOff size={16} />} {micEnabled ? 'Mute mic' : 'Unmute mic'}
              </button>
              <button type="button" className="icon-btn" onClick={actions.toggleCamera}>
                {cameraEnabled ? <Video size={16} /> : <VideoOff size={16} />} {cameraEnabled ? 'Disable camera' : 'Enable camera'}
              </button>
            </div>
          ) : previewError ? (
            <>
              <p className="error">{previewError}</p>
              <button type="button" className="link-button" onClick={() => void actions.startPreview()}>
                Try again
              </button>
            </>
          ) : null}

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
                onChange={(e) => setPassword(e.target.value)}
              />
            </>
          )}
          <button
            type="button"
            disabled={joining}
            onClick={() => void actions.join(displayName.trim() || 'Guest', passwordRequired ? password : undefined)}
          >
            {joining && <BirdBusy />} Join
          </button>
          {joinError && <p className="error">{joinError}</p>}
        </div>
      )}

      {mode === 'in-call' && (
        <div className="panel">
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
          <div className="studio-toolbar">
            <button type="button" className="icon-btn" onClick={actions.toggleMic}>
              {micEnabled ? <Mic size={16} /> : <MicOff size={16} />} {micEnabled ? 'Mute mic' : 'Unmute mic'}
            </button>
            <button type="button" className="icon-btn" onClick={actions.toggleCamera}>
              {cameraEnabled ? <Video size={16} /> : <VideoOff size={16} />} {cameraEnabled ? 'Disable camera' : 'Enable camera'}
            </button>
            <button type="button" className="icon-btn icon-btn--danger" onClick={actions.leave}>
              <LogOut size={16} /> Leave room
            </button>
          </div>
          <p className={`status${callIsError ? ' error' : ''}`}>
            {isInProgress(callStatus) && <BirdBusy />}
            {callStatus}
          </p>
        </div>
      )}
    </div>
  );
}
