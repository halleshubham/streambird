import { PNG } from 'pngjs';
import * as jpeg from 'jpeg-js';
import { checkFrameWindow, shrinkRgba } from './image-pixels';

function frame(width: number, height: number, withWindow: boolean) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = withWindow && x >= width * 0.2 && y < height * 0.8;
      data.set(inside ? [255, 255, 255, 255] : [20, 40, 160, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}
const png = (f: ReturnType<typeof frame>) => {
  const p = new PNG({ width: f.width, height: f.height });
  f.data.copy(p.data);
  return PNG.sync.write(p);
};

describe('checkFrameWindow', () => {
  it('finds the window of a PNG frame', () => {
    const f = frame(320, 180, true);
    const r = checkFrameWindow(png(f), 'image/png', f);
    expect(r.status).toBe('found');
    if (r.status === 'found') {
      expect(r.w).toBeCloseTo(0.8, 1);
      expect(r.h).toBeCloseTo(0.8, 1);
    }
  });

  it('finds none in a picture without a window', () => {
    const f = frame(320, 180, false);
    expect(checkFrameWindow(png(f), 'image/png', f)).toEqual({ status: 'none' });
  });

  it('decodes a JPEG (a white window survives compression)', () => {
    const f = frame(320, 180, true);
    const enc = jpeg.encode({ data: f.data, width: f.width, height: f.height }, 95).data;
    expect(checkFrameWindow(enc, 'image/jpeg', f).status).toBe('found');
  });

  it('works on a big picture by shrinking it first', () => {
    const f = frame(1200, 675, true);
    expect(shrinkRgba(f).width).toBe(1000);
    expect(checkFrameWindow(png(f), 'image/png', f).status).toBe('found');
  });

  it('does not check GIF, WebP, huge or unreadable files, and never throws', () => {
    expect(checkFrameWindow(Buffer.from('GIF89a'), 'image/gif', { width: 10, height: 10 })).toMatchObject({ status: 'not_checked' });
    expect(checkFrameWindow(Buffer.alloc(40), 'image/webp', { width: 10, height: 10 })).toMatchObject({ status: 'not_checked' });
    expect(checkFrameWindow(Buffer.alloc(40), 'image/png', { width: 8000, height: 8000 })).toMatchObject({ status: 'not_checked', reason: expect.stringContaining('too large') });
    expect(checkFrameWindow(Buffer.alloc(40, 3), 'image/png', { width: 10, height: 10 })).toMatchObject({ status: 'not_checked' });
    expect(checkFrameWindow(Buffer.alloc(40, 3), 'image/jpeg', { width: 10, height: 10 })).toMatchObject({ status: 'not_checked' });
  });
});
