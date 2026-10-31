// Animated GIFs (the logo, and ads) for the broadcast canvas. drawImage of an <img> only ever paints a GIF's first frame, so
// the frames are decoded once (WebCodecs ImageDecoder), pre-scaled to canvases, and the draw loop picks the
// frame from the wall clock. Anything unsupported or too heavy returns null and the caller keeps the static
// first frame (the previous behaviour), so this never throws into the studio. Shared by the logo and the ads.

/** More frames than this and we keep the static logo (a long clip would cost too much memory). */
export const MAX_ANIMATED_FRAMES = 150;
/** Total pixel memory for all decoded frames (RGBA). */
export const MAX_ANIMATED_BYTES = 96 * 1024 * 1024;
/** GIF delays of 0/1 cs are really "as fast as you can" -- browsers show 100 ms; anything else is held to >= 20 ms. */
const DEFAULT_DELAY_MS = 100;
const MIN_DELAY_MS = 20;

export interface AnimatedImage {
  /** The frame to draw `elapsedMs` after the animation started; loops forever. */
  frameAt(elapsedMs: number): CanvasImageSource;
  frameCount: number;
  durationMs: number;
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

/**
 * Decodes an animated GIF into drawable frames no taller than `maxHeight` (and, when given, no wider than
 * `maxWidth`). Returns null (never throws) when the file is not a multi-frame GIF, ImageDecoder is missing,
 * decoding fails, or it is over the frame/memory caps.
 */
export async function decodeAnimatedImage(blob: Blob, maxHeight: number, maxWidth = Infinity): Promise<AnimatedImage | null> {
  const Decoder = imageDecoderCtor();
  if (!Decoder || blob.type !== 'image/gif') return null;
  let decoder: ImageDecoderLike | null = null;
  try {
    if (Decoder.isTypeSupported && !(await Decoder.isTypeSupported('image/gif'))) return null;
    decoder = new Decoder({ data: await blob.arrayBuffer(), type: 'image/gif' });
    await decoder.tracks.ready;
    await decoder.completed;
    const count = decoder.tracks.selectedTrack?.frameCount ?? 0;
    if (count < 2 || count > MAX_ANIMATED_FRAMES) return null;

    const frames: HTMLCanvasElement[] = [];
    const ends: number[] = [];
    let elapsed = 0;
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      try {
        const scale = Math.min(1, maxHeight / image.displayHeight, maxWidth / image.displayWidth);
        const w = Math.max(1, Math.round(image.displayWidth * scale));
        const h = Math.max(1, Math.round(image.displayHeight * scale));
        if (w * h * 4 * count > MAX_ANIMATED_BYTES) return null;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(image, 0, 0, w, h);
        frames.push(canvas);
        elapsed += frameDelayMs(image.duration);
        ends.push(elapsed);
      } finally {
        image.close();
      }
    }
    return {
      frameCount: count,
      durationMs: elapsed,
      frameAt: (ms) => frames[frameIndexAt(ends, ms)],
    };
  } catch {
    return null;
  } finally {
    try {
      decoder?.close();
    } catch {
      /* already closed */
    }
  }
}
