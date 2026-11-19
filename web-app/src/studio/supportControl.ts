/**
 * Remote control of the live studio by a superadmin support session: the PURE parts (no DOM, no React, no socket).
 *
 * Shared by the host studio (`useHostStudio`: receives commands, publishes snapshots) and the control page
 * (`useSupportControl`: renders controls from a snapshot). The server (`src/studio/support/`) is the authority: it
 * validates every command against a whitelist, only relays it to the host socket, and the host trusts only
 * server-relayed `support:command` events. These functions then apply a command through the SAME setters the UI uses.
 *
 * Conflict rule: every controllable setting remembers when the HOST last changed it (`HostChangeTracker`). A support
 * command touching a setting the host changed in the last 3 s is refused ("host changed it just now"); a host change
 * made after a support command simply overrides it (the host's own changes always win).
 */
import { AD_PLACEMENTS, scheduleError, type AdManual, type AdPlacement, type AdSchedule } from './ads';
import { CLOCK_POSITIONS, CLOCK_SIZES, CLOCK_STYLES, isValidTimeZone, type ClockSettings } from './clock';
import { isLayoutId } from './compose';
import type { LowerThirdSettings } from './lowerThird';

export const SUPPORT_CONFLICT_WINDOW_MS = 3000;
/**
 * After a support command is applied, the FIRST change of each setting it touched (the one it caused, seen on the next
 * render) is not counted as the host's own. Short on purpose: a host click right after must still win.
 */
export const SUPPORT_EXPECT_HOLD_MS = 400;
/** A brand kit loads files asynchronously, so its changes arrive over a few seconds and are all attributed to it. */
export const SUPPORT_KIT_HOLD_MS = 4000;
export const SNAPSHOT_DEBOUNCE_MS = 300;
/** A relayed command older than this is dropped unapplied: the server already told the controller "the host did not respond". */
export const SUPPORT_COMMAND_MAX_AGE_MS = 8000;
/** A brand kit load that takes longer than this fails the command, so a hung download cannot stall the queue. */
export const SUPPORT_KIT_TIMEOUT_MS = 10_000;
/** Beyond this the server and host clocks are assumed to disagree and `at` is not trusted. */
const CLOCK_SKEW_GUARD_MS = 5 * 60_000;

/**
 * Is a relayed command too old to apply? Two independent measures: how long it has waited in THIS browser (monotonic, immune
 * to clock differences: a hung earlier command), and the server's `at` stamp against this clock (ignored when the two
 * clocks are minutes apart).
 */
export function isStaleCommand(at: unknown, receivedPerf: number, nowPerf: number, nowWall: number, maxAgeMs = SUPPORT_COMMAND_MAX_AGE_MS): boolean {
  if (nowPerf - receivedPerf > maxAgeMs) return true;
  if (typeof at !== 'number' || !Number.isFinite(at)) return false;
  const age = nowWall - at;
  return age > maxAgeMs && age < CLOCK_SKEW_GUARD_MS;
}
export const HOST_CHANGED_MESSAGE = 'host changed it just now';

export type SupportCommandType =
  | 'layout.set'
  | 'ads.manual'
  | 'ads.enabled'
  | 'ads.schedule'
  | 'ads.shrink'
  | 'kit.apply'
  | 'ticker.set'
  | 'lowerThird.set'
  | 'clock.set'
  | 'logo.set'
  | 'wallpaper.dim';

/** What the server relays to the host (`support:command`). */
export interface RelayedSupportCommand {
  id: string;
  type: SupportCommandType;
  payload: Record<string, unknown>;
  at: number;
  source: 'support-session';
}

export interface SupportAdState {
  hasMedia: boolean;
  name: string | null;
  enabled: boolean;
  schedule: AdSchedule;
  manual: AdManual;
}

/** The compact snapshot of the controllable settings (no secrets, no media, no tokens). */
export interface SupportState {
  v: 1;
  layout: string;
  orientation: 'landscape' | 'portrait';
  adsPlan: 'unknown' | 'free' | 'custom';
  ads: Record<AdPlacement, SupportAdState>;
  adsShrink: boolean;
  kits: Array<{ id: string; name: string }>;
  activeKitId: string | null;
  /** `on` = the ticker is showing; `text` = what shows, or the last text while it is hidden. */
  ticker: { text: string; on: boolean };
  /** `name` = the big line (lowerThird title), `title` = the small line (subtitle). */
  lowerThird: { name: string; title: string; live: boolean; allowed: boolean };
  clock: ClockSettings;
  logo: { position: 'left' | 'right'; size: number; has: boolean };
  wallpaper: { dim: number; has: boolean };
}

export interface SnapshotInput {
  layout: string;
  orientation: 'landscape' | 'portrait';
  adsPlan: 'unknown' | 'free' | 'custom';
  ads: Record<AdPlacement, { hasMedia: boolean; name: string | null; enabled: boolean; schedule: AdSchedule; manual: AdManual }>;
  adsShrink: boolean;
  kits: ReadonlyArray<{ id: string; name: string }>;
  activeKitId: string | null;
  tickerText: string;
  tickerStash: string;
  lowerThird: LowerThirdSettings;
  lowerThirdLive: boolean;
  canLowerThird: boolean;
  clock: ClockSettings;
  logoPosition: 'left' | 'right';
  logoSize: number;
  hasLogo: boolean;
  wallpaperDim: number;
  hasWallpaper: boolean;
}

/** Builds the snapshot from the studio's state. Copies only the listed fields, so nothing else can leak into it. */
export function buildSupportState(i: SnapshotInput): SupportState {
  const ads = {} as Record<AdPlacement, SupportAdState>;
  for (const p of AD_PLACEMENTS) {
    const a = i.ads[p];
    ads[p] = { hasMedia: !!a.hasMedia, name: a.name ? String(a.name).slice(0, 80) : null, enabled: !!a.enabled, schedule: a.schedule.mode === 'interval' ? { mode: 'interval', showSec: a.schedule.showSec, everySec: a.schedule.everySec } : { mode: 'continuous' }, manual: a.manual };
  }
  return {
    v: 1,
    layout: i.layout,
    orientation: i.orientation,
    adsPlan: i.adsPlan,
    ads,
    adsShrink: i.adsShrink,
    kits: i.kits.slice(0, 50).map((k) => ({ id: k.id, name: String(k.name).slice(0, 80) })),
    activeKitId: i.activeKitId,
    ticker: { text: i.tickerText || i.tickerStash, on: i.tickerText.length > 0 },
    lowerThird: { name: i.lowerThird.title, title: i.lowerThird.subtitle, live: i.lowerThirdLive, allowed: i.canLowerThird },
    clock: { ...i.clock },
    logo: { position: i.logoPosition, size: i.logoSize, has: i.hasLogo },
    wallpaper: { dim: i.wallpaperDim, has: i.hasWallpaper },
  };
}

/** Setting groups the conflict rule tracks, as stable string values of a snapshot. */
export function trackedValues(s: SupportState): Record<string, string> {
  const out: Record<string, string> = {
    layout: s.layout,
    'ads.shrink': String(s.adsShrink),
    kit: String(s.activeKitId),
    ticker: JSON.stringify(s.ticker),
    lowerThird: JSON.stringify(s.lowerThird),
    clock: JSON.stringify(s.clock),
    logo: JSON.stringify(s.logo),
    'wallpaper.dim': String(s.wallpaper.dim),
  };
  for (const p of AD_PLACEMENTS) {
    out[`ads.${p}.manual`] = String(s.ads[p].manual);
    out[`ads.${p}.enabled`] = String(s.ads[p].enabled);
    out[`ads.${p}.schedule`] = JSON.stringify(s.ads[p].schedule);
  }
  return out;
}

/** The setting groups a command changes (what the conflict rule checks, and what is "expected" while it is applied). */
export function touchedKeys(type: SupportCommandType, payload: Record<string, unknown>): string[] {
  const p = String(payload.placement);
  switch (type) {
    case 'layout.set':
      return ['layout'];
    case 'ads.manual':
      return [`ads.${p}.manual`];
    case 'ads.enabled':
      return [`ads.${p}.enabled`];
    case 'ads.schedule':
      return [`ads.${p}.schedule`];
    case 'ads.shrink':
      return ['ads.shrink'];
    case 'kit.apply':
      // A kit sets the logo, the lower-third look, the clock, the shrink switch, the wallpaper dim and every ad.
      return ['kit', 'logo', 'lowerThird', 'clock', 'ads.shrink', 'wallpaper.dim', ...AD_PLACEMENTS.flatMap((x) => [`ads.${x}.enabled`, `ads.${x}.schedule`])];
    case 'ticker.set':
      return ['ticker'];
    case 'lowerThird.set':
      return ['lowerThird'];
    case 'clock.set':
      return ['clock'];
    case 'logo.set':
      return ['logo'];
    case 'wallpaper.dim':
      return ['wallpaper.dim'];
    default:
      return [];
  }
}

/**
 * Remembers WHEN the host last changed each setting group. `observe` is fed the studio's snapshot after every state
 * commit; a group whose value changed, and which a support command is not currently expected to be changing, is a
 * host-originated change. Pure and clock-injected so it is unit-tested.
 */
export class HostChangeTracker {
  private last: Record<string, string> | null = null;
  private readonly changedAt = new Map<string, number>();
  private readonly expected = new Map<string, { until: number; once: boolean }>();

  /** A support command is about to change these groups: their next change (once) / changes (until `holdMs`) are not the host's. */
  expect(keys: readonly string[], now: number, holdMs = SUPPORT_EXPECT_HOLD_MS, once = true): void {
    for (const k of keys) this.expected.set(k, { until: now + holdMs, once });
  }

  /** Feeds the current values; returns the groups that changed (host or support). The first call only sets the baseline. */
  observe(values: Record<string, string>, now: number): string[] {
    const previous = this.last;
    this.last = values;
    if (!previous) return [];
    const changed: string[] = [];
    for (const [k, v] of Object.entries(values)) {
      if (previous[k] === v) continue;
      changed.push(k);
      const exp = this.expected.get(k);
      if (exp && exp.until > now) {
        if (exp.once) this.expected.delete(k);
        continue; // our own support command
      }
      this.changedAt.set(k, now);
    }
    return changed;
  }

  /** The first of these groups the host changed within `windowMs`, else null. */
  recentHostChange(keys: readonly string[], now: number, windowMs = SUPPORT_CONFLICT_WINDOW_MS): string | null {
    for (const k of keys) {
      const at = this.changedAt.get(k);
      if (at !== undefined && now - at < windowMs) return k;
    }
    return null;
  }
}

export type ApplyResult = { ok: true } | { ok: false; error: string };

/** The host studio's own setters, as the receiver needs them (wired in useHostStudio to the exact functions the UI calls). */
export interface HostControls {
  adsPlan(): 'unknown' | 'free' | 'custom';
  adHasMedia(p: AdPlacement): boolean;
  setLayout(id: string): void;
  setAdManual(p: AdPlacement, manual: AdManual): void;
  setAdEnabled(p: AdPlacement, enabled: boolean): void;
  setAdSchedule(p: AdPlacement, schedule: AdSchedule): void;
  setAdsShrink(on: boolean): void;
  hasKit(id: string): boolean;
  applyKit(id: string): Promise<void>;
  tickerText(): string;
  setTicker(text: string): void;
  canLowerThird(): boolean;
  lowerThird(): LowerThirdSettings;
  setLowerThird(patch: Partial<LowerThirdSettings>): void;
  showLowerThird(): void;
  hideLowerThird(): void;
  clock(): ClockSettings;
  setClock(patch: Partial<ClockSettings>): void;
  setLogoPosition(position: 'left' | 'right'): void;
  setLogoSize(size: number): void;
  setWallpaperDim(n: number): void;
}

export interface ApplyEnv {
  controls: HostControls;
  tracker: HostChangeTracker;
  now: () => number;
  /** The last ticker text while the support session has the ticker switched off (so "on" brings it back). */
  tickerStash: { text: string };
  /** Overridable in tests. */
  kitTimeoutMs?: number;
}

const isPlacement = (v: unknown): v is AdPlacement => typeof v === 'string' && (AD_PLACEMENTS as readonly string[]).includes(v);

/**
 * Applies one relayed command through the host's own setters. Re-validates what it relies on (the server already did)
 * and answers with the `support:ack` result. Conflict rule first: a setting the host changed in the last 3 s is refused.
 */
export async function applySupportCommand(cmd: Pick<RelayedSupportCommand, 'type' | 'payload'>, env: ApplyEnv): Promise<ApplyResult> {
  const { controls: c, tracker } = env;
  const payload = cmd.payload ?? {};
  const keys = touchedKeys(cmd.type, payload);
  if (tracker.recentHostChange(keys, env.now())) return { ok: false, error: HOST_CHANGED_MESSAGE };

  const adsGate = (p: unknown): ApplyResult | null => {
    if (!isPlacement(p)) return { ok: false, error: 'Unknown ad placement' };
    if (c.adsPlan() !== 'custom') return { ok: false, error: 'Ads can only be controlled on a plan with your own ads' };
    return null;
  };
  const expect = () => tracker.expect(keys, env.now());

  switch (cmd.type) {
    case 'layout.set': {
      if (!isLayoutId(payload.mode)) return { ok: false, error: 'Unknown layout' };
      expect();
      c.setLayout(payload.mode);
      return { ok: true };
    }
    case 'ads.manual': {
      const gate = adsGate(payload.placement);
      if (gate) return gate;
      const m = payload.manual;
      if (m !== 'shown' && m !== 'hidden' && m !== null) return { ok: false, error: 'Invalid value' };
      if (m === 'shown' && !c.adHasMedia(payload.placement as AdPlacement)) return { ok: false, error: 'No ad picture is loaded for this placement' };
      expect();
      c.setAdManual(payload.placement as AdPlacement, m as AdManual);
      return { ok: true };
    }
    case 'ads.enabled': {
      const gate = adsGate(payload.placement);
      if (gate) return gate;
      if (typeof payload.enabled !== 'boolean') return { ok: false, error: 'Invalid value' };
      if (payload.enabled && !c.adHasMedia(payload.placement as AdPlacement)) return { ok: false, error: 'No ad picture is loaded for this placement' };
      expect();
      c.setAdEnabled(payload.placement as AdPlacement, payload.enabled);
      return { ok: true };
    }
    case 'ads.schedule': {
      const gate = adsGate(payload.placement);
      if (gate) return gate;
      const schedule: AdSchedule = payload.mode === 'interval' ? { mode: 'interval', showSec: Number(payload.showSec), everySec: Number(payload.everySec) } : { mode: 'continuous' };
      const problem = scheduleError(schedule);
      if (problem) return { ok: false, error: problem };
      expect();
      c.setAdSchedule(payload.placement as AdPlacement, schedule);
      return { ok: true };
    }
    case 'ads.shrink': {
      if (typeof payload.on !== 'boolean') return { ok: false, error: 'Invalid value' };
      expect();
      c.setAdsShrink(payload.on);
      return { ok: true };
    }
    case 'kit.apply': {
      const id = String(payload.kitId ?? '');
      if (!c.hasKit(id)) return { ok: false, error: 'Unknown brand kit' };
      tracker.expect(keys, env.now(), SUPPORT_KIT_HOLD_MS, false);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), env.kitTimeoutMs ?? SUPPORT_KIT_TIMEOUT_MS);
      });
      const outcome = await Promise.race([c.applyKit(id).then(() => 'done' as const), timedOut]);
      clearTimeout(timer);
      if (outcome === 'timeout') return { ok: false, error: 'The brand kit took too long to load' };
      tracker.expect(keys, env.now(), SUPPORT_KIT_HOLD_MS, false); // the kit's files load asynchronously: hold until the last change has rendered
      return { ok: true };
    }
    case 'ticker.set': {
      const hasText = Object.prototype.hasOwnProperty.call(payload, 'text');
      const text = payload.text === null || payload.text === undefined ? '' : String(payload.text);
      const on = typeof payload.on === 'boolean' ? payload.on : undefined;
      if (text.length > 200) return { ok: false, error: 'Ticker text is too long' };
      expect();
      if (hasText && text.trim()) {
        env.tickerStash.text = text.trim();
        if (on !== false) c.setTicker(text);
        else c.setTicker('');
      } else if (hasText && !text.trim()) {
        c.setTicker('');
      } else if (on === false) {
        const cur = c.tickerText();
        if (cur) env.tickerStash.text = cur;
        c.setTicker('');
      } else if (on === true) {
        c.setTicker(env.tickerStash.text || c.tickerText());
      }
      return { ok: true };
    }
    case 'lowerThird.set': {
      const patch: Partial<LowerThirdSettings> = {};
      if ((typeof payload.name === 'string' && payload.name.length > 80) || (typeof payload.title === 'string' && payload.title.length > 120)) return { ok: false, error: 'Lower third text is too long' };
      if (typeof payload.name === 'string') patch.title = payload.name;
      if (payload.title !== undefined) patch.subtitle = payload.title === null ? '' : String(payload.title);
      if (payload.show === true && !c.canLowerThird()) return { ok: false, error: 'Lower thirds are not available on this plan' };
      const nextTitle = patch.title ?? c.lowerThird().title;
      if (payload.show === true && !nextTitle.trim()) return { ok: false, error: 'Add the lower third text first' };
      expect();
      if (Object.keys(patch).length) c.setLowerThird(patch);
      if (payload.show === true) c.showLowerThird();
      else if (payload.show === false) c.hideLowerThird();
      return { ok: true };
    }
    case 'clock.set': {
      const patch: Partial<ClockSettings> = {};
      for (const k of ['enabled', 'showDate', 'showSeconds', 'alternate'] as const) if (typeof payload[k] === 'boolean') patch[k] = payload[k] as boolean;
      // Defence in depth: the server validated these, but normalizeClock would silently RESET an unknown value to its default.
      const enumOf = (key: 'position' | 'format' | 'size' | 'style', allowed: readonly string[]): string | null => {
        if (payload[key] === undefined) return null;
        if (typeof payload[key] !== 'string' || !allowed.includes(payload[key] as string)) return `Invalid clock ${key}`;
        (patch as Record<string, unknown>)[key] = payload[key];
        return null;
      };
      const badEnum =
        enumOf('position', CLOCK_POSITIONS.map((x) => x.id)) ?? enumOf('format', ['12h', '24h']) ?? enumOf('size', CLOCK_SIZES.map((x) => x.id)) ?? enumOf('style', CLOCK_STYLES.map((x) => x.id));
      if (badEnum) return { ok: false, error: badEnum };
      if (payload.timezone === null) patch.timezone = null;
      else if (typeof payload.timezone === 'string') {
        if (!isValidTimeZone(payload.timezone)) return { ok: false, error: 'Unknown time zone' };
        patch.timezone = payload.timezone;
      }
      expect();
      c.setClock(patch);
      return { ok: true };
    }
    case 'logo.set': {
      if (payload.position !== undefined && payload.position !== 'left' && payload.position !== 'right') return { ok: false, error: 'Invalid logo position' };
      if (payload.size !== undefined && !(typeof payload.size === 'number' && Number.isInteger(payload.size) && payload.size >= 16 && payload.size <= 600)) return { ok: false, error: 'Invalid logo size' };
      expect();
      if (payload.position !== undefined) c.setLogoPosition(payload.position as 'left' | 'right');
      if (typeof payload.size === 'number') c.setLogoSize(payload.size);
      return { ok: true };
    }
    case 'wallpaper.dim': {
      if (typeof payload.n !== 'number' || !Number.isInteger(payload.n) || payload.n < 0 || payload.n > 70) return { ok: false, error: 'Invalid value' };
      expect();
      c.setWallpaperDim(payload.n);
      return { ok: true };
    }
    default:
      return { ok: false, error: 'Unknown command' };
  }
}
