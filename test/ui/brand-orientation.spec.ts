import { expect, test, type Page } from '@playwright/test';
import { APP, apiHeaders, canvasPixel, canvasSize, isRed, newStream, patchFreePlan, pinAdClock, signIn, solidPng, studioTab, type Rgb } from './helpers';

// The unified brand kit editor (every graphic uploaded in place, 16:9 and 9:16 sets, size hints, shape warnings) and
// how the studio picks the set that matches the stream's orientation. The picture-shrinks-while-ads-show behaviour is
// in ads-shrink.spec.ts.

const YELLOW = [255, 255, 0] as const;
const MAGENTA = [255, 0, 255] as const;
const isYellow = (p: Rgb) => p[0] > 200 && p[1] > 200 && p[2] < 60;
const isMagenta = (p: Rgb) => p[0] > 200 && p[2] > 200 && p[1] < 60;

test.describe('unified brand kit editor', () => {
  test.beforeEach(async ({ browser }) => patchFreePlan(browser, { watermark: false, assetStorageMb: 5 }));
  test.afterEach(async ({ browser }) => patchFreePlan(browser, { watermark: true, assetStorageMb: 0 }));

  test('one flow: upload in each slot, separate 16:9 and 9:16 sets, size hints, shape warnings, replace and remove', async ({ page, context }) => {
    const { api } = await signIn(context);
    await page.goto('/brand');
    // No separate upload section any more.
    await expect(page.getByLabel(/Image \(PNG/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Upload', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'New brand kit' }).click();
    const form = page.getByRole('form', { name: 'New brand kit' });
    await form.getByLabel('Kit name').fill('Both shapes');

    // 16:9 tab is first; the helper text shows the suggested sizes and limits next to every slot.
    await expect(form.getByRole('tab', { name: '16:9 landscape' })).toHaveAttribute('aria-selected', 'true');
    await expect(form.getByTestId('slot-size-logo')).toHaveText('Suggested 512 x 512');
    await expect(form.getByTestId('slot-help-logo')).toContainText('transparent');
    await expect(form.getByTestId('slot-help-logo')).toContainText('up to 4 MB');
    await expect(form.getByTestId('slot-size-wallpaper')).toHaveText('Suggested 1920 x 1080');
    await expect(form.getByTestId('slot-size-lower_third')).toHaveText('Suggested 1280 x 240');
    await expect(form.getByTestId('slot-size-side_third')).toHaveText('Suggested 640 x 1080');
    await expect(form.getByTestId('slot-size-full_screen')).toHaveText('Suggested 1920 x 1080');
    await expect(form.getByTestId('slot-help-lower_third')).toContainText('16:3');

    // Upload the 16:9 logo in place: it shows in the slot and in the preview, with its size.
    await form.getByLabel('Logo file').setInputFiles({ name: 'logo16.png', mimeType: 'image/png', buffer: solidPng(...YELLOW, 200, 200) });
    const logoSlot = form.getByTestId('kit-slot-logo');
    await expect(logoSlot).toHaveAttribute('data-has-file', 'true');
    await expect(logoSlot).toContainText('logo16');
    await expect(logoSlot).toContainText('200 x 200');
    await expect(form.getByTestId('slot-warning-logo')).toHaveCount(0); // square logo: fine
    await expect(form.getByTestId('kit-preview').locator('.kit-preview-logo')).toBeVisible();

    // A wallpaper far from 16:9 gets a (non-blocking) warning; a 16:9 one does not.
    await form.getByLabel('Wallpaper file').setInputFiles({ name: 'tall.png', mimeType: 'image/png', buffer: solidPng(10, 10, 80, 108, 192) });
    await expect(form.getByTestId('slot-warning-wallpaper')).toContainText('108 x 192');
    await expect(form.getByTestId('slot-warning-wallpaper')).toContainText('different shape from the suggested 1920 x 1080');
    await expect(form.getByTestId('kit-slot-wallpaper')).toHaveAttribute('data-has-file', 'true'); // not blocked
    await form.getByLabel('Wallpaper file').setInputFiles({ name: 'wide.png', mimeType: 'image/png', buffer: solidPng(10, 10, 80, 192, 108) }); // replace in place
    await expect(form.getByTestId('kit-slot-wallpaper')).toContainText('wide');
    await expect(form.getByTestId('slot-warning-wallpaper')).toHaveCount(0);

    // A lower third that is 16:9 instead of a wide banner is flagged too.
    await form.getByLabel('Lower third ad file').setInputFiles({ name: 'blocky.png', mimeType: 'image/png', buffer: solidPng(255, 0, 0, 160, 90) });
    await expect(form.getByTestId('slot-warning-lower_third')).toBeVisible();
    await form.getByRole('button', { name: 'Remove Lower third ad' }).click();
    await expect(form.getByTestId('kit-slot-lower_third')).toHaveAttribute('data-has-file', 'false');
    await expect(form.getByTestId('slot-warning-lower_third')).toHaveCount(0);
    await form.getByLabel('Lower third ad file').setInputFiles({ name: 'banner.png', mimeType: 'image/png', buffer: solidPng(255, 0, 0, 128, 24) });
    await expect(form.getByTestId('kit-slot-lower_third')).toContainText('banner');
    await expect(form.getByTestId('slot-warning-lower_third')).toHaveCount(0);

    // The 9:16 tab is a separate set: empty, with its own suggested sizes; the logo says it falls back to 16:9.
    await form.getByRole('tab', { name: '9:16 vertical' }).click();
    await expect(form.getByRole('tab', { name: '9:16 vertical' })).toHaveAttribute('aria-selected', 'true');
    await expect(form.getByTestId('kit-preview')).toHaveAttribute('data-orientation', 'portrait');
    await expect(form.getByTestId('kit-slot-logo')).toHaveAttribute('data-has-file', 'false');
    await expect(form.getByTestId('kit-slot-wallpaper')).toHaveAttribute('data-has-file', 'false');
    await expect(form.getByTestId('kit-slot-lower_third')).toHaveAttribute('data-has-file', 'false');
    await expect(form.getByText('No 9:16 logo: vertical streams use the 16:9 logo.')).toBeVisible();
    await expect(form.getByTestId('kit-orientation-note')).toContainText('Wallpaper and ads are not borrowed');
    await expect(form.getByTestId('slot-size-wallpaper')).toHaveText('Suggested 1080 x 1920');
    await expect(form.getByTestId('slot-size-lower_third')).toHaveText('Suggested 1080 x 360');
    await expect(form.getByTestId('slot-size-side_third')).toHaveText('Suggested 360 x 1920');
    await expect(form.getByTestId('slot-size-full_screen')).toHaveText('Suggested 1080 x 1920');
    // "Choose from uploaded" reuses a file that is already in the library (here the 16:9 logo).
    await form.getByLabel('Logo: choose from uploaded').selectOption({ index: 1 });
    await expect(form.getByTestId('kit-slot-logo')).toContainText('logo16');
    await form.getByLabel('Logo file').setInputFiles({ name: 'logo9.png', mimeType: 'image/png', buffer: solidPng(...MAGENTA, 120, 120) });
    await expect(form.getByTestId('kit-slot-logo')).toContainText('logo9');
    await form.getByLabel('Wallpaper file').setInputFiles({ name: 'wall9.png', mimeType: 'image/png', buffer: solidPng(10, 80, 10, 108, 192) });
    await expect(form.getByTestId('slot-warning-wallpaper')).toHaveCount(0); // right shape for 9:16
    await form.getByLabel('Full screen ad file').setInputFiles({ name: 'full9.png', mimeType: 'image/png', buffer: solidPng(0, 0, 255, 108, 192) });
    await expect(form.getByTestId('slot-warning-full_screen')).toHaveCount(0);

    // Back on 16:9 nothing was lost or mixed up.
    await form.getByRole('tab', { name: '16:9 landscape' }).click();
    await expect(form.getByTestId('kit-slot-logo')).toContainText('logo16');
    await expect(form.getByTestId('kit-slot-wallpaper')).toContainText('wide');
    await expect(form.getByTestId('kit-slot-lower_third')).toContainText('banner');
    await expect(form.getByTestId('kit-slot-full_screen')).toHaveAttribute('data-has-file', 'false');

    await form.getByRole('button', { name: 'Create kit' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Created "Both shapes"' })).toBeVisible();

    // The API keeps the two sets apart (landscape = the original field names).
    const [kit] = await (await api.get(`${APP}/api/brand-kits`)).json();
    expect(kit.logoAssetId).toEqual(expect.any(String));
    expect(kit.logoAssetIdPortrait).toEqual(expect.any(String));
    expect(kit.logoAssetId).not.toBe(kit.logoAssetIdPortrait);
    expect(kit.wallpaperAssetId).not.toBeNull();
    expect(kit.wallpaperAssetIdPortrait).not.toBeNull();
    expect(kit.ads.map((a: { placement: string }) => a.placement)).toEqual(['lower_third']);
    expect(kit.adsPortrait.map((a: { placement: string }) => a.placement)).toEqual(['full_screen']);
    expect(kit.adsShrinkPicture).toBe(true);

    // Reload: the editor shows the saved sets; removing the 9:16 logo is a change that can be saved.
    await page.reload();
    await page.getByRole('button', { name: 'Edit Both shapes' }).click();
    const edit = page.getByRole('form', { name: 'Brand kit Both shapes' });
    await expect(edit.getByRole('button', { name: 'Save kit' })).toBeDisabled();
    await edit.getByRole('tab', { name: '9:16 vertical' }).click();
    await expect(edit.getByTestId('kit-slot-logo')).toContainText('logo9');
    await expect(edit.getByTestId('kit-slot-full_screen')).toContainText('full9');
    await edit.getByRole('button', { name: 'Remove Logo' }).click();
    await expect(edit.getByRole('button', { name: 'Save kit' })).toBeEnabled();
    await edit.getByRole('button', { name: 'Save kit' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved "Both shapes"' })).toBeVisible();
    const [after] = await (await api.get(`${APP}/api/brand-kits`)).json();
    expect(after.logoAssetIdPortrait).toBeNull();
    expect(after.logoAssetId).toBe(kit.logoAssetId);

    // The uploaded files are an internal detail under Storage; a file a kit uses cannot be deleted.
    await page.locator('summary', { hasText: 'Uploaded files' }).click();
    await expect(page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Delete logo16' }) })).toContainText('used by Both shapes');
  });

  test('the shrink switch is part of the kit and is saved', async ({ page, context }) => {
    const { api } = await signIn(context);
    await page.goto('/brand');
    await page.getByRole('button', { name: 'New brand kit' }).click();
    const form = page.getByRole('form', { name: 'New brand kit' });
    await form.getByLabel('Kit name').fill('Cover');
    const toggle = form.getByLabel('Shrink picture while ads show');
    await expect(toggle).toBeChecked(); // default on
    await toggle.uncheck();
    await form.getByRole('button', { name: 'Create kit' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Created "Cover"' })).toBeVisible();
    expect((await (await api.get(`${APP}/api/brand-kits`)).json())[0].adsShrinkPicture).toBe(false);
  });
});

test.describe('the studio uses the kit set that matches the stream', () => {
  test.beforeEach(async ({ browser }) => patchFreePlan(browser, { watermark: false, assetStorageMb: 5 }));
  test.afterEach(async ({ browser }) => patchFreePlan(browser, { watermark: true, assetStorageMb: 0 }));

  async function asset(api: import('@playwright/test').APIRequestContext, kind: string, name: string, buffer: Buffer): Promise<string> {
    const r = await api.post(`${APP}/api/assets`, { multipart: { kind, name, file: { name: `${name}.png`, mimeType: 'image/png', buffer } }, headers: { Origin: APP } });
    expect(r.ok()).toBeTruthy();
    return (await r.json()).id as string;
  }
  const open = async (page: Page, id: string) => {
    await page.goto(`/streams/${id}/studio`);
    await page.locator('canvas.studio-canvas').waitFor();
  };

  test('landscape stream: landscape logo and ads; vertical stream: its own set, the logo falls back, wallpaper and ads do not', async ({ page, context }) => {
    const { api } = await signIn(context);
    const logo16 = await asset(api, 'logo', 'logo16', solidPng(...YELLOW, 64, 64));
    const logo9 = await asset(api, 'logo', 'logo9', solidPng(...MAGENTA, 64, 64));
    const wall16 = await asset(api, 'wallpaper', 'wall16', solidPng(30, 30, 90, 192, 108));
    const ad16 = await asset(api, 'ad', 'ad16', solidPng(255, 0, 0, 128, 24));
    const ad9 = await asset(api, 'ad', 'ad9', solidPng(0, 0, 255, 108, 36));
    // The default kit: a full 16:9 set, a 9:16 set with its own logo and ad but NO wallpaper.
    const made = await api.post(`${APP}/api/brand-kits`, {
      data: { name: 'Sets', logoAssetId: logo16, logoAssetIdPortrait: logo9, wallpaperAssetId: wall16, ads: [{ placement: 'lower_third', assetId: ad16 }], adsPortrait: [{ placement: 'lower_third', assetId: ad9 }], adsShrinkPicture: false }, // shrinking is covered in ads-shrink.spec.ts
      headers: apiHeaders,
    });
    expect(made.ok()).toBeTruthy();

    // Landscape: the 16:9 logo is drawn in the corner, the wallpaper and the red ad are loaded.
    const wide = await newStream(api, 'landscape');
    await open(page, wide);
    await expect.poll(async () => isYellow(await canvasPixel(page, 30, 30))).toBe(true);
    await studioTab(page, 'Look');
    await expect(page.getByTestId('wallpaper-fit')).toContainText('Sets wallpaper');
    await studioTab(page, 'Ads');
    await expect(page.getByTestId('ad-card-lower_third').locator('.ad-file-name')).toContainText('Sets lower_third');
    await expect(page.getByTestId('ad-card-lower_third').getByRole('button', { name: 'From brand kit' })).toHaveAttribute('aria-pressed', 'true');
    // The Ads tab suggests the 16:9 size.
    await expect(page.getByTestId('ad-size-lower_third')).toContainText('1280 x 240');
    await pinAdClock(page, 0);
    const wideSize = await canvasSize(page);
    await expect.poll(async () => isRed(await canvasPixel(page, wideSize.width * 0.75, wideSize.height - 40))).toBe(true);

    // Vertical: its own logo (magenta) and its own blue ad; the 16:9 wallpaper is NOT used.
    const tall = await newStream(api, 'portrait');
    await open(page, tall);
    await expect.poll(async () => isMagenta(await canvasPixel(page, 30, 30))).toBe(true);
    await studioTab(page, 'Look');
    await expect(page.getByTestId('wallpaper-fit')).toHaveCount(0);
    await studioTab(page, 'Ads');
    await expect(page.getByTestId('ad-size-lower_third')).toContainText('1080 x 360');
    await pinAdClock(page, 0);
    const tallSize = await canvasSize(page);
    expect(tallSize.height).toBeGreaterThan(tallSize.width);
    await expect.poll(async () => {
      const p = await canvasPixel(page, tallSize.width / 2, tallSize.height - 20);
      return p[2] > 200 && p[0] < 60 && p[1] < 60;
    }).toBe(true);
    expect(isRed(await canvasPixel(page, tallSize.width / 2, tallSize.height - 20))).toBe(false); // the 16:9 red ad did not come along
  });

  test('a kit with only the 16:9 set: a vertical stream gets the logo but no wallpaper and no ads', async ({ page, context }) => {
    const { api } = await signIn(context);
    const logo16 = await asset(api, 'logo', 'only16', solidPng(...YELLOW, 64, 64));
    const wall16 = await asset(api, 'wallpaper', 'wall16', solidPng(30, 30, 90, 192, 108));
    const ad16 = await asset(api, 'ad', 'ad16', solidPng(255, 0, 0, 128, 24));
    const made = await api.post(`${APP}/api/brand-kits`, { data: { name: 'Old kit', logoAssetId: logo16, wallpaperAssetId: wall16, ads: [{ placement: 'lower_third', assetId: ad16 }], adsShrinkPicture: false }, headers: apiHeaders });
    expect(made.ok()).toBeTruthy();

    const tall = await newStream(api, 'portrait');
    await open(page, tall);
    await expect.poll(async () => isYellow(await canvasPixel(page, 30, 30))).toBe(true); // logo fallback
    await studioTab(page, 'Look');
    await expect(page.getByTestId('wallpaper-fit')).toHaveCount(0);
    await studioTab(page, 'Ads');
    await expect(page.getByTestId('ad-card-lower_third').locator('.ad-file-name')).toHaveText('No picture chosen');
    await expect(page.getByTestId('ad-card-lower_third').getByRole('button', { name: 'From brand kit' })).toBeDisabled();
  });
});
