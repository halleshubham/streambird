import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { APP, apiHeaders, canvasPixel, canvasSize, framePng, newStream, patchFreePlan, signIn, studioTab } from './helpers';

// The first time a studio opens a NEW stream it must put the brand kit's ads on the canvas -- however the kit got
// chosen. The L-shaped frame was the first ad people noticed missing: the kit was "selected" (Look tab) but the
// Ads tab was empty until the host clicked "From the brand kit" by hand. Cause: picking a kit on the New stream form
// (or a preset that names one) wrote the kit id into the stream's studio state, and a studio that finds a kit id
// there treats it as "already applied, only fetch the logo/wallpaper again" (the reload path), which never loads ads.

const FRAME = { width: 1280, height: 720, win: [256, 0, 1280, 576] as [number, number, number, number], frame: [200, 20, 20] as [number, number, number] };

async function uploadAd(api: APIRequestContext, name: string, buffer: Buffer, mimeType = 'image/png'): Promise<string> {
  const res = await api.post(`${APP}/api/assets`, { multipart: { kind: 'ad', name, file: { name: `${name}.${mimeType === 'image/jpeg' ? 'jpg' : 'png'}`, mimeType, buffer } }, headers: { Origin: APP } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).id as string;
}

/** A real-looking frame: the same picture re-encoded as a JPEG by the browser (compression leaves noise around the edges). */
async function jpegOf(page: Page, png: Buffer, quality = 0.8): Promise<Buffer> {
  await page.goto('/');
  const b64 = await page.evaluate(
    async ({ data, q }) => {
      const img = new Image();
      await new Promise<void>((ok, bad) => {
        img.onload = () => ok();
        img.onerror = () => bad(new Error('decode'));
        img.src = `data:image/png;base64,${data}`;
      });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const cx = c.getContext('2d')!;
      cx.fillStyle = '#fff';
      cx.fillRect(0, 0, c.width, c.height);
      cx.drawImage(img, 0, 0);
      const blob = await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), 'image/jpeg', q));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    },
    { data: png.toString('base64'), q: quality },
  );
  return Buffer.from(b64, 'base64');
}

async function addTwitch(api: APIRequestContext, label: string): Promise<string> {
  const conn = await (await api.post(`${APP}/api/platform-connections/twitch/manual`, { data: { label, ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }, headers: apiHeaders })).json();
  return conn.id as string;
}

/** The frame's red column (200, 20, 20) is at the left edge of the canvas. */
const redColumn = async (page: Page) => {
  const { width: W, height: H } = await canvasSize(page);
  const p = await canvasPixel(page, 0.1 * W, H / 2);
  return p[0] > 150 && p[1] < 60 && p[2] < 60;
};

async function expectFrameUp(page: Page) {
  await expect.poll(() => redColumn(page)).toBe(true);
  await studioTab(page, 'Ads');
  await expect(page.getByTestId('ad-card-l_shape')).toContainText('From the brand kit');
  await expect(page.getByTestId('ad-window-outline')).toBeVisible();
}

test.describe('a new stream applies its kit\'s ads on the first open', () => {
  test.beforeEach(async ({ browser }) => patchFreePlan(browser, { watermark: false, assetStorageMb: 5 }));
  test.afterEach(async ({ browser }) => patchFreePlan(browser, { watermark: true, assetStorageMb: 0 }));

  test('the kit picked on the New stream form (not "Default look"): frame, logo and lower third all come up', async ({ page, context }) => {
    const { api } = await signIn(context);
    await addTwitch(api, 'Form Twitch');
    const frame = await uploadAd(api, 'frame', framePng(FRAME));
    const lower = await uploadAd(api, 'lower', framePng({ width: 640, height: 80, win: [0, 0, 0, 0], frame: [20, 160, 20] }));
    const kit = await (await api.post(`${APP}/api/brand-kits`, { data: { name: 'Picked', ads: [{ placement: 'l_shape', assetId: frame }, { placement: 'lower_third', assetId: lower }] }, headers: apiHeaders })).json();
    await api.post(`${APP}/api/brand-kits`, { data: { name: 'Other' }, headers: apiHeaders }); // the account default is NOT the one we pick

    await page.goto('/streams/new');
    await page.getByLabel(/Form Twitch/).check();
    await page.getByRole('button', { name: /More options/ }).click();
    await page.locator('#brandKit').selectOption(kit.id);
    await page.getByRole('button', { name: /Go live now/ }).click();
    await expect(page).toHaveURL(/\/studio$/);
    await page.locator('canvas.studio-canvas').waitFor();
    await expectFrameUp(page);
    await expect(page.getByTestId('ad-card-lower_third')).toContainText('From the brand kit');

    // A reload keeps it (the ads are restored from the library).
    await page.reload();
    await page.locator('canvas.studio-canvas').waitFor();
    await expectFrameUp(page);
    await expect(page.getByTestId('ad-card-lower_third')).toContainText('From the brand kit');
  });

  test('leaving the studio before the kit finished loading: the next open still applies the ads', async ({ page, context }) => {
    const { api } = await signIn(context);
    const frame = await uploadAd(api, 'frame', framePng(FRAME));
    await api.post(`${APP}/api/brand-kits`, { data: { name: 'Slow', ads: [{ placement: 'l_shape', assetId: frame }] }, headers: apiHeaders });
    const id = await newStream(api);

    let hold = true;
    await page.route(`**/api/assets/${frame}/file`, async (route) => {
      if (hold) await new Promise((r) => setTimeout(r, 3_000));
      await route.fulfill({ status: 200, contentType: 'image/png', body: framePng(FRAME) }).catch(() => undefined);
    });
    await page.goto(`/streams/${id}/studio`);
    await page.locator('canvas.studio-canvas').waitFor();
    await page.waitForTimeout(500);
    await page.goto('/dashboard'); // gone before the frame arrived
    hold = false;
    await page.goto(`/streams/${id}/studio`);
    await page.locator('canvas.studio-canvas').waitFor();
    await expectFrameUp(page);
  });

  test('a real-looking JPEG frame (compression noise), a kit on the destination, and "Now and then" mode', async ({ page, context }) => {
    const { api } = await signIn(context);
    const conn = await addTwitch(api, 'Dest Twitch');
    const jpeg = await jpegOf(page, framePng(FRAME));
    const frame = await uploadAd(api, 'frame-jpg', jpeg, 'image/jpeg');
    await api.post(`${APP}/api/brand-kits`, { data: { name: 'Default one' }, headers: apiHeaders });
    const kit = await (
      await api.post(`${APP}/api/brand-kits`, { data: { name: 'Channel kit', ads: [{ placement: 'l_shape', assetId: frame, mode: 'interval', showSec: 5, everySec: 20 }] }, headers: apiHeaders })
    ).json();
    expect((await api.put(`${APP}/api/brand-kits/connections/${conn}`, { data: { brandKitId: kit.id }, headers: apiHeaders })).ok()).toBeTruthy();
    const stream = await (await api.post(`${APP}/api/streams`, { data: { title: 'Dest kit', destinationConnectionIds: [conn] }, headers: apiHeaders })).json();

    await page.goto(`/streams/${stream.id}/studio`);
    await page.locator('canvas.studio-canvas').waitFor();
    await studioTab(page, 'Ads');
    const card = page.getByTestId('ad-card-l_shape');
    await expect(card).toContainText('From the brand kit');
    await expect(page.getByTestId('ad-window-outline')).toBeVisible(); // the window was found in the JPEG
    await expect(card).not.toContainText('No clear window');
    await expect(page.getByText(/Could not load/)).toHaveCount(0);
  });

  test('"Now and then" frame: applied and listed on the first open, hidden until its time with a countdown, and Show now brings it up', async ({ page, context }) => {
    const { api } = await signIn(context);
    const frame = await uploadAd(api, 'frame', framePng(FRAME));
    await api.post(`${APP}/api/brand-kits`, { data: { name: 'Timed', ads: [{ placement: 'l_shape', assetId: frame, mode: 'interval', showSec: 15, everySec: 180 }] }, headers: apiHeaders });
    const id = await newStream(api);
    await page.goto(`/streams/${id}/studio`);
    await page.locator('canvas.studio-canvas').waitFor();
    await studioTab(page, 'Ads');
    const card = page.getByTestId('ad-card-l_shape');
    await expect(card).toContainText('From the brand kit');
    await expect(card.getByTestId('ad-status-l_shape')).toHaveText('Shown for 15 sec, then hidden for 3 min');
    await expect(card.getByTestId('ad-timing-l_shape')).toContainText(/Hidden for now; shows in [0-3]:\d\d for 15 sec\./);
    await expect(card.getByTestId('ad-timing-l_shape')).toContainText('starts again when you go live');
    await expect(page.getByText(/Applied brand kit "Timed"\..*show on their timer/)).toBeVisible();
    expect(await redColumn(page)).toBe(false); // hidden by its schedule, not missing
    await card.getByRole('button', { name: 'Show the L-shaped frame ad now' }).click();
    await expect.poll(() => redColumn(page)).toBe(true);
    await expect(card.getByTestId('ad-timing-l_shape')).toHaveCount(0); // by hand: the status line says so
  });

  // What the New stream form leaves behind for a stream whose kit was picked by hand (see seedStudioFromPreset).
  const seedPickedKit = (page: Page, streamId: string, kitId: string) =>
    page.addInitScript(
      ({ sid, kid }) => {
        if (!localStorage.getItem(`streambird:studio:${sid}:v1`)) localStorage.setItem(`streambird:studio:${sid}:v1`, JSON.stringify({ brandKitId: kid, kitPending: true }));
      },
      { sid: streamId, kid: kitId },
    );

  test('a hand-picked kit on a vertical stream: the 9:16 set of ads is applied', async ({ page, context }) => {
    const { api } = await signIn(context);
    const portrait = await uploadAd(api, 'frame-p', framePng({ width: 720, height: 1280, win: [0, 0, 720, 900], frame: [200, 20, 20] }));
    const kit = await (await api.post(`${APP}/api/brand-kits`, { data: { name: 'Tall', adsPortrait: [{ placement: 'l_shape', assetId: portrait }] }, headers: apiHeaders })).json();
    const id = await newStream(api, 'portrait');
    await seedPickedKit(page, id, kit.id);
    await page.goto(`/streams/${id}/studio`);
    await page.locator('canvas.studio-canvas').waitFor();
    await studioTab(page, 'Ads');
    await expect(page.getByTestId('ad-card-l_shape')).toContainText('From the brand kit');
    await expect(page.getByTestId('ad-window-outline')).toBeVisible();
  });

  test('a hand-picked kit whose frame is switched off, or whose "shrink picture" is off: the card is listed and says why nothing shows', async ({ page, context }) => {
    const { api } = await signIn(context);
    const frame = await uploadAd(api, 'frame', framePng(FRAME));
    const off = await (await api.post(`${APP}/api/brand-kits`, { data: { name: 'Off', ads: [{ placement: 'l_shape', assetId: frame, enabled: false }] }, headers: apiHeaders })).json();
    const noShrink = await (await api.post(`${APP}/api/brand-kits`, { data: { name: 'No shrink', adsShrinkPicture: false, ads: [{ placement: 'l_shape', assetId: frame }] }, headers: apiHeaders })).json();
    const a = await newStream(api);
    await seedPickedKit(page, a, off.id);
    await page.goto(`/streams/${a}/studio`);
    await page.locator('canvas.studio-canvas').waitFor();
    await studioTab(page, 'Ads');
    await expect(page.getByTestId('ad-card-l_shape')).toContainText('From the brand kit');
    await expect(page.getByTestId('ad-status-l_shape')).toHaveText('Switched off');
    expect(await redColumn(page)).toBe(false);

    const b = await newStream(api);
    await seedPickedKit(page, b, noShrink.id);
    await page.goto(`/streams/${b}/studio`);
    await page.locator('canvas.studio-canvas').waitFor();
    await studioTab(page, 'Ads');
    await expect(page.getByTestId('ad-card-l_shape')).toContainText('From the brand kit');
    await expect(page.getByTestId('ad-lshape-needs-shrink')).toBeVisible();
    expect(await redColumn(page)).toBe(false);
  });
});
