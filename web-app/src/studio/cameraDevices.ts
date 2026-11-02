// Pure helpers for choosing the host's camera and microphone (no DOM/React beyond localStorage), unit-tested by
// test/ui/cameradevices.spec.ts.

export type Facing = 'user' | 'environment';

export interface DeviceOption {
  /** MediaDeviceInfo.deviceId. Empty before the browser has granted permission (nothing can be chosen then). */
  id: string;
  label: string;
}

export interface DeviceInfoLike {
  kind: string;
  deviceId: string;
  label: string;
}

/**
 * The devices of one kind, de-duplicated, with a readable label. Before permission is granted browsers return empty
 * labels (and sometimes empty ids): those get "Camera 1", "Camera 2"... so the list is never blank. Chrome's virtual
 * "default"/"communications" microphone entries are kept only when they are the sole choice (they repeat a real device).
 */
export function normaliseDevices(list: readonly DeviceInfoLike[], kind: 'videoinput' | 'audioinput'): DeviceOption[] {
  const noun = kind === 'videoinput' ? 'Camera' : 'Microphone';
  const seen = new Set<string>();
  const raw = list.filter((d) => d.kind === kind);
  const hasReal = raw.some((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const out: DeviceOption[] = [];
  for (const d of raw) {
    if (hasReal && (d.deviceId === 'default' || d.deviceId === 'communications')) continue;
    if (d.deviceId) {
      if (seen.has(d.deviceId)) continue;
      seen.add(d.deviceId);
    }
    out.push({ id: d.deviceId, label: (d.label || '').trim() || `${noun} ${out.length + 1}` });
  }
  return out;
}

/** The remembered device id if it can still be used, else null (then the browser's default is used). */
export function resolveRemembered(id: string | null | undefined, devices: readonly DeviceOption[]): string | null {
  if (!id) return null;
  const usable = devices.filter((d) => d.id);
  if (usable.length === 0) return id; // no list yet (permission not granted): the request itself uses `ideal`, so a stale id is harmless
  return usable.some((d) => d.id === id) ? id : null;
}

/** Which way a camera faces, judged by its name ("Front Camera", "camera2 0, facing back"...). null when the name does not tell. */
export function guessFacing(label: string): Facing | null {
  const l = label.toLowerCase();
  if (/\b(back|rear|environment|world)\b/.test(l)) return 'environment';
  if (/\b(front|user|selfie|facetime)\b/.test(l)) return 'user';
  return null;
}

export const otherFacing = (f: Facing): Facing => (f === 'user' ? 'environment' : 'user');

export interface VideoChoice {
  /** Exact: an explicit pick that must be honoured (fails if the camera is gone). */
  exactId?: string | null;
  /** Ideal: a remembered pick that quietly falls back to the default camera. */
  idealId?: string | null;
  facing?: Facing | null;
  portrait: boolean;
}

/** Video constraints for getUserMedia. A vertical stream always asks (ideally) for a tall picture, on any camera. */
export function buildVideoConstraints(c: VideoChoice): MediaTrackConstraints | true {
  const v: MediaTrackConstraints = {};
  if (c.portrait) v.aspectRatio = { ideal: 9 / 16 };
  if (c.exactId) v.deviceId = { exact: c.exactId };
  else if (c.idealId) v.deviceId = { ideal: c.idealId };
  else if (c.facing) v.facingMode = { exact: c.facing };
  return Object.keys(v).length ? v : true;
}

export function buildAudioConstraints(base: MediaTrackConstraints, c: { exactId?: string | null; idealId?: string | null }): MediaTrackConstraints {
  if (c.exactId) return { ...base, deviceId: { exact: c.exactId } };
  if (c.idealId) return { ...base, deviceId: { ideal: c.idealId } };
  return base;
}

/**
 * The camera the flip button should move to. Names that tell front from back win (pick a camera facing the other
 * way); otherwise null and the caller asks the browser for the other `facingMode`, or cycles when it cannot.
 */
export function pickFlipTarget(cameras: readonly DeviceOption[], currentId: string | null, currentFacing: Facing): { id: string; facing: Facing } | null {
  const want = otherFacing(currentFacing);
  const match = cameras.find((c) => c.id && c.id !== currentId && guessFacing(c.label) === want);
  return match ? { id: match.id, facing: want } : null;
}

/** The next camera in the list after the current one (wraps), for when facing cannot be told. */
export function nextCamera(cameras: readonly DeviceOption[], currentId: string | null): DeviceOption | null {
  const usable = cameras.filter((c) => c.id);
  if (usable.length < 2) return null;
  const i = usable.findIndex((c) => c.id === currentId);
  return usable[(i + 1) % usable.length];
}

/** A phone/tablet style device (touch is the primary input). */
export function isTouchDevice(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

export function isIOS(): boolean {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** A short, human reason for a failed getUserMedia. */
export function describeMediaError(err: unknown, what: 'camera' | 'microphone' = 'camera'): string {
  const name = (err as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `The browser blocked the ${what}. Allow it in the address bar and try again.`;
    case 'NotReadableError':
    case 'AbortError':
    case 'TrackStartError':
      return `The ${what} is busy (another app or tab may be using it).`;
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return `That ${what} is not available.`;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return `No ${what} was found.`;
    default:
      return (err as Error | null)?.message || `The ${what} could not be started.`;
  }
}

export interface DeviceChoice {
  cameraId: string | null;
  micId: string | null;
}

const KEY = 'streambird:studio:devices:v1';

/** The remembered camera and microphone (global, not per stream). Never throws. */
export function loadDeviceChoice(): DeviceChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<DeviceChoice>;
    return {
      cameraId: typeof raw.cameraId === 'string' && raw.cameraId ? raw.cameraId : null,
      micId: typeof raw.micId === 'string' && raw.micId ? raw.micId : null,
    };
  } catch {
    return { cameraId: null, micId: null };
  }
}

export function saveDeviceChoice(patch: Partial<DeviceChoice>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadDeviceChoice(), ...patch }));
  } catch {
    // best-effort
  }
}
