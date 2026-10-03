import { BadRequestException } from '@nestjs/common';
import { MAX_THUMBNAIL_BYTES, parseThumbnail } from './thumbnail.util';

/** Minimal real PNG header + padding with the given size (IHDR is all the parser reads). */
function png(width: number, height: number, extra = 0): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, Buffer.alloc(extra)]);
}

/** Minimal JPEG: SOI, an APP0 segment (to prove segments are skipped), then SOF0 with the size. */
function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0)]);
  const sof = Buffer.alloc(19);
  sof[0] = 0xff; sof[1] = 0xc0; sof.writeUInt16BE(17, 2); sof[4] = 8;
  sof.writeUInt16BE(height, 5); sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

describe('parseThumbnail', () => {
  it('reads the size of a PNG and a JPEG from their bytes', () => {
    expect(parseThumbnail(png(1280, 720))).toMatchObject({ contentType: 'image/png', width: 1280, height: 720 });
    expect(parseThumbnail(jpeg(1920, 1080))).toMatchObject({ contentType: 'image/jpeg', width: 1920, height: 1080 });
  });

  it('rejects anything that is not really a JPG or PNG, whatever it is called', () => {
    expect(() => parseThumbnail(Buffer.from('GIF89a....................................'))).toThrow(/JPG or PNG/);
    expect(() => parseThumbnail(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toThrow(/JPG or PNG/);
  });

  it('rejects empty, oversized and too-small images with clear messages', () => {
    expect(() => parseThumbnail(undefined)).toThrow(BadRequestException);
    expect(() => parseThumbnail(Buffer.alloc(0))).toThrow(/Choose an image/);
    expect(() => parseThumbnail(png(1280, 720, MAX_THUMBNAIL_BYTES))).toThrow(/too large/);
    expect(() => parseThumbnail(png(320, 180))).toThrow(/at least 640px wide/);
  });

  it('rejects a damaged image whose size cannot be read', () => {
    expect(() => parseThumbnail(Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0]))).toThrow(/damaged/);
  });
});
