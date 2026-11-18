/**
 * The on-air date and time (a clock) drawn on the broadcast picture, so every destination and the recording carry it.
 * Configured per brand kit (the seven `clock*` kit fields) and overridable per stream in the studio.
 *
 * Pure helpers (settings, text, layout) plus a small renderer; no React. Unit-tested by `test/ui/clock.spec.ts`.
 *
 * Text is always English ("Wed 18 Nov" and "3:04 PM" / "15:04"), whatever the browser's language, so the on-air look
 * is predictable. The text is formatted once per second and cached; the pill geometry is cached with it.
 *
 * Tests can pin the time with `window.__SB_TEST_NOW__` (epoch milliseconds), but only after they arm it with the
 * localStorage key below, like the ad clock (adLayer.ts). Without the key the property is ignored.
 */
declare global {
  interface Window {
    __SB_TEST_NOW__?: number;
  }
}
export const CLOCK_TEST_ARM_KEY = 'streambird:test:clock';

export type ClockPosition = 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
export type ClockFormat = '12h' | '24h';
export type ClockSize = 'small' | 'medium' | 'large';

export interface ClockSettings {
  enabled: boolean;
  position: ClockPosition;
  format: ClockFormat;
  showDate: boolean;
  showSeconds: boolean;
  /** IANA zone name; null = this device's time zone. */
  timezone: string | null;
  size: ClockSize;
}

/** Same defaults as the brand kit columns (migration 0034). Off, so nothing changes until someone turns it on. */
export const DEFAULT_CLOCK: ClockSettings = {
  enabled: false,
  position: 'top_right',
  format: '12h',
  showDate: true,
  showSeconds: false,
  timezone: null,
  size: 'medium',
};

export const CLOCK_POSITIONS: Array<{ id: ClockPosition; label: string }> = [
  { id: 'top_left', label: 'Top left' },
  { id: 'top_right', label: 'Top right' },
  { id: 'bottom_left', label: 'Bottom left' },
  { id: 'bottom_right', label: 'Bottom right' },
];
export const CLOCK_SIZES: Array<{ id: ClockSize; label: string }> = [
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
];
/** Text height as a share of the picture's short side (its height on a 16:9 stream, its width on a vertical one). */
export const CLOCK_SIZE_SHARE: Record<ClockSize, number> = { small: 0.022, medium: 0.03, large: 0.042 };

/** The short list offered first; the full IANA list is searchable behind it. */
export const COMMON_TIMEZONES: Array<{ id: string; label: string }> = [
  { id: 'Asia/Kolkata', label: 'India (Asia/Kolkata)' },
  { id: 'UTC', label: 'UTC' },
  { id: 'Asia/Dubai', label: 'Dubai (Asia/Dubai)' },
  { id: 'Asia/Singapore', label: 'Singapore (Asia/Singapore)' },
  { id: 'Asia/Tokyo', label: 'Tokyo (Asia/Tokyo)' },
  { id: 'Australia/Sydney', label: 'Sydney (Australia/Sydney)' },
  { id: 'Europe/London', label: 'London (Europe/London)' },
  { id: 'Europe/Paris', label: 'Paris (Europe/Paris)' },
  { id: 'America/New_York', label: 'New York (America/New_York)' },
  { id: 'America/Chicago', label: 'Chicago (America/Chicago)' },
  { id: 'America/Los_Angeles', label: 'Los Angeles (America/Los_Angeles)' },
];

export const MAX_TIMEZONE_LENGTH = 64;

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > MAX_TIMEZONE_LENGTH) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Every IANA zone this browser knows (for the search), or the short list where `Intl.supportedValuesOf` is missing. */
export function allTimeZones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    const list = intl.supportedValuesOf?.('timeZone');
    if (list && list.length > 0) return list.includes('UTC') ? list : ['UTC', ...list];
  } catch {
    // fall through
  }
  return COMMON_TIMEZONES.map((z) => z.id);
}

/** Makes any stored/received value a complete, valid setting (unknown values fall back to the defaults). */
export function normalizeClock(raw: unknown): ClockSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
  return {
    enabled: r.enabled === true,
    position: pick(r.position, CLOCK_POSITIONS.map((p) => p.id), DEFAULT_CLOCK.position),
    format: pick(r.format, ['12h', '24h'] as const, DEFAULT_CLOCK.format),
    showDate: typeof r.showDate === 'boolean' ? r.showDate : DEFAULT_CLOCK.showDate,
    showSeconds: typeof r.showSeconds === 'boolean' ? r.showSeconds : DEFAULT_CLOCK.showSeconds,
    timezone: isValidTimeZone(r.timezone) ? r.timezone : null,
    size: pick(r.size, CLOCK_SIZES.map((s) => s.id), DEFAULT_CLOCK.size),
  };
}

/** The clock settings of a brand kit (the kit stores them as `clock*` fields). */
export function clockFromKit(kit: {
  clockEnabled?: boolean;
  clockPosition?: string;
  clockFormat?: string;
  clockShowDate?: boolean;
  clockShowSeconds?: boolean;
  clockTimezone?: string | null;
  clockSize?: string;
}): ClockSettings {
  return normalizeClock({
    enabled: kit.clockEnabled,
    position: kit.clockPosition,
    format: kit.clockFormat,
    showDate: kit.clockShowDate,
    showSeconds: kit.clockShowSeconds,
    timezone: kit.clockTimezone,
    size: kit.clockSize,
  });
}

/** The kit fields that hold a change to the clock settings (the inverse of clockFromKit). */
export function kitPatchFromClock(patch: Partial<ClockSettings>): {
  clockEnabled?: boolean;
  clockPosition?: ClockPosition;
  clockFormat?: ClockFormat;
  clockShowDate?: boolean;
  clockShowSeconds?: boolean;
  clockTimezone?: string | null;
  clockSize?: ClockSize;
} {
  const out: ReturnType<typeof kitPatchFromClock> = {};
  if (patch.enabled !== undefined) out.clockEnabled = patch.enabled;
  if (patch.position !== undefined) out.clockPosition = patch.position;
  if (patch.format !== undefined) out.clockFormat = patch.format;
  if (patch.showDate !== undefined) out.clockShowDate = patch.showDate;
  if (patch.showSeconds !== undefined) out.clockShowSeconds = patch.showSeconds;
  if (patch.timezone !== undefined) out.clockTimezone = patch.timezone;
  if (patch.size !== undefined) out.clockSize = patch.size;
  return out;
}

/** "Now" in epoch ms: the real time, or the pinned test time when armed. */
export function clockNow(): number {
  if (typeof window !== 'undefined' && typeof window.__SB_TEST_NOW__ === 'number' && Number.isFinite(window.__SB_TEST_NOW__)) {
    try {
      if (localStorage.getItem(CLOCK_TEST_ARM_KEY) === 'on') return window.__SB_TEST_NOW__;
    } catch {
      // storage blocked: use the real time
    }
  }
  return Date.now();
}

export interface ClockText {
  /** "Wed 18 Nov", or null when the date is off. */
  date: string | null;
  /** "3:04 PM", "3:04:05 PM" or "15:04". */
  time: string;
}

/** Formats `ms` for the settings. Pure; cached formatters make it cheap, and callers format once per second. */
const formatters = new Map<string, { date: Intl.DateTimeFormat; time: Intl.DateTimeFormat }>();
export function formatClock(ms: number, s: ClockSettings): ClockText {
  const key = `${s.timezone ?? ''}|${s.format}|${s.showSeconds}`;
  let f = formatters.get(key);
  if (!f) {
    const timeZone = s.timezone ?? undefined;
    const make = (opts: Intl.DateTimeFormatOptions) => {
      try {
        return new Intl.DateTimeFormat('en-US', { timeZone, ...opts });
      } catch {
        return new Intl.DateTimeFormat('en-US', opts); // a zone this browser does not know: the device's own
      }
    };
    f = {
      date: make({ weekday: 'short', day: 'numeric', month: 'short' }),
      time: make({ hour: s.format === '12h' ? 'numeric' : '2-digit', minute: '2-digit', ...(s.showSeconds ? { second: '2-digit' as const } : {}), hourCycle: s.format === '12h' ? 'h12' : 'h23' }),
    };
    formatters.set(key, f);
  }
  const t = new Map(f.time.formatToParts(ms).map((p) => [p.type, p.value]));
  let time = `${t.get('hour')}:${t.get('minute')}`;
  if (s.showSeconds) time += `:${t.get('second')}`;
  if (s.format === '12h') time += ` ${(t.get('dayPeriod') ?? '').toUpperCase()}`;
  let date: string | null = null;
  if (s.showDate) {
    const d = new Map(f.date.formatToParts(ms).map((p) => [p.type, p.value]));
    date = `${d.get('weekday')} ${d.get('day')} ${d.get('month')}`;
  }
  return { date, time: time.trim() };
}

// ---- Layout (pure) ---------------------------------------------------------

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const intersects = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export interface ClockMetrics {
  fontPx: number;
  padX: number;
  padY: number;
  margin: number;
  /** Space kept below a bottom-corner clock (vertical streams keep clear of the platforms' own bottom bar). */
  bottomGap: number;
  gap: number;
}

/** Sizes for a w x h picture. The short side is the yardstick, so a vertical stream scales by its width and stays inside the frame. */
export function clockMetrics(w: number, h: number, size: ClockSize): ClockMetrics {
  const base = Math.min(w, h);
  const fontPx = Math.max(10, Math.round(base * CLOCK_SIZE_SHARE[size]));
  const margin = Math.max(6, Math.round(base * 0.022)); // 16 px on a 720-high picture, the logo's margin
  return {
    fontPx,
    padX: Math.round(fontPx * 0.7),
    padY: Math.round(fontPx * 0.45),
    margin,
    bottomGap: h > w ? Math.round(h * 0.06) : margin, // the same bottom allowance as the "Powered by" mark
    gap: Math.max(4, Math.round(base * 0.012)),
  };
}

/**
 * Where the pill goes: the chosen corner of `frame` (the whole picture, or the shrunken one), then moved so it never
 * covers anything in `avoid` (the logo, the ticker, the "Powered by" mark): a top clock slides down below what it hit,
 * a bottom clock slides up above it. Stays inside `frame`.
 */
export function layoutClock(frame: Box, pill: { w: number; h: number }, position: ClockPosition, m: ClockMetrics, avoid: readonly Box[]): Box {
  const top = position === 'top_left' || position === 'top_right';
  const left = position === 'top_left' || position === 'bottom_left';
  const x = left ? frame.x + m.margin : frame.x + frame.w - m.margin - pill.w;
  let y = top ? frame.y + m.margin : frame.y + frame.h - m.bottomGap - pill.h;
  for (let pass = 0; pass < avoid.length + 1; pass++) {
    const hit = avoid.find((a) => intersects({ x, y, w: pill.w, h: pill.h }, a));
    if (!hit) break;
    y = top ? hit.y + hit.h + m.gap : hit.y - m.gap - pill.h;
  }
  y = Math.min(Math.max(y, frame.y), frame.y + frame.h - pill.h);
  return { x, y, w: pill.w, h: pill.h };
}

// ---- Renderer --------------------------------------------------------------

const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

interface Cached {
  key: string;
  lines: string[];
  fontPx: number;
  pill: { w: number; h: number };
  metrics: ClockMetrics;
}

/** Draws the clock pill. Keeps the formatted text and its measured pill for the current second. */
export class ClockOverlay {
  private cache: Cached | null = null;

  /** Draws on `ctx` (a w x h picture; `frame` = where the picture really is, default all of it). Returns the pill's box, or null when off. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, s: ClockSettings, nowMs: number, avoid: readonly Box[], frame: Box = { x: 0, y: 0, w, h }): Box | null {
    if (!s.enabled) return null;
    const second = Math.floor(nowMs / 1000);
    const key = `${second}|${s.timezone ?? ''}|${s.format}|${s.showDate}|${s.showSeconds}|${s.size}|${w}x${h}`;
    let c = this.cache;
    if (!c || c.key !== key) {
      const text = formatClock(nowMs, s);
      const metrics = clockMetrics(w, h, s.size);
      ctx.save();
      ctx.font = `600 ${metrics.fontPx}px ${FONT}`;
      let lines = [text.date ? `${text.date}  ·  ${text.time}` : text.time];
      let textW = ctx.measureText(lines[0]).width;
      // A narrow (vertical) picture stacks the date over the time instead of running wide.
      if (text.date && textW + metrics.padX * 2 > frame.w * 0.62) {
        lines = [text.date, text.time];
        textW = Math.max(ctx.measureText(lines[0]).width, ctx.measureText(lines[1]).width);
      }
      ctx.restore();
      const lineH = Math.round(metrics.fontPx * 1.2);
      c = this.cache = {
        key,
        lines,
        fontPx: metrics.fontPx,
        metrics,
        pill: { w: Math.round(textW + metrics.padX * 2), h: lineH * lines.length + metrics.padY * 2 },
      };
    }
    const box = layoutClock(frame, c.pill, s.position, c.metrics, avoid);
    ctx.save();
    // Same language as the ticker / "Powered by" pill: a dark rounded plate with white text, readable on any wallpaper.
    ctx.fillStyle = 'rgba(17,14,34,0.78)';
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, Math.min(box.h / 2, c.fontPx * 0.8));
    ctx.fill();
    ctx.font = `600 ${c.fontPx}px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = Math.max(2, c.fontPx * 0.15);
    const lineH = Math.round(c.fontPx * 1.2);
    c.lines.forEach((line, i) => ctx.fillText(line, box.x + box.w / 2, box.y + c.metrics.padY + lineH * i + lineH / 2));
    ctx.restore();
    return box;
  }
}
