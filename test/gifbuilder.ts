/**
 * A general GIF89a builder for the decoder tests: real LZW compression (growing code widths, table reset),
 * local colour tables, transparency, disposal methods, sub-rectangle frames, interlacing. Complements gif.ts
 * (solidGif: tiny looping solid-colour GIFs).
 */
import type { Rgb } from './gif';

export interface GifFrameSpec {
  /** Palette indices, row-major, w*h of them (default size: the whole screen). */
  pixels: number[];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Local colour table (RGB); omitted: the global one. */
  palette?: Rgb[];
  delayCs?: number;
  disposal?: 0 | 1 | 2 | 3;
  transparent?: number;
  /** `pixels` are given in display order; they are stored interlaced. */
  interlaced?: boolean;
  /** Omit the graphic control extension entirely. */
  noGce?: boolean;
}

/** Real GIF LZW compression (growing code widths, table reset when full). */
export function lzwEncode(indices: number[], minCodeSize: number): Buffer {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const out: number[] = [];
  let acc = 0;
  let nbits = 0;
  const put = (code: number, size: number) => {
    acc |= code << nbits;
    nbits += size;
    while (nbits >= 8) {
      out.push(acc & 255);
      acc >>>= 8;
      nbits -= 8;
    }
  };
  let size = minCodeSize + 1;
  let dict = new Map<string, number>();
  let next = eoi + 1;
  const codeOf = (s: string) => (s.length === 1 ? s.charCodeAt(0) : dict.get(s)!);
  put(clear, size);
  let cur = '';
  for (const idx of indices) {
    const key = cur + String.fromCharCode(idx);
    if (cur === '' || dict.has(key)) {
      cur = key;
      continue;
    }
    put(codeOf(cur), size);
    dict.set(key, next++);
    if (next > 1 << size && size < 12) size++;
    if (next >= 4096) {
      put(clear, size);
      dict = new Map();
      next = eoi + 1;
      size = minCodeSize + 1;
    }
    cur = String.fromCharCode(idx);
  }
  if (cur) put(codeOf(cur), size);
  put(eoi, size);
  if (nbits > 0) out.push(acc & 255);
  const blocks: number[] = [];
  for (let i = 0; i < out.length; i += 255) {
    const chunk = out.slice(i, i + 255);
    blocks.push(chunk.length, ...chunk);
  }
  blocks.push(0);
  return Buffer.from([minCodeSize, ...blocks]);
}

function palBytes(colors: Rgb[]): { bytes: Buffer; bits: number } {
  let bits = 1;
  while (1 << bits < colors.length) bits++;
  const bytes = Buffer.alloc(3 * (1 << bits));
  colors.forEach((c, i) => Buffer.from(c).copy(bytes, i * 3));
  return { bytes, bits };
}

/** Display-order pixels re-ordered the way an interlaced GIF stores its rows. */
function interlace(pixels: number[], w: number, h: number): number[] {
  const order: number[] = [];
  for (const [first, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = first; y < h; y += step) order.push(y);
  return order.flatMap((y) => pixels.slice(y * w, (y + 1) * w));
}

export function buildGif(opts: { width: number; height: number; palette?: Rgb[]; frames: GifFrameSpec[]; loop?: boolean; trailer?: boolean }): Buffer {
  const { width, height, frames, loop = true, trailer = true } = opts;
  const gp = opts.palette ? palBytes(opts.palette) : null;
  const head = Buffer.alloc(13);
  head.write('GIF89a', 0, 'ascii');
  head.writeUInt16LE(width, 6);
  head.writeUInt16LE(height, 8);
  head[10] = gp ? 0x80 | (gp.bits - 1) : 0;
  const parts: Buffer[] = [head];
  if (gp) parts.push(gp.bytes);
  if (loop) parts.push(Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0]));
  for (const f of frames) {
    const w = f.w ?? width;
    const h = f.h ?? height;
    if (!f.noGce) {
      const gce = Buffer.from([0x21, 0xf9, 4, ((f.disposal ?? 0) << 2) | (f.transparent !== undefined ? 1 : 0), 0, 0, f.transparent ?? 0, 0]);
      gce.writeUInt16LE(f.delayCs ?? 10, 4);
      parts.push(gce);
    }
    const lp = f.palette ? palBytes(f.palette) : null;
    const desc = Buffer.alloc(10);
    desc[0] = 0x2c;
    desc.writeUInt16LE(f.x ?? 0, 1);
    desc.writeUInt16LE(f.y ?? 0, 3);
    desc.writeUInt16LE(w, 5);
    desc.writeUInt16LE(h, 7);
    desc[9] = (lp ? 0x80 | (lp.bits - 1) : 0) | (f.interlaced ? 0x40 : 0);
    parts.push(desc);
    if (lp) parts.push(lp.bytes);
    const colours = (f.palette ?? opts.palette ?? []).length;
    const minCode = Math.max(2, Math.ceil(Math.log2(Math.max(colours, 2))));
    parts.push(lzwEncode(f.interlaced ? interlace(f.pixels, w, h) : f.pixels, minCode));
  }
  if (trailer) parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}
