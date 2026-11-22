import { expect, test } from '@playwright/test';
import {
  AD_DWELL_DEFAULT,
  AD_DWELL_RANGE,
  MAX_ADS_PER_PLACEMENT,
  adPriorityFactors,
  adSequenceState,
  adSequenceTargets,
  adVisibility,
  newSeqState,
  resolveAdAlphas,
  type AdPlacement,
  type SeqAd,
  type SeqSchedule,
} from '../../web-app/src/studio/ads';
import { kitAdSequence, kitSetFor } from '../../web-app/src/studio/brandKitSet';
import { adOffWarning, offAdPlacements } from '../../web-app/src/studio/adOff';
import type { BrandKit, BrandKitAd } from '../../web-app/src/types/api';

// The ad-sequence scheduler (several ads of one placement, played in turn): pure, no browser. The Android app ports these rules 1:1
// (studio.md "Ad sequences contract").

const on = (showSec: number): SeqAd => ({ enabled: true, showSec });
const off = (showSec: number): SeqAd => ({ enabled: false, showSec });
const INTERVAL = (everySec: number): SeqSchedule => ({ mode: 'interval', everySec });
const CONT: SeqSchedule = { mode: 'continuous' };
const at = (t: number, ads: SeqAd[], sch: SeqSchedule) => adSequenceState(t, ads, sch, ads.length, newSeqState());

test.describe('ad sequence scheduler: one ad is exactly the old schedule', () => {
  test('interval: same visibility and alpha as adVisibility for every moment of three cycles', () => {
    const ads = [on(15)];
    let wrong = 0;
    for (let t = 0; t < 600; t += 0.05) {
      const s = at(t, ads, INTERVAL(180));
      const old = adVisibility(t, { mode: 'interval', showSec: 15, everySec: 180 });
      if (s.visible !== old.visible || Math.abs(s.alpha - old.alpha) > 1e-9 || s.index !== 0 || s.from !== -1) wrong++;
    }
    expect(wrong).toBe(0);
  });

  test('continuous: always on at alpha 1, whatever the clock', () => {
    for (const t of [-5, 0, 0.1, 19.9, 20, 1234.5]) {
      expect(at(t, [on(20)], CONT)).toMatchObject({ index: 0, alpha: 1, visible: true, from: -1 });
    }
  });
});

test.describe('ad sequence scheduler: now and then (round-robin)', () => {
  // every 100 s, ads shown 10 / 20 / 30 s: cycles 110 / 120 / 130 s, one round = 360 s.
  const ads = [on(10), on(20), on(30)];
  const s = (t: number) => at(t, ads, INTERVAL(100));

  test('each time the show window comes round the NEXT ad shows, and the round repeats', () => {
    expect(s(50)).toMatchObject({ index: 0, visible: false, alpha: 0 }); // hidden part of ad 1's cycle: ad 1 is the one that shows next
    expect(s(105)).toMatchObject({ index: 0, visible: true, alpha: 1 });
    expect(s(112)).toMatchObject({ index: 1, visible: false }); // ad 2's cycle began at 110
    expect(s(215)).toMatchObject({ index: 1, visible: true, alpha: 1 }); // 110 + 100 + 5
    expect(s(235)).toMatchObject({ index: 2, visible: false });
    expect(s(335)).toMatchObject({ index: 2, visible: true, alpha: 1 });
    expect(s(359.9).index).toBe(2);
    expect(s(360)).toMatchObject({ index: 0, visible: false }); // round 2 starts with ad 1 again
    expect(s(360 + 105)).toMatchObject({ index: 0, visible: true });
    expect(s(360 + 215)).toMatchObject({ index: 1, visible: true });
  });

  test('every ad has its own show time and fades like a single ad (300 ms in and out)', () => {
    expect(s(100.15).alpha).toBeCloseTo(0.5, 6); // half-way through ad 1's fade in
    expect(s(109.85).alpha).toBeCloseTo(0.5, 6); // and out
    expect(s(205).alpha).toBe(0); // ad 2: its hidden part (110..210)
    expect(s(210.15).alpha).toBeCloseTo(0.5, 6); // its 20 s show window (210..230)
    expect(s(229.85).alpha).toBeCloseTo(0.5, 6);
    expect(s(230 + 100 + 15).alpha).toBe(1); // ad 3 holds at 1 for its 30 s
  });

  test('seconds left count down to the next flip of the current ad', () => {
    expect(s(40).secondsLeft).toBe(60); // hidden until 100
    expect(s(104).secondsLeft).toBe(6); // shown until 110
    expect(s(115).secondsLeft).toBe(95); // ad 2 hidden until 210
  });

  test('disabled ads are skipped; all disabled = nothing is on', () => {
    const skip = [on(10), off(20), on(30)]; // cycles 110 / 130, round 240
    expect(at(120, skip, INTERVAL(100)).index).toBe(2); // ad 2 is skipped: ad 3's cycle follows ad 1's
    expect(at(240 + 5, skip, INTERVAL(100)).index).toBe(0);
    expect(at(5, [off(10), off(20)], INTERVAL(100))).toMatchObject({ index: -1, alpha: 0, visible: false });
    expect(at(5, [], CONT).index).toBe(-1);
    // One enabled ad among several behaves like a single ad (its own show time).
    for (let t = 0; t < 400; t += 0.5) {
      const one = at(t, [off(10), on(15), off(5)], INTERVAL(180));
      const old = adVisibility(t, { mode: 'interval', showSec: 15, everySec: 180 });
      expect(one.index).toBe(1);
      expect(one.visible).toBe(old.visible);
      expect(one.alpha).toBeCloseTo(old.alpha, 9);
    }
  });
});

test.describe('ad sequence scheduler: always on (dwell + cross-fade)', () => {
  const ads = [on(20), on(20), on(20)];
  const s = (t: number) => at(t, ads, CONT);

  test('each ad is shown for its own seconds, then the next; the round repeats', () => {
    expect(s(10)).toMatchObject({ index: 0, alpha: 1, from: -1 });
    expect(s(30)).toMatchObject({ index: 1, alpha: 1 });
    expect(s(50)).toMatchObject({ index: 2, alpha: 1 });
    expect(s(70)).toMatchObject({ index: 0, alpha: 1 });
    const uneven = [on(5), on(300), on(7)];
    expect(at(4, uneven, CONT).index).toBe(0);
    expect(at(6, uneven, CONT).index).toBe(1);
    expect(at(305, uneven, CONT).index).toBe(2);
    expect(at(312, uneven, CONT).index).toBe(0);
  });

  test('a change is a cross-fade: the new ad fades in while the old one fades out, alphas sum to 1', () => {
    for (const dt of [0.03, 0.15, 0.27]) {
      const st = s(20 + dt);
      expect(st.index).toBe(1);
      expect(st.from).toBe(0);
      expect(st.alpha + st.fromAlpha).toBeCloseTo(1, 9);
      expect(st.alpha).toBeCloseTo(dt / 0.3, 6);
    }
    expect(s(20.15).alpha).toBeCloseTo(0.5, 6);
    expect(s(20.3)).toMatchObject({ index: 1, alpha: 1, from: -1 });
    // The wrap from the last ad to the first fades the same way.
    const w = s(60 + 0.15);
    expect(w).toMatchObject({ index: 0, from: 2 });
    expect(w.alpha).toBeCloseTo(0.5, 6);
  });

  test('the start of the stream shows the first ad at once (no fade-in from the last one)', () => {
    expect(s(0)).toMatchObject({ index: 0, alpha: 1, from: -1 });
    expect(s(0.1)).toMatchObject({ index: 0, alpha: 1, from: -1 });
    expect(s(-3)).toMatchObject({ index: 0, alpha: 1 });
  });

  test('disabled ads are skipped, and a missing or broken time counts as the default 20 s', () => {
    const skip = [on(20), off(20), on(20)];
    expect(at(25, skip, CONT).index).toBe(2);
    expect(at(45, skip, CONT).index).toBe(0);
    const broken = [on(0), on(Number.NaN)];
    expect(at(10, broken, CONT).index).toBe(0);
    expect(at(25, broken, CONT).index).toBe(1);
    expect(AD_DWELL_DEFAULT).toBe(20);
    expect(AD_DWELL_RANGE).toEqual({ min: 5, max: 300 });
    expect(MAX_ADS_PER_PLACEMENT).toBe(5);
  });

  test('a very short dwell still cross-fades without gaps (fade = half the dwell at most)', () => {
    const quick = [on(0.4), on(0.4)];
    const st = at(0.5, quick, CONT);
    expect(st.index).toBe(1);
    expect(st.alpha + st.fromAlpha).toBeCloseTo(1, 9);
  });
});

test.describe('ad sequence targets: manual Show / Hide act on the placement', () => {
  const ads = [on(10), on(20), on(30)];
  const out = [0, 0, 0, 0, 0];
  const targets = (t: number, sch: SeqSchedule, manual: 'shown' | 'hidden' | null, list = ads) => {
    const sum = adSequenceTargets(t, list, list.length, sch, manual, out, newSeqState());
    return { sum, out: out.slice(0, list.length) };
  };

  test('following the schedule: only the current ad has an alpha; the placement alpha is min(1, sum)', () => {
    expect(targets(50, INTERVAL(100), null)).toEqual({ sum: 0, out: [0, 0, 0] });
    expect(targets(105, INTERVAL(100), null)).toEqual({ sum: 1, out: [1, 0, 0] });
    const x = targets(20.15, CONT, null, [on(20), on(20)]);
    expect(x.out[0]).toBeCloseTo(0.5, 6);
    expect(x.out[1]).toBeCloseTo(0.5, 6);
    expect(x.sum).toBeCloseTo(1, 6);
  });

  test('Hide hides the whole placement; Show now shows the current/next ad (also while the schedule is hidden)', () => {
    expect(targets(105, INTERVAL(100), 'hidden')).toEqual({ sum: 0, out: [0, 0, 0] });
    expect(targets(50, INTERVAL(100), 'shown')).toEqual({ sum: 1, out: [1, 0, 0] }); // hidden part of ad 1's cycle: ad 1 is the next
    expect(targets(150, INTERVAL(100), 'shown')).toEqual({ sum: 1, out: [0, 1, 0] }); // in ad 2's hidden part: ad 2
    expect(targets(50, CONT, 'hidden', ads).sum).toBe(0);
    expect(targets(5, CONT, 'shown', ads).out).toEqual([1, 0, 0]); // always on: manual "shown" is the rotation as it is
  });

  test('no enabled ad: nothing shows, manual or not', () => {
    expect(targets(5, CONT, 'shown', [off(20)]).sum).toBe(0);
    expect(targets(5, INTERVAL(10), null, [off(20), off(20)]).out).toEqual([0, 0]);
  });
});

test.describe('ad sequence priority and kit helpers', () => {
  const A: AdPlacement[] = ['lower_third', 'side_third', 'full_screen', 'l_shape'];

  test('priority factors give exactly what resolveAdAlphas does (full_screen > l_shape > thirds)', () => {
    const slot = (placement: AdPlacement, manual: 'shown' | null = null) => ({ placement, enabled: true, schedule: { mode: 'continuous' } as const, manual });
    const combos: AdPlacement[][] = [[], ['lower_third', 'side_third'], ['lower_third', 'side_third', 'l_shape'], ['lower_third', 'side_third', 'l_shape', 'full_screen'], ['full_screen', 'l_shape']];
    for (const on of combos) {
      const own = Object.fromEntries(A.map((p) => [p, on.includes(p) ? 1 : 0])) as Record<AdPlacement, number>;
      const f = adPriorityFactors(own);
      const resolved = resolveAdAlphas(0, on.map((p) => slot(p)));
      for (const p of A) expect(own[p] * f[p]).toBe(resolved[p]);
    }
    expect(adPriorityFactors({ lower_third: 1, side_third: 1, full_screen: 0.5, l_shape: 1 })).toEqual({ lower_third: 0.5 * (1 - 0.5), side_third: 0.5 * (1 - 0.5), full_screen: 1, l_shape: 0.5 });
  });

  const ad = (placement: BrandKitAd['placement'], assetId: string): BrandKitAd => ({ placement, assetId, enabled: true, mode: 'continuous', showSec: null, everySec: null });
  const kit = {
    logoAssetId: null,
    logoAssetIdPortrait: null,
    wallpaperAssetId: null,
    wallpaperAssetIdPortrait: null,
    ads: [ad('l_shape', 'a1'), ad('lower_third', 'b1')],
    adsMore: [ad('l_shape', 'a2'), ad('l_shape', 'a3')],
    adsPortrait: [ad('l_shape', 'p1')],
    adsMorePortrait: [ad('l_shape', 'p2')],
  } as unknown as BrandKit;

  test('a kit placement plays its first ad then the further ones, per orientation; an older server (no adsMore) still works', () => {
    expect(kitAdSequence(kit, 'landscape', 'l_shape').map((a) => a.assetId)).toEqual(['a1', 'a2', 'a3']);
    expect(kitAdSequence(kit, 'landscape', 'lower_third').map((a) => a.assetId)).toEqual(['b1']);
    expect(kitAdSequence(kit, 'landscape', 'full_screen')).toEqual([]);
    expect(kitAdSequence(kit, 'portrait', 'l_shape').map((a) => a.assetId)).toEqual(['p1', 'p2']);
    expect(kitAdSequence(kit, 'portrait', 'lower_third')).toEqual([]); // no fallback to the landscape set
    const old = { ...kit, adsMore: undefined, adsMorePortrait: undefined } as unknown as BrandKit;
    expect(kitAdSequence(old, 'landscape', 'l_shape').map((a) => a.assetId)).toEqual(['a1']);
    expect(kitSetFor(old, 'portrait').ads.map((a) => a.assetId)).toEqual(['p1']);
    expect(Object.keys(kitSetFor(old, 'portrait')).sort()).toEqual(['ads', 'logoAssetId', 'wallpaperAssetId']); // the set shape is unchanged
    // A further ad without a first ad is not played.
    const orphan = { ...kit, ads: [], adsMore: [ad('l_shape', 'z')] } as unknown as BrandKit;
    expect(kitAdSequence(orphan, 'landscape', 'l_shape')).toEqual([]);
  });

  test('switched-off wording: per ad number, and a placement is off only when every ad of it is', () => {
    expect(adOffWarning('l_shape')).toBe('L-shaped frame is switched off: tick On to use it');
    expect(adOffWarning('l_shape', 1)).toBe('L-shaped frame is switched off: tick On to use it');
    expect(adOffWarning('l_shape', 2)).toBe('L-shaped frame ad 2 is switched off: tick On to use it');
    const a = (enabled: boolean) => ({ hasMedia: true, enabled });
    expect(offAdPlacements({ l_shape: a(false) })).toEqual(['l_shape']); // a single ad: as before
    expect(offAdPlacements({ l_shape: { ...a(false), more: [a(true)] } })).toEqual([]); // another ad of the sequence is on
    expect(offAdPlacements({ l_shape: { ...a(false), more: [a(false)] }, lower_third: a(true) })).toEqual(['l_shape']);
    expect(offAdPlacements({ l_shape: { hasMedia: false, enabled: false, more: [] } })).toEqual([]);
  });
});
