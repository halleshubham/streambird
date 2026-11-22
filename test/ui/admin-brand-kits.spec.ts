import { expect, test, type Browser } from '@playwright/test';
import { APP, apiHeaders, framePng, newStream, patchFreePlan, signIn } from './helpers';

// Superadmin read-only brand kit view: the account page section, and the "Stream id or URL" lookup.

const noHScroll = (page: import('@playwright/test').Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** A customer with one kit (an interval L-frame with a real window, shrink OFF) and a stream that uses it as the account default. */
async function customerWithKit(browser: Browser) {
  const ctx = await browser.newContext();
  const { email, api } = await signIn(ctx);
  const frame = await (
    await api.post(`${APP}/api/assets`, {
      multipart: { kind: 'ad', name: 'News frame', file: { name: 'frame.png', mimeType: 'image/png', buffer: framePng({ width: 1280, height: 720, win: [256, 0, 1280, 576], frame: [10, 30, 120] }) } },
      headers: { Origin: APP },
    })
  ).json();
  const kit = await (
    await api.post(`${APP}/api/brand-kits`, {
      data: { name: 'News look', isDefault: true, adsShrinkPicture: false, ads: [{ placement: 'l_shape', assetId: frame.id, mode: 'interval', showSec: 20, everySec: 180 }] },
      headers: apiHeaders,
    })
  ).json();
  expect(kit.id).toBeTruthy();
  const streamId = await newStream(api);
  await ctx.close();
  return { email, streamId };
}

test.describe('admin: brand kits (read-only)', () => {
  test.beforeEach(async ({ browser }) => patchFreePlan(browser, { watermark: false, assetStorageMb: 5 }));
  test.afterEach(async ({ browser }) => patchFreePlan(browser, { watermark: true, assetStorageMb: 0 }));

  test('the account page shows the kit, its L-frame and the diagnostics, on desktop and on a phone', async ({ page, context, browser }) => {
    const { email } = await customerWithKit(browser);
    const admin = await signIn(context, { superadmin: true });
    const found = await (await admin.api.get(`${APP}/api/superadmin/accounts?q=${encodeURIComponent(email)}`)).json();
    const accountId = found.items[0].id as string;

    await page.setViewportSize({ width: 1366, height: 800 });
    await page.goto(`/admin/accounts/${accountId}`);
    const section = page.getByTestId('admin-brand-kits');
    await expect(section.getByRole('button', { name: 'Show brand kits' })).toBeVisible();
    // Nothing is fetched (or audited) until it is opened.
    await section.getByRole('button', { name: 'Show brand kits' }).click();
    const card = page.getByTestId('admin-kit-card');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('News look');
    const diag = card.getByTestId('kit-diagnostics');
    await expect(diag).toContainText('L-shaped frame (landscape (16:9)): file 1280x720 PNG; window check: found 80% x 80%');
    await expect(diag).toContainText('hidden for the first 180 s of each cycle');
    await expect(diag).toContainText('Shrink picture while ads show is OFF: this only affects Lower third and Left third ads');
    await expect(diag).not.toContainText('will not run');
    await expect(diag).toContainText('Portrait (9:16) set has no L-shaped frame');
    await expect(diag.locator('li.is-warning').first()).toBeVisible();
    await expect(card.getByTestId('kit-set-landscape').getByRole('row', { name: /L-shaped frame/ })).toContainText('News frame');
    await expect(page.getByTestId('brand-plan')).toContainText('No Powered-by mark');
    expect(await noHScroll(page)).toBe(true);

    await page.setViewportSize({ width: 390, height: 800 });
    await expect(card).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
  });

  test('pasting a stream URL (or a bare id) on the dashboard opens that stream with its resolved kit', async ({ page, context, browser }) => {
    const { streamId } = await customerWithKit(browser);
    await signIn(context, { superadmin: true });
    await page.setViewportSize({ width: 1366, height: 800 });
    await page.goto('/admin');
    const box = page.getByRole('searchbox', { name: 'Stream id or URL' });

    await box.fill('not a stream');
    await page.getByRole('button', { name: 'Look up stream' }).click();
    await expect(page.getByRole('alert')).toContainText('not a stream id');

    await box.fill(`https://streambird.app/streams/${streamId}`);
    await page.getByRole('button', { name: 'Look up stream' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/streams/${streamId}$`));
    const view = page.getByTestId('stream-brand-kit');
    await expect(view).toContainText('UI ads stream');
    await expect(view).toContainText('Landscape 16:9');
    await expect(view.getByRole('row', { name: /UI Twitch/ })).toContainText('News look (account default)');
    await expect(page.getByTestId('admin-kit-card')).toContainText('News look');
    await expect(page.getByTestId('stream-diagnostics')).toContainText('this is a landscape (16:9) stream');

    // A bare id from that page's own box works too, and a phone fits.
    await page.setViewportSize({ width: 390, height: 800 });
    await page.getByRole('searchbox', { name: 'Stream id or URL' }).fill(streamId);
    await page.getByRole('button', { name: 'Look up stream' }).click();
    await expect(page.getByTestId('stream-brand-kit')).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
  });

  test('an unknown stream shows the error instead of a blank page', async ({ page, context }) => {
    await signIn(context, { superadmin: true });
    await page.goto('/admin/streams/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('Stream not found')).toBeVisible();
  });
});
