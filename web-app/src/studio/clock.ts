/**
 * The on-air date and time (a clock) drawn on the broadcast picture, so every destination and the recording carry it.
 * Configured per brand kit (the nine `clock*` kit fields) and overridable per stream in the studio.
 *
 * Two looks (`style`): 'text' (default) is compact plain white text with a soft dark shadow and outline, no box, placed
 * directly under the logo when the clock shares the logo's corner; 'pill' is the dark rounded plate of the first release.
 * With the date on and `alternate` on (default) the time and the date take turns in the same spot: the time for 5 s, then
 * the date for 3 s, with a 200 ms cross-fade; the phase comes from the wall clock (epoch ms), so it is deterministic.
 *
 * Pure helpers (settings, text, phases, layout) plus a small renderer; no React. Unit-tested by `test/ui/clock.spec.ts`.
 *
 * Text is always English ("18 Nov, 2026", "Wed 18 Nov" and "02:56 PM" / "15:04"), whatever the browser's language, so
 * the on-air look is predictable. The text is formatted once per second and cached; the geometry is cached with it.
 * The compact text is drawn in fixed-width character cells (digits all as wide as the widest digit), so it never
 * jiggles as the digits change.
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
export type ClockStyle = 'text' | 'pill';

export interface ClockSettings {
  enabled: boolean;
  position: ClockPosition;
  format: ClockFormat;
  showDate: boolean;
  showSeconds: boolean;
  /** IANA zone name; null = this device's time zone. */
  timezone: string | null;
  size: ClockSize;
  /** 'text' = compact plain text under the logo; 'pill' = the dark rounded plate. */
  style: ClockStyle;
  /** With the date on: the time and the date take turns in one spot (true) or show together on one line (false). */
  alternate: boolean;
}

/** Same defaults as the brand kit columns (migrations 0034 and 0035). Off, so nothing changes until someone turns it on. */
export const DEFAULT_CLOCK: ClockSettings = {
  enabled: false,
  position: 'top_right',
  format: '12h',
  showDate: true,
  showSeconds: false,
  timezone: null,
  size: 'small',
  style: 'text',
  alternate: true,
};

/** What a per-stream clock saved before the compact style existed means: it was a pill, with both texts on one line. */
export const LEGACY_CLOCK_LOOK: Pick<ClockSettings, 'style' | 'alternate'> = { style: 'pill', alternate: false };

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
export const CLOCK_STYLES: Array<{ id: ClockStyle; label: string }> = [
  { id: 'text', label: 'Compact text' },
  { id: 'pill', label: 'Pill' },
];
/** Text height as a share of the picture's short side (its height on a 16:9 stream, its width on a vertical one), per style. */
export const CLOCK_SIZE_SHARE: Record<ClockStyle, Record<ClockSize, number>> = {
  text: { small: 0.02, medium: 0.028, large: 0.038 },
  pill: { small: 0.022, medium: 0.03, large: 0.042 },
};

/** The alternating spot: the time for 5 s, then the date for 3 s, repeating, with a 200 ms cross-fade at each change. */
export const CLOCK_TIME_MS = 5000;
export const CLOCK_DATE_MS = 3000;
export const CLOCK_FADE_MS = 200;
export const CLOCK_CYCLE_MS = CLOCK_TIME_MS + CLOCK_DATE_MS;

/** True when the date and the time take turns (needs the date on). */
export const isAlternating = (s: Pick<ClockSettings, 'showDate' | 'alternate'>) => s.showDate && s.alternate;

/**
 * How visible the time and the date are at `ms` (0..1 each). The cycle starts at epoch 0 and repeats every 8 s: the time is on
 * for [0, 5000) and the date for [5000, 8000); each one fades in over its first 200 ms while the other fades out.
 */
export function alternatePhase(ms: number): { time: number; date: number } {
  const t = ((ms % CLOCK_CYCLE_MS) + CLOCK_CYCLE_MS) % CLOCK_CYCLE_MS;
  if (t < CLOCK_FADE_MS) return { time: t / CLOCK_FADE_MS, date: 1 - t / CLOCK_FADE_MS };
  if (t < CLOCK_TIME_MS) return { time: 1, date: 0 };
  if (t < CLOCK_TIME_MS + CLOCK_FADE_MS) return { time: 1 - (t - CLOCK_TIME_MS) / CLOCK_FADE_MS, date: (t - CLOCK_TIME_MS) / CLOCK_FADE_MS };
  return { time: 0, date: 1 };
}

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
export function normalizeClock(raw: unknown, missing: Partial<Pick<ClockSettings, 'style' | 'alternate'>> = {}): ClockSettings {
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
    // `missing` is what a field that was never stored means (a stream saved before the compact style: see LEGACY_CLOCK_LOOK).
    style: pick(r.style, CLOCK_STYLES.map((s) => s.id), missing.style ?? DEFAULT_CLOCK.style),
    alternate: typeof r.alternate === 'boolean' ? r.alternate : missing.alternate ?? DEFAULT_CLOCK.alternate,
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
  clockStyle?: string;
  clockAlternate?: boolean;
}): ClockSettings {
  return normalizeClock({
    enabled: kit.clockEnabled,
    position: kit.clockPosition,
    format: kit.clockFormat,
    showDate: kit.clockShowDate,
    showSeconds: kit.clockShowSeconds,
    timezone: kit.clockTimezone,
    size: kit.clockSize,
    style: kit.clockStyle,
    alternate: kit.clockAlternate,
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
  clockStyle?: ClockStyle;
  clockAlternate?: boolean;
} {
  const out: ReturnType<typeof kitPatchFromClock> = {};
  if (patch.enabled !== undefined) out.clockEnabled = patch.enabled;
  if (patch.position !== undefined) out.clockPosition = patch.position;
  if (patch.format !== undefined) out.clockFormat = patch.format;
  if (patch.showDate !== undefined) out.clockShowDate = patch.showDate;
  if (patch.showSeconds !== undefined) out.clockShowSeconds = patch.showSeconds;
  if (patch.timezone !== undefined) out.clockTimezone = patch.timezone;
  if (patch.size !== undefined) out.clockSize = patch.size;
  if (patch.style !== undefined) out.clockStyle = patch.style;
  if (patch.alternate !== undefined) out.clockAlternate = patch.alternate;
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
  /** "18 Nov, 2026" when the date alternates with the time, otherwise "Wed 18 Nov"; null when the date is off. */
  date: string | null;
  /** "02:56 PM" (compact text), "3:04 PM" (pill), "3:04:05 PM" or "15:04". */
  time: string;
}

/** Formats `ms` for the settings. Pure; cached formatters make it cheap, and callers format once per second. */
const formatters = new Map<string, { date: Intl.DateTimeFormat; time: Intl.DateTimeFormat }>();
export function formatClock(ms: number, s: ClockSettings): ClockText {
  const alt = isAlternating(s);
  const twoDigitHour = s.style === 'text' || s.format === '24h';
  const key = `${s.timezone ?? ''}|${s.format}|${s.showSeconds}|${twoDigitHour}|${alt}`;
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
      date: make(alt ? { day: 'numeric', month: 'short', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' }),
      time: make({ hour: twoDigitHour ? '2-digit' : 'numeric', minute: '2-digit', ...(s.showSeconds ? { second: '2-digit' as const } : {}), hourCycle: s.format === '12h' ? 'h12' : 'h23' }),
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
    date = alt ? `${d.get('day')} ${d.get('month')}, ${d.get('year')}` : `${d.get('weekday')} ${d.get('day')} ${d.get('month')}`;
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
  /** Space between the logo and the compact text under it (0.6 of the text height). */
  logoGap: number;
}

/** Sizes for a w x h picture. The short side is the yardstick, so a vertical stream scales by its width and stays inside the frame. */
export function clockMetrics(w: number, h: number, size: ClockSize, style: ClockStyle): ClockMetrics {
  const base = Math.min(w, h);
  const fontPx = Math.max(10, Math.round(base * CLOCK_SIZE_SHARE[style][size]));
  const margin = Math.max(6, Math.round(base * 0.022)); // 16 px on a 720-high picture, the logo's margin
  const pill = style === 'pill';
  return {
    fontPx,
    padX: pill ? Math.round(fontPx * 0.7) : 0,
    padY: pill ? Math.round(fontPx * 0.45) : 0,
    margin,
    bottomGap: h > w ? Math.round(h * 0.06) : margin, // the same bottom allowance as the "Powered by" mark
    gap: Math.max(4, Math.round(base * 0.012)),
    logoGap: Math.round(fontPx * 0.6),
  };
}

/** Moves `y` clear of everything in `avoid` that the box at (x, y) would cover: down for a top clock, up for a bottom one. */
function clearOf(x: number, y: number, box: { w: number; h: number }, top: boolean, gap: number, avoid: readonly Box[]): number {
  for (let pass = 0; pass < avoid.length + 1; pass++) {
    const hit = avoid.find((a) => intersects({ x, y, w: box.w, h: box.h }, a));
    if (!hit) break;
    y = top ? hit.y + hit.h + gap : hit.y - gap - box.h;
  }
  return y;
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
  y = clearOf(x, y, pill, top, m.gap, avoid);
  y = Math.min(Math.max(y, frame.y), frame.y + frame.h - pill.h);
  return { x, y, w: pill.w, h: pill.h };
}

export type ClockAlign = 'left' | 'center' | 'right';

/**
 * Where the compact text goes. In the logo's own top corner (the clock's corner is on the logo's side of the picture) it
 * sits directly under the logo, centred on the logo's horizontal centre, `logoGap` below it, and never over it. In any
 * other corner it hugs that corner with the usual margin (right-aligned on the right, left-aligned on the left). Bottom
 * corners keep their clearance from the ticker and the "Powered by" mark. `logo` is the logo's box (or null); it is also
 * kept clear of in every other case. Stays inside `frame`.
 */
export function layoutClockText(
  frame: Box,
  text: { w: number; h: number },
  position: ClockPosition,
  m: ClockMetrics,
  logo: Box | null,
  avoid: readonly Box[],
): { box: Box; align: ClockAlign } {
  const top = position === 'top_left' || position === 'top_right';
  const left = position === 'top_left' || position === 'bottom_left';
  const keepClear = logo ? [...avoid, logo] : avoid;
  const mid = frame.x + frame.w / 2;
  const logoCx = logo ? logo.x + logo.w / 2 : mid;
  const underLogo = top && !!logo && (left ? logoCx < mid : logoCx > mid);
  let x: number;
  let y: number;
  let align: ClockAlign;
  if (underLogo && logo) {
    const lo = frame.x + m.margin;
    const hi = frame.x + frame.w - m.margin - text.w;
    x = Math.round(Math.min(Math.max(logoCx - text.w / 2, lo), Math.max(lo, hi)));
    y = logo.y + logo.h + m.logoGap;
    align = 'center';
  } else {
    x = left ? frame.x + m.margin : frame.x + frame.w - m.margin - text.w;
    y = top ? frame.y + m.margin : frame.y + frame.h - m.bottomGap - text.h;
    align = left ? 'left' : 'right';
  }
  y = clearOf(x, y, text, top, m.gap, keepClear);
  y = Math.min(Math.max(y, frame.y), frame.y + frame.h - text.h);
  return { box: { x, y, w: text.w, h: text.h }, align };
}

// ---- Renderer --------------------------------------------------------------

const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

/** One line of text with its measured width; `adv` holds per-character advances for the fixed-width compact text. */
interface Prepared {
  text: string;
  w: number;
  adv: number[] | null;
}

interface Cached {
  key: string;
  style: ClockStyle;
  fontPx: number;
  /** Set when the time and the date take turns: [time, date]. Otherwise `lines` are drawn together. */
  alt: [Prepared, Prepared] | null;
  lines: Prepared[];
  box: { w: number; h: number };
  metrics: ClockMetrics;
}

/** Draws the clock. Keeps the formatted text and its measured size for the current second. */
export class ClockOverlay {
  private cache: Cached | null = null;

  private prepare(ctx: CanvasRenderingContext2D, text: string, fixed: boolean, digitW: number, apW: number): Prepared {
    if (!fixed) return { text, w: ctx.measureText(text).width, adv: null };
    const adv = [...text].map((ch) => (/\d/.test(ch) ? digitW : ch === 'A' || ch === 'P' ? apW : ctx.measureText(ch).width));
    return { text, w: adv.reduce((a, b) => a + b, 0), adv };
  }

  /**
   * Draws on `ctx` (a w x h picture; `frame` = where the picture really is, default all of it). `logo` is the logo's box (the
   * compact text goes under it); `avoid` holds the other things to keep clear of (the ticker, the "Powered by" mark). Returns
   * the clock's box, or null when off.
   */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, s: ClockSettings, nowMs: number, avoid: readonly Box[], frame: Box = { x: 0, y: 0, w, h }, logo: Box | null = null): Box | null {
    if (!s.enabled) return null;
    const second = Math.floor(nowMs / 1000);
    const key = `${second}|${s.timezone ?? ''}|${s.format}|${s.showDate}|${s.showSeconds}|${s.size}|${s.style}|${s.alternate}|${w}x${h}|${frame.w}`;
    let c = this.cache;
    if (!c || c.key !== key) {
      const text = formatClock(nowMs, s);
      const metrics = clockMetrics(w, h, s.size, s.style);
      const textStyle = s.style === 'text';
      ctx.save();
      ctx.font = `${textStyle ? 700 : 600} ${metrics.fontPx}px ${FONT}`;
      const digitW = Math.max(...'0123456789'.split('').map((d) => ctx.measureText(d).width));
      const apW = Math.max(ctx.measureText('A').width, ctx.measureText('P').width);
      const prep = (t: string) => this.prepare(ctx, t, textStyle, digitW, apW);
      let alt: Cached['alt'] = null;
      let lines: Prepared[];
      let textW: number;
      if (text.date && isAlternating(s)) {
        alt = [prep(text.time), prep(text.date)];
        lines = [];
        textW = Math.max(alt[0].w, alt[1].w);
      } else {
        lines = [prep(text.date ? `${text.date}  ·  ${text.time}` : text.time)];
        textW = lines[0].w;
        // A narrow (vertical) picture stacks the date over the time instead of running wide.
        if (text.date && textW + metrics.padX * 2 > frame.w * 0.62) {
          lines = [prep(text.date), prep(text.time)];
          textW = Math.max(lines[0].w, lines[1].w);
        }
      }
      ctx.restore();
      const lineH = Math.round(metrics.fontPx * 1.2);
      c = this.cache = {
        key,
        style: s.style,
        fontPx: metrics.fontPx,
        metrics,
        alt,
        lines,
        box: { w: Math.round(textW + metrics.padX * 2), h: lineH * Math.max(1, lines.length) + metrics.padY * 2 },
      };
    }
    const lineH = Math.round(c.fontPx * 1.2);
    // Each entry: a line to draw, how visible it is, and its row.
    const draws: Array<{ p: Prepared; alpha: number; row: number }> = [];
    if (c.alt) {
      const ph = alternatePhase(nowMs);
      draws.push({ p: c.alt[0], alpha: ph.time, row: 0 }, { p: c.alt[1], alpha: ph.date, row: 0 });
    } else {
      c.lines.forEach((p, row) => draws.push({ p, alpha: 1, row }));
    }

    if (c.style === 'pill') {
      const box = layoutClock(frame, c.box, s.position, c.metrics, logo ? [...avoid, logo] : avoid);
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
      for (const d of draws) {
        if (d.alpha <= 0) continue;
        ctx.globalAlpha = d.alpha;
        ctx.fillText(d.p.text, box.x + box.w / 2, box.y + c.metrics.padY + lineH * d.row + lineH / 2);
      }
      ctx.restore();
      return box;
    }

    // Compact text: no plate. A soft dark shadow plus a thin dark outline keep it readable on any background.
    const { box, align } = layoutClockText(frame, c.box, s.position, c.metrics, logo, avoid);
    const anchor = align === 'left' ? box.x : align === 'right' ? box.x + box.w : box.x + box.w / 2;
    ctx.save();
    ctx.font = `700 ${c.fontPx}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const d of draws) {
      if (d.alpha <= 0) continue;
      const left = align === 'left' ? anchor : align === 'right' ? anchor - d.p.w : anchor - d.p.w / 2;
      const cy = box.y + lineH * d.row + lineH / 2;
      const cells = d.p.adv ?? [d.p.w];
      const glyphs = d.p.adv ? [...d.p.text] : [d.p.text];
      ctx.globalAlpha = d.alpha;
      // Pass 1: shadow and outline. Pass 2: the white fill, without a shadow, so the glyphs stay crisp.
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = c.fontPx * 0.25;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = c.fontPx * 0.12;
      let x = left;
      glyphs.forEach((g, i) => {
        ctx.strokeText(g, x + cells[i] / 2, cy);
        x += cells[i];
      });
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      x = left;
      glyphs.forEach((g, i) => {
        ctx.fillText(g, x + cells[i] / 2, cy);
        x += cells[i];
      });
    }
    ctx.restore();
    return box;
  }
}
