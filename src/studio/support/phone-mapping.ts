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
import { sanitizeSupportState, SUPPORT_STATE_TEXT_MAX, type SanitizedSupportState } from './support-state';

export const PHONE_UNSUPPORTED_ERROR = 'Not supported on the phone app';
/** Support command types the phone app can apply. Everything else in the whitelist is answered by the server. */
export const PHONE_SUPPORTED_TYPES = ['ads.manual', 'ads.enabled', 'ads.schedule', 'ads.shrink', 'ticker.set', 'clock.set'] as const;
export type PhoneCommandType = (typeof PHONE_SUPPORTED_TYPES)[number];

export type PhoneCommandMapping = { supported: true; type: PhoneCommandType; payload: Record<string, unknown> } | { supported: false; error: string };

export function toPhoneCommand(cmd: SupportCommand): PhoneCommandMapping {
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
    case 'layout.set':
    case 'kit.apply':
    case 'lowerThird.set':
    case 'logo.set':
    case 'wallpaper.dim':
      return { supported: false, error: PHONE_UNSUPPORTED_ERROR };
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const intIn = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const VERSION_RE = /^[0-9A-Za-z._+-]{1,20}$/;

type SnapshotAd = SanitizedSupportState['ads'][string];
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
      ads[placement] = { hasMedia: true, name: a.source === 'kit' ? 'Kit ad' : 'Phone ad', enabled: a.enabled, schedule, manual: a.manual };
    }

    if (!isObj(raw.ticker) || typeof raw.ticker.on !== 'boolean') return null;
    const tickerText = raw.ticker.text === null || raw.ticker.text === undefined ? '' : raw.ticker.text;
    if (typeof tickerText !== 'string' || tickerText.length > SUPPORT_STATE_TEXT_MAX) return null;

    // The web-only parts (layout, kits, lower third, logo, wallpaper) get inert placeholders; `platform` tells the page to hide them.
    const clean = sanitizeSupportState({
      v: 1,
      layout: 'phone',
      orientation: raw.orientation,
      adsPlan: raw.freePlan ? 'free' : 'custom',
      ads,
      adsShrink: raw.adsShrink,
      kits: [],
      activeKitId: null,
      ticker: { text: tickerText, on: raw.ticker.on },
      lowerThird: { name: '', title: '', live: false, allowed: false },
      clock: raw.clock,
      logo: { position: 'left', size: 0, has: false },
      wallpaper: { dim: 0, has: false },
    });
    if (!clean) return null;
    return { ...clean, platform: 'android', appVersion: raw.appVersion };
  } catch {
    return null;
  }
}
