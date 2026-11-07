import { expect, test } from '@playwright/test';
import { GifPlayer, MAX_GIF_FRAMES, isGif, lzwDecode, parseGif } from '../../web-app/src/studio/gifDecoder';
import { MAX_ANIMATED_BYTES, MAX_ANIMATED_FRAMES, animatedNotice, frameDelayMs, frameIndexAt, mergeDelays, planKeep, planSubsample } from '../../web-app/src/studio/animatedImage';
import { solidGif, type Rgb } from '../gif';
import { buildGif, lzwEncode } from '../gifbuilder';

// Pure tests of the fallback GIF decoder (no browser page): hand-built GIFs with real LZW.

const RED: Rgb = [255, 0, 0];
const GREEN: Rgb = [0, 255, 0];
const BLUE: Rgb = [0, 0, 255];
const WHITE: Rgb = [255, 255, 255];

/** Plays a whole GIF and returns a copy of every composited screen. */
function play(buf: Buffer): { width: number; height: number; screens: Uint8ClampedArray[]; delays: number[]; ok: boolean } | null {
  const gif = parseGif(new Uint8Array(buf));
  if (!gif) return null;
  const player = new GifPlayer(gif);
  const screens: Uint8ClampedArray[] = [];
  let ok = true;
  for (let i = 0; i < player.frameCount; i++) {
    if (!player.next()) {
      ok = false;
      break;
    }
    screens.push(player.screen.slice());
  }
  return { width: gif.width, height: gif.height, screens, delays: gif.frames.map((f) => f.delayCs), ok };
}
const px = (screen: Uint8ClampedArray, width: number, x: number, y: number) => Array.from(screen.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

test.describe('GIF decoder', () => {
  test('decodes solidGif(): frame count, delays and colours', () => {
    const r = play(solidGif([RED, GREEN, BLUE], { width: 16, height: 16, delayMs: 200 }))!;
    expect(r.ok).toBe(true);
    expect(r.screens).toHaveLength(3);
    expect(r.delays).toEqual([20, 20, 20]);
    expect([RED, GREEN, BLUE].map((c, i) => px(r.screens[i], 16, 8, 8))).toEqual([RED, GREEN, BLUE].map((c) => [...c, 255]));
  });

  test('delays 0 and 1 cs play at 100 ms, 2 cs at 20 ms (browser behaviour)', () => {
    const gif = buildGif({ width: 2, height: 2, palette: [RED, BLUE], frames: [0, 1, 2, 5, 100].map((d) => ({ pixels: [0, 0, 0, 0], delayCs: d })) });
    const r = play(gif)!;
    expect(r.delays).toEqual([0, 1, 2, 5, 100]);
    expect(r.delays.map((d) => frameDelayMs(d * 10_000))).toEqual([100, 100, 20, 50, 1000]);
    // A frame without a graphic control extension has no delay at all: same default.
    expect(play(buildGif({ width: 1, height: 1, palette: [RED, BLUE], frames: [{ pixels: [0], noGce: true }, { pixels: [1], noGce: true }] }))!.delays).toEqual([0, 0]);
  });

  test('real LZW round-trips big, awkward pixel data (code width growth and table resets)', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (const [colours, n] of [[2, 3000], [4, 5000], [16, 20000], [256, 60000]] as const) {
      const bits = Math.max(2, Math.ceil(Math.log2(colours)));
      const idx = Array.from({ length: n }, (_, i) => (i % 97 < 40 ? (i >> 3) % colours : rnd() % colours)); // runs + noise
      const out = new Uint8Array(n);
      const enc = lzwEncode(idx, bits);
      // lzwEncode returns [minCodeSize, ...sub-blocks, 0]: hand the sub-blocks to the decoder.
      const chunks: Array<[number, number]> = [];
      let p = 1;
      while (enc[p] !== 0) {
        chunks.push([p + 1, p + 1 + enc[p]]);
        p += 1 + enc[p];
      }
      expect(lzwDecode(new Uint8Array(enc), chunks, bits, out, n)).toBe(true);
      expect(Array.from(out)).toEqual(idx);
    }
  });

  test('a full-colour frame survives a whole GIF round trip', () => {
    const w = 40;
    const h = 30;
    const palette: Rgb[] = Array.from({ length: 200 }, (_, i) => [i, (i * 7) % 256, 255 - i]);
    const pixels = Array.from({ length: w * h }, (_, i) => (i * 31 + (i >> 5)) % 200);
    const r = play(buildGif({ width: w, height: h, palette, frames: [{ pixels }, { pixels: pixels.map((v) => (v + 1) % 200) }] }))!;
    for (const [f, shift] of [[0, 0], [1, 1]] as const)
      for (const [x, y] of [[0, 0], [39, 29], [12, 17], [5, 28]]) expect(px(r.screens[f], w, x, y)).toEqual([...palette[(pixels[y * w + x] + shift) % 200], 255]);
  });

  test('interlaced frames put every row back where it belongs', () => {
    const w = 3;
    const h = 21; // not a multiple of 8: every pass has a different length
    const palette: Rgb[] = Array.from({ length: 32 }, (_, i) => [i * 8, 0, 255 - i * 8]);
    const pixels = Array.from({ length: w * h }, (_, i) => Math.floor(i / w)); // row y has colour y
    const r = play(buildGif({ width: w, height: h, palette, frames: [{ pixels, interlaced: true }, { pixels, interlaced: false }] }))!;
    for (let y = 0; y < h; y++) {
      expect(px(r.screens[0], w, 1, y)).toEqual([...palette[y], 255]);
      expect(px(r.screens[1], w, 1, y)).toEqual([...palette[y], 255]);
    }
  });

  test('local colour tables override the global one per frame', () => {
    const r = play(
      buildGif({
        width: 2,
        height: 1,
        palette: [RED, GREEN],
        frames: [{ pixels: [0, 1] }, { pixels: [0, 1], palette: [BLUE, WHITE] }, { pixels: [0, 1] }],
      }),
    )!;
    expect(px(r.screens[0], 2, 0, 0)).toEqual([...RED, 255]);
    expect(px(r.screens[1], 2, 0, 0)).toEqual([...BLUE, 255]);
    expect(px(r.screens[1], 2, 1, 0)).toEqual([...WHITE, 255]);
    expect(px(r.screens[2], 2, 1, 0)).toEqual([...GREEN, 255]);
  });

  test('transparency lets the previous frame show through; disposal 1 keeps it', () => {
    const r = play(
      buildGif({
        width: 4,
        height: 1,
        palette: [RED, BLUE, GREEN],
        frames: [
          { pixels: [0, 0, 0, 0], disposal: 1 },
          { pixels: [2, 1, 1, 2], transparent: 2, disposal: 1 },
        ],
      }),
    )!;
    expect([0, 1, 2, 3].map((x) => px(r.screens[1], 4, x, 0))).toEqual([[...RED, 255], [...BLUE, 255], [...BLUE, 255], [...RED, 255]]);
  });

  test('disposal 2 clears the previous frame rectangle to transparent', () => {
    const r = play(
      buildGif({
        width: 4,
        height: 4,
        palette: [RED, BLUE, GREEN],
        frames: [
          { pixels: Array(16).fill(0), disposal: 1 }, // red background
          { pixels: Array(4).fill(1), x: 1, y: 1, w: 2, h: 2, disposal: 2 }, // blue box, then cleared
          { pixels: [2], x: 0, y: 0, w: 1, h: 1, disposal: 1 }, // green dot
        ],
      }),
    )!;
    expect(px(r.screens[1], 4, 1, 1)).toEqual([...BLUE, 255]);
    expect(px(r.screens[2], 4, 1, 1)).toEqual([0, 0, 0, 0]); // box area is empty again (not red: it was cleared, as in browsers)
    expect(px(r.screens[2], 4, 3, 3)).toEqual([...RED, 255]); // outside the box untouched
    expect(px(r.screens[2], 4, 0, 0)).toEqual([...GREEN, 255]);
  });

  test('disposal 3 restores what was under the previous frame', () => {
    const r = play(
      buildGif({
        width: 4,
        height: 4,
        palette: [RED, BLUE, GREEN],
        frames: [
          { pixels: Array(16).fill(0), disposal: 1 },
          { pixels: Array(4).fill(1), x: 1, y: 1, w: 2, h: 2, disposal: 3 },
          { pixels: [2], x: 0, y: 0, w: 1, h: 1, disposal: 1 },
        ],
      }),
    )!;
    expect(px(r.screens[1], 4, 2, 2)).toEqual([...BLUE, 255]);
    expect(px(r.screens[2], 4, 2, 2)).toEqual([...RED, 255]); // back to the red under the box
    expect(px(r.screens[2], 4, 0, 0)).toEqual([...GREEN, 255]);
  });

  test('a frame sticking out of the screen is clipped, not an error', () => {
    const r = play(buildGif({ width: 2, height: 2, palette: [RED, BLUE], frames: [{ pixels: Array(4).fill(0) }, { pixels: Array(9).fill(1), x: 1, y: 1, w: 3, h: 3 }] }))!;
    expect(r.ok).toBe(true);
    expect(px(r.screens[1], 2, 1, 1)).toEqual([...BLUE, 255]);
    expect(px(r.screens[1], 2, 0, 0)).toEqual([...RED, 255]);
  });

  test('a GIF cut off after some frames plays those frames; header-only or not-a-GIF is null', () => {
    const full = solidGif([RED, GREEN, BLUE, WHITE], { width: 16, height: 16 });
    // Without the trailer: all four frames.
    expect(parseGif(new Uint8Array(full.subarray(0, full.length - 1)))!.frames).toHaveLength(4);
    // Cut in the middle of the last frame: three frames survive.
    const cut = full.length - 12;
    expect(parseGif(new Uint8Array(full.subarray(0, cut)))!.frames.length).toBe(3);
    // Nothing usable.
    expect(parseGif(new Uint8Array(full.subarray(0, 20)))).toBeNull();
    expect(parseGif(new Uint8Array(0))).toBeNull();
    expect(parseGif(new Uint8Array(Buffer.from('<html>not a gif at all</html>')))).toBeNull();
    expect(isGif(new Uint8Array(full))).toBe(true);
    expect(isGif(new Uint8Array(Buffer.from('PNG....')))).toBe(false);
  });

  test('corrupt LZW data stops the player (false) without throwing', () => {
    const gif = buildGif({ width: 8, height: 8, palette: [RED, BLUE], frames: [{ pixels: Array(64).fill(0) }, { pixels: Array(64).fill(1) }] });
    const bad = Buffer.from(gif);
    // Smash the bytes of the second frame's code stream.
    for (let i = bad.length - 8; i < bad.length - 1; i++) bad[i] = 0xff;
    const r = play(bad);
    expect(r).not.toBeNull();
    expect(r!.screens.length).toBeGreaterThanOrEqual(1);
  });

  test('absurd sizes and frame counts are rejected before anything is allocated', () => {
    const huge = Buffer.from(solidGif([RED, BLUE]));
    huge.writeUInt16LE(65535, 6);
    huge.writeUInt16LE(65535, 8);
    expect(parseGif(new Uint8Array(huge))).toBeNull();
    const zero = Buffer.from(solidGif([RED, BLUE]));
    zero.writeUInt16LE(0, 6);
    expect(parseGif(new Uint8Array(zero))).toBeNull();
    const many = buildGif({ width: 1, height: 1, palette: [RED, BLUE], frames: Array.from({ length: MAX_GIF_FRAMES + 1 }, () => ({ pixels: [0] })) });
    expect(parseGif(new Uint8Array(many))).toBeNull();
  });

  test('fuzz: flipped / truncated / random bytes never throw', () => {
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 1664525 + 1013904223) >>> 0) % n;
    const sources = [
      solidGif([RED, GREEN, BLUE]),
      buildGif({ width: 9, height: 9, palette: [RED, GREEN, BLUE, WHITE], frames: [{ pixels: Array.from({ length: 81 }, (_, i) => i % 4), interlaced: true }, { pixels: Array(81).fill(2), disposal: 3 }, { pixels: Array(4).fill(1), x: 2, y: 2, w: 2, h: 2, disposal: 2, transparent: 1 }] }),
    ];
    for (let n = 0; n < 600; n++) {
      const b = Buffer.from(sources[n % 2]);
      for (let k = 0; k < 1 + rnd(6); k++) b[rnd(b.length)] = rnd(256);
      const input = new Uint8Array(rnd(3) === 0 ? b.subarray(0, rnd(b.length)) : b);
      const gif = parseGif(input);
      if (!gif) continue;
      const player = new GifPlayer(gif);
      for (let i = 0; i < player.frameCount; i++) if (!player.next()) break;
    }
    // Pure random noise, with and without a valid signature.
    for (let n = 0; n < 200; n++) {
      const b = new Uint8Array(6 + rnd(300));
      for (let i = 0; i < b.length; i++) b[i] = rnd(256);
      if (n % 2) b.set(Buffer.from('GIF89a'), 0);
      parseGif(b);
    }
  });
});

test.describe('subsampling', () => {
  const total = (a: number[]) => a.reduce((x, y) => x + y, 0);

  test('under the budget every frame is kept as is', () => {
    const delays = Array(30).fill(80);
    const plan = planSubsample(delays, 100 * 100 * 4)!;
    expect(plan.keep).toEqual(Array.from({ length: 30 }, (_, i) => i));
    expect(plan.delays).toEqual(delays);
  });

  test('over the frame cap: evenly spaced frames, first kept, total duration preserved', () => {
    const delays = Array.from({ length: 200 }, (_, i) => 40 + (i % 5) * 10);
    const plan = planSubsample(delays, 100 * 100 * 4)!;
    expect(plan.keep).toHaveLength(MAX_ANIMATED_FRAMES);
    expect(plan.keep[0]).toBe(0);
    expect(new Set(plan.keep).size).toBe(plan.keep.length);
    expect([...plan.keep].sort((a, b) => a - b)).toEqual(plan.keep);
    expect(total(plan.delays)).toBe(total(delays));
    // 1000 frames -> still 150 frames, the same duration
    const long = Array(1000).fill(30);
    const p2 = planSubsample(long, 4 * 100 * 100)!;
    expect(p2.keep).toHaveLength(MAX_ANIMATED_FRAMES);
    expect(total(p2.delays)).toBe(30_000);
    // each kept frame covers the dropped ones after it
    expect(mergeDelays([0, 2, 5], [10, 20, 30, 40, 50, 60])).toEqual([30, 120, 60]);
  });

  test('over the memory budget: fewer frames, never more than fit', () => {
    const frameBytes = 1920 * 1080 * 4; // an undersized target would have been scaled down; this is the worst case
    const delays = Array(100).fill(50);
    const keep = planKeep(delays.length, frameBytes)!;
    expect(keep.length).toBe(Math.floor(MAX_ANIMATED_BYTES / frameBytes));
    expect(keep.length * frameBytes).toBeLessThanOrEqual(MAX_ANIMATED_BYTES);
    expect(total(mergeDelays(keep, delays))).toBe(5000);
  });

  test('the caps are frame/memory based, not file-size based: an 8 MB GIF with thousands of frames still degrades gracefully', () => {
    // A heavily compressed 8 MB GIF can hold thousands of small frames: kept frames and bytes stay within budget, timing is preserved.
    const delays = Array(4000).fill(40);
    const small = planSubsample(delays, 480 * 270 * 4)!;
    expect(small.keep.length).toBeLessThanOrEqual(MAX_ANIMATED_FRAMES);
    expect(small.keep.length * 480 * 270 * 4).toBeLessThanOrEqual(MAX_ANIMATED_BYTES);
    expect(total(small.delays)).toBe(160000);
    // The same file at full 1080p is cut down to what fits in memory instead of being given up on.
    const big = planSubsample(delays, 1920 * 1080 * 4)!;
    expect(big.keep.length).toBe(Math.floor(MAX_ANIMATED_BYTES / (1920 * 1080 * 4)));
    expect(total(big.delays)).toBe(160000);
    // A canvas so large that not even two frames fit gets the "too large" notice, which stays accurate for any file size.
    expect(planSubsample(delays, MAX_ANIMATED_BYTES)).toBeNull();
    expect(animatedNotice('too-large')).toContain('too large even after being reduced');
  });

  test('not even two frames fit, or only one frame exists: null', () => {
    expect(planKeep(50, MAX_ANIMATED_BYTES)).toBeNull();
    expect(planKeep(50, MAX_ANIMATED_BYTES / 2 + 1)).toBeNull();
    expect(planKeep(50, MAX_ANIMATED_BYTES / 2)).toEqual([0, 25]);
    expect(planKeep(1, 100)).toBeNull();
    expect(planKeep(0, 100)).toBeNull();
  });

  test('playback: the merged timeline picks the right kept frame and loops', () => {
    const ends: number[] = [];
    let t = 0;
    for (const d of mergeDelays([0, 2, 4], [100, 100, 100, 100, 100])) ends.push((t += d)); // 200, 400, 500
    expect([0, 150, 199, 200, 399, 400, 499, 500, 700].map((ms) => frameIndexAt(ends, ms))).toEqual([0, 0, 0, 1, 1, 2, 2, 0, 1]);
  });

  test('the notice texts', () => {
    expect(animatedNotice('cannot-decode')).toContain('will not animate on the stream');
    expect(animatedNotice('cannot-decode')).toContain('Chrome or Edge');
    expect(animatedNotice('too-large')).toContain('shorter or smaller');
    expect(animatedNotice('not-animated')).toBeNull();
    expect(animatedNotice(null)).toBeNull();
  });
});
