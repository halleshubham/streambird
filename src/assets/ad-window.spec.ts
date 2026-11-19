import * as fs from 'fs';
import * as path from 'path';
import { detectWindow } from './ad-window';

const body = (file: string) => {
  const text = fs.readFileSync(file, 'utf8');
  return text.slice(text.indexOf('export interface PixelImage'));
};

describe('ad-window (server copy of the studio window detection)', () => {
  it('has the same code as web-app/src/studio/adWindow.ts', () => {
    expect(body(path.join(__dirname, 'ad-window.ts'))).toBe(body(path.join(__dirname, '../../web-app/src/studio/adWindow.ts')));
  });

  it('finds the clear window of a frame and none in a solid picture', () => {
    const W = 160;
    const H = 90;
    const data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const inside = x >= 10 && x < 130 && y >= 8 && y < 70;
        data.set(inside ? [0, 0, 0, 0] : [200, 20, 20, 255], (y * W + x) * 4);
      }
    }
    const win = detectWindow({ data, width: W, height: H })!;
    expect(win.w).toBeCloseTo(120 / W, 1);
    expect(win.h).toBeCloseTo(62 / H, 1);
    const solid = new Uint8Array(W * H * 4).fill(30);
    for (let i = 3; i < solid.length; i += 4) solid[i] = 255;
    expect(detectWindow({ data: solid, width: W, height: H })).toBeNull();
  });
});
