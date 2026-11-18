import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { newsBarHeight } from '../../web-app/src/studio/compose';
import { adRect } from '../../web-app/src/studio/ads';
import { APP, apiHeaders, canvasSize, newStream, patchFreePlan, pinAdClock, signIn, solidPng, studioTab } from './helpers';

// The on-air date and time: brand kit editor (save + preview), the studio applying the kit's clock, the per-stream override,
// and the canvas pixels (the studio's time is pinned with window.__SB_TEST_NOW__). The pre-existing tests use `PILL` (the
// first release's look: a dark pill, date and time together) and so double as the pill regression; the compact text (the
// default) has its own describe blocks at the end.

const NOW = Date.UTC(2026, 10, 18, 9, 34, 5); // Wed 18 Nov 2026, 15:04:05 in India
type Corner = 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
const BASE = Math.floor(NOW / 8000) * 8000; // a start of the 8 s time/date cycle
const T_TIME = BASE + 2000; // the time is showing
const T_DATE = BASE + 6000; // the date is showing
const PILL = { clockStyle: 'pill', clockAlternate: false, clockSize: 'medium' };

test.beforeEach(async ({ browser }) => patchFreePlan(browser, { assetStorageMb: 5, watermark: false }));
test.afterEach(async ({ browser }) => patchFreePlan(browser, { assetStorageMb: 0, watermark: true }));

async function pinTime(page: Page, now = NOW) {
  await page.addInitScript((n) => {
    localStorage.setItem('streambird:test:clock', 'on'); // arms the hook; without this the page ignores __SB_TEST_NOW__
    (window as unknown as { __SB_TEST_NOW__: number }).__SB_TEST_NOW__ = n;
  }, now);
}
/** Moves the pinned time of an open page. */
const setNow = (page: Page, now: number) => page.evaluate((n) => ((window as unknown as { __SB_TEST_NOW__: number }).__SB_TEST_NOW__ = n), now);

async function makeKit(api: APIRequestContext, body: Record<string, unknown>) {
  const res = await api.post(`${APP}/api/brand-kits`, { data: { name: 'Newsroom', ...body }, headers: apiHeaders });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string };
}

async function openStudio(page: Page, id: string) {
  await page.goto(`/streams/${id}/studio`);
  await page.locator('canvas.studio-canvas').waitFor();
}

async function openLook(page: Page) {
  const customize = page.getByRole('button', { name: 'Customize', exact: true });
  if ((await customize.isVisible()) && (await customize.getAttribute('aria-expanded')) === 'false') await customize.click(); // on a phone the panels open from the bar
  await studioTab(page, 'Look');
}

interface Bbox { count: number; x0: number; y0: number; x1: number; y1: number }
/** The bounding box of near-white pixels (the clock's text) in a part of the canvas, in canvas pixels. */
const whiteBox = (page: Page, region: Corner | 'all', maxY?: number) =>
  page.evaluate(([reg, limit]) => {
    const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement;
    const W = c.width;
    const H = c.height;
    const left = reg === 'top_left' || reg === 'bottom_left';
    const top = reg === 'top_left' || reg === 'top_right';
    const [rx0, rx1] = reg === 'all' ? [0, W] : left ? [0, Math.floor(W / 2)] : [Math.floor(W / 2), W];
    const [ry0, ry1full] = reg === 'all' ? [0, H] : top ? [0, Math.floor(H / 4)] : [Math.floor((H * 3) / 4), H];
    const ry1 = Math.min(ry1full, (limit as number | undefined) ?? H);
    const d = c.getContext('2d')!.getImageData(rx0, ry0, rx1 - rx0, ry1 - ry0);
    const out = { count: 0, x0: 1e9, y0: 1e9, x1: -1, y1: -1 };
    for (let y = 0; y < d.height; y++) {
      for (let x = 0; x < d.width; x++) {
        const o = (y * d.width + x) * 4;
        if (Math.min(d.data[o], d.data[o + 1], d.data[o + 2]) >= 235) {
          out.count++;
          out.x0 = Math.min(out.x0, rx0 + x);
          out.x1 = Math.max(out.x1, rx0 + x);
          out.y0 = Math.min(out.y0, ry0 + y);
          out.y1 = Math.max(out.y1, ry0 + y);
        }
      }
    }
    return out;
  }, [region, maxY] as [Corner | 'all', number | undefined]);

/** A cheap fingerprint of a canvas region, to compare "before" and "after" exactly. */
const regionHash = (page: Page, region: Corner) =>
  page.evaluate((reg) => {
    const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement;
    const W = c.width;
    const H = c.height;
    const x0 = reg.endsWith('left') ? 0 : Math.floor(W / 2);
    const y0 = reg.startsWith('top') ? 0 : Math.floor((H * 3) / 4);
    const d = c.getContext('2d')!.getImageData(x0, y0, Math.floor(W / 2), Math.floor(H / 4)).data;
    let h = 0;
    for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) | 0;
    return h;
  }, region);

const none = (b: Bbox) => b.count === 0;

test.describe('kit editor: Date and time', () => {
  test('saves every field, previews the clock in the chosen corner, and an old kit shows the defaults (off)', async ({ page, context }) => {
    const { api } = await signIn(context);
    await makeKit(api, {});
    await pinTime(page);
    await page.goto('/brand');
    await page.getByRole('button', { name: 'Edit Newsroom' }).click();
    const section = page.getByTestId('kit-clock');
    await expect(section).toBeVisible();
    // Off by default: the switch is off, no preview clock, the other controls are hidden.
    await expect(section.getByTestId('clock-enabled')).not.toBeChecked();
    await expect(page.getByTestId('kit-preview-clock')).toHaveCount(0);
    await expect(section.getByTestId('clock-position-top_left')).toHaveCount(0);

    await section.getByTestId('clock-enabled').check();
    // Defaults once on: top right, compact text that alternates date and time, 12 hour, date shown, no seconds, this device, small.
    await expect(section.getByTestId('clock-position-top_right')).toHaveAttribute('aria-pressed', 'true');
    await expect(section.getByTestId('clock-style-text')).toHaveAttribute('aria-pressed', 'true');
    await expect(section.getByTestId('clock-alternate')).toBeChecked();
    await expect(section.getByTestId('clock-format-12h')).toHaveAttribute('aria-pressed', 'true');
    await expect(section.getByTestId('clock-show-date')).toBeChecked();
    await expect(section.getByTestId('clock-show-seconds')).not.toBeChecked();
    await expect(section.getByTestId('clock-size-small')).toHaveAttribute('aria-pressed', 'true');
    await expect(section.getByTestId('clock-timezone')).toHaveValue('');
    const preview = page.getByTestId('kit-preview-clock');
    await expect(preview).toHaveAttribute('data-position', 'top_right');

    await section.getByTestId('clock-position-bottom_left').click();
    await expect(preview).toHaveAttribute('data-position', 'bottom_left');
    await section.getByTestId('clock-format-24h').click();
    await section.getByTestId('clock-show-seconds').check();
    await section.getByTestId('clock-size-large').click();
    await section.getByTestId('clock-timezone').selectOption('Asia/Kolkata');
    // Together on one line once "alternate" is off.
    await section.getByTestId('clock-alternate').uncheck();
    await expect(preview).toContainText('Wed 18 Nov');
    await expect(preview).toContainText('15:04:05');
    await section.getByTestId('clock-show-date').uncheck();
    await expect(preview).not.toContainText('Wed 18 Nov');
    await expect(section.getByTestId('clock-alternate')).toHaveCount(0); // moot without the date
    await section.getByTestId('clock-show-date').check();
    await expect(section.getByTestId('clock-alternate')).not.toBeChecked();

    // Any zone: a typo is flagged, a real name is taken.
    const search = section.getByTestId('clock-timezone-search');
    await search.fill('Mars/Olympus');
    await expect(section.getByText('That is not a time zone name')).toBeVisible();
    await search.fill('Africa/Nairobi');
    await expect(section.getByTestId('clock-timezone')).toHaveValue('Africa/Nairobi');
    await section.getByTestId('clock-timezone').selectOption('Asia/Kolkata');

    await page.getByRole('button', { name: 'Save kit' }).click();
    await expect(page.getByText('Saved "Newsroom".')).toBeVisible();
    const kits = await (await api.get(`${APP}/api/brand-kits`)).json();
    expect(kits[0]).toMatchObject({ clockEnabled: true, clockPosition: 'bottom_left', clockFormat: '24h', clockShowDate: true, clockShowSeconds: true, clockTimezone: 'Asia/Kolkata', clockSize: 'large', clockStyle: 'text', clockAlternate: false });

    // The kit summary's preview carries the clock too, and re-opening shows what was saved.
    await expect(page.getByTestId('kit-preview-clock').first()).toBeVisible();
    await page.getByRole('button', { name: 'Edit Newsroom' }).click();
    const again = page.getByTestId('kit-clock');
    await expect(again.getByTestId('clock-enabled')).toBeChecked();
    await expect(again.getByTestId('clock-position-bottom_left')).toHaveAttribute('aria-pressed', 'true');
    await expect(again.getByTestId('clock-timezone')).toHaveValue('Asia/Kolkata');
  });

  test('the clock steps below the logo in the preview when they share a top corner', async ({ page, context }) => {
    const { api } = await signIn(context);
    const logo = (await (await api.post(`${APP}/api/assets`, { multipart: { kind: 'logo', name: 'logo', file: { name: 'logo.png', mimeType: 'image/png', buffer: solidPng(255, 0, 0, 64, 64) } }, headers: { Origin: APP } })).json()).id as string;
    await makeKit(api, { ...PILL, logoAssetId: logo, logoPosition: 'right', clockEnabled: true, clockPosition: 'top_right' });
    await pinTime(page);
    await page.goto('/brand');
    await page.getByRole('button', { name: 'Edit Newsroom' }).click();
    const kitPreview = page.getByTestId('kit-preview').last();
    const logoBox = await kitPreview.locator('.kit-preview-logo').boundingBox();
    const clockBox = await kitPreview.getByTestId('kit-preview-clock').boundingBox();
    expect(clockBox!.y).toBeGreaterThanOrEqual(logoBox!.y + logoBox!.height - 1);
  });
});

test.describe('studio: the clock on the canvas', () => {
  for (const corner of ['top_left', 'top_right', 'bottom_left', 'bottom_right'] as Corner[]) {
    test(`the kit's clock is drawn in its corner (${corner}) of a landscape stream and nowhere else`, async ({ page, context }) => {
      const { api } = await signIn(context);
      await makeKit(api, { ...PILL, clockEnabled: true, clockPosition: corner, clockTimezone: 'Asia/Kolkata' });
      await pinTime(page);
      const id = await newStream(api);
      await openStudio(page, id);
      const { width: W, height: H } = await canvasSize(page);
      await expect.poll(async () => (await whiteBox(page, corner)).count).toBeGreaterThan(40);
      const box = await whiteBox(page, corner);
      // Inside the safe margin, and in the right half/quarter.
      expect(box.x0).toBeGreaterThanOrEqual(16);
      expect(box.x1).toBeLessThanOrEqual(W - 16);
      expect(box.y0).toBeGreaterThanOrEqual(16);
      expect(box.y1).toBeLessThanOrEqual(H - 16);
      // Medium is 3 percent of the height: a text line about 22px tall, and a pill-sized (not full-width) block of text.
      expect(box.y1 - box.y0).toBeGreaterThan(12);
      expect(box.y1 - box.y0).toBeLessThan(40);
      expect(box.x1 - box.x0).toBeLessThan(W * 0.3);
      for (const other of ['top_left', 'top_right', 'bottom_left', 'bottom_right'] as Corner[]) {
        if (other !== corner) expect(none(await whiteBox(page, other))).toBe(true);
      }
      // The dark pill behind the text: a pixel just inside its edge is dark, not the studio background's own colour.
      const pill = await page.evaluate(
        ([x, y]) => {
          const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement;
          return Array.from(c.getContext('2d')!.getImageData(x, y, 1, 1).data);
        },
        [box.x0 - 8, Math.round((box.y0 + box.y1) / 2)],
      );
      expect(Math.max(pill[0], pill[1], pill[2])).toBeLessThan(70);
    });
  }

  test('it is off by default and a kit with the clock off leaves the canvas exactly as it was (toggling on then off restores every pixel)', async ({ page, context }) => {
    const { api } = await signIn(context);
    await makeKit(api, {}); // an "old" kit: clock off
    await pinTime(page);
    const id = await newStream(api);
    await openStudio(page, id);
    for (const c of ['top_left', 'top_right', 'bottom_left', 'bottom_right'] as Corner[]) expect(none(await whiteBox(page, c))).toBe(true);
    const before = await regionHash(page, 'top_right');
    await openLook(page);
    const panel = page.getByTestId('studio-clock');
    await expect(panel.getByTestId('clock-enabled')).not.toBeChecked();
    await panel.getByTestId('clock-enabled').check();
    await expect.poll(async () => (await whiteBox(page, 'top_right')).count).toBeGreaterThan(40);
    expect(await regionHash(page, 'top_right')).not.toBe(before);
    await panel.getByTestId('clock-enabled').uncheck();
    await expect.poll(async () => regionHash(page, 'top_right')).toBe(before);
  });

  test('a stream with no kit at all can still switch the clock on for itself (compact text by default)', async ({ page, context }) => {
    const { api } = await signIn(context);
    await pinTime(page);
    const id = await newStream(api);
    await openStudio(page, id);
    await openLook(page);
    const panel = page.getByTestId('studio-clock');
    await expect(panel.getByTestId('clock-source')).toHaveText('Set for this stream.');
    await panel.getByTestId('clock-enabled').check();
    await panel.getByTestId('clock-timezone').selectOption('UTC');
    await panel.getByTestId('clock-format-24h').click();
    await expect.poll(async () => (await whiteBox(page, 'top_right')).count).toBeGreaterThan(40);
  });

  test('the Look tab says the settings come from the kit; changing one makes them this stream\'s own, which survive a reload and win over the kit', async ({ page, context }) => {
    const { api } = await signIn(context);
    const kit = await makeKit(api, { ...PILL, clockEnabled: true, clockPosition: 'top_right', clockTimezone: 'Asia/Kolkata' });
    await pinTime(page);
    const id = await newStream(api);
    await openStudio(page, id);
    await openLook(page);
    const panel = page.getByTestId('studio-clock');
    await expect(panel.getByTestId('clock-source')).toContainText('From brand kit Newsroom');
    await expect(panel.getByTestId('clock-enabled')).toBeChecked();
    await expect(panel.getByTestId('clock-position-top_right')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await whiteBox(page, 'top_right')).count).toBeGreaterThan(40);

    // Moving it live: the canvas follows at once and the note changes.
    await panel.getByTestId('clock-position-bottom_left').click();
    await expect(panel.getByTestId('clock-source')).toHaveText('Set for this stream.');
    await expect.poll(async () => (await whiteBox(page, 'bottom_left')).count).toBeGreaterThan(40);
    expect(none(await whiteBox(page, 'top_right'))).toBe(true);

    // The kit changes afterwards (e.g. moved to bottom right): this stream keeps its own choice after a reload.
    await api.patch(`${APP}/api/brand-kits/${kit.id}`, { data: { clockPosition: 'bottom_right', clockSize: 'large' }, headers: apiHeaders });
    await page.reload();
    await page.locator('canvas.studio-canvas').waitFor();
    await expect.poll(async () => (await whiteBox(page, 'bottom_left')).count).toBeGreaterThan(40);
    expect(none(await whiteBox(page, 'bottom_right'))).toBe(true);
    await openLook(page);
    await expect(panel.getByTestId('clock-source')).toHaveText('Set for this stream.');
    await expect(panel.getByTestId('clock-position-bottom_left')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByTestId('clock-size-medium')).toHaveAttribute('aria-pressed', 'true'); // the kit's "large" did not leak in

    // "Use the settings of ..." takes the kit's current ones again.
    await panel.getByTestId('clock-reset-kit').click();
    await expect(panel.getByTestId('clock-source')).toContainText('From brand kit Newsroom');
    await expect.poll(async () => (await whiteBox(page, 'bottom_right')).count).toBeGreaterThan(40);
  });

  test('"Switch off for this stream" turns a kit clock off here only, and it stays off after a reload', async ({ page, context }) => {
    const { api } = await signIn(context);
    await makeKit(api, { ...PILL, clockEnabled: true });
    await pinTime(page);
    const id = await newStream(api);
    await openStudio(page, id);
    await expect.poll(async () => (await whiteBox(page, 'top_right')).count).toBeGreaterThan(40);
    await openLook(page);
    await page.getByTestId('clock-off-for-stream').click();
    await expect.poll(async () => (await whiteBox(page, 'top_right')).count).toBe(0);
    await page.reload();
    await page.locator('canvas.studio-canvas').waitFor();
    await page.waitForTimeout(800);
    expect((await whiteBox(page, 'top_right')).count).toBe(0);
    await openLook(page);
    await expect(page.getByTestId('clock-enabled')).not.toBeChecked();
    // The kit itself still has it on, for the next stream.
    expect((await (await api.get(`${APP}/api/brand-kits`)).json())[0].clockEnabled).toBe(true);
    const id2 = await newStream(api);
    await openStudio(page, id2);
    await expect.poll(async () => (await whiteBox(page, 'top_right')).count).toBeGreaterThan(40);
  });

  test('a vertical (9:16) stream scales by its width and keeps the clock inside the frame, in every corner', async ({ page, context }) => {
    const { api } = await signIn(context);
    const kit = await makeKit(api, { ...PILL, clockEnabled: true, clockSize: 'large', clockPosition: 'top_left' });
    await pinTime(page);
    const id = await newStream(api, 'portrait');
    await openStudio(page, id);
    const { width: W, height: H } = await canvasSize(page);
    expect(H).toBeGreaterThan(W);
    for (const corner of ['top_left', 'top_right', 'bottom_left', 'bottom_right'] as Corner[]) {
      await openLook(page);
      await page.getByTestId(`clock-position-${corner}`).click();
      await expect.poll(async () => (await whiteBox(page, corner)).count).toBeGreaterThan(40);
      const b = await whiteBox(page, corner);
      expect(b.x0).toBeGreaterThanOrEqual(Math.round(W * 0.022));
      expect(b.x1).toBeLessThanOrEqual(W - Math.round(W * 0.022));
      expect(b.y0).toBeGreaterThanOrEqual(Math.round(W * 0.022));
      if (corner.startsWith('bottom')) expect(b.y1).toBeLessThanOrEqual(H - Math.round(H * 0.06)); // clear of the platform bar, like the mark
      expect(b.x1 - b.x0).toBeLessThan(W * 0.8);
    }
    void kit;
  });

  test('in the logo\'s corner the clock sits below the logo, never over it; with the ticker on, a bottom clock sits above it', async ({ page, context }) => {
    const { api } = await signIn(context);
    const logo = (await (await api.post(`${APP}/api/assets`, { multipart: { kind: 'logo', name: 'logo', file: { name: 'logo.png', mimeType: 'image/png', buffer: solidPng(255, 0, 0, 90, 90) } }, headers: { Origin: APP } })).json()).id as string;
    await makeKit(api, { ...PILL, logoAssetId: logo, logoPosition: 'right', logoSize: 90, clockEnabled: true, clockPosition: 'top_right' });
    await pinTime(page);
    const id = await newStream(api);
    await openStudio(page, id);
    const { height: H } = await canvasSize(page);
    // The logo is a solid red square, 90px, 16px from the corner: the clock's text starts below its bottom edge.
    await expect.poll(async () => (await whiteBox(page, 'top_right')).count).toBeGreaterThan(40);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement;
          const d = c.getContext('2d')!.getImageData(c.width - 16 - 45, 16 + 45, 1, 1).data;
          return d[0] > 200 && d[1] < 60 && d[2] < 60; // the logo is there and not covered
        }),
      )
      .toBe(true);
    const top = await whiteBox(page, 'top_right');
    expect(top.y0).toBeGreaterThanOrEqual(16 + 90);

    // The other top corner is not pushed down.
    await openLook(page);
    const panel = page.getByTestId('studio-clock');
    await panel.getByTestId('clock-position-top_left').click();
    await expect.poll(async () => (await whiteBox(page, 'top_left')).count).toBeGreaterThan(40);
    expect((await whiteBox(page, 'top_left')).y0).toBeLessThan(16 + 30);

    // Ticker: the bar is the bottom newsBarHeight pixels; the bottom clocks stay above it.
    await page.locator('#newsInput').fill('Breaking: the clock keeps clear of the ticker');
    const bar = newsBarHeight(18);
    for (const corner of ['bottom_left', 'bottom_right'] as Corner[]) {
      await panel.getByTestId(`clock-position-${corner}`).click();
      // Only above the bar: the ticker's own (white, scrolling) text is not the clock.
      await expect.poll(async () => (await whiteBox(page, corner, H - bar)).count).toBeGreaterThan(40);
      await expect.poll(async () => (await whiteBox(page, corner, H - bar)).y1).toBeLessThanOrEqual(H - bar - 4);
      // ...and the ticker is intact (full-width bar: its pixel is not the pill's dark colour only; the text scrolls through it).
      const barPixel = await page.evaluate((hh) => {
        const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement;
        return Array.from(c.getContext('2d')!.getImageData(5, hh - 5, 1, 1).data);
      }, H);
      expect(barPixel[3]).toBe(255);
    }
  });

  test('with the Free plan\'s Powered by mark, a bottom-right clock sits above the mark', async ({ page, context, browser }) => {
    await patchFreePlan(browser, { watermark: true });
    const { api } = await signIn(context);
    await makeKit(api, { ...PILL, clockEnabled: true, clockPosition: 'bottom_right' });
    await pinTime(page);
    const id = await newStream(api);
    await openStudio(page, id);
    const { width: W, height: H } = await canvasSize(page);
    await expect.poll(async () => (await whiteBox(page, 'all')).count).toBeGreaterThan(40);
    // The mark's pill is 40px high, 20px from the bottom; the clock's text must end above it.
    const region = await page.evaluate(
      ([w, h]) => {
        const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement;
        const d = c.getContext('2d')!.getImageData(Math.floor(w * 0.6), 0, Math.floor(w * 0.4), h).data;
        const rows: number[] = [];
        for (let y = 0; y < h; y++) {
          let n = 0;
          for (let x = 0; x < Math.floor(w * 0.4); x++) {
            const o = (y * Math.floor(w * 0.4) + x) * 4;
            if (Math.min(d[o], d[o + 1], d[o + 2]) >= 235) n++;
          }
          if (n > 0) rows.push(y);
        }
        return rows;
      },
      [W, H],
    );
    const lowRows = region.filter((y) => y > H * 0.6);
    // Two separate groups of white text rows in the bottom right: the clock, then (further down) the mark.
    const gaps = lowRows.filter((y, i) => i > 0 && y - lowRows[i - 1] > 3);
    expect(lowRows.length).toBeGreaterThan(0);
    expect(gaps.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...lowRows)).toBeLessThanOrEqual(H - 20);
  });

  test('with an ad shrinking the picture, the clock follows the picture instead of being covered by the ad', async ({ page, context }) => {
    const { api } = await signIn(context);
    await makeKit(api, { ...PILL, clockEnabled: true, clockPosition: 'bottom_right' });
    await pinTime(page);
    const id = await newStream(api);
    await openStudio(page, id);
    const { width: W, height: H } = await canvasSize(page);
    await expect.poll(async () => (await whiteBox(page, 'bottom_right')).count).toBeGreaterThan(40);
    const free = await whiteBox(page, 'bottom_right');
    await openLook(page);
    await studioTab(page, 'Ads');
    await pinAdClock(page, 0);
    await page.locator('#adFile-lower_third').setInputFiles({ name: 'lt.png', mimeType: 'image/png', buffer: solidPng(255, 0, 0, 128, 24) });
    const ad = adRect('lower_third', W, H, 0);
    // The ad is red across the bottom third; the shrunken picture (and the clock in its corner) sits above it.
    await expect.poll(async () => (await whiteBox(page, 'bottom_right')).y1 < ad.y || (await whiteBox(page, 'bottom_right')).count === 0).toBe(true);
    await expect.poll(async () => {
      const b = await whiteBox(page, 'all');
      return b.count > 40 && b.y1 < ad.y;
    }).toBe(true);
    expect(free.y1).toBeGreaterThan(ad.y); // before the ad, the clock was down there
  });
});

// ---- Compact text (the default look) -------------------------------------------------------------------------------

/** All four channels of a canvas rectangle, flattened. */
const snap = (page: Page, x: number, y: number, w: number, h: number) =>
  page.evaluate(([sx, sy, sw, sh]) => {
    const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement;
    return Array.from(c.getContext('2d')!.getImageData(sx, sy, sw, sh).data);
  }, [x, y, w, h]);
const pixelAt = async (page: Page, x: number, y: number) => (await snap(page, x, y, 1, 1)).slice(0, 3);
const sameRgb = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= 6;

async function logoAsset(api: APIRequestContext, w = 90, h = 90) {
  const res = await api.post(`${APP}/api/assets`, { multipart: { kind: 'logo', name: 'logo', file: { name: 'logo.png', mimeType: 'image/png', buffer: solidPng(255, 0, 0, w, h) } }, headers: { Origin: APP } });
  return (await res.json()).id as string;
}

test.describe('kit editor: style and alternate', () => {
  test('a new kit is compact text that alternates; the controls and hint follow; pill and "together" save and come back', async ({ page, context }) => {
    const { api } = await signIn(context);
    await makeKit(api, { clockEnabled: true, clockTimezone: 'Asia/Kolkata' });
    await pinTime(page, T_TIME);
    await page.goto('/brand');
    await page.getByRole('button', { name: 'Edit Newsroom' }).click();
    const section = page.getByTestId('kit-clock');
    await expect(section.getByTestId('clock-style-text')).toHaveAttribute('aria-pressed', 'true');
    await expect(section.getByTestId('clock-style-pill')).toHaveAttribute('aria-pressed', 'false');
    await expect(section.getByTestId('clock-alternate')).toBeChecked();
    await expect(section.getByTestId('clock-style-hint')).toHaveText('Compact text sits under your logo and swaps between the time and the date.');
    await expect(section.getByTestId('clock-size-small')).toHaveAttribute('aria-pressed', 'true');
    const preview = page.getByTestId('kit-preview-clock');
    await expect(preview).toHaveAttribute('data-style', 'text');
    // The preview takes turns like the studio: the time now, the date in the date part of the cycle.
    await expect(preview).toHaveAttribute('data-showing', 'time');
    await expect(preview).toContainText('03:04 PM');
    await setNow(page, T_DATE);
    await expect(preview).toHaveAttribute('data-showing', 'date');
    await expect(preview).toContainText('18 Nov, 2026');

    await section.getByTestId('clock-style-pill').click();
    await expect(preview).toHaveAttribute('data-style', 'pill');
    await expect(section.getByTestId('clock-style-hint')).not.toContainText('Compact text sits under your logo');
    await section.getByTestId('clock-alternate').uncheck();
    await expect(preview).toHaveAttribute('data-showing', 'both');
    await page.getByRole('button', { name: 'Save kit' }).click();
    await expect(page.getByText('Saved "Newsroom".')).toBeVisible();
    expect((await (await api.get(`${APP}/api/brand-kits`)).json())[0]).toMatchObject({ clockStyle: 'pill', clockAlternate: false, clockSize: 'small' });

    await page.getByRole('button', { name: 'Edit Newsroom' }).click();
    const again = page.getByTestId('kit-clock');
    await expect(again.getByTestId('clock-style-pill')).toHaveAttribute('aria-pressed', 'true');
    await expect(again.getByTestId('clock-alternate')).not.toBeChecked();
  });

  test('the preview shows the compact text centred under the logo', async ({ page, context }) => {
    const { api } = await signIn(context);
    await makeKit(api, { logoAssetId: await logoAsset(api, 120, 60), logoPosition: 'right', clockEnabled: true, clockPosition: 'top_right' });
    await pinTime(page, T_TIME);
    await page.goto('/brand');
    await page.getByRole('button', { name: 'Edit Newsroom' }).click();
    const kitPreview = page.getByTestId('kit-preview').last();
    const logoImg = kitPreview.locator('.kit-preview-logo');
    await expect(logoImg).toBeVisible();
    await expect.poll(async () => {
      const l = await logoImg.boundingBox();
      const c = await kitPreview.getByTestId('kit-preview-clock').boundingBox();
      if (!l || !c) return 99;
      return Math.abs(c.x + c.width / 2 - (l.x + l.width / 2));
    }).toBeLessThan(2);
    const l = await logoImg.boundingBox();
    const c = await kitPreview.getByTestId('kit-preview-clock').boundingBox();
    expect(c!.y).toBeGreaterThanOrEqual(l!.y + l!.height - 1);
  });
});

test.describe('studio: compact text on the canvas', () => {
  test('a new kit looks compact: Look tab shows Compact text, alternating, small; the text has no box (nothing outside the glyphs changes)', async ({ page, context }) => {
    const { api } = await signIn(context);
    await makeKit(api, { clockEnabled: true, clockTimezone: 'Asia/Kolkata' }); // every clock field but "on" and the zone left to the defaults
    await pinTime(page, T_TIME);
    const id = await newStream(api);
    await openStudio(page, id);
    const { width: W } = await canvasSize(page);
    await openLook(page);
    const panel = page.getByTestId('studio-clock');
    await expect(panel.getByTestId('clock-style-text')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByTestId('clock-alternate')).toBeChecked();
    await expect(panel.getByTestId('clock-size-small')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await whiteBox(page, 'top_right')).count).toBeGreaterThan(30);
    const ink = await whiteBox(page, 'top_right');
    // Small is 2 percent of the height (14 px): a one-line, compact text, in the usual corner margin.
    expect(ink.y1 - ink.y0).toBeLessThan(18);
    expect(ink.x1 - ink.x0).toBeLessThan(W * 0.1);
    expect(ink.x1).toBeLessThanOrEqual(W - 16);
    expect(ink.y0).toBeGreaterThanOrEqual(16);

    const pad = 14; // the shadow reaches about 5 px; a box (padding plus a plate) would show up here
    const X = ink.x0 - pad;
    const Y = ink.y0 - pad;
    const w = ink.x1 - ink.x0 + 2 * pad;
    const h = ink.y1 - ink.y0 + 2 * pad;
    const withClock = await snap(page, X, Y, w, h);
    await panel.getByTestId('clock-enabled').uncheck();
    await expect.poll(async () => (await whiteBox(page, 'top_right')).count).toBe(0);
    const without = await snap(page, X, Y, w, h);
    const at = (d: number[], x: number, y: number) => [d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2]];
    // The four corners and the middle of every side, a little outside the glyphs: exactly the background.
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [0, h >> 1], [w - 1, h >> 1], [w >> 1, 0], [w >> 1, h - 1]]) {
      expect(sameRgb(at(withClock, x, y), at(without, x, y))).toBe(true);
    }
    // The text itself did change something (so this is not comparing two empty pictures).
    let changed = 0;
    for (let i = 0; i < withClock.length; i += 4) if (!sameRgb(withClock.slice(i, i + 3), without.slice(i, i + 3))) changed++;
    expect(changed).toBeGreaterThan(30);
  });

  test('the time shows first, then the date, then the time again: the right text at the right moments, with a short cross-fade', async ({ page, context }) => {
    const { api } = await signIn(context);
    await makeKit(api, { clockEnabled: true, clockTimezone: 'Asia/Kolkata', clockSize: 'large' });
    await pinTime(page, T_TIME);
    const id = await newStream(api);
    await openStudio(page, id);
    await expect.poll(async () => (await whiteBox(page, 'top_right')).count).toBeGreaterThan(60);
    const time = await whiteBox(page, 'top_right');
    const at = async (ms: number) => {
      await setNow(page, BASE + ms);
      await page.waitForTimeout(250); // a few redraws
      return whiteBox(page, 'top_right');
    };
    // "03:04 PM" is 8 characters, "18 Nov, 2026" is 12: the date's ink is clearly wider.
    const t1 = await at(4999);
    expect(t1.x1 - t1.x0).toBe(time.x1 - time.x0);
    const mid = await at(5100); // halfway through the cross-fade: neither is fully white
    expect(mid.count).toBeLessThan(time.count * 0.4);
    const d1 = await at(5200);
    expect(d1.x1 - d1.x0).toBeGreaterThan((time.x1 - time.x0) * 1.3);
    const d2 = await at(7999);
    expect(d2).toEqual(d1);
    const t2 = await at(8000 + 200);
    expect(t2).toEqual(time);
    const t0 = await at(8000 + 100);
    expect(t0.count).toBeLessThan(time.count * 0.4);
    // With no logo the text hugs the right corner: both texts end at the same right edge, so they never jump about.
    expect(Math.abs(d1.x1 - time.x1)).toBeLessThanOrEqual(3);
  });

  test('"alternate" off shows the date and the time together on one line; date off shows only the time', async ({ page, context }) => {
    const { api } = await signIn(context);
    await makeKit(api, { clockEnabled: true, clockTimezone: 'Asia/Kolkata', clockAlternate: false, clockSize: 'large' });
    await pinTime(page, T_DATE);
    const id = await newStream(api);
    await openStudio(page, id);
    await expect.poll(async () => (await whiteBox(page, 'top_right')).count).toBeGreaterThan(60);
    const together = await whiteBox(page, 'top_right');
    // The same on screen at the time part of the cycle: nothing alternates.
    await setNow(page, T_TIME);
    await page.waitForTimeout(250);
    expect(await whiteBox(page, 'top_right')).toEqual(together);
    await openLook(page);
    const panel = page.getByTestId('studio-clock');
    await panel.getByTestId('clock-show-date').uncheck();
    await expect(panel.getByTestId('clock-alternate')).toHaveCount(0);
    await expect.poll(async () => (await whiteBox(page, 'top_right')).count).toBeGreaterThan(30);
    const timeOnly = await whiteBox(page, 'top_right');
    expect(timeOnly.x1 - timeOnly.x0).toBeLessThan((together.x1 - together.x0) * 0.6);
    await setNow(page, T_DATE); // still the time, even in the date part of the cycle
    await page.waitForTimeout(250);
    expect(await whiteBox(page, 'top_right')).toEqual(timeOnly);
  });

  test('under the logo: centred on the logo, just below it, never over it (logo on the right and on the left)', async ({ page, context }) => {
    const { api } = await signIn(context);
    const logo = await logoAsset(api);
    for (const [side, corner] of [['right', 'top_right'], ['left', 'top_left']] as Array<['right' | 'left', Corner]>) {
      await makeKit(api, { logoAssetId: logo, logoPosition: side, logoSize: 90, clockEnabled: true, clockPosition: corner, clockTimezone: 'Asia/Kolkata' });
      const p = await context.newPage();
      await pinTime(p, T_TIME);
      const id = await newStream(api);
      await openStudio(p, id);
      const { width: W } = await canvasSize(p);
      const logoCx = side === 'right' ? W - 16 - 45 : 16 + 45;
      await expect.poll(async () => isRedPixel(await pixelAt(p, logoCx, 16 + 45))).toBe(true);
      await expect.poll(async () => (await whiteBox(p, corner)).count).toBeGreaterThan(30);
      const ink = await whiteBox(p, corner);
      expect(Math.abs((ink.x0 + ink.x1) / 2 - logoCx)).toBeLessThanOrEqual(5);
      expect(ink.y0).toBeGreaterThanOrEqual(16 + 90 + 4); // below the logo's bottom edge, with its gap
      expect(ink.y0).toBeLessThanOrEqual(16 + 90 + 20);
      await expect.poll(async () => isRedPixel(await pixelAt(p, logoCx, 16 + 45))).toBe(true); // the logo is there (it fades in) and not covered
      await p.close();
      for (const k of await (await api.get(`${APP}/api/brand-kits`)).json()) await api.delete(`${APP}/api/brand-kits/${k.id}`, { headers: apiHeaders });
    }
  });

  test('a different corner than the logo hugs its own corner, and a vertical stream centres it under the logo too', async ({ page, context }) => {
    const { api } = await signIn(context);
    await makeKit(api, { logoAssetId: await logoAsset(api), logoPosition: 'right', logoSize: 90, clockEnabled: true, clockPosition: 'top_left', clockTimezone: 'Asia/Kolkata' });
    await pinTime(page, T_TIME);
    const land = await newStream(api);
    await openStudio(page, land);
    await expect.poll(async () => (await whiteBox(page, 'top_left')).count).toBeGreaterThan(30);
    const own = await whiteBox(page, 'top_left');
    expect(own.x0).toBeGreaterThanOrEqual(16);
    expect(own.x0).toBeLessThan(16 + 12); // left-aligned at the margin
    expect(own.y0).toBeLessThan(16 + 12); // at the top, not pushed down
    expect((await whiteBox(page, 'top_right')).count).toBe(0);

    const portrait = await newStream(api, 'portrait');
    await openStudio(page, portrait);
    const { width: W } = await canvasSize(page);
    await openLook(page);
    await page.getByTestId('clock-position-top_right').click();
    await expect.poll(async () => (await whiteBox(page, 'top_right')).count).toBeGreaterThan(30);
    const ink = await whiteBox(page, 'top_right');
    expect(Math.abs((ink.x0 + ink.x1) / 2 - (W - 16 - 45))).toBeLessThanOrEqual(5); // under the logo on the narrow frame too
    expect(ink.y0).toBeGreaterThanOrEqual(16 + 90 + 4);
  });

  test('compact text in the bottom corners keeps its clearance (above the ticker; the vertical stream\'s platform bar)', async ({ page, context }) => {
    const { api } = await signIn(context);
    await makeKit(api, { clockEnabled: true, clockPosition: 'bottom_left', clockTimezone: 'Asia/Kolkata' });
    await pinTime(page, T_TIME);
    const id = await newStream(api, 'portrait');
    await openStudio(page, id);
    const { height: H } = await canvasSize(page);
    await expect.poll(async () => (await whiteBox(page, 'bottom_left')).count).toBeGreaterThan(30);
    expect((await whiteBox(page, 'bottom_left')).y1).toBeLessThanOrEqual(H - Math.round(H * 0.06));
    const land = await newStream(api);
    await openStudio(page, land);
    const { height: HL } = await canvasSize(page);
    await expect.poll(async () => (await whiteBox(page, 'bottom_left')).count).toBeGreaterThan(30);
    await openLook(page);
    await page.locator('#newsInput').fill('Breaking: the clock keeps clear of the ticker');
    const bar = newsBarHeight(18);
    await expect.poll(async () => (await whiteBox(page, 'bottom_left', HL - bar)).y1).toBeLessThanOrEqual(HL - bar - 4);
  });

  test('the pill style with alternate swaps date and time inside one pill, and the pill itself never changes size', async ({ page, context }) => {
    const { api } = await signIn(context);
    await makeKit(api, { clockEnabled: true, clockStyle: 'pill', clockAlternate: true, clockSize: 'medium', clockTimezone: 'Asia/Kolkata' });
    await pinTime(page, T_TIME);
    const id = await newStream(api);
    await openStudio(page, id);
    await expect.poll(async () => (await whiteBox(page, 'top_right')).count).toBeGreaterThan(40);
    const plate = (x: number, y: number) => pixelAt(page, x, y);
    const time = await whiteBox(page, 'top_right');
    const left = [time.x0 - 8, Math.round((time.y0 + time.y1) / 2)] as const;
    expect(Math.max(...(await plate(...left)))).toBeLessThan(70);
    await setNow(page, T_DATE);
    await page.waitForTimeout(250);
    const date = await whiteBox(page, 'top_right');
    expect(date.x1 - date.x0).toBeGreaterThan(time.x1 - time.x0);
    // The pill is as wide as the wider text: the plate is still dark just outside the date's ink and just outside the time's.
    expect(Math.max(...(await plate(date.x0 - 6, Math.round((date.y0 + date.y1) / 2))))).toBeLessThan(70);
  });

  test('a stream saved before the compact style existed keeps its pill and its one-line date and time; a kit-applied clock takes the kit\'s values', async ({ page, context }) => {
    const { api } = await signIn(context);
    await pinTime(page, T_TIME);
    const id = await newStream(api);
    await page.addInitScript(
      ([sid]) => {
        // What the studio stored before this change: a hand-set clock without style/alternate.
        if (!localStorage.getItem(`streambird:studio:${sid}:v1`)) {
          localStorage.setItem(`streambird:studio:${sid}:v1`, JSON.stringify({ clock: { enabled: true, position: 'top_right', format: '12h', showDate: true, showSeconds: false, timezone: 'Asia/Kolkata', size: 'medium' }, clockKitId: null }));
        }
      },
      [id],
    );
    await openStudio(page, id);
    await openLook(page);
    const panel = page.getByTestId('studio-clock');
    await expect(panel.getByTestId('clock-style-pill')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByTestId('clock-alternate')).not.toBeChecked();
    await expect(panel.getByTestId('clock-size-medium')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await whiteBox(page, 'top_right')).count).toBeGreaterThan(40);
    const ink = await whiteBox(page, 'top_right');
    expect(Math.max(...(await pixelAt(page, ink.x0 - 8, Math.round((ink.y0 + ink.y1) / 2))))).toBeLessThan(70); // the dark pill is there
    expect(ink.x1 - ink.x0).toBeGreaterThan(120); // "Wed 18 Nov  ·  3:04 PM" on one line
    await setNow(page, T_DATE);
    await page.waitForTimeout(250);
    expect(await whiteBox(page, 'top_right')).toEqual(ink); // it does not alternate

    // Switching to compact text in the panel is this stream's own choice and is remembered.
    await panel.getByTestId('clock-style-text').click();
    await expect(panel.getByTestId('clock-source')).toHaveText('Set for this stream.');
    await page.reload();
    await page.locator('canvas.studio-canvas').waitFor();
    await openLook(page);
    await expect(page.getByTestId('clock-style-text')).toHaveAttribute('aria-pressed', 'true');
  });
});

const isRedPixel = (p: number[]) => p[0] > 200 && p[1] < 60 && p[2] < 60;
