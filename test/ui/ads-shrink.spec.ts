import { expect, test, type Page } from '@playwright/test';
import { adRect, fitAd, sceneRectFor } from '../../web-app/src/studio/ads';
import { BRANDING_RANGES, newsBarHeight } from '../../web-app/src/studio/compose';
import { APP, apiHeaders, canvasPixel, canvasSize, isBlue, isRed, newStream, patchFreePlan, pinAdClock, signIn, solidPng, studioTab } from './helpers';

// "Shrink picture while ads show": while a lower-third or left-third ad is visible, the live picture (scene + logo)
// is scaled into the room the ad leaves. The scene here is the studio's brand slide plus a solid YELLOW logo, so a
// test can find the scene by the bounding box of the yellow pixels on the published canvas (the same pixels viewers get).

const LOGO_SIDE = 90; // the logo is drawn 90 px tall at the default size; the PNG below is square
const SHAPE = { lower_third: [128, 24], side_third: [43, 72] } as const;

type Box = { x: number; y: number; w: number; h: number } | null;
/** Bounding box of the yellow logo on the canvas, scanning every second pixel (null when none). */
const logoBox = (page: Page): Promise<Box> =>
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
        if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] < 60) {
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

async function openStudio(page: Page, id: string) {
  await page.goto(`/streams/${id}/studio`);
  await page.locator('canvas.studio-canvas').waitFor();
  await studioTab(page, 'Look');
  await page.locator('#logoInput').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: solidPng(255, 255, 0, 64, 64) });
  // The logo fades in for a moment: wait until it is fully drawn.
  await expect.poll(async () => near((await logoBox(page))?.w ?? 0, LOGO_SIDE, 3)).toBe(true);
}
async function addAd(page: Page, p: 'lower_third' | 'side_third', color: readonly [number, number, number]) {
  await studioTab(page, 'Ads');
  await page.locator(`#adFile-${p}`).setInputFiles({ name: `${p}.png`, mimeType: 'image/png', buffer: solidPng(...color, ...SHAPE[p]) });
  await expect(page.getByTestId(`ad-card-${p}`).locator('.ad-file-name')).toHaveText(`${p}.png`);
}

test.describe('the picture shrinks while an ad shows (plan without the Powered-by mark)', () => {
  test.beforeEach(async ({ browser }) => patchFreePlan(browser, { watermark: false }));
  test.afterEach(async ({ browser }) => patchFreePlan(browser, { watermark: true }));

  for (const orientation of ['landscape', 'portrait'] as const) {
    test(`${orientation}: lower third -> the scene sits above the ad, centred; left third -> in the right two thirds; both -> intersection`, async ({ page, context }) => {
      const { api } = await signIn(context);
      await openStudio(page, await newStream(api, orientation));
      const { width: W, height: H } = await canvasSize(page);
      const u = H / 720;
      let before: Box = null;
      await expect.poll(async () => (before = await logoBox(page))?.w ?? 0).toBeGreaterThan(LOGO_SIDE - 4); // read it while fully drawn
      before = before!;
      expect(near(before!.x, 16, 3)).toBe(true);
      expect(near(before!.w, LOGO_SIDE, 3)).toBe(true);
      await pinAdClock(page, 0);

      // Lower third: scene = the canvas scaled into the area above the ad picture.
      await addAd(page, 'lower_third', [255, 0, 0]);
      const fitted = fitAd('lower_third', ...SHAPE.lower_third, adRect('lower_third', W, H));
      const lower = sceneRectFor(W, H, { lower_third: { alpha: 1, fitted } });
      await expect.poll(async () => near((await logoBox(page))?.w ?? 0, LOGO_SIDE * (lower.w / W), 3)).toBe(true);
      let box = (await logoBox(page))!;
      expect(near(box.x, lower.x + 16 * (lower.w / W), 3)).toBe(true);
      expect(near(box.y, lower.y + 16 * (lower.h / H), 3)).toBe(true);
      expect(box.y + box.h).toBeLessThan(fitted.y); // never under the ad
      // The ad itself is drawn at its own place, untouched by the shrinking.
      expect(isRed(await canvasPixel(page, W / 2, fitted.y + fitted.h / 2))).toBe(true);
      // The letterbox beside the scene is the studio background, not stretched picture (nothing yellow out there).
      expect(box.x).toBeGreaterThan(before!.x + (orientation === 'landscape' ? 100 : 20));

      // Left third as well: the intersection.
      await addAd(page, 'side_third', [0, 255, 0]);
      const side = sceneRectFor(W, H, { lower_third: { alpha: 1, fitted }, side_third: { alpha: 1 } });
      await expect.poll(async () => near((await logoBox(page))?.w ?? 0, LOGO_SIDE * (side.w / W), 3)).toBe(true);
      box = (await logoBox(page))!;
      expect(box.x).toBeGreaterThanOrEqual(adRect('side_third', W, H).w - 2);
      expect(near(box.x, side.x + 16 * (side.w / W), 3)).toBe(true);

      // Only the left third (switch the lower third off).
      await studioTab(page, 'Ads');
      await page.getByRole('group', { name: 'Lower third ad' }).getByLabel('Lower third ad on').uncheck();
      const only = sceneRectFor(W, H, { side_third: { alpha: 1 } });
      await expect
        .poll(async () => {
          const b = await logoBox(page);
          return !!b && near(b.x, only.x + 16 * (only.w / W), 3) && near(b.y, only.y + 16 * (only.h / H), 3) && near(b.w, LOGO_SIDE * (only.w / W), 3);
        })
        .toBe(true); // all three together: the scene is settled, not mid-fade
      box = (await logoBox(page))!;
      expect(near(box.y, only.y + 16 * (only.h / H), 3)).toBe(true);
      expect(near(box.w, LOGO_SIDE * (only.w / W), 3)).toBe(true);
      void u;

      // Both off again: the picture is full size.
      await page.getByRole('group', { name: 'Left third ad' }).getByLabel('Left third ad on').uncheck();
      await expect.poll(async () => near((await logoBox(page))?.x ?? 0, 16, 3)).toBe(true);
      expect(near((await logoBox(page))!.w, LOGO_SIDE, 3)).toBe(true);
    });

    test(`${orientation}: the switch off keeps the old behaviour (the ad covers the picture), and it comes back on`, async ({ page, context }) => {
      const { api } = await signIn(context);
      await openStudio(page, await newStream(api, orientation));
      await pinAdClock(page, 0);
      await addAd(page, 'lower_third', [255, 0, 0]);
      const small = (await logoBox(page))!;
      await expect.poll(async () => (await logoBox(page))!.w).toBeLessThan(LOGO_SIDE - 5);

      const toggle = page.getByLabel('Shrink picture while ads show');
      await expect(toggle).toBeChecked();
      await toggle.uncheck();
      await expect.poll(async () => near((await logoBox(page))?.x ?? 0, 16, 3)).toBe(true); // full size under the ad again
      expect(near((await logoBox(page))!.w, LOGO_SIDE, 3)).toBe(true);
      const { width: W, height: H } = await canvasSize(page);
      const fitted = fitAd('lower_third', ...SHAPE.lower_third, adRect('lower_third', W, H));
      expect(isRed(await canvasPixel(page, W / 2, fitted.y + fitted.h / 2))).toBe(true); // the ad still shows

      // The choice belongs to the stream and survives a reload.
      await page.reload();
      await page.locator('canvas.studio-canvas').waitFor();
      await studioTab(page, 'Ads');
      await expect(page.getByLabel('Shrink picture while ads show')).not.toBeChecked();
      await page.getByLabel('Shrink picture while ads show').check();
      await expect.poll(async () => (await logoBox(page))?.w ?? 99).toBeLessThanOrEqual(small.w + 3);
    });
  }

  test('a full-screen ad keeps covering the picture instead of shrinking it', async ({ page, context }) => {
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    await pinAdClock(page, 0);
    await studioTab(page, 'Ads');
    await page.locator('#adFile-full_screen').setInputFiles({ name: 'full.png', mimeType: 'image/png', buffer: solidPng(0, 0, 255, 160, 90) });
    await expect(page.getByTestId('ad-card-full_screen').locator('.ad-file-name')).toHaveText('full.png');
    const { width: W, height: H } = await canvasSize(page);
    await expect.poll(async () => isBlue(await canvasPixel(page, W / 2, H / 2))).toBe(true);
    // The picture underneath was not resized (no yellow shows, it is simply covered; switch it off and it is full size).
    await page.getByRole('group', { name: 'Full screen ad' }).getByLabel('Full screen ad on').uncheck();
    await expect.poll(async () => near((await logoBox(page))?.x ?? 0, 16, 3)).toBe(true);
    expect(near((await logoBox(page))!.w, LOGO_SIDE, 3)).toBe(true);
  });

  test('the ticker stays at the bottom edge and the ad stands on it; the scene shrinks into what is above', async ({ page, context }) => {
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    const { width: W, height: H } = await canvasSize(page);
    await studioTab(page, 'Look');
    await page.fill('#newsInput', 'Breaking: shrink test');
    const bar = newsBarHeight(BRANDING_RANGES.newsFontSize.default);
    await pinAdClock(page, 0);
    await addAd(page, 'lower_third', [255, 0, 0]);
    const fitted = fitAd('lower_third', ...SHAPE.lower_third, adRect('lower_third', W, H, bar));
    const lower = sceneRectFor(W, H, { lower_third: { alpha: 1, fitted } });
    await expect.poll(async () => near((await logoBox(page))?.w ?? 0, LOGO_SIDE * (lower.w / W), 3)).toBe(true);
    const box = (await logoBox(page))!;
    expect(box.y + box.h).toBeLessThan(H - bar - fitted.h); // above the ad, which is above the ticker
    expect(isRed(await canvasPixel(page, W / 2, H - bar - 6))).toBe(true); // ad right above the bar
    expect(isRed(await canvasPixel(page, W / 2, H - 4))).toBe(false); // ticker bar is not covered
  });

  test('it eases: while the ad fades in the picture shrinks smoothly (in step with the 300 ms fade) and grows back when it hides', async ({ page, context }) => {
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    await pinAdClock(page, 0);
    await studioTab(page, 'Ads');
    await page.locator('#adFile-lower_third').setInputFiles({ name: 'lower.png', mimeType: 'image/png', buffer: solidPng(255, 0, 0, 128, 24) });
    await expect(page.getByTestId('ad-card-lower_third').locator('.ad-file-name')).toHaveText('lower.png');
    await page.getByRole('group', { name: 'Lower third ad' }).getByRole('button', { name: 'Now and then' }).click(); // hidden first
    await expect.poll(async () => near((await logoBox(page))?.w ?? 0, LOGO_SIDE, 3)).toBe(true);

    // Click "Show now" inside the page and record the logo width on every frame for a second.
    const samples = await page.evaluate(async () => {
      const read = () => {
        const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement;
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let x0 = c.width;
        let x1 = -1;
        for (let y = 0; y < 200; y += 2) {
          for (let x = 0; x < c.width; x += 2) {
            const i = (y * c.width + x) * 4;
            if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] < 60) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
            }
          }
        }
        return x1 < 0 ? 0 : x1 - x0 + 2;
      };
      const out: number[] = [];
      const t0 = performance.now();
      (document.querySelector('[aria-label="Show the Lower third ad now"]') as HTMLButtonElement).click();
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
    const widths = samples.filter((w) => w > 0);
    expect(widths.length).toBeGreaterThan(8);
    expect(widths[0]).toBeGreaterThanOrEqual(LOGO_SIDE - 6); // starts full size
    expect(widths[widths.length - 1]).toBeLessThanOrEqual(LOGO_SIDE * (2 / 3) + 4); // ends 2/3 size
    expect(widths.filter((w) => w > LOGO_SIDE * 0.7 && w < LOGO_SIDE - 6).length).toBeGreaterThan(2); // in-between sizes were drawn: it eased
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThanOrEqual(widths[i - 1] + 2); // never grows while showing
  });
});

test.describe('Free plan', () => {
  test('the StreamBird banner makes the picture shrink too, and the picture is full size again when it hides', async ({ page, context }) => {
    const { api } = await signIn(context);
    const id = await newStream(api);
    await page.clock.install();
    await openStudio(page, id);
    const { width: W, height: H } = await canvasSize(page);
    const box0 = (await logoBox(page))!;
    expect(near(box0.w, LOGO_SIDE, 3)).toBe(true);
    await page.clock.fastForward(189_000); // 180 s of hiding passed: the banner is up for 15 s
    await expect.poll(async () => (await logoBox(page))?.w ?? 99, { timeout: 15_000 }).toBeLessThan(LOGO_SIDE - 10);
    const small = (await logoBox(page))!;
    expect(small.y + small.h).toBeLessThan(H - 40); // above the banner
    expect(small.x).toBeGreaterThan(box0.x + 20);
    void W;
    // The toggle lives on the Free plan's Ads tab as well.
    await studioTab(page, 'Ads');
    await page.getByLabel('Shrink picture while ads show').uncheck();
    await expect.poll(async () => near((await logoBox(page))?.x ?? 0, 16, 3)).toBe(true);
    await page.getByLabel('Shrink picture while ads show').check();
    await expect.poll(async () => (await logoBox(page))?.w ?? 99).toBeLessThan(LOGO_SIDE - 10);
    await page.clock.fastForward(20_000); // hidden again
    await expect.poll(async () => near((await logoBox(page))?.w ?? 0, LOGO_SIDE, 3)).toBe(true);
    void APP;
    void apiHeaders;
  });
});
