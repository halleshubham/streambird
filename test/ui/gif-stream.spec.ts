import { expect, test, type Page } from '@playwright/test';
import { solidGif } from '../gif';
import { buildGif } from '../gifbuilder';
import { adRect, fitAd } from '../../web-app/src/studio/ads';
import { canvasPixel, canvasSize, isBlue, isGreen, isRed, newStream, patchFreePlan, pinAdClock, signIn, studioTab, type Rgb } from './helpers';
import * as crypto from 'crypto';

// Animated GIFs must animate on the BROADCAST, not only in the preview. These tests run with WebCodecs ImageDecoder
// removed (what Firefox looks like) so the built-in GIF decoder is what animates, check long GIFs are subsampled
// rather than left still, check the notice when a GIF cannot animate, and read frames back out of
// canvas.captureStream() (the exact track that is published) to prove the stream itself changes colour.

const RED: Rgb = [255, 0, 0];
const GREEN: Rgb = [0, 255, 0];
const BLUE: Rgb = [0, 0, 255];
const WHITE: Rgb = [255, 255, 255];
const isWhite = (p: Rgb) => p[0] > 200 && p[1] > 200 && p[2] > 200;
const colourName = (p: Rgb) => (isRed(p) ? 'red' : isGreen(p) ? 'green' : isBlue(p) ? 'blue' : isWhite(p) ? 'white' : null);

const noImageDecoder = (page: Page) =>
  page.addInitScript(() => {
    delete (window as unknown as { ImageDecoder?: unknown }).ImageDecoder;
  });

async function openStudio(page: Page, id: string) {
  await page.goto(`/streams/${id}/studio`);
  await page.locator('canvas.studio-canvas').waitFor();
}

/** Polls a canvas point until every wanted colour has been there at least once. */
async function seesColours(page: Page, x: number, y: number, want: string[], timeout = 20_000) {
  const seen = new Set<string>();
  await expect
    .poll(
      async () => {
        const c = colourName(await canvasPixel(page, x, y));
        if (c) seen.add(c);
        return [...seen].sort().join('+');
      },
      { timeout, intervals: [30] },
    )
    .toBe([...want].sort().join('+'));
}

/**
 * Reads `ms` of the studio canvas's captureStream() (the same MediaStreamTrack the publisher sends) through a
 * <video> element drawn back onto a 2D canvas, and returns the distinct colours seen at (x, y) in those VIDEO frames.
 */
async function colourSeenInCapturedStream(page: Page, x: number, y: number, ms: number): Promise<{ colours: string[]; frames: number }> {
  return page.evaluate(
    async ([px, py, duration]) => {
      const canvas = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement;
      const stream = canvas.captureStream(30);
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      const probe = document.createElement('canvas');
      probe.width = canvas.width;
      probe.height = canvas.height;
      const ctx = probe.getContext('2d', { willReadFrequently: true })!;
      const seen = new Set<string>();
      let frames = 0;
      const end = performance.now() + duration;
      while (performance.now() < end) {
        ctx.drawImage(video, 0, 0);
        const d = ctx.getImageData(px, py, 1, 1).data;
        frames++;
        if (d[0] > 150 && d[1] < 90 && d[2] < 90) seen.add('red');
        else if (d[2] > 150 && d[0] < 90 && d[1] < 120) seen.add('blue');
        else if (d[1] > 150 && d[0] < 90 && d[2] < 90) seen.add('green');
        await new Promise((r) => setTimeout(r, 40));
      }
      stream.getTracks().forEach((t) => t.stop());
      return { colours: [...seen].sort(), frames };
    },
    [x, y, ms] as const,
  );
}

const LOGO_X = 16 + 45;
const LOGO_Y = 16 + 45;
const logoGif = solidGif([RED, GREEN, BLUE], { width: 16, height: 16, delayMs: 100 });
const setLogo = async (page: Page, file: { name: string; mimeType: string; buffer: Buffer }) => {
  await studioTab(page, 'Look');
  await page.locator('#logoInput').setInputFiles(file);
};

test.describe('GIF logo on the broadcast', () => {
  test('without ImageDecoder a 3-colour GIF logo cycles on the canvas and in the captured stream track', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await noImageDecoder(page);
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    expect(await page.evaluate(() => 'ImageDecoder' in window)).toBe(false);
    await setLogo(page, { name: 'spin.gif', mimeType: 'image/gif', buffer: logoGif });
    await seesColours(page, LOGO_X, LOGO_Y, ['red', 'green', 'blue']);
    // The stream: frames pulled out of canvas.captureStream() change colour too (this is what YouTube/Facebook receive).
    const captured = await colourSeenInCapturedStream(page, LOGO_X, LOGO_Y, 2500);
    expect(captured.frames).toBeGreaterThan(10);
    expect(captured.colours).toEqual(['blue', 'green', 'red']);
    await expect(page.getByTestId('logo-still-notice')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('control: a still logo gives ONE colour in the captured stream, so the test above really measures animation', async ({ page, context }) => {
    await noImageDecoder(page);
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    await setLogo(page, { name: 'still.gif', mimeType: 'image/gif', buffer: solidGif([RED]) });
    await seesColours(page, LOGO_X, LOGO_Y, ['red']);
    expect((await colourSeenInCapturedStream(page, LOGO_X, LOGO_Y, 1500)).colours).toEqual(['red']);
  });

  test('the same in a browser WITH ImageDecoder (the native path) and the captured stream moves too', async ({ page, context }) => {
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    if (!(await page.evaluate(() => 'ImageDecoder' in window))) test.skip(true, 'this browser has no ImageDecoder');
    await setLogo(page, { name: 'spin.gif', mimeType: 'image/gif', buffer: logoGif });
    await seesColours(page, LOGO_X, LOGO_Y, ['red', 'green', 'blue']);
    expect((await colourSeenInCapturedStream(page, LOGO_X, LOGO_Y, 2500)).colours).toEqual(['blue', 'green', 'red']);
  });

  test('an ImageDecoder that fails falls back to the built-in decoder', async ({ page, context }) => {
    await page.addInitScript(() => {
      (window as unknown as { ImageDecoder: unknown }).ImageDecoder = class {
        constructor() {
          throw new Error('decoder broken on purpose');
        }
        static async isTypeSupported() {
          return true;
        }
      };
    });
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    await setLogo(page, { name: 'spin.gif', mimeType: 'image/gif', buffer: logoGif });
    await seesColours(page, LOGO_X, LOGO_Y, ['red', 'green', 'blue']);
    await expect(page.getByTestId('logo-still-notice')).toHaveCount(0);
  });

  // 200 frames of 160x90 (over the 150-frame cap): three colour blocks, 30 ms per frame, so a still frame would show only one.
  const longGif = buildGif({
    width: 160,
    height: 90,
    palette: [RED, GREEN, BLUE, WHITE],
    frames: Array.from({ length: 200 }, (_, i) => ({ pixels: Array(160 * 90).fill(Math.floor(i / 67)), delayCs: 3, disposal: 1 as const })),
  });
  for (const mode of ['without ImageDecoder', 'with ImageDecoder']) {
    test(`a 200-frame GIF animates by subsampling instead of staying still (${mode})`, async ({ page, context }) => {
      if (mode === 'without ImageDecoder') await noImageDecoder(page);
      const { api } = await signIn(context);
      await openStudio(page, await newStream(api));
      if (mode === 'with ImageDecoder' && !(await page.evaluate(() => 'ImageDecoder' in window))) test.skip(true, 'this browser has no ImageDecoder');
      await setLogo(page, { name: 'long.gif', mimeType: 'image/gif', buffer: longGif });
      await seesColours(page, LOGO_X, LOGO_Y, ['red', 'green', 'blue']);
      await expect(page.getByTestId('logo-still-notice')).toHaveCount(0);
    });
  }

  test('a GIF that cannot be decoded shows a notice by the logo controls (and a normal logo does not)', async ({ page, context }) => {
    await noImageDecoder(page);
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    // A single-frame GIF is not an animation: no notice.
    await setLogo(page, { name: 'one.gif', mimeType: 'image/gif', buffer: solidGif([RED]) });
    await page.waitForTimeout(500);
    await expect(page.getByTestId('logo-still-notice')).toHaveCount(0);
    // Corrupt GIF: header and then noise.
    await page.locator('#logoInput').setInputFiles({ name: 'broken.gif', mimeType: 'image/gif', buffer: Buffer.concat([Buffer.from('GIF89a'), crypto.randomBytes(40)]) });
    const notice = page.getByTestId('logo-still-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('will not animate on the stream');
    await expect(notice).toContainText('Chrome or Edge');
    // Picking a good GIF clears it again.
    await page.locator('#logoInput').setInputFiles({ name: 'spin.gif', mimeType: 'image/gif', buffer: logoGif });
    await expect(notice).toHaveCount(0);
    await seesColours(page, LOGO_X, LOGO_Y, ['red', 'green', 'blue']);
  });
});

test.describe('GIF ad on the broadcast', () => {
  test.beforeEach(async ({ browser }) => patchFreePlan(browser, { watermark: false }));
  test.afterEach(async ({ browser }) => patchFreePlan(browser, { watermark: true }));

  const adGif = solidGif([RED, GREEN, BLUE], { width: 128, height: 24, delayMs: 100 });
  const addAd = async (page: Page, file: { name: string; mimeType: string; buffer: Buffer }) => {
    await studioTab(page, 'Ads');
    await page.locator('#adFile-lower_third').setInputFiles(file);
    await expect(page.getByTestId('ad-card-lower_third').locator('.ad-file-name')).toHaveText(file.name);
  };
  const centre = async (page: Page) => {
    const { width: W, height: H } = await canvasSize(page);
    const r = fitAd('lower_third', 128, 24, adRect('lower_third', W, H));
    return [r.x + r.w / 2, r.y + r.h / 2] as const;
  };

  test('without ImageDecoder an ad GIF cycles on the canvas and in the captured stream track', async ({ page, context }) => {
    await noImageDecoder(page);
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    const [x, y] = await centre(page);
    await pinAdClock(page, 0);
    await addAd(page, { name: 'spin.gif', mimeType: 'image/gif', buffer: adGif });
    await seesColours(page, x, y, ['red', 'green', 'blue']);
    expect((await colourSeenInCapturedStream(page, x, y, 2500)).colours).toEqual(['blue', 'green', 'red']);
    await expect(page.getByTestId('ad-still-lower_third')).toHaveCount(0);
  });

  test('an ad GIF the browser can show but nothing can decode keeps its first frame and says so', async ({ page, context }) => {
    await noImageDecoder(page);
    // Same GIF, but the logical screen claims 4100 x 4100: <img> still draws it, our decoder refuses absurd sizes.
    const lying = Buffer.from(adGif);
    lying.writeUInt16LE(4100, 6);
    lying.writeUInt16LE(4100, 8);
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    await pinAdClock(page, 0);
    await addAd(page, { name: 'huge.gif', mimeType: 'image/gif', buffer: lying });
    const note = page.getByTestId('ad-still-lower_third');
    await expect(note).toBeVisible();
    await expect(note).toContainText('will not animate on the stream');
  });
});
