/**
 * Server-side validation of the state snapshot the HOST studio publishes for support sockets. The host is the
 * customer's own browser, so its snapshot is treated as untrusted input: it is rebuilt field by field from a strict
 * shape (unknown keys dropped, strings and arrays capped, enums checked) and anything malformed is refused, so a
 * support page can never be fed (or crashed by) arbitrary JSON. Pure: unit-tested in support-state.spec.ts.
 */
import { AD_PLACEMENT_IDS } from './support-command';

export const SUPPORT_STATE_TEXT_MAX = 1000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);
const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | null => (typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : null);
const int = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

export interface SanitizedSupportState {
  v: 1;
  /** Only ever set by the server for a phone-hosted stream (`phone-mapping.ts`); sanitizeSupportState (web hosts) never returns it. */
  platform?: 'android';
  appVersion?: string;
  /** Only ever set by the server for a phone-hosted stream: which optional capabilities the phone's last snapshot showed (older phones: all false). */
  phoneCaps?: { kit: boolean; logo: boolean; lowerThird: boolean };
  layout: string;
  orientation: 'landscape' | 'portrait';
  adsPlan: 'unknown' | 'free' | 'custom';
  ads: Record<string, { hasMedia: boolean; name: string | null; enabled: boolean; schedule: { mode: 'continuous' } | { mode: 'interval'; showSec: number; everySec: number }; manual: 'shown' | 'hidden' | null }>;
  adsShrink: boolean;
  kits: Array<{ id: string; name: string }>;
  activeKitId: string | null;
  ticker: { text: string; on: boolean };
  lowerThird: { name: string; title: string; live: boolean; allowed: boolean };
  clock: {
    enabled: boolean;
    position: string;
    format: string;
    showDate: boolean;
    showSeconds: boolean;
    timezone: string | null;
    size: string;
    style: string;
    alternate: boolean;
  };
  logo: { position: 'left' | 'right'; size: number; has: boolean };
  wallpaper: { dim: number; has: boolean };
}

/** Returns the sanitised snapshot, or null when it does not have the expected shape. Never throws. */
export function sanitizeSupportState(raw: unknown): SanitizedSupportState | null {
  try {
    if (!isObj(raw) || raw.v !== 1) return null;
    const layout = str(raw.layout, 40);
    const orientation = oneOf(raw.orientation, ['landscape', 'portrait'] as const);
    const adsPlan = oneOf(raw.adsPlan, ['unknown', 'free', 'custom'] as const);
    if (layout === null || !/^[a-z0-9-]{1,40}$/.test(layout) || !orientation || !adsPlan || typeof raw.adsShrink !== 'boolean') return null;

    if (!isObj(raw.ads)) return null;
    const ads: SanitizedSupportState['ads'] = {};
    for (const p of AD_PLACEMENT_IDS) {
      const a = raw.ads[p];
      if (!isObj(a) || typeof a.hasMedia !== 'boolean' || typeof a.enabled !== 'boolean') return null;
      const manual = a.manual === null ? null : oneOf(a.manual, ['shown', 'hidden'] as const);
      if (a.manual !== null && manual === null) return null;
      let schedule: SanitizedSupportState['ads'][string]['schedule'];
      if (isObj(a.schedule) && a.schedule.mode === 'continuous') schedule = { mode: 'continuous' };
      else if (isObj(a.schedule) && a.schedule.mode === 'interval') {
        const showSec = int(a.schedule.showSec, 1, 3600);
        const everySec = int(a.schedule.everySec, 1, 86400);
        if (showSec === null || everySec === null) return null;
        schedule = { mode: 'interval', showSec, everySec };
      } else return null;
      ads[p] = { hasMedia: a.hasMedia, name: a.name === null ? null : str(a.name, 80), enabled: a.enabled, schedule, manual };
      if (a.name !== null && ads[p].name === null) return null;
    }

    if (!Array.isArray(raw.kits) || raw.kits.length > 50) return null;
    const kits: Array<{ id: string; name: string }> = [];
    for (const k of raw.kits) {
      if (!isObj(k)) return null;
      const id = str(k.id, 64);
      const name = str(k.name, 80);
      if (id === null || name === null) return null;
      kits.push({ id, name });
    }
    const activeKitId = raw.activeKitId === null ? null : str(raw.activeKitId, 64);
    if (raw.activeKitId !== null && activeKitId === null) return null;

    if (!isObj(raw.ticker) || typeof raw.ticker.on !== 'boolean') return null;
    const tickerText = str(raw.ticker.text, SUPPORT_STATE_TEXT_MAX);
    if (tickerText === null) return null;

    if (!isObj(raw.lowerThird) || typeof raw.lowerThird.live !== 'boolean' || typeof raw.lowerThird.allowed !== 'boolean') return null;
    const ltName = str(raw.lowerThird.name, 200);
    const ltTitle = str(raw.lowerThird.title, 200);
    if (ltName === null || ltTitle === null) return null;

    const c = raw.clock;
    if (!isObj(c)) return null;
    const position = oneOf(c.position, ['top_left', 'top_right', 'bottom_left', 'bottom_right'] as const);
    const format = oneOf(c.format, ['12h', '24h'] as const);
    const size = oneOf(c.size, ['small', 'medium', 'large'] as const);
    const style = oneOf(c.style, ['text', 'pill'] as const);
    const timezone = c.timezone === null ? null : str(c.timezone, 64);
    if (!position || !format || !size || !style || (c.timezone !== null && timezone === null)) return null;
    for (const k of ['enabled', 'showDate', 'showSeconds', 'alternate'] as const) if (typeof c[k] !== 'boolean') return null;

    if (!isObj(raw.logo) || typeof raw.logo.has !== 'boolean') return null;
    const logoPosition = oneOf(raw.logo.position, ['left', 'right'] as const);
    const logoSize = typeof raw.logo.size === 'number' && Number.isFinite(raw.logo.size) && raw.logo.size >= 0 && raw.logo.size <= 2000 ? raw.logo.size : null;
    if (!logoPosition || logoSize === null) return null;

    if (!isObj(raw.wallpaper) || typeof raw.wallpaper.has !== 'boolean') return null;
    const dim = typeof raw.wallpaper.dim === 'number' && Number.isFinite(raw.wallpaper.dim) && raw.wallpaper.dim >= 0 && raw.wallpaper.dim <= 100 ? raw.wallpaper.dim : null;
    if (dim === null) return null;

    return {
      v: 1,
      layout,
      orientation,
      adsPlan,
      ads,
      adsShrink: raw.adsShrink,
      kits,
      activeKitId,
      ticker: { text: tickerText, on: raw.ticker.on },
      lowerThird: { name: ltName, title: ltTitle, live: raw.lowerThird.live, allowed: raw.lowerThird.allowed },
      clock: {
        enabled: c.enabled as boolean,
        position,
        format,
        showDate: c.showDate as boolean,
        showSeconds: c.showSeconds as boolean,
        timezone,
        size,
        style,
        alternate: c.alternate as boolean,
      },
      logo: { position: logoPosition, size: logoSize, has: raw.logo.has },
      wallpaper: { dim, has: raw.wallpaper.has },
    };
  } catch {
    return null;
  }
}
