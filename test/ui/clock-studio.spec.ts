import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { newsBarHeight } from '../../web-app/src/studio/compose';
import { adRect } from '../../web-app/src/studio/ads';
import { APP, apiHeaders, canvasSize, newStream, patchFreePlan, pinAdClock, signIn, solidPng, studioTab } from './helpers';

// The on-air date and time: brand kit editor (save + preview), the studio applying the kit's clock, the per-stream override,
// and the canvas pixels (the clock is white text on a dark pill; the studio's time is pinned with window.__SB_TEST_NOW__).

const NOW = Date.UTC(2026, 10, 18, 9, 34, 5); // Wed 18 Nov 2026, 15:04:05 in India
type Corner = 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';

test.beforeEach(async ({ browser }) => patchFreePlan(browser, { assetStorageMb: 5, watermark: false }));
test.afterEach(async ({ browser }) => patchFreePlan(browser, { assetStorageMb: 0, watermark: true }));

async function pinTime(page: Page) {
  await page.addInitScript((n) => {
    localStorage.setItem('streambird:test:clock', 'on'); // arms the hook; without this the page ignores __SB_TEST_NOW__
    (window as unknown as { __SB_TEST_NOW__: number }).__SB_TEST_NOW__ = n;
  }, NOW);
}

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
    // Defaults once on: top right, 12 hour, date shown, no seconds, this device, medium.
    await expect(section.getByTestId('clock-position-top_right')).toHaveAttribute('aria-pressed', 'true');
    await expect(section.getByTestId('clock-format-12h')).toHaveAttribute('aria-pressed', 'true');
    await expect(section.getByTestId('clock-show-date')).toBeChecked();
    await expect(section.getByTestId('clock-show-seconds')).not.toBeChecked();
    await expect(section.getByTestId('clock-size-medium')).toHaveAttribute('aria-pressed', 'true');
    await expect(section.getByTestId('clock-timezone')).toHaveValue('');
    const preview = page.getByTestId('kit-preview-clock');
    await expect(preview).toHaveAttribute('data-position', 'top_right');

    await section.getByTestId('clock-position-bottom_left').click();
    await expect(preview).toHaveAttribute('data-position', 'bottom_left');
    await section.getByTestId('clock-format-24h').click();
    await section.getByTestId('clock-show-seconds').check();
    await section.getByTestId('clock-size-large').click();
    await section.getByTestId('clock-timezone').selectOption('Asia/Kolkata');
    await expect(preview).toContainText('Wed 18 Nov');
    await expect(preview).toContainText('15:04:05');
    await section.getByTestId('clock-show-date').uncheck();
    await expect(preview).not.toContainText('Wed 18 Nov');
    await section.getByTestId('clock-show-date').check();

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
    expect(kits[0]).toMatchObject({ clockEnabled: true, clockPosition: 'bottom_left', clockFormat: '24h', clockShowDate: true, clockShowSeconds: true, clockTimezone: 'Asia/Kolkata', clockSize: 'large' });

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
    await makeKit(api, { logoAssetId: logo, logoPosition: 'right', clockEnabled: true, clockPosition: 'top_right' });
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
      await makeKit(api, { clockEnabled: true, clockPosition: corner, clockTimezone: 'Asia/Kolkata' });
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

  test('a stream with no kit at all can still switch the clock on for itself', async ({ page, context }) => {
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
    const kit = await makeKit(api, { clockEnabled: true, clockPosition: 'top_right', clockTimezone: 'Asia/Kolkata' });
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
    await makeKit(api, { clockEnabled: true });
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
    const kit = await makeKit(api, { clockEnabled: true, clockSize: 'large', clockPosition: 'top_left' });
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
    await makeKit(api, { logoAssetId: logo, logoPosition: 'right', logoSize: 90, clockEnabled: true, clockPosition: 'top_right' });
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
    await makeKit(api, { clockEnabled: true, clockPosition: 'bottom_right' });
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
    await makeKit(api, { clockEnabled: true, clockPosition: 'bottom_right' });
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
