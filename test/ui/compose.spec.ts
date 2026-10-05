import { expect, test } from '@playwright/test';
import {
  BRANDING_RANGES,
  LAYOUTS,
  LAYOUT_BY_ID,
  THEMES,
  computeLayout,
  getTheme,
  isFramedLayout,
  isLayoutId,
  newsBarHeight,
  orderPeople,
  type Rect,
} from '../../web-app/src/studio/compose';

// Pure geometry and registry checks for the studio canvas (no browser involved).

const SIZES: [number, number][] = [
  [640, 360],
  [1280, 720],
  [1920, 1080],
];
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
        if (geo.slide) expect(Math.abs(geo.slide.w / geo.slide.h - 16 / 9)).toBeLessThan(0.02);
      }
    });
  }

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
