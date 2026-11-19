import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { adRect, fitAd } from '../../web-app/src/studio/ads';
import { APP, CONTROL, canvasPixel, canvasSize, isRed, newStream, patchFreePlan, signIn, solidPng, studioTab } from './helpers';

// Remote control of a LIVE studio by a superadmin support session, with TWO browser contexts: the customer's host studio
// (fake camera, canvas) in context A and the admin's control page in context B. Everything the admin changes in B must
// show up in A within a few seconds; the host's own changes win; view mode has no controls; B never touches a camera.

const CONSENT = { cookies: [], origins: [{ origin: APP, localStorage: [{ name: 'streambird:consent:v1', value: 'denied' }, { name: 'streambird:tour:studio:v1', value: 'done' }] }] };
const AD_SHAPE: [number, number] = [128, 24];

test.beforeEach(async ({ browser }) => patchFreePlan(browser, { watermark: false }));
test.afterEach(async ({ browser }) => patchFreePlan(browser, { watermark: true }));

interface Rig {
  host: Page;
  admin: Page;
  streamId: string;
  accountId: string;
  adminCtx: BrowserContext;
  requests: string[];
  close: () => Promise<void>;
}

/** The customer's studio is open in `host`; the admin (in its own context, WITHOUT camera permission) is in a support session. */
async function rig(browser: Browser, hostPage: Page, hostCtx: BrowserContext, mode: 'act' | 'view', opts: { openHost?: boolean } = {}): Promise<Rig> {
  const cust = await signIn(hostCtx);
  const streamId = await newStream(cust.api);
  const adminCtx = await browser.newContext({ baseURL: APP, storageState: CONSENT, viewport: { width: 1366, height: 800 } });
  const adminSignIn = await signIn(adminCtx, { superadmin: true });
  const found = await (await adminSignIn.api.get(`${APP}/api/superadmin/accounts?q=${encodeURIComponent(cust.email)}`)).json();
  const accountId = found.items[0].id as string;
  const admin = await adminCtx.newPage();
  const requests: string[] = [];
  admin.on('request', (r) => requests.push(`${r.method()} ${new URL(r.url()).pathname}`));
  // Any camera/microphone request from the control page would be a bug: count them.
  await admin.addInitScript(() => {
    const w = window as unknown as { __gum: number };
    w.__gum = 0;
    const md = navigator.mediaDevices;
    if (md?.getUserMedia) {
      const orig = md.getUserMedia.bind(md);
      md.getUserMedia = (...a) => {
        w.__gum++;
        return orig(...a);
      };
    }
  });
  if (opts.openHost !== false) {
    await hostPage.setViewportSize({ width: 1366, height: 800 });
    await hostPage.goto(`/streams/${streamId}/studio`);
    await hostPage.locator('canvas.studio-canvas').waitFor();
    await expect(hostPage.getByText('Connected to the studio as host.')).toBeVisible();
  }
  await admin.goto(`/admin/accounts/${accountId}`);
  await admin.getByTestId(mode === 'act' ? 'admin-impersonate-act' : 'admin-impersonate-view').click();
  if (mode === 'act') await admin.getByTestId('impersonate-act-confirm').click();
  await expect(admin.getByTestId('impersonation-banner')).toBeVisible();
  return { host: hostPage, admin, streamId, accountId, adminCtx, requests, close: () => adminCtx.close() };
}

const openControl = async (r: Rig) => {
  await r.admin.goto(`/streams/${r.streamId}/studio`);
  await expect(r.admin.getByTestId('support-control-header')).toContainText('(LIVE)');
};
const entry = (page: Page, text: string) => page.getByTestId('support-command-entry').filter({ hasText: text }).first();

/** Number of near-white pixels in the top-right corner of the host canvas (the clock text). */
const whiteInTopRight = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement;
    const w = Math.round(c.width * 0.4);
    const h = Math.round(c.height * 0.2);
    const d = c.getContext('2d')!.getImageData(c.width - w, 0, w, h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) n++;
    return n;
  });

test.describe('support control of a live studio (two browsers)', () => {
  test('what the admin changes in B shows on the customer\'s canvas in A, silently; B has no camera and never asks for a host token', async ({ page, context, browser }) => {
    // The host's clock is pinned (the studio's test hook) so the clock text is steady.
    await page.addInitScript((n) => {
      localStorage.setItem('streambird:test:clock', 'on');
      (window as unknown as { __SB_TEST_NOW__: number }).__SB_TEST_NOW__ = n;
    }, Date.UTC(2026, 10, 18, 9, 34, 5));
    const r = await rig(browser, page, context, 'act');
    const { host: A, admin: B } = r;

    // A: an ad of the customer's own (a red lower third), on all the time.
    await studioTab(A, 'Ads');
    await A.locator('#adFile-lower_third').setInputFiles({ name: 'lower.png', mimeType: 'image/png', buffer: solidPng(255, 0, 0, ...AD_SHAPE) });
    const { width: W, height: H } = await canvasSize(A);
    const rect = fitAd('lower_third', AD_SHAPE[0], AD_SHAPE[1], adRect('lower_third', W, H));
    const adPx = () => canvasPixel(A, rect.x + rect.w / 2, rect.y + rect.h / 2);
    await expect.poll(async () => isRed(await adPx())).toBe(true);
    expect(await whiteInTopRight(A)).toBe(0);

    await openControl(r);
    await expect(B.getByTestId('support-host-status')).toHaveAttribute('data-connected', '1');
    await expect(B.getByTestId('support-host-status')).toContainText('host studio connected');
    await expect(B.getByTestId('support-layout')).toBeVisible(); // the snapshot arrived
    await expect(B.getByTestId('support-ad-lower_third')).toContainText('lower.png');

    // Ads: Hide, then back to the schedule.
    await B.getByTestId('support-ad-lower_third-hide').click();
    await expect(entry(B, 'Lower third ad: hide')).toContainText('applied');
    await expect.poll(async () => isRed(await adPx()), { timeout: 8000 }).toBe(false);
    await expect(B.getByTestId('support-ad-lower_third-hide')).toHaveAttribute('aria-pressed', 'true'); // the control reflects the host's real state
    await B.getByTestId('support-ad-lower_third-follow').click();
    await expect.poll(async () => isRed(await adPx()), { timeout: 8000 }).toBe(true);
    // Ads off, on again.
    await B.getByRole('checkbox', { name: 'Lower third ad on' }).click(); // controlled by the host's state: click, then watch the result
    await expect.poll(async () => isRed(await adPx()), { timeout: 8000 }).toBe(false);
    await expect(B.getByRole('checkbox', { name: 'Lower third ad on' })).not.toBeChecked({ timeout: 8000 });
    await B.getByRole('checkbox', { name: 'Lower third ad on' }).click();
    await expect.poll(async () => isRed(await adPx()), { timeout: 8000 }).toBe(true);
    // Shrink switch.
    await B.getByRole('checkbox', { name: 'Shrink picture while ads show' }).click();
    await expect(entry(B, 'Shrink picture off')).toContainText('applied');

    // Layout.
    await B.getByTestId('support-layout').selectOption('spotlight');
    await expect(entry(B, 'Layout: Spotlight (classic)')).toContainText('applied');
    await expect(A.locator('#layoutSelect')).toHaveValue('spotlight', { timeout: 8000 });

    // Ticker.
    await B.getByTestId('support-ticker-text').fill('Support was here');
    await B.getByTestId('support-ticker-show').click();
    await studioTab(A, 'Look');
    await expect(A.locator('#newsInput')).toHaveValue('Support was here', { timeout: 8000 });
    await B.getByTestId('support-ticker-hide').click();
    await expect(A.locator('#newsInput')).toHaveValue('', { timeout: 8000 });

    // Clock: the on-air time appears in the corner of A's canvas.
    await B.getByTestId('clock-enabled').click();
    await expect(entry(B, 'Clock: enabled')).toContainText('applied');
    await expect(A.getByTestId('clock-enabled')).toBeChecked({ timeout: 8000 });
    await expect.poll(() => whiteInTopRight(A), { timeout: 8000 }).toBeGreaterThan(20);
    await B.getByTestId('clock-format-24h').click();
    await expect(A.getByTestId('clock-format-24h')).toHaveAttribute('aria-pressed', 'true', { timeout: 8000 });

    // Logo position and the lower-third panel (this plan has no animated lower thirds: the panel says so).
    await B.getByTestId('support-logo-right').click();
    await expect(entry(B, 'Logo: right')).toContainText('applied');
    await expect(B.getByRole('region', { name: 'Lower third' })).toContainText('not part of this customer');

    // The host sees no sign of any of this.
    await expect(A.locator('[data-testid*="support"], .support-banner')).toHaveCount(0);
    await expect(A.locator('body')).not.toContainText(/support/i);

    // B: never asked for a camera or microphone, never for the host token; asked for exactly the control token.
    expect(await B.evaluate(() => (window as unknown as { __gum: number }).__gum)).toBe(0);
    expect(r.requests.some((q) => q.includes('/host-token'))).toBe(false);
    expect(r.requests.filter((q) => q === `POST /api/streams/${r.streamId}/support-control-token`).length).toBeGreaterThanOrEqual(1);
    expect(await B.locator('video').count()).toBe(0);
    await r.close();
  });

  test('the host\'s own change wins: a support command within 3 s is refused, one after goes through', async ({ page, context, browser }) => {
    const r = await rig(browser, page, context, 'act');
    const { host: A, admin: B } = r;
    await openControl(r);
    await expect(B.getByTestId('support-layout')).toBeVisible();

    // The host picks Spotlight; right after, support tries Podcast.
    await A.locator('#layoutSelect').selectOption('spotlight');
    await expect(A.locator('#layoutSelect')).toHaveValue('spotlight');
    await A.waitForTimeout(150);
    await B.getByTestId('support-layout').selectOption('podcast-split');
    await expect(entry(B, 'Layout: Podcast: side by side')).toContainText('failed: host changed it just now', { timeout: 8000 });
    await expect(A.locator('#layoutSelect')).toHaveValue('spotlight');

    // Three seconds on, the same command goes through (and the host can override it again).
    await A.waitForTimeout(3300);
    await expect(B.getByTestId('support-layout')).toHaveValue('spotlight', { timeout: 8000 }); // the controller shows the host's state
    await B.getByTestId('support-layout').selectOption('podcast-split');
    await expect(A.locator('#layoutSelect')).toHaveValue('podcast-split', { timeout: 8000 });
    await A.locator('#layoutSelect').selectOption('grid');
    await expect(B.getByTestId('support-layout')).toHaveValue('grid', { timeout: 8000 });
    await r.close();
  });

  test('without a host studio the control page says so and commands cannot be sent', async ({ page, context, browser }) => {
    const r = await rig(browser, page, context, 'act', { openHost: false });
    await openControl(r);
    await expect(r.admin.getByTestId('support-host-status')).toContainText('The host studio is not connected');
    await expect(r.admin.getByTestId('support-waiting')).toBeVisible();
    await expect(r.admin.getByTestId('support-layout')).toHaveCount(0);
    expect(await r.admin.evaluate(() => (window as unknown as { __gum: number }).__gum)).toBe(0);
    // The host opens the studio: the controls appear without a reload.
    await page.goto(`/streams/${r.streamId}/studio`);
    await page.locator('canvas.studio-canvas').waitFor();
    await expect(r.admin.getByTestId('support-host-status')).toHaveAttribute('data-connected', '1', { timeout: 10_000 });
    await expect(r.admin.getByTestId('support-layout')).toBeVisible({ timeout: 10_000 });
    await r.close();
  });

  test('view mode: no controls, no token, no socket', async ({ page, context, browser }) => {
    const r = await rig(browser, page, context, 'view');
    await r.admin.goto(`/streams/${r.streamId}/studio`);
    await expect(r.admin.getByTestId('support-control-view-only')).toContainText('View-only support session');
    await expect(r.admin.getByTestId('support-layout')).toHaveCount(0);
    await expect(r.admin.getByTestId('support-ad-lower_third-show')).toHaveCount(0);
    await r.admin.waitForTimeout(500);
    expect(r.requests.some((q) => q.includes('support-control-token') || q.includes('/host-token') || q.includes('socket.io'))).toBe(false);
    expect(await r.admin.evaluate(() => (window as unknown as { __gum: number }).__gum)).toBe(0);
    await r.close();
  });

  test('the customer reloads the studio: the control page follows with the fresh state, and its commands still work', async ({ page, context, browser }) => {
    const r = await rig(browser, page, context, 'act');
    const { host: A, admin: B } = r;
    await openControl(r);
    await expect(B.getByTestId('support-layout')).toBeVisible();
    // The host picks Spotlight (saved per stream in the browser), then reloads the whole studio.
    await A.locator('#layoutSelect').selectOption('spotlight');
    await expect(B.getByTestId('support-layout')).toHaveValue('spotlight', { timeout: 8000 });
    await A.reload();
    await A.locator('canvas.studio-canvas').waitFor();
    await expect(A.getByText('Connected to the studio as host.')).toBeVisible();
    await expect(A.locator('#layoutSelect')).toHaveValue('spotlight');
    // B shows the host again, with the state of the NEW studio (not the pre-reload snapshot), and controls it.
    await expect(B.getByTestId('support-host-status')).toHaveAttribute('data-connected', '1', { timeout: 10_000 });
    await expect(B.getByTestId('support-layout')).toHaveValue('spotlight', { timeout: 10_000 });
    await A.waitForTimeout(3300); // clear the host's conflict window from the page load
    await B.getByTestId('support-layout').selectOption('podcast-split');
    await expect(A.locator('#layoutSelect')).toHaveValue('podcast-split', { timeout: 8000 });
    await expect(B.getByTestId('support-layout')).toHaveValue('podcast-split', { timeout: 8000 });
    await r.close();
  });

  test('when the support session ends the controls are switched off at once with a clear message', async ({ page, context, browser }) => {
    const r = await rig(browser, page, context, 'act');
    await openControl(r);
    await expect(r.admin.getByTestId('support-layout')).toBeVisible();
    // The session ends from elsewhere (another tab / Exit): the socket is cut with support:ended.
    const res = await r.adminCtx.request.delete(`${APP}/api/superadmin/impersonation`, { headers: { Origin: APP } });
    expect(res.status()).toBe(204);
    await expect(r.admin.getByTestId('support-ended')).toContainText('Support session ended', { timeout: 8000 });
    await expect(r.admin.getByTestId('support-layout')).toHaveCount(0);
    await expect(r.admin.getByTestId('support-ad-lower_third-hide')).toHaveCount(0);
    await r.close();
  });

  test('ending the support session closes the control page and the host is untouched', async ({ page, context, browser }) => {
    const r = await rig(browser, page, context, 'act');
    await openControl(r);
    await expect(r.admin.getByTestId('support-layout')).toBeVisible();
    await r.admin.getByTestId('impersonation-exit').click();
    await expect(r.admin).toHaveURL(new RegExp(`/admin/accounts/${r.accountId}$`));
    await expect(r.admin.getByTestId('support-control')).toHaveCount(0);
    await expect(page.locator('#layoutSelect')).toBeVisible();
    await r.close();
  });
});
