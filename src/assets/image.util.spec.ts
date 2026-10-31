import { parseImage } from './image.util';

const png = (w: number, h: number) => {
  const b = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const webp = (kind: 'VP8X' | 'VP8 ' | 'VP8L', w: number, h: number) => {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  b.write(kind, 12, 'ascii');
  if (kind === 'VP8X') {
    b.writeUIntLE(w - 1, 24, 3);
    b.writeUIntLE(h - 1, 27, 3);
  } else if (kind === 'VP8 ') {
    b.writeUInt16LE(w, 26);
    b.writeUInt16LE(h, 28);
  } else {
    b.writeUInt32LE((w - 1) | ((h - 1) << 14), 21);
  }
  return b;
};

describe('parseImage', () => {
  it('reads PNG and WebP sizes from the bytes', () => {
    expect(parseImage(png(640, 360))).toEqual({ contentType: 'image/png', width: 640, height: 360 });
    expect(parseImage(webp('VP8X', 1920, 1080))).toEqual({ contentType: 'image/webp', width: 1920, height: 1080 });
    expect(parseImage(webp('VP8 ', 800, 600))).toMatchObject({ width: 800, height: 600 });
    expect(parseImage(webp('VP8L', 300, 200))).toMatchObject({ width: 300, height: 200 });
  });
  it('reads a JPEG size', () => {
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseImage(jpg)).toEqual({ contentType: 'image/jpeg', width: 400, height: 300 });
  });
  it('refuses empty, oversized, unknown and too-big-in-pixels files', () => {
    expect(() => parseImage(undefined)).toThrow();
    expect(() => parseImage(Buffer.from('<svg/>'))).toThrow(/PNG, JPG or WebP/);
    expect(() => parseImage(Buffer.concat([png(10, 10), Buffer.alloc(4 * 1024 * 1024)]))).toThrow(/too large/);
    expect(() => parseImage(png(9000, 10))).toThrow(/too big/);
  });
  describe('GIF (logos and ads only)', () => {
    const gif = (sig: string, w: number, h: number) => {
      const b = Buffer.alloc(20);
      b.write(sig, 0, 'ascii');
      b.writeUInt16LE(w, 6);
      b.writeUInt16LE(h, 8);
      return b;
    };
    it('reads GIF87a and GIF89a sizes from the logical screen descriptor', () => {
      expect(parseImage(gif('GIF89a', 320, 180), { allowGif: true })).toEqual({ contentType: 'image/gif', width: 320, height: 180 });
      expect(parseImage(gif('GIF87a', 5, 7), { allowGif: true })).toMatchObject({ contentType: 'image/gif', width: 5, height: 7 });
    });
    it('refuses a GIF for anything but a logo or an ad, with a clear message', () => {
      expect(() => parseImage(gif('GIF89a', 10, 10))).toThrow(/GIF images can only be used as a logo or an ad/);
    });
    it('applies the same size limits and rejects damaged GIFs', () => {
      expect(() => parseImage(gif('GIF89a', 9000, 10), { allowGif: true })).toThrow(/too big/);
      expect(() => parseImage(gif('GIF89a', 0, 10), { allowGif: true })).toThrow(/damaged/);
      expect(() => parseImage(Buffer.from('GIF89a'), { allowGif: true })).toThrow(/damaged/);
      expect(() => parseImage(Buffer.concat([gif('GIF89a', 10, 10), Buffer.alloc(4 * 1024 * 1024)]), { allowGif: true })).toThrow(/too large/);
      expect(() => parseImage(Buffer.from('GIF90a-not-a-gif-at-all'), { allowGif: true })).toThrow(/PNG, JPG or WebP/);
    });
  });
});
