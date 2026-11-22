import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
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

// Ad sequences: several ads of one placement played in turn (studio Ads tab, brand kit editor, canvas). The clock is pinned with
// window.__SB_TEST_AD_ELAPSED__. L-shaped frames without a clear window are drawn as plain overlays, so each ad is one solid colour
// and the centre pixel of the canvas says which one is on.

const LABEL = 'L-shaped frame';
const RED = [255, 0, 0] as const;
const GREEN = [0, 255, 0] as const;
const BLUE = [0, 0, 255] as const;
const png = (c: readonly [number, number, number]) => solidPng(c[0], c[1], c[2], 160, 90);
const file = (name: string, c: readonly [number, number, number]) => ({ name, mimeType: 'image/png', buffer: png(c) });
const card = (page: Page) => page.getByRole('group', { name: `${LABEL} ad`, exact: true }).first();
const pane = (page: Page) => page.getByTestId('ad-card-l_shape');

async function openStudio(page: Page, id: string) {
  await page.goto(`/streams/${id}/studio`);
  await page.locator('canvas.studio-canvas').waitFor();
}
async function centre(page: Page): Promise<Rgb> {
  const { width, height } = await canvasSize(page);
  return canvasPixel(page, width / 2, height / 2);
}
const colourAt = (page: Page, t: number) => pinAdClock(page, t).then(() => page.waitForTimeout(700)).then(() => centre(page));

/** Adds the first frame through the card's own file input and the others through "Add another". */
async function addFrames(page: Page, colours: ReadonlyArray<readonly [number, number, number]>) {
  await page.locator('#adFile-l_shape').setInputFiles(file('frame-1.png', colours[0]));
  await expect(pane(page).locator('.ad-file-name')).toHaveText('frame-1.png');
  for (let i = 1; i < colours.length; i++) {
    await page.locator('#adFileMore-l_shape').setInputFiles(file(`frame-${i + 1}.png`, colours[i]));
    await expect(page.getByTestId(`ad-seq-row-l_shape-${i + 1}`)).toContainText(`frame-${i + 1}.png`);
  }
}

test.describe('ad sequences in the studio (a plan without the Powered-by mark)', () => {
  test.beforeEach(async ({ browser }) => patchFreePlan(browser, { watermark: false }));
  test.afterEach(async ({ browser }) => patchFreePlan(browser, { watermark: true }));

  test('now and then: every time the show window comes round the NEXT frame shows, round-robin', async ({ page, context }) => {
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    await studioTab(page, 'Ads');
    await addFrames(page, [RED, GREEN, BLUE]);
    await pane(page).getByRole('button', { name: 'Now and then' }).click();
    // The sequence has one pause between showings (the first ad's) and a show time per ad.
    await expect(pane(page).getByLabel(`${LABEL} ad: show for`, { exact: true })).toHaveCount(0);
    await pane(page).getByLabel(`${LABEL} ad: hide for unit`).selectOption('sec');
    await pane(page).getByLabel(`${LABEL} ad: hide for`, { exact: true }).fill('30');
    for (const n of [1, 2, 3]) await page.getByLabel(`${LABEL} ad ${n}: seconds`).fill('10');

    // Cycles of 40 s: hidden 30, shown 10, for each ad in turn (one round = 120 s).
    expect(isPlainAd(await colourAt(page, 20))).toBe(false); // hidden first
    expect(isRed(await colourAt(page, 35))).toBe(true);
    await expect(page.getByTestId('ad-now-l_shape')).toHaveText('Now showing 1 of 3');
    expect(isPlainAd(await colourAt(page, 55))).toBe(false); // ad 2's hidden part
    await expect(page.getByTestId('ad-now-l_shape')).toHaveText('Next up 2 of 3');
    expect(isGreen(await colourAt(page, 75))).toBe(true);
    await expect(page.getByTestId('ad-now-l_shape')).toHaveText('Now showing 2 of 3');
    expect(isBlue(await colourAt(page, 115))).toBe(true);
    expect(isPlainAd(await colourAt(page, 125))).toBe(false); // round 2 starts hidden
    expect(isRed(await colourAt(page, 120 + 35))).toBe(true); // ... and the next window shows ad 1 again
    expect(isGreen(await colourAt(page, 120 + 75))).toBe(true);

    // Show now shows the ad whose turn is next, even in the hidden part; Hide hides the whole place.
    await pinAdClock(page, 120 + 45); // ad 2's cycle... wait: 165 is inside ad 2's hidden part
    await pane(page).getByRole('button', { name: `Show the ${LABEL} ad now` }).click();
    await expect.poll(async () => isGreen(await centre(page))).toBe(true);
    await pane(page).getByRole('button', { name: `Hide the ${LABEL} ad` }).click();
    await expect.poll(async () => isPlainAd(await centre(page))).toBe(false);
  });

  test('always on: the frames rotate by their own seconds with a cross-fade; a switched-off frame is skipped and says so', async ({ page, context }) => {
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    await studioTab(page, 'Ads');
    await addFrames(page, [RED, GREEN, BLUE]);
    // Always on is the default; the seconds per ad default to 20 s and accept 5 to 300.
    for (const n of [1, 2, 3]) await expect(page.getByLabel(`${LABEL} ad ${n}: seconds`)).toHaveValue('20');
    for (const n of [1, 2, 3]) await page.getByLabel(`${LABEL} ad ${n}: seconds`).fill('5');
    await page.getByLabel(`${LABEL} ad 2: seconds`).fill('4'); // refused: below 5 s, nothing is applied
    await expect(page.getByLabel(`${LABEL} ad 2: seconds`)).toHaveAttribute('aria-invalid', 'true');

    expect(isRed(await colourAt(page, 2))).toBe(true);
    expect(isGreen(await colourAt(page, 7))).toBe(true);
    await expect(page.getByTestId('ad-now-l_shape')).toHaveText('Now showing 2 of 3');
    expect(isBlue(await colourAt(page, 12))).toBe(true);
    expect(isRed(await colourAt(page, 17))).toBe(true); // 15 s round: back to the first
    // Half-way through the cross-fade neither colour is whole.
    await pinAdClock(page, 5.15);
    await expect.poll(async () => !isPlainAd(await centre(page))).toBe(true);
    const mid = await centre(page);
    expect(mid[0] > 20 && mid[1] > 20).toBe(true); // red and green both present

    // Switch frame 2 off: the rotation is red, blue.
    await page.getByLabel(`${LABEL} ad 2 on`).uncheck();
    await expect(page.getByTestId('ad-off-l_shape-2')).toHaveText('L-shaped frame ad 2 is switched off: tick On to use it');
    expect(isBlue(await colourAt(page, 7))).toBe(true);
    expect(isRed(await colourAt(page, 2))).toBe(true);
    // All off: the place is off, with the usual note on the card.
    await pane(page).getByLabel(`${LABEL} ad on`).uncheck();
    await page.getByLabel(`${LABEL} ad 3 on`).uncheck();
    await expect(page.getByTestId('ad-off-l_shape')).toBeVisible();
    await expect(page.getByTestId('ad-status-l_shape')).toHaveText('Switched off');
    expect(isPlainAd(await colourAt(page, 2))).toBe(false);
    await expect(pane(page).getByRole('button', { name: `Show the ${LABEL} ad now` })).toBeDisabled();
  });

  test('reorder, remove and the limit of five; the list survives a reload', async ({ page, context }) => {
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    await studioTab(page, 'Ads');
    await addFrames(page, [RED, GREEN, BLUE]);
    await expect(pane(page).getByLabel('Move L-shaped frame ad 1 up')).toBeDisabled();
    await expect(pane(page).getByLabel('Move L-shaped frame ad 3 down')).toBeDisabled();
    // Move blue to the front: blue, red, green.
    await pane(page).getByLabel('Move L-shaped frame ad 3 up').click();
    await pane(page).getByLabel('Move L-shaped frame ad 2 up').click();
    await expect(pane(page).locator('.ad-seq-name')).toHaveText(['1. frame-3.png', '2. frame-1.png', '3. frame-2.png']);
    expect(isBlue(await colourAt(page, 2))).toBe(true);
    await pane(page).getByLabel(`${LABEL} ad 3 on`).uncheck();
    // The small pictures are kept in this browser under their place in the list (written a moment after the change).
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.endsWith(':adfiles:v1') && (localStorage.getItem(k) ?? '').includes('l_shape#2')))).toBe(true);

    await page.reload();
    await page.locator('canvas.studio-canvas').waitFor();
    await studioTab(page, 'Ads');
    await expect(pane(page).locator('.ad-seq-name')).toHaveText(['1. frame-3.png', '2. frame-1.png', '3. frame-2.png']);
    await expect(page.getByLabel(`${LABEL} ad 3 on`)).not.toBeChecked();
    await expect(page.getByLabel(`${LABEL} ad 2 on`)).toBeChecked();
    expect(isBlue(await colourAt(page, 2))).toBe(true);
    expect(isRed(await colourAt(page, 22))).toBe(true); // green is off: blue, red

    // Remove the middle one, then fill up to five: the Add button goes away at the limit.
    await pane(page).getByLabel(`Remove ${LABEL} ad 2`).click();
    await expect(pane(page).locator('.ad-seq-name')).toHaveText(['1. frame-3.png', '2. frame-2.png']);
    for (const i of [4, 5, 6]) {
      await page.locator('#adFileMore-l_shape').setInputFiles(file(`frame-${i}.png`, RED));
      await expect(pane(page).locator('.ad-seq-name')).toHaveCount(Math.min(i - 1, 5)); // the sixth is refused
    }
    await expect(pane(page).getByRole('button', { name: `Add another ${LABEL} ad` })).toHaveCount(0);
    // Removing the first ad lets the next one move up (the card is the first ad).
    await pane(page).getByRole('button', { name: `Remove the ${LABEL} ad picture` }).click();
    await expect(pane(page).locator('.ad-seq-name')).toHaveCount(4);
    await expect(pane(page).locator('.ad-file-name')).toHaveText('frame-2.png');
    await expect(pane(page).getByRole('button', { name: `Add another ${LABEL} ad` })).toBeVisible();
  });

  test('a single ad is unchanged: no list, the same card, the same schedule fields', async ({ page, context }) => {
    const { api } = await signIn(context);
    await openStudio(page, await newStream(api));
    await studioTab(page, 'Ads');
    await page.locator('#adFile-l_shape').setInputFiles(file('only.png', RED));
    await expect(pane(page).locator('.ad-file-name')).toHaveText('only.png');
    await expect(pane(page).locator('.ad-seq-list')).toHaveCount(0);
    await expect(page.getByTestId('ad-now-l_shape')).toHaveCount(0);
    await pane(page).getByRole('button', { name: 'Now and then' }).click();
    await expect(pane(page).getByLabel(`${LABEL} ad: show for`, { exact: true })).toBeVisible(); // the usual Show for / Then hide for
    await expect(pane(page).getByLabel(`${LABEL} ad: hide for`, { exact: true })).toBeVisible();
    expect(isRed(await colourAt(page, 120 + 10))).toBe(false); // default 15 s every 180 s: hidden first (t = 130 of 195)
    expect(isRed(await colourAt(page, 185))).toBe(true);
  });
});

test.describe('ad sequences in the brand kit', () => {
  test.beforeEach(async ({ browser }) => patchFreePlan(browser, { watermark: false, assetStorageMb: 20 }));
  test.afterEach(async ({ browser }) => patchFreePlan(browser, { watermark: true, assetStorageMb: 0 }));

  const upload = async (api: APIRequestContext, name: string, c: readonly [number, number, number]) =>
    (await (await api.post(`${APP}/api/assets`, { multipart: { kind: 'ad', name, file: { name: `${name}.png`, mimeType: 'image/png', buffer: png(c) } }, headers: { Origin: APP } })).json()).id as string;

  test('the kit editor adds, reorders, switches off and removes frames of a place, and saves them', async ({ page, context }) => {
    const { api } = await signIn(context);
    await page.goto('/brand');
    await page.getByRole('button', { name: 'New brand kit' }).click();
    const form = page.getByRole('form', { name: 'New brand kit' });
    await form.getByLabel('Kit name').fill('Frames');
    const first = form.getByRole('group', { name: `${LABEL} ad`, exact: true });
    await first.getByLabel(`${LABEL} ad file`, { exact: true }).setInputFiles(file('f1.png', RED));
    await expect(first.getByTestId('kit-slot-l_shape')).toContainText('f1');
    // Add another: a new slot appears for ad 2 (the same test ids with a suffix); cancel leaves nothing behind.
    await form.getByRole('button', { name: `Add another ${LABEL} ad` }).click();
    await form.getByRole('button', { name: `Cancel adding ${LABEL} ad 2` }).click();
    await expect(form.getByTestId('kit-ad-l_shape-2')).toHaveCount(0);
    for (const [i, c] of [[2, GREEN], [3, BLUE]] as const) {
      await form.getByRole('button', { name: `Add another ${LABEL} ad` }).click();
      await form.getByTestId(`kit-ad-l_shape-${i}`).getByLabel(`${LABEL} ad ${i} file`).setInputFiles(file(`f${i}.png`, c));
      await expect(form.getByTestId(`kit-slot-l_shape-${i}`)).toContainText(`f${i}`);
    }
    await expect(form.getByTestId('kit-ad-seq-help-l_shape')).toContainText('These 3 ads take turns');
    // Position 1 keeps the ids and names it always had (the selector contract).
    await expect(form.getByTestId('kit-slot-l_shape')).toContainText('f1');
    await expect(first.getByLabel(`${LABEL} ad on`)).toBeChecked();

    // Per-ad switched-off warning and badge, with the ad's number.
    await form.getByLabel(`${LABEL} ad 2 on`).uncheck();
    await expect(form.getByTestId('kit-ad-off-l_shape-2')).toHaveText('L-shaped frame ad 2 is switched off: tick On to use it');
    await expect(form.getByTestId('kit-ad-off-badge-l_shape-2')).toBeVisible();
    await expect(form.getByTestId('kit-ad-off-l_shape')).toHaveCount(0); // ad 1 is on
    // Seconds per ad (always on: 5..300) and the order.
    await form.getByLabel(`${LABEL} ad 3: seconds`).fill('45');
    await form.getByLabel(`Move ${LABEL} ad 3 up`).click();
    await expect(form.getByLabel(`${LABEL} ad 2 on`)).toBeChecked(); // what was ad 3 is now ad 2 (blue, 45 s)
    await expect(form.getByLabel(`${LABEL} ad 3 on`)).not.toBeChecked(); // green, off, is now ad 3
    await form.getByRole('button', { name: 'Create kit' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Created "Frames"' })).toBeVisible();

    const kit = (await (await api.get(`${APP}/api/brand-kits`)).json())[0];
    expect(kit.ads).toHaveLength(1);
    expect(kit.adsMore).toHaveLength(2);
    expect(kit.adsMore.map((a: { enabled: boolean; showSec: number | null }) => [a.enabled, a.showSec])).toEqual([[true, 45], [false, 20]]);
    expect(kit.ads[0].showSec).toBe(20); // a sequence's first ad has its own seconds too

    // Edit: the list comes back as saved; remove ad 2 and save; the first ad alone is a plain single ad again.
    await page.reload();
    await page.getByRole('button', { name: 'Edit Frames' }).click();
    const edit = page.getByRole('form', { name: 'Brand kit Frames' });
    await expect(edit.getByRole('button', { name: 'Save kit' })).toBeDisabled();
    await expect(edit.getByLabel(`${LABEL} ad 3 on`)).not.toBeChecked();
    await edit.getByRole('button', { name: `Remove ${LABEL} ad 2` }).click();
    await edit.getByRole('button', { name: `Remove ${LABEL} ad 2` }).click();
    await edit.getByRole('button', { name: 'Save kit' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved "Frames"' })).toBeVisible();
    const single = (await (await api.get(`${APP}/api/brand-kits`)).json())[0];
    expect(single.adsMore).toEqual([]);
    expect(single.ads[0].showSec).toBeNull();
  });

  test('a kit sequence is applied in the studio in order and plays; the vertical set has its own sequence', async ({ page, context }) => {
    const { api } = await signIn(context);
    const [a, b, c, p1, p2] = await Promise.all([upload(api, 'ka', RED), upload(api, 'kb', GREEN), upload(api, 'kc', BLUE), upload(api, 'pa', GREEN), upload(api, 'pb', BLUE)]);
    const made = await api.post(`${APP}/api/brand-kits`, {
      data: {
        name: 'Seq kit',
        ads: [{ placement: 'l_shape', assetId: a, showSec: 5 }],
        adsMore: [
          { placement: 'l_shape', assetId: b, showSec: 5 },
          { placement: 'l_shape', assetId: c, showSec: 5, enabled: false },
        ],
        adsPortrait: [{ placement: 'l_shape', assetId: p1, showSec: 5 }],
        adsMorePortrait: [{ placement: 'l_shape', assetId: p2, showSec: 5 }],
      },
      headers: apiHeaders,
    });
    expect(made.ok()).toBeTruthy();

    await openStudio(page, await newStream(api));
    await studioTab(page, 'Ads');
    // The kit's ads fill the card in order; a kit ad flagged Off in the kit starts ON here (the studio never inherits the kit's flag).
    await expect(pane(page).locator('.ad-seq-name')).toHaveText(['1. Seq kit l_shape', '2. Seq kit l_shape 2', '3. Seq kit l_shape 3']);
    await expect(page.getByLabel(`${LABEL} ad 3 on`)).toBeChecked();
    expect(isRed(await colourAt(page, 2))).toBe(true);
    expect(isGreen(await colourAt(page, 7))).toBe(true);
    expect(isBlue(await colourAt(page, 12))).toBe(true);
    // Replace the whole sequence by a computer file, then "From brand kit" brings the kit's three back.
    await page.locator('#adFile-l_shape').setInputFiles(file('mine.png', BLUE));
    await expect(pane(page).locator('.ad-file-name')).toHaveText('mine.png');
    await pane(page).getByRole('button', { name: 'From brand kit' }).click();
    await expect(pane(page).locator('.ad-seq-name')).toHaveCount(3);

    // A vertical stream gets the portrait set only: two ads, green then blue.
    await openStudio(page, await newStream(api, 'portrait'));
    await studioTab(page, 'Ads');
    await expect(pane(page).locator('.ad-seq-name')).toHaveCount(2);
    expect(isGreen(await colourAt(page, 2))).toBe(true);
    expect(isBlue(await colourAt(page, 7))).toBe(true);
  });
});
