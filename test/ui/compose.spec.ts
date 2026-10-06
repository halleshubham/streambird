import { expect, test } from '@playwright/test';
import {
  BRANDING_RANGES,
  LAYOUTS,
  LAYOUT_BY_ID,
  THEMES,
  WALLPAPER_RANGES,
  aspectLabel,
  canvasSizeFor,
  computeLayout,
  coverCrop,
  describeWallpaperFit,
  getTheme,
  isFramedLayout,
  isLayoutId,
  newsBarHeight,
  orderPeople,
  type Rect,
} from '../../web-app/src/studio/compose';

// Pure geometry and registry checks for the studio canvas (no browser involved).

const LANDSCAPE_SIZES: [number, number][] = [
  [640, 360],
  [1280, 720],
  [1920, 1080],
];
// The same qualities for a vertical (9:16) stream.
const PORTRAIT_SIZES: [number, number][] = LANDSCAPE_SIZES.map(([w, h]) => [h, w]);
const SIZES: [number, number][] = [...LANDSCAPE_SIZES, ...PORTRAIT_SIZES];
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r: Rect, w: number, h: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h && r.w > 0 && r.h > 0;

test.describe('layouts', () => {
  const framed = LAYOUTS.filter((l) => isFramedLayout(l.id));

  test('cover the four show types, with at least 10 framed layouts plus the two classic ones', () => {
    expect(framed.length).toBeGreaterThanOrEqual(10);
    expect(new Set(framed.map((l) => l.group))).toEqual(new Set(['Podcast', 'Podcast + slides', 'Anchor + slides', 'Panel + slides']));
    expect(LAYOUTS.filter((l) => l.group === 'Classic').map((l) => l.id)).toEqual(['grid', 'spotlight']);
    expect(new Set(LAYOUTS.map((l) => l.id)).size).toBe(LAYOUTS.length);
    // 1 host + 1 guest, with and without a slideshow; an anchor with slides; 1 host + 3 guests with slides.
    expect(framed.filter((l) => l.group === 'Podcast').every((l) => l.maxPeople === 2 && !l.hasSlide)).toBe(true);
    expect(framed.filter((l) => l.group === 'Podcast + slides').every((l) => l.maxPeople === 2 && l.hasSlide)).toBe(true);
    expect(framed.filter((l) => l.group === 'Anchor + slides').every((l) => l.maxPeople === 1 && l.hasSlide)).toBe(true);
    expect(framed.filter((l) => l.group === 'Panel + slides').every((l) => l.maxPeople === 4 && l.hasSlide)).toBe(true);
  });

  for (const layout of framed) {
    test(`${layout.id}: tiles fit the canvas at every resolution and do not collide`, () => {
      for (const [w, h] of SIZES) {
        const geo = computeLayout(layout.id, w, h);
        expect(geo.people.length).toBe(layout.maxPeople);
        expect(!!geo.slide).toBe(layout.hasSlide);
        const all = [...(geo.slide ? [geo.slide] : []), ...geo.people];
        for (const rect of all) expect(inside(rect, w, h), `${layout.id} ${w}x${h} ${JSON.stringify(rect)}`).toBe(true);
        // Inset ("pip") layouts put small tiles over a large one on purpose; every other layout is collision-free.
        const insetLayout = layout.id.endsWith('-pip');
        for (let i = 0; i < all.length; i++) {
          for (let j = i + 1; j < all.length; j++) {
            if (insetLayout) continue;
            expect(overlaps(all[i], all[j]), `${layout.id} ${w}x${h}: ${i} overlaps ${j}`).toBe(false);
          }
        }
        // Slides hug a 16:9 shape, except in a vertical frame where an inset layout gives the slide the whole card.
        if (geo.slide && !(h > w && layout.id.endsWith('-pip'))) expect(Math.abs(geo.slide.w / geo.slide.h - 16 / 9)).toBeLessThan(0.02);
      }
    });
  }

  test('inset layouts: the small tiles sit inside the frame they overlay, one gutter from its corner', () => {
    for (const [w, h] of SIZES) {
      const within = (inner: Rect, outer: Rect) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
      const pip = computeLayout('podcast-pip', w, h);
      expect(within(pip.people[1], pip.people[0])).toBe(true);
      for (const id of ['pod-slide-pip', 'anchor-pip'] as const) {
        const geo = computeLayout(id, w, h);
        for (const tile of geo.people) expect(within(tile, geo.slide!), `${id} ${w}x${h}`).toBe(true);
      }
      const two = computeLayout('pod-slide-pip', w, h).people;
      expect(two[0].x + two[0].w).toBeLessThanOrEqual(two[1].x); // the two insets don't overlap each other
    }
  });

  test('the classic layouts have no fixed geometry (they keep their own drawing)', () => {
    expect(computeLayout('grid', 1280, 720)).toEqual({ slide: null, people: [] });
    expect(isFramedLayout('grid')).toBe(false);
    expect(isFramedLayout('spotlight')).toBe(false);
  });

  test('orderPeople: host first, screen share handled by the caller; podcast-pip puts the guest (or pinned) large', () => {
    const e = [{ id: 'g1' }, { id: 'local' }, { id: 'g2' }];
    expect(orderPeople('podcast-split', e, null).map((x) => x.id)).toEqual(['local', 'g1', 'g2']);
    expect(orderPeople('podcast-pip', e, null).map((x) => x.id)).toEqual(['g1', 'local', 'g2']);
    expect(orderPeople('podcast-pip', e, 'g2').map((x) => x.id)).toEqual(['g2', 'local', 'g1']);
    expect(orderPeople('podcast-pip', [{ id: 'local' }], null).map((x) => x.id)).toEqual(['local']);
    // A screen share never takes a person's tile or the large one: it goes last.
    const withShare = [{ id: 'local' }, { id: 'screen-share' }, { id: 'g1' }];
    expect(orderPeople('podcast-split', withShare, null).map((x) => x.id)).toEqual(['local', 'g1', 'screen-share']);
    expect(orderPeople('podcast-pip', withShare, null).map((x) => x.id)).toEqual(['g1', 'local', 'screen-share']);
  });

  test('layout ids are validated (a stale saved layout is ignored)', () => {
    expect(isLayoutId('grid')).toBe(true);
    expect(isLayoutId('anchor-pip')).toBe(true);
    expect(isLayoutId('nope')).toBe(false);
    expect(isLayoutId(undefined)).toBe(false);
    expect(Object.keys(LAYOUT_BY_ID).length).toBe(LAYOUTS.length);
  });
});

test.describe('canvas styles', () => {
  test('at least 10 styles beyond the vanilla look, across news, healthcare, technology, education and legal', () => {
    const extra = THEMES.filter((t) => t.id !== 'vanilla');
    expect(extra.length).toBeGreaterThanOrEqual(10);
    expect(new Set(extra.map((t) => t.group))).toEqual(new Set(['News', 'Healthcare', 'Technology', 'Education', 'Legal']));
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
  });

  test('vanilla is the original look: plain black, the original accent, the original ticker', () => {
    const v = getTheme('vanilla');
    expect(v.bg).toEqual(['#000000', '#000000']);
    expect(v.pattern).toBe('none');
    expect(v.accent).toBe('#7c3aed');
    expect(v.accent2).toBe('#ec4899');
    expect(v.tickerBg).toBe('rgba(0,0,0,0.65)');
    expect(getTheme('does-not-exist').id).toBe('vanilla');
    expect(getTheme(null).id).toBe('vanilla');
  });

  test('patterns stay subtle (low alpha)', () => {
    for (const t of THEMES.filter((x) => x.pattern !== 'none')) {
      const alpha = Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(t.patternColor)?.[1]);
      expect(alpha, t.id).toBeGreaterThan(0);
      expect(alpha, t.id).toBeLessThanOrEqual(0.15);
    }
  });
});

test.describe('branding ranges', () => {
  test('keep the original defaults and widen the range', () => {
    expect(BRANDING_RANGES.logoSize.default).toBe(90);
    expect(BRANDING_RANGES.nameFontSize.default).toBe(14);
    expect(BRANDING_RANGES.newsFontSize.default).toBe(18);
    expect(BRANDING_RANGES.logoSize.max).toBeGreaterThan(240); // was 240
    expect(BRANDING_RANGES.nameFontSize.max).toBeGreaterThan(48); // was 48
    expect(BRANDING_RANGES.newsFontSize.max).toBeGreaterThan(18); // was fixed at 18
  });

  test('the ticker bar is the original 36px at the original text size and grows with it', () => {
    expect(newsBarHeight(18)).toBe(36);
    expect(newsBarHeight(12)).toBe(36);
    expect(newsBarHeight(60)).toBeGreaterThan(100);
  });
});

test.describe('wallpaper', () => {
  test('coverCrop: an exact-size image is untouched, anything else fills the frame and crops the overflow', () => {
    expect(coverCrop(1920, 1080, 1920, 1080)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080 });
    // 4:3 into 16:9: full width kept, 900 of 1200 rows kept.
    expect(coverCrop(1600, 1200, 1280, 720)).toEqual({ sx: 0, sy: 150, sw: 1600, sh: 900 });
    expect(coverCrop(1600, 1200, 1280, 720, 50, 0).sy).toBe(0);
    expect(coverCrop(1600, 1200, 1280, 720, 50, 100).sy).toBe(300);
    // Wider than 16:9: full height kept, the sides are cropped.
    const wide = coverCrop(2400, 900, 1280, 720, 0, 50);
    expect(wide).toEqual({ sx: 0, sy: 0, sw: 1600, sh: 900 });
    expect(coverCrop(2400, 900, 1280, 720, 100, 50).sx).toBe(800);
  });

  test('coverCrop never reads outside the image, whatever the focus', () => {
    for (const [sw, sh] of [[640, 360], [1000, 1000], [3000, 500], [500, 3000], [1920, 1080]] as const) {
      for (const f of [-20, 0, 33, 50, 100, 250]) {
        const c = coverCrop(sw, sh, 1280, 720, f, f);
        expect(c.sx).toBeGreaterThanOrEqual(0);
        expect(c.sy).toBeGreaterThanOrEqual(0);
        expect(c.sx + c.sw).toBeLessThanOrEqual(sw + 1e-6);
        expect(c.sy + c.sh).toBeLessThanOrEqual(sh + 1e-6);
        // The crop has the canvas's shape, so the result is never stretched.
        expect(Math.abs(c.sw / c.sh - 1280 / 720)).toBeLessThan(0.001);
      }
    }
  });

  test('describeWallpaperFit tells the host exactly what will happen', () => {
    const exact = describeWallpaperFit(1920, 1080, 1920, 1080);
    expect(exact.exact).toBe(true);
    expect(exact.message).toMatch(/Perfect fit/);

    const scaled = describeWallpaperFit(3840, 2160, 1920, 1080);
    expect(scaled).toMatchObject({ exact: false, crop: 'none', upscaled: false });
    expect(scaled.message).toMatch(/Nothing is cropped/);

    const wide = describeWallpaperFit(2400, 900, 1280, 720);
    expect(wide.crop).toBe('sides');
    expect(wide.kept).toBeCloseTo(0.667, 2);
    expect(wide.message).toMatch(/left and right are cropped \(67% of the width stays\)/);
    expect(wide.message).toMatch(/provide 1280x720/);

    const tall = describeWallpaperFit(1600, 1200, 1280, 720);
    expect(tall.crop).toBe('top-bottom');
    expect(tall.message).toMatch(/top and bottom are cropped \(75% of the height stays\)/);

    const small = describeWallpaperFit(640, 360, 1920, 1080);
    expect(small.upscaled).toBe(true);
    expect(small.message).toMatch(/enlarged and may look soft/);
  });

  test('ranges: focus is 0-100 centred by default, dim starts at 0 so a new wallpaper is shown as it is', () => {
    expect(WALLPAPER_RANGES.focus).toEqual({ min: 0, max: 100, default: 50 });
    expect(WALLPAPER_RANGES.dim.default).toBe(0);
  });
});

test.describe('vertical (9:16) streams', () => {
  test('canvasSizeFor swaps width and height for portrait only', () => {
    expect(canvasSizeFor({ width: 1280, height: 720 }, 'landscape')).toEqual({ width: 1280, height: 720 });
    expect(canvasSizeFor({ width: 1280, height: 720 }, undefined)).toEqual({ width: 1280, height: 720 });
    expect(canvasSizeFor({ width: 1280, height: 720 }, 'portrait')).toEqual({ width: 720, height: 1280 });
    expect(canvasSizeFor({ width: 1920, height: 1080 }, 'portrait')).toEqual({ width: 1080, height: 1920 });
  });

  test('aspectLabel names the shapes', () => {
    expect(aspectLabel(1280, 720)).toBe('16:9');
    expect(aspectLabel(720, 1280)).toBe('9:16');
    expect(aspectLabel(1000, 1000)).toBe('1000:1000');
  });

  test('every framed layout stacks rather than going side by side in a portrait frame', () => {
    for (const layout of LAYOUTS.filter((l) => isFramedLayout(l.id))) {
      const geo = computeLayout(layout.id, 1080, 1920);
      // Nothing in a vertical frame is wider than the frame, and the slide (if any) is above or below the people.
      for (const t of geo.people) expect(t.w).toBeLessThanOrEqual(1080);
      if (geo.slide && !layout.id.endsWith('-pip')) {
        const slide = geo.slide;
        for (const t of geo.people) expect(t.y >= slide.y + slide.h || t.y + t.h <= slide.y, `${layout.id}`).toBe(true);
      }
    }
  });

  test('a wallpaper for a vertical stream is judged against the vertical canvas', () => {
    expect(describeWallpaperFit(720, 1280, 720, 1280).message).toMatch(/Perfect fit/);
    expect(describeWallpaperFit(1440, 2560, 720, 1280).message).toMatch(/Right shape \(9:16\)/);
    const landscapeImage = describeWallpaperFit(1920, 1080, 720, 1280);
    expect(landscapeImage.crop).toBe('sides');
    expect(landscapeImage.message).toMatch(/provide 720x1280/);
  });
});
