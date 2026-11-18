import { PNG } from 'pngjs';
import * as jpeg from 'jpeg-js';
import { detectWindow } from './ad-window';
import type { NormRect, PixelImage } from './ad-window';

/** The longest side the window detection looks at (the studio's own rule works on a grid of at most ~640 cells). */
export const WINDOW_CHECK_MAX_SIDE = 1000;
/** Pictures with more pixels than this are not decoded (memory); the library allows up to 8192 px per side. */
export const WINDOW_CHECK_MAX_PIXELS = 16_000_000;

export type WindowCheck =
  | { status: 'found'; x: number; y: number; w: number; h: number }
  | { status: 'none' }
  | { status: 'not_checked'; reason: string };

/** Nearest-neighbour shrink to at most `maxSide` on the long side; the picture itself when it already fits. */
export function shrinkRgba(img: PixelImage, maxSide = WINDOW_CHECK_MAX_SIDE): PixelImage {
  const long = Math.max(img.width, img.height);
  if (long <= maxSide) return img;
  const k = maxSide / long;
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(((y + 0.5) * img.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(((x + 0.5) * img.width) / w));
      const s = (sy * img.width + sx) * 4;
      const d = (y * w + x) * 4;
      out[d] = img.data[s];
      out[d + 1] = img.data[s + 1];
      out[d + 2] = img.data[s + 2];
      out[d + 3] = img.data[s + 3];
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Runs the studio's L-shaped frame window detection (ad-window.ts, the same code) on a stored picture. PNG and JPEG are
 * decoded; a GIF, WebP, a huge picture or an unreadable file is "not checked" with the reason. Never throws.
 * `declared` is the size recorded when the file was uploaded (checked first so a huge picture is not decoded at all).
 */
export function checkFrameWindow(data: Buffer, contentType: string, declared: { width: number; height: number }): WindowCheck {
  if (contentType === 'image/gif') return { status: 'not_checked', reason: 'GIF files are not decoded here' };
  if (contentType !== 'image/png' && contentType !== 'image/jpeg') return { status: 'not_checked', reason: `${contentType} files are not decoded here` };
  if (declared.width * declared.height > WINDOW_CHECK_MAX_PIXELS) return { status: 'not_checked', reason: 'picture too large to decode here' };
  try {
    let decoded: PixelImage;
    if (contentType === 'image/png') {
      const png = PNG.sync.read(data);
      decoded = { data: png.data, width: png.width, height: png.height };
    } else {
      const j = jpeg.decode(data, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256 });
      decoded = { data: j.data, width: j.width, height: j.height };
    }
    const win: NormRect | null = detectWindow(shrinkRgba(decoded));
    return win ? { status: 'found', ...win } : { status: 'none' };
  } catch {
    return { status: 'not_checked', reason: 'the file could not be decoded' };
  }
}
