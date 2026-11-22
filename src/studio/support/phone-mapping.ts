/**
 * The two pure translations between the support whitelist (web studio vocabulary, `support-command.ts`) and the
 * Android app's remote-control contract (halleshubham/streambird-android docs/API-CONTRACT.md, FEATURES.md section 27).
 * No Nest, no I/O: unit-tested in phone-mapping.spec.ts. The mapping table is documented in `.claude/docs/backend.md`.
 *
 *  - `toPhoneCommand`: a support command that ALREADY passed `parseSupportCommand` -> what the phone is told, or the
 *    reason the phone cannot do it (answered by the server immediately, nothing is enqueued).
 *  - `phoneStateToSnapshot`: the state the phone PUTs (untrusted) -> the snapshot shape the control page renders,
 *    rebuilt field by field and then re-validated by `sanitizeSupportState`.
 */
import { AD_PLACEMENT_IDS, type SupportCommand } from './support-command';
import { sanitizeSupportState, SUPPORT_SEQUENCE_MAX, SUPPORT_STATE_TEXT_MAX, type SanitizedSupportState } from './support-state';

export const PHONE_UNSUPPORTED_ERROR = 'Not supported on the phone app';
/** Support command types the phone app can apply. Everything else in the whitelist is answered by the server. */
export const PHONE_SUPPORTED_TYPES = ['ads.manual', 'ads.enabled', 'ads.schedule', 'ads.shrink', 'ticker.set', 'clock.set', 'kit.apply', 'logo.set', 'lowerThird.set'] as const;
/** Answered (audited, never queued) when the phone's last snapshot does not show the capability a command needs. */
export const PHONE_UPDATE_ERROR = 'This phone app version does not support that: update the app';
/** Answered (audited, never queued) while the phone has not reported any state yet (just reconnected, or its state expired). */
export const PHONE_WAITING_ERROR = 'Waiting for the phone app to report its state. Try again in a few seconds.';
export type PhoneCommandType = (typeof PHONE_SUPPORTED_TYPES)[number];

export type PhoneCommandMapping = { supported: true; type: PhoneCommandType; payload: Record<string, unknown> } | { supported: false; error: string };

/** Which optional capabilities the phone's LAST snapshot showed (set by `phoneStateToSnapshot`; null/undefined = no snapshot yet). */
export type PhoneCaps = SanitizedSupportState['phoneCaps'];

/**
 * `caps` = the capabilities of the phone's last snapshot. The three newer commands (kit.apply, logo.set, lowerThird.set) are only
 * relayed when the snapshot shows the matching capability; an older phone app gets PHONE_UPDATE_ERROR at once. With NO snapshot
 * yet (`caps` null/undefined) the answer is PHONE_WAITING_ERROR instead: the phone may well be capable.
 */
export function toPhoneCommand(cmd: SupportCommand, caps?: PhoneCaps | null): PhoneCommandMapping {
  const p = cmd.payload;
  switch (cmd.type) {
    case 'ads.manual':
      return { supported: true, type: 'ads.manual', payload: { placement: p.placement, mode: p.manual } }; // web "manual" = phone "mode"
    case 'ads.enabled':
      return { supported: true, type: 'ads.enabled', payload: { placement: p.placement, on: p.enabled } }; // web "enabled" = phone "on"
    case 'ads.schedule': {
      const payload: Record<string, unknown> = { placement: p.placement, mode: p.mode };
      if (p.showSec !== undefined) payload.showSec = p.showSec;
      if (p.everySec !== undefined) payload.everySec = p.everySec;
      return { supported: true, type: 'ads.schedule', payload };
    }
    case 'ads.shrink':
      return { supported: true, type: 'ads.shrink', payload: { on: p.on } };
    case 'ticker.set': {
      // Phone: {text: string|null, on: boolean}, both always present; text null = keep the current text, on:false = clear.
      // Web semantics: a non-empty text shows (unless on:false); empty/null text clears; no text + on:true = show the last text.
      const hasText = typeof p.text === 'string' && p.text.trim() !== '';
      if (hasText) return { supported: true, type: 'ticker.set', payload: { text: p.text, on: p.on !== false } };
      if (p.text !== undefined) return { supported: true, type: 'ticker.set', payload: { text: null, on: false } };
      return { supported: true, type: 'ticker.set', payload: { text: null, on: p.on === true } };
    }
    case 'clock.set':
      return { supported: true, type: 'clock.set', payload: { ...p } }; // identical names and values (the kit clock contract)
    case 'kit.apply':
      if (!caps) return { supported: false, error: PHONE_WAITING_ERROR };
      if (!caps.kit) return { supported: false, error: PHONE_UPDATE_ERROR };
      return { supported: true, type: 'kit.apply', payload: { kitId: String(p.kitId).toLowerCase() } }; // the snapshot lists lower-case ids
    case 'logo.set':
      if (!caps) return { supported: false, error: PHONE_WAITING_ERROR };
      if (!caps.logo) return { supported: false, error: PHONE_UPDATE_ERROR };
      return { supported: true, type: 'logo.set', payload: { ...p } }; // {position?, size?} unchanged
    case 'lowerThird.set':
      if (!caps) return { supported: false, error: PHONE_WAITING_ERROR };
      if (!caps.lowerThird) return { supported: false, error: PHONE_UPDATE_ERROR };
      return { supported: true, type: 'lowerThird.set', payload: { ...p } }; // {name?, title?|null, show?} unchanged
    case 'layout.set':
    case 'wallpaper.dim':
      return { supported: false, error: PHONE_UNSUPPORTED_ERROR };
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const intIn = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const VERSION_RE = /^[0-9A-Za-z._+-]{1,20}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Control, format (incl. bidi overrides) and line/paragraph separator characters: never shown to the support page. */
const UNSAFE_CHARS_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
export const PHONE_KITS_MAX = 50;
const cleanText = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.replace(UNSAFE_CHARS_RE, '').trim().slice(0, max) : null);

/**
 * The OPTIONAL capability blocks of a phone snapshot (older phones omit them). A malformed block never fails the whole
 * snapshot: it is treated as absent, so the capability is simply not offered.
 */
function phoneCapabilities(raw: Record<string, unknown>): {
  caps: { kit: boolean; logo: boolean; lowerThird: boolean };
  kits: Array<{ id: string; name: string }>;
  activeKitId: string | null;
  logo: { position: 'left' | 'right'; size: number; has: boolean };
  lowerThird: { name: string; title: string; live: boolean; allowed: boolean };
} {
  const out = {
    caps: { kit: false, logo: false, lowerThird: false },
    kits: [] as Array<{ id: string; name: string }>,
    activeKitId: null as string | null,
    logo: { position: 'left' as 'left' | 'right', size: 0, has: false },
    lowerThird: { name: '', title: '', live: false, allowed: false },
  };
  // Brand kits: a `kits` array (or a `kit` key) switches the capability on.
  const hasKits = Array.isArray(raw.kits) && raw.kits.length <= PHONE_KITS_MAX;
  const kit = raw.kit;
  const hasKitKey = Object.prototype.hasOwnProperty.call(raw, 'kit') && (kit === null || (isObj(kit) && typeof kit.id === 'string' && UUID_RE.test(kit.id)));
  if (hasKits) {
    for (const k of raw.kits as unknown[]) {
      if (!isObj(k) || typeof k.id !== 'string' || !UUID_RE.test(k.id)) continue;
      const name = cleanText(k.name, 80);
      const id = k.id.toLowerCase();
      if (name === null || out.kits.some((x) => x.id === id)) continue; // duplicate ids: the first wins
      out.kits.push({ id, name: name || 'Brand kit' });
    }
  }
  if (hasKits || hasKitKey) {
    out.caps.kit = true;
    if (hasKitKey && isObj(kit)) out.activeKitId = (kit.id as string).toLowerCase();
  }
  // Logo: {present, position, size}.
  const logo = raw.logo;
  if (isObj(logo) && typeof logo.present === 'boolean' && (logo.position === 'left' || logo.position === 'right') && intIn(logo.size, 0, 2000)) {
    out.caps.logo = true;
    out.logo = { position: logo.position, size: logo.size, has: logo.present };
  }
  // Name banner: {available:true, name, title, show}.
  const lt = raw.lowerThird;
  if (isObj(lt) && lt.available === true && typeof lt.show === 'boolean') {
    const name = lt.name === null ? '' : cleanText(lt.name, 80);
    const title = lt.title === null ? '' : cleanText(lt.title, 120);
    if (name !== null && title !== null) {
      out.caps.lowerThird = true;
      out.lowerThird = { name, title, live: lt.show, allowed: true };
    }
  }
  return out;
}

type SnapshotAd = SanitizedSupportState['ads'][string];

/**
 * Ad sequences (several ads of one placement): an Android build that supports them may add `sequence: [{ enabled, showSec? }]`
 * (play order, at most 5) and `current` to a placement's ad. Read-only here; malformed or absent = no sequence (never a refusal).
 */
function phoneSequence(a: Record<string, unknown>): Pick<SnapshotAd, 'sequence' | 'current'> {
  if (!Array.isArray(a.sequence) || a.sequence.length === 0 || a.sequence.length > SUPPORT_SEQUENCE_MAX) return {};
  const sequence: NonNullable<SnapshotAd['sequence']> = [];
  for (const e of a.sequence) {
    if (!isObj(e) || typeof e.enabled !== 'boolean') return {};
    sequence.push({ name: `Ad ${sequence.length + 1}`, enabled: e.enabled, showSec: intIn(e.showSec, 1, 3600) ? e.showSec : null });
  }
  const current = intIn(a.current, 0, sequence.length - 1) ? a.current : null;
  return { sequence, current };
}
const absentAd = (): SnapshotAd => ({ hasMedia: false, name: null, enabled: false, schedule: { mode: 'continuous' }, manual: null });

/** The phone's state PUT body `state` -> the control page's snapshot (with `platform:'android'`), or null when malformed. Never throws. */
export function phoneStateToSnapshot(raw: unknown): SanitizedSupportState | null {
  try {
    if (!isObj(raw) || raw.v !== 1 || raw.platform !== 'android') return null;
    if (typeof raw.appVersion !== 'string' || !VERSION_RE.test(raw.appVersion)) return null;
    if ((raw.orientation !== 'landscape' && raw.orientation !== 'portrait') || typeof raw.freePlan !== 'boolean' || typeof raw.adsShrink !== 'boolean') return null;
    if (!isObj(raw.ads)) return null;

    const ads: Record<string, SnapshotAd> = {};
    for (const placement of AD_PLACEMENT_IDS) {
      const a = raw.ads[placement];
      if (a === undefined || (isObj(a) && a.present === false)) {
        ads[placement] = absentAd();
        continue;
      }
      if (!isObj(a) || a.present !== true || typeof a.enabled !== 'boolean') return null;
      if (a.manual !== null && a.manual !== 'shown' && a.manual !== 'hidden') return null;
      if (a.source !== 'kit' && a.source !== 'phone') return null;
      let schedule: SnapshotAd['schedule'];
      if (a.mode === 'continuous') schedule = { mode: 'continuous' };
      else if (a.mode === 'interval' && intIn(a.showSec, 1, 3600) && intIn(a.everySec, 1, 86400)) schedule = { mode: 'interval', showSec: a.showSec, everySec: a.everySec };
      else return null;
      ads[placement] = { hasMedia: true, name: a.source === 'kit' ? 'Kit ad' : 'Phone ad', enabled: a.enabled, schedule, manual: a.manual, ...phoneSequence(a) };
    }

    if (!isObj(raw.ticker) || typeof raw.ticker.on !== 'boolean') return null;
    const rawTicker = raw.ticker.text === null || raw.ticker.text === undefined ? '' : raw.ticker.text;
    if (typeof rawTicker !== 'string' || rawTicker.length > SUPPORT_STATE_TEXT_MAX) return null;
    const tickerText = rawTicker.replace(UNSAFE_CHARS_RE, ''); // control / bidi / format characters never reach the support page

    // Layout and wallpaper never exist on the phone (inert placeholders; `platform` tells the page to hide them). Kits, logo and the
    // name banner come from the phone's optional capability blocks (inert placeholders when an older phone omits them).
    const cap = phoneCapabilities(raw);
    const clean = sanitizeSupportState({
      v: 1,
      layout: 'phone',
      orientation: raw.orientation,
      adsPlan: raw.freePlan ? 'free' : 'custom',
      ads,
      adsShrink: raw.adsShrink,
      kits: cap.kits,
      activeKitId: cap.activeKitId,
      ticker: { text: tickerText, on: raw.ticker.on },
      lowerThird: cap.lowerThird,
      clock: raw.clock,
      logo: cap.logo,
      wallpaper: { dim: 0, has: false },
    });
    if (!clean) return null;
    return { ...clean, platform: 'android', appVersion: raw.appVersion, phoneCaps: cap.caps };
  } catch {
    return null;
  }
}
