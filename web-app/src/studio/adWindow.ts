/**
 * Finding the window of an L-shaped (frame) ad. Pure logic (no DOM, no canvas): it takes decoded pixels, so it is
 * unit-tested with synthetic images and can be ported 1:1 to the Android app.
 *
 * THE SPEC
 *   clear pixel   alpha < 16 (transparent), or opaque near-white: alpha >= 200 and min(r, g, b) >= 246.
 *   grid          the bitmap is looked at in square cells of about 4 px (bigger for huge bitmaps so at most about
 *                 640 cells span the long side); a cell is clear when the pixel at its centre is clear.
 *   seed          the cell at the image centre; if that one is not clear (text or a logo sits there) the nearest clear
 *                 cell within a quarter of the shorter side, searched in growing rings.
 *   region        4-connected flood fill of clear cells from the seed (iterative, one pass over the grid at most).
 *   box           the bounding box of the region, then refined at pixel level: each edge moves inward while its row or
 *                 column is less than 90 % clear, and outward (at most one cell) while the next one is 98 % clear.
 *   validation    the box covers at least 25 % of the picture's area and at least 20 % of each axis, is not (nearly)
 *                 the whole picture (that is a picture without a frame), and the region fills at least 70 % of its box
 *                 (a clear area that is itself L-shaped or ragged is not a window). Otherwise: null.
 *   result        { x, y, w, h } as fractions 0..1 of the picture, or null when there is no usable window.
 */

export interface PixelImage {
  /** RGBA, 4 bytes per pixel, row by row (what canvas getImageData returns). */
  data: ArrayLike<number>;
  width: number;
  height: number;
}

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const WINDOW_RULES = {
  cellPx: 4,
  maxCellsOnLongSide: 640,
  alphaClear: 16,
  alphaOpaque: 200,
  whiteMin: 246,
  minAreaFraction: 0.25,
  minAxisFraction: 0.2,
  maxAxisFraction: 0.98,
  minFill: 0.7,
} as const;

/** True for a pixel that belongs to the window: transparent, or opaque near-white. */
export function isClearPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < WINDOW_RULES.alphaClear) return true;
  return a >= WINDOW_RULES.alphaOpaque && Math.min(r, g, b) >= WINDOW_RULES.whiteMin;
}

function clearAt(img: PixelImage, x: number, y: number): boolean {
  const i = (y * img.width + x) * 4;
  const d = img.data;
  return isClearPixel(d[i], d[i + 1], d[i + 2], d[i + 3]);
}

/** Fraction (0..1) of the pixels of a row segment / column segment that are clear. */
function clearShareRow(img: PixelImage, y: number, x0: number, x1: number): number {
  let n = 0;
  for (let x = x0; x < x1; x++) if (clearAt(img, x, y)) n++;
  return x1 > x0 ? n / (x1 - x0) : 0;
}
function clearShareCol(img: PixelImage, x: number, y0: number, y1: number): number {
  let n = 0;
  for (let y = y0; y < y1; y++) if (clearAt(img, x, y)) n++;
  return y1 > y0 ? n / (y1 - y0) : 0;
}

/**
 * The window of a frame graphic as a normalised rectangle, or null when the picture has no usable clear window.
 * `opts.cellPx` overrides the grid size (tests).
 */
export function detectWindow(img: PixelImage, opts: { cellPx?: number } = {}): NormRect | null {
  const { width: W, height: H } = img;
  if (!(W >= 8) || !(H >= 8) || img.data.length < W * H * 4) return null;
  const cell = Math.max(opts.cellPx ?? WINDOW_RULES.cellPx, Math.ceil(Math.max(W, H) / WINDOW_RULES.maxCellsOnLongSide));
  const cols = Math.ceil(W / cell);
  const rows = Math.ceil(H / cell);
  const clear = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    const py = Math.min(H - 1, cy * cell + (cell >> 1));
    for (let cx = 0; cx < cols; cx++) {
      const px = Math.min(W - 1, cx * cell + (cell >> 1));
      if (clearAt(img, px, py)) clear[cy * cols + cx] = 1;
    }
  }

  // Seed: the centre cell, else the nearest clear cell (rings of growing radius, within a quarter of the short side).
  const ccx = Math.min(cols - 1, Math.floor(W / 2 / cell));
  const ccy = Math.min(rows - 1, Math.floor(H / 2 / cell));
  let seed = -1;
  if (clear[ccy * cols + ccx]) seed = ccy * cols + ccx;
  else {
    const maxR = Math.floor((Math.min(W, H) / 4) / cell);
    for (let r = 1; r <= maxR && seed < 0; r++) {
      for (let dy = -r; dy <= r && seed < 0; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = ccx + dx;
          const y = ccy + dy;
          if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          if (clear[y * cols + x]) {
            seed = y * cols + x;
            break;
          }
        }
      }
    }
  }
  if (seed < 0) return null;

  // Flood fill (explicit stack, each cell visited once).
  const seen = new Uint8Array(cols * rows);
  const stack: number[] = [seed];
  seen[seed] = 1;
  let minC = cols, maxC = -1, minR = rows, maxR2 = -1, count = 0;
  while (stack.length > 0) {
    const i = stack.pop()!;
    const cx = i % cols;
    const cy = (i / cols) | 0;
    count++;
    if (cx < minC) minC = cx;
    if (cx > maxC) maxC = cx;
    if (cy < minR) minR = cy;
    if (cy > maxR2) maxR2 = cy;
    if (cx > 0 && clear[i - 1] && !seen[i - 1]) (seen[i - 1] = 1), stack.push(i - 1);
    if (cx < cols - 1 && clear[i + 1] && !seen[i + 1]) (seen[i + 1] = 1), stack.push(i + 1);
    if (cy > 0 && clear[i - cols] && !seen[i - cols]) (seen[i - cols] = 1), stack.push(i - cols);
    if (cy < rows - 1 && clear[i + cols] && !seen[i + cols]) (seen[i + cols] = 1), stack.push(i + cols);
  }

  const boxCells = (maxC - minC + 1) * (maxR2 - minR + 1);
  if (count / boxCells < WINDOW_RULES.minFill) return null;

  let x0 = minC * cell;
  let x1 = Math.min(W, (maxC + 1) * cell);
  let y0 = minR * cell;
  let y1 = Math.min(H, (maxR2 + 1) * cell);

  // Refine to the pixel: an edge moves in while its line is mostly not clear, and out while the next line outside is clear.
  // left/top edges are the first clear line; right/bottom edges the last clear line (inclusive).
  x0 = (() => {
    let p = x0;
    for (let n = 0; n < cell * 2 && p < W && clearShareCol(img, p, y0, y1) < 0.9; n++) p++;
    for (let n = 0; n < cell && p > 0 && clearShareCol(img, p - 1, y0, y1) >= 0.98; n++) p--;
    return p;
  })();
  x1 = (() => {
    let p = x1 - 1;
    for (let n = 0; n < cell * 2 && p > 0 && clearShareCol(img, p, y0, y1) < 0.9; n++) p--;
    for (let n = 0; n < cell && p < W - 1 && clearShareCol(img, p + 1, y0, y1) >= 0.98; n++) p++;
    return p + 1;
  })();
  y0 = (() => {
    let p = y0;
    for (let n = 0; n < cell * 2 && p < H && clearShareRow(img, p, x0, x1) < 0.9; n++) p++;
    for (let n = 0; n < cell && p > 0 && clearShareRow(img, p - 1, x0, x1) >= 0.98; n++) p--;
    return p;
  })();
  y1 = (() => {
    let p = y1 - 1;
    for (let n = 0; n < cell * 2 && p > 0 && clearShareRow(img, p, x0, x1) < 0.9; n++) p--;
    for (let n = 0; n < cell && p < H - 1 && clearShareRow(img, p + 1, x0, x1) >= 0.98; n++) p++;
    return p + 1;
  })();

  const w = (x1 - x0) / W;
  const h = (y1 - y0) / H;
  if (!(w > 0) || !(h > 0)) return null;
  if (w < WINDOW_RULES.minAxisFraction || h < WINDOW_RULES.minAxisFraction) return null;
  if (w * h < WINDOW_RULES.minAreaFraction) return null;
  if (w > WINDOW_RULES.maxAxisFraction && h > WINDOW_RULES.maxAxisFraction) return null;
  return { x: x0 / W, y: y0 / H, w, h };
}
