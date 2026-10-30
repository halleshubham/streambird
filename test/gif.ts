/**
 * Hand-built animated GIFs for tests: every frame is one solid colour, LZW-"compressed" with a clear code
 * every two pixels (valid, tiny, and no encoder dependency). Shared by the e2e and Playwright suites.
 */
export type Rgb = [number, number, number];

function lzwSolid(pixelCount: number, index: number): Buffer {
  // Min code size 2: clear = 4, end = 5, codes are 3 bits wide. A clear every 2 pixels keeps the width at 3.
  const bits: number[] = [];
  const put = (code: number) => {
    for (let i = 0; i < 3; i++) bits.push((code >> i) & 1);
  };
  put(4);
  for (let i = 0; i < pixelCount; i++) {
    put(index);
    if (i % 2 === 1 && i !== pixelCount - 1) put(4);
  }
  put(5);
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8 && i + j < bits.length; j++) v |= bits[i + j] << j;
    bytes.push(v);
  }
  const blocks: number[] = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    blocks.push(chunk.length, ...chunk);
  }
  blocks.push(0);
  return Buffer.from([2, ...blocks]);
}

/** A looping GIF89a of `colors.length` (max 4) solid frames, `delayMs` apart (stored in 1/100 s). */
export function solidGif(colors: Rgb[], opts: { width?: number; height?: number; delayMs?: number; signature?: 'GIF89a' | 'GIF87a' } = {}): Buffer {
  const { width = 16, height = 16, delayMs = 100, signature = 'GIF89a' } = opts;
  const palette = Buffer.alloc(12);
  colors.slice(0, 4).forEach((c, i) => Buffer.from(c).copy(palette, i * 3));
  const head = Buffer.alloc(13);
  head.write(signature, 0, 'ascii');
  head.writeUInt16LE(width, 6);
  head.writeUInt16LE(height, 8);
  head[10] = 0x80 | 0x01; // global colour table, 4 entries
  const parts: Buffer[] = [head, palette, Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0])];
  colors.slice(0, 4).forEach((_c, i) => {
    const gce = Buffer.from([0x21, 0xf9, 4, 0x04, 0, 0, 0, 0]); // disposal 1 (leave in place)
    gce.writeUInt16LE(Math.round(delayMs / 10), 4);
    const desc = Buffer.alloc(10);
    desc[0] = 0x2c;
    desc.writeUInt16LE(width, 5);
    desc.writeUInt16LE(height, 7);
    parts.push(gce, desc, lzwSolid(width * height, i));
  });
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}
