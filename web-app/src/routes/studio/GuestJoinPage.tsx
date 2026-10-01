import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Mic, MicOff, Video, VideoOff, LogOut } from 'lucide-react';
import { useGuestStudio } from '../../studio/useGuestStudio';
import { MediaStreamVideo } from '../../components/MediaStreamVideo';

export function GuestJoinPage() {
  const { token } = useParams<{ token: string }>();
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const {
    mode,
    joinError,
    passwordRequired,
    callStatus,
    callIsError,
    monitorStatus,
    monitorTiles,
    micEnabled,
    cameraEnabled,
    joining,
    refs,
    actions,
  } = useGuestStudio(token);
  const { setLocalVideoEl, setMonitorAudioEl } = refs;

  return (
    <div className="studio-page studio-page--narrow">
      <h1 className="brand-heading">
        <img src="/logo.png" alt="" className="brand-logo" /> Join as a guest
      </h1>

      {mode === 'checking-invite' && <p className="status">Checking invite…</p>}

      {mode === 'invite-invalid' && <p className="error">{joinError ?? 'This invite link is missing or invalid.'}</p>}

      {mode === 'ready-to-join' && (
        <div className="panel">
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
            {joining ? 'Joining…' : 'Join'}
          </button>
          {joinError && <p className="error">{joinError}</p>}
        </div>
      )}

      {mode === 'in-call' && (
        <>
          <div className="panel">
            <label>Your camera</label>
            <video ref={setLocalVideoEl} autoPlay muted playsInline className="studio-local-video" />
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
            <p className={`status${callIsError ? ' error' : ''}`}>{callStatus}</p>
          </div>

          <div className="panel">
            <label>Room feed (everyone else in the room — never your own camera/mic)</label>
            {monitorTiles.length > 0 && (
              <div className="monitor-video-grid">
                {monitorTiles.map((tile) => (
                  <div key={tile.participantId} className="monitor-video-tile">
                    <MediaStreamVideo stream={tile.stream} muted />
                    <span className="monitor-video-tile-name">{tile.displayName}</span>
                  </div>
                ))}
              </div>
            )}
            <audio ref={setMonitorAudioEl} autoPlay />
            <p className="status">{monitorStatus}</p>
          </div>
        </>
      )}
    </div>
  );
}
