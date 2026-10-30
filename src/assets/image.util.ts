import { BadRequestException } from '@nestjs/common';

export const MAX_ASSET_BYTES = 4 * 1024 * 1024;
export const MAX_ASSET_SIDE = 8192;

export interface ParsedImage {
  contentType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  width: number;
  height: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(buf: Buffer) {
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegSize(buf: Buffer) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

function webpSize(buf: Buffer) {
  if (buf.length < 30) return null;
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  if (kind === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
  }
  return null;
}

/** GIF87a / GIF89a: the logical screen descriptor (bytes 6-9, little-endian) holds the canvas size. */
function gifSize(buf: Buffer) {
  if (buf.length < 13) return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function isGif(data: Buffer) {
  const head = data.toString('ascii', 0, 6);
  return head === 'GIF87a' || head === 'GIF89a';
}

/**
 * Validates an upload by its actual bytes (the declared type and filename are user-controlled).
 * `opts.allowGif` is true only for logos: an animated GIF is drawn by the studio for the logo, nowhere else.
 */
export function parseImage(data: Buffer | undefined, opts: { allowGif?: boolean } = {}): ParsedImage {
  if (!data || data.length === 0) throw new BadRequestException('Choose an image file to upload.');
  if (data.length > MAX_ASSET_BYTES) {
    throw new BadRequestException(`The image is too large -- the limit is ${MAX_ASSET_BYTES / 1024 / 1024} MB per file.`);
  }
  let contentType: ParsedImage['contentType'];
  let size: { width: number; height: number } | null;
  if (data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    contentType = 'image/png';
    size = pngSize(data);
  } else if (data[0] === 0xff && data[1] === 0xd8) {
    contentType = 'image/jpeg';
    size = jpegSize(data);
  } else if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    contentType = 'image/webp';
    size = webpSize(data);
  } else if (isGif(data)) {
    if (!opts.allowGif) throw new BadRequestException('GIF images can only be used as a logo. Use a PNG, JPG or WebP for this type of file.');
    contentType = 'image/gif';
    size = gifSize(data);
  } else {
    throw new BadRequestException('The file must be a PNG, JPG or WebP image (a GIF also works for logos).');
  }
  if (!size || size.width <= 0 || size.height <= 0) {
    throw new BadRequestException("That image file looks damaged -- couldn't read its size.");
  }
  if (size.width > MAX_ASSET_SIDE || size.height > MAX_ASSET_SIDE) {
    throw new BadRequestException(`The image is too big -- its longest side must be at most ${MAX_ASSET_SIDE}px.`);
  }
  return { contentType, ...size };
}
