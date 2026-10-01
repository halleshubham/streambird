import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getStream, getStreamStatus } from '../api/streams';
import { listConnections } from '../api/connections';
import { mintHostToken, createInvite, updateLayout } from '../api/studio';
import { ApiError } from '../api/client';
import type { PlatformConnection, Stream, StreamStatusDestination } from '../types/api';

// Mirrors StreamDetailPage's own poll interval -- see that page for why
// 10s (fast enough to catch a destination's platformStatus climbing from
// "testing" to "live" without hammering every provider's API every call).
const DESTINATION_STATUS_POLL_MS = 10_000;

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
// Explicit rather than relying on browser defaults -- VDO.Ninja (a mature
// WebRTC production tool) leans on exactly these three constraints as its
// primary defense for participants on speakers rather than headphones.
const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

export type LayoutMode = 'grid' | 'spotlight';

export type StreamResolution = 'sd' | 'hd' | 'fhd';

/** Compositing canvas size + the encoder bitrate cap that goes with it --
 * one shared encode fans out via MediaMTX to every destination at once
 * (YouTube/Facebook/Twitch/the relay), so resolution is necessarily a
 * single global choice per stream, not a per-destination setting. Locked
 * once live (see HostStudioPage) rather than supporting a mid-stream
 * resize -- resizing the canvas itself is harmless, but changing
 * resolution out from under an already-negotiated RTMP destination's own
 * transcode pipeline is an unnecessary risk for what this needs to do. */
export const RESOLUTIONS: Record<StreamResolution, { width: number; height: number; maxBitrate: number; label: string }> = {
  sd: { width: 640, height: 360, maxBitrate: 1_000_000, label: 'SD (360p)' },
  hd: { width: 1280, height: 720, maxBitrate: 3_000_000, label: 'HD (720p)' },
  fhd: { width: 1920, height: 1080, maxBitrate: 6_000_000, label: 'Full HD (1080p)' },
};

interface Participant {
  id: string; // 'local' or a guest's socketId
  pc: RTCPeerConnection | null; // null for 'local' -- it never negotiates with itself
  videoEl: HTMLVideoElement; // never mounted in the DOM tree -- pure canvas.drawImage source, same as the original vanilla build
  displayName: string;
  videoTrack: MediaStreamTrack | null;
  audioTrack: MediaStreamTrack | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
  joinedAt: number; // performance.now() at creation -- drives the lower-third's slide-in animation
  onStage: boolean; // false = "backstage": excluded from the composited canvas and the broadcast audio mix
}

export interface ParticipantView {
  id: string;
  displayName: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  isLocal: boolean;
  isScreenShare: boolean;
  onStage: boolean;
  pinned: boolean;
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
  const [resolution, setResolution] = useState<StreamResolution>('hd');
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
  const [destinations, setDestinations] = useState<StreamStatusDestination[]>([]);
  const [connectionById, setConnectionById] = useState<Map<string, PlatformConnection>>(new Map());
  const [pinnedId, setPinnedId] = useState<string | null>(null);

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
  const pinnedIdRef = useRef<string | null>(null);
  // Crossfade-on-change: a snapshot of the canvas taken the instant a layout
  // (or scene, which calls setLayout internally) change is requested, faded
  // out over the newly-drawn frame for TRANSITION_MS so switches are a
  // dissolve instead of a hard cut.
  const transitionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const transitionStateRef = useRef<{ startedAt: number } | null>(null);
  // Identity of the last frame's composited entries (ids, in draw order) --
  // compared every frame so a guest joining/leaving (or going on/off stage)
  // mid-session triggers the same crossfade as an explicit layout/scene
  // change, instead of the canvas hard-cutting to the new grid the instant
  // their video becomes ready. '' sentinel skips the very first real frame,
  // which has no prior content worth fading from.
  const lastEntriesKeyRef = useRef<string>('');
  const logoAppearedAtRef = useRef<number | null>(null);
  const tickerAppearedAtRef = useRef<number | null>(null);

  function renderParticipantList() {
    const view: ParticipantView[] = [...participantsRef.current.values()].map((p) => ({
      id: p.id,
      displayName: p.displayName,
      audioEnabled: p.audioEnabled,
      videoEnabled: p.videoEnabled,
      isLocal: p.id === 'local',
      isScreenShare: p.id === SCREEN_SHARE_ID,
      onStage: p.onStage,
      pinned: p.id === pinnedIdRef.current,
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

    // Also route to the host's own speakers so the producer can actually
    // hear everyone live while producing -- audioDestinationRef only ever
    // feeds the outbound WHIP broadcast and other guests' monitor feeds,
    // never the host's local output device, so without this the host had
    // no way to literally hear a guest (or a shared screen's audio) at all.
    // Skip the host's own mic ('local') to avoid feeding it straight back
    // into the host's own speakers (echo/feedback).
    if (key !== 'local') {
      source.connect(audioContextRef.current!.destination);
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

  const LOWER_THIRD_ACCENT = '#7c3aed'; // matches --accent in index.css -- canvas can't read CSS custom properties
  const ENTRANCE_MS = 400;

  function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  function drawLogo(now: number) {
    const b = brandingRef.current;
    if (!b.logoImg) return;
    const ctx = ctxRef.current!;
    let alpha = 1;
    let yOffset = 0;
    const appearedAt = logoAppearedAtRef.current;
    if (appearedAt !== null) {
      const t = Math.min((now - appearedAt) / ENTRANCE_MS, 1);
      const eased = easeOutCubic(t);
      alpha = eased;
      yOffset = (1 - eased) * -20;
      if (t >= 1) logoAppearedAtRef.current = null;
    }
    const scale = b.logoSize / b.logoImg.naturalHeight;
    ctx.globalAlpha = alpha;
    ctx.drawImage(b.logoImg, 16, 16 + yOffset, b.logoImg.naturalWidth * scale, b.logoSize);
    ctx.globalAlpha = 1;
  }

  function drawNewsline(w: number, h: number, now: number) {
    const b = brandingRef.current;
    if (!b.newsText) return;
    const ctx = ctxRef.current!;
    const barH = 36;
    let barY = h - barH;
    const appearedAt = tickerAppearedAtRef.current;
    if (appearedAt !== null) {
      const t = Math.min((now - appearedAt) / ENTRANCE_MS, 1);
      const eased = easeOutCubic(t);
      barY = h - barH + (1 - eased) * barH; // slides up from fully below-frame into its resting position
      if (t >= 1) tickerAppearedAtRef.current = null;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, barY, w, barH);

    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    const textWidth = ctx.measureText(b.newsText).width;

    if (newsScrollXRef.current === null) newsScrollXRef.current = w;
    const dt = lastFrameTimeRef.current === null ? 0 : now - lastFrameTimeRef.current;
    lastFrameTimeRef.current = now;

    newsScrollXRef.current -= dt * 0.08;
    if (newsScrollXRef.current + textWidth < 0) newsScrollXRef.current = w;

    ctx.fillText(b.newsText, newsScrollXRef.current, barY + barH / 2);
  }

  function drawCell(p: Participant, x: number, y: number, w: number, h: number, now: number) {
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

    // News-room-style lower third: a colored accent bar + dark name plate,
    // sliding in from the left over the tile's first ENTRANCE_MS*1.25ms --
    // slightly slower than the logo/ticker so a packed grid of simultaneous
    // joins doesn't read as everything popping in at once.
    const fontSize = brandingRef.current.nameFontSize;
    const boxH = Math.min(h, fontSize + 14);
    const plateY = y + h - boxH;
    const slideDuration = ENTRANCE_MS * 1.25;
    const t = Math.min((now - p.joinedAt) / slideDuration, 1);
    const eased = easeOutCubic(t);
    const slideOffset = (1 - eased) * -Math.min(w, 200);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, plateY, w, boxH);
    ctx.clip();
    ctx.translate(slideOffset, 0);

    const accentW = 6;
    ctx.fillStyle = LOWER_THIRD_ACCENT;
    ctx.fillRect(x, plateY, accentW, boxH);
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(x + accentW, plateY, w - accentW, boxH);

    ctx.fillStyle = '#fff';
    ctx.font = `600 ${fontSize}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(p.displayName, x + accentW + 8, plateY + boxH / 2);
    ctx.restore();
  }

  function drawGrid(entries: Participant[], w: number, h: number, now: number) {
    const cols = Math.ceil(Math.sqrt(entries.length));
    const rows = Math.ceil(entries.length / cols);
    void rows;
    const cellW = w / cols;
    const cellH = h / Math.ceil(entries.length / cols);
    entries.forEach((p, i) => {
      drawCell(p, (i % cols) * cellW, Math.floor(i / cols) * cellH, cellW, cellH, now);
    });
  }

  function drawSpotlight(entries: Participant[], w: number, h: number, now: number) {
    const pinnedId = pinnedIdRef.current;
    const pinnedIdx = pinnedId ? entries.findIndex((p) => p.id === pinnedId) : -1;
    const ordered =
      pinnedIdx > 0
        ? [entries[pinnedIdx], ...entries.slice(0, pinnedIdx), ...entries.slice(pinnedIdx + 1)]
        : entries;

    drawCell(ordered[0], 0, 0, w, h, now);
    const thumbSize = w / 6;
    ordered.slice(1).forEach((p, i) => {
      drawCell(p, w - thumbSize - 8, 8 + i * (thumbSize * 0.6 + 8), thumbSize, thumbSize * 0.6, now);
    });
  }

  /** Snapshots the current canvas so the next frame's content can crossfade
   * in over it instead of hard-cutting -- called right before a layout (or
   * scene, which applies a layout internally) change is applied. */
  function beginTransition() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!transitionCanvasRef.current) {
      transitionCanvasRef.current = document.createElement('canvas');
    }
    const tCanvas = transitionCanvasRef.current;
    tCanvas.width = canvas.width;
    tCanvas.height = canvas.height;
    tCanvas.getContext('2d')!.drawImage(canvas, 0, 0);
    transitionStateRef.current = { startedAt: performance.now() };
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

      const entries = [...participantsRef.current.values()].filter(
        (p) => p.videoEl.readyState >= 2 && p.onStage,
      );
      const entriesKey = entries.map((p) => p.id).join(',');
      if (lastEntriesKeyRef.current !== '' && entriesKey !== lastEntriesKeyRef.current) {
        // Snapshot BEFORE the black fill below overwrites it -- at this
        // point the canvas still holds exactly what last frame drew.
        beginTransition();
      }
      lastEntriesKeyRef.current = entriesKey;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);

      if (entries.length > 0) {
        if (layoutModeRef.current === 'spotlight') drawSpotlight(entries, w, h, now);
        else drawGrid(entries, w, h, now);
      }

      drawLogo(now);
      drawNewsline(w, h, now);

      const transition = transitionStateRef.current;
      if (transition) {
        const TRANSITION_MS = 350;
        const elapsed = now - transition.startedAt;
        if (elapsed < TRANSITION_MS && transitionCanvasRef.current) {
          const eased = easeOutCubic(elapsed / TRANSITION_MS);
          ctx.globalAlpha = 1 - eased;
          ctx.drawImage(transitionCanvasRef.current, 0, 0, w, h);
          ctx.globalAlpha = 1;
        } else {
          transitionStateRef.current = null;
        }
      }

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
      joinedAt: performance.now(),
      onStage: true,
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

    // Diagnostic only -- this guest-publish connection previously had no
    // visibility into ICE/connection failures (unlike every other
    // RTCPeerConnection in this file), making a silently-stuck negotiation
    // indistinguishable from "it's just slow" in the console.
    pc.oniceconnectionstatechange = () => {
      console.log(`[guest ${fromSocketId}] ICE connection state: ${pc.iceConnectionState}`);
    };
    pc.onconnectionstatechange = () => {
      console.log(`[guest ${fromSocketId}] connection state: ${pc.connectionState}`);
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

        // Platform per destination isn't on the stream/status response
        // itself (only platformConnectionId) -- resolve it client-side
        // against the account's connections, same approach as
        // StreamDetailPage.
        listConnections()
          .then((conns) => setConnectionById(new Map(conns.map((c) => [c.id, c]))))
          .catch(() => {});
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

  // Destination status (our own LIVE/FAILED/etc. status AND, where the
  // provider supports it, the platform's own real lifecycle status -- see
  // StreamsService.getStatus server-side for why both matter) -- polled
  // independently of the WHIP/signaling setup above so it keeps refreshing
  // for as long as this page is open, including before the host has
  // actually gone live yet.
  useEffect(() => {
    if (!streamId) return;
    let cancelled = false;

    const poll = () => {
      getStreamStatus(streamId)
        .then((s) => {
          if (!cancelled) setDestinations(s.destinations);
        })
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, DESTINATION_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
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
        joinedAt: performance.now(),
        onStage: true,
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
    beginTransition();
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
        joinedAt: performance.now(),
        onStage: true,
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

  const createInviteLink = useCallback(async (password?: string) => {
    if (!stream?.studioSessionId) return;
    try {
      const { joinUrl } = await createInvite(stream.studioSessionId, { password });
      const suffix = password ? ' (password required)' : '';
      try {
        await navigator.clipboard.writeText(joinUrl);
        setInviteMessage({ text: `Guest link${suffix}, copied to clipboard: ${joinUrl}`, isError: false });
      } catch {
        setInviteMessage({ text: `Guest link${suffix}: ${joinUrl}`, isError: false });
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

  function togglePin(id: string) {
    pinnedIdRef.current = pinnedIdRef.current === id ? null : id;
    setPinnedId(pinnedIdRef.current);
    renderParticipantList();
  }

  /** Backstage: excluded from the composited canvas (see the entries filter
   * in the draw loop) and, here, disconnected from the broadcast's audio
   * mix specifically -- `audioSourceNodesRef`'s node fans out to several
   * destinations (the full mix, every other guest's mix-minus, the host's
   * own speakers), and `AudioNode.disconnect(destinationNode)` targets only
   * one of those, so a backstage guest stays audible to the room (and to
   * the host) without reaching the audience. */
  function toggleOnStage(id: string) {
    const p = participantsRef.current.get(id);
    if (!p) return;
    p.onStage = !p.onStage;
    const source = audioSourceNodesRef.current.get(id);
    if (source && audioDestinationRef.current) {
      if (p.onStage) {
        source.connect(audioDestinationRef.current);
      } else {
        try {
          source.disconnect(audioDestinationRef.current);
        } catch {
          // Already disconnected (e.g. toggled before any audio track ever
          // arrived for this participant) -- nothing further to do.
        }
      }
    }
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
      logoAppearedAtRef.current = performance.now();
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
    const trimmed = text.trim();
    if (!brandingRef.current.newsText && trimmed) {
      tickerAppearedAtRef.current = performance.now();
    }
    brandingRef.current.newsText = trimmed;
    newsScrollXRef.current = null;
    setBranding((b) => ({ ...b, newsText: trimmed }));
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
      setStatus({ text: 'This stream has no publish URL yet.', isError: true });
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

      // Force H264 first (keep the rest as a fallback) for the broadest
      // compatibility with whatever's actually transcoding downstream of
      // our own WHIP endpoint (MediaMTX) -- not all RTMP destinations'
      // transcode pipelines handle VP8 even when the WHIP leg itself
      // accepts it at the SDP/ICE/transport level.
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

      // The WHIP Location header can be relative -- resolve it against the
      // WHIP endpoint's own origin (MediaMTX), not this page's.
      const location = res.headers.get('Location');
      whipResourceUrlRef.current = location ? new URL(location, stream.whipUrl).toString() : null;
      const answerSdp = await res.text();
      await whipPc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      // WebRTC encoders default to a long keyframe interval; RTMP broadcast
      // destinations need one roughly every ~2s to recognize the stream at
      // all. Two different APIs exist across browser versions -- try both.
      const sender = videoTransceiver.sender;

      // Cap the encoder to the chosen resolution tier's bitrate -- the
      // canvas is already sized for it (see the <canvas> element's
      // width/height), this just stops the browser's own bitrate
      // heuristics from over- or under-shooting what that resolution
      // actually needs.
      const bitrateParams = sender.getParameters();
      if (bitrateParams.encodings && bitrateParams.encodings.length > 0) {
        bitrateParams.encodings[0].maxBitrate = RESOLUTIONS[resolution].maxBitrate;
        await sender.setParameters(bitrateParams).catch(() => {});
      }

      const forceKeyFrame = () => {
        const s = sender as RTCRtpSender & { generateKeyFrame?: () => Promise<void> };
        if (typeof s.generateKeyFrame === 'function') {
          s.generateKeyFrame().catch(() => {});
          return;
        }
        const params = sender.getParameters();
        if (params.encodings && params.encodings.length > 0) {
          sender.setParameters(params).catch(() => {});
        }
      };
      // Fire one immediately rather than waiting for the first interval tick
      // -- MediaMTX's runOnReady ffmpeg pull starts probing the RTSP stream
      // as soon as the path goes online, and without an early keyframe
      // (carrying H264's SPS/PPS) it can give up probing before one ever
      // arrives, silently dropping every destination for that attempt
      // (confirmed live 2026-10-01 -- see MediaMtxService.buildRunOnReady).
      forceKeyFrame();
      keyFrameIntervalRef.current = setInterval(forceKeyFrame, 2000);

      setIsLive(true);
      setStatus({ text: 'LIVE — publishing.', isError: false });
    } catch (err) {
      setStatus({ text: `Failed to go live: ${(err as Error).message}`, isError: true });
    }
  }, [stream, resolution]);

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
    resolution,
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
    pinnedId,
    actions: {
      startCamera,
      createInviteLink,
      toggleLayout,
      setLayout,
      setResolution,
      goLive,
      endStream,
      toggleParticipantAudio,
      toggleParticipantVideo,
      togglePin,
      toggleOnStage,
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
