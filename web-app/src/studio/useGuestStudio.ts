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

export interface PeerTile {
  participantId: string;
  displayName: string;
  stream: MediaStream;
}

/**
 * Full mesh: this guest opens one bidirectional RTCPeerConnection per
 * *other* participant (host and every other guest alike) -- see
 * StudioSignalingGateway's own doc comment for why the signaling relay
 * already supports this topology unchanged. Direction convention, kept
 * consistent with useHostStudio's existing 'peer-joined' handler so a
 * newcomer and an already-present participant never both try to offer
 * the same pair at once: whoever is already in the room sends
 * 'request-offer' to the newcomer; the newcomer is always the one who
 * actually creates the offer, in response, for each requester.
 */
export function useGuestStudio(token: string | undefined) {
  const [mode, setMode] = useState<GuestMode>(token ? 'checking-invite' : 'invite-invalid');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [callStatus, setCallStatus] = useState('Connecting…');
  const [callIsError, setCallIsError] = useState(false);
  const [tiles, setTiles] = useState<PeerTile[]>([]);
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
  const iceServersRef = useRef<RTCIceServer[]>(DEFAULT_ICE_SERVERS);

  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const peerDisplayNamesRef = useRef<Map<string, string>>(new Map());
  const tilesRef = useRef<Map<string, PeerTile>>(new Map());
  const myDisplayNameRef = useRef('Guest');
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const leavingRef = useRef(false);

  function setLocalVideoEl(el: HTMLVideoElement | null) {
    localVideoElRef.current = el;
    if (el && localStreamRef.current) el.srcObject = localStreamRef.current;
  }

  function upsertTile(participantId: string, stream: MediaStream) {
    const displayName = peerDisplayNamesRef.current.get(participantId) ?? 'Participant';
    tilesRef.current.set(participantId, { participantId, displayName, stream });
    setTiles([...tilesRef.current.values()]);
  }

  function removeTile(participantId: string) {
    tilesRef.current.delete(participantId);
    setTiles([...tilesRef.current.values()]);
  }

  function closePeer(peerId: string) {
    peerConnectionsRef.current.get(peerId)?.close();
    peerConnectionsRef.current.delete(peerId);
    removeTile(peerId);
  }

  function createPeerConnection(peerId: string, localStream: MediaStream): RTCPeerConnection {
    peerConnectionsRef.current.get(peerId)?.close();
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    peerConnectionsRef.current.set(peerId, pc);

    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }

    pc.ontrack = (event) => {
      // Confirmed live (room-monitor's own ontrack carried the same note):
      // event.streams can be empty if the sender didn't pass an explicit
      // `streams` array to addTrack/addTransceiver -- never trust
      // event.streams[0] to be populated, fall back to the bare track.
      const incomingStream = event.streams?.[0] ?? new MediaStream([event.track]);
      upsertTile(peerId, incomingStream);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('signal', { to: peerId, type: 'ice-candidate', payload: event.candidate });
      }
    };

    // Reported to the server (see StudioSignalingGateway's 'rtc-state'
    // handler) so a connection that fails to ever carry media actually
    // shows up in production logs as an ongoing health signal, instead of
    // only a UI status string nobody necessarily saw at the time.
    const reportRtcState = () => {
      socketRef.current?.emit('rtc-state', {
        about: peerId,
        iceConnectionState: pc.iceConnectionState,
        connectionState: pc.connectionState,
      });
    };
    pc.oniceconnectionstatechange = reportRtcState;
    pc.onconnectionstatechange = () => {
      reportRtcState();
      // pc.close() (deliberate leave, or a kick) fires this asynchronously
      // -- without this guard it could overwrite the "removed by host"/
      // "you left" message with a generic status moments later.
      if (leavingRef.current) return;
      if (pc.connectionState === 'connected') {
        setCallStatus('Connected — you are live in the studio.');
        setCallIsError(false);
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        closePeer(peerId);
      }
    };

    return pc;
  }

  const handleRequestOffer = useCallback(
    async (fromSocketId: string, fromDisplayName: string | undefined, localStream: MediaStream) => {
      if (fromDisplayName) peerDisplayNamesRef.current.set(fromSocketId, fromDisplayName);
      const pc = createPeerConnection(fromSocketId, localStream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current?.emit('signal', { to: fromSocketId, type: 'offer', payload: offer });
    },
    [],
  );

  const handlePeerOffer = useCallback(
    async (fromSocketId: string, offer: RTCSessionDescriptionInit, localStream: MediaStream) => {
      const pc = createPeerConnection(fromSocketId, localStream);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current?.emit('signal', { to: fromSocketId, type: 'answer', payload: answer });
    },
    [],
  );

  async function handleAnswer(fromSocketId: string, payload: RTCSessionDescriptionInit) {
    const pc = peerConnectionsRef.current.get(fromSocketId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(payload));
  }

  async function handleIceCandidate(fromSocketId: string, payload: RTCIceCandidateInit) {
    const pc = peerConnectionsRef.current.get(fromSocketId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(payload));
    } catch (err) {
      console.warn('Failed to add ICE candidate', err);
    }
  }

  function stopLocalMedia() {
    leavingRef.current = true;
    for (const pc of peerConnectionsRef.current.values()) pc.close();
    peerConnectionsRef.current.clear();
    tilesRef.current.clear();
    setTiles([]);
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    // Null it out (not just stopped) -- otherwise startPreview()'s "already
    // have a stream" guard would see this now-dead MediaStream object and
    // skip re-acquiring a fresh one after a leave-then-rejoin.
    localStreamRef.current = null;
    setPreviewing(false);
    socketRef.current?.disconnect();
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
    myDisplayNameRef.current = displayName || 'Guest';

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

    socket.on('joined', () => setCallStatus('Joined — waiting for others to connect…'));

    socket.on('peer-joined', ({ socketId, displayName: peerName }: { socketId: string; displayName: string }) => {
      peerDisplayNamesRef.current.set(socketId, peerName || 'Guest');
      socket.emit('signal', {
        to: socketId,
        type: 'request-offer',
        payload: { displayName: myDisplayNameRef.current },
      });
    });

    socket.on('peer-left', ({ socketId, role }: { socketId: string; role?: string }) => {
      closePeer(socketId);
      if (role === 'host' && !leavingRef.current) {
        // The host is expected to reload/reconnect with the same link --
        // our own connection stays up and they'll re-request our video.
        setCallStatus('The host disconnected — hang tight, they should be back shortly.');
        setCallIsError(true);
      }
    });

    socket.on('signal', async (msg: { from: string; type: string; payload: unknown }) => {
      if (msg.type === 'request-offer') {
        const payload = msg.payload as { displayName?: string } | undefined;
        await handleRequestOffer(msg.from, payload?.displayName, localStream);
      } else if (msg.type === 'offer') {
        await handlePeerOffer(msg.from, msg.payload as RTCSessionDescriptionInit, localStream);
      } else if (msg.type === 'answer') {
        await handleAnswer(msg.from, msg.payload as RTCSessionDescriptionInit);
      } else if (msg.type === 'ice-candidate') {
        await handleIceCandidate(msg.from, msg.payload as RTCIceCandidateInit);
      } else if (msg.type === 'kicked') {
        handleKicked();
      }
    });

    socket.on('error', (err: Error) => {
      setCallStatus(`Error: ${err.message}`);
      setCallIsError(true);
    });

    socket.on('disconnect', (reason) => {
      if (leavingRef.current || reason === 'io client disconnect') {
        setCallStatus('Disconnected from the studio.');
      } else {
        // socket.io reconnects on its own with the same invite token.
        setCallStatus('Connection lost — reconnecting…');
        setCallIsError(true);
      }
    });

    socket.io.on('reconnect', () => {
      setCallStatus('Reconnected — rejoining the studio…');
      setCallIsError(false);
    });

    setJoining(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, handleRequestOffer, handlePeerOffer]);

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
    tiles,
    micEnabled,
    cameraEnabled,
    joining,
    refs: { setLocalVideoEl },
    actions: { join, toggleMic, toggleCamera, leave, startPreview },
  };
}
