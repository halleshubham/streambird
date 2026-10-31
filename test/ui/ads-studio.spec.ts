import { expect, test, type Page } from '@playwright/test';
import { solidGif } from '../gif';
import { BRANDING_RANGES, newsBarHeight } from '../../web-app/src/studio/compose';
import { adRect, fitAd, type AdPlacement } from '../../web-app/src/studio/ads';
import {
  APP,
  apiHeaders,
  canvasPixel,
  canvasSize,
  isBlue,
  isGreen,
  isPlainAd,
  isRed,
  newStream,
  patchFreePlan,
  pinAdClock,
  signIn,
  solidPng,
  studioTab,
  type Rgb,
} from './helpers';

// Advertisements on the broadcast picture: canvas pixels for every placement in both orientations, GIF ads, the
// schedule (clock pinned with window.__SB_TEST_AD_ELAPSED__), the Free plan's StreamBird ad, brand kit ads and the Ads tab.

const RED = [255, 0, 0] as const;
const GREEN = [0, 255, 0] as const;
const BLUE = [0, 0, 255] as const;
/** Picture shapes that roughly match their placement, so the contain-fit leaves little letterbox. */
const SHAPE: Record<AdPlacement, [number, number]> = { lower_third: [128, 24], side_third: [43, 72], full_screen: [160, 90] };
const LABEL: Record<AdPlacement, string> = { lower_third: 'Lower third', side_third: 'Left third', full_screen: 'Full screen' };
const COLOR: Record<AdPlacement, readonly [number, number, number]> = { lower_third: RED, side_third: GREEN, full_screen: BLUE };

const png = (p: AdPlacement) => solidPng(...COLOR[p], ...SHAPE[p]);
/** The middle of where a picture of this placement's shape ends up on a W x H canvas. */
function centre(p: AdPlacement, W: number, H: number, bar = 0): [number, number] {
  const r = fitAd(p, SHAPE[p][0], SHAPE[p][1], adRect(p, W, H, bar));
  return [r.x + r.w / 2, r.y + r.h / 2];
}

async function openStudio(page: Page, id: string) {
  await page.goto(`/streams/${id}/studio`);
  await page.locator('canvas.studio-canvas').waitFor();
}
async function addAd(page: Page, p: AdPlacement, file = { name: `${p}.png`, mimeType: 'image/png', buffer: png(p) }) {
  await page.locator(`#adFile-${p}`).setInputFiles(file);
  await expect(page.getByTestId(`ad-card-${p}`).locator('.ad-file-name')).toHaveText(file.name);
}
const card = (page: Page, p: AdPlacement) => page.getByRole('group', { name: `${LABEL[p]} ad` });

test.describe('ads on the canvas (a plan without the Powered-by mark)', () => {
  test.beforeEach(async ({ browser }) => patchFreePlan(browser, { watermark: false }));
  test.afterEach(async ({ browser }) => patchFreePlan(browser, { watermark: true }));

  for (const orientation of ['landscape', 'portrait'] as const) {
    test(`${orientation}: lower third, left third and full screen sit in their areas, contain-fit, with full screen on top`, async ({ page, context }) => {
      const { api } = await signIn(context);
      const id = await newStream(api, orientation);
      await openStudio(page, id);
      const { width: W, height: H } = await canvasSize(page);
      expect(H > W).toBe(orientation === 'portrait');
      await studioTab(page, 'Ads');
      await pinAdClock(page, 0);

      const [lx, ly] = centre('lower_third', W, H);
      const [sx, sy] = centre('side_third', W, H);
      const [fx, fy] = centre('full_screen', W, H);
      const bgPoint = [W * 0.75, H * 0.2] as const; // nothing but the studio background here

      // Nothing yet: no ad pixels anywhere we look.
      for (const [x, y] of [[lx, ly], [sx, sy], [fx, fy], bgPoint]) expect(isPlainAd(await canvasPixel(page, x, y))).toBe(false);

      await addAd(page, 'lower_third');
      await addAd(page, 'side_third');
      await expect.poll(async () => isRed(await canvasPixel(page, lx, ly))).toBe(true);
      await expect.poll(async () => isGreen(await canvasPixel(page, sx, sy))).toBe(true);
      expect(isPlainAd(await canvasPixel(page, ...bgPoint))).toBe(false);
      // The lower third is the bottom third only: a point at the top of the frame is untouched; the left third reaches the top.
      expect(isRed(await canvasPixel(page, W * 0.75, H * 0.6))).toBe(false);
      expect(isGreen(await canvasPixel(page, sx, H * 0.03))).toBe(adRect('side_third', W, H).h > 0 && fitAd('side_third', 43, 72, adRect('side_third', W, H)).y <= H * 0.03);
      // The side third is drawn above the lower third where they overlap (the bottom-left corner).
      const cornerX = Math.min(W / 3 - 4, W * 0.15);
      const lowerRect = fitAd('lower_third', 128, 24, adRect('lower_third', W, H));
      const sideRect = fitAd('side_third', 43, 72, adRect('side_third', W, H));
      const ox = Math.max(lowerRect.x, sideRect.x) + 3;
      const oy = Math.max(lowerRect.y, sideRect.y) + 3;
      if (ox < Math.min(lowerRect.x + lowerRect.w, sideRect.x + sideRect.w) && oy < Math.min(lowerRect.y + lowerRect.h, sideRect.y + sideRect.h)) {
        expect(isGreen(await canvasPixel(page, ox, oy))).toBe(true);
      }
      void cornerX;

      // Full screen covers everything while it is on and its transparent letterbox shows the studio, not the other ads.
      await addAd(page, 'full_screen');
      await expect.poll(async () => isBlue(await canvasPixel(page, fx, fy))).toBe(true);
      await expect.poll(async () => isRed(await canvasPixel(page, lx, ly)) || isGreen(await canvasPixel(page, sx, sy))).toBe(false);
      const full = fitAd('full_screen', 160, 90, adRect('full_screen', W, H));
      if (orientation === 'portrait') {
        expect(full.h).toBeLessThan(H); // letterboxed: the picture keeps its 16:9 shape, top and bottom stay transparent
        expect(isBlue(await canvasPixel(page, W / 2, 40))).toBe(false);
        expect(isRed(await canvasPixel(page, W / 2, H - 10))).toBe(false); // the lower third is hidden even where full screen is transparent
      } else {
        expect(isBlue(await canvasPixel(page, 5, 5))).toBe(true); // 16:9 fills the whole frame
      }

      // Switching full screen off brings the others back.
      await card(page, 'full_screen').getByLabel('Full screen ad on').uncheck();
      await expect.poll(async () => isRed(await canvasPixel(page, lx, ly))).toBe(true);
      await expect.poll(async () => isGreen(await canvasPixel(page, sx, sy))).toBe(true);
      expect(isBlue(await canvasPixel(page, fx, fy))).toBe(false);
    });
  }

  test('the lower third sits above the ticker bar when the ticker is showing', async ({ page, context }) => {
    const { api } = await signIn(context);
    const id = await newStream(api);
    await openStudio(page, id);
    const { width: W, height: H } = await canvasSize(page);
    await pinAdClock(page, 0);
    await studioTab(page, 'Ads');
    await addAd(page, 'lower_third');
    const [lx, ly] = centre('lower_third', W, H);
    await expect.poll(async () => isRed(await canvasPixel(page, lx, ly))).toBe(true);
    expect(isRed(await canvasPixel(page, lx, H - 4))).toBe(true); // no ticker: the ad reaches the bottom edge

    await studioTab(page, 'Look');
    await page.fill('#newsInput', 'Breaking: ads test');
    const bar = newsBarHeight(BRANDING_RANGES.newsFontSize.default);
    const area = adRect('lower_third', W, H, bar);
    await expect.poll(async () => isRed(await canvasPixel(page, lx, H - bar - 4))).toBe(true); // just above the bar
    expect(isRed(await canvasPixel(page, lx, H - 4))).toBe(false); // the ticker bar is not covered
    expect(isRed(await canvasPixel(page, lx, area.y + 3))).toBe(true); // same height as before, moved up
    expect(isRed(await canvasPixel(page, lx, area.y - 6))).toBe(false);
  });

  test('schedule: hidden first, shown for the show time, fades in and out, repeats; manual Show now / Hide override it', async ({ page, context }) => {
    const { api } = await signIn(context);
    const id = await newStream(api);
    await openStudio(page, id);
    const { width: W, height: H } = await canvasSize(page);
    const [x, y] = [W * 0.75, centre('lower_third', W, H)[1]]; // clear of the left third
    await studioTab(page, 'Ads');
    await addAd(page, 'lower_third');
    const lower = card(page, 'lower_third');
    await lower.getByRole('button', { name: 'Now and then' }).click();
    await lower.getByLabel('Lower third ad: show for', { exact: true }).fill('10');
    await lower.getByLabel('Lower third ad: hide for unit').selectOption('sec'); // the default 180 s is shown as 3 min
    await lower.getByLabel('Lower third ad: hide for', { exact: true }).fill('30');
    await expect(lower.getByTestId('ad-status-lower_third')).toHaveText('Shown for 10 sec, then hidden for 30 sec');

    const red = async () => (await canvasPixel(page, x, y))[0];
    const isShown = async () => isRed(await canvasPixel(page, x, y));
    await pinAdClock(page, 5);
    await expect.poll(isShown, { timeout: 5000 }).toBe(false);
    await pinAdClock(page, 29.9);
    await page.waitForTimeout(500);
    expect(await isShown()).toBe(false); // still hidden right up to the end of the hidden time
    await pinAdClock(page, 35);
    await expect.poll(isShown).toBe(true);
    await pinAdClock(page, 30.15); // half-way through the 300 ms fade in
    await expect.poll(async () => { const r = await red(); return r > 90 && r < 200; }).toBe(true);
    await pinAdClock(page, 39.85); // half-way through the fade out
    await expect.poll(async () => { const r = await red(); return r > 90 && r < 200; }).toBe(true);
    await pinAdClock(page, 45); // the next cycle starts hidden
    await expect.poll(isShown).toBe(false);
    await pinAdClock(page, 40 + 30 + 5); // and shows again after the hidden time
    await expect.poll(isShown).toBe(true);

    // Manual: Hide wins over the schedule, Show now wins over it too, Follow schedule gives control back.
    await lower.getByRole('button', { name: 'Hide the Lower third ad' }).click();
    await expect.poll(isShown).toBe(false);
    await expect(lower.getByTestId('ad-status-lower_third')).toHaveText('Hidden (by hand)');
    await pinAdClock(page, 5);
    await lower.getByRole('button', { name: 'Show the Lower third ad now' }).click();
    await expect.poll(isShown).toBe(true);
    await expect(lower.getByTestId('ad-status-lower_third')).toHaveText('Showing now (by hand)');
    await lower.getByRole('button', { name: 'Let the Lower third ad follow its schedule' }).click();
    await expect.poll(isShown).toBe(false);
    // Switching the ad off hides it for good, even when the schedule says shown.
    await pinAdClock(page, 35);
    await expect.poll(isShown).toBe(true);
    await lower.getByLabel('Lower third ad on').uncheck();
    await expect.poll(isShown).toBe(false);
    // Always on shows it again whatever the clock says.
    await lower.getByLabel('Lower third ad on').check();
    await pinAdClock(page, 5);
    await lower.getByRole('button', { name: 'Always on' }).click();
    await expect.poll(isShown).toBe(true);
  });

  test('the schedule fields explain wrong numbers and minutes are stored as seconds; settings and the small picture survive a reload', async ({ page, context }) => {
    const { api } = await signIn(context);
    const id = await newStream(api);
    await openStudio(page, id);
    const { width: W, height: H } = await canvasSize(page);
    const [lx, ly] = centre('lower_third', W, H);
    await studioTab(page, 'Ads');
    await addAd(page, 'lower_third');
    const lower = card(page, 'lower_third');
    await lower.getByRole('button', { name: 'Now and then' }).click();
    await lower.getByLabel('Lower third ad: show for', { exact: true }).fill('0');
    await expect(lower.getByRole('alert')).toContainText('Show time');
    await lower.getByLabel('Lower third ad: show for', { exact: true }).fill('20');
    await lower.getByLabel('Lower third ad: hide for unit').selectOption('min');
    await lower.getByLabel('Lower third ad: hide for', { exact: true }).fill('2');
    await expect(lower.getByTestId('ad-status-lower_third')).toHaveText('Shown for 20 sec, then hidden for 2 min');
    await lower.getByLabel('Lower third ad: hide for', { exact: true }).fill('99999');
    await expect(lower.getByRole('alert')).toContainText('between showings');

    await page.reload();
    await page.locator('canvas.studio-canvas').waitFor();
    await studioTab(page, 'Ads');
    const again = card(page, 'lower_third');
    await expect(again.getByLabel('Lower third ad: show for', { exact: true })).toHaveValue('20');
    await expect(again.getByLabel('Lower third ad: hide for', { exact: true })).toHaveValue('2');
    await expect(again.getByLabel('Lower third ad: hide for unit')).toHaveValue('min');
    await expect(again.locator('.ad-file-name')).toHaveText('lower_third.png');
    await pinAdClock(page, 125); // 120 s hidden, then shown
    await expect.poll(async () => isRed(await canvasPixel(page, lx, ly))).toBe(true);
    await pinAdClock(page, 3);
    await expect.poll(async () => isRed(await canvasPixel(page, lx, ly))).toBe(false);
    // Removing the picture clears the card.
    await again.getByRole('button', { name: 'Remove the Lower third ad picture' }).click();
    await expect(again.locator('.ad-file-name')).toHaveText('No picture chosen');
  });

  test('an animated GIF ad changes colour over time on the canvas', async ({ page, context }) => {
    const gif = solidGif([[255, 0, 0], [0, 0, 255]], { width: 128, height: 24, delayMs: 100 });
    const { api } = await signIn(context);
    const id = await newStream(api);
    await openStudio(page, id);
    const { width: W, height: H } = await canvasSize(page);
    const [lx, ly] = centre('lower_third', W, H);
    await pinAdClock(page, 0);
    await studioTab(page, 'Ads');
    await addAd(page, 'lower_third', { name: 'spin.gif', mimeType: 'image/gif', buffer: gif });
    const seen = new Set<string>();
    await expect
      .poll(
        async () => {
          const p = await canvasPixel(page, lx, ly);
          if (isRed(p)) seen.add('red');
          if (isBlue(p)) seen.add('blue');
          return [...seen].sort().join('+');
        },
        { timeout: 15_000, intervals: [40] },
      )
      .toBe('blue+red');
  });

  test('without ImageDecoder a GIF ad still shows its first frame', async ({ page, context }) => {
    await page.addInitScript(() => {
      delete (window as unknown as { ImageDecoder?: unknown }).ImageDecoder;
    });
    const gif = solidGif([[255, 0, 0], [0, 0, 255]], { width: 128, height: 24, delayMs: 100 });
    const { api } = await signIn(context);
    const id = await newStream(api);
    await openStudio(page, id);
    const { width: W, height: H } = await canvasSize(page);
    const [lx, ly] = centre('lower_third', W, H);
    await studioTab(page, 'Ads');
    await addAd(page, 'lower_third', { name: 'spin.gif', mimeType: 'image/gif', buffer: gif });
    await expect.poll(async () => isRed(await canvasPixel(page, lx, ly))).toBe(true);
    await page.waitForTimeout(600);
    expect(isRed(await canvasPixel(page, lx, ly))).toBe(true); // static first frame, never the second
  });

  test('a file that is not a picture is refused with a message', async ({ page, context }) => {
    const { api } = await signIn(context);
    const id = await newStream(api);
    await openStudio(page, id);
    await studioTab(page, 'Ads');
    await page.locator('#adFile-lower_third').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.locator('.studio-status-toast')).toContainText('PNG, JPG, WebP or GIF');
    await expect(card(page, 'lower_third').locator('.ad-file-name')).toHaveText('No picture chosen');
  });

  test('the Ads tab is usable at 390px: no sideways scroll, tabs reachable by keyboard, cards fit', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const { api } = await signIn(context);
    const id = await newStream(api);
    await openStudio(page, id);
    const tabs = page.getByRole('tablist', { name: 'Studio panels' });
    await page.getByRole('tab', { name: /^People/ }).focus();
    await page.keyboard.press('End'); // last tab = Ads
    await expect(tabs.getByRole('tab', { name: 'Ads' })).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tab', { name: 'Ads' })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tabs.getByRole('tab', { name: /^People/ })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft'); // wraps to the last
    await expect(tabs.getByRole('tab', { name: 'Ads' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('ads-panel')).toBeVisible();

    await addAd(page, 'lower_third');
    await card(page, 'lower_third').getByRole('button', { name: 'Now and then' }).click();
    await addAd(page, 'side_third');
    await addAd(page, 'full_screen');
    const overflow = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    expect(overflow.doc).toBeLessThanOrEqual(overflow.win);
    for (const p of ['lower_third', 'side_third', 'full_screen'] as const) {
      const box = await page.getByTestId(`ad-card-${p}`).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }
    // The controls inside a card are reachable with Tab and operable with the keyboard.
    await card(page, 'lower_third').getByLabel('Lower third ad on').focus();
    await page.keyboard.press('Space');
    await expect(card(page, 'lower_third').getByLabel('Lower third ad on')).not.toBeChecked();
  });

  test('a computer picture with huge pixel dimensions is refused (same 8192 px limit as the library)', async ({ page, context }) => {
    const { api } = await signIn(context);
    const id = await newStream(api);
    await openStudio(page, id);
    await studioTab(page, 'Ads');
    await page.locator('#adFile-lower_third').setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: solidPng(255, 0, 0, 9000, 1) });
    await expect(page.locator('.studio-status-toast')).toContainText('too big');
    await expect(card(page, 'lower_third').locator('.ad-file-name')).toHaveText('No picture chosen');
  });

  test('ads left in this browser with a missing or broken schedule fall back to always on and never break the canvas', async ({ page, context }) => {
    const { api } = await signIn(context);
    const id = await newStream(api);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const red = `data:image/png;base64,${solidPng(255, 0, 0, 128, 24).toString('base64')}`;
    await page.addInitScript(
      ([sid, dataUrl]) => {
        localStorage.setItem(
          `streambird:studio:${sid}:v1`,
          JSON.stringify({ ads: { lower_third: { source: 'computer', name: 'a.png', enabled: true }, side_third: { source: 'computer', name: 'b.png', enabled: true, schedule: { mode: 'interval', showSec: 'x' } }, full_screen: 'garbage' } }),
        );
        localStorage.setItem(`streambird:studio:${sid}:adfiles:v1`, JSON.stringify({ lower_third: dataUrl, side_third: dataUrl }));
      },
      [id, red],
    );
    await openStudio(page, id);
    const { width: W, height: H } = await canvasSize(page);
    await expect.poll(async () => isRed(await canvasPixel(page, ...centre('lower_third', W, H)))).toBe(true); // always on
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

});

test.describe('Free plan', () => {
  // Free = the real Free plan: the Powered-by mark is on and there is no brand storage.
  const FREE_W = 1280;

  test('shows the StreamBird ad 15 s every 180 s (hidden first) with the mark always on top; custom ads are never drawn', async ({ page, context }) => {
    const { api } = await signIn(context);
    const id = await newStream(api);
    // A custom ad left in this browser (e.g. from a plan that allowed it) must not be drawn on Free.
    await page.addInitScript(
      ([sid, dataUrl]) => {
        localStorage.setItem(`streambird:studio:${sid}:v1`, JSON.stringify({ ads: { lower_third: { source: 'computer', assetId: null, name: 'sneaky.png', enabled: true, schedule: { mode: 'continuous' } } } }));
        localStorage.setItem(`streambird:studio:${sid}:adfiles:v1`, JSON.stringify({ lower_third: dataUrl }));
      },
      [id, `data:image/png;base64,${solidPng(255, 0, 0, 128, 24).toString('base64')}`],
    );
    await page.clock.install(); // a real (fake-able) clock: the test hook must not be able to retime the Free banner
    await openStudio(page, id);
    const { width: W, height: H } = await canvasSize(page);
    expect(W).toBe(FREE_W);
    // Inside the banner's card, below its text: the violet gradient when the ad is up, the dark studio otherwise.
    const banner = (): Promise<Rgb> => canvasPixel(page, W * 0.45, H - 30);
    const bannerUp = (p: Rgb) => p[2] > 150 && p[0] > 70;

    await pinAdClock(page, 187); // armed hook, but ignored on Free
    await page.waitForTimeout(1500);
    expect(bannerUp(await banner())).toBe(false); // hidden first (about 2 s in)
    expect(isRed(await canvasPixel(page, W * 0.45, H - 60))).toBe(false); // the custom red ad never appears
    await page.clock.fastForward(176_000); // about 178 s in
    await page.waitForTimeout(500);
    expect(bannerUp(await banner())).toBe(false);
    await page.clock.fastForward(11_000); // about 189 s in: 180 s passed, the banner is up for 15 s
    await expect.poll(async () => bannerUp(await banner())).toBe(true); // 180 s in: up for 15 s
    expect(isRed(await canvasPixel(page, W * 0.45, H - 60))).toBe(false);

    // The "Powered by" pill is drawn after (on top of) the ad: its white text is still on the canvas while the ad is up.
    const u = H / 720;
    const markWhite = await page.evaluate(([x0, y0, w, h]) => {
      const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(x0, y0, w, h).data;
      let white = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) white++;
      return white;
    }, [Math.round(W - 20 * u - 190 * u), Math.round(H - 20 * u - 34 * u), Math.round(170 * u), Math.round(28 * u)]);
    expect(markWhite).toBeGreaterThan(30);

    await page.clock.fastForward(20_000); // about 210 s: hidden again
    await expect.poll(async () => bannerUp(await banner())).toBe(false);
    await page.clock.fastForward(170_000); // about 380 s: the second showing (375-390)
    await expect.poll(async () => bannerUp(await banner())).toBe(true);

    // The Ads tab explains it and points at the plans.
    await studioTab(page, 'Ads');
    const notice = page.getByTestId('ads-free-notice');
    await expect(notice).toContainText('StreamBird ad');
    await expect(notice.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/billing');
    await expect(page.locator('#adFile-lower_third')).toHaveCount(0);
  });
});

test.describe('brand kit ads', () => {
  test.beforeEach(async ({ browser }) => patchFreePlan(browser, { watermark: false, assetStorageMb: 5 }));
  test.afterEach(async ({ browser }) => patchFreePlan(browser, { watermark: true, assetStorageMb: 0 }));

  test('the Brand page editor saves an ad into a kit and the studio applies it from the kit', async ({ page, context }) => {
    const { api } = await signIn(context);
    const upload = async (name: string, buffer: Buffer, kind: string) =>
      (await (await api.post(`${APP}/api/assets`, { multipart: { kind, name, file: { name: `${name}.png`, mimeType: 'image/png', buffer } }, headers: { Origin: APP } })).json()).id as string;

    // Upload a library file of the new kind "Ad" through the page itself.
    await page.goto('/brand');
    await page.getByLabel('Type').selectOption('ad');
    await page.getByLabel(/Image \(PNG/).setInputFiles({ name: 'sponsor.png', mimeType: 'image/png', buffer: solidPng(255, 0, 0, 128, 24) });
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Uploaded "sponsor"' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ has: page.getByLabel('Name of sponsor') })).toContainText('Ad');
    await upload('not-an-ad', solidPng(0, 255, 0, 16), 'logo');

    await page.getByRole('button', { name: 'New brand kit' }).click();
    const form = page.getByRole('form', { name: 'New brand kit' });
    await form.getByLabel('Kit name').fill('Sponsors');
    const slot = form.getByRole('group', { name: 'Lower third ad' });
    await expect(slot.getByLabel('Lower third ad file').locator('option')).toHaveText(['No ad', 'sponsor']); // only files of type Ad
    await slot.getByLabel('Lower third ad file').selectOption({ label: 'sponsor' });
    await expect(form.getByTestId('kit-preview-ad-lower_third')).toBeVisible(); // live preview of the geometry
    await slot.getByRole('button', { name: 'Now and then' }).click();
    await slot.getByLabel('Lower third ad: show for', { exact: true }).fill('10');
    await slot.getByLabel('Lower third ad: hide for unit').selectOption('sec');
    await slot.getByLabel('Lower third ad: hide for', { exact: true }).fill('30');
    await form.getByRole('button', { name: 'Create kit' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Created "Sponsors"' })).toBeVisible();

    const kits = await (await api.get(`${APP}/api/brand-kits`)).json();
    expect(kits).toHaveLength(1);
    expect(kits[0].ads).toEqual([{ placement: 'lower_third', assetId: expect.any(String), enabled: true, mode: 'interval', showSec: 10, everySec: 30 }]);

    // Editing an existing kit: switch the ad off and save, then it is saved on the server.
    await page.reload();
    await page.getByRole('button', { name: 'Edit Sponsors' }).click();
    const edit = page.getByRole('form', { name: 'Brand kit Sponsors' });
    await expect(edit.getByRole('button', { name: 'Save kit' })).toBeDisabled();
    await expect(edit.getByRole('group', { name: 'Lower third ad' }).getByLabel('Lower third ad: show for', { exact: true })).toHaveValue('10');
    await edit.getByLabel('Lower third ad on').uncheck();
    await edit.getByRole('button', { name: 'Save kit' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved "Sponsors"' })).toBeVisible();
    expect((await (await api.get(`${APP}/api/brand-kits`)).json())[0].ads[0].enabled).toBe(false);
    await page.getByRole('button', { name: 'Edit Sponsors' }).click();
    await page.getByRole('form', { name: 'Brand kit Sponsors' }).getByLabel('Lower third ad on').check();
    await page.getByRole('form', { name: 'Brand kit Sponsors' }).getByRole('button', { name: 'Save kit' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved "Sponsors"' })).toBeVisible();

    // The file in use cannot be deleted from the library.
    page.on('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Delete sponsor' }).click();
    await expect(page.getByRole('alert')).toContainText('used by the brand kit');

    // The studio opens with the account default kit applied: the Ads card is filled from the kit.
    const id = await newStream(api);
    await openStudio(page, id);
    const { width: W, height: H } = await canvasSize(page);
    const [lx, ly] = [W * 0.75, centre('lower_third', W, H)[1]];
    await studioTab(page, 'Ads');
    const lower = card(page, 'lower_third');
    await expect(lower.locator('.ad-file-name')).toContainText('Sponsors lower_third');
    await expect(lower.getByRole('button', { name: 'From brand kit' })).toHaveAttribute('aria-pressed', 'true');
    await expect(lower.getByLabel('Lower third ad: show for', { exact: true })).toHaveValue('10');
    await expect(lower.getByLabel('Lower third ad: hide for', { exact: true })).toHaveValue('30');
    await expect(lower.getByLabel('Lower third ad on')).toBeChecked();
    await pinAdClock(page, 35);
    await expect.poll(async () => isRed(await canvasPixel(page, lx, ly))).toBe(true);
    await pinAdClock(page, 5);
    await expect.poll(async () => isRed(await canvasPixel(page, lx, ly))).toBe(false);

    // A per-stream override (a file from this computer, a different schedule) beats the kit and survives a reload.
    await addAd(page, 'lower_third', { name: 'mine.png', mimeType: 'image/png', buffer: solidPng(0, 0, 255, 128, 24) });
    await expect(lower.getByRole('button', { name: 'From this computer' })).toHaveAttribute('aria-pressed', 'true');
    await lower.getByRole('button', { name: 'Always on' }).click();
    await expect.poll(async () => isBlue(await canvasPixel(page, lx, ly))).toBe(true);
    await page.reload();
    await page.locator('canvas.studio-canvas').waitFor();
    await expect.poll(async () => isBlue(await canvasPixel(page, lx, ly))).toBe(true);
    await studioTab(page, 'Ads');
    // ... and "From brand kit" goes back to the kit's picture and schedule.
    await card(page, 'lower_third').getByRole('button', { name: 'From brand kit' }).click();
    await expect(card(page, 'lower_third').getByRole('button', { name: 'From brand kit' })).toHaveAttribute('aria-pressed', 'true');
    await pinAdClock(page, 35);
    await expect.poll(async () => isRed(await canvasPixel(page, lx, ly))).toBe(true);
  });

  test('a kit ad that is switched off in the kit stays off in the studio', async ({ page, context }) => {
    const { api } = await signIn(context);
    const assetId = (await (await api.post(`${APP}/api/assets`, { multipart: { kind: 'ad', name: 'off-ad', file: { name: 'off.png', mimeType: 'image/png', buffer: solidPng(255, 0, 0, 128, 24) } }, headers: { Origin: APP } })).json()).id as string;
    const kit = await api.post(`${APP}/api/brand-kits`, { data: { name: 'Off', ads: [{ placement: 'lower_third', assetId, enabled: false }] }, headers: apiHeaders });
    expect(kit.ok()).toBeTruthy();
    const id = await newStream(api);
    await openStudio(page, id);
    const { width: W, height: H } = await canvasSize(page);
    await studioTab(page, 'Ads');
    const lower = card(page, 'lower_third');
    await expect(lower.locator('.ad-file-name')).toContainText('Off lower_third');
    await expect(lower.getByLabel('Lower third ad on')).not.toBeChecked();
    await page.waitForTimeout(800);
    expect(isRed(await canvasPixel(page, W * 0.75, centre('lower_third', W, H)[1]))).toBe(false);
  });
  test('a kit whose logo file is missing still applies its ads, and a missing ad file is reported by place; Manual takes kit ads off the canvas but keeps computer ones', async ({ page, context }) => {
    const { api } = await signIn(context);
    const up = async (name: string, kind: string, buffer: Buffer) =>
      (await (await api.post(`${APP}/api/assets`, { multipart: { kind, name, file: { name: `${name}.png`, mimeType: 'image/png', buffer } }, headers: { Origin: APP } })).json()).id as string;
    const logo = await up('logo', 'logo', solidPng(0, 0, 255, 32));
    const lower = await up('lower', 'ad', png('lower_third'));
    const side = await up('side', 'ad', png('side_third'));
    const full = await up('full', 'ad', png('full_screen'));
    const kit = await (
      await api.post(`${APP}/api/brand-kits`, {
        data: { name: 'Mixed', logoAssetId: logo, ads: [{ placement: 'lower_third', assetId: lower }, { placement: 'side_third', assetId: side }, { placement: 'full_screen', assetId: full, enabled: false }] },
        headers: apiHeaders,
      })
    ).json();
    expect(kit.ads).toHaveLength(3);
    const id = await newStream(api);

    // The logo file 404s and the side-third file 404s: everything else still arrives, and the failures are named.
    await page.route(`**/api/assets/${logo}/file`, (r) => r.fulfill({ status: 404, body: 'gone' }));
    await page.route(`**/api/assets/${side}/file`, (r) => r.fulfill({ status: 404, body: 'gone' }));
    await openStudio(page, id);
    const { width: W, height: H } = await canvasSize(page);
    await studioTab(page, 'Ads');
    await expect(page.locator('.studio-status-toast')).toContainText('Could not load the logo, Left third ad of brand kit "Mixed"');
    await expect(card(page, 'lower_third').locator('.ad-file-name')).toBeVisible();
    await expect(card(page, 'lower_third').locator('.ad-file-name')).toContainText('Mixed lower_third');
    await expect(card(page, 'full_screen').locator('.ad-file-name')).toContainText('Mixed full_screen');
    await expect(card(page, 'side_third').locator('.ad-file-name')).toHaveText('No picture chosen');
    await expect.poll(async () => isRed(await canvasPixel(page, ...centre('lower_third', W, H)))).toBe(true);

    // A picture from this computer for the left third, then "Manual (no kit)": the kit's lower third leaves, the computer one stays.
    await page.unroute(`**/api/assets/${side}/file`);
    await addAd(page, 'side_third');
    await expect.poll(async () => isGreen(await canvasPixel(page, ...centre('side_third', W, H)))).toBe(true);
    await studioTab(page, 'Look');
    await page.locator('#brandKitSelect').selectOption('');
    await studioTab(page, 'Ads');
    await expect(card(page, 'lower_third').locator('.ad-file-name')).toHaveText('No picture chosen');
    await expect.poll(async () => isRed(await canvasPixel(page, W * 0.75, centre('lower_third', W, H)[1]))).toBe(false);
    expect(isGreen(await canvasPixel(page, ...centre('side_third', W, H)))).toBe(true);

    // A reload keeps the host's per-stream choice (the override wins over later kit edits); picking the kit again applies its current ads.
    await api.patch(`${APP}/api/brand-kits/${kit.id}`, { data: { ads: [] }, headers: apiHeaders });
    await page.unroute(`**/api/assets/${logo}/file`);
    await page.reload();
    await page.locator('canvas.studio-canvas').waitFor();
    await expect.poll(async () => isGreen(await canvasPixel(page, ...centre('side_third', W, H)))).toBe(true);
    await studioTab(page, 'Look');
    await page.locator('#brandKitSelect').selectOption(kit.id);
    await expect(page.locator('.studio-status-toast')).toContainText('Applied brand kit "Mixed"');
    await studioTab(page, 'Ads');
    await expect(card(page, 'lower_third').locator('.ad-file-name')).toHaveText('No picture chosen'); // the kit has none now
  });

  test('after a downgrade the kit editor still shows the saved ads and lets the user remove them (which frees the file)', async ({ page, context, browser }) => {
    const { api } = await signIn(context);
    const assetId = (await (await api.post(`${APP}/api/assets`, { multipart: { kind: 'ad', name: 'old-ad', file: { name: 'o.png', mimeType: 'image/png', buffer: solidPng(255, 0, 0, 128, 24) } }, headers: { Origin: APP } })).json()).id as string;
    const kit = await (await api.post(`${APP}/api/brand-kits`, { data: { name: 'Old', ads: [{ placement: 'lower_third', assetId }] }, headers: apiHeaders })).json();
    await patchFreePlan(browser, { watermark: true }); // the plan now carries the mark
    await page.goto('/brand');
    await page.getByRole('button', { name: 'Edit Old' }).click();
    const form = page.getByRole('form', { name: 'Brand kit Old' });
    await expect(form.getByTestId('kit-ads-free-notice')).toBeVisible();
    await expect(form.getByTestId('kit-ads-readonly')).toContainText('Lower third: old-ad');
    await expect(form.getByRole('group', { name: 'Lower third ad' })).toHaveCount(0); // no editable slots
    await form.getByRole('button', { name: 'Remove ads' }).click();
    await form.getByRole('button', { name: 'Save kit' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved "Old"' })).toBeVisible();
    expect((await (await api.get(`${APP}/api/brand-kits`)).json())[0].ads).toEqual([]);
    expect((await api.delete(`${APP}/api/assets/${assetId}`, { headers: { Origin: APP } })).status()).toBe(204);
    void kit;
  });
});
