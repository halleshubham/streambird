import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { resolveInvite, getTurnCredentials } from '../api/studio';
import { ApiError } from '../api/client';

// Explicit rather than relying on browser defaults -- VDO.Ninja (a mature
// WebRTC production tool) leans on exactly these three constraints as its
// primary defense for participants on speakers rather than headphones.
const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
// Fallback only -- see iceServersRef. STUN alone cannot traverse every
// NAT/firewall a peer might be behind; Cloudflare-issued TURN credentials
// are fetched below and used for every RTCPeerConnection in this file.
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export type GuestMode = 'checking-invite' | 'invite-invalid' | 'ready-to-join' | 'in-call';

export interface MonitorVideoTile {
  participantId: string;
  displayName: string;
  stream: MediaStream;
}

/**
 * Ported from web/guest.js -- same protocol logic (upload connection to the
 * host, separate mix-minus room-monitor connection, the addTransceiver
 * `streams` fix, the muted-then-unmute autoplay workaround), moved behind a
 * hook so the page can render it with React instead of direct DOM calls.
 */
export function useGuestStudio(token: string | undefined) {
  const [mode, setMode] = useState<GuestMode>(token ? 'checking-invite' : 'invite-invalid');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [callStatus, setCallStatus] = useState('Connecting…');
  const [callIsError, setCallIsError] = useState(false);
  const [monitorStatus, setMonitorStatus] = useState('Waiting to connect…');
  const [monitorTiles, setMonitorTiles] = useState<MonitorVideoTile[]>([]);
  // True for the brief window between a monitor-offer arriving (the host
  // fully tears down and recreates this connection on every roster change
  // -- see useHostStudio's refreshAllMonitorFeeds) and it reconnecting, so
  // the UI can show "updating" instead of a silent blank grid every time
  // some OTHER participant joins or leaves.
  const [monitorReconnecting, setMonitorReconnecting] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [joining, setJoining] = useState(false);
  // Pre-join ("green room") preview state -- distinct from `joining`/`mode`
  // since acquiring the camera happens BEFORE the guest clicks Join, while
  // still on the 'ready-to-join' screen, so they can check their framing
  // and mute status first. `previewing` is set directly after the getUserMedia
  // call succeeds (not after mode flips to 'in-call', which only happens
  // once Join is actually clicked).
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const localVideoElRef = useRef<HTMLVideoElement | null>(null);
  const monitorAudioElRef = useRef<HTMLAudioElement | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>(DEFAULT_ICE_SERVERS);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const monitorPcRef = useRef<RTCPeerConnection | null>(null);
  const hostSocketIdRef = useRef<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const leavingRef = useRef(false);
  const monitorTilesRef = useRef<Map<string, MonitorVideoTile>>(new Map());

  function setLocalVideoEl(el: HTMLVideoElement | null) {
    localVideoElRef.current = el;
    if (el && localStreamRef.current) el.srcObject = localStreamRef.current;
  }

  function setMonitorAudioEl(el: HTMLAudioElement | null) {
    monitorAudioElRef.current = el;
  }

  function setupPeerConnection(localStream: MediaStream): RTCPeerConnection {
    const conn = new RTCPeerConnection({ iceServers: iceServersRef.current });

    for (const track of localStream.getTracks()) {
      conn.addTrack(track, localStream);
    }

    conn.onicecandidate = (event) => {
      if (event.candidate && hostSocketIdRef.current) {
        socketRef.current?.emit('signal', {
          to: hostSocketIdRef.current,
          type: 'ice-candidate',
          payload: event.candidate,
        });
      }
    };

    // Reported to the server (see StudioSignalingGateway's 'rtc-state'
    // handler) so a guest whose publish connection fails to ever carry
    // media -- the exact gap TURN (see iceServersRef) was added to close
    // -- actually shows up in production logs as an ongoing health
    // signal, instead of only a UI status string nobody necessarily saw
    // at the time.
    conn.oniceconnectionstatechange = () => {
      socketRef.current?.emit('rtc-state', {
        about: 'host',
        iceConnectionState: conn.iceConnectionState,
        connectionState: conn.connectionState,
      });
    };
    conn.onconnectionstatechange = () => {
      socketRef.current?.emit('rtc-state', {
        about: 'host',
        iceConnectionState: conn.iceConnectionState,
        connectionState: conn.connectionState,
      });
      // pc.close() (deliberate leave, or a kick) fires this asynchronously
      // -- without this guard it overwrites the "removed by host"/"you
      // left" message with a generic "Connection: closed" moments later.
      if (leavingRef.current) return;
      setCallStatus(`Connection: ${conn.connectionState}`);
    };

    return conn;
  }

  const handleRequestOffer = useCallback(async (fromSocketId: string, localStream: MediaStream) => {
    hostSocketIdRef.current = fromSocketId;
    const pc = setupPeerConnection(localStream);
    pcRef.current = pc;

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current?.emit('signal', { to: fromSocketId, type: 'offer', payload: offer });
  }, []);

  async function handleAnswer(payload: RTCSessionDescriptionInit) {
    if (!pcRef.current) return;
    await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload));
    setCallStatus('Connected — you are live in the studio.');
    setCallIsError(false);
  }

  async function handleIceCandidate(payload: RTCIceCandidateInit) {
    if (!pcRef.current) return;
    try {
      await pcRef.current.addIceCandidate(new RTCIceCandidate(payload));
    } catch (err) {
      console.warn('Failed to add ICE candidate', err);
    }
  }

  function clearVideoTiles() {
    monitorTilesRef.current.clear();
    setMonitorTiles([]);
  }

  function upsertVideoTile(participantId: string, displayName: string, stream: MediaStream) {
    monitorTilesRef.current.set(participantId, { participantId, displayName, stream });
    setMonitorTiles([...monitorTilesRef.current.values()]);
  }

  // ---- Room monitor: a second, dedicated peer connection carrying this
  // guest's personal mix-minus audio feed (everyone else's mic, never their
  // own) plus every other participant's video, back from the host. See
  // useHostStudio's refreshAllMonitorFeeds for why the host fully recreates
  // this connection (not an in-place renegotiation) every time the room's
  // video roster changes -- the tile grid here is wiped and rebuilt from
  // scratch on every offer for the same reason, not tracked incrementally.
  const handleMonitorOffer = useCallback(async (
    fromSocketId: string,
    payload: { sdp: RTCSessionDescriptionInit; participantsByMid?: Record<string, { participantId: string; displayName: string }> },
  ) => {
    const offer = payload.sdp;
    const participantsByMid = payload.participantsByMid ?? {};

    setMonitorStatus('Room monitor offer received — connecting…');
    setMonitorReconnecting(true);
    clearVideoTiles();

    try {
      monitorPcRef.current?.close();
      const monitorPc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      monitorPcRef.current = monitorPc;

      monitorPc.ontrack = (event) => {
        // Confirmed live: event.streams can be empty if the sender didn't
        // pass an explicit `streams` array to addTransceiver -- never trust
        // event.streams[0] to be populated, fall back to the bare track
        // (matches VDO.Ninja's own ontrack handler).
        const incomingStream = event.streams?.[0] ?? new MediaStream([event.track]);

        if (event.track.kind === 'video') {
          const mid = event.transceiver?.mid;
          const info = mid ? participantsByMid[mid] : null;
          upsertVideoTile(info?.participantId ?? event.track.id, info?.displayName ?? 'Participant', incomingStream);
          return;
        }

        const audioEl = monitorAudioElRef.current;
        if (audioEl && audioEl.srcObject !== incomingStream) {
          audioEl.srcObject = incomingStream;
          // Starting muted and unmuting right after is the standard
          // workaround for unmuted-autoplay blocking: browsers always allow
          // muted autoplay, and (unlike *starting* unmuted playback) simply
          // flipping .muted off on already-rolling media generally isn't
          // re-blocked.
          audioEl.muted = true;
          audioEl
            .play()
            .then(() => {
              audioEl.muted = false;
              setMonitorStatus('Room monitor: connected');
            })
            .catch(() => {
              const resume = () => {
                audioEl.muted = false;
                audioEl.play().catch(() => {});
                document.removeEventListener('click', resume);
              };
              document.addEventListener('click', resume, { once: true });
              setMonitorStatus('Tap anywhere to enable the room monitor.');
            });
        }
      };
      monitorPc.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current?.emit('signal', { to: fromSocketId, type: 'monitor-ice-candidate', payload: event.candidate });
        }
      };
      monitorPc.onconnectionstatechange = () => {
        // 'connected' is reported once ontrack's own play()/mute-unmute
        // settles, so as not to clobber a still-pending tap-to-enable
        // prompt with a falsely-reassuring "connected".
        if (monitorPc.connectionState === 'connected') {
          setMonitorReconnecting(false);
          return;
        }
        setMonitorStatus(`Room monitor: ${monitorPc.connectionState}`);
      };

      await monitorPc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await monitorPc.createAnswer();
      await monitorPc.setLocalDescription(answer);
      socketRef.current?.emit('signal', { to: fromSocketId, type: 'monitor-answer', payload: answer });
    } catch (err) {
      setMonitorStatus(`Room monitor failed to connect: ${(err as Error).message}`);
      setMonitorReconnecting(false);
      console.error('Room monitor negotiation failed', err);
    }
  }, []);

  async function handleMonitorIceCandidate(payload: RTCIceCandidateInit) {
    if (!monitorPcRef.current) return;
    try {
      await monitorPcRef.current.addIceCandidate(new RTCIceCandidate(payload));
    } catch (err) {
      console.warn('Failed to add ICE candidate for the room monitor', err);
    }
  }

  function stopLocalMedia() {
    leavingRef.current = true;
    pcRef.current?.close();
    pcRef.current = null;
    monitorPcRef.current?.close();
    monitorPcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    // Null it out (not just stopped) -- otherwise startPreview()'s "already
    // have a stream" guard would see this now-dead MediaStream object and
    // skip re-acquiring a fresh one after a leave-then-rejoin.
    localStreamRef.current = null;
    setPreviewing(false);
    socketRef.current?.disconnect();
    if (monitorAudioElRef.current) monitorAudioElRef.current.srcObject = null;
    clearVideoTiles();
    setMonitorReconnecting(false);
  }

  function handleKicked() {
    setCallStatus('You were removed from the room by the host.');
    setCallIsError(true);
    stopLocalMedia();
  }

  /**
   * Acquires the camera/mic as soon as the guest lands on the 'ready-to-join'
   * screen, so they can see their own framing and check mute status before
   * ever actually joining the stage -- a standard "green room" pattern.
   * Idempotent: a second call while a stream is already held is a no-op,
   * so re-running this on every render (e.g. via an effect) is safe.
   */
  const startPreview = useCallback(async () => {
    if (localStreamRef.current) return;
    setPreviewError(null);
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: AUDIO_CONSTRAINTS });
      localStreamRef.current = localStream;
      if (localVideoElRef.current) localVideoElRef.current.srcObject = localStream;
      setPreviewing(true);
    } catch (err) {
      setPreviewError(`Could not access camera/mic: ${(err as Error).message}`);
    }
  }, []);

  const join = useCallback(async (displayName: string, password?: string) => {
    if (!token) return;
    setJoining(true);
    setJoinError(null);

    try {
      await resolveInvite(token);
    } catch (err) {
      setJoinError(err instanceof ApiError ? err.message : 'This invite is no longer valid.');
      setJoining(false);
      return;
    }

    // Reuse the preview's already-acquired stream when there is one (the
    // common case -- startPreview runs as soon as this screen loads) rather
    // than calling getUserMedia a second time, which would both be
    // redundant and transiently drop the preview's video while the new
    // permission prompt/grant round-trips.
    let localStream = localStreamRef.current;
    if (!localStream) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: AUDIO_CONSTRAINTS });
      } catch (err) {
        setJoinError(`Could not access camera/mic: ${(err as Error).message}`);
        setJoining(false);
        return;
      }
    }

    localStreamRef.current = localStream;
    if (localVideoElRef.current) localVideoElRef.current.srcObject = localStream;
    setMode('in-call');
    setCallStatus('Joining…');
    setCallIsError(false);

    const socket = io('/studio', { auth: { role: 'guest', token, displayName, password } });
    socketRef.current = socket;

    socket.on('joined', () => setCallStatus('Joined — waiting for the host to connect…'));

    socket.on('signal', async (msg: { from: string; type: string; payload: unknown }) => {
      if (msg.type === 'request-offer') {
        await handleRequestOffer(msg.from, localStream);
      } else if (msg.type === 'answer') {
        await handleAnswer(msg.payload as RTCSessionDescriptionInit);
      } else if (msg.type === 'ice-candidate') {
        await handleIceCandidate(msg.payload as RTCIceCandidateInit);
      } else if (msg.type === 'monitor-offer') {
        await handleMonitorOffer(
          msg.from,
          msg.payload as { sdp: RTCSessionDescriptionInit; participantsByMid?: Record<string, { participantId: string; displayName: string }> },
        );
      } else if (msg.type === 'monitor-ice-candidate') {
        await handleMonitorIceCandidate(msg.payload as RTCIceCandidateInit);
      } else if (msg.type === 'kicked') {
        handleKicked();
      }
    });

    socket.on('error', (err: Error) => {
      setCallStatus(`Error: ${err.message}`);
      setCallIsError(true);
    });

    socket.on('disconnect', () => {
      setCallStatus('Disconnected from the studio.');
    });

    setJoining(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, handleRequestOffer, handleMonitorOffer]);

  function toggleMic() {
    if (!localStreamRef.current) return;
    const next = !micEnabled;
    localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = next; });
    setMicEnabled(next);
  }

  function toggleCamera() {
    if (!localStreamRef.current) return;
    const next = !cameraEnabled;
    localStreamRef.current.getVideoTracks().forEach((t) => { t.enabled = next; });
    setCameraEnabled(next);
  }

  function leave() {
    setCallStatus('You left the room.');
    setCallIsError(false);
    stopLocalMedia();
    setMode('ready-to-join');
  }

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setMode('invite-invalid');
      return;
    }
    // Fired in parallel, not chained after invite resolution -- so
    // iceServersRef is as likely as possible to already hold real TURN
    // credentials by the time this guest actually publishes. Never blocks
    // anything: a slow/failed fetch just leaves DEFAULT_ICE_SERVERS in
    // place (STUN-only).
    getTurnCredentials()
      .then((res) => {
        if (!cancelled && res.iceServers?.length) iceServersRef.current = res.iceServers;
      })
      .catch(() => {});
    resolveInvite(token)
      .then((res) => {
        if (cancelled) return;
        setPasswordRequired(res.passwordRequired);
        setMode('ready-to-join');
      })
      .catch((err) => {
        if (cancelled) return;
        setJoinError(err instanceof ApiError ? err.message : 'This invite is no longer valid.');
        setMode('invite-invalid');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Auto-starts the green-room preview the moment the join screen is ready
  // (and again after a leave-then-return, since stopLocalMedia resets
  // `previewing`) -- the guest shouldn't have to click a separate button
  // just to see their own camera before deciding to join.
  useEffect(() => {
    if (mode === 'ready-to-join') {
      void startPreview();
    }
  }, [mode, startPreview]);

  return {
    mode,
    joinError,
    passwordRequired,
    previewing,
    previewError,
    callStatus,
    callIsError,
    monitorStatus,
    monitorTiles,
    monitorReconnecting,
    micEnabled,
    cameraEnabled,
    joining,
    refs: { setLocalVideoEl, setMonitorAudioEl },
    actions: { join, toggleMic, toggleCamera, leave, startPreview },
  };
}
