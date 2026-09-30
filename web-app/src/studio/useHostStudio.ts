import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getStream } from '../api/streams';
import { mintHostToken, createInvite, updateLayout } from '../api/studio';
import { ApiError } from '../api/client';
import type { Stream } from '../types/api';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
// Explicit rather than relying on browser defaults -- VDO.Ninja (a mature
// WebRTC production tool) leans on exactly these three constraints as its
// primary defense for participants on speakers rather than headphones.
const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

export type LayoutMode = 'grid' | 'spotlight';

interface Participant {
  id: string; // 'local' or a guest's socketId
  pc: RTCPeerConnection | null; // null for 'local' -- it never negotiates with itself
  videoEl: HTMLVideoElement; // never mounted in the DOM tree -- pure canvas.drawImage source, same as the original vanilla build
  displayName: string;
  videoTrack: MediaStreamTrack | null;
  audioTrack: MediaStreamTrack | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

export interface ParticipantView {
  id: string;
  displayName: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  isLocal: boolean;
  isScreenShare: boolean;
}

export interface Branding {
  logoSize: number;
  newsText: string;
  nameFontSize: number;
}

/** A named, saved bundle of layout + branding settings -- session-lifetime only (see useHostStudio scenes state). */
export interface Scene {
  name: string;
  layoutMode: LayoutMode;
  branding: Branding;
}

// The screen-share track lives in the same participantsRef Map as every
// real guest/host entry (so it rides the existing grid/spotlight draw loop
// and the generic per-guest room-monitor relay for free) but under this
// clearly-synthetic key, never a real socket id.
const SCREEN_SHARE_ID = 'screen-share';

/**
 * All of the imperative WebRTC/Web Audio/canvas-compositing logic from the
 * original web/host.js, ported behind a hook -- the underlying protocol
 * logic is unchanged (same event-driven design, same mix-minus room
 * monitor, same fixes for the bugs found tonight), only the UI layer moved
 * to React. Heavy mutable state (peer connections, audio graph nodes, the
 * canvas draw loop) stays in refs exactly like the vanilla module-level
 * variables it replaces; only what the UI needs to render is React state.
 */
export function useHostStudio(streamId: string | undefined) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [stream, setStream] = useState<Stream | null>(null);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);
  const [inviteMessage, setInviteMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [participantsView, setParticipantsView] = useState<ParticipantView[]>([]);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('grid');
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [ending, setEnding] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [branding, setBranding] = useState<Branding>({ logoSize: 90, newsText: '', nameFontSize: 14 });
  // Scenes only need to persist for the lifetime of this studio session --
  // in-memory React state, deliberately not persisted to the backend/DB.
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [activeSceneName, setActiveSceneName] = useState<string | null>(null);

  const hostTokenRef = useRef<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const participantsRef = useRef<Map<string, Participant>>(new Map());
  const pendingDisplayNamesRef = useRef<Map<string, string>>(new Map());
  const monitorConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const monitorFeedGenerationRef = useRef<Map<string, number>>(new Map());
  const monitorRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioSourceNodesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const guestMixMinusDestinationsRef = useRef<Map<string, MediaStreamAudioDestinationNode>>(new Map());
  const layoutModeRef = useRef<LayoutMode>('grid');
  const drawingRef = useRef(false);
  const brandingRef = useRef<Branding & { logoImg: HTMLImageElement | null }>({
    logoImg: null,
    logoSize: 90,
    newsText: '',
    nameFontSize: 14,
  });
  const newsScrollXRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const whipPcRef = useRef<RTCPeerConnection | null>(null);
  const whipResourceUrlRef = useRef<string | null>(null);
  const keyFrameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endingStreamRef = useRef(false);

  function renderParticipantList() {
    const view: ParticipantView[] = [...participantsRef.current.values()].map((p) => ({
      id: p.id,
      displayName: p.displayName,
      audioEnabled: p.audioEnabled,
      videoEnabled: p.videoEnabled,
      isLocal: p.id === 'local',
      isScreenShare: p.id === SCREEN_SHARE_ID,
    }));
    setParticipantsView(view);
  }

  // ---- Audio mixing (mix-minus) --------------------------------------
  //
  // Two different outputs draw on the same set of participant mic tracks:
  //  - audioDestinationRef: the full mix of everyone, incl. the host -- the
  //    audio half of the outbound WHIP publish.
  //  - one MediaStreamAudioDestinationNode per guest in
  //    guestMixMinusDestinationsRef, each fed by every source *except* that
  //    guest's own -- their personal room monitor. A single AudioNode can
  //    fan out to any number of destinations, so each participant's mic is
  //    captured into exactly one MediaStreamAudioSourceNode and then
  //    connected to the full mix plus every *other* guest's mix-minus node.

  function ensureAudioMix() {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
      audioDestinationRef.current = audioContextRef.current.createMediaStreamDestination();
    }
  }

  function connectAudioTrack(key: string, track: MediaStreamTrack | null | undefined) {
    if (!track) return;
    ensureAudioMix();
    if (audioSourceNodesRef.current.has(key)) return;

    const source = audioContextRef.current!.createMediaStreamSource(new MediaStream([track]));
    audioSourceNodesRef.current.set(key, source);

    source.connect(audioDestinationRef.current!);
    for (const [guestId, dest] of guestMixMinusDestinationsRef.current) {
      if (guestId !== key) source.connect(dest);
    }
  }

  /** Every guest gets everyone else's already-connected sources, never their own. */
  function ensureGuestMixMinus(guestSocketId: string): MediaStreamAudioDestinationNode {
    ensureAudioMix();
    const existing = guestMixMinusDestinationsRef.current.get(guestSocketId);
    if (existing) return existing;

    const dest = audioContextRef.current!.createMediaStreamDestination();
    guestMixMinusDestinationsRef.current.set(guestSocketId, dest);
    for (const [key, source] of audioSourceNodesRef.current) {
      if (key !== guestSocketId) source.connect(dest);
    }
    return dest;
  }

  function removeParticipantAudio(key: string) {
    audioSourceNodesRef.current.get(key)?.disconnect();
    audioSourceNodesRef.current.delete(key);
    guestMixMinusDestinationsRef.current.delete(key);
  }

  // ---- Room monitor ----------------------------------------------------
  //
  // Each guest gets a personal mix-minus audio feed (everyone else's mic,
  // never their own) plus every other participant's video, on its own
  // dedicated connection. Video has no equivalent "mix" -- the set of
  // tracks a guest needs changes every time someone joins, leaves, or
  // starts their camera -- so refreshAllMonitorFeeds() fully tears down and
  // recreates every guest's monitor connection from scratch whenever the
  // room's video roster changes, rather than renegotiating in place. A
  // brief reconnect blip per guest each time, but the same fresh
  // offer/answer path already proven reliable, not a second, riskier one.
  // Each video transceiver's mid is sent alongside the offer as the
  // correlation key so the guest's page knows whose video is whose.

  const startMonitorFeed = useCallback(async (socketId: string) => {
    const generation = (monitorFeedGenerationRef.current.get(socketId) ?? 0) + 1;
    monitorFeedGenerationRef.current.set(socketId, generation);

    try {
      stopMonitorFeed(socketId);
      const dest = ensureGuestMixMinus(socketId);
      const audioTrack = dest.stream.getAudioTracks()[0];
      if (!audioTrack) throw new Error('missing mix-minus audio track');

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      monitorConnectionsRef.current.set(socketId, pc);

      // addTransceiver(track, init) with no `streams` in init gives the
      // track an anonymous msid -- the connection negotiates fine but the
      // receiver's ontrack then fires with an *empty* event.streams.
      // Passing the stream explicitly (matching VDO.Ninja's own usage) is
      // the fix, confirmed live.
      pc.addTransceiver(audioTrack, { direction: 'sendonly', streams: [dest.stream] });

      const videoParticipants: { transceiver: RTCRtpTransceiver; participantId: string; displayName: string }[] = [];
      for (const [participantId, p] of participantsRef.current) {
        if (participantId === socketId) continue; // never send a guest their own video back
        if (!p.videoTrack || p.videoTrack.readyState !== 'live') continue;
        const transceiver = pc.addTransceiver(p.videoTrack, {
          direction: 'sendonly',
          streams: [new MediaStream([p.videoTrack])],
        });
        videoParticipants.push({ transceiver, participantId, displayName: p.displayName });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current?.emit('signal', { to: socketId, type: 'monitor-ice-candidate', payload: event.candidate });
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (monitorFeedGenerationRef.current.get(socketId) !== generation) {
        // A newer refresh already replaced us while we were negotiating.
        pc.close();
        return;
      }

      const participantsByMid: Record<string, { participantId: string; displayName: string }> = {};
      for (const { transceiver, participantId, displayName } of videoParticipants) {
        if (transceiver.mid) participantsByMid[transceiver.mid] = { participantId, displayName };
      }

      socketRef.current?.emit('signal', {
        to: socketId,
        type: 'monitor-offer',
        payload: { sdp: offer, participantsByMid },
      });
    } catch (err) {
      console.warn('Failed to start the room monitor feed for a guest', err);
      if (monitorFeedGenerationRef.current.get(socketId) === generation) {
        setStatus({ text: `Room monitor failed for a guest: ${(err as Error).message}`, isError: true });
        stopMonitorFeed(socketId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopMonitorFeed(socketId: string) {
    monitorConnectionsRef.current.get(socketId)?.close();
    monitorConnectionsRef.current.delete(socketId);
  }

  /**
   * Debounced: a guest joining, starting their camera, and their video
   * track arriving can all trigger this within milliseconds of each other.
   * Running it immediately every time meant each new round reset
   * connections that hadn't even finished negotiating the *previous* round
   * yet -- confirmed live (2026-10-01) via "Called in wrong state: stable"
   * errors, where a guest's answer for a just-superseded offer landed on
   * the brand-new pc that replaced it instead. The per-socketId generation
   * guard in startMonitorFeed stops a stale round from ever being *sent*,
   * but can't stop an already-sent offer's answer from arriving after the
   * round that sent it has already been superseded -- only giving each
   * round room to actually finish fixes that.
   */
  const refreshAllMonitorFeeds = useCallback(() => {
    if (monitorRefreshTimerRef.current) clearTimeout(monitorRefreshTimerRef.current);
    monitorRefreshTimerRef.current = setTimeout(() => {
      monitorRefreshTimerRef.current = null;
      for (const id of participantsRef.current.keys()) {
        if (id === 'local') continue;
        void startMonitorFeed(id);
      }
    }, 400);
  }, [startMonitorFeed]);

  // ---- Canvas compositing ----------------------------------------------

  function drawLogo() {
    const b = brandingRef.current;
    if (!b.logoImg) return;
    const scale = b.logoSize / b.logoImg.naturalHeight;
    ctxRef.current!.drawImage(b.logoImg, 16, 16, b.logoImg.naturalWidth * scale, b.logoSize);
  }

  function drawNewsline(w: number, h: number, now: number) {
    const b = brandingRef.current;
    if (!b.newsText) return;
    const ctx = ctxRef.current!;
    const barH = 36;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, h - barH, w, barH);

    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    const textWidth = ctx.measureText(b.newsText).width;

    if (newsScrollXRef.current === null) newsScrollXRef.current = w;
    const dt = lastFrameTimeRef.current === null ? 0 : now - lastFrameTimeRef.current;
    lastFrameTimeRef.current = now;

    newsScrollXRef.current -= dt * 0.08;
    if (newsScrollXRef.current + textWidth < 0) newsScrollXRef.current = w;

    ctx.fillText(b.newsText, newsScrollXRef.current, h - barH / 2);
  }

  function drawCell(p: Participant, x: number, y: number, w: number, h: number) {
    const ctx = ctxRef.current!;
    const vw = p.videoEl.videoWidth;
    const vh = p.videoEl.videoHeight;
    if (vw > 0 && vh > 0) {
      // "Contain" fit (like CSS object-fit: contain): scale the video's
      // native aspect ratio to fit entirely within the cell, centered, so
      // it's never stretched/squished -- any leftover space is left
      // undrawn, which naturally letterboxes/pillarboxes to the black
      // background the frame loop already filled behind everything.
      const scale = Math.min(w / vw, h / vh);
      const drawW = vw * scale;
      const drawH = vh * scale;
      const drawX = x + (w - drawW) / 2;
      const drawY = y + (h - drawH) / 2;
      ctx.drawImage(p.videoEl, drawX, drawY, drawW, drawH);
    }
    // else: video metadata not loaded yet -- skip drawing this frame rather
    // than stretching to fill or drawing garbage.

    const fontSize = brandingRef.current.nameFontSize;
    const boxH = Math.min(h, fontSize + 14);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x, y + h - boxH, w, boxH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y + h - boxH, w, boxH);
    ctx.clip();
    ctx.fillStyle = '#fff';
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(p.displayName, x + 6, y + h - boxH / 2);
    ctx.restore();
  }

  function drawGrid(entries: Participant[], w: number, h: number) {
    const cols = Math.ceil(Math.sqrt(entries.length));
    const rows = Math.ceil(entries.length / cols);
    void rows;
    const cellW = w / cols;
    const cellH = h / Math.ceil(entries.length / cols);
    entries.forEach((p, i) => {
      drawCell(p, (i % cols) * cellW, Math.floor(i / cols) * cellH, cellW, cellH);
    });
  }

  function drawSpotlight(entries: Participant[], w: number, h: number) {
    drawCell(entries[0], 0, 0, w, h);
    const thumbSize = w / 6;
    entries.slice(1).forEach((p, i) => {
      drawCell(p, w - thumbSize - 8, 8 + i * (thumbSize * 0.6 + 8), thumbSize, thumbSize * 0.6);
    });
  }

  function startDrawLoop() {
    if (drawingRef.current) return;
    drawingRef.current = true;

    function frame(now: number) {
      const canvas = canvasRef.current;
      if (!canvas) {
        requestAnimationFrame(frame);
        return;
      }
      // Lazily (re-)acquired here rather than in a one-time mount effect:
      // startDrawLoop() is kicked off from the stream-loading effect, which
      // runs while the page is still showing "Loading…" -- the <canvas>
      // element (gated on that same loading state) doesn't exist in the
      // DOM yet at that point, so an effect that only ever runs once on
      // mount grabs a null context and never retries. This self-heals the
      // moment the real canvas actually mounts.
      if (!ctxRef.current) {
        ctxRef.current = canvas.getContext('2d');
      }
      const ctx = ctxRef.current;
      if (!ctx) {
        requestAnimationFrame(frame);
        return;
      }
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);

      const entries = [...participantsRef.current.values()].filter((p) => p.videoEl.readyState >= 2);
      if (entries.length > 0) {
        if (layoutModeRef.current === 'spotlight') drawSpotlight(entries, w, h);
        else drawGrid(entries, w, h);
      }

      drawLogo();
      drawNewsline(w, h, now);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---- Guest signaling ---------------------------------------------------

  const handleGuestOffer = useCallback(async (fromSocketId: string, offer: RTCSessionDescriptionInit) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const videoEl = document.createElement('video');
    videoEl.muted = true;
    videoEl.autoplay = true;
    videoEl.playsInline = true;

    const displayName = pendingDisplayNamesRef.current.get(fromSocketId) || 'Guest';
    pendingDisplayNamesRef.current.delete(fromSocketId);
    participantsRef.current.set(fromSocketId, {
      id: fromSocketId,
      pc,
      videoEl,
      displayName,
      videoTrack: null,
      audioTrack: null,
      audioEnabled: true,
      videoEnabled: true,
    });
    renderParticipantList();

    pc.ontrack = (event) => {
      const p = participantsRef.current.get(fromSocketId);
      if (event.track.kind === 'video') {
        videoEl.srcObject = event.streams[0];
        videoEl.play().catch(() => {});
        if (p) {
          p.videoTrack = event.track;
          event.track.enabled = p.videoEnabled;
        }
        // A guest's video can arrive well after their own monitor feed was
        // first established -- refresh everyone's so it actually reaches
        // the rest of the room.
        refreshAllMonitorFeeds();
      } else if (event.track.kind === 'audio') {
        connectAudioTrack(fromSocketId, event.track);
        if (p) {
          p.audioTrack = event.track;
          event.track.enabled = p.audioEnabled;
        }
      }
      renderParticipantList();
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('signal', { to: fromSocketId, type: 'ice-candidate', payload: event.candidate });
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socketRef.current?.emit('signal', { to: fromSocketId, type: 'answer', payload: answer });

    refreshAllMonitorFeeds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshAllMonitorFeeds]);

  function connectSignaling(streamRow: Stream, hostToken: string) {
    const socket = io('/studio', {
      auth: {
        role: 'host',
        sessionId: streamRow.studioSessionId,
        hostToken,
        displayName: 'Host',
      },
    });
    socketRef.current = socket;

    socket.on('joined', () => setStatus({ text: 'Connected to the studio as host.', isError: false }));

    socket.on('disconnect', (reason) => {
      if (endingStreamRef.current) return;
      setStatus({ text: `Lost connection to studio signaling (${reason}) — reconnecting…`, isError: true });
    });
    socket.on('connect_error', (err) => {
      setStatus({ text: `Signaling connection failed: ${err.message}`, isError: true });
    });

    socket.on('peer-joined', ({ socketId, displayName }: { socketId: string; displayName: string }) => {
      setStatus({ text: `${displayName} joined — requesting their video…`, isError: false });
      pendingDisplayNamesRef.current.set(socketId, displayName || 'Guest');
      socket.emit('signal', { to: socketId, type: 'request-offer', payload: {} });
    });

    socket.on('peer-left', ({ socketId }: { socketId: string }) => {
      const p = participantsRef.current.get(socketId);
      if (p) {
        p.pc?.close();
        participantsRef.current.delete(socketId);
        renderParticipantList();
      }
      pendingDisplayNamesRef.current.delete(socketId);
      stopMonitorFeed(socketId);
      removeParticipantAudio(socketId);
      refreshAllMonitorFeeds();
    });

    socket.on('signal', async (msg: { from: string; type: string; payload: unknown }) => {
      if (msg.type === 'offer') {
        await handleGuestOffer(msg.from, msg.payload as RTCSessionDescriptionInit);
      } else if (msg.type === 'ice-candidate') {
        const p = participantsRef.current.get(msg.from);
        if (p?.pc) {
          try {
            await p.pc.addIceCandidate(new RTCIceCandidate(msg.payload as RTCIceCandidateInit));
          } catch (err) {
            console.warn('Failed to add ICE candidate from guest', err);
          }
        }
      } else if (msg.type === 'monitor-answer') {
        const monitorPc = monitorConnectionsRef.current.get(msg.from);
        if (monitorPc) {
          try {
            await monitorPc.setRemoteDescription(new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit));
          } catch (err) {
            console.warn('Failed to apply a room monitor answer (likely a superseded refresh)', err);
          }
        }
      } else if (msg.type === 'monitor-ice-candidate') {
        const monitorPc = monitorConnectionsRef.current.get(msg.from);
        if (monitorPc) {
          try {
            await monitorPc.addIceCandidate(new RTCIceCandidate(msg.payload as RTCIceCandidateInit));
          } catch (err) {
            console.warn("Failed to add ICE candidate for a guest's room monitor", err);
          }
        }
      }
    });

    socket.on('error', (err: Error) => setStatus({ text: `Error: ${err.message}`, isError: true }));
  }

  // ---- 1. Load the stream, then connect signaling + start the draw loop ----

  useEffect(() => {
    if (!streamId) {
      setLoading(false);
      setLoadError('Missing streamId in the URL.');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const streamRow = await getStream(streamId);
        if (!streamRow.studioSessionId) throw new Error('This stream has no studio session.');

        const { token: hostToken } = await mintHostToken(streamRow.studioSessionId);
        if (cancelled) return;

        hostTokenRef.current = hostToken;
        setStream(streamRow);
        setLoading(false);

        connectSignaling(streamRow, hostToken);
        startDrawLoop();
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setNeedsLogin(true);
        } else {
          setLoadError(err instanceof Error ? err.message : 'Failed to load stream.');
        }
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamId]);

  // ---- 2. Actions exposed to the page ----------------------------------

  const startCamera = useCallback(async () => {
    setCameraStarting(true);
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: AUDIO_CONSTRAINTS });
      const videoEl = document.createElement('video');
      videoEl.srcObject = localStream;
      videoEl.muted = true;
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      await videoEl.play();

      const videoTrack = localStream.getVideoTracks()[0];
      const audioTrack = localStream.getAudioTracks()[0];
      participantsRef.current.set('local', {
        id: 'local',
        pc: null,
        videoEl,
        displayName: 'Host',
        videoTrack,
        audioTrack,
        audioEnabled: true,
        videoEnabled: true,
      });
      connectAudioTrack('local', audioTrack);
      renderParticipantList();
      setCameraStarted(true);
      refreshAllMonitorFeeds();
    } catch (err) {
      setStatus({ text: `Could not start camera: ${(err as Error).message}`, isError: true });
    } finally {
      setCameraStarting(false);
    }
  }, [refreshAllMonitorFeeds]);

  // setLayout is the shared primitive -- it sets the layout directly (used
  // by both the toggle button and scene-switching) and persists it to the
  // backend exactly like the original toggle-only implementation did.
  const setLayout = useCallback((next: LayoutMode) => {
    layoutModeRef.current = next;
    setLayoutMode(next);
    setStatus({ text: `Layout: ${next}`, isError: false });

    if (stream?.studioSessionId) {
      updateLayout(stream.studioSessionId, { layout: next, overlays: [] }).catch((err) => {
        console.warn('Failed to persist layout change', err);
      });
    }
  }, [stream]);

  const toggleLayout = useCallback(() => {
    setLayout(layoutModeRef.current === 'grid' ? 'spotlight' : 'grid');
  }, [setLayout]);

  // ---- Screen sharing (host-only) ---------------------------------------
  //
  // Added to participantsRef.current under the synthetic SCREEN_SHARE_ID
  // key, following the exact same shape as every real participant entry --
  // that's what lets it ride the existing grid/spotlight draw loop and the
  // generic per-guest room-monitor relay in startMonitorFeed with zero
  // extra plumbing.

  const stopScreenShare = useCallback(() => {
    const p = participantsRef.current.get(SCREEN_SHARE_ID);
    if (!p) return;
    p.videoTrack?.stop();
    p.audioTrack?.stop();
    participantsRef.current.delete(SCREEN_SHARE_ID);
    removeParticipantAudio(SCREEN_SHARE_ID);
    renderParticipantList();
    setScreenSharing(false);
    refreshAllMonitorFeeds();
  }, [refreshAllMonitorFeeds]);

  const startScreenShare = useCallback(async () => {
    try {
      let displayStream: MediaStream;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      } catch {
        // Some browsers/permission states reject audio:true for display
        // capture -- retry video-only rather than failing the whole feature.
        displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      }

      const videoEl = document.createElement('video'); // never mounted -- pure canvas.drawImage source, same as every other participant
      videoEl.srcObject = displayStream;
      videoEl.muted = true;
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      await videoEl.play();

      const videoTrack = displayStream.getVideoTracks()[0];
      const audioTrack = displayStream.getAudioTracks()[0] ?? null;

      participantsRef.current.set(SCREEN_SHARE_ID, {
        id: SCREEN_SHARE_ID,
        pc: null,
        videoEl,
        displayName: 'Screen share',
        videoTrack,
        audioTrack,
        audioEnabled: true,
        videoEnabled: true,
      });

      if (audioTrack) connectAudioTrack(SCREEN_SHARE_ID, audioTrack);

      // Fires when the browser's own native "Stop sharing" control is used
      // (not just our button) -- run the exact same cleanup either way.
      videoTrack.onended = () => stopScreenShare();

      renderParticipantList();
      setScreenSharing(true);
      refreshAllMonitorFeeds();
    } catch (err) {
      setStatus({ text: `Could not start screen share: ${(err as Error).message}`, isError: true });
    }
  }, [refreshAllMonitorFeeds, stopScreenShare]);

  const createInviteLink = useCallback(async () => {
    if (!stream?.studioSessionId) return;
    try {
      const { joinUrl } = await createInvite(stream.studioSessionId, 60);
      try {
        await navigator.clipboard.writeText(joinUrl);
        setInviteMessage({ text: `Guest link (60 min), copied to clipboard: ${joinUrl}`, isError: false });
      } catch {
        setInviteMessage({ text: `Guest link (60 min): ${joinUrl}`, isError: false });
      }
    } catch (err) {
      setInviteMessage({ text: err instanceof ApiError ? err.message : 'Failed to create invite.', isError: true });
    }
  }, [stream]);

  function toggleParticipantAudio(id: string) {
    const p = participantsRef.current.get(id);
    if (!p) return;
    p.audioEnabled = !p.audioEnabled;
    if (p.audioTrack) p.audioTrack.enabled = p.audioEnabled;
    renderParticipantList();
  }

  function toggleParticipantVideo(id: string) {
    const p = participantsRef.current.get(id);
    if (!p) return;
    p.videoEnabled = !p.videoEnabled;
    if (p.videoTrack) p.videoTrack.enabled = p.videoEnabled;
    renderParticipantList();
  }

  const dropParticipant = useCallback((id: string) => {
    if (id === 'local' || id === SCREEN_SHARE_ID) return; // not a real guest -- use stopScreenShare instead
    const p = participantsRef.current.get(id);
    if (!p) return;
    socketRef.current?.emit('signal', { to: id, type: 'kicked', payload: {} });
    p.pc?.close();
    participantsRef.current.delete(id);
    renderParticipantList();
    stopMonitorFeed(id);
    removeParticipantAudio(id);
    refreshAllMonitorFeeds();
  }, [refreshAllMonitorFeeds]);

  function setLogoFile(file: File | null) {
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      brandingRef.current.logoImg = img;
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }

  function setLogoSize(size: number) {
    if (Number.isFinite(size) && size > 0) {
      brandingRef.current.logoSize = size;
      setBranding((b) => ({ ...b, logoSize: size }));
    }
  }

  function setNewsText(text: string) {
    brandingRef.current.newsText = text.trim();
    newsScrollXRef.current = null;
    setBranding((b) => ({ ...b, newsText: text.trim() }));
  }

  function setNameFontSize(size: number) {
    if (Number.isFinite(size) && size > 0) {
      brandingRef.current.nameFontSize = size;
      setBranding((b) => ({ ...b, nameFontSize: size }));
    }
  }

  // ---- Scenes (session-lifetime presets) --------------------------------
  //
  // Explicit scope decision: scenes only need to persist for the duration
  // of the current studio session -- this in-memory React state is NOT
  // persisted to the backend/database, and does not survive a page reload.

  const saveScene = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const snapshot: Scene = {
      name: trimmed,
      layoutMode: layoutModeRef.current,
      branding: {
        logoSize: brandingRef.current.logoSize,
        newsText: brandingRef.current.newsText,
        nameFontSize: brandingRef.current.nameFontSize,
      },
    };
    setScenes((prev) => [...prev.filter((s) => s.name !== trimmed), snapshot]);
    setActiveSceneName(trimmed);
    setStatus({ text: `Saved scene "${trimmed}".`, isError: false });
  }, []);

  const applyScene = useCallback((name: string) => {
    setScenes((prev) => {
      const scene = prev.find((s) => s.name === name);
      if (scene) {
        setLayout(scene.layoutMode);
        brandingRef.current.logoSize = scene.branding.logoSize;
        brandingRef.current.newsText = scene.branding.newsText;
        brandingRef.current.nameFontSize = scene.branding.nameFontSize;
        newsScrollXRef.current = null;
        setBranding({ ...scene.branding });
        setActiveSceneName(name);
        setStatus({ text: `Switched to scene "${name}".`, isError: false });
      }
      return prev;
    });
  }, [setLayout]);

  function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', check);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', check);
      // WHIP is a single HTTP exchange, not trickle ICE -- cap the wait.
      setTimeout(resolve, 3000);
    });
  }

  const goLive = useCallback(async () => {
    if (!stream?.whipUrl) {
      setStatus({ text: "This stream has no WHIP URL — see the plan's empirical Cloudflare spike.", isError: true });
      return;
    }
    setStatus({ text: 'Starting publish…', isError: false });

    try {
      const videoTrack = canvasRef.current!.captureStream(30).getVideoTracks()[0];
      const audioTrack = audioDestinationRef.current ? audioDestinationRef.current.stream.getAudioTracks()[0] : null;

      const whipPc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      whipPcRef.current = whipPc;
      const videoTransceiver = whipPc.addTransceiver(videoTrack, { direction: 'sendonly' });
      if (audioTrack) whipPc.addTransceiver(audioTrack, { direction: 'sendonly' });

      // Cloudflare's WHIP ingest accepts VP8 at the SDP/ICE/transport level
      // but its live-transcode pipeline only processes H264 -- force it
      // first, keep the rest as a fallback.
      if (typeof RTCRtpSender.getCapabilities === 'function') {
        const codecs = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
        const h264 = codecs.filter((c) => c.mimeType.toLowerCase() === 'video/h264');
        const rest = codecs.filter((c) => c.mimeType.toLowerCase() !== 'video/h264');
        if (h264.length > 0) videoTransceiver.setCodecPreferences([...h264, ...rest]);
      }

      const offer = await whipPc.createOffer();
      await whipPc.setLocalDescription(offer);
      await waitForIceGatheringComplete(whipPc);

      const res = await fetch(stream.whipUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: whipPc.localDescription!.sdp,
      });
      if (!res.ok) throw new Error(`WHIP publish failed (${res.status})`);

      // Cloudflare's WHIP Location header is relative -- resolve it against
      // the WHIP endpoint's own origin, not this page's.
      const location = res.headers.get('Location');
      whipResourceUrlRef.current = location ? new URL(location, stream.whipUrl).toString() : null;
      const answerSdp = await res.text();
      await whipPc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      // WebRTC encoders default to a long keyframe interval; RTMP broadcast
      // destinations need one roughly every ~2s to recognize the stream at
      // all. Two different APIs exist across browser versions -- try both.
      const sender = videoTransceiver.sender;
      keyFrameIntervalRef.current = setInterval(() => {
        const s = sender as RTCRtpSender & { generateKeyFrame?: () => Promise<void> };
        if (typeof s.generateKeyFrame === 'function') {
          s.generateKeyFrame().catch(() => {});
          return;
        }
        const params = sender.getParameters();
        if (params.encodings && params.encodings.length > 0) {
          sender.setParameters(params).catch(() => {});
        }
      }, 2000);

      setIsLive(true);
      setStatus({ text: 'LIVE — publishing to Cloudflare.', isError: false });
    } catch (err) {
      setStatus({ text: `Failed to go live: ${(err as Error).message}`, isError: true });
    }
  }, [stream]);

  const endStream = useCallback(async () => {
    setEnding(true);
    endingStreamRef.current = true;
    setStatus({ text: 'Ending stream…', isError: false });

    if (monitorRefreshTimerRef.current) {
      clearTimeout(monitorRefreshTimerRef.current);
      monitorRefreshTimerRef.current = null;
    }

    if (keyFrameIntervalRef.current) {
      clearInterval(keyFrameIntervalRef.current);
      keyFrameIntervalRef.current = null;
    }

    if (whipResourceUrlRef.current) {
      try {
        await fetch(whipResourceUrlRef.current, { method: 'DELETE' });
      } catch (err) {
        console.warn("Best-effort WHIP teardown failed (backend end() will still tear down the relay)", err);
      }
    }

    let ended = false;
    try {
      if (!stream) throw new Error('No stream loaded');
      const res = await fetch(`/api/streams/${stream.id}/end`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to end stream (${res.status})`);
      ended = true;
      setStatus({ text: 'Stream ended. Returning to your dashboard…', isError: false });
    } catch (err) {
      setStatus({ text: (err as Error).message, isError: true });
      setEnding(false);
    }

    whipPcRef.current?.close();
    // Stop the screen-capture track explicitly so the browser's own
    // "sharing your screen" indicator clears too, not just our connections.
    participantsRef.current.get(SCREEN_SHARE_ID)?.videoTrack?.stop();
    participantsRef.current.get(SCREEN_SHARE_ID)?.audioTrack?.stop();
    for (const p of participantsRef.current.values()) p.pc?.close();
    for (const monitorPc of monitorConnectionsRef.current.values()) monitorPc.close();
    monitorConnectionsRef.current.clear();
    socketRef.current?.disconnect();

    if (ended) {
      setTimeout(() => {
        window.location.href = '/';
      }, 1500);
    }
    return ended;
  }, [stream]);

  return {
    canvasRef,
    loading,
    loadError,
    needsLogin,
    stream,
    status,
    inviteMessage,
    participants: participantsView,
    layoutMode,
    cameraStarting,
    cameraStarted,
    isLive,
    ending,
    screenSharing,
    branding,
    scenes,
    activeSceneName,
    actions: {
      startCamera,
      createInviteLink,
      toggleLayout,
      setLayout,
      goLive,
      endStream,
      toggleParticipantAudio,
      toggleParticipantVideo,
      dropParticipant,
      setLogoFile,
      setLogoSize,
      setNewsText,
      setNameFontSize,
      startScreenShare,
      stopScreenShare,
      saveScene,
      applyScene,
    },
  };
}
