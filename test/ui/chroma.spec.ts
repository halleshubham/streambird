import { expect, test } from '@playwright/test';
import {
  CHROMA_RANGES,
  DEFAULT_CHROMA,
  KEY_PRESETS,
  chromaAlpha,
  chromaParams,
  hexToRgb,
  isHexColor,
  normalizeChroma,
  personAlpha,
  personParams,
  rgbToHex,
  smoothMask,
  type ChromaSettings,
} from '../../web-app/src/studio/chromaKey';

// The green-screen maths (no browser involved). The fragment shader must agree with chromaAlpha; the browser test
// in smoke.spec.ts checks the real shader on real pixels.

const on = (over: Partial<ChromaSettings> = {}): ChromaSettings => ({ ...DEFAULT_CHROMA, enabled: true, ...over });
const GREEN_SHADES: [number, number, number][] = [
  [0, 177, 64], // the key itself
  [0, 136, 0], // the fake test camera's wall
  [68, 255, 28], // a bright, over-exposed patch
  [30, 150, 70], // a lit part of the screen
  [10, 90, 35], // a shadowed part of the screen (darker, same hue)
];
const KEPT: Record<string, [number, number, number]> = {
  skin: [224, 172, 105],
  darkSkin: [141, 85, 36],
  white: [255, 255, 255],
  black: [0, 0, 0],
  grey: [128, 128, 128],
  red: [200, 30, 30],
  blue: [30, 60, 200],
  yellowShirt: [240, 200, 40],
};

test.describe('chroma key maths', () => {
  test('every shade of the green screen is removed, with the default settings', () => {
    for (const rgb of GREEN_SHADES) expect(chromaAlpha(rgb, on()), `green ${rgb}`).toBeLessThan(0.05);
  });

  test('people and everyday colours are kept (skin, hair, white, black, grey, reds, blues, yellow)', () => {
    for (const [name, rgb] of Object.entries(KEPT)) expect(chromaAlpha(rgb, on()), name).toBeGreaterThan(0.95);
  });

  test('the key colour itself is always fully removed, and a colour far from it (magenta) is kept while the removal is not extreme', () => {
    for (const similarity of [0, 20, 50, 80, 100]) {
      for (const smoothness of [0, 10, 40, 100]) {
        const s = on({ similarity, smoothness });
        expect(chromaAlpha(hexToRgb(s.keyColor), s), `key at ${similarity}/${smoothness}`).toBeLessThanOrEqual(0.0001);
        if (similarity <= 50) expect(chromaAlpha([200, 60, 190], s), `magenta at ${similarity}/${smoothness}`).toBeGreaterThan(0.95);
      }
    }
  });

  test('a higher "amount removed" never keeps more: alpha only goes down as similarity goes up', () => {
    const px: [number, number, number] = [60, 130, 80]; // a muddy green between screen and person
    let last = 2;
    for (const similarity of [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) {
      const a = chromaAlpha(px, on({ similarity }));
      expect(a).toBeLessThanOrEqual(last + 1e-9);
      last = a;
    }
    expect(chromaAlpha(px, on({ similarity: 0 }))).toBeGreaterThan(0.9);
    expect(chromaAlpha(px, on({ similarity: 100 }))).toBeLessThan(0.1);
  });

  test('softness widens the edge: a borderline pixel is kept with a hard edge and only partly see-through with a soft one', () => {
    const px: [number, number, number] = [60, 150, 90];
    expect(chromaAlpha(px, on({ similarity: 25, smoothness: 0 }))).toBeGreaterThan(0.99);
    const soft = chromaAlpha(px, on({ similarity: 25, smoothness: 60 }));
    expect(soft).toBeGreaterThan(0.01);
    expect(soft).toBeLessThan(0.5);
  });

  test('a blue screen: the blue preset removes blue and keeps green; the green preset does the opposite', () => {
    const blueScreen: [number, number, number] = [0, 71, 187];
    const green: [number, number, number] = [0, 177, 64];
    const blueKey = on({ keyColor: KEY_PRESETS.blue });
    expect(chromaAlpha(blueScreen, blueKey)).toBeLessThan(0.05);
    expect(chromaAlpha(green, blueKey)).toBeGreaterThan(0.95);
    expect(chromaAlpha(blueScreen, on())).toBeGreaterThan(0.95);
  });

  test('brightness does not matter, only hue: a dark and a light version of the key colour are both removed', () => {
    expect(chromaAlpha([0, 60, 22], on())).toBeLessThan(0.5);
    expect(chromaAlpha([120, 255, 150], on())).toBeLessThan(0.5);
  });
});

test.describe('person cut-out maths', () => {
  test('where the model is sure of the person the pixel is kept, where it is sure of the background it is removed', () => {
    for (const similarity of [0, 25, 50, 75, 100]) {
      const s = on({ mode: 'person', similarity });
      expect(personAlpha(1, s), `person at ${similarity}`).toBeGreaterThan(0.99);
      expect(personAlpha(0, s), `background at ${similarity}`).toBeLessThan(0.01);
    }
  });

  test('alpha rises with the model\'s confidence, and a stronger cut-out never keeps more', () => {
    let last = -1;
    for (let m = 0; m <= 1.0001; m += 0.05) {
      const a = personAlpha(Math.min(1, m), on({ mode: 'person' }));
      expect(a).toBeGreaterThanOrEqual(last - 1e-9);
      last = a;
    }
    for (const m of [0.3, 0.5, 0.7]) {
      let prev = 2;
      for (const similarity of [0, 25, 50, 75, 100]) {
        const a = personAlpha(m, on({ mode: 'person', similarity }));
        expect(a, `m=${m} similarity=${similarity}`).toBeLessThanOrEqual(prev + 1e-9);
        prev = a;
      }
    }
  });

  test('softness widens the edge: an unsure pixel is partly see-through only with a soft edge', () => {
    const hard = on({ mode: 'person', smoothness: 0 });
    const soft = on({ mode: 'person', smoothness: 60 });
    expect(personAlpha(0.45, hard)).toBeLessThan(0.1);
    expect(personAlpha(0.45, soft)).toBeGreaterThan(0.1);
    expect(personAlpha(0.45, soft)).toBeLessThan(0.9);
    const p = personParams(hard);
    expect(p.softness).toBeGreaterThan(0);
    expect(p.threshold).toBeCloseTo(0.5, 5);
  });

  test('smoothing blends the new mask into the last one, so the edge does not flicker', () => {
    const raw = new Float32Array([0, 0.5, 1, 1]);
    const first = smoothMask(null, raw, null);
    expect(Array.from(first)).toEqual([0, 128, 255, 255]);
    const next = smoothMask(first, new Float32Array([1, 1, 0, 1]), null, 0.5);
    expect(Array.from(next)).toEqual([128, 192, 128, 255]);
    // k = 1 follows the new mask exactly; values are clamped to a byte.
    expect(Array.from(smoothMask(first, new Float32Array([1, 0, 1, 7]), null, 1))).toEqual([255, 0, 255, 255]);
  });

  test('smoothing reuses the array it is given, and starts again if the mask changes shape', () => {
    const a = smoothMask(null, new Float32Array([1, 1]), null);
    const b = smoothMask(a, new Float32Array([0, 0]), a, 0.5);
    expect(b).toBe(a); // same array, no allocation per frame
    expect(Array.from(b)).toEqual([128, 128]);
    const c = smoothMask(a, new Float32Array([1, 0, 1]), null, 0.5); // a different size: no blending with the old one
    expect(c.length).toBe(3);
    expect(Array.from(c)).toEqual([255, 0, 255]);
  });
});

test.describe('chroma settings', () => {
  test('defaults are off, green, and inside the slider range', () => {
    expect(DEFAULT_CHROMA.enabled).toBe(false);
    expect(DEFAULT_CHROMA.mode).toBe('color');
    expect(DEFAULT_CHROMA.keyColor).toBe(KEY_PRESETS.green);
    for (const k of ['similarity', 'smoothness', 'spill'] as const) {
      expect(DEFAULT_CHROMA[k]).toBeGreaterThanOrEqual(CHROMA_RANGES.min);
      expect(DEFAULT_CHROMA[k]).toBeLessThanOrEqual(CHROMA_RANGES.max);
    }
  });

  test('normalizeChroma repairs anything stale, missing or out of range', () => {
    expect(normalizeChroma(undefined)).toEqual(DEFAULT_CHROMA);
    expect(normalizeChroma(null)).toEqual(DEFAULT_CHROMA);
    const n = normalizeChroma({ enabled: true, keyColor: 'nope', similarity: 400, smoothness: -5, spill: Number.NaN });
    expect(n).toEqual({ enabled: true, mode: 'color', keyColor: DEFAULT_CHROMA.keyColor, similarity: 100, smoothness: 0, spill: 0 });
    expect(normalizeChroma({ mode: 'person' }).mode).toBe('person');
    expect(normalizeChroma({ mode: 'sky' as never }).mode).toBe('color');
    expect(normalizeChroma({ keyColor: '#ABCDEF' }).keyColor).toBe('#abcdef');
    expect(normalizeChroma({ enabled: 'yes' as unknown as boolean }).enabled).toBe(false);
  });

  test('colour helpers round-trip, and shader distances never reach zero (no division by zero)', () => {
    expect(isHexColor('#00b140')).toBe(true);
    expect(isHexColor('00b140')).toBe(false);
    expect(isHexColor('#00b14')).toBe(false);
    expect(rgbToHex(...hexToRgb('#12ab9f'))).toBe('#12ab9f');
    expect(rgbToHex(300, -4, 15.4)).toBe('#ff000f');
    const p = chromaParams(on({ similarity: 0, smoothness: 0, spill: 0 }));
    expect(p.smoothness).toBeGreaterThan(0);
    expect(p.spill).toBeGreaterThan(0);
    expect(p.similarity).toBe(0);
  });
});
