import { expect, Page, test } from '@playwright/test';
import { APP, acceptConfirm, apiHeaders, cancelConfirm, patchFreePlan, signIn } from './helpers';

// Presets on the dashboard ("Ready when you are"), the setup form's "More options", and the studio's bottom bar.

async function addTwitch(api: Awaited<ReturnType<typeof signIn>>['api'], label = 'Preset Twitch'): Promise<string> {
  const res = await api.post(`${APP}/api/platform-connections/twitch/manual`, {
    data: { label, ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' },
    headers: apiHeaders,
  });
  return (await res.json()).id as string;
}

const fillNewPreset = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'New preset' }).click();
  await page.getByLabel('Preset name').fill(name);
};

test.describe('dashboard presets', () => {
  test('no presets yet: one "Go live" card built from defaults; Go live now creates the stream and opens the studio with the camera on', async ({ page, context }) => {
    const { api } = await signIn(context);
    await addTwitch(api);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Ready when you are' })).toBeVisible();
    const card = page.getByRole('article', { name: 'Go live' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Twitch');
    await expect(card).toContainText('Default look · 720p · ticker off');
    await expect(card.getByRole('button', { name: 'Save as preset' })).toBeVisible();
    // The old entry to the full setup form is still there.
    await expect(page.locator('a.go-live-cta')).toBeVisible();

    const created = page.waitForRequest((r) => r.url().endsWith('/api/streams') && r.method() === 'POST');
    await card.getByRole('button', { name: 'Go live now' }).click();
    expect((await created).postDataJSON()).toMatchObject({ orientation: 'landscape' });
    await expect(page).toHaveURL(/\/streams\/[^/]+\/studio$/);
    // Camera is on already; publishing still needs the host's tap on Go live.
    await expect(page.getByRole('button', { name: 'Camera on' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('preview-banner')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Go live', exact: true })).toBeEnabled();
    // ...and an account with no preset is offered to keep these settings.
    await expect(page.getByTestId('save-preset-offer')).toBeVisible();
  });

  test('"Save as preset" on the default card creates a preset card', async ({ page, context }) => {
    const { api } = await signIn(context);
    await addTwitch(api);
    await page.goto('/dashboard');
    await page.getByRole('article', { name: 'Go live' }).getByRole('button', { name: 'Save as preset' }).click();
    await page.getByLabel('Preset name').fill('Everyday');
    await page.getByRole('button', { name: 'Save preset' }).click();
    const card = page.getByRole('article', { name: 'Everyday' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Twitch');
    await expect(page.getByRole('article', { name: 'Go live', exact: true })).toHaveCount(0);
    expect((await (await api.get(`${APP}/api/presets`)).json())).toHaveLength(1);
  });

  test('create a preset in the inline form; Go live now starts the stream from it with its shape, quality and ticker', async ({ page, context }) => {
    const { api } = await signIn(context);
    await addTwitch(api, 'Show Twitch');
    await page.goto('/dashboard');
    await fillNewPreset(page, 'Tall show');
    await page.getByLabel('Shape').selectOption('portrait');
    await page.getByLabel('Quality').selectOption('sd');
    await page.getByLabel('Show a news ticker').check();
    await page.getByLabel('Ticker text').fill('Breaking: it works');
    await page.getByRole('button', { name: 'Save preset' }).click();

    const card = page.getByRole('article', { name: 'Tall show' });
    await expect(card).toContainText('Twitch · Default look · 360p · ticker on · vertical');
    // The server holds exactly what the form had.
    const saved = (await (await api.get(`${APP}/api/presets`)).json())[0];
    expect(saved.config).toMatchObject({ orientation: 'portrait', quality: 'sd', tickerEnabled: true, tickerText: 'Breaking: it works' });

    const start = page.waitForResponse((r) => /\/api\/presets\/[^/]+\/start$/.test(r.url()) && r.request().method() === 'POST');
    await card.getByRole('button', { name: 'Go live now with Tall show' }).click();
    const body = await (await start).json();
    expect(body).toMatchObject({ title: 'Tall show', orientation: 'portrait', status: 'live' });
    await expect(page).toHaveURL(new RegExp(`/streams/${body.id}/studio$`));
    await expect(page.locator('canvas.studio-canvas')).toHaveClass(/studio-canvas--portrait/);
    await expect(page.locator('.studio-resolution-select option:checked')).toContainText('SD');
    const persisted = await page.evaluate((id) => JSON.parse(localStorage.getItem(`streambird:studio:${id}:v1`) ?? '{}'), body.id);
    expect(persisted.resolution).toBe('sd');
    expect(persisted.branding.newsText).toBe('Breaking: it works');
    await expect(page.getByRole('button', { name: 'Camera on' })).toBeVisible({ timeout: 15_000 });
    // Not the first-ever preset: no "save as preset" offer.
    await expect(page.getByTestId('save-preset-offer')).toHaveCount(0);
  });

  test('edit and rename, delete, and the last used preset comes first', async ({ page, context }) => {
    const { api } = await signIn(context);
    await addTwitch(api);
    await page.goto('/dashboard');
    await fillNewPreset(page, 'First');
    await page.getByRole('button', { name: 'Save preset' }).click();
    await fillNewPreset(page, 'Second');
    await page.getByRole('button', { name: 'Save preset' }).click();
    await expect(page.getByRole('article', { name: 'Second' })).toBeVisible();
    const names = () => page.locator('.preset-card .preset-name').allTextContents();
    expect(await names()).toEqual(['First', 'Second']); // never used: oldest first

    // Rename through Edit.
    await page.getByRole('button', { name: 'Edit preset Second' }).click();
    await page.getByLabel('Preset name').fill('Second show');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('article', { name: 'Second show' })).toBeVisible();

    // Using it moves it to the front on the next visit.
    const id = (await (await api.get(`${APP}/api/presets`)).json()).find((p: { name: string }) => p.name === 'Second show').id;
    expect((await api.post(`${APP}/api/presets/${id}/use`, { headers: apiHeaders })).ok()).toBeTruthy();
    await page.reload();
    await expect(page.getByRole('article', { name: 'Second show' })).toBeVisible();
    expect(await names()).toEqual(['Second show', 'First']);

    // Delete asks first.
    await page.getByRole('button', { name: 'Delete preset First' }).click();
    await expect(page.getByRole('alertdialog', { name: 'Delete the preset "First"?' })).toBeVisible();
    await cancelConfirm(page);
    await expect(page.getByRole('article', { name: 'First' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete preset First' }).click();
    await acceptConfirm(page);
    await expect(page.getByRole('article', { name: 'First' })).toHaveCount(0);
    expect(await names()).toEqual(['Second show']);
  });

  test('a form needs a name and a destination; the 20th-preset limit message comes from the server', async ({ page, context }) => {
    const { api } = await signIn(context);
    await addTwitch(api);
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'New preset' }).click();
    await page.getByRole('button', { name: 'Save preset' }).click();
    await expect(page.getByText('Give the preset a name.')).toBeVisible();
    await page.getByLabel('Preset name').fill('x');
    await page.getByLabel(/Preset Twitch/).uncheck();
    await page.getByRole('button', { name: 'Save preset' }).click();
    await expect(page.getByText('Pick at least one destination.')).toBeVisible();
  });

  test('phone: the dashboard cards fit 390px with no sideways scroll, form open or not', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const { api } = await signIn(context);
    await addTwitch(api, 'A rather long destination name that could push the card wider');
    await api.post(`${APP}/api/presets`, { data: { name: 'A preset with a quite long name to test wrapping on phones', config: { orientation: 'portrait', quality: 'hd', tickerEnabled: true, tickerText: 'x' } }, headers: apiHeaders });
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Ready when you are' })).toBeVisible();
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await fits()).toBe(true);
    for (const card of await page.locator('.preset-card').all()) {
      const box = await card.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }
    await page.getByRole('button', { name: 'New preset' }).click();
    expect(await fits()).toBe(true);
  });
});

test.describe('setup form', () => {
  test('title and destinations first; the rest sits in "More options" with a one-line summary that follows the choices', async ({ page, context }) => {
    const { api } = await signIn(context);
    await addTwitch(api, 'Form Twitch');
    await page.goto('/streams/new');
    await expect(page.locator('#title')).toBeVisible();
    await expect(page.getByLabel(/Form Twitch/)).toBeVisible();
    const toggle = page.getByRole('button', { name: /More options/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    for (const sel of ['#orientation', '#visibility', '#description', '#quality']) await expect(page.locator(sel)).toBeHidden();
    const summary = page.getByTestId('more-options-summary');
    await expect(summary).toHaveText('Default look · 720p · ticker off');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#orientation')).toBeVisible();
    await page.locator('#quality').selectOption('sd');
    await page.getByLabel('Show a news ticker').check();
    await page.getByLabel('Ticker text').fill('News');
    await page.locator('#orientation').selectOption('portrait');
    await expect(summary).toHaveText('Default look · 360p · ticker on · vertical');
  });

  test('a brand kit shows by name in the summary and is what the studio applies', async ({ page, context, browser }) => {
    await patchFreePlan(browser, { assetStorageMb: 5 });
    try {
      const { api } = await signIn(context);
      await addTwitch(api, 'Kit Twitch');
      const kit = await (await api.post(`${APP}/api/brand-kits`, { data: { name: 'Acme' }, headers: apiHeaders })).json();
      await page.goto('/streams/new');
      await page.getByRole('button', { name: /More options/ }).click();
      await expect(page.getByTestId('more-options-summary')).toHaveText('Acme brand · 720p · ticker off'); // the account's default kit
      await page.locator('#brandKit').selectOption('none');
      await expect(page.getByTestId('more-options-summary')).toHaveText('No brand kit · 720p · ticker off');
      await page.locator('#brandKit').selectOption(kit.id);
      await expect(page.getByTestId('more-options-summary')).toHaveText('Acme brand · 720p · ticker off');
      await page.getByLabel(/Kit Twitch/).check();
      await page.getByRole('button', { name: /Go live now/ }).click();
      await expect(page).toHaveURL(/\/studio$/);
      const id = page.url().split('/streams/')[1].split('/')[0];
      const persisted = await page.evaluate((sid) => JSON.parse(localStorage.getItem(`streambird:studio:${sid}:v1`) ?? '{}'), id);
      expect(persisted.brandKitId).toBe(kit.id);
      await expect(page.getByTestId('save-preset-offer')).toBeVisible();
    } finally {
      await patchFreePlan(browser, { assetStorageMb: 0 });
    }
  });

  test('"Save these settings as a preset" keeps the form (not the title) as a preset', async ({ page, context }) => {
    const { api } = await signIn(context);
    await addTwitch(api, 'Save Twitch');
    await page.goto('/streams/new');
    await page.getByRole('button', { name: /More options/ }).click();
    await page.locator('#quality').selectOption('sd');
    await page.getByRole('button', { name: 'Save these settings as a preset' }).click();
    await page.getByLabel('Preset name').fill('From the form');
    await page.getByRole('button', { name: 'Save preset' }).click(); // no destination picked yet
    await expect(page.getByText('Pick at least one destination first.')).toBeVisible();
    await page.getByLabel(/Save Twitch/).check();
    await page.getByRole('button', { name: 'Save preset' }).click();
    await expect(page.getByText(/Saved "From the form"/)).toBeVisible();
    const saved = (await (await api.get(`${APP}/api/presets`)).json())[0];
    expect(saved).toMatchObject({ name: 'From the form', config: { quality: 'sd', orientation: 'landscape', tickerEnabled: false } });
    expect(saved.config.destinationIds).toHaveLength(1);
  });

  test('after a stream is created from the form, the studio offers to save it as a preset (first preset only)', async ({ page, context }) => {
    const { api } = await signIn(context);
    await addTwitch(api, 'Offer Twitch');
    await page.goto('/streams/new');
    await page.getByLabel(/Offer Twitch/).check();
    await page.getByRole('button', { name: /Go live now/ }).click();
    const offer = page.getByTestId('save-preset-offer');
    await expect(offer).toBeVisible();
    await offer.getByRole('button', { name: 'Save preset' }).click();
    await expect(offer).toContainText('Give the preset a name.');
    await offer.getByLabel('Preset name').fill('Offered');
    await offer.getByRole('button', { name: 'Save preset' }).click();
    await expect(offer).toContainText('Saved "Offered"');
    expect(await (await api.get(`${APP}/api/presets`)).json()).toHaveLength(1);
  });
});

test.describe('studio bottom bar and Customize', () => {
  async function openStudio(page: Page, api: Awaited<ReturnType<typeof signIn>>['api']) {
    const conn = await addTwitch(api, 'Dock Twitch');
    const stream = await (await api.post(`${APP}/api/streams`, { data: { title: 'Dock', destinationConnectionIds: [conn] }, headers: apiHeaders })).json();
    await page.goto(`/streams/${stream.id}/studio`);
    await expect(page.getByRole('toolbar', { name: 'Live controls' })).toBeVisible();
  }

  test('desktop: Mic, Camera, Share, Go live and End float at the bottom; the side panels stay beside the picture', async ({ page, context }) => {
    await page.setViewportSize({ width: 1366, height: 800 });
    const { api } = await signIn(context);
    await openStudio(page, api);
    const dock = page.getByRole('toolbar', { name: 'Live controls' });
    const box = (await dock.boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(800 - 40);
    expect(box.y + box.height).toBeLessThanOrEqual(800);
    for (const name of ['Microphone on', 'Start my camera', 'Share screen', 'Go live', 'End stream']) {
      await expect(dock.getByRole('button', { name, exact: name === 'Go live' })).toBeVisible();
    }
    // Customize is a phone-only entry; the tabs are already on screen.
    await expect(dock.getByRole('button', { name: 'Customize' })).toBeHidden();
    await expect(page.getByRole('tab', { name: /^People/ })).toBeVisible();
    // The microphone needs the camera first (that is what turns it on), then toggles.
    await expect(dock.getByRole('button', { name: 'Microphone on' })).toBeDisabled();
    await dock.getByRole('button', { name: 'Start my camera' }).click();
    await expect(dock.getByRole('button', { name: 'Camera on' })).toBeVisible({ timeout: 15_000 });
    await dock.getByRole('button', { name: 'Microphone on' }).click();
    await expect(dock.getByRole('button', { name: 'Microphone off' })).toHaveAttribute('aria-pressed', 'false');
    await dock.getByRole('button', { name: 'Microphone off' }).click();
    await expect(dock.getByRole('button', { name: 'Microphone on' })).toBeVisible();
  });

  test('phone: one Customize button opens the panels as a sheet; the bar and page fit 390px', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const { api } = await signIn(context);
    await openStudio(page, api);
    const dock = page.getByRole('toolbar', { name: 'Live controls' });
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await fits()).toBe(true);
    const dockBox = (await dock.boundingBox())!;
    expect(dockBox.x).toBeGreaterThanOrEqual(0);
    expect(dockBox.x + dockBox.width).toBeLessThanOrEqual(390);
    await expect(page.getByRole('tab', { name: /^People/ })).toBeHidden(); // folded away
    const customize = dock.getByRole('button', { name: 'Customize' });
    await expect(customize).toHaveAttribute('aria-expanded', 'false');
    await customize.click();
    await expect(customize).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('tab', { name: /^Ads/ })).toBeVisible();
    await page.getByRole('tab', { name: /^Look/ }).click();
    await expect(page.locator('#brandKitSelect, #wallpaperInput').first()).toBeAttached();
    const sheet = (await page.locator('#studio-side-panels').boundingBox())!;
    expect(sheet.x).toBeGreaterThanOrEqual(0);
    expect(sheet.x + sheet.width).toBeLessThanOrEqual(390);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(dockBox.y); // above the bar, not under it
    expect(await fits()).toBe(true);
    await page.getByRole('button', { name: 'Close customize' }).click();
    await expect(page.getByRole('tab', { name: /^People/ })).toBeHidden();
  });
});
