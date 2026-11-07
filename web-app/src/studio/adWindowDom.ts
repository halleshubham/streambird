// The browser half of window detection (adWindow.ts is the pure half): decode a picture into a bitmap and run
// detectWindow on it. Used by the studio's ad layer (when an L-shaped frame is loaded) and the brand kit editor.
import { detectWindow, type NormRect } from './adWindow';

/** The frame picture is looked at in a bitmap at most this wide/tall (the window is kept as fractions of the picture). */
export const WINDOW_SCAN_SIDE = 1280;

/** The window of a decoded picture (frame 0 for a GIF), or null when there is none or the picture cannot be read. */
export function windowOfImage(img: HTMLImageElement): NormRect | null {
  try {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!(nw > 0) || !(nh > 0)) return null;
    const k = Math.min(1, WINDOW_SCAN_SIDE / Math.max(nw, nh));
    const w = Math.max(8, Math.round(nw * k));
    const h = Math.max(8, Math.round(nh * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true });
    if (!cx) return null;
    cx.drawImage(img, 0, 0, w, h);
    return detectWindow(cx.getImageData(0, 0, w, h));
  } catch {
    return null;
  }
}

const cache = new Map<string, Promise<NormRect | null>>();

/** Detects the window of a same-origin picture URL (a library asset). Cached per URL, so reopening a kit costs nothing. A failed load is not cached. */
export function windowOfUrl(url: string): Promise<NormRect | null> {
  let hit = cache.get(url);
  if (!hit) {
    hit = new Promise<NormRect | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(windowOfImage(img));
      img.onerror = () => {
        cache.delete(url);
        resolve(null);
      };
      img.src = url;
    });
    cache.set(url, hit);
  }
  return hit;
}
