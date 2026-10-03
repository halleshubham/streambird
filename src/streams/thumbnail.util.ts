import { BadRequestException } from '@nestjs/common';

export interface ThumbnailImage {
  contentType: 'image/jpeg' | 'image/png';
  data: Buffer;
  width: number;
  height: number;
}

/** YouTube's own limit for custom thumbnails uploaded from some clients; stays safe everywhere. */
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
/** YouTube's documented minimum width for a custom thumbnail. */
export const MIN_THUMBNAIL_WIDTH = 640;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(buf: Buffer): { width: number; height: number } | null {
  // 8-byte signature, then the IHDR chunk: length(4) 'IHDR'(4) width(4) height(4)
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let i = 2; // skip SOI
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    // SOF0-SOF15 except DHT(C4), JPG(C8), DAC(CC) carry the frame size.
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + length;
  }
  return null;
}

/**
 * Validates an uploaded image by its actual bytes (the declared mimetype and
 * filename are user-controlled): must be a real JPEG or PNG, within the size
 * limit, and at least YouTube's minimum width. Returns the parsed image.
 */
export function parseThumbnail(data: Buffer | undefined): ThumbnailImage {
  if (!data || data.length === 0) throw new BadRequestException('Choose an image file to upload.');
  if (data.length > MAX_THUMBNAIL_BYTES) {
    throw new BadRequestException(`The image is too large -- the limit is ${MAX_THUMBNAIL_BYTES / 1024 / 1024} MB.`);
  }

  let contentType: ThumbnailImage['contentType'];
  let size: { width: number; height: number } | null;
  if (data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    contentType = 'image/png';
    size = pngSize(data);
  } else if (data[0] === 0xff && data[1] === 0xd8) {
    contentType = 'image/jpeg';
    size = jpegSize(data);
  } else {
    throw new BadRequestException('The thumbnail must be a JPG or PNG image.');
  }

  if (!size || size.width <= 0 || size.height <= 0) {
    throw new BadRequestException("That image file looks damaged -- couldn't read its size.");
  }
  if (size.width < MIN_THUMBNAIL_WIDTH) {
    throw new BadRequestException(`The image is too small -- it must be at least ${MIN_THUMBNAIL_WIDTH}px wide (1280x720 is recommended).`);
  }
  return { contentType, data, ...size };
}
