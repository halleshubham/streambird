// A compact, dependency-free GIF87a/89a decoder: the fallback for browsers without WebCodecs ImageDecoder (Firefox,
// older Safari) and for any file ImageDecoder refuses. Pure data in, pure data out (no DOM), so it is unit-tested in
// node. It never throws: anything malformed gives null (or, for a truncated tail, the frames that were complete).
//
// Two steps so a long or big GIF never has to exist as full-size RGBA frames in memory:
//   1. parseGif(bytes)      -> size + one cheap descriptor per frame (palette, rect, delay, disposal, data offsets).
//   2. new GifPlayer(gif)   -> next() composites the following frame into ONE shared RGBA buffer (disposal methods
//                              0-3, transparency, interlace) and returns it; the caller draws or skips it.
// The loop count is ignored on purpose: the studio plays every animation forever.

/** Reject absurd files before allocating anything: 8192 x 8192 would already be a 256 MB buffer. */
export const MAX_GIF_PIXELS = 4096 * 4096;
export const MAX_GIF_FRAMES = 5000;

export interface GifFrame {
  /** Frame rectangle inside the logical screen (already clipped to it). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Declared (unclipped) rectangle width/height: the pixel stream has this many pixels. */
  dw: number;
  dh: number;
  interlaced: boolean;
  /** RGB triplets of the colour table this frame uses (local, else global). */
  palette: Uint8Array;
  transparent: number; // palette index, -1 for none
  /** Delay in hundredths of a second as stored in the file (0 and 1 mean "as fast as possible"). */
  delayCs: number;
  /** 0/1 = leave in place, 2 = restore to background (transparent), 3 = restore to previous. */
  disposal: number;
  minCodeSize: number;
  /** [start, end) byte ranges of the LZW sub-block payloads. */
  chunks: Array<[number, number]>;
}

export interface ParsedGif {
  width: number;
  height: number;
  frames: GifFrame[];
  bytes: Uint8Array;
}

/** True when the bytes start with the GIF signature. */
export function isGif(bytes: Uint8Array): boolean {
  return bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61;
}

class Truncated extends Error {}

/**
 * Walks the GIF block structure. Returns null for a bad header / absurd size / fewer than one complete frame.
 * A file cut off after some complete frames (no trailer, partial last frame) returns the complete ones.
 */
export function parseGif(bytes: Uint8Array): ParsedGif | null {
  try {
    if (!isGif(bytes) || bytes.length < 13) return null;
    const u16 = (o: number) => {
      if (o + 2 > bytes.length) throw new Truncated();
      return bytes[o] | (bytes[o + 1] << 8);
    };
    const width = u16(6);
    const height = u16(8);
    if (width < 1 || height < 1 || width * height > MAX_GIF_PIXELS) return null;
    const flags = bytes[10];
    let pos = 13;
    let globalPalette: Uint8Array | null = null;
    if (flags & 0x80) {
      const n = 3 * (1 << ((flags & 7) + 1));
      if (pos + n > bytes.length) return null;
      globalPalette = bytes.subarray(pos, pos + n);
      pos += n;
    }

    const frames: GifFrame[] = [];
    let gce: { delayCs: number; disposal: number; transparent: number } | null = null;

    const skipSubBlocks = (): Array<[number, number]> => {
      const chunks: Array<[number, number]> = [];
      for (;;) {
        if (pos >= bytes.length) throw new Truncated();
        const len = bytes[pos++];
        if (len === 0) return chunks;
        if (pos + len > bytes.length) throw new Truncated();
        chunks.push([pos, pos + len]);
        pos += len;
      }
    };

    try {
      while (pos < bytes.length) {
        const intro = bytes[pos++];
        if (intro === 0x3b) break; // trailer
        if (intro === 0x21) {
          if (pos >= bytes.length) throw new Truncated();
          const label = bytes[pos++];
          if (label === 0xf9 && bytes[pos] === 4 && pos + 6 <= bytes.length) {
            const f = bytes[pos + 1];
            gce = { delayCs: u16(pos + 2), disposal: (f >> 2) & 7, transparent: f & 1 ? bytes[pos + 4] : -1 };
          }
          skipSubBlocks();
        } else if (intro === 0x2c) {
          if (pos + 9 > bytes.length) throw new Truncated();
          const fx = u16(pos);
          const fy = u16(pos + 2);
          const dw = u16(pos + 4);
          const dh = u16(pos + 6);
          const ff = bytes[pos + 8];
          pos += 9;
          let palette = globalPalette;
          if (ff & 0x80) {
            const n = 3 * (1 << ((ff & 7) + 1));
            if (pos + n > bytes.length) throw new Truncated();
            palette = bytes.subarray(pos, pos + n);
            pos += n;
          }
          if (pos >= bytes.length) throw new Truncated();
          const minCodeSize = bytes[pos++];
          const chunks = skipSubBlocks();
          if (dw < 1 || dh < 1 || dw * dh > MAX_GIF_PIXELS || minCodeSize < 1 || minCodeSize > 8 || fx >= width || fy >= height) {
            gce = null;
            continue; // an empty or impossible frame: ignore it, like browsers do
          }
          if (!palette) palette = new Uint8Array(0); // no table at all: every index reads as black
          frames.push({
            x: fx,
            y: fy,
            w: Math.min(dw, width - fx),
            h: Math.min(dh, height - fy),
            dw,
            dh,
            interlaced: (ff & 0x40) !== 0,
            palette,
            transparent: gce ? gce.transparent : -1,
            delayCs: gce ? gce.delayCs : 0,
            disposal: gce ? gce.disposal : 0,
            minCodeSize,
            chunks,
          });
          gce = null;
          if (frames.length > MAX_GIF_FRAMES) return null;
        } else {
          return frames.length ? { width, height, frames, bytes } : null; // garbage between blocks
        }
      }
    } catch (e) {
      if (!(e instanceof Truncated)) throw e;
    }
    return frames.length ? { width, height, frames, bytes } : null;
  } catch {
    return null;
  }
}

/** GIF LZW: decodes one frame's code stream into `out` (palette indices, row-major, `count` pixels). False on a corrupt stream. */
export function lzwDecode(bytes: Uint8Array, chunks: Array<[number, number]>, minCodeSize: number, out: Uint8Array, count: number): boolean {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let size = minCodeSize + 1;
  let mask = (1 << size) - 1;
  let next = eoi + 1;
  let prev = -1;
  let first = 0;
  let acc = 0;
  let nbits = 0;
  let written = 0;
  for (const [start, end] of chunks) {
    for (let p = start; p < end; p++) {
      acc |= bytes[p] << nbits;
      nbits += 8;
      while (nbits >= size) {
        const code = acc & mask;
        acc >>>= size;
        nbits -= size;
        if (code === clear) {
          size = minCodeSize + 1;
          mask = (1 << size) - 1;
          next = eoi + 1;
          prev = -1;
          continue;
        }
        if (code === eoi) return written >= count;
        if (prev === -1) {
          if (code >= clear) return false;
          if (written < count) out[written++] = suffix[code];
          prev = code;
          first = code;
          continue;
        }
        let cur = code;
        let sp = 0;
        if (code >= next) {
          if (code > next) return false; // refers to a code that does not exist yet
          stack[sp++] = first;
          cur = prev;
        }
        while (cur >= clear) {
          if (sp >= 4096) return false;
          stack[sp++] = suffix[cur];
          cur = prefix[cur];
        }
        first = suffix[cur];
        stack[sp++] = first;
        while (sp > 0 && written < count) out[written++] = stack[--sp];
        if (next < 4096) {
          prefix[next] = prev;
          suffix[next] = first;
          next++;
          if ((next & mask) === 0 && next < 4096) {
            size++;
            mask = (1 << size) - 1;
          }
        }
        prev = code;
        if (written >= count) return true;
      }
    }
  }
  // Ran out of data without an end code: acceptable only if the frame is complete (some encoders omit it).
  return written >= count;
}

const INTERLACE_PASSES: Array<[number, number]> = [
  [0, 8],
  [4, 8],
  [2, 4],
  [1, 2],
];

/** Stateful compositor: each next() paints the following frame onto a persistent RGBA screen and returns it. */
export class GifPlayer {
  readonly width: number;
  readonly height: number;
  /** The composited screen, RGBA, valid until the next next(). */
  readonly screen: Uint8ClampedArray<ArrayBuffer>;
  private index = 0;
  private saved: Uint8ClampedArray | null = null;
  private pixels = new Uint8Array(0);

  private readonly gif: ParsedGif;

  constructor(gif: ParsedGif) {
    this.gif = gif;
    this.width = gif.width;
    this.height = gif.height;
    this.screen = new Uint8ClampedArray(new ArrayBuffer(gif.width * gif.height * 4));
  }

  get frameCount(): number {
    return this.gif.frames.length;
  }

  /** Composites frame `index` (must be called for 0,1,2,... in order). Returns false when the frame's data is corrupt. */
  next(): boolean {
    const f = this.gif.frames[this.index];
    const prev = this.index > 0 ? this.gif.frames[this.index - 1] : null;
    this.index++;
    if (!f) return false;
    // 1. Undo the previous frame as its disposal method says.
    if (prev && prev.disposal === 2) this.clearRect(prev);
    else if (prev && prev.disposal === 3 && this.saved) this.restoreRect(prev);
    // 2. Remember what is under this frame when it will be rolled back.
    if (f.disposal === 3) this.saveRect(f);
    // 3. Decode and paint it.
    const count = f.dw * f.dh;
    if (this.pixels.length < count) this.pixels = new Uint8Array(count);
    const ok = lzwDecode(this.gif.bytes, f.chunks, f.minCodeSize, this.pixels, count);
    if (!ok) return false;
    this.paint(f);
    return true;
  }

  private paint(f: GifFrame): void {
    const { screen, width } = this;
    const pal = f.palette;
    const palN = pal.length / 3;
    const rowAt = (i: number): number => {
      if (!f.interlaced) return i;
      let start = 0;
      for (const [first, step] of INTERLACE_PASSES) {
        const rows = Math.ceil(Math.max(0, f.dh - first) / step);
        if (i < start + rows) return first + (i - start) * step;
        start += rows;
      }
      return i;
    };
    for (let i = 0; i < f.dh; i++) {
      const y = f.y + rowAt(i);
      if (y >= this.height) continue;
      const src = i * f.dw;
      let dst = (y * width + f.x) * 4;
      for (let x = 0; x < f.w; x++, dst += 4) {
        const idx = this.pixels[src + x];
        if (idx === f.transparent) continue;
        if (idx < palN) {
          screen[dst] = pal[idx * 3];
          screen[dst + 1] = pal[idx * 3 + 1];
          screen[dst + 2] = pal[idx * 3 + 2];
        } else {
          screen[dst] = screen[dst + 1] = screen[dst + 2] = 0;
        }
        screen[dst + 3] = 255;
      }
    }
  }

  private clearRect(f: GifFrame): void {
    for (let y = f.y; y < f.y + f.h; y++) this.screen.fill(0, (y * this.width + f.x) * 4, (y * this.width + f.x + f.w) * 4);
  }

  private saveRect(f: GifFrame): void {
    const need = f.w * f.h * 4;
    if (!this.saved || this.saved.length < need) this.saved = new Uint8ClampedArray(need);
    for (let r = 0; r < f.h; r++) {
      const from = ((f.y + r) * this.width + f.x) * 4;
      this.saved.set(this.screen.subarray(from, from + f.w * 4), r * f.w * 4);
    }
  }

  private restoreRect(f: GifFrame): void {
    if (!this.saved) return;
    for (let r = 0; r < f.h; r++) this.screen.set(this.saved.subarray(r * f.w * 4, (r + 1) * f.w * 4), ((f.y + r) * this.width + f.x) * 4);
  }
}
