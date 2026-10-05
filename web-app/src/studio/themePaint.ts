import type { CanvasTheme } from './compose';

const cache = new Map<string, HTMLCanvasElement>();

function paintPattern(ctx: CanvasRenderingContext2D, theme: CanvasTheme, w: number, h: number): void {
  const unit = h / 720; // patterns scale with the canvas so they look the same at every resolution
  ctx.save();
  ctx.strokeStyle = theme.patternColor;
  ctx.fillStyle = theme.patternColor;
  ctx.lineWidth = Math.max(1, unit);
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  switch (theme.pattern) {
    case 'lines-h': {
      const step = 14 * unit;
      for (let y = step; y < h; y += step) line(0, y, w, y);
      break;
    }
    case 'lines-v': {
      const step = 64 * unit;
      for (let x = step; x < w; x += step) line(x, 0, x, h);
      break;
    }
    case 'grid': {
      const step = 48 * unit;
      for (let x = step; x < w; x += step) line(x, 0, x, h);
      for (let y = step; y < h; y += step) line(0, y, w, y);
      break;
    }
    case 'dots': {
      const step = 28 * unit;
      const rad = Math.max(1, 1.6 * unit);
      for (let y = step / 2; y < h; y += step) {
        for (let x = step / 2; x < w; x += step) {
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'diagonal': {
      const step = 26 * unit;
      for (let d = -h; d < w; d += step) line(d, h, d + h, 0);
      break;
    }
    case 'ruled': {
      const step = 36 * unit;
      for (let y = step; y < h; y += step) line(0, y, w, y);
      ctx.lineWidth = Math.max(1, 1.5 * unit);
      line(w * 0.06, 0, w * 0.06, h); // notebook margin rule
      break;
    }
    case 'pinstripe': {
      const step = 10 * unit;
      for (let x = step; x < w; x += step) line(x, 0, x, h);
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

/** Fills the canvas with the theme's background. The vanilla theme is a plain black fill, as before. */
export function paintBackground(ctx: CanvasRenderingContext2D, theme: CanvasTheme, w: number, h: number): void {
  if (theme.id === 'vanilla') {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  // The gradient and pattern are expensive per frame at 1080p and never change, so they are
  // rendered once per theme and canvas size.
  const key = `${theme.id}:${w}x${h}`;
  let bg = cache.get(key);
  if (!bg) {
    bg = document.createElement('canvas');
    bg.width = w;
    bg.height = h;
    const bctx = bg.getContext('2d')!;
    const grad = bctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, theme.bg[0]);
    grad.addColorStop(1, theme.bg[1]);
    bctx.fillStyle = grad;
    bctx.fillRect(0, 0, w, h);
    paintPattern(bctx, theme, w, h);
    cache.set(key, bg);
    if (cache.size > 12) cache.delete(cache.keys().next().value as string);
  }
  ctx.drawImage(bg, 0, 0);
}

export interface SlideImage {
  name: string;
  canvas: HTMLCanvasElement;
}

const MAX_SLIDE_SIDE = 1920;

/** Decodes an image file into a canvas no larger than 1920px on its long side, so a deck of photos doesn't pile up in memory. */
export async function loadSlide(file: File): Promise<SlideImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // An SVG with no width/height/viewBox decodes but has no size to draw.
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('image has no size');
    const scale = Math.min(1, MAX_SLIDE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { name: file.name, canvas };
  } finally {
    URL.revokeObjectURL(url);
  }
}
