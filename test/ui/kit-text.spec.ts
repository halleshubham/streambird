import { expect, test } from '@playwright/test';
import { kitDefaultText } from '../../web-app/src/lib/kitText';
import type { BrandKit } from '../../web-app/src/types/api';
import { APP, apiHeaders, patchFreePlan, signIn } from './helpers';

// The brand kit's default title and description: the editor fields, and the new-stream form prefilling them.

const kit = (id: string, name: string, over: Partial<BrandKit> = {}): BrandKit =>
  ({ id, name, title: null, description: null, logoAssetId: null, logoAssetIdPortrait: null, logoPosition: 'left', logoSize: 90, wallpaperAssetId: null, wallpaperAssetIdPortrait: null, wallpaperDim: 0, lowerThirdStyle: 'accent', isDefault: false, adsShrinkPicture: true, thumbnailAssetId: null, connectionIds: [], ads: [], adsPortrait: [], ...over }) as BrandKit;

test.describe('which default text a stream gets (pure, same rule as the server)', () => {
  const def = kit('d', 'Default', { isDefault: true, title: 'Default title' });
  const own = kit('o', 'Own', { connectionIds: ['c1'], title: '  Own title ', description: 'Own about' });
  const blank = kit('b', 'Blank', { connectionIds: ['c3'], title: '   ', description: '' });
  const kits = [def, own, blank];

  test('first destination (in order) whose kit has a value; title and description independently; blank never counts', () => {
    expect(kitDefaultText(['c1', 'c2'], kits)).toMatchObject({ title: 'Own title', description: 'Own about', titleKit: { id: 'o' }, descriptionKit: { id: 'o' } });
    expect(kitDefaultText(['c2', 'c1'], kits)).toMatchObject({ title: 'Default title', description: 'Own about', titleKit: { id: 'd' }, descriptionKit: { id: 'o' } });
    expect(kitDefaultText(['c3'], kits)).toMatchObject({ title: null, description: null });
    expect(kitDefaultText([], kits)).toMatchObject({ title: null, description: null });
  });

  test('an explicit kit choice wins; null (no kit) gives nothing', () => {
    expect(kitDefaultText(['c1'], kits, 'd').title).toBe('Default title');
    expect(kitDefaultText(['c1'], kits, null)).toMatchObject({ title: null, description: null, titleKit: null });
    expect(kitDefaultText(['c1'], [], undefined)).toMatchObject({ title: null });
  });
});

test.describe('brand kit default title and description (paid plan)', () => {
  test.beforeEach(async ({ browser }) => patchFreePlan(browser, { watermark: false, assetStorageMb: 5 }));
  test.afterEach(async ({ browser }) => patchFreePlan(browser, { watermark: true, assetStorageMb: 0 }));

  test('editor: Default title / description with counters and the hint; saved on create and on edit; clearing sends null', async ({ page, context }) => {
    const { api } = await signIn(context);
    await page.goto('/brand');
    await page.getByRole('button', { name: 'New brand kit' }).click();
    const form = page.getByRole('form', { name: 'New brand kit' });
    await form.getByLabel('Kit name').fill('Texts');
    await expect(form.getByTestId('kit-text')).toContainText("Used for new streams that don't have their own title/description. You can change it on each stream.");
    await expect(form.getByTestId('kit-title-count')).toHaveText('0 / 200');
    await form.getByLabel('Default title').fill('Friday night show');
    await form.getByLabel('Default description').fill('Live every Friday.\nBring questions.');
    await expect(form.getByTestId('kit-title-count')).toHaveText('17 / 200');
    await expect(form.getByTestId('kit-description-count')).toHaveText('35 / 5000');
    await form.getByRole('button', { name: 'Create kit' }).click();
    await expect(page.getByText('Created "Texts".')).toBeVisible();
    const saved = (await (await api.get(`${APP}/api/brand-kits`)).json())[0];
    expect(saved).toMatchObject({ title: 'Friday night show', description: 'Live every Friday.\nBring questions.' });

    // Edit: the fields come back filled, and "Save kit" stays off until something changes.
    await page.getByRole('button', { name: 'Edit Texts' }).click();
    const edit = page.getByRole('form', { name: 'Brand kit Texts' });
    await expect(edit.getByLabel('Default title')).toHaveValue('Friday night show');
    await expect(edit.getByRole('button', { name: 'Save kit' })).toBeDisabled();
    await edit.getByLabel('Default title').fill('Saturday show');
    await edit.getByLabel('Default description').fill('');
    await edit.getByRole('button', { name: 'Save kit' }).click();
    await expect(page.getByText('Saved "Texts".')).toBeVisible();
    expect((await (await api.get(`${APP}/api/brand-kits`)).json())[0]).toMatchObject({ title: 'Saturday show', description: null });
  });

  test('new-stream form: prefilled from the kit with a "From brand kit" note; typing wins; switching kit updates only an untouched field', async ({ page, context }) => {
    const { api } = await signIn(context);
    await api.post(`${APP}/api/platform-connections/twitch/manual`, { data: { label: 'Text Twitch', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }, headers: apiHeaders });
    const acme = await (await api.post(`${APP}/api/brand-kits`, { data: { name: 'Acme', title: 'Acme weekly', description: 'About Acme' }, headers: apiHeaders })).json();
    const other = await (await api.post(`${APP}/api/brand-kits`, { data: { name: 'Other', title: 'Other show' }, headers: apiHeaders })).json();
    expect(acme.isDefault).toBe(true);

    await page.goto('/streams/new');
    await expect(page.getByLabel('Title')).toHaveValue('');
    await page.getByLabel(/Text Twitch/).check();
    // The default kit's text is filled in, with a note saying where it came from.
    await expect(page.getByLabel('Title')).toHaveValue('Acme weekly');
    await expect(page.getByTestId('title-kit-note')).toHaveText('From brand kit Acme. Edit it to change it for this stream only.');
    await page.getByRole('button', { name: /More options/ }).click();
    await expect(page.getByLabel('Description')).toHaveValue('About Acme');
    await expect(page.getByTestId('description-kit-note')).toContainText('From brand kit Acme');

    // Switching the kit updates what the person has not touched.
    await page.selectOption('#brandKit', other.id);
    await expect(page.getByLabel('Title')).toHaveValue('Other show');
    await expect(page.getByTestId('title-kit-note')).toContainText('From brand kit Other');
    await expect(page.getByLabel('Description')).toHaveValue(''); // Other has no description
    await expect(page.getByTestId('description-kit-note')).toHaveCount(0);
    await page.selectOption('#brandKit', 'none');
    await expect(page.getByLabel('Title')).toHaveValue('');
    await expect(page.getByTestId('title-kit-note')).toHaveCount(0);
    await page.selectOption('#brandKit', '');
    await expect(page.getByLabel('Title')).toHaveValue('Acme weekly');

    // Typing wins: the note goes away and a later kit switch leaves the person's title alone.
    await page.getByLabel('Title').fill('Tonight only');
    await expect(page.getByTestId('title-kit-note')).toHaveCount(0);
    await page.selectOption('#brandKit', other.id);
    await expect(page.getByLabel('Title')).toHaveValue('Tonight only');
    await page.selectOption('#brandKit', '');
    await expect(page.getByLabel('Title')).toHaveValue('Tonight only');

    // What is sent is what is on screen.
    const req = page.waitForRequest((r) => r.url().endsWith('/api/streams') && r.method() === 'POST');
    await page.getByRole('button', { name: /Go live now/ }).click();
    expect(await req.then((r) => r.postDataJSON())).toMatchObject({ title: 'Tonight only', description: 'About Acme' });
    await expect(page).toHaveURL(/\/studio$/);
    const streamId = page.url().match(/streams\/([^/]+)\/studio/)![1];
    // The stream keeps its own copy: editing the kit afterwards changes nothing.
    await api.patch(`${APP}/api/brand-kits/${acme.id}`, { data: { title: 'Changed later' }, headers: apiHeaders });
    expect(await (await api.get(`${APP}/api/streams/${streamId}`)).json()).toMatchObject({ title: 'Tonight only', description: 'About Acme' });
  });

  test('schedule mode prefills too, and an untouched prefill is what gets scheduled; a stream with no kit text keeps "Untitled stream"', async ({ page, context }) => {
    const { api } = await signIn(context);
    await api.post(`${APP}/api/platform-connections/twitch/manual`, { data: { label: 'Sched Twitch', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }, headers: apiHeaders });
    await api.post(`${APP}/api/brand-kits`, { data: { name: 'Sched kit', title: 'Scheduled show', description: 'Scheduled about' }, headers: apiHeaders });
    await page.goto('/streams/new');
    await page.getByRole('tab', { name: 'Schedule' }).click();
    await page.getByLabel(/Sched Twitch/).check();
    await expect(page.getByLabel('Title')).toHaveValue('Scheduled show');
    const req = page.waitForRequest((r) => r.url().endsWith('/api/streams/schedule') && r.method() === 'POST');
    await page.getByRole('button', { name: /^Schedule/ }).last().click();
    expect(await req.then((r) => r.postDataJSON())).toMatchObject({ title: 'Scheduled show', description: 'Scheduled about' });
    await expect(page).toHaveURL(/\/streams\/[^/]+$/);
  });

  test('a kit without text changes nothing: the title field stays empty and the stream is "Untitled stream"', async ({ page, context }) => {
    const { api } = await signIn(context);
    await api.post(`${APP}/api/platform-connections/twitch/manual`, { data: { label: 'Plain Twitch', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }, headers: apiHeaders });
    await api.post(`${APP}/api/brand-kits`, { data: { name: 'Plain kit' }, headers: apiHeaders });
    await page.goto('/streams/new');
    await page.getByLabel(/Plain Twitch/).check();
    await expect(page.getByLabel('Title')).toHaveValue('');
    await expect(page.getByTestId('title-kit-note')).toHaveCount(0);
    const req = page.waitForRequest((r) => r.url().endsWith('/api/streams') && r.method() === 'POST');
    await page.getByRole('button', { name: /Go live now/ }).click();
    expect(await req.then((r) => r.postDataJSON())).toMatchObject({ title: 'Untitled stream' });
  });
});
