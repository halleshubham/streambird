import { APIRequestContext, BrowserContext, expect, Page } from '@playwright/test';
import * as crypto from 'crypto';
import * as zlib from 'zlib';

// Shared helpers for the newer UI specs (smoke.spec.ts keeps its own copies). Not a spec file: Playwright only runs *.spec.ts.

export const CONTROL = `http://127.0.0.1:${process.env.UI_CONTROL_PORT ?? 4311}`;
export const APP = `http://127.0.0.1:${process.env.UI_APP_PORT ?? 4310}`;
export const apiHeaders = { Origin: APP, 'Content-Type': 'application/json' };

/** Signs the browser context in through the real email-code API (cookies land in the context), approving the user first. */
export async function signIn(context: BrowserContext, opts: { superadmin?: boolean } = {}): Promise<{ email: string; api: APIRequestContext }> {
  const email = `ui-${crypto.randomBytes(5).toString('hex')}@test.dev`;
  const api = context.request;
  const headers = { Origin: APP };
  await api.post(`${APP}/api/auth/request-code`, { data: { email }, headers });
  const { code } = await (await api.get(`${CONTROL}/code?email=${email}`)).json();
  const verified = await api.post(`${APP}/api/auth/verify-code`, { data: { email, code }, headers });
  expect(verified.ok()).toBeTruthy();
  await api.post(`${CONTROL}/approve?email=${email}${opts.superadmin ? '&superadmin=1' : ''}`);
  return { email, api };
}

/** The Free plan is the plan every test account is on: change it as the superadmin (and always put it back). */
export async function patchFreePlan(browser: import('@playwright/test').Browser, patch: { watermark?: boolean; assetStorageMb?: number }): Promise<void> {
  const ctx = await browser.newContext();
  const admin = await signIn(ctx, { superadmin: true });
  const res = await admin.api.patch(`${APP}/api/superadmin/plans/free`, { data: patch, headers: apiHeaders });
  expect(res.ok()).toBeTruthy();
  await ctx.close();
}

export async function newStream(api: APIRequestContext, orientation?: 'landscape' | 'portrait'): Promise<string> {
  const conn = await (
    await api.post(`${APP}/api/platform-connections/twitch/manual`, {
      data: { label: 'UI Twitch', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' },
      headers: apiHeaders,
    })
  ).json();
  const stream = await (await api.post(`${APP}/api/streams`, { data: { title: 'UI ads stream', orientation, destinationConnectionIds: [conn.id] }, headers: apiHeaders })).json();
  return stream.id as string;
}

export type StudioTabName = 'People' | 'Look' | 'Titles' | 'Scenes' | 'Ads';
export const studioTab = (page: Page, name: StudioTabName) => page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();

/** A solid-colour PNG of any size, built by hand (zlib + CRC) so a test knows every pixel it will see on the canvas. */
export function solidPng(r: number, g: number, b: number, width = 16, height = width): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** A RGBA PNG built by hand from a per-pixel function (zlib + CRC), for pictures with a known layout (a frame with a window). */
export function rgbaPng(width: number, height: number, px: (x: number, y: number) => [number, number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (width * 4 + 1);
    raw[o] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = px(x, y);
      raw[o + 1 + x * 4] = r;
      raw[o + 2 + x * 4] = g;
      raw[o + 3 + x * 4] = b;
      raw[o + 4 + x * 4] = a;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export interface FrameSpec {
  width: number;
  height: number;
  /** The window, in pixels: [x0, y0, x1, y1) */
  win: [number, number, number, number];
  /** The colour of the frame around the window (and the column / band). */
  frame: [number, number, number];
  /** 'white' = plain white, 'clear' = transparent, or a colour (= no clear window). */
  window?: 'white' | 'clear' | [number, number, number];
}
/** A frame graphic like a news channel's: a coloured frame around a plain window. Frame 1280x720 with win [256,0,1280,576] is the founder's sample shape. */
export const framePng = (f: FrameSpec): Buffer =>
  rgbaPng(f.width, f.height, (x, y) => {
    const inside = x >= f.win[0] && x < f.win[2] && y >= f.win[1] && y < f.win[3];
    if (!inside) return [f.frame[0], f.frame[1], f.frame[2], 255];
    if (f.window === 'clear') return [0, 0, 0, 0];
    if (Array.isArray(f.window)) return [f.window[0], f.window[1], f.window[2], 255];
    return [255, 255, 255, 255];
  });

/** The colour of the studio canvas at a point (the canvas keeps its 2D context, so this reads what viewers get). */
export const canvasPixel = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([px, py]) => {
      const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(Math.round(px), Math.round(py), 1, 1).data;
      return [d[0], d[1], d[2]] as [number, number, number];
    },
    [x, y],
  );

export const canvasSize = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement;
    return { width: c.width, height: c.height };
  });

export type Rgb = [number, number, number];
export const isRed = (p: Rgb) => p[0] > 200 && p[1] < 60 && p[2] < 60;
export const isGreen = (p: Rgb) => p[1] > 200 && p[0] < 60 && p[2] < 60;
export const isBlue = (p: Rgb) => p[2] > 200 && p[0] < 60 && p[1] < 60;
export const isPlainAd = (p: Rgb) => isRed(p) || isGreen(p) || isBlue(p);

/** Pins the ad clock to `sec` seconds since going live (the studio's test hook), so a test does not have to wait for a schedule. */
export const pinAdClock = (page: Page, sec: number | null) =>
  page.evaluate((s) => {
    // The hook only works when armed (and never on the Free plan).
    localStorage.setItem('streambird:test:adclock', 'on');
    (window as unknown as { __SB_TEST_AD_ELAPSED__?: number }).__SB_TEST_AD_ELAPSED__ = s === null ? undefined : s;
  }, sec);

/** The in-app confirm dialog (components/ui/ConfirmDialog.tsx; replaces window.confirm). */
export function confirmDialog(page: Page) {
  return page.getByTestId('confirm-dialog');
}
/** Clicks the confirm button of the open confirm dialog. */
export async function acceptConfirm(page: Page): Promise<void> {
  await confirmDialog(page).getByTestId('confirm-accept').click();
  await expect(confirmDialog(page)).toHaveCount(0);
}
/** Clicks Cancel in the open confirm dialog. */
export async function cancelConfirm(page: Page): Promise<void> {
  await confirmDialog(page).getByTestId('confirm-cancel').click();
  await expect(confirmDialog(page)).toHaveCount(0);
}
