import { expect, test, type Page } from '@playwright/test';
import {
  AD_DRAW_ORDER,
  AD_PLACEMENTS,
  adRect,
  fitAd,
  lShapeSceneRect,
  resolveAdAlphas,
  sceneRectFor,
  shrinkEase,
  windowOnCanvas,
  type AdSlot,
} from '../../web-app/src/studio/ads';
import { detectWindow, isClearPixel, type PixelImage } from '../../web-app/src/studio/adWindow';
import { APP, apiHeaders, canvasPixel, canvasSize, framePng, isBlue, isRed, newStream, patchFreePlan, pinAdClock, signIn, solidPng, studioTab } from './helpers';

// L-shaped (frame) ads. Part 1 is pure (no browser): window detection on synthetic pixels and the geometry/priority rules,
// the same numbers as the spec in ads.ts / adWindow.ts that the Android port repeats. Part 2 drives the real studio and
// reads canvas pixels: the scene sits inside the window, the frame colours outside it.

/** Synthetic RGBA picture: `px(x, y)` gives each pixel. */
function image(width: number, height: number, px: (x: number, y: number) => [number, number, number, number]): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = px(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width, height };
}
const NAVY: [number, number, number, number] = [10, 30, 120, 255];
const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];
/** A frame: `win` = [x0, y0, x1, y1) is the window pixel colour, everything else navy. */
const framed = (w: number, h: number, win: [number, number, number, number], inside: [number, number, number, number] = WHITE) =>
  image(w, h, (x, y) => (x >= win[0] && x < win[2] && y >= win[1] && y < win[3] ? inside : NAVY));
const close = (a: number, b: number, tol = 0.006) => Math.abs(a - b) <= tol;
const expectWin = (got: ReturnType<typeof detectWindow>, x: number, y: number, w: number, h: number) => {
  expect(got).not.toBeNull();
  expect(close(got!.x, x)).toBe(true);
  expect(close(got!.y, y)).toBe(true);
  expect(close(got!.w, w)).toBe(true);
  expect(close(got!.h, h)).toBe(true);
};

test.describe('L-shape window detection (pure)', () => {
  test("the founder's sample: 1280x720, coloured left column (20%) and bottom band (20%), plain white 16:9 window x 256-1280, y 0-576", () => {
    const win = detectWindow(framed(1280, 720, [256, 0, 1280, 576]));
    expectWin(win, 0.2, 0, 0.8, 0.8);
    // exactly 16:9 in pixels
    expect(Math.round((win!.w * 1280) / (win!.h * 720) * 100) / 100).toBe(1.78);
  });

  test('a transparent window works the same as a white one', () => {
    expectWin(detectWindow(framed(1280, 720, [256, 0, 1280, 576], CLEAR)), 0.2, 0, 0.8, 0.8);
  });

  test('right column + bottom band, top band + left column, a frame all around, and a centred window', () => {
    expectWin(detectWindow(framed(1280, 720, [0, 0, 1024, 576])), 0, 0, 0.8, 0.8); // right + bottom
    expectWin(detectWindow(framed(1280, 720, [256, 144, 1280, 720])), 0.2, 0.2, 0.8, 0.8); // left + top
    expectWin(detectWindow(framed(1280, 720, [128, 72, 1152, 648])), 0.1, 0.1, 0.8, 0.8); // all around
    expectWin(detectWindow(framed(1920, 1080, [384, 0, 1920, 864])), 0.2, 0, 0.8, 0.8); // another size, same fractions
  });

  test('a vertical (9:16) frame: window above a band, with a column of colour at the sides', () => {
    expectWin(detectWindow(framed(1080, 1920, [0, 0, 1080, 1080])), 0, 0, 1, 0.5625); // full width, top part
    expectWin(detectWindow(framed(1080, 1920, [54, 192, 1026, 1500])), 0.05, 0.1, 0.9, 0.68125);
  });

  test('clear = alpha < 16, or opaque near-white with min(r,g,b) >= 246', () => {
    expect(isClearPixel(0, 0, 0, 0)).toBe(true);
    expect(isClearPixel(10, 20, 30, 15)).toBe(true);
    expect(isClearPixel(10, 20, 30, 16)).toBe(false);
    expect(isClearPixel(255, 255, 255, 255)).toBe(true);
    expect(isClearPixel(246, 247, 255, 255)).toBe(true);
    expect(isClearPixel(245, 255, 255, 255)).toBe(false);
    expect(isClearPixel(255, 255, 255, 120)).toBe(false); // half-transparent white is not a window
    // A JPEG's slightly off-white still counts.
    expectWin(detectWindow(framed(1280, 720, [256, 0, 1280, 576], [250, 251, 249, 255])), 0.2, 0, 0.8, 0.8);
    // Grey (240) does not.
    expect(detectWindow(framed(1280, 720, [256, 0, 1280, 576], [240, 240, 240, 255]))).toBeNull();
  });

  test('no window: a picture with no clear region, a fully white picture, a tiny window, a ragged clear area', () => {
    expect(detectWindow(image(1280, 720, () => NAVY))).toBeNull(); // nothing clear
    expect(detectWindow(image(1280, 720, () => WHITE))).toBeNull(); // the whole picture: not a frame
    expect(detectWindow(image(1280, 720, () => CLEAR))).toBeNull();
    expect(detectWindow(framed(1280, 720, [560, 310, 720, 410]))).toBeNull(); // 12% x 14% of the frame: too small
    expect(detectWindow(framed(1280, 720, [500, 200, 780, 520]))).toBeNull(); // 22% x 44%, area 9.6%: under a quarter of the picture
    // The clear area that holds the centre is an L, not a window: refused (its box would cover colour).
    expect(detectWindow(image(1280, 720, (x, y) => (x < 400 || y > 500 ? WHITE : NAVY)))).toBeNull();
  });

  test('a window narrower than 20% of the width or height is refused even when it is tall', () => {
    expect(detectWindow(framed(1280, 720, [600, 0, 800, 720]))).toBeNull(); // 15.6% wide
  });

  test('only the clear region around the centre counts: a white patch in a corner is ignored', () => {
    const img = image(1280, 720, (x, y) => {
      if (x >= 256 && x < 1280 && y >= 0 && y < 576) return WHITE;
      if (x < 100 && y > 620) return WHITE; // a white logo in the corner of the column
      return NAVY;
    });
    expectWin(detectWindow(img), 0.2, 0, 0.8, 0.8);
  });

  test('text or a logo sitting on the centre does not hide the window (the nearest clear cell seeds it)', () => {
    const img = image(1280, 720, (x, y) => {
      if (x >= 600 && x < 680 && y >= 320 && y < 400) return [200, 30, 30, 255]; // a mark exactly on the centre
      return x >= 256 && y < 576 ? WHITE : NAVY;
    });
    const win = detectWindow(img);
    // The mark is a hole inside the clear region: the box still spans the window.
    expectWin(win, 0.2, 0, 0.8, 0.8);
  });

  test('the box is exact to the pixel, not to the 4 px grid', () => {
    const win = detectWindow(framed(1280, 720, [259, 3, 1277, 573]));
    expect(win).not.toBeNull();
    expect(Math.abs(win!.x * 1280 - 259)).toBeLessThanOrEqual(1);
    expect(Math.abs(win!.y * 720 - 3)).toBeLessThanOrEqual(1);
    expect(Math.abs((win!.x + win!.w) * 1280 - 1277)).toBeLessThanOrEqual(1);
    expect(Math.abs((win!.y + win!.h) * 720 - 573)).toBeLessThanOrEqual(1);
  });

  test('bounded work: a 4096x2304 picture is scanned in well under a second, and bad input is refused', () => {
    const big = framed(4096, 2304, [819, 0, 4096, 1843]);
    const t0 = Date.now();
    const win = detectWindow(big);
    expect(Date.now() - t0).toBeLessThan(1500);
    expectWin(win, 0.2, 0, 0.8, 0.8);
    expect(detectWindow({ data: new Uint8ClampedArray(16), width: 2, height: 2 })).toBeNull();
    expect(detectWindow({ data: new Uint8ClampedArray(10), width: 100, height: 100 })).toBeNull();
  });
});

test.describe('L-shape geometry and priority (pure)', () => {
  test('l_shape is a fourth placement: it covers the whole frame, is picked after the other three in the UI and is a base layer in the draw order', () => {
    expect(AD_PLACEMENTS).toEqual(['lower_third', 'side_third', 'full_screen', 'l_shape']);
    expect(AD_DRAW_ORDER).toContain('l_shape');
    expect(adRect('l_shape', 1920, 1080, 90)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 }); // the ticker does not move it
    expect(adRect('l_shape', 1080, 1920)).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
    expect(fitAd('l_shape', 1280, 720, adRect('l_shape', 1920, 1080))).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    // A picture of another shape is contained and centred: nothing of the frame is cropped.
    expect(fitAd('l_shape', 1000, 1000, adRect('l_shape', 1920, 1080))).toEqual({ x: 420, y: 0, w: 1080, h: 1080 });
  });

  test("the sample frame on a 1920x1080 canvas puts the window at x 384-1920, y 0-864 and the scene fills it exactly (16:9 in 16:9)", () => {
    const fitted = fitAd('l_shape', 1280, 720, adRect('l_shape', 1920, 1080));
    const window = windowOnCanvas(fitted, { x: 0.2, y: 0, w: 0.8, h: 0.8 });
    expect(window).toEqual({ x: 384, y: 0, w: 1536, h: 864 });
    expect(lShapeSceneRect(1920, 1080, window)).toEqual({ x: 384, y: 0, w: 1536, h: 864 });
    // A window of another shape: the scene keeps 16:9 and is centred (letterbox in the window's colour).
    expect(lShapeSceneRect(1920, 1080, { x: 100, y: 50, w: 800, h: 600 })).toEqual({ x: 100, y: 50 + (600 - 450) / 2, w: 800, h: 450 });
    expect(lShapeSceneRect(1080, 1920, { x: 100, y: 50, w: 800, h: 600 })).toEqual({ x: 100 + (800 - 337.5) / 2, y: 50, w: 337.5, h: 600 });
    // Never larger than the canvas.
    expect(lShapeSceneRect(1920, 1080, { x: 0, y: 0, w: 4000, h: 4000 })).toEqual({ x: 1040, y: 1460, w: 1920, h: 1080 });
  });

  test('the scene eases from full frame to the window in step with the ad fade (smoothstep), alone or on top of other ads', () => {
    const W = 1920;
    const H = 1080;
    const window = { x: 384, y: 0, w: 1536, h: 864 };
    expect(sceneRectFor(W, H, {})).toEqual({ x: 0, y: 0, w: W, h: H });
    expect(sceneRectFor(W, H, { l_shape: { alpha: 0, window } })).toEqual({ x: 0, y: 0, w: W, h: H });
    expect(sceneRectFor(W, H, { l_shape: { alpha: 1, window } })).toEqual(window);
    const half = sceneRectFor(W, H, { l_shape: { alpha: 0.5, window } });
    const k = shrinkEase(0.5);
    expect(half.w).toBeCloseTo(W + (1536 - W) * k, 6);
    expect(half.h).toBeCloseTo(H + (864 - H) * k, 6);
    expect(half.x).toBeCloseTo(384 * k, 6);
    // A frame with no window does not shrink anything.
    expect(sceneRectFor(W, H, { l_shape: { alpha: 1, window: null } })).toEqual({ x: 0, y: 0, w: W, h: H });
  });

  test('priority: the frame suppresses lower and left thirds, full screen overrides everything', () => {
    const slot = (placement: AdSlot['placement']): AdSlot => ({ placement, enabled: true, schedule: { mode: 'continuous' }, manual: null });
    const all = [slot('lower_third'), slot('side_third'), slot('l_shape')];
    expect(resolveAdAlphas(0, all)).toEqual({ lower_third: 0, side_third: 0, full_screen: 0, l_shape: 1 });
    // No frame: the other two show as before.
    expect(resolveAdAlphas(0, [slot('lower_third'), slot('side_third')])).toEqual({ lower_third: 1, side_third: 1, full_screen: 0, l_shape: 0 });
    // Full screen on top of everything: only full screen is left.
    expect(resolveAdAlphas(0, [...all, slot('full_screen')])).toEqual({ lower_third: 0, side_third: 0, full_screen: 1, l_shape: 0 });
    // The frame on a schedule: while it is hidden the lower third is back; while shown it is gone.
    const timed: AdSlot = { placement: 'l_shape', enabled: true, schedule: { mode: 'interval', showSec: 10, everySec: 20 }, manual: null };
    expect(resolveAdAlphas(5, [slot('lower_third'), timed]).lower_third).toBe(1); // hidden phase
    expect(resolveAdAlphas(25, [slot('lower_third'), timed])).toEqual({ lower_third: 0, side_third: 0, full_screen: 0, l_shape: 1 });
    // A manual hide of the frame gives the lower third back.
    expect(resolveAdAlphas(0, [slot('lower_third'), { ...slot('l_shape'), manual: 'hidden' }]).lower_third).toBe(1);
  });
});

// ---- Part 2: the real studio -------------------------------------------------------------------------------

const FRAME = { width: 1280, height: 720, win: [256, 0, 1280, 576] as [number, number, number, number], frame: [200, 20, 20] as [number, number, number] };
const PORTRAIT_FRAME = { width: 720, height: 1280, win: [0, 0, 720, 900] as [number, number, number, number], frame: [200, 20, 20] as [number, number, number] };

async function openStudio(page: Page, id: string) {
  await page.goto(`/streams/${id}/studio`);
  await page.locator('canvas.studio-canvas').waitFor();
  await studioTab(page, 'Look');
  // A solid BLUE logo marks the scene: its pixels tell where the scene is drawn.
  await page.locator('#logoInput').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: solidPng(0, 0, 255, 64, 64) });
  await expect.poll(async () => (await blueBox(page))?.w ?? 0).toBeGreaterThan(80);
}
const blueBox = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement;
    const { width, height } = c;
    const d = c.getContext('2d')!.getImageData(0, 0, width, height).data;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const i = (y * width + x) * 4;
        if (d[i] < 60 && d[i + 1] < 60 && d[i + 2] > 200) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 2, h: y1 - y0 + 2 };
  });
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
async function addFrame(page: Page, spec: Parameters<typeof framePng>[0], name = 'frame.png') {
  await studioTab(page, 'Ads');
  await page.locator('#adFile-l_shape').setInputFiles({ name, mimeType: 'image/png', buffer: framePng(spec) });
  await expect(page.getByTestId('ad-card-l_shape').locator('.ad-file-name')).toHaveText(name);
}

test.describe('L-shaped frame in the studio (plan without the Powered-by mark)', () => {
  test.beforeEach(async ({ browser }) => patchFreePlan(browser, { watermark: false }));
  test.afterEach(async ({ browser }) => patchFreePlan(browser, { watermark: true }));

  test('landscape: the frame is the base layer, the scene (logo, background) sits inside the window, frame colours outside; it can be switched off', async ({ page, context }) => {
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    const { width: W, height: H } = await canvasSize(page);
    const before = (await blueBox(page))!;
    await pinAdClock(page, 0);
    await addFrame(page, FRAME);
    const win = { x: 0.2 * W, y: 0, w: 0.8 * W, h: 0.8 * H }; // the sample window on this canvas
    // The window was found: the card shows the outline, no warning.
    await expect(page.getByTestId('ad-window-outline')).toBeVisible();
    await expect(page.getByTestId('ad-nowindow-l_shape')).toHaveCount(0);
    // The logo (part of the scene) moved into the window, scaled by 0.8 and offset by the window origin.
    const scale = win.w / W;
    await expect.poll(async () => near((await blueBox(page))?.w ?? 0, before.w * scale, 3)).toBe(true);
    const box = (await blueBox(page))!;
    expect(near(box.x, win.x + before.x * scale, 3)).toBe(true);
    expect(near(box.y, win.y + before.y * scale, 3)).toBe(true);
    // Frame colours outside the window: left column and bottom band.
    const red = (p: [number, number, number]) => p[0] > 150 && p[1] < 60 && p[2] < 60;
    expect(red(await canvasPixel(page, win.x / 2, H / 2))).toBe(true);
    expect(red(await canvasPixel(page, W / 2, win.h + (H - win.h) / 2))).toBe(true);
    expect(red(await canvasPixel(page, win.x / 2, H - 10))).toBe(true);
    // Inside the window it is the scene (the studio background), never the frame colour or the plain white of the window.
    const inside = await canvasPixel(page, win.x + win.w - 40, win.y + 40);
    expect(red(inside)).toBe(false);
    expect(inside.every((v) => v > 245)).toBe(false);

    // Switching the card off gives the full picture back.
    await page.getByRole('group', { name: 'L-shaped frame ad' }).getByLabel('L-shaped frame ad on').uncheck();
    await expect.poll(async () => near((await blueBox(page))?.w ?? 0, before.w, 3)).toBe(true);
    expect(red(await canvasPixel(page, win.x / 2, H / 2))).toBe(false);
  });

  test('a transparent window shows the scene exactly the same', async ({ page, context }) => {
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    const { width: W } = await canvasSize(page);
    const before = (await blueBox(page))!;
    await pinAdClock(page, 0);
    await addFrame(page, { ...FRAME, window: 'clear' });
    await expect.poll(async () => near((await blueBox(page))?.w ?? 0, before.w * 0.8, 3)).toBe(true);
    expect(near((await blueBox(page))!.x, 0.2 * W + before.x * 0.8, 3)).toBe(true);
  });

  test('vertical: the portrait frame puts the 9:16 scene, scaled to fit, centred in its window', async ({ page, context }) => {
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api, 'portrait'));
    const { width: W, height: H } = await canvasSize(page);
    const before = (await blueBox(page))!;
    await pinAdClock(page, 0);
    await addFrame(page, PORTRAIT_FRAME);
    // Window = x 0..W, y 0..900/1280 H: the 9:16 scene is contained in it, aspect kept, centred.
    const winPx = { x: 0, y: 0, w: W, h: (900 / 1280) * H };
    const target = lShapeSceneRect(W, H, winPx);
    const scale = target.w / W;
    await expect.poll(async () => near((await blueBox(page))?.w ?? 0, before.w * scale, 3)).toBe(true);
    const box = (await blueBox(page))!;
    expect(near(box.x, target.x + before.x * scale, 3)).toBe(true);
    expect(near(box.y, target.y + before.y * scale, 3)).toBe(true);
    // The band under the window and the sides next to the shrunken scene show the frame.
    const red = (p: [number, number, number]) => p[0] > 150 && p[1] < 60 && p[2] < 60;
    expect(red(await canvasPixel(page, W / 2, winPx.h + (H - winPx.h) / 2))).toBe(true);
  });

  test('priority: the frame hides the lower third while it shows, and the lower third is back when the frame goes', async ({ page, context }) => {
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    const { width: W, height: H } = await canvasSize(page);
    await pinAdClock(page, 0);
    await studioTab(page, 'Ads');
    await page.locator('#adFile-lower_third').setInputFiles({ name: 'lower.png', mimeType: 'image/png', buffer: solidPng(0, 255, 0, 128, 24) });
    await expect(page.getByTestId('ad-card-lower_third').locator('.ad-file-name')).toHaveText('lower.png');
    const lowerFitted = fitAd('lower_third', 128, 24, adRect('lower_third', W, H));
    const green = (p: [number, number, number]) => p[1] > 200 && p[0] < 60 && p[2] < 60;
    await expect.poll(async () => green(await canvasPixel(page, W / 2, lowerFitted.y + lowerFitted.h / 2))).toBe(true);
    await addFrame(page, FRAME);
    // The green band is gone from where the lower third stood; the frame's own red band is there instead.
    await expect.poll(async () => {
      const px = await canvasPixel(page, W / 2, H - 10);
      return px[0] > 150 && px[1] < 60; // the frame's red band, not the green ad
    }).toBe(true);
    expect(green(await canvasPixel(page, W / 2, lowerFitted.y + lowerFitted.h / 2))).toBe(false);
    await page.getByRole('group', { name: 'L-shaped frame ad' }).getByLabel('L-shaped frame ad on').uncheck();
    await expect.poll(async () => green(await canvasPixel(page, W / 2, lowerFitted.y + lowerFitted.h / 2))).toBe(true);
  });

  test('priority: a full-screen ad still covers everything, frame included', async ({ page, context }) => {
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    const { width: W, height: H } = await canvasSize(page);
    await pinAdClock(page, 0);
    await addFrame(page, FRAME);
    await studioTab(page, 'Ads');
    await page.locator('#adFile-full_screen').setInputFiles({ name: 'full.png', mimeType: 'image/png', buffer: solidPng(0, 0, 255, 160, 90) });
    await expect.poll(async () => isBlue(await canvasPixel(page, 30, H / 2))).toBe(true); // over the frame's column
    expect(isBlue(await canvasPixel(page, W - 30, H / 2))).toBe(true);
  });

  test('"Shrink picture while ads show" off: the frame does not run (and the card says why); on again it comes back', async ({ page, context }) => {
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    const { width: W, height: H } = await canvasSize(page);
    const before = (await blueBox(page))!;
    await pinAdClock(page, 0);
    await addFrame(page, FRAME);
    await expect.poll(async () => near((await blueBox(page))?.w ?? 0, before.w * 0.8, 3)).toBe(true);
    const toggle = page.getByLabel('Shrink picture while ads show');
    await toggle.uncheck();
    await expect.poll(async () => near((await blueBox(page))?.w ?? 0, before.w, 3)).toBe(true); // full picture, nothing covers it
    const red = (p: [number, number, number]) => p[0] > 150 && p[1] < 60 && p[2] < 60;
    expect(red(await canvasPixel(page, 0.1 * W, H / 2))).toBe(false); // no frame column
    await expect(page.getByTestId('ad-lshape-needs-shrink')).toContainText('L-shaped ads always resize the picture');
    await expect(page.getByRole('button', { name: 'Show the L-shaped frame ad now' })).toBeDisabled();
    await toggle.check();
    await expect.poll(async () => near((await blueBox(page))?.w ?? 0, before.w * 0.8, 3)).toBe(true);
    await expect(page.getByTestId('ad-lshape-needs-shrink')).toHaveCount(0);
  });

  test('a graphic with no clear window: a visible warning, drawn as a full-screen overlay, the scene is not shrunk', async ({ page, context }) => {
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    const { width: W, height: H } = await canvasSize(page);
    const before = (await blueBox(page))!;
    await pinAdClock(page, 0);
    await addFrame(page, { ...FRAME, window: [30, 120, 30] }); // the "window" is dark green: not clear
    await expect(page.getByTestId('ad-nowindow-l_shape')).toContainText('No clear window found in this graphic: the picture will not be placed');
    // Drawn full screen; the scene underneath was not resized.
    await expect.poll(async () => (await canvasPixel(page, W / 2, H / 2))[1] > 100).toBe(true);
    await page.getByRole('group', { name: 'L-shaped frame ad' }).getByLabel('L-shaped frame ad on').uncheck();
    await expect.poll(async () => near((await blueBox(page))?.w ?? 0, before.w, 3)).toBe(true);
  });

  test('schedule: hidden first, then eased in while the picture shrinks into the window, and eased out again', async ({ page, context }) => {
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    const before = (await blueBox(page))!;
    await pinAdClock(page, 0);
    await addFrame(page, FRAME);
    await page.getByRole('group', { name: 'L-shaped frame ad' }).getByRole('button', { name: 'Now and then' }).click(); // 15 s shown every 180 s, hidden first
    await expect.poll(async () => near((await blueBox(page))?.w ?? 0, before.w, 3)).toBe(true); // elapsed 0 -> hidden
    await pinAdClock(page, 181); // inside the shown window (180..195)
    await expect.poll(async () => near((await blueBox(page))?.w ?? 0, before.w * 0.8, 3)).toBe(true);
    await pinAdClock(page, 190);
    await expect.poll(async () => near((await blueBox(page))?.w ?? 0, before.w * 0.8, 3)).toBe(true);
    await pinAdClock(page, 196); // hidden again (cycle 195)
    await expect.poll(async () => near((await blueBox(page))?.w ?? 0, before.w, 3)).toBe(true);

    // Eased: "Show now" moves the scene through in-between sizes.
    await pinAdClock(page, 0);
    const widths = await page.evaluate(async () => {
      const read = () => {
        const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement;
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, 200).data;
        let x0 = c.width;
        let x1 = -1;
        for (let y = 0; y < 200; y += 2) {
          for (let x = 0; x < c.width; x += 2) {
            const i = (y * c.width + x) * 4;
            if (d[i] < 60 && d[i + 1] < 60 && d[i + 2] > 200) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
            }
          }
        }
        return x1 < 0 ? 0 : x1 - x0 + 2;
      };
      const out: number[] = [];
      const t0 = performance.now();
      (document.querySelector('[aria-label="Show the L-shaped frame ad now"]') as HTMLButtonElement).click();
      await new Promise<void>((resolve) => {
        const tick = () => {
          out.push(read());
          if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      return out;
    });
    const seen = widths.filter((w) => w > 0);
    expect(seen.length).toBeGreaterThan(8);
    expect(seen[0]).toBeGreaterThanOrEqual(before.w - 6);
    expect(seen[seen.length - 1]).toBeLessThanOrEqual(before.w * 0.8 + 4);
    expect(seen.filter((w) => w > before.w * 0.82 && w < before.w - 6).length).toBeGreaterThan(2);
  });
});

test.describe('L-shaped frame in the brand kit editor and from a kit in the studio', () => {
  test.beforeEach(async ({ browser }) => patchFreePlan(browser, { watermark: false, assetStorageMb: 5 }));
  test.afterEach(async ({ browser }) => patchFreePlan(browser, { watermark: true, assetStorageMb: 0 }));

  test('a fourth slot: sizes per shape, window found with an outline, a warning when there is none, and the shrink switch explained', async ({ page, context }) => {
    const { api } = await signIn(context);
    await page.goto('/brand');
    await page.getByRole('button', { name: 'New brand kit' }).click();
    const form = page.getByRole('form', { name: 'New brand kit' });
    await form.getByLabel('Kit name').fill('News frame');
    const slot = form.getByTestId('kit-ad-l_shape');
    await expect(slot).toBeVisible();
    await expect(form.getByTestId('slot-size-l_shape')).toHaveText('Suggested 1920 x 1080');
    await expect(form.getByTestId('slot-help-l_shape')).toContainText('plain white');
    await expect(form.getByTestId('kit-ads')).toContainText('Up to four ads');

    // The founder's sample shape: the window is found (80% x 80%), outlined in a small preview, and the kit preview puts the scene in it.
    await form.getByLabel('L-shaped frame ad file').setInputFiles({ name: 'frame.png', mimeType: 'image/png', buffer: framePng(FRAME) });
    await expect(slot).toContainText('frame');
    await expect(form.getByTestId('kit-frame-window')).toContainText('Window found: 80% x 80%');
    await expect(form.getByTestId('kit-frame-preview').getByTestId('ad-window-outline')).toBeVisible();
    await expect(form.getByTestId('kit-frame-nowindow')).toHaveCount(0);
    await expect(form.getByTestId('kit-preview-scene')).toBeVisible();
    await expect(form.getByTestId('kit-frame-needs-shrink')).toHaveCount(0);

    // A graphic with no clear window: a non-blocking warning (the file is still accepted).
    await form.getByLabel('L-shaped frame ad file').setInputFiles({ name: 'solid.png', mimeType: 'image/png', buffer: solidPng(200, 20, 20, 1280, 720) });
    await expect(form.getByTestId('kit-frame-nowindow')).toContainText('No clear window found in this graphic: the picture will not be placed');
    await form.getByLabel('L-shaped frame ad file').setInputFiles({ name: 'frame.png', mimeType: 'image/png', buffer: framePng(FRAME) });
    await expect(form.getByTestId('kit-frame-window')).toBeVisible();

    // "Shrink picture while ads show" off: the editor says L-shaped ads always resize the picture.
    await form.getByLabel('Shrink picture while ads show').uncheck();
    await expect(form.getByTestId('kit-frame-needs-shrink')).toContainText('L-shaped ads always resize the picture');
    await form.getByLabel('Shrink picture while ads show').check();
    await expect(form.getByTestId('kit-frame-needs-shrink')).toHaveCount(0);

    // The 9:16 tab is its own set with its own suggestion.
    await form.getByRole('tab', { name: '9:16 vertical' }).click();
    await expect(form.getByTestId('slot-size-l_shape')).toHaveText('Suggested 1080 x 1920');
    await form.getByRole('tab', { name: '16:9 landscape' }).click();

    await form.getByRole('button', { name: 'Create kit' }).click();
    await expect(page.getByText('Created "News frame".')).toBeVisible();
    const kit = (await (await api.get(`${APP}/api/brand-kits`)).json())[0];
    expect(kit.ads.map((a: { placement: string }) => a.placement)).toEqual(['l_shape']);
    expect(kit.adsPortrait).toEqual([]);

    // The studio applies the default kit: the frame is up and the scene sits in its window.
    const id = await newStream(api);
    await page.goto(`/streams/${id}/studio`);
    await page.locator('canvas.studio-canvas').waitFor();
    const { width: W, height: H } = await canvasSize(page);
    await expect
      .poll(async () => {
        const p = await canvasPixel(page, 0.1 * W, H / 2);
        return p[0] > 150 && p[1] < 60 && p[2] < 60; // the frame's red column
      })
      .toBe(true);
    await studioTab(page, 'Ads');
    await expect(page.getByTestId('ad-card-l_shape')).toContainText('From the brand kit');
    await expect(page.getByTestId('ad-window-outline')).toBeVisible();
  });
});

test.describe('L-shaped frame: the ad is paid-only and old data still loads', () => {
  test('the Free plan keeps its StreamBird banner and no frame card is offered', async ({ page, context }) => {
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    await studioTab(page, 'Ads');
    await expect(page.getByTestId('ads-free-notice')).toBeVisible();
    await expect(page.getByTestId('ad-card-l_shape')).toHaveCount(0);
    void APP;
    void apiHeaders;
  });
});
