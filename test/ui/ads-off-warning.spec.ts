import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { AD_PLACEMENTS } from '../../web-app/src/studio/ads';
import { adOffWarning, adOverrideDiffs, adOverrideNote, adsOffStatus, kitOffChip, offAdPlacements } from '../../web-app/src/studio/adOff';
import { APP, apiHeaders, canvasPixel, canvasSize, framePng, newStream, patchFreePlan, signIn, studioTab } from './helpers';

// "This ad is switched off" must be impossible to miss: on the studio ad card, in the studio status, on the Ads tab
// and in the kit editor/summary. Part 1 is pure; part 2 drives the real studio and the kit editor.

const FRAME = { width: 1280, height: 720, win: [256, 0, 1280, 576] as [number, number, number, number], frame: [200, 20, 20] as [number, number, number] };

test.describe('switched-off ad texts (pure)', () => {
  test('the card/kit warning names the ad', () => {
    expect(adOffWarning('l_shape')).toBe('L-shaped frame is switched off: tick On to use it');
    expect(adOffWarning('lower_third')).toBe('Lower third is switched off: tick On to use it');
    for (const p of AD_PLACEMENTS) expect(adOffWarning(p)).toMatch(/is switched off: tick On to use it$/);
  });

  test('offAdPlacements lists only ads that have a picture and are off, in placement order', () => {
    const ad = (hasMedia: boolean, enabled: boolean) => ({ hasMedia, enabled });
    expect(offAdPlacements({ l_shape: ad(true, false), lower_third: ad(true, false), side_third: ad(false, false), full_screen: ad(true, true) })).toEqual(['lower_third', 'l_shape']);
    expect(offAdPlacements({})).toEqual([]);
  });

  test('status line: one name, several names, at most three listed', () => {
    expect(adsOffStatus([])).toBeNull();
    expect(adsOffStatus(['l_shape'])).toBe('The L-shaped frame ad is switched off: open Ads and tick On to use it.');
    expect(adsOffStatus(['lower_third', 'l_shape'])).toBe('The Lower third and L-shaped frame ads are switched off: open Ads and tick On to use them.');
    expect(adsOffStatus(['lower_third', 'side_third', 'full_screen', 'l_shape'])).toBe(
      'The Lower third, Left third and Full screen ads (and 1 more) are switched off: open Ads and tick On to use them.',
    );
  });

  test('remembered On/Off that differs from the kit', () => {
    const kitAds = [{ placement: 'l_shape', enabled: true }, { placement: 'lower_third', enabled: true }];
    const diffs = adOverrideDiffs({ l_shape: { source: 'kit', enabled: false }, lower_third: { source: 'kit', enabled: true }, full_screen: { source: 'kit', enabled: false } }, kitAds);
    expect(diffs).toEqual([{ placement: 'l_shape', remembered: false, kit: true }]);
    expect(adOverrideNote(diffs)).toBe('This stream remembers L-shaped frame as Off; the kit has it On. Tick On or press From brand kit.');
    expect(adOverrideNote([])).toBeNull();
    expect(adOverrideDiffs({ l_shape: { source: 'computer', enabled: false } }, kitAds)).toEqual([]); // a picture from this computer is not the kit's
  });

  test('kit chip', () => {
    expect(kitOffChip(0)).toBeNull();
    expect(kitOffChip(1)).toBe('1 ad switched off');
    expect(kitOffChip(3)).toBe('3 ads switched off');
  });
});

async function uploadAd(api: APIRequestContext, name: string): Promise<string> {
  const res = await api.post(`${APP}/api/assets`, { multipart: { kind: 'ad', name, file: { name: `${name}.png`, mimeType: 'image/png', buffer: framePng(FRAME) } }, headers: { Origin: APP } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).id as string;
}

const redColumn = async (page: Page) => {
  const { width: W, height: H } = await canvasSize(page);
  const p = await canvasPixel(page, 0.1 * W, H / 2);
  return p[0] > 150 && p[1] < 60 && p[2] < 60;
};

test.describe('switched-off ads in the studio and the kit editor', () => {
  test.beforeEach(async ({ browser }) => patchFreePlan(browser, { watermark: false, assetStorageMb: 5 }));
  test.afterEach(async ({ browser }) => patchFreePlan(browser, { watermark: true, assetStorageMb: 0 }));

  test('a reloaded stream that remembers the frame as Off: warning row, Off badge, status, Ads tab dot; ticking On brings the frame up', async ({ page, context }) => {
    const { api } = await signIn(context);
    const assetId = await uploadAd(api, 'frame');
    const kit = await (await api.post(`${APP}/api/brand-kits`, { data: { name: 'News', ads: [{ placement: 'l_shape', assetId }] }, headers: apiHeaders })).json();
    const id = await newStream(api);
    await page.addInitScript(
      ({ sid, kid, aid }) => {
        if (!localStorage.getItem(`streambird:studio:${sid}:v1`)) {
          localStorage.setItem(
            `streambird:studio:${sid}:v1`,
            JSON.stringify({ brandKitId: kid, kitPending: false, ads: { l_shape: { source: 'kit', assetId: aid, name: 'frame.png', enabled: false, schedule: { mode: 'continuous' } } } }),
          );
        }
      },
      { sid: id, kid: kit.id, aid: assetId },
    );
    await page.goto(`/streams/${id}/studio`);
    await page.locator('canvas.studio-canvas').waitFor();

    // Studio status: names the ad, is a warning (not an error), and says what the stream remembers.
    const status = page.getByTestId('studio-status-warn');
    await expect(status).toContainText('The L-shaped frame ad is switched off: open Ads and tick On to use it.');
    await expect(status).toContainText('This stream remembers L-shaped frame as Off; the kit has it On. Tick On or press From brand kit.');
    await expect(status).not.toHaveClass(/error/);
    await expect(page.getByTestId('ads-off-badge')).toBeVisible();

    await studioTab(page, 'Ads');
    const card = page.getByTestId('ad-card-l_shape');
    await expect(card).toHaveAttribute('data-state', 'off');
    await expect(page.getByTestId('ad-off-l_shape')).toHaveText('L-shaped frame is switched off: tick On to use it');
    await expect(page.getByTestId('ad-off-l_shape')).toHaveAttribute('role', 'status');
    await expect(page.getByTestId('ad-off-badge-l_shape')).toHaveText('Off');
    expect(await redColumn(page)).toBe(false);

    await card.getByLabel('L-shaped frame ad on').check();
    await expect(page.getByTestId('ad-off-l_shape')).toHaveCount(0);
    await expect(page.getByTestId('ad-off-badge-l_shape')).toHaveCount(0);
    await expect(page.getByTestId('ads-off-badge')).toHaveCount(0);
    await expect.poll(() => redColumn(page)).toBe(true);
  });

  test('a new stream starts with every kit ad ON, even one saved as Off in the kit; switching it off in the studio then shows the warning', async ({ page, context }) => {
    const { api } = await signIn(context);
    const assetId = await uploadAd(api, 'frame');
    await api.post(`${APP}/api/brand-kits`, { data: { name: 'Default', isDefault: true, ads: [{ placement: 'l_shape', assetId, enabled: false }] }, headers: apiHeaders });
    const id = await newStream(api);
    await page.goto(`/streams/${id}/studio`);
    await page.locator('canvas.studio-canvas').waitFor();
    await studioTab(page, 'Ads');
    const card = page.getByTestId('ad-card-l_shape');
    await expect(card).toContainText('From the brand kit');
    await expect(card).toHaveAttribute('data-state', 'on');
    await expect(page.getByTestId('ad-off-l_shape')).toHaveCount(0);
    await expect.poll(() => redColumn(page)).toBe(true);

    await card.getByLabel('L-shaped frame ad on').uncheck();
    await expect(page.getByTestId('ad-off-l_shape')).toBeVisible();
    await expect(page.getByTestId('ads-off-badge')).toBeVisible();
    await expect.poll(() => redColumn(page)).toBe(false);

    // The stream remembers it across a reload and says so.
    await page.reload();
    await page.locator('canvas.studio-canvas').waitFor();
    await expect(page.getByTestId('studio-status-warn')).toContainText('The L-shaped frame ad is switched off');
    await expect(page.getByTestId('studio-status-warn')).toContainText('This stream remembers L-shaped frame as Off');
  });

  test('kit editor: unticking On shows the warning row and Off badge; the kit card lists "1 ad switched off"', async ({ page, context }) => {
    const { api } = await signIn(context);
    await page.goto('/brand');
    await page.getByRole('button', { name: 'New brand kit' }).click();
    const form = page.getByRole('form', { name: 'New brand kit' });
    await form.getByLabel('Kit name').fill('Switchy');
    const slot = form.getByTestId('kit-ad-l_shape');
    await form.getByLabel('L-shaped frame ad file').setInputFiles({ name: 'frame.png', mimeType: 'image/png', buffer: framePng(FRAME) });
    await expect(slot).toContainText('frame');
    await expect(form.getByTestId('kit-ad-off-l_shape')).toHaveCount(0);
    await form.getByLabel('L-shaped frame ad on').uncheck();
    await expect(form.getByTestId('kit-ad-off-l_shape')).toHaveText('L-shaped frame is switched off: tick On to use it');
    await expect(form.getByTestId('kit-ad-off-badge-l_shape')).toHaveText('Off');
    await form.getByLabel('L-shaped frame ad on').check();
    await expect(form.getByTestId('kit-ad-off-l_shape')).toHaveCount(0);
    await form.getByLabel('L-shaped frame ad on').uncheck();
    await form.getByRole('button', { name: 'Create kit' }).click();
    await expect(page.getByText('Created "Switchy".')).toBeVisible();
    expect((await (await api.get(`${APP}/api/brand-kits`)).json())[0].ads[0].enabled).toBe(false);
    await expect(page.getByTestId('kit-off-chip')).toHaveText('1 ad switched off');
  });
});
