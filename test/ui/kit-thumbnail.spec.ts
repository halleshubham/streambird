import { expect, test } from '@playwright/test';
import { describeKitThumbnail, kitFor, kitThumbnailSources } from '../../web-app/src/lib/kitThumbnail';
import { THUMBNAIL_LIMITS, SLOT_SPECS, sizeText, slotHelp } from '../../web-app/src/studio/brandSizes';
import type { BrandKit } from '../../web-app/src/types/api';
import { APP, apiHeaders, patchFreePlan, signIn, solidPng } from './helpers';

// The kit's stream thumbnail: the editor slot, and the new-stream form / stream pages saying which thumbnail will be used.

const kit = (id: string, name: string, over: Partial<BrandKit> = {}): BrandKit =>
  ({ id, name, logoAssetId: null, logoAssetIdPortrait: null, logoPosition: 'left', logoSize: 90, wallpaperAssetId: null, wallpaperAssetIdPortrait: null, wallpaperDim: 0, lowerThirdStyle: 'accent', isDefault: false, adsShrinkPicture: true, thumbnailAssetId: null, connectionIds: [], ads: [], adsPortrait: [], ...over }) as BrandKit;

test.describe('which kit thumbnail a destination gets (pure)', () => {
  const def = kit('d', 'Default', { isDefault: true, thumbnailAssetId: 'td' });
  const own = kit('o', 'Own', { connectionIds: ['c1'], thumbnailAssetId: 'to' });
  const bare = kit('b', 'Bare', { connectionIds: ['c3'] });
  const kits = [def, own, bare];

  test('destination kit > account default kit > none; a kit without a thumbnail does not fall through', () => {
    expect(kitFor('c1', kits)?.id).toBe('o');
    expect(kitFor('c2', kits)?.id).toBe('d');
    expect(kitThumbnailSources(['c1', 'c2', 'c3'], kits).map((s) => [s.connectionId, s.kit.id])).toEqual([['c1', 'o'], ['c2', 'd']]); // c3's kit has none
    expect(kitThumbnailSources(['c2'], [kit('x', 'No default')])).toEqual([]);
  });

  test('an explicit choice wins: a kit id, or null for no kit', () => {
    expect(kitThumbnailSources(['c1'], kits, 'd').map((s) => s.kit.id)).toEqual(['d']);
    expect(kitThumbnailSources(['c1', 'c2'], kits, null)).toEqual([]);
    expect(kitThumbnailSources(['c1'], kits, 'missing')).toEqual([]);
  });

  test('the sentence names one kit, or lists several', () => {
    expect(describeKitThumbnail(kitThumbnailSources(['c2'], kits))).toBe('From brand kit Default');
    expect(describeKitThumbnail(kitThumbnailSources(['c1', 'c2'], kits))).toBe('From brand kits Own and Default (each destination uses its own)');
    expect(describeKitThumbnail([])).toBeNull();
  });

  test('size constants: 1280 x 720 for both shapes, JPG/PNG under 2 MB', () => {
    expect(sizeText(SLOT_SPECS.landscape.thumbnail)).toBe('1280 x 720');
    expect(SLOT_SPECS.portrait.thumbnail).toEqual(SLOT_SPECS.landscape.thumbnail);
    expect(THUMBNAIL_LIMITS).toEqual({ maxBytes: 2 * 1024 * 1024, minWidth: 640 });
    expect(slotHelp('portrait', 'thumbnail')).toContain('Vertical (9:16) streams use a 16:9 thumbnail too');
  });
});

test.describe('brand kit thumbnail in the editor and the stream form (paid plan)', () => {
  test.beforeEach(async ({ browser }) => patchFreePlan(browser, { watermark: false, assetStorageMb: 5 }));
  test.afterEach(async ({ browser }) => patchFreePlan(browser, { watermark: true, assetStorageMb: 0 }));

  test('editor: a Stream thumbnail slot with hints; upload, save, replace, choose from uploaded, refuse bad files, remove', async ({ page, context }) => {
    const { api } = await signIn(context);
    await page.goto('/brand');
    await page.getByRole('button', { name: 'New brand kit' }).click();
    const form = page.getByRole('form', { name: 'New brand kit' });
    await form.getByLabel('Kit name').fill('Cover kit');

    const slot = form.getByTestId('kit-slot-thumbnail');
    await expect(slot).toHaveAttribute('data-has-file', 'false');
    await expect(form.getByTestId('slot-size-thumbnail')).toHaveText('Suggested 1280 x 720');
    await expect(form.getByTestId('slot-help-thumbnail')).toContainText('under 2 MB');
    await expect(form.getByTestId('kit-thumbnail')).toContainText('Vertical (9:16) streams use a 16:9 thumbnail too');
    await expect(form.getByTestId('kit-thumbnail')).toContainText('A thumbnail chosen for a single stream always wins');

    // Bad files are refused before anything is uploaded: too big, and not a JPG/PNG.
    const fileInput = form.getByLabel('Stream thumbnail file');
    await fileInput.setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(2 * 1024 * 1024 + 1024, 1) });
    await expect(page.getByRole('alert').filter({ hasText: "can't be a thumbnail" })).toBeVisible();
    await expect(slot).toHaveAttribute('data-has-file', 'false');
    await fileInput.setInputFiles({ name: 'anim.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
    await expect(page.getByRole('alert').filter({ hasText: "can't be a thumbnail" })).toBeVisible();

    // A good one is uploaded in place (kind "thumbnail") and shows with its size.
    await fileInput.setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: solidPng(200, 30, 30, 1280, 720) });
    await expect(slot).toHaveAttribute('data-has-file', 'true');
    await expect(slot).toContainText('cover');
    await expect(slot).toContainText('1280 x 720');
    await expect(form.getByTestId('slot-warning-thumbnail')).toHaveCount(0);

    // The same slot on the 9:16 tab: one thumbnail for both shapes.
    await form.getByRole('tab', { name: '9:16 vertical' }).click();
    await expect(form.getByTestId('kit-slot-thumbnail')).toHaveAttribute('data-has-file', 'true');
    await form.getByRole('tab', { name: '16:9 landscape' }).click();

    await form.getByRole('button', { name: 'Create kit' }).click();
    await expect(page.getByText('Created "Cover kit".')).toBeVisible();
    const saved = (await (await api.get(`${APP}/api/brand-kits`)).json())[0];
    expect(saved.thumbnailAssetId).toBeTruthy();
    const lib = await (await api.get(`${APP}/api/assets`)).json();
    expect(lib.items.find((a: any) => a.id === saved.thumbnailAssetId)).toMatchObject({ kind: 'thumbnail', width: 1280, height: 720, usedBy: ['Cover kit'] });

    // Edit: replace it, then remove it; "choose from uploaded" offers the thumbnail files.
    await page.getByRole('button', { name: 'Edit Cover kit' }).click();
    const edit = page.getByRole('form', { name: 'Brand kit Cover kit' });
    await expect(edit.getByTestId('kit-slot-thumbnail')).toHaveAttribute('data-has-file', 'true');
    await edit.getByLabel('Stream thumbnail file').setInputFiles({ name: 'second.jpg', mimeType: 'image/png', buffer: solidPng(30, 30, 200, 1280, 720) });
    await expect(edit.getByTestId('kit-slot-thumbnail')).toContainText('second');
    await edit.getByRole('button', { name: 'Save kit' }).click();
    await expect(page.getByText('Saved "Cover kit".')).toBeVisible();
    const second = (await (await api.get(`${APP}/api/brand-kits`)).json())[0].thumbnailAssetId;
    expect(second).not.toBe(saved.thumbnailAssetId);

    await page.getByRole('button', { name: 'Edit Cover kit' }).click();
    const again = page.getByRole('form', { name: 'Brand kit Cover kit' });
    await expect(again.getByRole('combobox', { name: 'Stream thumbnail: choose from uploaded' }).locator('option')).toHaveCount(3); // placeholder + first + second
    await again.getByRole('button', { name: 'Remove Stream thumbnail' }).click();
    await expect(again.getByTestId('kit-slot-thumbnail')).toHaveAttribute('data-has-file', 'false');
    await again.getByRole('button', { name: 'Save kit' }).click();
    await expect(page.getByText('Saved "Cover kit".')).toBeVisible();
    expect((await (await api.get(`${APP}/api/brand-kits`)).json())[0].thumbnailAssetId).toBeNull();
  });

  test('the new-stream form says which thumbnail is used ("From brand kit ..."), and picking an image overrides it', async ({ page, context }) => {
    const { api } = await signIn(context);
    const conn = await (await api.post(`${APP}/api/platform-connections/twitch/manual`, { data: { label: 'Kit Twitch', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }, headers: apiHeaders })).json();
    const upload = async (name: string, kind: string, buf: Buffer) => {
      const r = await api.post(`${APP}/api/assets`, { multipart: { kind, name, file: { name: `${name}.png`, mimeType: 'image/png', buffer: buf } }, headers: { Origin: APP } });
      expect(r.ok()).toBeTruthy();
      return (await r.json()).id as string;
    };
    const cover = await upload('Acme cover', 'thumbnail', solidPng(200, 30, 30, 1280, 720));
    const acme = await (await api.post(`${APP}/api/brand-kits`, { data: { name: 'Acme', thumbnailAssetId: cover }, headers: apiHeaders })).json();
    expect(acme.isDefault).toBe(true);

    await page.goto('/streams/new');
    await page.getByLabel(/Kit Twitch/).check();
    await page.getByRole('button', { name: /More options/ }).click();
    const note = page.getByTestId('kit-thumbnail-note');
    await expect(note).toContainText('From brand kit Acme');
    await expect(note).toContainText('did not choose a thumbnail for this stream');
    await expect(page.getByTestId('kit-thumbnail-img')).toBeVisible();
    await expect(note).toHaveAttribute('data-replaced', 'false');

    // Override with the existing picker: the note says it is replaced.
    await page.locator('.thumbnail-picker input[type=file]').setInputFiles({ name: 'mine.png', mimeType: 'image/png', buffer: solidPng(30, 200, 30, 1280, 720) });
    await expect(note).toHaveAttribute('data-replaced', 'true');
    await expect(note).toContainText('replaces it for this stream');
    await page.getByRole('button', { name: 'Remove' }).first().click();
    await expect(note).toHaveAttribute('data-replaced', 'false');

    // "No brand kit" in the look: no kit thumbnail either.
    await page.selectOption('#brandKit', 'none');
    await expect(note).toHaveCount(0);
    await page.selectOption('#brandKit', '');
    await expect(note).toBeVisible();

    // The request says what to do: automatic = nothing sent; an own image = null; "No brand kit" = null.
    const auto = page.waitForRequest((r) => r.url().endsWith('/api/streams') && r.method() === 'POST');
    await page.getByRole('button', { name: /Go live now/ }).click();
    const body = (await auto).postDataJSON();
    expect('thumbnailBrandKitId' in body).toBe(false);
    await expect(page).toHaveURL(/\/studio$/);
    const streamId = page.url().match(/streams\/([^/]+)\/studio/)![1];

    // The stream's own page names the kit it used (no thumbnail of its own).
    await page.goto(`/streams/${streamId}`);
    await expect(page.getByTestId('kit-thumbnail-note')).toContainText('From brand kit Acme');
    await expect(page.getByTestId('kit-thumbnail-note')).toContainText('upload one to replace it');
    void conn;
  });

  test('an own image or "No brand kit" tells the server not to use the kit thumbnail', async ({ page, context }) => {
    const { api } = await signIn(context);
    await api.post(`${APP}/api/platform-connections/twitch/manual`, { data: { label: 'Req Twitch', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }, headers: apiHeaders });
    const cover = (
      await (await api.post(`${APP}/api/assets`, { multipart: { kind: 'thumbnail', name: 'c', file: { name: 'c.png', mimeType: 'image/png', buffer: solidPng(1, 2, 3, 1280, 720) } }, headers: { Origin: APP } })).json()
    ).id;
    const k = await (await api.post(`${APP}/api/brand-kits`, { data: { name: 'Req kit', thumbnailAssetId: cover }, headers: apiHeaders })).json();
    await page.goto('/streams/new');
    await page.getByLabel(/Req Twitch/).check();
    await page.getByRole('button', { name: /More options/ }).click();
    await page.locator('.thumbnail-picker input[type=file]').setInputFiles({ name: 'mine.png', mimeType: 'image/png', buffer: solidPng(30, 200, 30, 1280, 720) });
    const req = page.waitForRequest((r) => r.url().endsWith('/api/streams') && r.method() === 'POST');
    await page.getByRole('button', { name: /Go live now/ }).click();
    expect((await req).postDataJSON().thumbnailBrandKitId).toBeNull();

    await page.goto('/streams/new');
    await page.getByLabel(/Req Twitch/).check();
    await page.getByRole('button', { name: /More options/ }).click();
    await page.selectOption('#brandKit', k.id);
    await expect(page.getByTestId('kit-thumbnail-note')).toContainText('From brand kit Req kit');
    const picked = page.waitForRequest((r) => r.url().endsWith('/api/streams') && r.method() === 'POST');
    await page.getByRole('button', { name: /Go live now/ }).click();
    expect((await picked).postDataJSON().thumbnailBrandKitId).toBe(k.id);
  });

  test('a platform refusing the kit thumbnail while going live shows the usual thumbnail notice in the studio', async ({ page, context }) => {
    const { api } = await signIn(context);
    await api.post(`${APP}/api/platform-connections/twitch/manual`, { data: { label: 'Notice Twitch', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }, headers: apiHeaders });
    await page.route(/\/api\/streams$/, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const res = await route.fetch();
      const json = await res.json();
      await route.fulfill({ response: res, json: { ...json, thumbnailWarnings: ["YouTube (Main): couldn't set the brand kit thumbnail (403 verified channel)."] } });
    });
    await page.goto('/streams/new');
    await page.getByLabel(/Notice Twitch/).check();
    await page.getByRole('button', { name: /Go live now/ }).click();
    const notice = page.getByTestId('thumbnail-notice');
    await expect(notice).toContainText('Thumbnail not applied');
    await expect(notice).toContainText('403 verified channel');
  });

  test('a scheduled stream\'s page shows the kit thumbnail it will use', async ({ page, context }) => {
    const { api } = await signIn(context);
    const conn = await (await api.post(`${APP}/api/platform-connections/twitch/manual`, { data: { label: 'Sched Twitch', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }, headers: apiHeaders })).json();
    const cover = (
      await (await api.post(`${APP}/api/assets`, { multipart: { kind: 'thumbnail', name: 'c', file: { name: 'c.png', mimeType: 'image/png', buffer: solidPng(1, 2, 3, 1280, 720) } }, headers: { Origin: APP } })).json()
    ).id;
    await api.post(`${APP}/api/brand-kits`, { data: { name: 'Sched kit', thumbnailAssetId: cover }, headers: apiHeaders });
    const sched = await (
      await api.post(`${APP}/api/streams/schedule`, { data: { title: 'later', scheduledAt: new Date(Date.now() + 3 * 3600_000).toISOString(), timezone: 'UTC', destinationConnectionIds: [conn.id] }, headers: apiHeaders })
    ).json();
    await page.goto(`/streams/${sched.id}`);
    await expect(page.getByTestId('kit-thumbnail-note')).toContainText('From brand kit Sched kit');
    // Uploading its own thumbnail makes the note go away (the stream now has one).
    await page.locator('input[type=file][accept="image/jpeg,image/png"]').setInputFiles({ name: 'own.png', mimeType: 'image/png', buffer: solidPng(30, 200, 30, 1280, 720) });
    await expect(page.getByAltText('Stream thumbnail')).toBeVisible();
    await expect(page.getByTestId('kit-thumbnail-note')).toHaveCount(0);
  });
});

test.describe('Free plan', () => {
  test('no kit thumbnail note appears (kits are on the paid plans)', async ({ page, context }) => {
    const { api } = await signIn(context);
    await api.post(`${APP}/api/platform-connections/twitch/manual`, { data: { label: 'Free Twitch', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }, headers: apiHeaders });
    await page.goto('/streams/new');
    await page.getByLabel(/Free Twitch/).check();
    await page.getByRole('button', { name: /More options/ }).click();
    await expect(page.getByTestId('kit-thumbnail-note')).toHaveCount(0);
  });
});
