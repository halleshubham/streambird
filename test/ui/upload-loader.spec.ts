import { expect, test } from '@playwright/test';
import { newStream, patchFreePlan, signIn, solidPng, studioTab } from './helpers';

// Every file upload shows the StreamBird loader (UploadLoader: flapping logo, "Uploading <name>…", progress bar) on the card
// being uploaded, with its controls disabled, and it is gone again on success AND on failure. The server answer is delayed
// with page.route so the in-flight state is observable.

const DELAY_MS = 1500;

test.describe('upload loader (paid plan)', () => {
  test.beforeEach(async ({ browser }) => patchFreePlan(browser, { watermark: false, assetStorageMb: 5 }));
  test.afterEach(async ({ browser }) => patchFreePlan(browser, { watermark: true, assetStorageMb: 0 }));

  test('brand kit editor: logo and ad uploads show the loader, disable the slot, then clear', async ({ page, context }) => {
    await signIn(context);
    let uploads = 0;
    await page.route('**/api/assets', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      uploads += 1;
      await new Promise((r) => setTimeout(r, DELAY_MS));
      await route.continue();
    });
    await page.goto('/brand');
    await page.getByRole('button', { name: 'New brand kit' }).click();
    const form = page.getByRole('form', { name: 'New brand kit' });
    await form.getByLabel('Kit name').fill('Loader kit');

    // Logo
    const logo = form.getByTestId('kit-slot-logo');
    await form.getByLabel('Logo file').setInputFiles({ name: 'my-logo.png', mimeType: 'image/png', buffer: solidPng(124, 58, 237, 200, 200) });
    const loader = logo.getByTestId('upload-loader');
    await expect(loader).toBeVisible();
    await expect(loader).toHaveAttribute('role', 'status');
    await expect(loader).toHaveAttribute('aria-live', 'polite');
    await expect(loader).toContainText('Uploading my-logo.png');
    await expect(logo.getByRole('button', { name: 'Upload image' })).toBeDisabled();
    await expect(logo.getByRole('button', { name: 'Upload image' })).toHaveText('Uploading…');
    await expect(form.getByLabel('Logo file')).toBeDisabled();
    await expect(loader).toHaveCount(0);
    await expect(logo).toHaveAttribute('data-has-file', 'true');
    await expect(logo.getByRole('button', { name: 'Replace Logo' })).toBeEnabled();

    // Ad (Lower third)
    const ad = form.getByRole('group', { name: 'Lower third ad' });
    await ad.getByLabel('Lower third ad file').setInputFiles({ name: 'sponsor.png', mimeType: 'image/png', buffer: solidPng(255, 0, 0, 128, 24) });
    await expect(ad.getByTestId('upload-loader')).toContainText('Uploading sponsor.png');
    await expect(ad.getByTestId('upload-loader')).toHaveCount(0);
    await expect(ad.getByTestId('kit-slot-lower_third')).toHaveAttribute('data-has-file', 'true');
    expect(uploads).toBe(2);
  });

  test('brand kit editor: a refused upload clears the loader and keeps the error text', async ({ page, context }) => {
    await signIn(context);
    await page.route('**/api/assets', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await new Promise((r) => setTimeout(r, DELAY_MS));
      await route.fulfill({ status: 413, contentType: 'application/json', body: JSON.stringify({ message: 'That file is too large for your storage.' }) });
    });
    await page.goto('/brand');
    await page.getByRole('button', { name: 'New brand kit' }).click();
    const form = page.getByRole('form', { name: 'New brand kit' });
    await form.getByLabel('Kit name').fill('Failing kit');
    const logo = form.getByTestId('kit-slot-logo');
    await form.getByLabel('Logo file').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: solidPng(1, 2, 3, 64, 64) });
    await expect(logo.getByTestId('upload-loader')).toContainText('Uploading big.png');
    await expect(logo.getByTestId('upload-loader')).toHaveCount(0);
    await expect(page.getByText('That file is too large for your storage.')).toBeVisible();
    await expect(logo).toHaveAttribute('data-has-file', 'false');
    await expect(logo.getByRole('button', { name: 'Upload image' })).toBeEnabled();
    await expect(logo.getByRole('button', { name: 'Upload image' })).toHaveText('Upload image');
  });

  test('a dropped connection also ends the loader', async ({ page, context }) => {
    await signIn(context);
    await page.route('**/api/assets', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await new Promise((r) => setTimeout(r, 800));
      await route.abort('connectionreset');
    });
    await page.goto('/brand');
    await page.getByRole('button', { name: 'New brand kit' }).click();
    const form = page.getByRole('form', { name: 'New brand kit' });
    await form.getByLabel('Kit name').fill('Offline kit');
    const logo = form.getByTestId('kit-slot-logo');
    await form.getByLabel('Logo file').setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: solidPng(1, 2, 3, 64, 64) });
    await expect(logo.getByTestId('upload-loader')).toBeVisible();
    await expect(logo.getByTestId('upload-loader')).toHaveCount(0);
    await expect(page.getByText('The upload did not finish')).toBeVisible();
    await expect(logo.getByRole('button', { name: 'Upload image' })).toBeEnabled();
  });

  test('studio Ads tab: From this computer shows the loader while the picture is read, then clears', async ({ page, context }) => {
    const { api } = await signIn(context);
    const id = await newStream(api);
    // The picture is read into the stream's canvas locally; hold the image decode back so the in-flight state can be seen.
    await page.addInitScript(() => {
      const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true,
        get() {
          return desc.get!.call(this);
        },
        set(v: string) {
          const delay = (window as unknown as { __SB_IMG_DELAY__?: number }).__SB_IMG_DELAY__ ?? 0;
          if (delay && typeof v === 'string' && v.startsWith('blob:')) setTimeout(() => desc.set!.call(this, v), delay);
          else desc.set!.call(this, v);
        },
      });
    });
    await page.goto(`/streams/${id}/studio`);
    await page.locator('canvas.studio-canvas').waitFor();
    await studioTab(page, 'Ads');
    const card = page.getByTestId('ad-card-lower_third');
    await page.evaluate((d) => ((window as unknown as { __SB_IMG_DELAY__?: number }).__SB_IMG_DELAY__ = d), DELAY_MS);
    await page.locator('#adFile-lower_third').setInputFiles({ name: 'banner.png', mimeType: 'image/png', buffer: solidPng(255, 0, 0, 128, 24) });
    const loader = card.getByTestId('upload-loader');
    await expect(loader).toBeVisible();
    await expect(loader).toContainText('Uploading banner.png');
    const from = card.getByRole('button', { name: 'From this computer' }); // the full name stays while the text says Uploading…
    await expect(from).toBeDisabled();
    await expect(from).toHaveText('Uploading…');
    await expect(loader).toHaveCount(0);
    await expect(from).toBeEnabled();
    await expect(from).toHaveText('From this computer');
    await expect(card.locator('.ad-file-name')).toHaveText('banner.png');
  });
});
