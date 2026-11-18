import { expect, test } from '@playwright/test';
import { newsBarHeight } from '../../web-app/src/studio/compose';
import { poweredByBox } from '../../web-app/src/studio/poweredBy';
import {
  CLOCK_POSITIONS,
  CLOCK_SIZES,
  DEFAULT_CLOCK,
  clockFromKit,
  clockMetrics,
  formatClock,
  isValidTimeZone,
  kitPatchFromClock,
  layoutClock,
  normalizeClock,
  type Box,
  type ClockPosition,
  type ClockSettings,
} from '../../web-app/src/studio/clock';

// Pure checks for the on-air date and time (settings, text, layout). No browser involved.

const NOV18_0934 = Date.UTC(2026, 10, 18, 9, 34, 5); // Wed 18 Nov 2026, 09:34:05 UTC = 15:04:05 in India
const s = (over: Partial<ClockSettings> = {}): ClockSettings => ({ ...DEFAULT_CLOCK, enabled: true, ...over });

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

test.describe('clock settings', () => {
  test('defaults match the brand kit defaults: off, top right, 12 hour, date on, no seconds, device zone, medium', () => {
    expect(DEFAULT_CLOCK).toEqual({ enabled: false, position: 'top_right', format: '12h', showDate: true, showSeconds: false, timezone: null, size: 'medium' });
    expect(normalizeClock(undefined)).toEqual(DEFAULT_CLOCK);
    expect(normalizeClock(null)).toEqual(DEFAULT_CLOCK);
  });
  test('garbage falls back field by field; good values are kept', () => {
    expect(normalizeClock({ enabled: 'yes', position: 'middle', format: '36h', showDate: 3, showSeconds: 'x', timezone: 'Nope/Nope', size: 'huge' })).toEqual(DEFAULT_CLOCK);
    const good = { enabled: true, position: 'bottom_left', format: '24h', showDate: false, showSeconds: true, timezone: 'Asia/Kolkata', size: 'large' };
    expect(normalizeClock(good)).toEqual(good);
  });
  test('a kit maps to settings and back; an old kit without the fields is the default (off)', () => {
    expect(clockFromKit({})).toEqual(DEFAULT_CLOCK);
    const kit = { clockEnabled: true, clockPosition: 'bottom_right', clockFormat: '24h', clockShowDate: false, clockShowSeconds: true, clockTimezone: 'UTC', clockSize: 'small' };
    const c = clockFromKit(kit);
    expect(c).toEqual({ enabled: true, position: 'bottom_right', format: '24h', showDate: false, showSeconds: true, timezone: 'UTC', size: 'small' });
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
  const m = clockMetrics(w, h, size);
  return { m, pill: { w: Math.round(m.fontPx * 0.6 * wide + m.padX * 2), h: Math.round(m.fontPx * 1.2 + m.padY * 2) } };
};

test.describe('clock layout', () => {
  test('text height is 2.2 / 3 / 4.2 percent of the short side (the height on a 16:9 stream, the width on a vertical one)', () => {
    expect(clockMetrics(1280, 720, 'small').fontPx).toBe(Math.round(720 * 0.022));
    expect(clockMetrics(1280, 720, 'medium').fontPx).toBe(Math.round(720 * 0.03));
    expect(clockMetrics(1280, 720, 'large').fontPx).toBe(Math.round(720 * 0.042));
    // A vertical stream is as wide as a 720p stream is high: same text size, so it stays inside the narrow frame.
    expect(clockMetrics(720, 1280, 'medium').fontPx).toBe(clockMetrics(1280, 720, 'medium').fontPx);
    expect(clockMetrics(720, 1280, 'large').margin).toBe(clockMetrics(1280, 720, 'large').margin);
    expect(clockMetrics(1280, 720, 'medium').margin).toBe(16); // the logo's margin
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
