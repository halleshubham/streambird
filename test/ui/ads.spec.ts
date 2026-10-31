import { expect, test } from '@playwright/test';
import {
  AD_DRAW_ORDER,
  AD_PLACEMENTS,
  FREE_PLAN_AD_SCHEDULE,
  adRect,
  adTargetAlpha,
  adVisibility,
  describeSchedule,
  fitAd,
  resolveAdAlphas,
  scheduleError,
  splitSeconds,
  stepAlpha,
  toSeconds,
  type AdSchedule,
  type AdSlot,
} from '../../web-app/src/studio/ads';
import { AdLayer } from '../../web-app/src/studio/adLayer';
import { BRANDING_RANGES, newsBarHeight } from '../../web-app/src/studio/compose';

// Pure checks of the ad geometry and schedule (no browser). The same numbers are in the studio.md spec for the Android port.

const SIZES: Array<[number, number]> = [
  [1280, 720],
  [1920, 1080],
  [720, 1280],
  [1080, 1920],
];

const r3 = (r: { x: number; y: number; w: number; h: number }) => ({ x: +r.x.toFixed(3), y: +r.y.toFixed(3), w: +r.w.toFixed(3), h: +r.h.toFixed(3) });

test.describe('ad placement geometry', () => {
  test('lower third = bottom third, full width; side third = left third, full height; full screen = the frame', () => {
    expect(adRect('lower_third', 1280, 720)).toEqual({ x: 0, y: 480, w: 1280, h: 240 });
    expect(adRect('side_third', 1280, 720)).toEqual({ x: 0, y: 0, w: 427, h: 720 });
    expect(adRect('full_screen', 1280, 720)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    // Vertical 9:16 uses the same rules on its own W x H.
    expect(adRect('lower_third', 720, 1280)).toEqual({ x: 0, y: 853, w: 720, h: 427 });
    expect(adRect('side_third', 720, 1280)).toEqual({ x: 0, y: 0, w: 240, h: 1280 });
    expect(adRect('full_screen', 720, 1280)).toEqual({ x: 0, y: 0, w: 720, h: 1280 });
  });

  test('the lower third sits above the ticker bar (same height, moved up); the other two ignore it', () => {
    for (const [w, h] of SIZES) {
      const bar = newsBarHeight(BRANDING_RANGES.newsFontSize.default);
      const plain = adRect('lower_third', w, h, 0);
      const lifted = adRect('lower_third', w, h, bar);
      expect(lifted.h).toBe(plain.h);
      expect(lifted.y + lifted.h).toBe(h - bar);
      expect(plain.y + plain.h).toBe(h);
      expect(adRect('side_third', w, h, bar)).toEqual(adRect('side_third', w, h, 0));
      expect(adRect('full_screen', w, h, bar)).toEqual(adRect('full_screen', w, h, 0));
    }
  });

  test('every area stays inside the canvas at every size, and also with the ticker showing', () => {
    for (const [w, h] of SIZES) {
      for (const p of AD_PLACEMENTS) {
        const r = adRect(p, w, h, newsBarHeight(32));
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(w);
        expect(r.y + r.h).toBeLessThanOrEqual(h);
      }
    }
  });

  test('a picture is fitted inside its area keeping its shape; lower third is bottom-centre, the others centred', () => {
    const lower = adRect('lower_third', 1280, 720);
    // Exactly the recommended banner: fills the area.
    expect(r3(fitAd('lower_third', 1280, 240, lower))).toEqual({ x: 0, y: 480, w: 1280, h: 240 });
    // A square picture is limited by the height, centred horizontally, hugging the bottom edge.
    expect(r3(fitAd('lower_third', 100, 100, lower))).toEqual({ x: 520, y: 480, w: 240, h: 240 });
    // A short, wide picture is limited by the width and sits at the bottom of the area (not floating in the middle).
    expect(r3(fitAd('lower_third', 2000, 100, lower))).toEqual({ x: 0, y: 480 + 240 - 64, w: 1280, h: 64 });
    const side = adRect('side_third', 1280, 720);
    expect(r3(fitAd('side_third', 427, 720, side))).toEqual({ x: 0, y: 0, w: 427, h: 720 });
    expect(r3(fitAd('side_third', 100, 100, side))).toEqual({ x: 0, y: 146.5, w: 427, h: 427 }); // centred vertically
    const full = adRect('full_screen', 1280, 720);
    expect(r3(fitAd('full_screen', 100, 100, full))).toEqual({ x: 280, y: 0, w: 720, h: 720 }); // letterboxed, centred
    expect(r3(fitAd('full_screen', 640, 360, full))).toEqual({ x: 0, y: 0, w: 1280, h: 720 }); // upscaled to fit
    for (const [w, h] of SIZES) {
      for (const p of AD_PLACEMENTS) {
        const area = adRect(p, w, h);
        for (const [iw, ih] of [[1280, 240], [427, 720], [1280, 720], [50, 50], [4000, 300], [300, 4000]]) {
          const f = fitAd(p, iw, ih, area);
          expect(f.w / f.h).toBeCloseTo(iw / ih, 5);
          expect(f.x).toBeGreaterThanOrEqual(area.x - 1e-9);
          expect(f.y).toBeGreaterThanOrEqual(area.y - 1e-9);
          expect(f.x + f.w).toBeLessThanOrEqual(area.x + area.w + 1e-9);
          expect(f.y + f.h).toBeLessThanOrEqual(area.y + area.h + 1e-9);
        }
      }
    }
  });

  test('a broken picture size draws nothing', () => {
    expect(fitAd('full_screen', 0, 10, adRect('full_screen', 100, 100))).toMatchObject({ w: 0, h: 0 });
  });
});

test.describe('ad schedule', () => {
  const CONT: AdSchedule = { mode: 'continuous' };
  const SHOW10_EVERY30: AdSchedule = { mode: 'interval', showSec: 10, everySec: 30 }; // cycle 40

  test('continuous is always visible at full opacity', () => {
    for (const t of [0, 0.1, 59, 3600, 1e6]) expect(adVisibility(t, CONT)).toEqual({ visible: true, alpha: 1 });
  });

  test('interval: hidden first for everySec, then shown for showSec, repeating (cycle = everySec + showSec)', () => {
    expect(adVisibility(0, SHOW10_EVERY30)).toEqual({ visible: false, alpha: 0 });
    expect(adVisibility(29.999, SHOW10_EVERY30)).toEqual({ visible: false, alpha: 0 });
    expect(adVisibility(30, SHOW10_EVERY30)).toEqual({ visible: true, alpha: 0 }); // the window opens at exactly everySec
    expect(adVisibility(35, SHOW10_EVERY30)).toEqual({ visible: true, alpha: 1 });
    expect(adVisibility(39.999, SHOW10_EVERY30).visible).toBe(true);
    expect(adVisibility(40, SHOW10_EVERY30)).toEqual({ visible: false, alpha: 0 }); // next cycle starts hidden
    expect(adVisibility(69.9, SHOW10_EVERY30).visible).toBe(false);
    expect(adVisibility(70, SHOW10_EVERY30).visible).toBe(true);
    expect(adVisibility(75, SHOW10_EVERY30).alpha).toBe(1);
    expect(adVisibility(40 * 1000 + 35, SHOW10_EVERY30).alpha).toBe(1); // far into the stream
    expect(adVisibility(-5, SHOW10_EVERY30)).toEqual({ visible: false, alpha: 0 }); // a clock before go-live counts as 0
    expect(adVisibility(Number.NaN, SHOW10_EVERY30).visible).toBe(false);
  });

  test('300 ms fades inside the shown window: in at the start, out at the end, never a pop', () => {
    expect(adVisibility(30.15, SHOW10_EVERY30).alpha).toBeCloseTo(0.5, 6);
    expect(adVisibility(30.3, SHOW10_EVERY30).alpha).toBe(1);
    expect(adVisibility(39.7, SHOW10_EVERY30).alpha).toBeCloseTo(1, 6);
    expect(adVisibility(39.85, SHOW10_EVERY30).alpha).toBeCloseTo(0.5, 6);
    expect(adVisibility(39.99, SHOW10_EVERY30).alpha).toBeLessThan(0.05);
    // Alpha is continuous across the whole cycle: no step bigger than the fade slope allows.
    let prev = adVisibility(0, SHOW10_EVERY30).alpha;
    for (let t = 0.01; t < 120; t += 0.01) {
      const a = adVisibility(t, SHOW10_EVERY30).alpha;
      expect(Math.abs(a - prev)).toBeLessThan(0.05 + 1e-9);
      prev = a;
    }
  });

  test('a showing shorter than 600 ms fades in and out in half the time each', () => {
    const quick: AdSchedule = { mode: 'interval', showSec: 0.4, everySec: 5 };
    expect(adVisibility(5.1, quick).alpha).toBeCloseTo(0.5, 6);
    expect(adVisibility(5.2, quick).alpha).toBeCloseTo(1, 6);
    expect(adVisibility(5.3, quick).alpha).toBeCloseTo(0.5, 6);
    const oneSec: AdSchedule = { mode: 'interval', showSec: 1, everySec: 1 }; // the smallest allowed numbers
    expect(adVisibility(1.5, oneSec).alpha).toBe(1);
    expect(adVisibility(0.5, oneSec).visible).toBe(false);
    expect(adVisibility(2.5, oneSec).visible).toBe(false); // cycle 2: 2.5 is t=0.5, hidden
    expect(adVisibility(3.5, oneSec).alpha).toBe(1);
  });

  test('the Free plan StreamBird ad: 15 s shown every 180 s, hidden first', () => {
    expect(FREE_PLAN_AD_SCHEDULE).toEqual({ mode: 'interval', showSec: 15, everySec: 180 });
    expect(adVisibility(0, FREE_PLAN_AD_SCHEDULE).visible).toBe(false);
    expect(adVisibility(179.9, FREE_PLAN_AD_SCHEDULE).visible).toBe(false);
    expect(adVisibility(187, FREE_PLAN_AD_SCHEDULE).alpha).toBe(1);
    expect(adVisibility(194.9, FREE_PLAN_AD_SCHEDULE).alpha).toBeLessThan(0.5);
    expect(adVisibility(195, FREE_PLAN_AD_SCHEDULE).visible).toBe(false);
    expect(adVisibility(375 + 7, FREE_PLAN_AD_SCHEDULE).alpha).toBe(1); // second showing
  });
});

test.describe('ad priority and manual control', () => {
  const slot = (placement: AdSlot['placement'], schedule: AdSchedule, extra: Partial<AdSlot> = {}): AdSlot => ({ placement, enabled: true, schedule, ...extra });
  const CONT: AdSchedule = { mode: 'continuous' };
  const FULL_AT_30: AdSchedule = { mode: 'interval', showSec: 10, everySec: 30 };

  test('full screen hides the other two while it is visible (cross-fading at its edges); side third draws above lower third', () => {
    const slots = [slot('lower_third', CONT), slot('side_third', CONT), slot('full_screen', FULL_AT_30)];
    expect(resolveAdAlphas(10, slots)).toEqual({ lower_third: 1, side_third: 1, full_screen: 0 });
    expect(resolveAdAlphas(35, slots)).toEqual({ lower_third: 0, side_third: 0, full_screen: 1 });
    const mid = resolveAdAlphas(30.15, slots); // full screen half-faded in
    expect(mid.full_screen).toBeCloseTo(0.5, 6);
    expect(mid.lower_third).toBeCloseTo(0.5, 6);
    expect(mid.side_third).toBeCloseTo(0.5, 6);
    expect(resolveAdAlphas(45, slots)).toEqual({ lower_third: 1, side_third: 1, full_screen: 0 });
    expect(AD_DRAW_ORDER).toEqual(['lower_third', 'side_third', 'full_screen']);
  });

  test('a missing or switched-off ad is 0; manual Show now / Hide beat the schedule but not the on/off switch', () => {
    expect(resolveAdAlphas(0, [])).toEqual({ lower_third: 0, side_third: 0, full_screen: 0 });
    expect(adTargetAlpha(0, slot('lower_third', FULL_AT_30))).toBe(0); // hidden by schedule
    expect(adTargetAlpha(0, slot('lower_third', FULL_AT_30, { manual: 'shown' }))).toBe(1);
    expect(adTargetAlpha(35, slot('lower_third', FULL_AT_30, { manual: 'hidden' }))).toBe(0);
    expect(adTargetAlpha(35, slot('lower_third', CONT, { manual: null }))).toBe(1);
    expect(adTargetAlpha(35, slot('lower_third', CONT, { enabled: false, manual: 'shown' }))).toBe(0);
    // A manually shown full screen also covers the others.
    const a = resolveAdAlphas(0, [slot('lower_third', CONT), slot('full_screen', FULL_AT_30, { manual: 'shown' })]);
    expect(a).toEqual({ lower_third: 0, side_third: 0, full_screen: 1 });
  });

  test('stepAlpha fades manual changes over 300 ms', () => {
    expect(stepAlpha(0, 1, 0.15)).toBeCloseTo(0.5, 6);
    expect(stepAlpha(0.5, 1, 0.15)).toBe(1);
    expect(stepAlpha(1, 0, 0.3)).toBe(0);
    expect(stepAlpha(1, 0, 0.03)).toBeCloseTo(0.9, 6);
    expect(stepAlpha(0.4, 0.4, 1)).toBe(0.4);
    expect(stepAlpha(0, 1, -1)).toBe(0);
  });
});

test.describe('ad schedule helpers', () => {
  test('seconds <-> number + unit, wording and validation', () => {
    expect(splitSeconds(30)).toEqual({ value: 30, unit: 'sec' });
    expect(splitSeconds(60)).toEqual({ value: 1, unit: 'min' });
    expect(splitSeconds(90)).toEqual({ value: 90, unit: 'sec' });
    expect(splitSeconds(180)).toEqual({ value: 3, unit: 'min' });
    expect(toSeconds(3, 'min')).toBe(180);
    expect(toSeconds(15, 'sec')).toBe(15);
    expect(describeSchedule({ mode: 'continuous' })).toBe('Always on');
    expect(describeSchedule(FREE_PLAN_AD_SCHEDULE)).toBe('Shown for 15 sec, then hidden for 3 min');
    expect(scheduleError({ mode: 'continuous' })).toBeNull();
    expect(scheduleError({ mode: 'interval', showSec: 1, everySec: 1 })).toBeNull();
    expect(scheduleError({ mode: 'interval', showSec: 3600, everySec: 86400 })).toBeNull();
    expect(scheduleError({ mode: 'interval', showSec: 0, everySec: 10 })).toMatch(/Show time/);
    expect(scheduleError({ mode: 'interval', showSec: 3601, everySec: 10 })).toMatch(/Show time/);
    expect(scheduleError({ mode: 'interval', showSec: 10, everySec: 0 })).toMatch(/between showings/);
    expect(scheduleError({ mode: 'interval', showSec: 10, everySec: 86401 })).toMatch(/between showings/);
    expect(scheduleError({ mode: 'interval', showSec: 1.5, everySec: 10 })).toMatch(/Show time/);
  });
});

test.describe('AdLayer clock', () => {
  const g = globalThis as unknown as { window?: unknown; localStorage?: unknown };
  const withWindow = (hook: number | undefined, armed: boolean, fn: () => void) => {
    const store = new Map<string, string>(armed ? [['streambird:test:adclock', 'on']] : []);
    g.window = { __SB_TEST_AD_ELAPSED__: hook };
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null };
    try {
      fn();
    } finally {
      delete g.window;
      delete g.localStorage;
    }
  };

  test('counts seconds from the start, and a Go live restarts it at 0', () => {
    const layer = new AdLayer();
    layer.restartClock(1000);
    expect(layer.elapsedSec(4500)).toBe(3.5);
    layer.restartClock(10_000); // go live
    expect(layer.elapsedSec(10_000)).toBe(0);
    expect(layer.elapsedSec(12_000)).toBe(2);
  });

  test('the test hook is ignored unless armed, and never applies on the Free plan', () => {
    const layer = new AdLayer();
    layer.restartClock(0);
    withWindow(99, false, () => expect(layer.elapsedSec(2000)).toBe(2)); // not armed: ignored
    withWindow(99, true, () => expect(layer.elapsedSec(2000)).toBe(99)); // armed (a test)
    layer.setFreePlan(true);
    withWindow(99, true, () => expect(layer.elapsedSec(2000)).toBe(2)); // Free: the banner cannot be retimed
  });

  test('a broken saved schedule never throws', () => {
    expect(adVisibility(5, undefined as unknown as AdSchedule)).toEqual({ visible: true, alpha: 1 });
    expect(adVisibility(5, { mode: 'interval', showSec: 'x', everySec: 3 } as unknown as AdSchedule).visible).toBe(false);
  });
});
