// Animated GIFs (the logo, and ads) for the broadcast canvas. drawImage of an <img> only ever paints a GIF's first frame, so
// the frames are decoded once, pre-scaled to canvases no bigger than the size they are drawn at, and the draw loop
// picks the frame from the wall clock. Decoding: WebCodecs ImageDecoder when the browser has it, else (Firefox, older
// Safari) or when it fails, our own GIF decoder (gifDecoder.ts). A GIF with more frames / bytes than the budget is
// SUBSAMPLED (frames dropped, the delays merged so the timing is kept), not given up on. Only when even that cannot
// fit, or the file cannot be decoded at all, is the static first frame kept, and then the caller is told WHY
// (AnimatedFailReason) so the studio can show a notice instead of failing silently. Never throws. Shared by the logo and the ads.

import { GifPlayer, MAX_GIF_FRAMES, parseGif } from './gifDecoder';

/** Frames kept at most; a longer GIF is subsampled to this many (timing preserved). */
export const MAX_ANIMATED_FRAMES = 150;
/** Total pixel memory for all kept frames (RGBA). */
export const MAX_ANIMATED_BYTES = 96 * 1024 * 1024;
/** GIF delays of 0/1 cs are really "as fast as you can" -- browsers show 100 ms; anything else is held to >= 20 ms. */
const DEFAULT_DELAY_MS = 100;
const MIN_DELAY_MS = 20;

/** Why a GIF will only show its first frame on the stream. 'not-animated' (one frame / not a GIF) needs no notice. */
export type AnimatedFailReason = 'cannot-decode' | 'too-large' | 'not-animated';

export interface AnimatedImage {
  /** The frame to draw `elapsedMs` after the animation started; loops forever. */
  frameAt(elapsedMs: number): CanvasImageSource;
  /** Frames actually kept (after subsampling). */
  frameCount: number;
  durationMs: number;
  /** Frames in the file (frameCount < sourceFrames when it was subsampled). */
  sourceFrames: number;
  via: 'image-decoder' | 'gif-decoder';
}

export type AnimatedLoad = { image: AnimatedImage; reason?: undefined } | { image: null; reason: AnimatedFailReason };

/** The notice the studio shows next to a logo / ad whose GIF is not animating on the broadcast (null: nothing to say). */
export function animatedNotice(reason: AnimatedFailReason | null | undefined): string | null {
  if (reason === 'cannot-decode') return 'This GIF will not animate on the stream: this browser could not decode it. Try Chrome or Edge, or re-export the GIF.';
  if (reason === 'too-large') return 'This GIF will not animate on the stream: it is too large even after being reduced. Try a shorter or smaller GIF.';
  return null;
}

/** Normalises a decoded frame duration (microseconds, possibly missing) to a playable delay in ms. */
export function frameDelayMs(durationUs: number | null | undefined): number {
  const ms = (durationUs ?? 0) / 1000;
  if (!(ms > 10)) return DEFAULT_DELAY_MS;
  return Math.max(MIN_DELAY_MS, ms);
}

/** Index of the frame showing at `elapsedMs` (looping), given each frame's cumulative end time. */
export function frameIndexAt(ends: number[], elapsedMs: number): number {
  const total = ends[ends.length - 1] ?? 0;
  if (total <= 0) return 0;
  const t = ((elapsedMs % total) + total) % total;
  let lo = 0;
  let hi = ends.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ends[mid] > t) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Which of `count` source frames to keep so that at most maxFrames / maxBytes are held; null when not even two fit. */
export function planKeep(count: number, frameBytes: number, maxFrames = MAX_ANIMATED_FRAMES, maxBytes = MAX_ANIMATED_BYTES): number[] | null {
  const budget = Math.min(maxFrames, Math.floor(maxBytes / Math.max(1, frameBytes)));
  if (count < 2 || budget < 2) return null;
  const k = Math.min(count, budget);
  const keep: number[] = [];
  for (let i = 0; i < k; i++) keep.push(Math.floor((i * count) / k)); // evenly spread, always starts at frame 0
  return keep;
}

/** Each kept frame shows for its own delay plus the delays of the dropped frames after it, so the loop lasts as long as the original. */
export function mergeDelays(keep: number[], delaysMs: number[]): number[] {
  return keep.map((from, i) => {
    const to = i + 1 < keep.length ? keep[i + 1] : delaysMs.length;
    let sum = 0;
    for (let j = from; j < to; j++) sum += delaysMs[j];
    return sum;
  });
}

/** planKeep + mergeDelays in one step. */
export function planSubsample(delaysMs: number[], frameBytes: number, maxFrames = MAX_ANIMATED_FRAMES, maxBytes = MAX_ANIMATED_BYTES): { keep: number[]; delays: number[] } | null {
  const keep = planKeep(delaysMs.length, frameBytes, maxFrames, maxBytes);
  return keep ? { keep, delays: mergeDelays(keep, delaysMs) } : null;
}

/** A decoder-agnostic source that paints the kept frames. */
interface FrameSource {
  width: number;
  height: number;
  /** Number of frames in the file. */
  count: number;
  /**
   * Walks the frames, calling `emit(draw)` for each kept one in order (draw paints it scaled to w x h), and fills
   * `delaysMs` (normalised, one per source frame decoded so far). Resolves false when decoding broke part-way.
   */
  render(keep: number[], delaysMs: number[], emit: (draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) => void): Promise<boolean>;
}

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Draws src into ctx at w x h, halving in steps when shrinking a lot so a 1080p frame in a 100 px logo is not aliased. */
function drawScaled(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, w: number, h: number): void {
  let cur: CanvasImageSource = src;
  let cw = sw;
  let ch = sh;
  while (cw / 2 > w && ch / 2 > h) {
    const nw = Math.ceil(cw / 2);
    const nh = Math.ceil(ch / 2);
    const step = document.createElement('canvas');
    step.width = nw;
    step.height = nh;
    const sctx = step.getContext('2d');
    if (!sctx) break;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
    cur = step;
    cw = nw;
    ch = nh;
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, w, h);
}

/** Plans the subsampling for a source, pre-scales the kept frames and wraps them as an AnimatedImage. */
async function assemble(src: FrameSource, maxHeight: number, maxWidth: number, via: AnimatedImage['via']): Promise<AnimatedLoad> {
  if (src.count < 2) return { image: null, reason: 'not-animated' };
  const scale = Math.min(1, maxHeight / src.height, maxWidth / src.width);
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const keep = planKeep(src.count, w * h * 4);
  if (!keep) return { image: null, reason: 'too-large' };
  const frames: HTMLCanvasElement[] = [];
  const delaysMs: number[] = new Array(src.count).fill(DEFAULT_DELAY_MS);
  let noContext = false;
  await src.render(keep, delaysMs, (draw) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      noContext = true;
      return;
    }
    draw(ctx, w, h);
    frames.push(canvas);
  });
  // A GIF cut off part-way plays the frames that did decode (as browsers do), as long as there are at least two.
  if (noContext || frames.length < 2) return { image: null, reason: 'cannot-decode' };
  const ends: number[] = [];
  let elapsed = 0;
  for (const d of mergeDelays(keep, delaysMs).slice(0, frames.length)) {
    elapsed += d;
    ends.push(elapsed);
  }
  return { image: { frameCount: frames.length, durationMs: elapsed, sourceFrames: src.count, via, frameAt: (ms) => frames[frameIndexAt(ends, ms)] } };
}

// ---- WebCodecs ImageDecoder (Chrome, Edge, Safari 17+) ----

interface ImageDecoderLike {
  tracks: { ready: Promise<unknown>; selectedTrack?: { frameCount: number } | null };
  completed: Promise<unknown>;
  decode(opts: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  close(): void;
}
type ImageDecoderCtor = (new (init: { data: ArrayBuffer; type: string }) => ImageDecoderLike) & { isTypeSupported?: (type: string) => Promise<boolean> };

export function imageDecoderCtor(): ImageDecoderCtor | null {
  const ctor = (globalThis as unknown as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
  return typeof ctor === 'function' ? ctor : null;
}

/** Types ImageDecoder is tried on. Animated WebP rides along for free (a still WebP is just "not animated"); APNG is not handled. */
const NATIVE_TYPES = ['image/gif', 'image/webp'];

async function decodeNative(blob: Blob, maxHeight: number, maxWidth: number): Promise<AnimatedLoad> {
  const Decoder = imageDecoderCtor();
  if (!Decoder) return { image: null, reason: 'cannot-decode' };
  let decoder: ImageDecoderLike | null = null;
  try {
    if (Decoder.isTypeSupported && !(await Decoder.isTypeSupported(blob.type))) return { image: null, reason: 'cannot-decode' };
    decoder = new Decoder({ data: await blob.arrayBuffer(), type: blob.type });
    const dec = decoder;
    await dec.tracks.ready;
    await dec.completed;
    const count = dec.tracks.selectedTrack?.frameCount ?? 0;
    if (count < 2) return { image: null, reason: 'not-animated' };
    if (count > MAX_GIF_FRAMES) return { image: null, reason: 'too-large' };
    const first = await dec.decode({ frameIndex: 0 });
    const width = first.image.displayWidth;
    const height = first.image.displayHeight;
    first.image.close();
    const source: FrameSource = {
      width,
      height,
      count,
      async render(keep, delaysMs, emit) {
        const keepSet = new Set(keep);
        // Every frame is decoded (its duration is needed for merging) but only the kept ones are drawn.
        for (let i = 0; i < count; i++) {
          const { image } = await dec.decode({ frameIndex: i });
          try {
            delaysMs[i] = frameDelayMs(image.duration);
            if (keepSet.has(i)) emit((ctx, w, h) => drawScaled(ctx, image, image.displayWidth, image.displayHeight, w, h));
          } finally {
            image.close();
          }
        }
        return true;
      },
    };
    return await assemble(source, maxHeight, maxWidth, 'image-decoder');
  } catch {
    return { image: null, reason: 'cannot-decode' };
  } finally {
    try {
      decoder?.close();
    } catch {
      /* already closed */
    }
  }
}

// ---- our own GIF decoder (any browser) ----

async function decodeWithGifDecoder(blob: Blob, maxHeight: number, maxWidth: number): Promise<AnimatedLoad> {
  try {
    const gif = parseGif(new Uint8Array(await blob.arrayBuffer()));
    if (!gif) return { image: null, reason: 'cannot-decode' };
    const source: FrameSource = {
      width: gif.width,
      height: gif.height,
      count: gif.frames.length,
      async render(keep, delaysMs, emit) {
        gif.frames.forEach((f, i) => (delaysMs[i] = frameDelayMs(f.delayCs * 10_000)));
        const player = new GifPlayer(gif);
        const keepSet = new Set(keep);
        const imageData = new ImageData(player.screen, gif.width, gif.height);
        let scratch: HTMLCanvasElement | null = null;
        let lastYield = performance.now();
        for (let i = 0; i < player.frameCount; i++) {
          if (!player.next()) return false; // corrupt data from here on: keep what was decoded
          if (keepSet.has(i)) {
            emit((ctx, w, h) => {
              if (w === gif.width && h === gif.height) {
                ctx.putImageData(imageData, 0, 0);
                return;
              }
              if (!scratch) {
                scratch = document.createElement('canvas');
                scratch.width = gif.width;
                scratch.height = gif.height;
              }
              scratch.getContext('2d')?.putImageData(imageData, 0, 0);
              drawScaled(ctx, scratch, gif.width, gif.height, w, h);
            });
          }
          // Compositing a big GIF takes a while: let the studio keep drawing in between.
          if (performance.now() - lastYield > 12) {
            await nextTick();
            lastYield = performance.now();
          }
        }
        return true;
      },
    };
    return await assemble(source, maxHeight, maxWidth, 'gif-decoder');
  } catch {
    return { image: null, reason: 'cannot-decode' };
  }
}

/**
 * Decodes an animated GIF (or, with ImageDecoder, animated WebP) into drawable frames no taller than `maxHeight` and
 * no wider than `maxWidth` (the size it is drawn at), subsampling long / heavy ones. Never throws: the result says
 * why there is no animation when there is none.
 */
export async function loadAnimatedImage(blob: Blob, maxHeight: number, maxWidth = Infinity): Promise<AnimatedLoad> {
  if (!NATIVE_TYPES.includes(blob.type)) return { image: null, reason: 'not-animated' };
  if (imageDecoderCtor()) {
    const native = await decodeNative(blob, maxHeight, maxWidth);
    if (native.image || native.reason !== 'cannot-decode') return native;
  }
  if (blob.type !== 'image/gif') return { image: null, reason: 'cannot-decode' };
  return decodeWithGifDecoder(blob, maxHeight, maxWidth);
}

/** loadAnimatedImage without the reason (the previous signature). */
export async function decodeAnimatedImage(blob: Blob, maxHeight: number, maxWidth = Infinity): Promise<AnimatedImage | null> {
  return (await loadAnimatedImage(blob, maxHeight, maxWidth)).image;
}
