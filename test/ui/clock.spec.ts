import { expect, test } from '@playwright/test';
import { newsBarHeight } from '../../web-app/src/studio/compose';
import { poweredByBox } from '../../web-app/src/studio/poweredBy';
import {
  CLOCK_CYCLE_MS,
  CLOCK_DATE_MS,
  CLOCK_FADE_MS,
  CLOCK_POSITIONS,
  CLOCK_SIZES,
  CLOCK_TIME_MS,
  DEFAULT_CLOCK,
  LEGACY_CLOCK_LOOK,
  alternatePhase,
  clockFromKit,
  clockMetrics,
  formatClock,
  isAlternating,
  isValidTimeZone,
  kitPatchFromClock,
  layoutClock,
  layoutClockText,
  normalizeClock,
  type Box,
  type ClockPosition,
  type ClockSettings,
} from '../../web-app/src/studio/clock';

// Pure checks for the on-air date and time (settings, text, layout). No browser involved.

const NOV18_0934 = Date.UTC(2026, 10, 18, 9, 34, 5); // Wed 18 Nov 2026, 09:34:05 UTC = 15:04:05 in India
// The first release's look (a pill with date and time on one line); the formatting/layout tests below were written for it.
const s = (over: Partial<ClockSettings> = {}): ClockSettings => ({ ...DEFAULT_CLOCK, enabled: true, style: 'pill', alternate: false, size: 'medium', ...over });
/** The compact defaults (what a new kit gets). */
const t = (over: Partial<ClockSettings> = {}): ClockSettings => ({ ...DEFAULT_CLOCK, enabled: true, ...over });

test.describe('clock text', () => {
  test('12 hour, date on, in a chosen zone: "Wed 18 Nov" and "3:04 PM"', () => {
    expect(formatClock(NOV18_0934, s({ timezone: 'Asia/Kolkata' }))).toEqual({ date: 'Wed 18 Nov', time: '3:04 PM' });
    expect(formatClock(NOV18_0934, s({ timezone: 'UTC' }))).toEqual({ date: 'Wed 18 Nov', time: '9:34 AM' });
  });
  test('24 hour and seconds', () => {
    expect(formatClock(NOV18_0934, s({ timezone: 'Asia/Kolkata', format: '24h' })).time).toBe('15:04');
    expect(formatClock(NOV18_0934, s({ timezone: 'Asia/Kolkata', format: '24h', showSeconds: true })).time).toBe('15:04:05');
    expect(formatClock(NOV18_0934, s({ timezone: 'Asia/Kolkata', showSeconds: true })).time).toBe('3:04:05 PM');
  });
  test('midnight is 00:00 / 12:00 AM, never 24:00', () => {
    const midnightIst = Date.UTC(2026, 10, 17, 18, 30, 0);
    expect(formatClock(midnightIst, s({ timezone: 'Asia/Kolkata', format: '24h' })).time).toBe('00:00');
    expect(formatClock(midnightIst, s({ timezone: 'Asia/Kolkata' }))).toEqual({ date: 'Wed 18 Nov', time: '12:00 AM' });
  });
  test('the zone decides the date too, the date can be switched off, and English is used whatever the browser language', () => {
    const lateUtc = Date.UTC(2026, 10, 18, 23, 30, 0);
    expect(formatClock(lateUtc, s({ timezone: 'Asia/Kolkata' })).date).toBe('Thu 19 Nov');
    expect(formatClock(lateUtc, s({ timezone: 'UTC' })).date).toBe('Wed 18 Nov');
    expect(formatClock(NOV18_0934, s({ showDate: false, timezone: 'UTC' })).date).toBeNull();
    expect(formatClock(Date.UTC(2026, 8, 2, 12, 0, 0), s({ timezone: 'UTC' })).date).toBe('Wed 2 Sep');
  });
  test('this device (null zone) and an unknown zone never throw', () => {
    expect(formatClock(NOV18_0934, s({ timezone: null })).time).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
    expect(() => formatClock(NOV18_0934, s({ timezone: 'Mars/Olympus' }))).not.toThrow();
  });
});

test.describe('compact clock text and phases', () => {
  test('compact text: "02:56 PM" with a two-digit hour, and the alternating date is "18 Nov, 2026"', () => {
    expect(formatClock(NOV18_0934, t({ timezone: 'Asia/Kolkata' }))).toEqual({ date: '18 Nov, 2026', time: '03:04 PM' });
    expect(formatClock(NOV18_0934, t({ timezone: 'UTC' }))).toEqual({ date: '18 Nov, 2026', time: '09:34 AM' });
    expect(formatClock(Date.UTC(2026, 10, 18, 21, 26, 0), t({ timezone: 'Asia/Kolkata' })).time).toBe('02:56 AM');
    expect(formatClock(Date.UTC(2026, 10, 18, 9, 26, 0), t({ timezone: 'Asia/Kolkata' })).time).toBe('02:56 PM');
    expect(formatClock(NOV18_0934, t({ timezone: 'Asia/Kolkata', format: '24h', showSeconds: true })).time).toBe('15:04:05');
    expect(formatClock(NOV18_0934, t({ timezone: 'UTC', showDate: false })).date).toBeNull();
  });
  test('compact text with alternate off keeps the one-line "Wed 18 Nov" date; the pill keeps its un-padded hour', () => {
    expect(formatClock(NOV18_0934, t({ timezone: 'Asia/Kolkata', alternate: false }))).toEqual({ date: 'Wed 18 Nov', time: '03:04 PM' });
    expect(formatClock(NOV18_0934, s({ timezone: 'Asia/Kolkata' }))).toEqual({ date: 'Wed 18 Nov', time: '3:04 PM' });
    // A pill that alternates shows the long date too.
    expect(formatClock(NOV18_0934, s({ timezone: 'Asia/Kolkata', alternate: true })).date).toBe('18 Nov, 2026');
  });
  test('alternating needs the date on', () => {
    expect(isAlternating(t())).toBe(true);
    expect(isAlternating(t({ alternate: false }))).toBe(false);
    expect(isAlternating(t({ showDate: false }))).toBe(false);
  });
  test('the cycle is the time for 5 s then the date for 3 s, with a 200 ms cross-fade, and repeats from the wall clock', () => {
    expect([CLOCK_TIME_MS, CLOCK_DATE_MS, CLOCK_FADE_MS, CLOCK_CYCLE_MS]).toEqual([5000, 3000, 200, 8000]);
    const base = Math.floor(NOV18_0934 / CLOCK_CYCLE_MS) * CLOCK_CYCLE_MS;
    const at = (ms: number) => alternatePhase(base + ms);
    expect(at(0)).toEqual({ time: 0, date: 1 }); // the date is just fading out, the time fading in
    expect(at(100)).toEqual({ time: 0.5, date: 0.5 });
    expect(at(200)).toEqual({ time: 1, date: 0 });
    expect(at(2500)).toEqual({ time: 1, date: 0 });
    expect(at(4999)).toEqual({ time: 1, date: 0 });
    expect(at(5000)).toEqual({ time: 1, date: 0 }); // the boundary: the fade to the date starts
    expect(at(5100)).toEqual({ time: 0.5, date: 0.5 });
    expect(at(5200)).toEqual({ time: 0, date: 1 });
    expect(at(7999)).toEqual({ time: 0, date: 1 });
    expect(at(8000)).toEqual({ time: 0, date: 1 }); // next cycle begins
    expect(at(8200)).toEqual({ time: 1, date: 0 });
    expect(at(8000 * 3 + 6000)).toEqual({ time: 0, date: 1 });
    // The two always add up to one while fading, so nothing flickers or goes blank.
    for (let ms = 0; ms < 8000; ms += 37) {
      const p = at(ms);
      expect(p.time + p.date).toBeCloseTo(1, 9);
    }
    expect(alternatePhase(-1000)).toEqual(alternatePhase(7000)); // negative times wrap, never NaN
  });
});

test.describe('clock settings', () => {
  test('defaults match the brand kit defaults: off, top right, 12 hour, date on, no seconds, device zone, small, compact text, alternating', () => {
    expect(DEFAULT_CLOCK).toEqual({ enabled: false, position: 'top_right', format: '12h', showDate: true, showSeconds: false, timezone: null, size: 'small', style: 'text', alternate: true });
    expect(normalizeClock(undefined)).toEqual(DEFAULT_CLOCK);
    expect(normalizeClock(null)).toEqual(DEFAULT_CLOCK);
  });
  test('garbage falls back field by field; good values are kept', () => {
    expect(normalizeClock({ enabled: 'yes', position: 'middle', format: '36h', showDate: 3, showSeconds: 'x', timezone: 'Nope/Nope', size: 'huge', style: 'box', alternate: 'yes' })).toEqual(DEFAULT_CLOCK);
    const good = { enabled: true, position: 'bottom_left', format: '24h', showDate: false, showSeconds: true, timezone: 'Asia/Kolkata', size: 'large', style: 'pill', alternate: false };
    expect(normalizeClock(good)).toEqual(good);
  });
  test('a clock stored before the compact style existed (no style / alternate) is a pill with both texts on one line; a new one is compact', () => {
    const stored = { enabled: true, position: 'top_left', format: '24h', showDate: true, showSeconds: false, timezone: 'UTC', size: 'medium' };
    expect(normalizeClock(stored, LEGACY_CLOCK_LOOK)).toEqual({ ...stored, style: 'pill', alternate: false });
    expect(normalizeClock(stored)).toEqual({ ...stored, style: 'text', alternate: true });
    // Values that are stored always win over the fallback.
    expect(normalizeClock({ ...stored, style: 'text', alternate: true }, LEGACY_CLOCK_LOOK)).toMatchObject({ style: 'text', alternate: true });
  });
  test('a kit maps to settings and back; an old kit without the fields is the default (off)', () => {
    expect(clockFromKit({})).toEqual(DEFAULT_CLOCK);
    const kit = { clockEnabled: true, clockPosition: 'bottom_right', clockFormat: '24h', clockShowDate: false, clockShowSeconds: true, clockTimezone: 'UTC', clockSize: 'small', clockStyle: 'pill', clockAlternate: false };
    const c = clockFromKit(kit);
    expect(c).toEqual({ enabled: true, position: 'bottom_right', format: '24h', showDate: false, showSeconds: true, timezone: 'UTC', size: 'small', style: 'pill', alternate: false });
    expect(kitPatchFromClock(c)).toEqual(kit);
    expect(kitPatchFromClock({ timezone: null })).toEqual({ clockTimezone: null });
    expect(kitPatchFromClock({})).toEqual({});
  });
  test('zone names are checked like the server does', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('x'.repeat(65))).toBe(false);
  });
});

const SIZES: Array<[string, number, number]> = [
  ['landscape 720p', 1280, 720],
  ['landscape 1080p', 1920, 1080],
  ['landscape 360p', 640, 360],
  ['vertical 720x1280', 720, 1280],
  ['vertical 1080x1920', 1080, 1920],
];
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** A believable pill: width from the text, height from the font. */
const pillFor = (w: number, h: number, size: 'small' | 'medium' | 'large', wide = 11) => {
  const m = clockMetrics(w, h, size, 'pill');
  return { m, pill: { w: Math.round(m.fontPx * 0.6 * wide + m.padX * 2), h: Math.round(m.fontPx * 1.2 + m.padY * 2) } };
};

test.describe('clock layout', () => {
  test('pill text height is 2.2 / 3 / 4.2 percent of the short side (the height on a 16:9 stream, the width on a vertical one)', () => {
    expect(clockMetrics(1280, 720, 'small', 'pill').fontPx).toBe(Math.round(720 * 0.022));
    expect(clockMetrics(1280, 720, 'medium', 'pill').fontPx).toBe(Math.round(720 * 0.03));
    expect(clockMetrics(1280, 720, 'large', 'pill').fontPx).toBe(Math.round(720 * 0.042));
    // A vertical stream is as wide as a 720p stream is high: same text size, so it stays inside the narrow frame.
    expect(clockMetrics(720, 1280, 'medium', 'pill').fontPx).toBe(clockMetrics(1280, 720, 'medium', 'pill').fontPx);
    expect(clockMetrics(720, 1280, 'large', 'pill').margin).toBe(clockMetrics(1280, 720, 'large', 'pill').margin);
    expect(clockMetrics(1280, 720, 'medium', 'pill').margin).toBe(16); // the logo's margin
  });

  for (const [name, w, h] of SIZES) {
    for (const size of CLOCK_SIZES.map((x) => x.id)) {
      test(`${name}, ${size}: every corner is inside the frame with the safe margin, and the corner is the one chosen`, () => {
        const { m, pill } = pillFor(w, h, size);
        const frame: Box = { x: 0, y: 0, w, h };
        for (const { id } of CLOCK_POSITIONS) {
          const b = layoutClock(frame, pill, id, m, []);
          expect(b.x).toBeGreaterThanOrEqual(m.margin);
          expect(b.x + b.w).toBeLessThanOrEqual(w - m.margin);
          expect(b.y).toBeGreaterThanOrEqual(m.margin);
          expect(b.y + b.h).toBeLessThanOrEqual(h - m.margin);
          const left = id.endsWith('left');
          const top = id.startsWith('top');
          expect(b.x + b.w / 2 < w / 2).toBe(left);
          expect(b.y + b.h / 2 < h / 2).toBe(top);
        }
      });
    }
  }

  test('a vertical stream keeps the bottom corners clear of the platform bar (6 percent of the height, like the Powered by mark)', () => {
    const { m, pill } = pillFor(720, 1280, 'medium');
    const b = layoutClock({ x: 0, y: 0, w: 720, h: 1280 }, pill, 'bottom_right', m, []);
    expect(1280 - (b.y + b.h)).toBe(Math.round(1280 * 0.06));
    const l = pillFor(1280, 720, 'medium');
    const bl = layoutClock({ x: 0, y: 0, w: 1280, h: 720 }, l.pill, 'bottom_right', l.m, []);
    expect(720 - (bl.y + bl.h)).toBe(l.m.margin); // landscape: the usual margin
  });

  for (const [name, w, h] of SIZES) {
    test(`${name}: in the logo's corner the clock steps below the logo; in the other top corner it does not move`, () => {
      const { m, pill } = pillFor(w, h, 'medium');
      const frame: Box = { x: 0, y: 0, w, h };
      const logoH = 90;
      const logoW = 160;
      const logoLeft: Box = { x: 16, y: 16, w: logoW, h: logoH };
      const logoRight: Box = { x: w - 16 - logoW, y: 16, w: logoW, h: logoH };
      const same = layoutClock(frame, pill, 'top_left', m, [logoLeft]);
      expect(overlaps(same, logoLeft)).toBe(false);
      expect(same.y).toBeGreaterThanOrEqual(logoLeft.y + logoLeft.h);
      expect(same.x).toBe(m.margin);
      const sameR = layoutClock(frame, pill, 'top_right', m, [logoRight]);
      expect(overlaps(sameR, logoRight)).toBe(false);
      expect(sameR.y).toBeGreaterThanOrEqual(logoRight.y + logoRight.h);
      // The logo on the left and the clock on the right share nothing: the clock keeps its own corner position.
      const other = layoutClock(frame, pill, 'top_right', m, [logoLeft]);
      expect(other.y).toBe(m.margin);
      // Bottom corners are not touched by the logo.
      expect(layoutClock(frame, pill, 'bottom_left', m, [logoLeft]).y).toBe(layoutClock(frame, pill, 'bottom_left', m, []).y);
    });

    test(`${name}: a bottom clock sits above the news ticker, and above the Powered by mark when both are in its corner`, () => {
      const { m, pill } = pillFor(w, h, 'medium');
      const frame: Box = { x: 0, y: 0, w, h };
      const bar = newsBarHeight(18);
      const ticker: Box = { x: 0, y: h - bar, w, h: bar };
      const mark = poweredByBox(w, h, bar);
      for (const pos of ['bottom_left', 'bottom_right'] as ClockPosition[]) {
        const t = layoutClock(frame, pill, pos, m, [ticker]);
        expect(overlaps(t, ticker)).toBe(false);
        expect(t.y + t.h).toBeLessThanOrEqual(h - bar);
      }
      const both = layoutClock(frame, pill, 'bottom_right', m, [ticker, mark]);
      expect(overlaps(both, ticker)).toBe(false);
      expect(overlaps(both, mark)).toBe(false);
      const markFree = layoutClock(frame, pill, 'bottom_left', m, [ticker, mark]);
      expect(markFree.y).toBe(layoutClock(frame, pill, 'bottom_left', m, [ticker]).y); // the mark is bottom right only
      // Without a ticker a bottom clock is never higher (a vertical stream's own bottom allowance already clears a small ticker).
      expect(layoutClock(frame, pill, 'bottom_left', m, []).y).toBeGreaterThanOrEqual(layoutClock(frame, pill, 'bottom_left', m, [ticker]).y);
    });
  }

  test('with a shrunken picture the clock follows the picture rectangle (and stays inside it)', () => {
    const { m, pill } = pillFor(1280, 720, 'medium');
    const scene: Box = { x: 320, y: 0, w: 960, h: 540 }; // a left-third ad leaves this
    for (const { id } of CLOCK_POSITIONS) {
      const b = layoutClock(scene, pill, id, m, []);
      expect(b.x).toBeGreaterThanOrEqual(scene.x);
      expect(b.x + b.w).toBeLessThanOrEqual(scene.x + scene.w);
      expect(b.y + b.h).toBeLessThanOrEqual(scene.y + scene.h);
    }
  });

  test('an impossible squeeze stays inside the frame instead of running off it', () => {
    const { m, pill } = pillFor(1280, 720, 'large');
    const wall: Box = { x: 0, y: 0, w: 1280, h: 720 };
    const b = layoutClock({ x: 0, y: 0, w: 1280, h: 720 }, pill, 'top_left', m, [wall]);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.h).toBeLessThanOrEqual(720);
  });
});

// ---- Compact text layout ----------------------------------------------------------------------------------------------
const textBox = (w: number, h: number, size: 'small' | 'medium' | 'large', wide = 8) => {
  const m = clockMetrics(w, h, size, 'text');
  return { m, box: { w: Math.round(m.fontPx * 0.6 * wide), h: Math.round(m.fontPx * 1.2) } };
};

test.describe('compact text layout', () => {
  test('text height is 2 / 2.8 / 3.8 percent of the short side, smaller than the pill, with no padding and a 0.6 text-height gap under the logo', () => {
    expect(clockMetrics(1280, 720, 'small', 'text').fontPx).toBe(Math.round(720 * 0.02));
    expect(clockMetrics(1280, 720, 'medium', 'text').fontPx).toBe(Math.round(720 * 0.028));
    expect(clockMetrics(1280, 720, 'large', 'text').fontPx).toBe(Math.round(720 * 0.038));
    for (const size of ['small', 'medium', 'large'] as const) expect(clockMetrics(1280, 720, size, 'text').fontPx).toBeLessThan(clockMetrics(1280, 720, size, 'pill').fontPx);
    const m = clockMetrics(1280, 720, 'medium', 'text');
    expect([m.padX, m.padY]).toEqual([0, 0]);
    expect(m.logoGap).toBe(Math.round(m.fontPx * 0.6));
    expect(clockMetrics(720, 1280, 'small', 'text').fontPx).toBe(clockMetrics(1280, 720, 'small', 'text').fontPx); // short side rules
  });

  for (const [name, w, h] of SIZES) {
    const frame: Box = { x: 0, y: 0, w, h };
    const logoW = Math.round(w * 0.18);
    const logoH = Math.round(logoW * 0.4);
    const logoRight: Box = { x: w - 16 - logoW, y: 16, w: logoW, h: logoH };
    const logoLeft: Box = { x: 16, y: 16, w: logoW, h: logoH };

    test(`${name}: in the logo's corner the text sits directly under the logo, centred on it, with a 0.6 text-height gap, never overlapping`, () => {
      const { m, box } = textBox(w, h, 'small');
      for (const [pos, logo] of [['top_right', logoRight], ['top_left', logoLeft]] as Array<[ClockPosition, Box]>) {
        const r = layoutClockText(frame, box, pos, m, logo, []);
        expect(r.align).toBe('center');
        expect(r.box.y).toBe(logo.y + logo.h + m.logoGap);
        expect(Math.abs(r.box.x + r.box.w / 2 - (logo.x + logo.w / 2))).toBeLessThanOrEqual(1);
        expect(overlaps(r.box, logo)).toBe(false);
      }
    });

    test(`${name}: a different corner than the logo's hugs its own corner with the usual margin (aligned to that side), and still never covers the logo`, () => {
      const { m, box } = textBox(w, h, 'medium');
      const rl = layoutClockText(frame, box, 'top_left', m, logoRight, []);
      expect([rl.align, rl.box.x, rl.box.y]).toEqual(['left', m.margin, m.margin]);
      const rr = layoutClockText(frame, box, 'top_right', m, logoLeft, []);
      expect([rr.align, rr.box.x + rr.box.w, rr.box.y]).toEqual(['right', w - m.margin, m.margin]);
      // No logo at all: the corner, nothing to step under.
      const none = layoutClockText(frame, box, 'top_right', m, null, []);
      expect([none.align, none.box.y]).toEqual(['right', m.margin]);
      // A very wide logo that the text would hit: it steps below, never over.
      const wide: Box = { x: 16, y: 16, w: w - 32, h: 40 };
      expect(overlaps(layoutClockText(frame, box, 'top_right', m, wide, []).box, wide)).toBe(false);
    });

    test(`${name}: a logo in the middle is not "the clock's corner": the text keeps its corner and steps below the logo only if it would hit it`, () => {
      const { m, box } = textBox(w, h, 'small');
      const mid: Box = { x: w / 2 - 50, y: 16, w: 100, h: logoH };
      const r = layoutClockText(frame, box, 'top_right', m, mid, []);
      expect(r.align).toBe('right');
      expect(r.box.y).toBe(m.margin);
      expect(overlaps(r.box, mid)).toBe(false);
    });

    test(`${name}: bottom corners keep the margin / platform-bar clearance and sit above the ticker and the Powered by mark; the logo does not move them`, () => {
      const { m, box } = textBox(w, h, 'small');
      const bar = newsBarHeight(18);
      const ticker: Box = { x: 0, y: h - bar, w, h: bar };
      const mark = poweredByBox(w, h, bar);
      for (const pos of ['bottom_left', 'bottom_right'] as ClockPosition[]) {
        const plain = layoutClockText(frame, box, pos, m, logoRight, []);
        expect(plain.align).toBe(pos === 'bottom_left' ? 'left' : 'right');
        expect(h - (plain.box.y + plain.box.h)).toBe(m.bottomGap);
        expect(plain.box.y).toBe(layoutClockText(frame, box, pos, m, null, []).box.y);
        const t2 = layoutClockText(frame, box, pos, m, logoRight, [ticker, mark]);
        expect(overlaps(t2.box, ticker)).toBe(false);
        expect(overlaps(t2.box, mark)).toBe(false);
      }
    });

    test(`${name}: with a shrunken picture the text follows the picture rectangle and the logo inside it`, () => {
      const { m, box } = textBox(w, h, 'small');
      const scene: Box = { x: Math.round(w * 0.25), y: 0, w: Math.round(w * 0.75), h: Math.round(h * 0.75) };
      const logoInScene: Box = { x: scene.x + scene.w - 16 - logoW, y: 16, w: logoW, h: logoH };
      const r = layoutClockText(scene, box, 'top_right', m, logoInScene, []);
      expect(r.box.x).toBeGreaterThanOrEqual(scene.x);
      expect(r.box.x + r.box.w).toBeLessThanOrEqual(scene.x + scene.w);
      expect(r.box.y + r.box.h).toBeLessThanOrEqual(scene.y + scene.h);
      const b = layoutClockText(scene, box, 'bottom_right', m, logoInScene, []);
      expect(b.box.y + b.box.h).toBeLessThanOrEqual(scene.y + scene.h);
    });
  }

  test('a narrow logo with wide text: the text stays inside the frame (clamped), still under the logo', () => {
    const { m } = textBox(1280, 720, 'large');
    const frame: Box = { x: 0, y: 0, w: 1280, h: 720 };
    const tiny: Box = { x: 1280 - 16 - 20, y: 16, w: 20, h: 20 };
    const r = layoutClockText(frame, { w: 300, h: 30 }, 'top_right', m, tiny, []);
    expect(r.box.x + r.box.w).toBeLessThanOrEqual(1280 - m.margin);
    expect(r.box.y).toBe(tiny.y + tiny.h + m.logoGap);
  });
});
