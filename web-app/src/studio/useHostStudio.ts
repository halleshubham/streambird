import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getMyLimits } from '../api/plans';
import { getStream, getStreamStatus, startStream } from '../api/streams';
import { listConnections } from '../api/connections';
import { mintHostToken, createInvite, updateLayout, getTurnCredentials } from '../api/studio';
import { ApiError } from '../api/client';
import type { PlatformConnection, Stream, StreamStatusDestination } from '../types/api';
import {
  BRANDING_RANGES,
  DEFAULT_THEME_ID,
  LAYOUT_BY_ID,
  SCREEN_SHARE_ID,
  THEME_BY_ID,
  WALLPAPER_RANGES,
  computeLayout,
  getTheme,
  isFramedLayout,
  isLayoutId,
  newsBarHeight,
  orderPeople,
  type CanvasTheme,
  type LayoutId,
  type Rect,
  type StreamOrientation,
} from './compose';
import {
  loadSlide,
  loadWallpaper,
  paintBackground,
  paintWallpaper,
  wallpaperFromDataUrl,
  wallpaperToDataUrl,
  type SlideImage,
  type Wallpaper,
} from './themePaint';

// Mirrors StreamDetailPage's own poll interval -- see that page for why
// 10s (fast enough to catch a destination's platformStatus climbing from
// "testing" to "live" without hammering every provider's API every call).
const DESTINATION_STATUS_POLL_MS = 10_000;

// Fallback only, used until (or unless) getTurnCredentials() resolves --
// see iceServersRef. STUN alone cannot traverse every NAT/firewall a
// guest might be behind, which is exactly what made some guests silently
// never show up on the host's canvas (confirmed live via rtc-state
// diagnostics); Cloudflare-issued TURN credentials are fetched below and
// used everywhere a RTCPeerConnection gets created in this file.
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
// Explicit rather than relying on browser defaults -- VDO.Ninja (a mature
// WebRTC production tool) leans on exactly these three constraints as its
// primary defense for participants on speakers rather than headphones.
const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

/** 'grid' and 'spotlight' are the original layouts; the rest are framed (see compose.ts). */
export type LayoutMode = LayoutId;

export type StreamResolution = 'sd' | 'hd' | 'fhd';
const RESOLUTION_ORDER: StreamResolution[] = ['sd', 'hd', 'fhd'];

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
  /** False for e.g. a screen share captured without system audio -- nothing to mute. */
  hasAudio: boolean;
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
  /** Ticker text size in canvas pixels (the bar grows with it). */
  newsFontSize: number;
}

const DEFAULT_BRANDING: Branding = {
  logoSize: BRANDING_RANGES.logoSize.default,
  newsText: '',
  nameFontSize: BRANDING_RANGES.nameFontSize.default,
  newsFontSize: BRANDING_RANGES.newsFontSize.default,
};

/** Slideshow images the host loads for the slide layouts (kept in memory for this session). */
export const MAX_SLIDES = 40;

/** How a tile is drawn: the original 'contain' fit with square corners, or a rounded 'cover' fit for framed layouts. */
interface TileStyle {
  fit: 'cover';
  radius: number;
  theme: CanvasTheme;
}

/** A named, saved bundle of layout + branding settings -- session-lifetime only (see useHostStudio scenes state). */
export interface Scene {
  name: string;
  layoutMode: LayoutMode;
  branding: Branding;
  themeId?: string;
}

// The screen-share track lives in the same participantsRef Map as every
// real guest/host entry (so it rides the existing grid/spotlight draw loop
// and the generic per-guest room-monitor relay for free) but under this
// clearly-synthetic key, never a real socket id.
// (SCREEN_SHARE_ID is shared with compose.ts.)

/**
 * Timer source that keeps ticking while the tab is hidden. requestAnimationFrame
 * stops entirely in a background tab and main-thread timers are throttled to
 * ~1/s, which would freeze the composited canvas (and therefore the whole
 * broadcast) the moment a single-screen host switches tab or minimizes the
 * window. Worker timers aren't throttled that way. Returns null where
 * workers aren't available -- callers fall back to rAF / setInterval.
 */
function createTickWorker(): Worker | null {
  try {
    const src =
      "let d=null,k=null;onmessage=e=>{if(e.data==='start'){d=setInterval(()=>postMessage('draw'),33);k=setInterval(()=>postMessage('key'),2000)}else if(e.data==='stop'){clearInterval(d);clearInterval(k)}}";
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    return worker;
  } catch {
    return null;
  }
}

// Per-stream, per-browser studio state that survives a reload: layout,
// branding (incl. the logo, as a data URL), scenes, resolution -- plus
// whether this browser already took the stream live, which is what lets a
// reloaded page re-publish on its own instead of waiting for a first-ever
// "Go live". Deliberately localStorage, not the backend: it's host-side
// presentation state, and a guest/another device never needs it.
interface PersistedStudioState {
  layoutMode: LayoutMode;
  resolution: StreamResolution;
  branding: Branding;
  themeId: string;
  scenes: Scene[];
  logoDataUrl: string | null;
  wentLive: boolean;
}
const persistKey = (streamId: string) => `streambird:studio:${streamId}:v1`;

function loadPersisted(streamId: string): Partial<PersistedStudioState> {
  try {
    const raw = localStorage.getItem(persistKey(streamId));
    return raw ? (JSON.parse(raw) as Partial<PersistedStudioState>) : {};
  } catch {
    return {};
  }
}

function savePersisted(streamId: string, patch: Partial<PersistedStudioState>) {
  try {
    localStorage.setItem(persistKey(streamId), JSON.stringify({ ...loadPersisted(streamId), ...patch }));
  } catch {
    // Storage full/blocked (private mode) -- persistence is best-effort.
  }
}

// The wallpaper lives under its own key: it can be large, and a full storage quota must not
// stop the layout/branding state above from saving.
interface PersistedWallpaper {
  name: string;
  width: number;
  height: number;
  dataUrl: string;
  focusX: number;
  focusY: number;
  dim: number;
}
const wallpaperKey = (streamId: string) => `streambird:studio:${streamId}:wallpaper:v1`;

function loadPersistedWallpaper(streamId: string): PersistedWallpaper | null {
  try {
    const raw = localStorage.getItem(wallpaperKey(streamId));
    return raw ? (JSON.parse(raw) as PersistedWallpaper) : null;
  } catch {
    return null;
  }
}

/** Returns false when it could not be saved (storage full or blocked): the wallpaper then lasts for this session only. */
function savePersistedWallpaper(streamId: string, wp: PersistedWallpaper | null): boolean {
  try {
    if (wp) localStorage.setItem(wallpaperKey(streamId), JSON.stringify(wp));
    else localStorage.removeItem(wallpaperKey(streamId));
    return true;
  } catch {
    return false;
  }
}

/**
 * All of the imperative WebRTC/Web Audio/canvas-compositing logic from the
 * original web/host.js, ported behind a hook -- the underlying protocol
 * logic is unchanged (same event-driven design, same fixes for the bugs
 * found tonight), only the UI layer moved to React. Heavy mutable state
 * (peer connections, audio graph nodes, the canvas draw loop) stays in
 * refs exactly like the vanilla module-level variables it replaces; only
 * what the UI needs to render is React state.
 *
 * Each guest's RTCPeerConnection (see handleGuestOffer) is bidirectional:
 * it both sends the host's own camera/mic to that guest and receives the
 * guest's, carrying the full-mesh "meeting room" on the exact same
 * connection the canvas compositor already uses to receive that guest's
 * video. Guest-to-guest connections don't touch this file at all -- see
 * useGuestStudio, which negotiates those directly between guests.
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
  const [resolution, setResolutionState] = useState<StreamResolution>('hd');
  // The best quality the host's plan allows (GET /plans/me); until it loads, nothing is restricted.
  const [maxResolution, setMaxResolution] = useState<StreamResolution>('fhd');
  const clampResolution = useCallback(
    (r: StreamResolution) => (RESOLUTION_ORDER.indexOf(r) > RESOLUTION_ORDER.indexOf(maxResolution) ? maxResolution : r),
    [maxResolution],
  );
  const setResolution = useCallback((r: StreamResolution) => setResolutionState(clampResolution(r)), [clampResolution]);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [ending, setEnding] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [branding, setBranding] = useState<Branding>({ ...DEFAULT_BRANDING });
  const [themeId, setThemeIdState] = useState<string>(DEFAULT_THEME_ID);
  const [slides, setSlides] = useState<{ name: string }[]>([]);
  const [slideIndex, setSlideIndex] = useState(0);
  const [wallpaper, setWallpaperState] = useState<{ name: string; width: number; height: number } | null>(null);
  const [wallpaperFocus, setWallpaperFocusState] = useState<{ x: number; y: number }>({ x: WALLPAPER_RANGES.focus.default, y: WALLPAPER_RANGES.focus.default });
  const [wallpaperDim, setWallpaperDimState] = useState<number>(WALLPAPER_RANGES.dim.default);
  // Scenes only need to persist for the lifetime of this studio session --
  // in-memory React state, deliberately not persisted to the backend/DB.
  const [scenes, setScenes] = useState<Scene[]>([]);
  const scenesRef = useRef<Scene[]>([]);
  scenesRef.current = scenes;
  const orientationRef = useRef<StreamOrientation>('landscape');
  orientationRef.current = stream?.orientation ?? 'landscape';
  const [activeSceneName, setActiveSceneName] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<StreamStatusDestination[]>([]);
  const [connectionById, setConnectionById] = useState<Map<string, PlatformConnection>>(new Map());
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [resumeAttempted, setResumeAttempted] = useState(false);
  const [startingScheduled, setStartingScheduled] = useState(false);

  const hostTokenRef = useRef<string | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>(DEFAULT_ICE_SERVERS);
  const socketRef = useRef<Socket | null>(null);
  const participantsRef = useRef<Map<string, Participant>>(new Map());
  const pendingDisplayNamesRef = useRef<Map<string, string>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioSourceNodesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const layoutModeRef = useRef<LayoutMode>('grid');
  const drawingRef = useRef(false);
  const brandingRef = useRef<Branding & { logoImg: HTMLImageElement | null }>({ ...DEFAULT_BRANDING, logoImg: null });
  const themeIdRef = useRef<string>(DEFAULT_THEME_ID);
  const slidesRef = useRef<SlideImage[]>([]);
  const slideIndexRef = useRef(0);
  const wallpaperRef = useRef<Wallpaper | null>(null);
  const wallpaperDataUrlRef = useRef<string | null>(null);
  const wallpaperSettingsRef = useRef({ x: WALLPAPER_RANGES.focus.default as number, y: WALLPAPER_RANGES.focus.default as number, dim: WALLPAPER_RANGES.dim.default as number });
  const newsScrollXRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const whipPcRef = useRef<RTCPeerConnection | null>(null);
  const whipResourceUrlRef = useRef<string | null>(null);
  const keyFrameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endingStreamRef = useRef(false);
  const pinnedIdRef = useRef<string | null>(null);
  const tickWorkerRef = useRef<Worker | null>(null);
  const drawGenRef = useRef(0);
  const forceKeyFrameRef = useRef<(() => void) | null>(null);
  const autoResumeTriedRef = useRef(false);
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
  // Shown on the branded StreamBird slide that fills the canvas while nobody
  // is on camera -- see drawBrandSlide. The image is StreamBird's own logo,
  // not the host's custom overlay logo (brandingRef.logoImg).
  const streamTitleRef = useRef('');
  const brandImgRef = useRef<HTMLImageElement | null>(null);
  const tickerAppearedAtRef = useRef<number | null>(null);

  function renderParticipantList() {
    const view: ParticipantView[] = [...participantsRef.current.values()].map((p) => ({
      id: p.id,
      displayName: p.displayName,
      audioEnabled: p.audioEnabled,
      hasAudio: p.audioTrack != null,
      videoEnabled: p.videoEnabled,
      isLocal: p.id === 'local',
      isScreenShare: p.id === SCREEN_SHARE_ID,
      onStage: p.onStage,
      pinned: p.id === pinnedIdRef.current,
    }));
    setParticipantsView(view);
  }

  // ---- Audio mixing ----------------------------------------------------
  //
  // One full mix of everyone, incl. the host -- the audio half of the
  // outbound WHIP publish. (There used to also be a per-guest mix-minus
  // destination here, for the old host-relayed room monitor; full-mesh
  // guest-to-guest connections replaced that -- see useGuestStudio -- so
  // each participant's mic now only ever needs to feed this one mix.)

  function ensureAudioMix() {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
      audioDestinationRef.current = audioContextRef.current.createMediaStreamDestination();
      // A destination with nothing connected to it produces no audio at all:
      // Chrome sends zero RTP packets, so a camera-less publish arrived with
      // video only, and the relay's ffmpeg (which maps an audio stream) never
      // started -- nothing reached Facebook/YouTube. A constant zero source
      // keeps real (silent) Opus packets flowing; a mic connected later just
      // mixes in alongside it. Verified in Chromium: 0 packets without it,
      // ~50 packets/s with it.
      const silence = audioContextRef.current.createConstantSource();
      silence.offset.value = 0;
      silence.connect(audioDestinationRef.current);
      silence.start();
    }
  }

  function connectAudioTrack(key: string, track: MediaStreamTrack | null | undefined) {
    if (!track) return;
    ensureAudioMix();
    if (audioSourceNodesRef.current.has(key)) return;

    const source = audioContextRef.current!.createMediaStreamSource(new MediaStream([track]));
    audioSourceNodesRef.current.set(key, source);

    source.connect(audioDestinationRef.current!);

    // Also route to the host's own speakers so the producer can actually
    // hear everyone live while producing -- audioDestinationRef only ever
    // feeds the outbound WHIP broadcast, never the host's local output
    // device, so without this the host had no way to literally hear a
    // guest (or a shared screen's audio) at all. Skip the host's own mic
    // ('local') to avoid feeding it straight back into the host's own
    // speakers (echo/feedback).
    if (key !== 'local') {
      source.connect(audioContextRef.current!.destination);
    }
  }

  function removeParticipantAudio(key: string) {
    audioSourceNodesRef.current.get(key)?.disconnect();
    audioSourceNodesRef.current.delete(key);
  }

  /** Adds the host's own local camera/mic tracks to an already-negotiated
   * per-guest connection (see handleGuestOffer) so that guest's page
   * starts receiving the host's video/audio too, not just sending its own.
   * A no-op per track if the host's camera hasn't started yet -- called
   * again, later, from startCamera for every guest already connected at
   * that point. */
  function addHostTracksTo(pc: RTCPeerConnection) {
    const local = participantsRef.current.get('local');
    if (!local) return;
    const stream = new MediaStream([local.videoTrack, local.audioTrack].filter((t): t is MediaStreamTrack => !!t));
    if (local.videoTrack) pc.addTrack(local.videoTrack, stream);
    if (local.audioTrack) pc.addTrack(local.audioTrack, stream);
  }

  // ---- Canvas compositing ----------------------------------------------

  const LOWER_THIRD_ACCENT = '#7c3aed'; // matches --accent in index.css -- canvas can't read CSS custom properties
  const ENTRANCE_MS = 400;

  function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  /**
   * What viewers see until a camera/screen is on stage: a StreamBird-branded
   * slide instead of a black frame. Lets the host go live (and guests join)
   * without having to enable a camera first.
   */
  function drawBrandSlide(w: number, h: number, now: number) {
    const ctx = ctxRef.current!;
    if (!brandImgRef.current) {
      const img = new Image();
      img.src = '/logo.png';
      brandImgRef.current = img;
    }
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#1b1038');
    bg.addColorStop(1, '#0e0e16');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(w * 0.3, h * 0.2, 0, w * 0.3, h * 0.2, w * 0.6);
    glow.addColorStop(0, 'rgba(124,58,237,0.35)');
    glow.addColorStop(1, 'rgba(124,58,237,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const unit = Math.min(w / 1280, h / 720); // identical to h / 720 on a 16:9 canvas; keeps type inside a narrow portrait one
    const top = h > w ? h * 0.34 : h * 0.24;
    const cx = w / 2;
    const img = brandImgRef.current;
    const logoH = 150 * unit;
    const bob = Math.sin(now / 700) * 6 * unit;
    if (img.complete && img.naturalHeight > 0) {
      const logoW = (img.naturalWidth / img.naturalHeight) * logoH;
      ctx.drawImage(img, cx - logoW / 2, top + bob, logoW, logoH);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${64 * unit}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    ctx.fillText('StreamBird', cx, top + logoH + 80 * unit);
    const title = streamTitleRef.current;
    if (title) {
      ctx.fillStyle = '#d9ccff';
      ctx.font = `500 ${30 * unit}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
      ctx.fillText(title.length > 60 ? `${title.slice(0, 57)}…` : title, cx, top + logoH + 135 * unit);
    }
    ctx.fillStyle = '#9d8fc9';
    ctx.font = `400 ${22 * unit}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    ctx.fillText('Live now — we’ll be on screen in a moment', cx, top + logoH + 180 * unit);
    ctx.textAlign = 'start';
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
    const theme = getTheme(themeIdRef.current);
    const fontSize = b.newsFontSize;
    const barH = newsBarHeight(fontSize);
    let barY = h - barH;
    const appearedAt = tickerAppearedAtRef.current;
    if (appearedAt !== null) {
      const t = Math.min((now - appearedAt) / ENTRANCE_MS, 1);
      const eased = easeOutCubic(t);
      barY = h - barH + (1 - eased) * barH; // slides up from fully below-frame into its resting position
      if (t >= 1) tickerAppearedAtRef.current = null;
    }
    ctx.fillStyle = theme.tickerBg;
    ctx.fillRect(0, barY, w, barH);

    ctx.font = `${fontSize}px sans-serif`;
    ctx.fillStyle = theme.tickerFg;
    ctx.textBaseline = 'middle';
    const textWidth = ctx.measureText(b.newsText).width;

    if (newsScrollXRef.current === null) newsScrollXRef.current = w;
    const dt = lastFrameTimeRef.current === null ? 0 : now - lastFrameTimeRef.current;
    lastFrameTimeRef.current = now;

    newsScrollXRef.current -= dt * 0.08;
    if (newsScrollXRef.current + textWidth < 0) newsScrollXRef.current = w;

    ctx.fillText(b.newsText, newsScrollXRef.current, barY + barH / 2);
  }

  function drawCell(p: Participant, x: number, y: number, w: number, h: number, now: number, style?: TileStyle) {
    const ctx = ctxRef.current!;
    const vw = p.videoEl.videoWidth;
    const vh = p.videoEl.videoHeight;
    if (style) {
      // Framed layouts: a rounded tile that the video fills (cropped, not letterboxed).
      const radius = Math.round(Math.min(w, h) * 0.04 * style.theme.radius);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = Math.max(6, h * 0.02);
      ctx.shadowOffsetY = Math.max(2, h * 0.006);
      ctx.fillStyle = style.theme.cardBg;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.fill();
      ctx.restore();
      if (vw > 0 && vh > 0) {
        const scale = Math.max(w / vw, h / vh);
        const sw = w / scale;
        const sh = h / scale;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, radius);
        ctx.clip();
        ctx.drawImage(p.videoEl, (vw - sw) / 2, (vh - sh) / 2, sw, sh, x, y, w, h);
        ctx.restore();
      }
      ctx.strokeStyle = style.theme.border;
      ctx.lineWidth = Math.max(2, h * 0.003);
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.stroke();
    } else if (vw > 0 && vh > 0) {
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
    const margin = Math.max(6, Math.min(14, w * 0.03));
    const boxH = Math.min(h - margin, fontSize + 16);
    const slideDuration = ENTRANCE_MS * 1.25;
    const t = Math.min((now - p.joinedAt) / slideDuration, 1);
    const eased = easeOutCubic(t);

    if (boxH > 12 && w > 60) {
      const radius = boxH / 2;
      const badgeD = boxH - 8;
      const padX = 4;
      const textGap = 8;
      const maxPlateW = w - margin * 2;
      ctx.font = `600 ${fontSize}px sans-serif`;
      const maxTextW = Math.max(0, maxPlateW - padX * 2 - badgeD - textGap - radius / 2);
      let label = p.displayName;
      if (ctx.measureText(label).width > maxTextW) {
        while (label.length > 1 && ctx.measureText(label + '\u2026').width > maxTextW) label = label.slice(0, -1);
        label += '\u2026';
      }
      const plateW = Math.min(maxPlateW, padX * 2 + badgeD + textGap + ctx.measureText(label).width + radius / 2);
      const plateX = x + margin;
      const plateY = y + h - boxH - margin;

      ctx.save();
      ctx.globalAlpha = eased;
      ctx.translate((1 - eased) * -Math.min(w, 120), 0);

      // Soft drop shadow + translucent dark pill
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = 'rgba(15,15,25,0.78)';
      ctx.beginPath();
      ctx.roundRect(plateX, plateY, plateW, boxH, radius);
      ctx.fill();
      ctx.shadowColor = 'transparent';

      // Gradient initial badge
      const cx = plateX + padX + badgeD / 2;
      const cy = plateY + boxH / 2;
      const grad = ctx.createLinearGradient(cx - badgeD / 2, cy - badgeD / 2, cx + badgeD / 2, cy + badgeD / 2);
      grad.addColorStop(0, style ? style.theme.accent : LOWER_THIRD_ACCENT);
      grad.addColorStop(1, style ? style.theme.accent2 : '#ec4899');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, badgeD / 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.round(fontSize * 0.85)}px sans-serif`;
      ctx.fillText((Array.from(p.displayName.trim())[0] ?? '?').toUpperCase(), cx, cy + 0.5);

      ctx.textAlign = 'left';
      ctx.font = `600 ${fontSize}px sans-serif`;
      ctx.fillText(label, plateX + padX + badgeD + textGap, cy + 0.5);
      ctx.restore();
    }
  }

  function drawGrid(entries: Participant[], w: number, h: number, now: number) {
    // Landscape: as many columns as rows or more (unchanged). A vertical canvas stacks instead, so two people
    // are one above the other rather than two slim columns.
    const portrait = h > w;
    const cols = portrait ? Math.ceil(entries.length / Math.ceil(Math.sqrt(entries.length))) : Math.ceil(Math.sqrt(entries.length));
    const rows = Math.ceil(entries.length / cols);
    const cellW = w / cols;
    const cellH = h / rows;
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

  /** The slide area of a framed layout: the screen share when one is active, else the current slideshow image. */
  function drawSlideArea(rect: Rect, screen: Participant | null, theme: CanvasTheme) {
    const ctx = ctxRef.current!;
    const radius = Math.round(Math.min(rect.w, rect.h) * 0.03 * theme.radius);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = Math.max(6, rect.h * 0.02);
    ctx.shadowOffsetY = Math.max(2, rect.h * 0.006);
    ctx.fillStyle = theme.cardBg;
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, radius);
    ctx.fill();
    ctx.restore();

    const fitInto = (srcW: number, srcH: number, draw: (x: number, y: number, w: number, h: number) => void) => {
      const scale = Math.min(rect.w / srcW, rect.h / srcH);
      const dw = srcW * scale;
      const dh = srcH * scale;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(rect.x, rect.y, rect.w, rect.h, radius);
      ctx.clip();
      draw(rect.x + (rect.w - dw) / 2, rect.y + (rect.h - dh) / 2, dw, dh);
      ctx.restore();
    };

    const slide = slidesRef.current[slideIndexRef.current];
    if (screen && screen.videoEl.videoWidth > 0) {
      fitInto(screen.videoEl.videoWidth, screen.videoEl.videoHeight, (x, y, w, h) => ctx.drawImage(screen.videoEl, x, y, w, h));
    } else if (slide) {
      fitInto(slide.canvas.width, slide.canvas.height, (x, y, w, h) => ctx.drawImage(slide.canvas, x, y, w, h));
    } else {
      ctx.save();
      ctx.fillStyle = theme.fg;
      ctx.globalAlpha = 0.55;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const base = Math.min(rect.w, rect.h); // = rect.h on a landscape card; the width on a tall vertical one
      const maxW = rect.w * 0.9;
      ctx.font = `600 ${Math.round(base * 0.07)}px system-ui, sans-serif`;
      ctx.fillText('Slides', rect.x + rect.w / 2, rect.y + rect.h / 2 - base * 0.04, maxW);
      ctx.font = `400 ${Math.round(base * 0.04)}px system-ui, sans-serif`;
      ctx.fillText('Add images in the Slides panel, or share your screen', rect.x + rect.w / 2, rect.y + rect.h / 2 + base * 0.05, maxW);
      ctx.restore();
    }
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = Math.max(2, Math.min(rect.w, rect.h) * 0.003);
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, radius);
    ctx.stroke();
  }

  function drawFramed(layout: LayoutId, entries: Participant[], w: number, h: number, now: number) {
    const def = LAYOUT_BY_ID[layout];
    const theme = getTheme(themeIdRef.current);
    // Tiles stop above the ticker bar when one is showing.
    const reserve = brandingRef.current.newsText ? newsBarHeight(brandingRef.current.newsFontSize) : 0;
    const geo = computeLayout(layout, w, h - reserve);
    const screen = def.hasSlide ? (entries.find((p) => p.id === SCREEN_SHARE_ID) ?? null) : null;
    const people = orderPeople(
      layout,
      def.hasSlide ? entries.filter((p) => p.id !== SCREEN_SHARE_ID) : entries,
      pinnedIdRef.current,
    );
    if (geo.slide) drawSlideArea(geo.slide, screen, theme);
    const style: TileStyle = { fit: 'cover', radius: theme.radius, theme };
    people.slice(0, geo.people.length).forEach((p, i) => {
      const t = geo.people[i];
      drawCell(p, t.x, t.y, t.w, t.h, now, style);
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
      if (!canvas) return;
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
      if (!ctx) return;
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

      paintBackground(ctx, getTheme(themeIdRef.current), w, h);
      const wp = wallpaperRef.current;
      if (wp) {
        const ws = wallpaperSettingsRef.current;
        paintWallpaper(ctx, wp, w, h, ws.x, ws.y, ws.dim);
      }

      const layout = layoutModeRef.current;
      if (isFramedLayout(layout)) {
        // A slide layout is still worth drawing with nobody on camera (the slides are the content).
        if (entries.length > 0 || LAYOUT_BY_ID[layout].hasSlide) drawFramed(layout, entries, w, h, now);
        else drawBrandSlide(w, h, now);
      } else if (entries.length > 0) {
        if (layout === 'spotlight') drawSpotlight(entries, w, h, now);
        else drawGrid(entries, w, h, now);
      } else {
        drawBrandSlide(w, h, now);
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

    }

    // Visible tab: rAF (vsync-aligned). Hidden tab: rAF is paused by the
    // browser, so the worker's ticks drive the same frame() instead.
    const gen = ++drawGenRef.current;
    // Not keyed on document.hidden alone: a covered/minimized window can be
    // throttled before (or without) the page reporting itself hidden, so
    // the worker also steps in whenever rAF simply hasn't fired recently.
    let lastRafAt = performance.now();
    const raf = (t: number) => {
      if (gen !== drawGenRef.current) return;
      lastRafAt = performance.now();
      frame(t);
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);

    const worker = createTickWorker();
    tickWorkerRef.current = worker;
    if (worker) {
      worker.onmessage = (e: MessageEvent<string>) => {
        if (e.data === 'draw' && (document.hidden || performance.now() - lastRafAt > 100)) frame(performance.now());
        else if (e.data === 'key') forceKeyFrameRef.current?.();
      };
      worker.postMessage('start');
    }
  }

  // ---- Guest signaling ---------------------------------------------------

  const handleGuestOffer = useCallback(async (fromSocketId: string, offer: RTCSessionDescriptionInit) => {
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
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

    // Renegotiation: fires only if the host's own camera starts (see
    // startCamera's addHostTracksTo loop) after this guest already
    // connected -- addTrack on an already-stable connection queues this
    // event, which we answer with a fresh offer on the SAME connection.
    // The only place in this file a connection is renegotiated rather than
    // negotiated once via a single offer/answer round.
    pc.onnegotiationneeded = async () => {
      try {
        const renegotiationOffer = await pc.createOffer();
        await pc.setLocalDescription(renegotiationOffer);
        socketRef.current?.emit('signal', { to: fromSocketId, type: 'offer', payload: renegotiationOffer });
      } catch (err) {
        console.warn('Renegotiation failed for guest', fromSocketId, err);
      }
    };

    // Diagnostic: this is a direct P2P connection -- now TURN-backed (see
    // iceServersRef) after this exact gap caused a guest behind a NAT/
    // firewall STUN alone can't traverse to silently never show up, with
    // nothing in the UI distinguishing that from "just slow". Kept after
    // adding TURN as an ongoing health signal, not just removed now that
    // the likely cause is fixed. Previously only console.log'd (invisible
    // once the session's over); also reported to the server so a stuck/
    // failed connection actually shows up in production logs after the
    // fact, not just in a console nobody was watching live.
    const reportRtcState = () => {
      console.log(
        `[guest ${fromSocketId}] ICE connection state: ${pc.iceConnectionState}, connection state: ${pc.connectionState}`,
      );
      socketRef.current?.emit('rtc-state', {
        about: fromSocketId,
        iceConnectionState: pc.iceConnectionState,
        connectionState: pc.connectionState,
      });
    };
    pc.oniceconnectionstatechange = reportRtcState;
    pc.onconnectionstatechange = reportRtcState;

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    // Added here, before the answer -- if the host's camera is already
    // running, this reuses the recvonly transceivers WebRTC auto-created
    // from the guest's offer (flipping them to sendrecv) so the guest
    // starts receiving the host's video/audio in this SAME initial
    // negotiation round, instead of a separate renegotiation right after.
    addHostTracksTo(pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socketRef.current?.emit('signal', { to: fromSocketId, type: 'answer', payload: answer });
  }, []);

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
      // The server replays every already-connected guest to a (re)connecting
      // host. A guest we still hold a healthy connection to (just a
      // signaling blip) must be left alone; a dead or missing one (host
      // reloaded) gets a fresh offer.
      const existing = participantsRef.current.get(socketId);
      if (existing?.pc && !['failed', 'closed', 'disconnected'].includes(existing.pc.connectionState)) return;
      existing?.pc?.close();
      pendingDisplayNamesRef.current.set(socketId, displayName || 'Guest');
      socket.emit('signal', { to: socketId, type: 'request-offer', payload: { displayName: 'Host' } });
    });

    socket.on('peer-left', ({ socketId }: { socketId: string }) => {
      const p = participantsRef.current.get(socketId);
      if (p) {
        p.pc?.close();
        participantsRef.current.delete(socketId);
        renderParticipantList();
      }
      pendingDisplayNamesRef.current.delete(socketId);
      removeParticipantAudio(socketId);
    });

    socket.on('signal', async (msg: { from: string; type: string; payload: unknown }) => {
      if (msg.type === 'offer') {
        await handleGuestOffer(msg.from, msg.payload as RTCSessionDescriptionInit);
      } else if (msg.type === 'answer') {
        // Only ever a renegotiation answer -- see handleGuestOffer's
        // onnegotiationneeded, the one case where this file sends an
        // offer to (rather than receives one from) a guest.
        const p = participantsRef.current.get(msg.from);
        if (p?.pc) {
          try {
            await p.pc.setRemoteDescription(new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit));
          } catch (err) {
            console.warn('Failed to apply a renegotiation answer from a guest', err);
          }
        }
      } else if (msg.type === 'ice-candidate') {
        const p = participantsRef.current.get(msg.from);
        if (p?.pc) {
          try {
            await p.pc.addIceCandidate(new RTCIceCandidate(msg.payload as RTCIceCandidateInit));
          } catch (err) {
            console.warn('Failed to add ICE candidate from guest', err);
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

    // Fired in parallel with the stream/host-token load below, not chained
    // after it -- so iceServersRef is as likely as possible to already be
    // populated with real TURN credentials by the time a guest's offer
    // actually arrives. Never blocks stream loading on this: if it's slow
    // or fails, every RTCPeerConnection in this file just falls back to
    // DEFAULT_ICE_SERVERS (STUN-only) instead.
    getTurnCredentials()
      .then((res) => {
        if (!cancelled && res.iceServers?.length) iceServersRef.current = res.iceServers;
      })
      .catch(() => {});

    (async () => {
      try {
        const streamRow = await getStream(streamId);
        if (!streamRow.studioSessionId) throw new Error('This stream has no studio session.');

        const { token: hostToken } = await mintHostToken(streamRow.studioSessionId);
        if (cancelled) return;

        const saved = loadPersisted(streamRow.id);
        if (isLayoutId(saved.layoutMode)) {
          layoutModeRef.current = saved.layoutMode;
          setLayoutMode(saved.layoutMode);
        }
        if (saved.themeId && saved.themeId in THEME_BY_ID) {
          themeIdRef.current = saved.themeId;
          setThemeIdState(saved.themeId);
        }
        if (saved.resolution && saved.resolution in RESOLUTIONS) setResolutionState(saved.resolution);
        if (saved.branding) {
          // Merged over the defaults so a state saved before a field existed (newsFontSize) still loads.
          const merged: Branding = { ...DEFAULT_BRANDING, ...saved.branding };
          Object.assign(brandingRef.current, merged);
          setBranding(merged);
          if (saved.branding.newsText) tickerAppearedAtRef.current = performance.now();
        }
        if (saved.scenes) setScenes(saved.scenes);
        if (saved.logoDataUrl) {
          const img = new Image();
          img.onload = () => {
            brandingRef.current.logoImg = img;
            logoAppearedAtRef.current = performance.now();
          };
          img.src = saved.logoDataUrl;
        }

        const savedWp = loadPersistedWallpaper(streamRow.id);
        if (savedWp) {
          wallpaperFromDataUrl(savedWp.dataUrl, savedWp.name, savedWp.width, savedWp.height)
            .then((wp) => {
              if (cancelled) return;
              wallpaperRef.current = wp;
              wallpaperDataUrlRef.current = savedWp.dataUrl;
              wallpaperSettingsRef.current = { x: savedWp.focusX, y: savedWp.focusY, dim: savedWp.dim };
              setWallpaperState({ name: wp.name, width: wp.width, height: wp.height });
              setWallpaperFocusState({ x: savedWp.focusX, y: savedWp.focusY });
              setWallpaperDimState(savedWp.dim);
            })
            .catch(() => savePersistedWallpaper(streamRow.id, null));
        }

        hostTokenRef.current = hostToken;
        streamTitleRef.current = streamRow.title ?? '';
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
      // Stop this mount's draw loop + worker (a re-mount, e.g. React
      // StrictMode's, starts its own fresh pair).
      drawGenRef.current++;
      drawingRef.current = false;
      tickWorkerRef.current?.terminate();
      tickWorkerRef.current = null;
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

  useEffect(() => {
    if (!stream) return;
    savePersisted(stream.id, { layoutMode, resolution, branding, themeId, scenes });
  }, [stream, layoutMode, resolution, branding, themeId, scenes]);

  // Plan quality cap: fetch once, and pull a saved/default resolution down to it.
  useEffect(() => {
    getMyLimits()
      .then((l) => {
        setMaxResolution(l.maxResolution);
        setResolutionState((r) => (RESOLUTION_ORDER.indexOf(r) > RESOLUTION_ORDER.indexOf(l.maxResolution) ? l.maxResolution : r));
      })
      .catch(() => {});
  }, []);

  // ---- 2. Actions exposed to the page ----------------------------------

  const startCamera = useCallback(async () => {
    setCameraStarting(true);
    try {
      // A vertical stream asks for a tall picture (a phone gives one; a webcam gives the closest mode it has,
      // so less of the frame is cropped away). `ideal` never fails the request.
      const video: MediaTrackConstraints | boolean = orientationRef.current === 'portrait' ? { aspectRatio: { ideal: 9 / 16 } } : true;
      const localStream = await navigator.mediaDevices.getUserMedia({ video, audio: AUDIO_CONSTRAINTS });
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

      // A guest may already be connected from before the host's camera
      // started (nothing in the UI requires camera-first) -- addHostTracksTo
      // on an already-stable connection queues a renegotiation (see
      // handleGuestOffer's onnegotiationneeded) so they still end up
      // receiving the host's video/audio, just one round-trip later.
      for (const p of participantsRef.current.values()) {
        if (p.pc) addHostTracksTo(p.pc);
      }
    } catch (err) {
      setStatus({ text: `Could not start camera: ${(err as Error).message}`, isError: true });
    } finally {
      setCameraStarting(false);
    }
  }, []);

  // setLayout is the shared primitive -- it sets the layout directly (used
  // by both the toggle button and scene-switching) and persists it to the
  // backend exactly like the original toggle-only implementation did.
  const setLayout = useCallback((next: LayoutMode) => {
    beginTransition();
    layoutModeRef.current = next;
    setLayoutMode(next);
    setStatus({ text: `Layout: ${LAYOUT_BY_ID[next]?.name ?? next}`, isError: false });

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
  // that's what lets it ride the existing grid/spotlight draw loop (and
  // the broadcast audio mix) with zero extra plumbing. It's composited
  // into the canvas the host publishes, same as any guest, but -- unlike
  // a guest's camera -- never reaches another participant's own meeting
  // grid (see useGuestStudio): that's a direct mesh between real
  // participants' RTCPeerConnections, with no path for the host to also
  // fan a synthetic, non-participant track into it.

  const stopScreenShare = useCallback(() => {
    const p = participantsRef.current.get(SCREEN_SHARE_ID);
    if (!p) return;
    p.videoTrack?.stop();
    p.audioTrack?.stop();
    participantsRef.current.delete(SCREEN_SHARE_ID);
    removeParticipantAudio(SCREEN_SHARE_ID);
    renderParticipantList();
    setScreenSharing(false);
  }, []);

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
    } catch (err) {
      setStatus({ text: `Could not start screen share: ${(err as Error).message}`, isError: true });
    }
  }, [stopScreenShare]);

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
    removeParticipantAudio(id);
  }, []);

  function setLogoFile(file: File | null) {
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      brandingRef.current.logoImg = img;
      logoAppearedAtRef.current = performance.now();
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);

    // Also keep it (as a data URL) so a reload doesn't lose the logo.
    if (stream && file.size <= 1_000_000) {
      const reader = new FileReader();
      reader.onload = () => savePersisted(stream.id, { logoDataUrl: String(reader.result) });
      reader.readAsDataURL(file);
    }
  }

  function setLogoSize(size: number) {
    if (Number.isFinite(size) && size > 0) {
      size = Math.min(BRANDING_RANGES.logoSize.max, size);
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
      size = Math.min(BRANDING_RANGES.nameFontSize.max, size);
      brandingRef.current.nameFontSize = size;
      setBranding((b) => ({ ...b, nameFontSize: size }));
    }
  }

  function setNewsFontSize(size: number) {
    if (Number.isFinite(size) && size > 0) {
      size = Math.min(BRANDING_RANGES.newsFontSize.max, size);
      brandingRef.current.newsFontSize = size;
      setBranding((b) => ({ ...b, newsFontSize: size }));
    }
  }

  // ---- Canvas style and slides ------------------------------------------

  // ---- Wallpaper -----------------------------------------------------------

  function persistWallpaper() {
    if (!stream) return true;
    const wp = wallpaperRef.current;
    if (!wp || !wallpaperDataUrlRef.current) return savePersistedWallpaper(stream.id, null);
    const ws = wallpaperSettingsRef.current;
    return savePersistedWallpaper(stream.id, {
      name: wp.name,
      width: wp.width,
      height: wp.height,
      dataUrl: wallpaperDataUrlRef.current,
      focusX: ws.x,
      focusY: ws.y,
      dim: ws.dim,
    });
  }

  async function setWallpaperFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus({ text: 'A wallpaper must be an image file (JPG, PNG, WebP...).', isError: true });
      return;
    }
    try {
      const wp = await loadWallpaper(file);
      beginTransition();
      wallpaperRef.current = wp;
      wallpaperDataUrlRef.current = wallpaperToDataUrl(wp);
      wallpaperSettingsRef.current = { x: WALLPAPER_RANGES.focus.default, y: WALLPAPER_RANGES.focus.default, dim: wallpaperSettingsRef.current.dim };
      setWallpaperState({ name: wp.name, width: wp.width, height: wp.height });
      setWallpaperFocusState({ x: WALLPAPER_RANGES.focus.default, y: WALLPAPER_RANGES.focus.default });
      if (!persistWallpaper()) {
        setStatus({ text: 'Wallpaper added. It is too large to keep after a reload, so you will need to add it again then.', isError: false });
      }
    } catch {
      setStatus({ text: `Could not read "${file.name}" as an image.`, isError: true });
    }
  }

  function clearWallpaper() {
    beginTransition();
    wallpaperRef.current = null;
    wallpaperDataUrlRef.current = null;
    setWallpaperState(null);
    persistWallpaper();
  }

  function setWallpaperFocus(x: number, y: number) {
    const clamp = (v: number) => Math.min(WALLPAPER_RANGES.focus.max, Math.max(WALLPAPER_RANGES.focus.min, v));
    wallpaperSettingsRef.current = { ...wallpaperSettingsRef.current, x: clamp(x), y: clamp(y) };
    setWallpaperFocusState({ x: clamp(x), y: clamp(y) });
    persistWallpaper();
  }

  function setWallpaperDim(dim: number) {
    const v = Math.min(WALLPAPER_RANGES.dim.max, Math.max(WALLPAPER_RANGES.dim.min, dim));
    wallpaperSettingsRef.current = { ...wallpaperSettingsRef.current, dim: v };
    setWallpaperDimState(v);
    persistWallpaper();
  }

  const setTheme = useCallback((id: string) => {
    if (!(id in THEME_BY_ID)) return;
    beginTransition();
    themeIdRef.current = id;
    setThemeIdState(id);
  }, []);

  const gotoSlide = useCallback((index: number) => {
    const count = slidesRef.current.length;
    if (count === 0) return;
    const next = Math.min(count - 1, Math.max(0, index));
    if (next === slideIndexRef.current) return;
    beginTransition();
    slideIndexRef.current = next;
    setSlideIndex(next);
  }, []);

  const addSlides = useCallback(async (files: FileList | File[] | null) => {
    if (!files) return;
    const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) {
      setStatus({ text: 'Slides must be image files (PNG, JPG, WebP...). Export a PDF or deck as images first.', isError: true });
      return;
    }
    if (slidesRef.current.length >= MAX_SLIDES) {
      setStatus({ text: `The slideshow already has ${MAX_SLIDES} slides, the limit. Clear some first.`, isError: true });
      return;
    }
    const loaded: SlideImage[] = [];
    for (const f of images) {
      try {
        loaded.push(await loadSlide(f));
      } catch {
        setStatus({ text: `Could not read "${f.name}" as an image.`, isError: true });
      }
    }
    if (loaded.length === 0) return;
    // Decoding is async, so the room is worked out here, after it: two overlapping adds can't exceed the cap.
    const room = Math.max(0, MAX_SLIDES - slidesRef.current.length);
    const kept = loaded.slice(0, room);
    slidesRef.current = [...slidesRef.current, ...kept];
    setSlides(slidesRef.current.map((x) => ({ name: x.name })));
    if (kept.length < loaded.length || images.length > loaded.length) {
      setStatus({ text: `Added ${kept.length} of ${images.length} slides (limit ${MAX_SLIDES}, images only).`, isError: false });
    }
  }, []);

  const clearSlides = useCallback(() => {
    slidesRef.current = [];
    slideIndexRef.current = 0;
    setSlides([]);
    setSlideIndex(0);
  }, []);

  const nextSlide = useCallback(() => gotoSlide(slideIndexRef.current + 1), [gotoSlide]);
  const prevSlide = useCallback(() => gotoSlide(slideIndexRef.current - 1), [gotoSlide]);

  // Arrow keys flip slides (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (slidesRef.current.length === 0) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') nextSlide();
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prevSlide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextSlide, prevSlide]);

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
      themeId: themeIdRef.current,
      branding: {
        logoSize: brandingRef.current.logoSize,
        newsText: brandingRef.current.newsText,
        nameFontSize: brandingRef.current.nameFontSize,
        newsFontSize: brandingRef.current.newsFontSize,
      },
    };
    setScenes((prev) => [...prev.filter((s) => s.name !== trimmed), snapshot]);
    setActiveSceneName(trimmed);
    setStatus({ text: `Saved scene "${trimmed}".`, isError: false });
  }, []);

  const applyScene = useCallback((name: string) => {
    // Read from a ref, not inside a setState updater: updaters must be pure (StrictMode runs them twice).
    const scene = scenesRef.current.find((sc) => sc.name === name);
    if (!scene) return;
    setLayout(scene.layoutMode); // also starts the crossfade, which covers the style and branding change below
    if (scene.themeId && scene.themeId in THEME_BY_ID) {
      themeIdRef.current = scene.themeId;
      setThemeIdState(scene.themeId);
    }
    const sceneBranding: Branding = { ...DEFAULT_BRANDING, ...scene.branding };
    brandingRef.current.logoSize = sceneBranding.logoSize;
    brandingRef.current.newsText = sceneBranding.newsText;
    brandingRef.current.nameFontSize = sceneBranding.nameFontSize;
    brandingRef.current.newsFontSize = sceneBranding.newsFontSize;
    newsScrollXRef.current = null;
    setBranding(sceneBranding);
    setActiveSceneName(name);
    setStatus({ text: `Switched to scene "${name}".`, isError: false });
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
      // No camera/mic yet is fine: the mix destination exists (silent) so the
      // publish always carries an audio track, and a mic connected later
      // simply starts flowing into it.
      ensureAudioMix();
      const audioCtx = audioContextRef.current;
      if (audioCtx && audioCtx.state !== 'running') await audioCtx.resume().catch(() => {});
      const videoTrack = canvasRef.current!.captureStream(30).getVideoTracks()[0];
      const audioTrack = audioDestinationRef.current ? audioDestinationRef.current.stream.getAudioTracks()[0] : null;

      const whipPc = new RTCPeerConnection({ iceServers: iceServersRef.current });
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
      forceKeyFrameRef.current = forceKeyFrame;
      if (!tickWorkerRef.current) keyFrameIntervalRef.current = setInterval(forceKeyFrame, 2000);
      savePersisted(stream.id, { wentLive: true });

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

    forceKeyFrameRef.current = null;
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
      savePersisted(stream.id, { wentLive: false });
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
    socketRef.current?.disconnect();

    if (ended) {
      setTimeout(() => {
        window.location.href = '/';
      }, 1500);
    }
    return ended;
  }, [stream]);

  /**
   * A scheduled stream has no platform broadcasts or publish URL until it's
   * started. Starting it provisions them and flips it LIVE; the host then
   * goes live (publishes) as usual.
   */
  const startScheduledStream = useCallback(async () => {
    if (!stream || startingScheduled) return;
    setStartingScheduled(true);
    try {
      const started = await startStream(stream.id);
      setStream((prev) => (prev ? { ...prev, ...started } : started));
      setStatus({ text: 'Stream started — press Go live when you are ready.', isError: false });
    } catch (err) {
      setStatus({ text: err instanceof ApiError ? err.message : 'Failed to start the stream.', isError: true });
    } finally {
      setStartingScheduled(false);
    }
  }, [stream, startingScheduled]);

  /**
   * Brings a reloaded/crashed host page back on air: camera first (so
   * there's something to composite), the audio context resumed (browsers
   * start it suspended until a user gesture -- silent publish otherwise),
   * then re-publish to the same WHIP URL. The backend is already showing
   * the "technical difficulties" slate and keeps the stream LIVE for up
   * to 5 minutes (see GlitchRecoveryService); the first frames this
   * publishes replace it. Safe to call repeatedly -- each step is skipped
   * if it's already done.
   */
  const resumeLive = useCallback(async () => {
    // Camera is best-effort: if it can't start (denied, no device, or no user
    // gesture after a reload) the branded slide keeps the stream on air.
    if (!participantsRef.current.has('local')) await startCamera();

    const ctx = audioContextRef.current;
    if (ctx && ctx.state !== 'running') await ctx.resume().catch(() => {});
    setAudioBlocked(ctx ? ctx.state !== 'running' : false);

    if (!whipPcRef.current || whipPcRef.current.connectionState === 'failed' || whipPcRef.current.connectionState === 'closed') {
      await goLive();
    }
  }, [startCamera, goLive]);

  // Track the audio context's state so the page can offer a one-click fix
  // if the browser kept it suspended (autoplay policy).
  useEffect(() => {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    const onChange = () => setAudioBlocked(ctx.state !== 'running');
    ctx.addEventListener('statechange', onChange);
    return () => ctx.removeEventListener('statechange', onChange);
  }, [cameraStarted]);

  // A host reloading mid-show: this browser already took this stream live
  // before (persisted flag) and the backend still has it LIVE, so don't
  // wait for a manual "Go live" -- re-publish straight away. A first visit
  // to a freshly created stream (also status LIVE server-side) never has
  // the flag, so it still waits for the host to press the button.
  useEffect(() => {
    if (!stream || stream.status !== 'live' || !stream.whipUrl || loading) return;
    if (autoResumeTriedRef.current) return;
    if (!loadPersisted(stream.id).wentLive) return;
    autoResumeTriedRef.current = true;
    setResumeAttempted(true);
    setStatus({ text: 'Stream is still live — restoring your studio…', isError: false });
    void resumeLive();
  }, [stream, loading, resumeLive]);

  // "Leave this page? You're live" -- a reload/close mid-show drops the
  // broadcast to the slate until the host is back. Not while ending: End
  // stream deliberately redirects away.
  useEffect(() => {
    if (!isLive || ending) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isLive, ending]);

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
    orientation: (stream?.orientation ?? 'landscape') as StreamOrientation,
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
    pinnedId,
    audioBlocked,
    resumeAttempted,
    startingScheduled,
    actions: {
      startScheduledStream,
      resumeLive,
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
      setNewsFontSize,
      setTheme,
      setWallpaperFile,
      clearWallpaper,
      setWallpaperFocus,
      setWallpaperDim,
      addSlides,
      clearSlides,
      nextSlide,
      prevSlide,
      gotoSlide,
      startScreenShare,
      stopScreenShare,
      saveScene,
      applyScene,
    },
  };
}
