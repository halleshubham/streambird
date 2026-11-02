import { expect, test } from '@playwright/test';
import { AD_PLACEMENTS, adRect, adReserve, fitAd, sceneRect, sceneRectFor, shrinkEase } from '../../web-app/src/studio/ads';
import { BRAND_FILE_LIMITS, BRAND_ORIENTATIONS, BRAND_SLOTS, CANVAS_SIZE, SLOT_SPECS, aspectMismatch, sizeText, slotHelp } from '../../web-app/src/studio/brandSizes';
import { kitSetFor } from '../../web-app/src/studio/brandKitSet';
import { newsBarHeight } from '../../web-app/src/studio/compose';

// Pure checks (no browser): the "picture shrinks while an ad shows" geometry, the shared size constants and the
// rule for which set of a brand kit a stream uses. The same numbers are in studio.md for the Android port.

const SIZES: Array<[number, number]> = [
  [1280, 720],
  [1920, 1080],
  [720, 1280],
  [1080, 1920],
];
const r2 = (r: { x: number; y: number; w: number; h: number }) => ({ x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.w.toFixed(2), h: +r.h.toFixed(2) });

test.describe('scene rectangle while ads show', () => {
  test('no ad, an invisible ad or a full-screen ad leaves the picture alone', () => {
    for (const [W, H] of SIZES) {
      const whole = { x: 0, y: 0, w: W, h: H };
      expect(sceneRectFor(W, H, {})).toEqual(whole);
      expect(sceneRectFor(W, H, { lower_third: { alpha: 0 }, side_third: { alpha: 0 } })).toEqual(whole);
      expect(sceneRectFor(W, H, { full_screen: { alpha: 1 } })).toEqual(whole);
      expect(adReserve('full_screen', W, H)).toEqual({ left: 0, bottom: 0 });
    }
  });

  test('lower third: the scene scales (aspect kept) into the area above the ad band, centred horizontally', () => {
    // Landscape 1920x1080, the ad picture fills the band: 1920 x 360 at y=720 -> scene area 1920 x 720.
    const W = 1920;
    const H = 1080;
    const fitted = fitAd('lower_third', 1280, 240, adRect('lower_third', W, H));
    expect(fitted).toEqual({ x: 0, y: 720, w: 1920, h: 360 });
    const full = sceneRectFor(W, H, { lower_third: { alpha: 1, fitted } });
    expect(r2(full)).toEqual({ x: 320, y: 0, w: 1280, h: 720 }); // 2/3 scale, centred
    expect(full.w / full.h).toBeCloseTo(W / H, 6);
    expect(full.y + full.h).toBeLessThanOrEqual(fitted.y + 1e-6); // never overlaps the ad
  });

  test('lower third: a short picture (3:1) only reserves its own height, and the ticker is stood on', () => {
    const [W, H] = [1080, 1920];
    const fitted = fitAd('lower_third', 1080, 360, adRect('lower_third', W, H));
    expect(fitted).toEqual({ x: 0, y: 1560, w: 1080, h: 360 }); // bottom-anchored in the 640 px band
    const s = sceneRectFor(W, H, { lower_third: { alpha: 1, fitted } });
    expect(s.y + s.h).toBeCloseTo(1560, 6);
    expect(s.h).toBeCloseTo(1560, 6);
    expect(s.w).toBeCloseTo((1560 / 1920) * 1080, 6);
    expect(s.x + s.w / 2).toBeCloseTo(540, 6); // centred horizontally
    // With the ticker showing the ad (and so the scene) moves up by the bar.
    const bar = newsBarHeight(18);
    const liftedFit = fitAd('lower_third', 1080, 360, adRect('lower_third', W, H, bar));
    const lifted = sceneRectFor(W, H, { lower_third: { alpha: 1, fitted: liftedFit } });
    expect(lifted.y + lifted.h).toBeCloseTo(H - bar - 360, 6);
  });

  test('left third: the scene scales into the right two thirds', () => {
    for (const [W, H] of SIZES) {
      const s = sceneRectFor(W, H, { side_third: { alpha: 1 } });
      const third = adRect('side_third', W, H).w;
      expect(s.x).toBeGreaterThanOrEqual(third - 1e-6);
      expect(s.x + s.w).toBeLessThanOrEqual(W + 1e-6);
      expect(s.w / s.h).toBeCloseTo(W / H, 6);
      expect(s.x + s.w / 2).toBeCloseTo(third + (W - third) / 2, 6); // centred in the free area
    }
    expect(r2(sceneRectFor(1920, 1080, { side_third: { alpha: 1 } }))).toEqual({ x: 640, y: 180, w: 1280, h: 720 }); // centred vertically too
    // Vertical: the right two thirds of 1080 x 1920 is 720 wide -> the scene is 720 x 1280.
    expect(r2(sceneRectFor(1080, 1920, { side_third: { alpha: 1 } }))).toEqual({ x: 360, y: 320, w: 720, h: 1280 });
  });

  test('both at once: the intersection (right two thirds, above the lower third)', () => {
    const [W, H] = [1920, 1080];
    const fitted = adRect('lower_third', W, H);
    const s = sceneRectFor(W, H, { lower_third: { alpha: 1, fitted }, side_third: { alpha: 1 } });
    expect(s.x).toBeGreaterThanOrEqual(640 - 1e-6);
    expect(s.y + s.h).toBeLessThanOrEqual(720 + 1e-6);
    expect(s.w / s.h).toBeCloseTo(W / H, 6);
  });

  test('progress eases in and out in step with the fade: smoothstep, monotonic, 0 at 0 and the full size at 1', () => {
    expect(shrinkEase(0)).toBe(0);
    expect(shrinkEase(1)).toBe(1);
    expect(shrinkEase(0.5)).toBe(0.5);
    expect(shrinkEase(-3)).toBe(0);
    expect(shrinkEase(7)).toBe(1);
    let prev = -1;
    for (let a = 0; a <= 1.0001; a += 0.05) {
      const e = shrinkEase(a);
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
    // Gentle at the ends: a quarter of the fade moves less than a quarter of the way.
    expect(shrinkEase(0.25)).toBeLessThan(0.25);
    expect(shrinkEase(0.75)).toBeGreaterThan(0.75);
    // The scene shrinks continuously: at half opacity it is exactly halfway between whole and full-shrink insets.
    const [W, H] = [1920, 1080];
    const fitted = fitAd('lower_third', 1280, 240, adRect('lower_third', W, H));
    const heights = [0, 0.25, 0.5, 0.75, 1].map((a) => sceneRectFor(W, H, { lower_third: { alpha: a, fitted } }).h);
    expect(heights[0]).toBe(H);
    expect(heights[4]).toBeCloseTo(720, 6);
    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeLessThanOrEqual(heights[i - 1] + 1e-9);
    expect(heights[2]).toBeCloseTo(900, 6);
  });

  test('every rectangle stays inside the canvas, never bigger than it, at every size and progress', () => {
    for (const [W, H] of SIZES) {
      for (const p of AD_PLACEMENTS) {
        for (let a = 0; a <= 1.0001; a += 0.1) {
          const fitted = fitAd(p, 100, 100, adRect(p, W, H));
          const s = sceneRectFor(W, H, { [p]: { alpha: a, fitted } });
          expect(s.x).toBeGreaterThanOrEqual(-1e-6);
          expect(s.y).toBeGreaterThanOrEqual(-1e-6);
          expect(s.x + s.w).toBeLessThanOrEqual(W + 1e-6);
          expect(s.y + s.h).toBeLessThanOrEqual(H + 1e-6);
          expect(s.w / s.h).toBeCloseTo(W / H, 6);
        }
      }
    }
    // Degenerate insets never produce NaN or a zero-size scene.
    const odd = sceneRect(1280, 720, { left: 99999, bottom: 99999 });
    for (const v of Object.values(odd)) expect(Number.isFinite(v)).toBe(true);
    expect(odd.w).toBeGreaterThan(0);
    expect(odd.h).toBeGreaterThan(0);
  });
});

test.describe('shared size constants', () => {
  test('every orientation has every slot, with positive sizes and a range that contains the suggestion', () => {
    for (const o of BRAND_ORIENTATIONS) {
      for (const slot of BRAND_SLOTS) {
        const spec = SLOT_SPECS[o][slot];
        expect(spec.size.w).toBeGreaterThan(0);
        expect(spec.size.h).toBeGreaterThan(0);
        const ratio = spec.size.w / spec.size.h;
        expect(ratio).toBeGreaterThanOrEqual(spec.ratioMin);
        expect(ratio).toBeLessThanOrEqual(spec.ratioMax);
        expect(slotHelp(o, slot)).toContain('4 MB');
      }
    }
  });

  test('the suggestions follow the real canvas geometry in ads.ts', () => {
    // Full screen = the whole canvas; wallpaper = the canvas.
    for (const o of BRAND_ORIENTATIONS) {
      const { w, h } = CANVAS_SIZE[o];
      expect(SLOT_SPECS[o].full_screen.size).toEqual({ w, h });
      expect(SLOT_SPECS[o].wallpaper.size).toEqual({ w, h });
    }
    // Landscape lower third: area is 16:3 (1920 x 360); the suggestion is the same shape at 1280 x 240.
    const lowerL = adRect('lower_third', 1920, 1080);
    expect(SLOT_SPECS.landscape.lower_third.size.w / SLOT_SPECS.landscape.lower_third.size.h).toBeCloseTo(lowerL.w / lowerL.h, 6);
    expect(sizeText(SLOT_SPECS.landscape.lower_third)).toBe('1280 x 240');
    // Landscape left third: 640 x 1080 is exactly the area.
    const sideL = adRect('side_third', 1920, 1080);
    expect(SLOT_SPECS.landscape.side_third.size).toEqual({ w: sideL.w, h: sideL.h });
    // Vertical: a 3:1 banner inside the 1080 x 640 band; the strip is the 360 x 1920 area.
    const lowerP = adRect('lower_third', 1080, 1920);
    expect(lowerP).toMatchObject({ w: 1080, h: 640 });
    expect(SLOT_SPECS.portrait.lower_third.size.w).toBe(lowerP.w);
    expect(SLOT_SPECS.portrait.lower_third.size.h).toBeLessThanOrEqual(lowerP.h);
    const sideP = adRect('side_third', 1080, 1920);
    expect(SLOT_SPECS.portrait.side_third.size).toEqual({ w: sideP.w, h: sideP.h });
    expect(BRAND_FILE_LIMITS.maxBytes).toBe(4 * 1024 * 1024);
  });

  test('the shape warning fires for a far-off picture and stays quiet for a close one', () => {
    const wall = SLOT_SPECS.landscape.wallpaper;
    expect(aspectMismatch(1920, 1080, wall)).toBe(false);
    expect(aspectMismatch(2560, 1440, wall)).toBe(false);
    expect(aspectMismatch(1600, 1000, wall)).toBe(false); // 16:10 is close enough
    expect(aspectMismatch(1080, 1920, wall)).toBe(true); // a vertical picture in the 16:9 wallpaper slot
    expect(aspectMismatch(1000, 1000, wall)).toBe(true); // 1:1 is 1.78x away from 16:9 (limit 1.5x)
    const lower = SLOT_SPECS.landscape.lower_third;
    expect(aspectMismatch(1280, 240, lower)).toBe(false);
    expect(aspectMismatch(1920, 1080, lower)).toBe(true); // a 16:9 picture as a lower third
    expect(aspectMismatch(1080, 360, SLOT_SPECS.portrait.lower_third)).toBe(false);
    expect(aspectMismatch(1920, 1080, SLOT_SPECS.portrait.full_screen)).toBe(true);
    const logo = SLOT_SPECS.landscape.logo;
    expect(aspectMismatch(512, 512, logo)).toBe(false);
    expect(aspectMismatch(1024, 256, logo)).toBe(false); // wide logo
    expect(aspectMismatch(2000, 100, logo)).toBe(true);
    expect(aspectMismatch(0, 0, logo)).toBe(false); // unknown size: never a warning
  });
});

test.describe('which set of a brand kit a stream uses', () => {
  const kit = {
    logoAssetId: 'logo-16',
    logoAssetIdPortrait: null as string | null,
    wallpaperAssetId: 'wall-16',
    wallpaperAssetIdPortrait: null as string | null,
    ads: [{ placement: 'lower_third' as const, assetId: 'ad-16', enabled: true, mode: 'continuous' as const, showSec: null, everySec: null }],
    adsPortrait: [] as Array<{ placement: 'lower_third'; assetId: string; enabled: boolean; mode: 'continuous'; showSec: null; everySec: null }>,
  };

  test('a landscape stream uses the landscape set only', () => {
    expect(kitSetFor(kit, 'landscape')).toEqual({ logoAssetId: 'logo-16', wallpaperAssetId: 'wall-16', ads: kit.ads });
    expect(kitSetFor({ ...kit, logoAssetIdPortrait: 'logo-9', wallpaperAssetIdPortrait: 'wall-9' }, 'landscape').logoAssetId).toBe('logo-16');
  });

  test('a portrait stream uses the portrait set; only the logo falls back to landscape; wallpaper and ads do not', () => {
    const bare = kitSetFor(kit, 'portrait');
    expect(bare).toEqual({ logoAssetId: 'logo-16', wallpaperAssetId: null, ads: [] });
    const full = kitSetFor(
      { ...kit, logoAssetIdPortrait: 'logo-9', wallpaperAssetIdPortrait: 'wall-9', adsPortrait: [{ placement: 'lower_third', assetId: 'ad-9', enabled: true, mode: 'continuous', showSec: null, everySec: null }] },
      'portrait',
    );
    expect(full.logoAssetId).toBe('logo-9');
    expect(full.wallpaperAssetId).toBe('wall-9');
    expect(full.ads.map((a) => a.assetId)).toEqual(['ad-9']);
  });

  test('a kit from an older server (no portrait fields) works: portrait gets the landscape logo only', () => {
    const old = { logoAssetId: 'l', wallpaperAssetId: 'w', ads: [] } as unknown as Parameters<typeof kitSetFor>[0];
    expect(kitSetFor(old, 'portrait')).toEqual({ logoAssetId: 'l', wallpaperAssetId: null, ads: [] });
    expect(kitSetFor(old, 'landscape')).toEqual({ logoAssetId: 'l', wallpaperAssetId: 'w', ads: [] });
  });
});
