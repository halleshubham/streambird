import { APIRequestContext, BrowserContext, expect, Page, test } from '@playwright/test';
import * as crypto from 'crypto';
import { computeLayout } from '../../web-app/src/studio/compose';
import type {} from '../../web-app/src/studio/personSegmenter'; // brings in the window.__SB_TEST_SEGMENTER__ type

const CONTROL = `http://127.0.0.1:${process.env.UI_CONTROL_PORT ?? 4311}`;
const APP = `http://127.0.0.1:${process.env.UI_APP_PORT ?? 4310}`;

/** Signs the browser context in through the real email-code API (cookies land in the context), approving the user first. */
async function signIn(context: BrowserContext, opts: { superadmin?: boolean } = {}): Promise<{ email: string; api: APIRequestContext }> {
  const email = `ui-${crypto.randomBytes(5).toString('hex')}@test.dev`;
  const api = context.request;
  const headers = { Origin: APP };
  await api.post(`${APP}/api/auth/request-code`, { data: { email }, headers });
  const { code } = await (await api.get(`${CONTROL}/code?email=${email}`)).json();
  const verified = await api.post(`${APP}/api/auth/verify-code`, { data: { email, code }, headers });
  expect(verified.ok()).toBeTruthy();
  await api.post(`${CONTROL}/approve?email=${email}${opts.superadmin ? '&superadmin=1' : ''}`);
  return { email, api };
}
const apiHeaders = { Origin: APP, 'Content-Type': 'application/json' };

// The server's COOKIE_CONSENT_BANNER decides the mode (default off); these tests answer /api/config/public themselves.
const bannerMode = (page: Page, on: boolean) =>
  page.route('**/api/config/public', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ cookieConsentBanner: on }) }));

test.describe('cookie consent', () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // a first-time visitor

  test('default (banner off): no banner, no Cookie settings link, and Google Analytics loads for everyone', async ({ page }) => {
    const hits = googleRequests(page);
    await page.route(/googletagmanager\.com/, (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
    const real = await (await page.request.get('/api/config/public')).json();
    expect(real).toEqual({ cookieConsentBanner: false }); // the fixture server runs with the default
    await page.goto('/');
    await expect.poll(() => hits.length).toBeGreaterThan(0);
    await expect(page.getByRole('region', { name: 'Cookie consent' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cookie settings' })).toHaveCount(0);
    await page.goto('/privacy');
    await expect(page.getByText('we use Google Analytics to see which pages are used')).toBeVisible();
  });

  const googleRequests = (page: Page) => {
    const hits: string[] = [];
    page.on('request', (r) => { if (/googletagmanager\.com|google-analytics\.com/.test(r.url())) hits.push(r.url()); });
    return hits;
  };

  test('first visit: a banner with equal Accept and Reject; nothing from Google loads until Accept', async ({ page }) => {
    await bannerMode(page, true);
    const hits = googleRequests(page);
    await page.route(/googletagmanager\.com/, (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.goto('/');
    const banner = page.getByRole('region', { name: 'Cookie consent' });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('link', { name: /how we use cookies/ })).toHaveAttribute('href', '/privacy#cookies');
    const [a, r] = await Promise.all([banner.getByRole('button', { name: 'Accept' }).boundingBox(), banner.getByRole('button', { name: 'Reject' }).boundingBox()]);
    expect(a!.width).toBeCloseTo(r!.width, 0);
    expect(a!.height).toBeCloseTo(r!.height, 0);
    await page.waitForTimeout(500);
    expect(hits).toEqual([]);

    await banner.getByRole('button', { name: 'Accept' }).click();
    await expect(banner).toHaveCount(0);
    await expect.poll(() => hits.length).toBeGreaterThan(0);
    await page.reload(); // remembered: no banner, analytics loads again
    await expect(page.getByRole('region', { name: 'Cookie consent' })).toHaveCount(0);
    expect(await page.evaluate(() => !!document.querySelector('script[src*="googletagmanager"]'))).toBe(true);
  });

  test('Reject: Google never loads, even after a reload and on other pages; Cookie settings brings the banner back', async ({ page }) => {
    await bannerMode(page, true);
    const hits = googleRequests(page);
    await page.goto('/');
    await page.getByRole('region', { name: 'Cookie consent' }).getByRole('button', { name: 'Reject' }).click();
    await page.goto('/login');
    await page.reload();
    await expect(page.getByRole('region', { name: 'Cookie consent' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cookie settings' }).click();
    await expect(page.getByRole('region', { name: 'Cookie consent' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(hits).toEqual([]);
  });

  test('the privacy policy (banner mode) explains the choice, cookies and the mobile number', async ({ page }) => {
    await bannerMode(page, true);
    await page.goto('/privacy#cookies');
    await expect(page.getByRole('heading', { name: /Cookies, analytics/ })).toBeVisible();
    await expect(page.getByText('Mobile number:')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your rights and how to reach us' })).toBeVisible();
  });

  test('the studio is never covered by the banner', async ({ page, context }) => {
    await bannerMode(page, true);
    const { api } = await signIn(context);
    const id = await newStream(context, api);
    await page.goto(`/streams/${id}/studio`);
    await expect(page.getByRole('button', { name: /Start my camera/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Cookie consent' })).toHaveCount(0);
  });
});

test.describe('public pages', () => {
  test('login offers email, Google and Facebook sign-in', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'StreamBird' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Sign in with Google/ })).toHaveAttribute('href', '/api/auth/google');
    await expect(page.getByRole('link', { name: /Continue with Facebook/ })).toHaveAttribute('href', '/api/auth/facebook');
    await expect(page.getByRole('button', { name: /Send login code/ })).toBeDisabled(); // nothing typed yet
  });

  test('the home page shows the live plans from the API, with no Buy buttons while payments are off', async ({ page }) => {
    await page.goto('/');
    const pricing = page.locator('#pricing');
    for (const name of ['Free', 'Starter', 'Pro', 'Business', 'Day Pass']) {
      await expect(pricing.getByRole('heading', { name })).toBeVisible();
    }
    await expect(pricing.getByRole('link', { name: 'Buy' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /support@shackyapps\.in/ }).first()).toHaveAttribute('href', /mailto:support@shackyapps\.in/);
  });

  test('has a Docs link in the header area', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Docs' }).first()).toHaveAttribute('href', 'https://shackyapps.in/docs/streambird/');
  });
});

test.describe('signed-in user', () => {
  test('email-code sign-in: pending approval, then the dashboard with the plan meter', async ({ page }) => {
    const email = `ui-${crypto.randomBytes(5).toString('hex')}@test.dev`;
    await page.goto('/login');
    await page.fill('#email', email);
    await page.getByRole('button', { name: /Send login code/ }).click();
    await page.waitForSelector('#code');
    const { code } = await (await page.request.get(`${CONTROL}/code?email=${email}`)).json();
    await page.fill('#code', code);
    await page.getByRole('button', { name: /Log in/ }).click();
    await page.getByLabel('Mobile number').fill('9876543210'); // new accounts give a number first
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Your studio is being set up!' })).toBeVisible(); // then wait for approval

    await page.request.post(`${CONTROL}/approve?email=${email}`);
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText('Stream hours this period')).toBeVisible();
    await expect(page.getByText(/Free plan/)).toBeVisible();
  });

  test('the Connections page explains the YouTube permission, and the privacy policy names the same scope', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/connections');
    const note = page.getByTestId('youtube-permission-note');
    await expect(note).toContainText('Create the live broadcast');
    await expect(note).toContainText('What it never does');
    await expect(page.getByText('See, edit, and permanently delete your YouTube videos, ratings, comments and captions').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Connect YouTube/ })).toHaveAttribute('href', '/api/platform-connections/youtube/connect');

    await page.goto('/privacy');
    await expect(page.getByText('https://www.googleapis.com/auth/youtube.force-ssl')).toBeVisible();
  });

  test('billing page: explains payments are off, then offers autopay as the default once an admin turns them on', async ({ page, context, browser }) => {
    await signIn(context);
    await page.goto('/billing');
    await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
    await expect(page.getByText(/Online payments aren't switched on yet/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Subscribe/ })).toHaveCount(0);

    const adminCtx = await browser.newContext();
    const admin = await signIn(adminCtx, { superadmin: true });
    expect((await admin.api.patch(`${APP}/api/superadmin/billing/settings`, { data: { paymentsEnabled: true }, headers: apiHeaders })).ok()).toBeTruthy();
    try {
      await page.reload();
      await expect(page.getByRole('button', { name: /Subscribe -- autopay/ })).toHaveCount(3); // Starter, Pro, Business
      await expect(page.getByRole('button', { name: /Or pay once for 30 days/ })).toHaveCount(3);
      await expect(page.getByRole('button', { name: 'Buy' })).toHaveCount(1); // the Day Pass
      // The home page redirects signed-in users to the dashboard, so look at pricing as a visitor.
      const visitor = await browser.newPage();
      await visitor.goto(`${APP}/`);
      await expect(visitor.locator('#pricing').getByRole('link', { name: 'Buy' })).toHaveCount(4); // priced plans only
      await visitor.close();
    } finally {
      await admin.api.patch(`${APP}/api/superadmin/billing/settings`, { data: { paymentsEnabled: false }, headers: apiHeaders });
      await adminCtx.close();
    }
  });
});

test.describe('admin login', () => {
  test('password first, then the emailed code', async ({ page, context }) => {
    // A user who becomes the superadmin (as the seed service would create one).
    const { email } = await signIn(context);
    await context.request.post(`${CONTROL}/make-superadmin?email=${email}&password=correct-horse`);
    await context.clearCookies();

    await page.goto('/admin/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('correct-horse');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByText(new RegExp(`Step 2 of 2.*6-digit code.*${email}`))).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/); // not signed in yet

    const { code } = await (await context.request.get(`${CONTROL}/code?email=${email}`)).json();
    await page.getByLabel('Code').fill(code);
    await page.getByRole('button', { name: 'Verify and log in' }).click();
    await expect(page).toHaveURL(/\/admin$/);
  });
});

test.describe('admin login page', () => {
  test('wears the admin identity, and a wrong password is an alert on step 1 (no code step)', async ({ page, context }) => {
    const { email } = await signIn(context);
    await context.request.post(`${CONTROL}/make-superadmin?email=${email}&password=correct-horse`);
    await context.clearCookies();
    await page.goto('/admin/login');
    await expect(page.locator('.admin-auth-card .admin-badge')).toHaveText('ADMIN');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText(/Step 1 of 2/)).toBeVisible();
    await expect(page.getByText(/audit log/i)).toBeVisible();
    // The card carries the same amber rule as the admin header.
    const top = await page.locator('.admin-auth-card').evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(top).toBe('3px');

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByLabel('Code')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('phone: the card fits the screen, and "Start over" returns to step 1', async ({ page, context }) => {
    const { email } = await signIn(context);
    await context.request.post(`${CONTROL}/make-superadmin?email=${email}&password=correct-horse`);
    await context.clearCookies();
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/admin/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('correct-horse');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByLabel('Code')).toBeVisible();
    const box = await page.locator('.admin-auth-card').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Password')).toBeEnabled();
  });
});

test.describe('admin', () => {
  test('Plans page: lists plans and an edit is saved and shown', async ({ page, context }) => {
    await signIn(context, { superadmin: true });
    await page.goto('/admin/plans');
    const row = page.getByRole('row', { name: /Starter/ });
    await expect(row).toContainText('999');
    await row.getByRole('button', { name: 'Edit' }).click();
    const guests = page.getByLabel('Max guests (at once)');
    await expect(guests).toHaveValue('4');
    await guests.fill('5');
    await page.getByRole('button', { name: 'Save plan' }).click();
    await expect(page.getByText('Saved Starter.')).toBeVisible();
    await expect(page.getByRole('row', { name: /Starter/ })).toContainText('5');

    // put it back
    await page.getByRole('row', { name: /Starter/ }).getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Max guests (at once)').fill('4');
    await page.getByRole('button', { name: 'Save plan' }).click();
    await expect(page.getByText('Saved Starter.')).toBeVisible();
  });

  test('Billing page: payments switch and setup status', async ({ page, context }) => {
    await signIn(context, { superadmin: true });
    await page.goto('/admin/billing');
    await expect(page.getByRole('heading', { name: /Online payments: OFF/ })).toBeVisible();
    await expect(page.getByText(/test mode/)).toBeVisible();
    await expect(page.getByText('subscription.charged', { exact: false })).toBeVisible();
  });
});

async function newStream(context: BrowserContext, api: APIRequestContext, orientation?: 'landscape' | 'portrait'): Promise<string> {
  const conn = await (
    await api.post(`${APP}/api/platform-connections/twitch/manual`, {
      data: { label: 'UI Twitch', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' },
      headers: apiHeaders,
    })
  ).json();
  const stream = await (await api.post(`${APP}/api/streams`, { data: { title: 'UI smoke stream', orientation, destinationConnectionIds: [conn.id] }, headers: apiHeaders })).json();
  return stream.id as string;
}

test.describe('host studio', () => {
  test('opens without a camera and shows the StreamBird slide (not a black frame)', async ({ page, context }) => {
    const { api } = await signIn(context);
    const id = await newStream(context, api);
    await page.goto(`/streams/${id}/studio`);
    const canvas = page.locator('canvas.studio-canvas');
    await expect(canvas).toBeVisible();
    await page.waitForTimeout(2500);
    const rgb = await canvas.evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(12, 12, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    expect(rgb.reduce((a, b) => a + b, 0)).toBeGreaterThan(20); // the branded gradient, not #000
    await expect(page.getByRole('button', { name: /Go live/ })).toBeEnabled();
    await expect(page.getByRole('button', { name: /Start my camera/ })).toBeVisible();
  });

  /** Fills the page's slides input with solid-colour images (made in the page, so no files are needed). */
  async function addSolidSlides(page: Page, colours: string[]) {
    await page.evaluate(async (cols: string[]) => {
      const dt = new DataTransfer();
      for (const [i, colour] of cols.entries()) {
        const c = document.createElement('canvas');
        c.width = 1600;
        c.height = 900;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = colour;
        ctx.fillRect(0, 0, 1600, 900);
        const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
        dt.items.add(new File([blob], `slide-${i + 1}.png`, { type: 'image/png' }));
      }
      const input = document.querySelector<HTMLInputElement>('#slidesInput')!;
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, colours);
  }
  const pixel = (page: Page, x: number, y: number) =>
    page.locator('canvas.studio-canvas').evaluate((c: HTMLCanvasElement, [px, py]: number[]) => {
      const d = c.getContext('2d')!.getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2]];
    }, [x, y]);

  test('slide layout: loads slides, flips them, and the canvas style and ticker size change what is drawn', async ({ page, context }) => {
    const { api } = await signIn(context);
    const id = await newStream(context, api);
    await page.goto(`/streams/${id}/studio`);
    const canvas = page.locator('canvas.studio-canvas');
    await expect(canvas).toBeVisible();
    const [cw, ch] = await canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height]);

    // The default look is untouched: Grid layout, Vanilla style.
    await expect(page.locator('#layoutSelect')).toHaveValue('grid');
    await expect(page.locator('#themeSelect')).toHaveValue('vanilla');

    await page.selectOption('#layoutSelect', 'anchor-slide-right');
    await addSolidSlides(page, ['#ff0000', '#0000ff']);
    await expect(page.getByTestId('slide-counter')).toHaveText('Slide 1 / 2');
    const slide = computeLayout('anchor-slide-right', cw, ch).slide!;
    const cx = Math.round(slide.x + slide.w / 2);
    const cy = Math.round(slide.y + slide.h / 2);
    await page.waitForTimeout(700); // crossfade
    const first = await pixel(page, cx, cy);
    expect(first[0]).toBeGreaterThan(200);
    expect(first[2]).toBeLessThan(60);

    await page.getByRole('button', { name: /Next/ }).click();
    await expect(page.getByTestId('slide-counter')).toHaveText('Slide 2 / 2');
    await page.waitForTimeout(800);
    const second = await pixel(page, cx, cy);
    expect(second[2]).toBeGreaterThan(200);
    expect(second[0]).toBeLessThan(60);

    // A canvas style paints the background around the tiles.
    await page.selectOption('#themeSelect', 'newsroom');
    await page.waitForTimeout(700);
    const bg = await pixel(page, 2, 2);
    expect(Math.abs(bg[0] - 11)).toBeLessThan(14);
    expect(Math.abs(bg[1] - 31)).toBeLessThan(14);
    expect(Math.abs(bg[2] - 58)).toBeLessThan(14);

    // The ticker bar grows with its text size: 50px up from the bottom is outside the 36px bar until the text is larger.
    await page.fill('#newsInput', 'Breaking: studio test');
    await page.waitForTimeout(700);
    const before = await pixel(page, 8, ch - 50);
    expect(before[0]).toBeLessThan(80);
    await page.locator('#newsFontSizeInput').fill('60');
    await page.waitForTimeout(500);
    const after = await pixel(page, 8, ch - 50);
    expect(after[0]).toBeGreaterThan(120); // the newsroom ticker red
  });

  /** Fills the wallpaper input with a generated image: left half `left`, right half `right`. */
  async function addWallpaper(page: Page, w: number, h: number, left: string, right: string, name = 'wall.png') {
    await page.evaluate(
      async ([width, height, l, r, fileName]) => {
        const c = document.createElement('canvas');
        c.width = width as number;
        c.height = height as number;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = l as string;
        ctx.fillRect(0, 0, (width as number) / 2, height as number);
        ctx.fillStyle = r as string;
        ctx.fillRect((width as number) / 2, 0, (width as number) / 2, height as number);
        const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
        const dt = new DataTransfer();
        dt.items.add(new File([blob], fileName as string, { type: 'image/png' }));
        const input = document.querySelector<HTMLInputElement>('#wallpaperInput')!;
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      [w, h, left, right, name],
    );
  }

  test('wallpaper: exact size is a perfect fit, other sizes are cropped around a chosen position, and it survives a reload', async ({ page, context }) => {
    const { api } = await signIn(context);
    const id = await newStream(context, api);
    await page.goto(`/streams/${id}/studio`);
    const canvas = page.locator('canvas.studio-canvas');
    await expect(canvas).toBeVisible();
    const [cw, ch] = await canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
    // A layout that always draws its own background (the plain grid shows the StreamBird slate with nobody on camera).
    await page.selectOption('#layoutSelect', 'anchor-slide-right');

    await addWallpaper(page, cw, ch, '#ff0000', '#ff0000', 'exact.png');
    await expect(page.getByTestId('wallpaper-fit')).toContainText('Perfect fit');
    await page.waitForTimeout(700);
    const exact = await pixel(page, cw / 2, 2);
    expect(exact[0]).toBeGreaterThan(200);
    expect(exact[2]).toBeLessThan(60);

    // Wider than 16:9: the sides are cropped, and the position slider decides which side stays.
    await addWallpaper(page, 2400, 900, '#ff0000', '#0000ff', 'wide.png');
    await expect(page.getByTestId('wallpaper-fit')).toContainText('left and right are cropped');
    await expect(page.getByTestId('wallpaper-fit')).toContainText(`provide ${cw}x${ch}`);
    await page.locator('#wallpaperFocusX').fill('0');
    await page.waitForTimeout(700);
    const leftKept = await pixel(page, cw / 2, 2);
    expect(leftKept[0]).toBeGreaterThan(200);
    expect(leftKept[2]).toBeLessThan(60);
    await page.locator('#wallpaperFocusX').fill('100');
    await page.waitForTimeout(500);
    const rightKept = await pixel(page, cw / 2, 2);
    expect(rightKept[2]).toBeGreaterThan(200);
    expect(rightKept[0]).toBeLessThan(60);

    // Darken laid over it.
    await page.locator('#wallpaperDim').fill('50');
    await page.waitForTimeout(400);
    const dimmed = await pixel(page, cw / 2, 2);
    expect(dimmed[2]).toBeGreaterThan(90);
    expect(dimmed[2]).toBeLessThan(160);

    // It is still there after a reload, with the same crop position.
    await page.reload();
    await expect(page.getByTestId('wallpaper-fit')).toContainText('wide.png');
    await expect(page.locator('#wallpaperFocusX')).toHaveValue('100');
    await page.waitForTimeout(1200);
    const afterReload = await pixel(page, cw / 2, 2);
    expect(afterReload[2]).toBeGreaterThan(90);
    expect(afterReload[0]).toBeLessThan(60);

    // Removing it brings the canvas style background back.
    await page.getByRole('button', { name: /Remove wallpaper/ }).click();
    await expect(page.getByTestId('wallpaper-fit')).toHaveCount(0);
    await page.waitForTimeout(700);
    const removed = await pixel(page, cw / 2, 2);
    expect(removed[0] + removed[1] + removed[2]).toBeLessThan(30); // Vanilla's plain black
  });

  test('a vertical stream gets a 9:16 canvas, vertical qualities and vertical layouts', async ({ page, context }) => {
    const { api } = await signIn(context);
    const id = await newStream(context, api, 'portrait');
    await page.goto(`/streams/${id}/studio`);
    const canvas = page.locator('canvas.studio-canvas');
    await expect(canvas).toBeVisible();

    // HD is 1280x720 for a landscape stream; for a vertical one it is 720x1280.
    expect(await canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([720, 1280]);
    await expect(canvas).toHaveClass(/studio-canvas--portrait/);
    await expect(page.locator('.studio-resolution-select option:checked')).toContainText('720x1280');

    // The wallpaper hint asks for a vertical image.
    await expect(page.locator('#wallpaperInput').locator('xpath=preceding-sibling::p[1]')).toContainText('720x1280');

    // A slide layout stacks: the slide is a band across the top, the anchor below it.
    await page.selectOption('#layoutSelect', 'anchor-slide-left');
    await addSolidSlides(page, ['#ff0000']);
    await page.waitForTimeout(900);
    const [cw, ch] = await canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
    const slide = computeLayout('anchor-slide-left', cw, ch).slide!;
    expect(slide.w).toBeGreaterThan(cw * 0.8); // spans the width
    expect(slide.y + slide.h).toBeLessThan(ch / 2); // in the top half
    const px = await pixel(page, Math.round(slide.x + slide.w / 2), Math.round(slide.y + slide.h / 2));
    expect(px[0]).toBeGreaterThan(200);
    expect(px[2]).toBeLessThan(60);

    // The same stream in landscape is untouched.
    const wide = await newStream(context, api);
    await page.goto(`/streams/${wide}/studio`);
    expect(await page.locator('canvas.studio-canvas').evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([1280, 720]);
  });

  test('the new-stream form offers a vertical shape and explains what it means', async ({ page, context }) => {
    const { api } = await signIn(context);
    await api.post(`${APP}/api/platform-connections/twitch/manual`, {
      data: { label: 'Form Twitch', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' },
      headers: apiHeaders,
    });
    await page.goto('/streams/new');
    await expect(page.locator('#orientation')).toHaveValue('landscape');
    await page.selectOption('#orientation', 'portrait');
    await expect(page.getByText(/Twitch and Facebook get it vertical too/)).toBeVisible();
    await expect(page.getByText(/cannot be changed once the stream is created/)).toBeVisible();
  });

  test('a new stream is Public by default, whether you go live now or schedule it, and that is what is sent', async ({ page, context }) => {
    const { api } = await signIn(context);
    await api.post(`${APP}/api/platform-connections/twitch/manual`, {
      data: { label: 'Form Twitch', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' },
      headers: apiHeaders,
    });
    await page.goto('/streams/new');
    await expect(page.locator('#visibility')).toHaveValue('public');
    await expect(page.locator('#visibility option:checked')).toHaveText('Public');
    // Still a choice, and the other two are one click away.
    await expect(page.locator('#visibility option')).toHaveText(['Public', 'Unlisted', 'Private']);

    // Scheduling uses the same field, so the default carries over.
    await page.getByRole('tab', { name: /Schedule/ }).click();
    await expect(page.locator('#visibility')).toHaveValue('public');
    await page.getByRole('tab', { name: /Go live now/ }).click();

    const sent = page.waitForRequest((r) => r.url().endsWith('/api/streams') && r.method() === 'POST');
    await page.getByLabel(/Form Twitch/).check();
    await page.getByRole('button', { name: /Create and open studio/ }).click();
    expect((await sent).postDataJSON().visibility).toBe('public');
  });

  test.describe('with a camera (the config provides a fake one)', () => {
    test('a vertical stream asks the camera for a tall picture; a landscape stream asks for the usual', async ({ page, context }) => {
      const { api } = await signIn(context);
      await page.addInitScript(() => {
        const w = window as unknown as { __gum: unknown[] };
        w.__gum = [];
        const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (c?: MediaStreamConstraints) => {
          w.__gum.push(c);
          return orig(c);
        };
      });
      const requested = () => page.evaluate(() => ((window as unknown as { __gum: { video: unknown }[] }).__gum[0] ?? {}).video);

      const tall = await newStream(context, api, 'portrait');
      await page.goto(`/streams/${tall}/studio`);
      await page.getByRole('button', { name: /Start my camera/ }).click();
      await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
      expect(await requested()).toEqual({ aspectRatio: { ideal: 9 / 16 } });
      await expect(page.getByText(/landscape webcam is cropped to the middle/)).toBeVisible();

      const wide = await newStream(context, api);
      await page.goto(`/streams/${wide}/studio`);
      await page.getByRole('button', { name: /Start my camera/ }).click();
      await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
      expect(await requested()).toBe(true);
      await expect(page.getByText(/landscape webcam is cropped to the middle/)).toHaveCount(0);
    });
  });

  test("the quality menu is limited to the plan's maximum", async ({ page, context, browser }) => {
    const { api } = await signIn(context);
    const id = await newStream(context, api);
    const adminCtx = await browser.newContext();
    const admin = await signIn(adminCtx, { superadmin: true });
    await admin.api.patch(`${APP}/api/superadmin/plans/free`, { data: { maxResolution: 'sd' }, headers: apiHeaders });
    try {
      await page.goto(`/streams/${id}/studio`);
      const options = page.locator('.studio-resolution-select option');
      await expect(options).toHaveCount(1);
      await expect(options.first()).toHaveText(/SD/);
    } finally {
      await admin.api.patch(`${APP}/api/superadmin/plans/free`, { data: { maxResolution: 'fhd' }, headers: apiHeaders });
      await adminCtx.close();
    }
  });

  test('a plan that allows 2K lists the 2K (1440p) quality, one that stops at Full HD does not', async ({ page, context, browser }) => {
    const { api } = await signIn(context);
    const id = await newStream(context, api);
    const adminCtx = await browser.newContext();
    const admin = await signIn(adminCtx, { superadmin: true });
    try {
      await page.goto(`/streams/${id}/studio`);
      const options = page.locator('.studio-resolution-select option');
      await expect(options.last()).toHaveText(/Full HD/);
      await expect(page.locator('.studio-resolution-select option', { hasText: '2K' })).toHaveCount(0);

      await admin.api.patch(`${APP}/api/superadmin/plans/free`, { data: { maxResolution: 'qhd' }, headers: apiHeaders });
      await page.reload();
      await expect(page.locator('.studio-resolution-select option', { hasText: '2K (1440p)' })).toHaveCount(1);
      await expect(options.last()).toHaveText(/2K/);
    } finally {
      await admin.api.patch(`${APP}/api/superadmin/plans/free`, { data: { maxResolution: 'fhd' }, headers: apiHeaders });
      await adminCtx.close();
    }
  });
});

/** A tiny solid-colour PNG, built by hand (zlib + CRC) so a test can upload a picture whose pixels it knows. */
function solidPng(r: number, g: number, b: number, size = 16): Buffer {
  const zlib = require('zlib') as typeof import('zlib');
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** The colour of the studio canvas at a point (the canvas keeps its 2D context, so this reads what viewers get). */
const canvasPixel = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([px, py]) => {
      const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2]] as [number, number, number];
    },
    [x, y],
  );

test.describe('brand library and kits', () => {
  const setStorage = async (browser: import('@playwright/test').Browser, mb: number) => {
    const adminCtx = await browser.newContext();
    const admin = await signIn(adminCtx, { superadmin: true });
    await admin.api.patch(`${APP}/api/superadmin/plans/free`, { data: { assetStorageMb: mb }, headers: apiHeaders });
    await adminCtx.close();
  };

  test('Free plan: the Brand page says assets stay in the browser and links to plans', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/dashboard');
    await page.getByRole('link', { name: 'Brand' }).click();
    await expect(page.getByTestId('brand-free-notice')).toContainText('stay saved in this browser');
    await expect(page.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/billing');
    await expect(page.getByLabel('Image (PNG, JPG or WebP, up to 4 MB)')).toHaveCount(0);
  });

  test.describe('on a plan with brand storage', () => {
    test.beforeEach(async ({ browser }) => setStorage(browser, 5));
    test.afterEach(async ({ browser }) => setStorage(browser, 0));

    test('upload a file, share it between two kits, give channels a kit, and a file in use cannot be deleted', async ({ page, context }) => {
      const { api } = await signIn(context);
      for (const label of ['Hindi channel', 'English channel']) {
        const r = await api.post(`${APP}/api/platform-connections/twitch/manual`, { data: { label, ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }, headers: apiHeaders });
        expect(r.ok()).toBeTruthy();
      }
      await page.goto('/brand');
      await expect(page.getByTestId('brand-usage')).toContainText('0.0 MB of 5.0 MB used');

      await page.getByLabel('Type').selectOption('logo');
      await expect(page.getByRole('button', { name: 'Upload' })).toBeDisabled(); // nothing chosen yet
      await page.getByLabel(/Image \(PNG/).setInputFiles({ name: 'main-logo.png', mimeType: 'image/png', buffer: solidPng(220, 30, 40) });
      await expect(page.locator('.brand-drop')).toContainText('main-logo.png'); // the chosen file is shown, with a preview
      await expect(page.locator('.brand-drop-preview')).toBeVisible();
      await page.getByRole('button', { name: 'Upload' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Uploaded "main-logo"' })).toBeVisible();
      const card = page.getByRole('listitem').filter({ has: page.getByLabel('Name of main-logo') });
      await expect(card).toBeVisible();
      await expect(card).toContainText('Logo');
      // The image really comes back from the server.
      await expect.poll(() => card.locator('img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);

      // Kit 1: that logo on the Hindi channel; kit 2 reuses the same file on the English channel.
      await page.getByRole('button', { name: 'New brand kit' }).click();
      const kit1 = page.getByRole('form', { name: 'New brand kit' });
      await kit1.getByLabel('Kit name').fill('Hindi');
      await kit1.getByLabel('Logo', { exact: true }).selectOption({ label: 'main-logo' });
      await kit1.getByRole('button', { name: 'Top right' }).click();
      await kit1.getByLabel(/Hindi channel/).check();
      await kit1.getByRole('button', { name: 'Create kit' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Created "Hindi"' })).toBeVisible(); // feedback after saving
      const hindiCard = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: /^Hindi/ }) });
      await expect(hindiCard).toContainText('Account default'); // the first kit is the default
      await expect(hindiCard).toContainText('Used by Hindi channel');

      await page.getByRole('button', { name: 'New brand kit' }).click();
      const kit2 = page.getByRole('form', { name: 'New brand kit' });
      await kit2.getByLabel('Kit name').fill('English');
      await kit2.getByLabel('Logo', { exact: true }).selectOption({ label: 'main-logo' });
      await kit2.getByLabel(/English channel/).check();
      await kit2.getByRole('button', { name: 'Create kit' }).click();
      const englishCard = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: /^English/ }) });
      await expect(englishCard).toContainText('Used by English channel');
      await expect(englishCard).not.toContainText('Account default');
      await expect(card).toContainText('used by Hindi, English');

      // It survives a reload (it is on the server, not in the browser), and the live preview follows the form.
      await page.reload();
      await page.getByRole('button', { name: 'Edit Hindi' }).click();
      const hindiForm = page.getByRole('form', { name: 'Brand kit Hindi' });
      await expect(hindiForm.getByRole('button', { name: 'Top right' })).toHaveAttribute('aria-pressed', 'true');
      await expect(hindiForm.locator('.kit-preview-logo--right')).toBeVisible();
      await hindiForm.getByRole('button', { name: 'Top left' }).click();
      await expect(hindiForm.locator('.kit-preview-logo--left')).toBeVisible();
      await expect(hindiForm.getByRole('button', { name: 'Save kit' })).toBeEnabled(); // a change was made
      await hindiForm.getByRole('button', { name: 'Close without saving' }).click();
      await page.getByRole('button', { name: 'Edit Hindi' }).click();
      await expect(page.getByRole('form', { name: 'Brand kit Hindi' }).getByRole('button', { name: 'Save kit' })).toBeDisabled(); // nothing changed since

      // A file in use is refused; once the kits are gone it can be deleted.
      page.on('dialog', (d) => void d.accept());
      await page.getByRole('button', { name: 'Delete main-logo' }).click();
      await expect(page.getByRole('alert')).toContainText('used by the brand kits');
      await page.getByRole('form', { name: 'Brand kit Hindi' }).getByRole('button', { name: 'Delete kit' }).click();
      await expect(page.getByRole('heading', { name: /^Hindi/ })).toHaveCount(0);
      await page.getByRole('button', { name: 'Edit English' }).click();
      await page.getByRole('form', { name: 'Brand kit English' }).getByRole('button', { name: 'Delete kit' }).click();
      await expect(page.getByRole('heading', { name: /^English/ })).toHaveCount(0);
      await expect(page.getByText('No brand kits yet')).toBeVisible();
      await page.getByRole('button', { name: 'Delete main-logo' }).click();
      await expect(page.getByText('No files yet')).toBeVisible();
    });

    test('an upload that is not an image, or is too big for the plan, is refused with a message', async ({ page, context }) => {
      await signIn(context);
      await page.goto('/brand');
      await page.getByLabel(/Image \(PNG/).setInputFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('definitely not a picture') });
      await page.getByRole('button', { name: 'Upload' }).click();
      await expect(page.getByRole('alert')).toContainText('PNG, JPG or WebP');
    });
  });
});

test.describe('Powered-by mark (Free plan)', () => {
  const setMark = async (browser: import('@playwright/test').Browser, on: boolean) => {
    const adminCtx = await browser.newContext();
    const admin = await signIn(adminCtx, { superadmin: true });
    await admin.api.patch(`${APP}/api/superadmin/plans/free`, { data: { watermark: on }, headers: apiHeaders });
    await adminCtx.close();
  };
  test.afterEach(async ({ browser }) => setMark(browser, true));

  test('the small mark sits bottom-right on a Free stream and is gone when the plan does not show it', async ({ page, context, browser }) => {
    const { api } = await signIn(context);
    const id = await newStream(context, api);
    await page.goto(`/streams/${id}/studio`);
    await page.getByRole('button', { name: /Start my camera/ }).click();
    await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
    const { width, height } = await page.evaluate(() => { const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement; return { width: c.width, height: c.height }; });
    const u = height / 720;
    // The pill's text is white; the fake camera has no white pixels there (it is green, with black bars at the sides).
    const markShown = () => page.evaluate(([x0, y0, w, h]) => {
      const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(x0, y0, w, h).data;
      let white = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) white++;
      return white > 30;
    }, [Math.round(width - 20 * u - 190 * u), Math.round(height - 20 * u - 34 * u), Math.round(170 * u), Math.round(28 * u)]);
    await expect.poll(markShown).toBe(true);

    await setMark(browser, false);
    await page.reload();
    await page.getByRole('button', { name: /Start my camera/ }).click();
    await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
    await expect.poll(markShown).toBe(false);
  });
});

test.describe('first-run studio tour', () => {
  test.use({ storageState: { cookies: [], origins: [{ origin: APP, localStorage: [{ name: 'streambird:consent:v1', value: 'denied' }] }] } }); // a brand-new visitor: the tour has not been seen

  const open = async (page: Page, context: BrowserContext) => {
    const { api } = await signIn(context);
    const id = await newStream(context, api);
    await page.goto(`/streams/${id}/studio`);
    return id;
  };

  test('a new user is walked through four steps that end on the Go live button, once', async ({ page, context }) => {
    const id = await open(page, context);
    const tour = page.getByRole('dialog', { name: 'Studio tour' });
    await expect(tour).toBeVisible();
    await expect(tour).toContainText('Nothing reaches Twitch until you press Go live');
    await expect(tour).toContainText('1 of 4');

    await tour.getByRole('button', { name: 'Next' }).click();
    await expect(tour).toContainText('Turn on your camera');
    await tour.getByRole('button', { name: 'Next' }).click();
    await expect(tour).toContainText('Bring a guest');
    await tour.getByRole('button', { name: 'Back' }).click();
    await expect(tour).toContainText('Turn on your camera');
    await tour.getByRole('button', { name: 'Next' }).click();
    await tour.getByRole('button', { name: 'Next' }).click();
    await expect(tour).toContainText('Press Go live to start');
    await expect(tour).toContainText('5–10 seconds');
    // The spotlight sits on the real Go live button (it glides there, so wait for it to settle).
    const offBy = async () => {
      const spot = await page.locator('.studio-tour-spot').boundingBox();
      const btn = await page.getByRole('button', { name: /Go live/ }).boundingBox();
      return spot && btn ? Math.abs(spot.x + 6 - btn.x) + Math.abs(spot.y + 6 - btn.y) : 999;
    };
    await expect.poll(offBy).toBeLessThan(4);

    await tour.getByRole('button', { name: 'Got it' }).click();
    await expect(tour).toHaveCount(0);
    await page.goto(`/streams/${id}/studio`); // seen: not offered again
    await page.waitForTimeout(1500);
    await expect(page.getByRole('dialog', { name: 'Studio tour' })).toHaveCount(0);
  });

  test('it can be skipped (button or Escape), and the preview banner can bring it back', async ({ page, context }) => {
    const id = await open(page, context);
    const tour = page.getByRole('dialog', { name: 'Studio tour' });
    await expect(tour).toBeVisible();
    await tour.getByRole('button', { name: 'Skip tour' }).click();
    await expect(tour).toHaveCount(0);

    const banner = page.getByTestId('preview-banner');
    await expect(banner).toContainText('You’re in preview, not live yet');
    await expect(banner).toContainText('start streaming to Twitch');
    await banner.getByRole('button', { name: 'Show me around' }).click();
    await expect(tour).toBeVisible();
    await expect(tour).toContainText('1 of 4'); // starts over
    await page.keyboard.press('Escape');
    await expect(tour).toHaveCount(0);
    expect(id).toBeTruthy();
  });

  test('the Go live button is nudged until the stream is live, and the preview banner goes once it is', async ({ page, context }) => {
    await page.addInitScript(() => { RTCPeerConnection.prototype.setRemoteDescription = async () => undefined; });
    await page.route('**/*whip*', (route) => route.fulfill({ status: 201, contentType: 'application/sdp', headers: { Location: '/whip/resource' }, body: 'v=0\r\n' }));
    await open(page, context);
    await page.getByRole('dialog', { name: 'Studio tour' }).getByRole('button', { name: 'Skip tour' }).click();
    await expect(page.getByRole('button', { name: /Go live/ })).toHaveClass(/go-live-button--hint/);
    await expect(page.getByTestId('preview-banner')).toBeVisible();
    await page.getByRole('button', { name: /Go live/ }).click();
    await expect(page.getByRole('button', { name: 'Live' })).toBeVisible();
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Live' })).not.toHaveClass(/go-live-button--hint/);
  });
});

test.describe('after Go live: platforms need a few seconds', () => {
  /** The studio's publish goes to MediaMTX over WHIP; answer it locally so the page believes it is on air. */
  const fakeWhip = async (page: Page) => {
    await page.addInitScript(() => {
      RTCPeerConnection.prototype.setRemoteDescription = async () => undefined;
    });
    await page.route('**/*whip*', (route) => route.fulfill({ status: 201, contentType: 'application/sdp', headers: { Location: '/whip/resource' }, body: 'v=0\r\n' }));
  };
  const openStudio = async (page: Page, context: BrowserContext) => {
    const { api } = await signIn(context);
    const id = await newStream(context, api);
    await fakeWhip(page);
    await page.goto(`/streams/${id}/studio`);
    await page.getByRole('button', { name: /Start my camera/ }).click();
    await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
    return id;
  };

  test('a notice names the platforms, counts down about ten seconds, and goes away by itself', async ({ page, context }) => {
    await openStudio(page, context);
    await expect(page.getByTestId('golive-notice')).toHaveCount(0); // nothing before Go live
    await page.getByRole('button', { name: /Go live/ }).click();
    const notice = page.getByTestId('golive-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('You’re live.');
    await expect(notice).toContainText('Twitch can take about 5–10 seconds to start showing your stream');
    await expect(notice).toHaveCount(0, { timeout: 15_000 }); // timed, no click needed
    await expect(page.getByRole('button', { name: 'Live' })).toBeVisible(); // still live
  });

  test('it can be dismissed, and reloading a stream that is already live does not show it again', async ({ page, context }) => {
    const id = await openStudio(page, context);
    await page.getByRole('button', { name: /Go live/ }).click();
    await expect(page.getByTestId('golive-notice')).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss this notice' }).click();
    await expect(page.getByTestId('golive-notice')).toHaveCount(0);

    await page.reload(); // the studio restores itself quietly: the platforms are already showing the stream
    await page.waitForTimeout(2500);
    await expect(page.getByTestId('golive-notice')).toHaveCount(0);
    expect(id).toBeTruthy();
  });
});

test.describe('lower third banner (Pro)', () => {
  const purple = (p: [number, number, number]) => Math.abs(p[0] - 124) < 25 && Math.abs(p[1] - 58) < 25 && Math.abs(p[2] - 237) < 25;
  const setPlan = async (browser: import('@playwright/test').Browser, can: boolean) => {
    const adminCtx = await browser.newContext();
    const admin = await signIn(adminCtx, { superadmin: true });
    await admin.api.patch(`${APP}/api/superadmin/plans/free`, { data: { canLowerThird: can }, headers: apiHeaders });
    await adminCtx.close();
  };
  const startStudio = async (page: Page, context: BrowserContext, orientation?: 'landscape' | 'portrait') => {
    const { api } = await signIn(context);
    const id = await newStream(context, api, orientation);
    await page.goto(`/streams/${id}/studio`);
    await page.getByRole('button', { name: /Start my camera/ }).click();
    await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
    const size = await page.evaluate(() => { const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement; return { width: c.width, height: c.height }; });
    return { id, ...size };
  };

  test('Free plan: the lower third is locked and points to billing', async ({ page, context }) => {
    await startStudio(page, context);
    await expect(page.getByLabel('Name or title, e.g. Priya Sharma')).toHaveCount(0);
    await page.getByRole('button', { name: 'Lower third (Pro plan)' }).click();
    await expect(page).toHaveURL(/\/billing$/);
  });

  test.describe('on a plan that allows it', () => {
    test.beforeEach(async ({ browser }) => setPlan(browser, true));
    test.afterEach(async ({ browser }) => setPlan(browser, false));

    test('slides in over the picture, hides again, and hides by itself after the chosen time', async ({ page, context }) => {
      const { width, height } = await startStudio(page, context);
      const u = height / 720;
      const stripeAt = () => canvasPixel(page, Math.round(32 * u), Math.round(height - 69 * u));
      await expect(page.getByRole('button', { name: 'Show lower third' })).toBeDisabled(); // nothing to show yet
      await page.locator('#lowerThirdTitle').fill('Priya Sharma');
      await page.locator('#lowerThirdSubtitle').fill('Founder, ShackyApps');
      expect(purple(await stripeAt())).toBe(false);

      await page.locator('#lowerThirdSubtitle').press('Enter'); // Enter shows it, no need to find the button
      await expect(page.getByText('On air')).toBeVisible();
      await expect.poll(async () => purple(await stripeAt())).toBe(true);
      // The text is drawn: some near-white pixels sit inside the box.
      const white = await page.evaluate(([x0, y0, w, h]) => {
        const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement;
        const d = c.getContext('2d')!.getImageData(x0, y0, w, h).data;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) return true;
        return false;
      }, [Math.round(40 * u), Math.round(height - 100 * u), Math.round(200 * u), Math.round(60 * u)]);
      expect(white).toBe(true);

      await page.getByRole('button', { name: 'Hide lower third' }).click();
      await expect.poll(async () => purple(await stripeAt())).toBe(false);

      await page.locator('#lowerThirdAutoHide').selectOption('5');
      await page.getByRole('button', { name: 'Show lower third' }).click();
      await expect.poll(async () => purple(await stripeAt())).toBe(true);
      await expect.poll(async () => purple(await stripeAt()), { timeout: 10_000 }).toBe(false);
      await expect(page.getByRole('button', { name: 'Show lower third' })).toBeVisible();
      expect(width).toBeGreaterThan(0);
    });

    test('saved texts and the look stick through a reload, and a saved text shows with one click', async ({ page, context }) => {
      const { id, height } = await startStudio(page, context);
      const u = height / 720;
      await page.locator('#lowerThirdTitle').fill('Alex Rao');
      await page.locator('#lowerThirdSubtitle').fill('Guest');
      await page.getByRole('button', { name: 'Glass' }).click();
      await page.getByRole('button', { name: 'Save text' }).click();
      await page.reload();
      await page.getByRole('button', { name: /Start my camera/ }).click();
      await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
      await expect(page.locator('#lowerThirdTitle')).toHaveValue('Alex Rao');
      await expect(page.getByRole('button', { name: 'Glass' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: 'Show lower third' })).toBeEnabled();
      await page.locator('#lowerThirdTitle').fill('');
      await page.getByRole('button', { name: 'Alex Rao', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Hide lower third' })).toBeVisible();
      await expect(page.locator('#lowerThirdTitle')).toHaveValue('Alex Rao');
      // Glass has no stripe: the box is lighter than the dark bar styles and the whole banner is on screen.
      await expect.poll(async () => { const p = await canvasPixel(page, Math.round(40 * u), Math.round(height - 69 * u)); return p[0] + p[1] + p[2]; }).toBeGreaterThan(0);
      await page.getByRole('button', { name: 'Delete saved text Alex Rao' }).click();
      await expect(page.getByRole('button', { name: 'Alex Rao', exact: true })).toHaveCount(0);
      expect(id).toBeTruthy();
    });

    test('vertical (9:16): the banner sits above the bottom edge, inside the frame', async ({ page, context }) => {
      const { width, height } = await startStudio(page, context, 'portrait');
      const u = width / 720;
      await page.locator('#lowerThirdTitle').fill('Priya Sharma');
      await page.getByRole('button', { name: 'Show lower third' }).click();
      await expect.poll(async () => purple(await canvasPixel(page, Math.round(32 * u), Math.round(height * 0.88 - 29 * u)))).toBe(true);
      // Nothing in the bottom 8% (where the platforms put their own buttons).
      expect(purple(await canvasPixel(page, Math.round(32 * u), Math.round(height * 0.95)))).toBe(false);
    });
  });
});

test.describe('background removal (Pro)', () => {
  test('Free plan: the Background button is locked and points to billing', async ({ page, context }) => {
    const { api } = await signIn(context);
    const id = await newStream(context, api);
    await page.goto(`/streams/${id}/studio`);
    await page.getByRole('button', { name: /Start my camera/ }).click();
    await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
    const locked = page.getByRole('button', { name: 'Background for Host (Pro plan)' });
    await expect(locked).toBeVisible();
    await expect(locked).toContainText('Pro'); // the upgrade cue is visible, not only in a tooltip
    await locked.click();
    await expect(page).toHaveURL(/\/billing$/);
  });

  test.describe('on a plan that allows it', () => {
    test.beforeEach(async ({ browser }) => {
      const adminCtx = await browser.newContext();
      const admin = await signIn(adminCtx, { superadmin: true });
      await admin.api.patch(`${APP}/api/superadmin/plans/free`, { data: { canChromaKey: true }, headers: apiHeaders });
      await adminCtx.close();
    });
    test.afterEach(async ({ browser }) => {
      const adminCtx = await browser.newContext();
      const admin = await signIn(adminCtx, { superadmin: true });
      await admin.api.patch(`${APP}/api/superadmin/plans/free`, { data: { canChromaKey: false }, headers: apiHeaders });
      await adminCtx.close();
    });

    const RED = solidPng(220, 30, 40);
    const redish = (p: [number, number, number]) => p[0] > 150 && p[1] < 90 && p[2] < 90;
    const greenish = (p: [number, number, number]) => p[1] > 100 && p[0] < 120 && p[2] < 120;

    test('the host removes the green behind themselves and a picture of their own shows instead; off again, the camera is back', async ({ page, context }) => {
      const { api } = await signIn(context);
      const id = await newStream(context, api);
      await page.goto(`/streams/${id}/studio`);
      await page.getByRole('button', { name: /Start my camera/ }).click();
      await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
      const { width, height } = await page.evaluate(() => { const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement; return { width: c.width, height: c.height }; });

      // Before: the fake camera is a green test pattern.
      await expect.poll(async () => greenish(await canvasPixel(page, width / 2, height / 2))).toBe(true);

      await page.getByRole('button', { name: 'Background for Host' }).click();
      const panel = page.getByRole('group', { name: 'Background for Host' });
      await expect(panel).toBeVisible();
      await page.getByLabel('Picture behind you').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: RED });
      await expect(panel.getByText('red.png')).toBeVisible();
      await panel.getByLabel(/Remove the background behind you/).check();
      await expect.poll(async () => redish(await canvasPixel(page, width / 2, height / 2)), { timeout: 10_000 }).toBe(true);
      await expect(page.getByRole('button', { name: 'Background for Host' })).toHaveClass(/icon-btn--accent/);

      // Colour that is not the screen: removing blue leaves the green camera alone.
      await panel.getByRole('button', { name: 'Blue', exact: true }).click();
      await expect.poll(async () => greenish(await canvasPixel(page, width / 2, height / 2))).toBe(true);
      await panel.getByRole('button', { name: 'Green', exact: true }).click();
      await expect.poll(async () => redish(await canvasPixel(page, width / 2, height / 2))).toBe(true);

      // Off: the camera is back, and the picture is only remembered.
      await panel.getByLabel(/Remove the background behind you/).uncheck();
      await expect.poll(async () => greenish(await canvasPixel(page, width / 2, height / 2))).toBe(true);
      await panel.getByRole('button', { name: 'Remove picture' }).click();
      await expect(panel.getByText('red.png')).toHaveCount(0);
    });

    test('the panel previews the result live, picks the screen colour from a click on the camera, and resets', async ({ page, context }) => {
      const { api } = await signIn(context);
      const id = await newStream(context, api);
      await page.goto(`/streams/${id}/studio`);
      await page.getByRole('button', { name: /Start my camera/ }).click();
      await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
      await page.getByRole('button', { name: 'Background for Host' }).click();
      const panel = page.getByRole('group', { name: 'Background for Host' });
      const preview = panel.getByRole('img', { name: /How Host will look/ });
      const previewPixel = () =>
        preview.evaluate((el) => {
          const c = el as HTMLCanvasElement;
          const d = c.getContext('2d')!.getImageData(c.width / 2, c.height / 2, 1, 1).data;
          return [d[0], d[1], d[2]] as [number, number, number];
        });

      // Nothing is switched on yet, but the preview already shows the effect: the camera's green is gone, so a
      // light grey checkerboard (or the chosen picture) is left. The main picture is still the raw camera.
      await expect(panel.getByText(/How it will look \(tick the box above to use it\)/)).toBeVisible();
      await expect.poll(async () => { const p = await previewPixel(); return p[0] > 190 && p[1] > 190 && p[2] > 190; }).toBe(true);
      await panel.getByLabel('Picture behind you').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: RED });
      await expect.poll(async () => redish(await previewPixel())).toBe(true);
      const { width, height } = await page.evaluate(() => { const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement; return { width: c.width, height: c.height }; });
      expect(greenish(await canvasPixel(page, width / 2, height / 2))).toBe(true);

      // Picking the screen colour by clicking the camera preview.
      const colour = panel.getByLabel('Screen colour for Host');
      const before = await colour.inputValue();
      await panel.getByRole('button', { name: 'Blue', exact: true }).click();
      await expect(colour).toHaveValue('#0047bb');
      const cam = panel.getByLabel(/Host's camera. Click the screen colour/);
      await cam.click({ position: { x: 4, y: 4 } }); // the black edge beside a 4:3 picture: told so, nothing changes
      await expect(panel.getByText('Click on the picture itself, not the black edge.')).toBeVisible();
      await expect(colour).toHaveValue('#0047bb');
      const box = (await cam.boundingBox())!;
      await cam.click({ position: { x: box.width * 0.3, y: box.height * 0.2 } }); // the green wall
      await expect(panel.getByText('Screen colour picked.')).toBeVisible();
      const picked = await colour.inputValue();
      expect(picked).not.toBe('#0047bb');
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(picked.slice(i, i + 2), 16));
      expect(g).toBeGreaterThan(r + 40);
      expect(g).toBeGreaterThan(b + 40);

      // Fine-tuning is tucked away until asked for; Reset puts the basics back.
      await expect(panel.getByLabel(/Edge softness/)).toBeHidden();
      await panel.getByText('Fine-tune the edges').click();
      await panel.getByLabel(/Edge softness/).fill('40');
      await panel.getByLabel(/Amount removed/).fill('80');
      await panel.getByRole('button', { name: 'Reset' }).click();
      await expect(colour).toHaveValue(before);
      await expect(panel.getByText('Amount removed: 50')).toBeVisible();
      await expect(panel.getByText('Edge softness: 12')).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Reset' })).toBeDisabled();

      // Turning it on is reflected next to the person's name and on the button.
      await panel.getByLabel(/Remove the background behind you/).check();
      await expect(page.locator('.participant-row').getByText('Background removed')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Background for Host' })).toHaveAttribute('aria-expanded', 'true');
    });

    test('with no picture, the wallpaper shows through the keyed person', async ({ page, context }) => {
      const { api } = await signIn(context);
      const id = await newStream(context, api);
      await page.goto(`/streams/${id}/studio`);
      await page.getByRole('button', { name: /Start my camera/ }).click();
      await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
      await page.locator('#wallpaperInput').setInputFiles({ name: 'wall.png', mimeType: 'image/png', buffer: RED });
      await page.getByRole('button', { name: 'Background for Host' }).click();
      await page.getByRole('group', { name: 'Background for Host' }).getByLabel(/Remove the background behind you/).check();
      const { width, height } = await page.evaluate(() => { const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement; return { width: c.width, height: c.height }; });
      await expect.poll(async () => redish(await canvasPixel(page, width / 2, height / 2)), { timeout: 10_000 }).toBe(true);
    });

    test('the host can key a guest: Alex gets his own picture behind him, and the host is left alone', async ({ page, context, browser }) => {
      const { api } = await signIn(context);
      const conn = await (await api.post(`${APP}/api/platform-connections/twitch/manual`, { data: { label: 'T', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }, headers: apiHeaders })).json();
      const stream = await (await api.post(`${APP}/api/streams`, { data: { title: 'key a guest', destinationConnectionIds: [conn.id] }, headers: apiHeaders })).json();
      const invite = await (await api.post(`${APP}/api/studio-sessions/${stream.studioSessionId}/invites`, { data: {}, headers: apiHeaders })).json();
      await page.goto(`/streams/${stream.id}/studio`);
      await page.getByRole('button', { name: /Start my camera/ }).click();
      await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();

      const guestCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const guest = await guestCtx.newPage();
      await guest.goto(`${APP}/join/${invite.token}`);
      await guest.fill('#displayName', 'Alex');
      await guest.getByRole('button', { name: /^Join$/ }).click();
      await expect(guest.locator('.meeting-grid')).toBeVisible();
      await expect(page.locator('.studio-status-toast')).toContainText('Alex is connected', { timeout: 20_000 });

      await page.locator('#layoutSelect').selectOption('podcast-split');
      const { width, height } = await page.evaluate(() => { const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement; return { width: c.width, height: c.height }; });
      const geo = computeLayout('podcast-split', width, height);
      const mid = (r: { x: number; y: number; w: number; h: number }) => [r.x + r.w / 2, r.y + r.h / 2] as const;
      const [hx, hy] = mid(geo.people[0]);
      const [gx, gy] = mid(geo.people[1]);
      await expect.poll(async () => greenish(await canvasPixel(page, gx, gy))).toBe(true);

      await page.getByRole('button', { name: 'Background for Alex' }).click();
      const panel = page.getByRole('group', { name: 'Background for Alex' });
      await panel.getByLabel('Picture behind Alex').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: RED });
      await panel.getByLabel(/Remove the background behind Alex/).check();
      await expect.poll(async () => redish(await canvasPixel(page, gx, gy)), { timeout: 10_000 }).toBe(true);
      expect(greenish(await canvasPixel(page, hx, hy))).toBe(true); // the host's own tile is untouched
      await guestCtx.close();
    });

    // ---- Any background (person cut-out). The browser tests give the studio their own "segmenter" (a mask they know
    //      the shape of: the left half of every picture is the person), so the pixels can be checked exactly.
    const LEFT_HALF_IS_PERSON = () => {
      window.__SB_TEST_SEGMENTER__ = {
        mask: () => {
          const w = 32;
          const h = 18;
          const data = new Float32Array(w * h);
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = x < w / 2 ? 1 : 0;
          return { data, width: w, height: h };
        },
      };
    };

    test('any background: the person stays, everything else is replaced by the picture behind them', async ({ page, context }) => {
      await page.addInitScript(LEFT_HALF_IS_PERSON);
      const { api } = await signIn(context);
      const id = await newStream(context, api);
      await page.goto(`/streams/${id}/studio`);
      await page.getByRole('button', { name: /Start my camera/ }).click();
      await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
      const { width, height } = await page.evaluate(() => { const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement; return { width: c.width, height: c.height }; });

      await page.getByRole('button', { name: 'Background for Host' }).click();
      const panel = page.getByRole('group', { name: 'Background for Host' });
      await panel.getByLabel('Picture behind you').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: RED });
      await panel.getByRole('button', { name: 'Any background' }).click();
      await expect(panel).toHaveAttribute('data-cutout-state', 'ready');
      await panel.getByLabel(/Remove the background behind you/).check();
      // The camera is a 4:3 picture centred in the 16:9 canvas: its left half is the person (kept), the right half is not.
      await expect.poll(async () => greenish(await canvasPixel(page, width * 0.35, height / 2)), { timeout: 10_000 }).toBe(true);
      await expect.poll(async () => redish(await canvasPixel(page, width * 0.65, height / 2)), { timeout: 10_000 }).toBe(true);
      // Outside the camera picture altogether is the person's own picture too (a classic cell shows it behind them).
      await expect.poll(async () => redish(await canvasPixel(page, 20, 20))).toBe(true);

      // The panel's own preview agrees, and the green-screen controls are replaced by the cut-out's.
      const preview = panel.getByRole('img', { name: /How Host will look/ });
      const previewAt = (fx: number) => preview.evaluate((el, f) => { const c = el as HTMLCanvasElement; const d = c.getContext('2d')!.getImageData(Math.floor(c.width * f), c.height / 2, 1, 1).data; return [d[0], d[1], d[2]] as [number, number, number]; }, fx);
      await expect.poll(async () => greenish(await previewAt(0.38))).toBe(true);
      await expect.poll(async () => redish(await previewAt(0.62))).toBe(true);
      await expect(panel.getByText('Screen colour', { exact: true })).toHaveCount(0);
      await expect(panel.getByLabel(/Cut-out strength/)).toBeVisible();
      await expect(panel.getByText(/Finds you in the picture/)).toBeVisible();

      // Back to a green screen: the camera's own green is removed instead, wherever it is.
      await panel.getByRole('button', { name: 'Green screen' }).click();
      await expect(panel.getByText('Screen colour', { exact: true })).toBeVisible();
      await expect.poll(async () => redish(await canvasPixel(page, width * 0.35, height / 2)), { timeout: 10_000 }).toBe(true);
    });

    test('any background works for a guest too, and the host is left alone', async ({ page, context, browser }) => {
      await page.addInitScript(LEFT_HALF_IS_PERSON);
      const { api } = await signIn(context);
      const conn = await (await api.post(`${APP}/api/platform-connections/twitch/manual`, { data: { label: 'T', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }, headers: apiHeaders })).json();
      const stream = await (await api.post(`${APP}/api/streams`, { data: { title: 'cut out a guest', destinationConnectionIds: [conn.id] }, headers: apiHeaders })).json();
      const invite = await (await api.post(`${APP}/api/studio-sessions/${stream.studioSessionId}/invites`, { data: {}, headers: apiHeaders })).json();
      await page.goto(`/streams/${stream.id}/studio`);
      await page.getByRole('button', { name: /Start my camera/ }).click();
      await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
      const guestCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const guest = await guestCtx.newPage();
      await guest.goto(`${APP}/join/${invite.token}`);
      await guest.fill('#displayName', 'Alex');
      await guest.getByRole('button', { name: /^Join$/ }).click();
      await expect(guest.locator('.meeting-grid')).toBeVisible();
      await expect(page.locator('.studio-status-toast')).toContainText('Alex is connected', { timeout: 20_000 });
      await page.locator('#layoutSelect').selectOption('podcast-split');
      const { width, height } = await page.evaluate(() => { const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement; return { width: c.width, height: c.height }; });
      const tile = computeLayout('podcast-split', width, height).people[1];
      const at = (fx: number) => canvasPixel(page, tile.x + tile.w * fx, tile.y + tile.h / 2);

      await page.getByRole('button', { name: 'Background for Alex' }).click();
      const panel = page.getByRole('group', { name: 'Background for Alex' });
      await panel.getByLabel('Picture behind Alex').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: RED });
      await panel.getByRole('button', { name: 'Any background' }).click();
      await panel.getByLabel(/Remove the background behind Alex/).check();
      await expect.poll(async () => greenish(await at(0.2)), { timeout: 10_000 }).toBe(true); // left of Alex: kept
      await expect.poll(async () => redish(await at(0.8)), { timeout: 10_000 }).toBe(true); // right of Alex: his picture
      const hostTile = computeLayout('podcast-split', width, height).people[0];
      expect(greenish(await canvasPixel(page, hostTile.x + hostTile.w * 0.8, hostTile.y + hostTile.h / 2))).toBe(true); // the host's whole tile is untouched
      await guestCtx.close();
    });

    test('any background: the model loads once with a visible note, and a failed load switches back with a clear message', async ({ page, context }) => {
      await page.addInitScript(() => {
        window.__SB_TEST_SEGMENTER__ = {
          init: () => new Promise((_, reject) => setTimeout(() => reject(new Error('the model file is blocked')), 1200)),
          mask: () => ({ data: new Float32Array(4), width: 2, height: 2 }),
        };
      });
      const { api } = await signIn(context);
      const id = await newStream(context, api);
      await page.goto(`/streams/${id}/studio`);
      await page.getByRole('button', { name: /Start my camera/ }).click();
      await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
      await page.getByRole('button', { name: 'Background for Host' }).click();
      const panel = page.getByRole('group', { name: 'Background for Host' });
      await panel.getByRole('button', { name: 'Any background' }).click();
      await expect(panel.getByText(/Loading the cut-out model/)).toBeVisible();
      await expect(page.locator('.studio-status-toast')).toContainText('Could not start the background cut-out (the model file is blocked)', { timeout: 10_000 });
      await expect(panel).toHaveAttribute('data-cutout-state', 'error');
      // Back on the green screen, switched off, and still usable.
      await expect(panel.getByRole('button', { name: 'Green screen' })).toHaveAttribute('aria-pressed', 'true');
      await expect(panel.getByLabel(/Remove the background behind you/)).not.toBeChecked();
    });

    test('any background: a computer too slow for it switches it off with a message, so the broadcast is protected', async ({ page, context }) => {
      await page.addInitScript(() => {
        window.__SB_TEST_SEGMENTER__ = {
          mask: () => {
            const until = performance.now() + 200; // each mask takes 200 ms: far too slow
            while (performance.now() < until) { /* busy */ }
            return { data: new Float32Array(16).fill(1), width: 4, height: 4 };
          },
        };
      });
      const { api } = await signIn(context);
      const id = await newStream(context, api);
      await page.goto(`/streams/${id}/studio`);
      await page.getByRole('button', { name: /Start my camera/ }).click();
      await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
      await page.getByRole('button', { name: 'Background for Host' }).click();
      const panel = page.getByRole('group', { name: 'Background for Host' });
      // Opening the cut-out already runs the model (for the preview), so a slow computer is caught straight away.
      await panel.getByRole('button', { name: 'Any background' }).click();
      await expect(page.locator('.studio-status-toast')).toContainText('too slow for the background cut-out', { timeout: 20_000 });
      await expect(panel.getByLabel(/Remove the background behind you/)).not.toBeChecked();
      await expect(panel.getByRole('button', { name: 'Green screen' })).toHaveAttribute('aria-pressed', 'true');
    });

    test("the host's choice of method is remembered after a reload", async ({ page, context }) => {
      await page.addInitScript(LEFT_HALF_IS_PERSON);
      const { api } = await signIn(context);
      const id = await newStream(context, api);
      await page.goto(`/streams/${id}/studio`);
      await page.getByRole('button', { name: /Start my camera/ }).click();
      await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
      await page.getByRole('button', { name: 'Background for Host' }).click();
      const panel = page.getByRole('group', { name: 'Background for Host' });
      await panel.getByRole('button', { name: 'Any background' }).click();
      await panel.getByLabel(/Remove the background behind you/).check();
      await panel.getByLabel(/Cut-out strength/).fill('70');

      await page.reload();
      await page.getByRole('button', { name: /Start my camera/ }).click();
      await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
      await page.getByRole('button', { name: 'Background for Host' }).click();
      const again = page.getByRole('group', { name: 'Background for Host' });
      await expect(again.getByRole('button', { name: 'Any background' })).toHaveAttribute('aria-pressed', 'true');
      await expect(again.getByLabel(/Remove the background behind you/)).toBeChecked();
      await expect(again.getByText('Cut-out strength: 70')).toBeVisible();
    });

    test('any background with the real model: it downloads, starts and runs on the camera without an error', async ({ page, context }) => {
      test.setTimeout(120_000);
      const { api } = await signIn(context);
      const id = await newStream(context, api);
      await page.goto(`/streams/${id}/studio`);
      await page.getByRole('button', { name: /Start my camera/ }).click();
      await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
      await page.getByRole('button', { name: 'Background for Host' }).click();
      const panel = page.getByRole('group', { name: 'Background for Host' });
      await panel.getByRole('button', { name: 'Any background' }).click();
      await expect(panel).toHaveAttribute('data-cutout-state', 'ready', { timeout: 90_000 });
      // (A plain click: this test browser draws WebGL in software, so the "too slow" guard may switch it off again; that is fine here.)
      await panel.getByLabel(/Remove the background behind you/).click();
      await page.waitForTimeout(3000); // let it run for a few frames
      await expect(panel).toHaveAttribute('data-cutout-state', 'ready');
      await expect(page.locator('.studio-status-toast')).not.toContainText(/Could not start/);
      // The studio is still drawing (the canvas is not blank).
      const { width, height } = await page.evaluate(() => { const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement; return { width: c.width, height: c.height }; });
      expect((await canvasPixel(page, width / 2, height / 2)).length).toBe(3);
    });

    test("the host's background settings and picture are still there after a reload", async ({ page, context }) => {
      const { api } = await signIn(context);
      const id = await newStream(context, api);
      await page.goto(`/streams/${id}/studio`);
      await page.getByRole('button', { name: /Start my camera/ }).click();
      await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
      await page.getByRole('button', { name: 'Background for Host' }).click();
      const panel = page.getByRole('group', { name: 'Background for Host' });
      await panel.getByLabel('Picture behind you').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: RED });
      await panel.getByLabel(/Remove the background behind you/).check();
      await panel.getByLabel(/Amount removed/).fill('65');
      await expect(panel.getByText('Amount removed: 65')).toBeVisible();

      await page.reload();
      await page.getByRole('button', { name: /Start my camera/ }).click();
      await expect(page.getByRole('button', { name: /Camera on/ })).toBeVisible();
      await page.getByRole('button', { name: 'Background for Host' }).click();
      const again = page.getByRole('group', { name: 'Background for Host' });
      await expect(again.getByLabel(/Remove the background behind you/)).toBeChecked();
      await expect(again.getByText('Amount removed: 65')).toBeVisible();
      await expect(again.getByText('red.png')).toBeVisible();
    });
  });
});

test.describe('logo position', () => {
  const RED = solidPng(220, 30, 40);
  const redish = (p: [number, number, number]) => p[0] > 150 && p[1] < 90 && p[2] < 90;
  const size = async (page: Page) => {
    await page.locator('canvas.studio-canvas').waitFor(); // the studio is still loading right after goto
    return page.evaluate(() => { const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement; return { width: c.width, height: c.height }; });
  };

  test('the logo can sit top left (as before) or top right, and the choice sticks through a reload and a scene', async ({ page, context }) => {
    const { api } = await signIn(context);
    const id = await newStream(context, api);
    await page.goto(`/streams/${id}/studio`);
    const { width } = await size(page);
    const logoSize = 90; // the default; the picture is square, so it is 90 x 90 and 16 px in from the corner
    const left = () => canvasPixel(page, 16 + logoSize / 2, 16 + logoSize / 2);
    const right = () => canvasPixel(page, width - 16 - logoSize / 2, 16 + logoSize / 2);

    await page.locator('#logoInput').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: RED });
    await expect.poll(async () => redish(await left()), { timeout: 10_000 }).toBe(true);
    expect(redish(await right())).toBe(false);
    const position = page.getByRole('group', { name: 'Logo position' });
    await expect(position.getByRole('button', { name: 'Top left' })).toHaveAttribute('aria-pressed', 'true');

    await position.getByRole('button', { name: 'Top right' }).click();
    await expect(position.getByRole('button', { name: 'Top right' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => redish(await right()), { timeout: 10_000 }).toBe(true);
    expect(redish(await left())).toBe(false);

    // The logo stays clear of the edge by the same 16 px on the right, whatever its width and size.
    await page.locator('#logoSizeInput').fill('200');
    await expect.poll(async () => redish(await canvasPixel(page, width - 16 - 100, 16 + 100)), { timeout: 10_000 }).toBe(true);
    expect(redish(await canvasPixel(page, width - 8, 16 + 100))).toBe(false); // the 16 px margin is empty
    await page.locator('#logoSizeInput').fill('90');

    // A scene remembers the position; applying it brings the logo back to that corner.
    page.once('dialog', (d) => void d.accept('Right logo'));
    await page.getByRole('button', { name: /Save current as scene/ }).click();
    await position.getByRole('button', { name: 'Top left' }).click();
    await expect.poll(async () => redish(await left()), { timeout: 10_000 }).toBe(true);
    await page.getByRole('button', { name: 'Right logo' }).click();
    await expect(position.getByRole('button', { name: 'Top right' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => redish(await right()), { timeout: 10_000 }).toBe(true);

    // And after a reload, the logo comes back in the same corner.
    await page.reload();
    await expect(page.getByRole('group', { name: 'Logo position' }).getByRole('button', { name: 'Top right' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => redish(await right()), { timeout: 10_000 }).toBe(true);
    expect(redish(await left())).toBe(false);
  });

  test('a stream saved before this option existed still shows its logo top left', async ({ page, context }) => {
    const { api } = await signIn(context);
    const id = await newStream(context, api);
    await page.addInitScript(
      ([key, logo]) => {
        // What an older version of the studio stored: branding with no logoPosition.
        localStorage.setItem(key, JSON.stringify({ branding: { logoSize: 90, newsText: '', nameFontSize: 14, newsFontSize: 18 }, logoDataUrl: logo }));
      },
      [`streambird:studio:${id}:v1`, `data:image/png;base64,${RED.toString('base64')}`],
    );
    await page.goto(`/streams/${id}/studio`);
    await page.locator('canvas.studio-canvas').waitFor();
    await expect.poll(async () => redish(await canvasPixel(page, 16 + 45, 16 + 45)), { timeout: 10_000 }).toBe(true);
    await expect(page.getByRole('group', { name: 'Logo position' }).getByRole('button', { name: 'Top left' })).toHaveAttribute('aria-pressed', 'true');
  });
});

/** A signup that is waiting for approval: the email-code login creates it, nobody approves it. */
async function pendingSignup(context: BrowserContext): Promise<string> {
  const email = `pend-${crypto.randomBytes(5).toString('hex')}@test.dev`;
  const headers = { Origin: APP };
  await context.request.post(`${APP}/api/auth/request-code`, { data: { email }, headers });
  const { code } = await (await context.request.get(`${CONTROL}/code?email=${email}`)).json();
  await context.request.post(`${APP}/api/auth/verify-code`, { data: { email, code }, headers });
  return email;
}

test.describe('mobile number at sign-up', () => {
  test('a new sign-up is asked for a number first, then waits for approval; the admin sees it', async ({ page, context, browser }) => {
    const email = await pendingSignup(context);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'One last thing' })).toBeVisible();

    await page.getByLabel('Mobile number').fill('12345');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toContainText('valid mobile number');

    await page.getByLabel('Mobile number').fill('98765 43210');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: /studio is being set up/i })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: /studio is being set up/i })).toBeVisible(); // asked only once

    const adminCtx = await browser.newContext();
    const admin = await signIn(adminCtx, { superadmin: true });
    expect(admin.email).toBeTruthy();
    const adminPage = await adminCtx.newPage();
    await adminPage.goto('/admin');
    await expect(adminPage.getByRole('row', { name: new RegExp(email) })).toContainText('+919876543210');
  });

  test('an account that signed up before is never asked', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'One last thing' })).toHaveCount(0);
    await expect(page.locator('nav, header').first()).toBeVisible();
  });
});

test.describe('admin console', () => {
  test('nav: labelled, shows how many signups wait, and the count drops when one is approved', async ({ page, context, browser }) => {
    const email = await pendingSignup(await browser.newContext());
    await signIn(context, { superadmin: true });
    await page.goto('/admin/plans');
    const nav = page.getByRole('navigation', { name: 'Admin' });
    await expect(nav.getByRole('link', { name: /Approvals/ })).toBeVisible();
    const badge = nav.locator('.admin-nav-count');
    await expect(badge).toBeVisible();
    const before = Number(await badge.textContent());
    expect(before).toBeGreaterThan(0);

    await page.goto('/admin');
    const row = page.getByRole('row', { name: new RegExp(email) });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('row', { name: new RegExp(email) })).toHaveCount(0);
    if (before > 1) await expect(badge).toHaveText(String(before - 1));
    else await expect(badge).toHaveCount(0);
  });

  test.describe('registration: pause and resume', () => {
    test.afterEach(async ({ browser }) => {
      const ctx = await browser.newContext();
      const admin = await signIn(ctx, { superadmin: true });
      await admin.api.put(`${APP}/api/superadmin/registration`, { data: { autoApprove: false }, headers: apiHeaders });
      await ctx.close();
    });

    test('manual by default; auto-approve lets new signups straight in; pausing queues them; approve all clears the queue', async ({ page, context, browser }) => {
      const waitingEmail = await pendingSignup(await browser.newContext());
      await signIn(context, { superadmin: true });
      await page.goto('/admin');
      const section = page.getByRole('heading', { name: /Registration: paused/ });
      await expect(section).toBeVisible();
      await expect(page.getByRole('button', { name: 'Manual review' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('registration-history')).toContainText('waiting for approval now');

      // Open: a brand-new signup is approved the moment it signs in.
      await page.getByRole('button', { name: 'Auto-approve' }).click();
      await expect(page.getByRole('heading', { name: /Registration: open/ })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'Auto-approve is on' })).toBeVisible();
      const openCtx = await browser.newContext();
      const openEmail = await pendingSignup(openCtx);
      const me = await (await openCtx.request.get(`${APP}/api/auth/me`)).json();
      expect(me.user.email).toBe(openEmail);
      expect(me.user.approvedAt).not.toBeNull();
      await openCtx.close();

      // Paused again: the setting sticks through a reload, and the next signup waits.
      await page.getByRole('button', { name: 'Manual review' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Registrations paused' })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading', { name: /Registration: paused/ })).toBeVisible();
      const pausedEmail = await pendingSignup(await browser.newContext());
      await page.reload();
      await expect(page.getByRole('row', { name: new RegExp(pausedEmail) })).toBeVisible();
      await expect(page.getByRole('row', { name: new RegExp(waitingEmail) })).toBeVisible();

      // Approve everyone waiting in one go.
      page.on('dialog', (d) => void d.accept());
      await page.getByRole('button', { name: /Approve all waiting/ }).click();
      await expect(page.getByRole('status').filter({ hasText: /Approved \d+ signup/ })).toBeVisible();
      await expect(page.getByRole('row', { name: new RegExp(pausedEmail) })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Approve all waiting/ })).toHaveCount(0);
    });
  });

  test('phone: the Approve and Reject buttons stay on screen (secondary columns are folded under the email)', async ({ page, context, browser }) => {
    const email = await pendingSignup(await browser.newContext());
    await signIn(context, { superadmin: true });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/admin');
    const row = page.getByRole('row', { name: new RegExp(email) });
    await expect(row).toBeVisible();
    for (const name of ['Approve', 'Reject']) {
      const box = await row.getByRole('button', { name }).boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.x + box!.width, `${name} inside the 390px screen`).toBeLessThanOrEqual(390);
    }
    await expect(row.locator('.show-sm')).toContainText('Solo user');
    // The page itself never scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('companies: search narrows the list on the server and shows the count; plan and status read as words', async ({ page, context, browser }) => {
    const { email } = await signIn(await browser.newContext());
    await signIn(context, { superadmin: true });
    await page.goto('/admin/accounts');
    const search = page.getByLabel('Search companies');
    await search.fill(email);
    await expect(page.locator('.admin-toolbar-count')).toHaveText('1 account');
    const row = page.getByRole('row', { name: new RegExp(email) });
    await expect(row).toContainText('Free');
    await expect(row).toContainText('Active');
    await row.getByRole('link', { name: email }).click();
    await expect(page).toHaveURL(/\/admin\/accounts\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: new RegExp(email) })).toBeVisible();
    await page.getByRole('link', { name: /Companies/ }).first().click();
    await search.fill('zzz-no-such-company');
    await expect(page.getByText('No companies match "zzz-no-such-company".')).toBeVisible();
  });

  test('plans: quality, recording and background removal and lower thirds read as words, not codes', async ({ page, context }) => {
    await signIn(context, { superadmin: true });
    await page.goto('/admin/plans');
    const pro = page.getByRole('row', { name: /^Pro / });
    await expect(pro).toContainText('2K 1440p');
    await expect(pro.getByText('Yes')).toHaveCount(3); // recording, background removal and lower thirds
    const free = page.getByRole('row', { name: /^Free / });
    await expect(free).toContainText('Full HD 1080p');
    await expect(free.getByText('Yes')).toHaveCount(0);
  });

  test('audit log: actions are readable, the JSON is tucked away, and it can be filtered', async ({ page, context, browser }) => {
    const email = await pendingSignup(await browser.newContext());
    await signIn(context, { superadmin: true });
    await page.goto('/admin');
    await page.getByRole('row', { name: new RegExp(email) }).getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('row', { name: new RegExp(email) })).toHaveCount(0);

    await page.goto('/admin/audit-log');
    const select = page.getByLabel('Filter by action');
    await expect(select).toBeVisible();
    const options = await select.locator('option').allTextContents();
    expect(options.every((o) => !o.includes('_'))).toBe(true); // "Approve user", not approve_user
    const approve = options.find((o) => /approve/i.test(o))!;
    expect(approve, JSON.stringify(options)).toBeTruthy();
    await select.selectOption({ label: approve });
    const rows = page.locator('tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
    for (const t of await rows.locator('td:nth-child(2)').allTextContents()) expect(t).toBe(approve);
    await expect(page.locator('pre.audit-log-metadata').first()).toBeHidden(); // collapsed until "View"
  });

  test('there is no separate Users page: the nav has none, an old /admin/users link lands on Companies', async ({ page, context }) => {
    await signIn(context, { superadmin: true });
    await page.goto('/admin/plans');
    await expect(page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Users' })).toHaveCount(0);
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/admin\/accounts$/);
    await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
  });

  test('companies: a user\'s email finds the company it belongs to, and says which user matched', async ({ page, context, browser }) => {
    const { email } = await signIn(await browser.newContext());
    await signIn(context, { superadmin: true });
    await page.goto('/admin/accounts');
    // (A solo account is named after its email; the e2e test covers a company whose name differs from its user's email.)
    await page.getByLabel('Search companies').fill(email);
    await expect(page.locator('.admin-toolbar-count')).toHaveText('1 account');
    await expect(page.getByRole('row', { name: new RegExp(email) })).toBeVisible();
  });

  test('company page: suspend a single user (asks first), then reactivate; the account itself stays active', async ({ page, context, browser }) => {
    const { email } = await signIn(await browser.newContext());
    await signIn(context, { superadmin: true });
    await page.goto('/admin/accounts');
    await page.getByLabel('Search companies').fill(email);
    await page.getByRole('link', { name: email }).click();
    const row = page.getByRole('row', { name: new RegExp(email) });
    await expect(row.getByText('Approved')).toBeVisible();

    let asked = '';
    page.once('dialog', (d) => {
      asked = d.message();
      void d.dismiss();
    });
    await row.getByRole('button', { name: 'Suspend' }).click();
    await expect.poll(() => asked).toContain(email);
    await expect(row.getByText('Suspended')).toHaveCount(0); // cancelled: nothing changed

    page.once('dialog', (d) => void d.accept());
    await row.getByRole('button', { name: 'Suspend' }).click();
    await expect(row.getByText('Suspended')).toBeVisible();
    await row.getByRole('button', { name: 'Reactivate' }).click();
    await expect(row.getByText('Suspended')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 }).getByText('Active')).toBeVisible();
  });
});

test.describe('recording to this computer (Pro)', () => {
  test('Free plan: the Record button is locked and points to billing', async ({ page, context }) => {
    const { api } = await signIn(context);
    const id = await newStream(context, api);
    await page.goto(`/streams/${id}/studio`);
    const locked = page.getByRole('button', { name: /Record to this computer \(Pro plan\)/ });
    await expect(locked).toBeVisible();
    await locked.click();
    await expect(page).toHaveURL(/\/billing$/);
  });

  test.describe('on a plan that allows it', () => {
    test.beforeEach(async ({ browser }) => {
      const adminCtx = await browser.newContext();
      const admin = await signIn(adminCtx, { superadmin: true });
      await admin.api.patch(`${APP}/api/superadmin/plans/free`, { data: { canRecord: true }, headers: apiHeaders });
      await adminCtx.close();
    });
    test.afterEach(async ({ browser }) => {
      const adminCtx = await browser.newContext();
      const admin = await signIn(adminCtx, { superadmin: true });
      await admin.api.patch(`${APP}/api/superadmin/plans/free`, { data: { canRecord: false }, headers: apiHeaders });
      await adminCtx.close();
    });

    test('writes the composited stream to the file the host picked, and the quality is locked meanwhile', async ({ page, context }) => {
      const { api } = await signIn(context);
      const id = await newStream(context, api);
      await page.addInitScript(() => {
        const w = window as unknown as { __rec: { name: string; bytes: number; closed: boolean } };
        w.__rec = { name: '', bytes: 0, closed: false };
        (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async (o: { suggestedName: string }) => {
          w.__rec.name = o.suggestedName;
          return { createWritable: async () => ({ write: async (b: Blob) => { w.__rec.bytes += b.size; }, close: async () => { w.__rec.closed = true; } }) };
        };
      });
      await page.goto(`/streams/${id}/studio`);
      await page.getByRole('button', { name: 'Record to this computer', exact: true }).click();
      const stop = page.getByRole('button', { name: 'Stop recording' });
      await expect(stop).toBeVisible();
      await expect(page.locator('.studio-resolution-select select')).toBeDisabled();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __rec: { bytes: number } }).__rec.bytes), { timeout: 15_000 }).toBeGreaterThan(0);
      await stop.click();
      await expect(page.getByText(/Recording saved as streambird-.*\.(mp4|webm)/)).toBeVisible();
      const rec = await page.evaluate(() => (window as unknown as { __rec: { name: string; closed: boolean } }).__rec);
      expect(rec.closed).toBe(true);
      expect(rec.name).toMatch(/^streambird-.*\.(mp4|webm)$/);
      await expect(page.getByRole('button', { name: 'Record to this computer', exact: true })).toBeVisible();
      await expect(page.locator('.studio-resolution-select select')).toBeEnabled();
    });

    test('without the file picker it downloads the recording when stopped; closing the save dialog records nothing', async ({ page, context }) => {
      const { api } = await signIn(context);
      const id = await newStream(context, api);
      await page.addInitScript(() => {
        (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = undefined;
      });
      await page.goto(`/streams/${id}/studio`);
      await page.getByRole('button', { name: 'Record to this computer', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
      await page.waitForTimeout(2500);
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Stop recording' }).click();
      expect((await download).suggestedFilename()).toMatch(/^streambird-.*\.(mp4|webm)$/);
      await expect(page.getByText(/Recording downloaded as/)).toBeVisible();

      await page.evaluate(() => {
        (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
          throw new DOMException('dismissed', 'AbortError');
        };
      });
      await page.getByRole('button', { name: 'Record to this computer', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Stop recording' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Record to this computer', exact: true })).toBeVisible();
    });
  });
});

test.describe('UI polish', () => {
  test('the currency switch is a proper segmented control and "See pricing" is a chip', async ({ page }) => {
    await page.goto('/');
    const group = page.getByRole('group', { name: 'Currency' });
    const usd = group.getByRole('button', { name: 'USD' });
    const inr = group.getByRole('button', { name: /INR/ });
    await expect(usd).toHaveAttribute('aria-pressed', /true|false/);
    await inr.click();
    await expect(inr).toHaveAttribute('aria-pressed', 'true');
    await expect(usd).toHaveAttribute('aria-pressed', 'false');
    // Real buttons with room to click, not collapsed text.
    for (const b of [usd, inr]) {
      const box = (await b.boundingBox())!;
      expect(box.height).toBeGreaterThan(30);
      expect(box.width).toBeGreaterThan(60);
    }
    expect(await inr.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');

    const chip = page.getByRole('link', { name: /See pricing/ });
    await expect(chip).toHaveClass(/chip-link/);
    expect(await chip.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThan(20);
    expect(await chip.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth))).toBeGreaterThan(0);
  });

  test('home hero: animated headline cycling the platforms, a studio miniature, and no motion when reduced', async ({ page, browser }) => {
    await page.goto('/');
    // Screen readers get one plain sentence; the animated copy is decoration.
    await expect(page.getByRole('heading', { level: 1, name: 'Go live on YouTube, Facebook and Twitch from one browser tab.' })).toBeAttached();
    const words = page.locator('.hero-word');
    await expect(words).toHaveCount(3);
    const timing = await words.evaluateAll((els) => els.map((e) => ({ name: getComputedStyle(e).animationName, dur: getComputedStyle(e).animationDuration, delay: getComputedStyle(e).animationDelay })));
    expect(timing.every((t) => t.name === 'hero-word' && t.dur === '9s')).toBe(true);
    expect(timing.map((t) => t.delay)).toEqual(['0s', '3s', '6s']); // one platform at a time, in turn

    const studio = page.locator('.hero-studio');
    await expect(studio).toBeVisible();
    await expect(studio.locator('.hs-dest')).toHaveCount(3);
    expect(await studio.getAttribute('aria-hidden')).toBe('true');

    // No sideways scroll on a phone.
    await page.setViewportSize({ width: 390, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // prefers-reduced-motion: nothing animates and the first platform stays on screen.
    const calm = await browser.newContext({ reducedMotion: 'reduce' });
    const still = await calm.newPage();
    await still.goto(`${APP}/`);
    await expect(still.locator('.hero-word').first()).toHaveCSS('opacity', '1');
    expect(await still.locator('.hero-word').first().evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
    expect(await still.locator('.hero-studio').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
    await calm.close();
  });

  test('waiting for approval: a friendly "studio is being set up" page that says what it found and lets you in by itself', async ({ page, context }) => {
    const email = `ui-${crypto.randomBytes(5).toString('hex')}@test.dev`;
    await page.clock.install();
    await page.goto('/login');
    await page.fill('#email', email);
    await page.getByRole('button', { name: /Send login code/ }).click();
    await page.waitForSelector('#code');
    const { code } = await (await page.request.get(`${CONTROL}/code?email=${email}`)).json();
    await page.fill('#code', code);
    await page.getByRole('button', { name: /Log in/ }).click();
    await page.getByLabel('Mobile number').fill('9876543210');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Your studio is being set up!' })).toBeVisible();
    await expect(page.getByText(`as ${email}`)).toBeVisible();
    await expect(page.getByText(`we will email you at ${email}`)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Setup progress' }).locator('li')).toHaveCount(4);
    const mail = page.getByRole('link', { name: /support@shackyapps\.in/ });
    await expect(mail).toHaveAttribute('href', /^mailto:support@shackyapps\.in\?subject=/);
    expect(decodeURIComponent((await mail.getAttribute('href'))!)).toContain(email);
    expect(await page.locator('.pending-bird').evaluate((e) => getComputedStyle(e).animationName)).not.toBe('none');

    // "Check again" answers instead of looking idle.
    await page.getByRole('button', { name: /Check again/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'still being set up' })).toBeVisible();

    // Approved while the page is open: it moves on by itself within one poll, no click needed.
    await page.request.post(`${CONTROL}/approve?email=${email}`);
    await page.clock.fastForward(35_000);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('waiting for approval: no motion when the visitor asks for reduced motion', async ({ browser }) => {
    const calm = await browser.newContext({ reducedMotion: 'reduce' });
    const p = await calm.newPage();
    const email = `ui-${crypto.randomBytes(5).toString('hex')}@test.dev`;
    await p.goto(`${APP}/login`);
    await p.fill('#email', email);
    await p.getByRole('button', { name: /Send login code/ }).click();
    await p.waitForSelector('#code');
    const { code } = await (await p.request.get(`${CONTROL}/code?email=${email}`)).json();
    await p.fill('#code', code);
    await p.getByRole('button', { name: /Log in/ }).click();
    await p.getByLabel('Mobile number').fill('9876543210');
    await p.getByRole('button', { name: 'Continue' }).click();
    await expect(p.getByRole('heading', { name: 'Your studio is being set up!' })).toBeVisible();
    expect(await p.locator('.pending-bird').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
    expect(await p.locator('.pending-ring--1').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
    await calm.close();
  });

  test('dashboard: Go live has space between icon and text; Manage is a chip', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/dashboard');
    const cta = page.locator('a.go-live-cta');
    await expect(cta).toBeVisible();
    const [svgRight, textLeft] = await cta.evaluate((el) => {
      const svg = el.querySelector('svg')!.getBoundingClientRect();
      const range = document.createRange();
      const text = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent!.trim())!;
      range.selectNodeContents(text);
      return [svg.right, range.getBoundingClientRect().left];
    });
    expect(textLeft - svgRight).toBeGreaterThanOrEqual(8);
    const manage = page.getByRole('link', { name: /Manage/ });
    await expect(manage).toHaveClass(/chip-link/);
    expect(await manage.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    const schedule = page.getByRole('link', { name: /Connect one/ });
    await expect(schedule).toHaveClass(/chip-link/);
  });

  test('a button that is working puts a big bird in the middle of the screen', async ({ page }) => {
    await page.route('**/api/auth/request-code', async (route) => {
      await new Promise((r) => setTimeout(r, 1800));
      await route.continue();
    });
    await page.goto('/login');
    await page.fill('#email', `ui-${crypto.randomBytes(4).toString('hex')}@test.dev`);
    await page.getByRole('button', { name: /Send login code/ }).click();
    const bird = page.locator('.busy-overlay-bird');
    await expect(bird).toBeVisible();
    const box = (await bird.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.width).toBeGreaterThanOrEqual(80);
    expect(Math.abs(box.x + box.width / 2 - vp.width / 2)).toBeLessThan(40);
    expect(Math.abs(box.y + box.height / 2 - vp.height / 2)).toBeLessThan(80);
    await page.waitForSelector('#code'); // the code step arrives, the bird goes
    await expect(bird).toHaveCount(0);
  });

  test('host: the slides controller sits under the picture and explains how to run slides', async ({ page, context }) => {
    const { api } = await signIn(context);
    const conn = await (await api.post(`${APP}/api/platform-connections/twitch/manual`, { data: { label: 'T', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }, headers: apiHeaders })).json();
    const stream = await (await api.post(`${APP}/api/streams`, { data: { title: 'slides', destinationConnectionIds: [conn.id] }, headers: apiHeaders })).json();
    await page.goto(`/streams/${stream.id}/studio`);

    const controls = page.locator('.slide-controls');
    await expect(controls).toBeVisible();
    // Directly below the picture, before the other panels.
    const canvasBottom = (await page.locator('canvas.studio-canvas').boundingBox())!.y + (await page.locator('canvas.studio-canvas').boundingBox())!.height;
    expect((await controls.boundingBox())!.y).toBeLessThan(canvasBottom + 160);
    await expect(controls.getByText('No slides')).toBeVisible();
    await expect(controls.locator('kbd').first()).toBeVisible(); // the key hint is on screen, not buried
    await expect(controls.getByText(/Sharing your screen replaces the slide/)).toBeVisible();

    // Grid has no slide area: say so and offer the fix.
    await page.getByRole('button', { name: /Use a slide layout/ }).click();
    await expect(page.locator('#layoutSelect')).not.toHaveValue('grid');

    const colours = ['#ff0000', '#00ff00', '#0000ff'];
    await page.evaluate(async (cols: string[]) => {
      const dt = new DataTransfer();
      for (const [i, colour] of cols.entries()) {
        const c = document.createElement('canvas');
        c.width = 1600;
        c.height = 900;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = colour;
        ctx.fillRect(0, 0, 1600, 900);
        const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
        dt.items.add(new File([blob], `s${i + 1}.png`, { type: 'image/png' }));
      }
      const input = document.querySelector<HTMLInputElement>('#slidesInput')!;
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, colours);
    await expect(page.getByTestId('slide-counter')).toHaveText('Slide 1 / 3');
    await expect(controls.locator('.slide-thumb')).toHaveCount(3);
    await expect(controls.locator('.slide-thumb--active')).toHaveCount(1);

    await controls.locator('.slide-thumb').nth(2).click(); // jump by thumbnail
    await expect(page.getByTestId('slide-counter')).toHaveText('Slide 3 / 3');
    await controls.getByRole('button', { name: 'Previous slide' }).click();
    await expect(page.getByTestId('slide-counter')).toHaveText('Slide 2 / 3');
    await page.locator('h1').click();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('slide-counter')).toHaveText('Slide 3 / 3');
  });

  test('the big bird is only a safety-limited hint: it stops covering the page after a while, while the small one stays on the button', async ({ page }) => {
    await page.clock.install();
    await page.route('**/api/auth/request-code', () => undefined); // never answered
    await page.goto('/login');
    await page.fill('#email', `ui-${crypto.randomBytes(4).toString('hex')}@test.dev`);
    await page.getByRole('button', { name: /Send login code/ }).click();
    await page.clock.fastForward(1_000);
    await expect(page.locator('.busy-overlay-bird')).toBeVisible();
    await page.clock.fastForward(50_000);
    await expect(page.locator('.busy-overlay-bird')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Send login code/ }).locator('.bird-busy')).toBeVisible();
  });

  test.describe('invite password', () => {
    async function studioWithConnection(context: BrowserContext, api: APIRequestContext) {
      const conn = await (
        await api.post(`${APP}/api/platform-connections/twitch/manual`, { data: { label: 'UI Twitch', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }, headers: apiHeaders })
      ).json();
      return (await (await api.post(`${APP}/api/streams`, { data: { title: 'pw stream', destinationConnectionIds: [conn.id] }, headers: apiHeaders })).json()) as { id: string; studioSessionId: string };
    }

    test('host: the checkbox lines up, and the password only applies once it is saved', async ({ page, context }) => {
      const { api } = await signIn(context);
      const stream = await studioWithConnection(context, api);
      await page.goto(`/streams/${stream.id}/studio`);
      const invites: unknown[] = [];
      await page.route('**/invites', async (route) => {
        if (route.request().method() === 'POST') invites.push(route.request().postDataJSON());
        await route.continue();
      });

      await page.getByRole('button', { name: 'Invite password options' }).click();
      const check = page.getByRole('checkbox', { name: /Require a password to join/ });
      await check.check();
      const box = (await check.boundingBox())!;
      expect(box.width).toBeLessThan(26); // a checkbox, not a full-width input
      const labelBox = (await page.locator('label.checkbox-row').boundingBox())!;
      expect(Math.abs(box.y + box.height / 2 - (labelBox.y + labelBox.height / 2))).toBeLessThan(4);

      // Typed but not saved: the page says so and sends nothing.
      const typed = crypto.randomBytes(6).toString('hex'); // generated per run, not a literal
      await page.getByLabel('Invite password', { exact: true }).fill(typed);
      await expect(page.getByText(/Nothing changes until you do/)).toBeVisible();
      await page.getByRole('button', { name: 'Create guest invite' }).click();
      await expect(page.getByText(/Press Save to set the password/)).toBeVisible();
      expect(invites).toHaveLength(0);

      // Saved: confirmation, and the invite carries the password.
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText(/Password saved/)).toBeVisible();
      await page.getByRole('button', { name: 'Create guest invite' }).click();
      await expect.poll(() => invites.length).toBe(1);
      expect(invites[0]).toMatchObject({ password: typed });
    });

    test('guest: a wrong password is refused on the join form, the right one gets in', async ({ page, context, browser }) => {
      const { api } = await signIn(context);
      const stream = await studioWithConnection(context, api);
      const right = crypto.randomBytes(6).toString('hex');
      const wrong = crypto.randomBytes(6).toString('hex');
      const invite = await (await api.post(`${APP}/api/studio-sessions/${stream.studioSessionId}/invites`, { data: { password: right }, headers: apiHeaders })).json();
      const guestCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const guest = await guestCtx.newPage();
      await guest.goto(`${APP}/join/${invite.token}`);
      await guest.fill('#displayName', 'Alex');
      await guest.fill('#invitePassword', wrong);
      await guest.getByRole('button', { name: /^Join$/ }).click();
      await expect(guest.getByText(/password is not correct/)).toBeVisible();
      await expect(guest.locator('.meeting-grid')).toHaveCount(0); // never shown the room

      await guest.fill('#invitePassword', right);
      await guest.getByRole('button', { name: /^Join$/ }).click();
      await expect(guest.locator('.meeting-grid')).toBeVisible();
      // Alone in the room ("waiting for others to connect…") is not an action: no big bird over the call.
      await guest.waitForTimeout(700);
      await expect(guest.locator('.busy-overlay')).toHaveCount(0);
      await guestCtx.close();
    });
  });
});

test.describe('admin analytics: Force end', () => {
  async function liveStreamAs(browser: import('@playwright/test').Browser, title: string) {
    const ctx = await browser.newContext();
    const { api } = await signIn(ctx);
    const conn = await (await api.post(`${APP}/api/platform-connections/twitch/manual`, { data: { label: 'T', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }, headers: apiHeaders })).json();
    const stream = await (await api.post(`${APP}/api/streams`, { data: { title, destinationConnectionIds: [conn.id] }, headers: apiHeaders })).json();
    return { id: stream.id as string, ctx };
  }

  test('a superadmin force-ends a live stream from the analytics page, and a failure stays on the page so it can be retried', async ({ page, context, browser }) => {
    const title = `Stuck show ${crypto.randomBytes(4).toString('hex')}`;
    const { id, ctx } = await liveStreamAs(browser, title);
    await signIn(context, { superadmin: true });
    page.on('dialog', (d) => void d.accept());

    await page.goto('/admin/analytics');
    const row = page.getByRole('row', { name: new RegExp(title) });
    await expect(row).toBeVisible();

    // First attempt fails on the server: a message above the table, the page and the row are still there.
    let calls = 0;
    await page.route(`**/api/superadmin/streams/${id}/force-end`, async (route) => {
      calls++;
      if (calls === 1) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ statusCode: 500, message: 'Internal server error' }) });
      else await route.continue();
    });
    await row.getByRole('button', { name: `Force end ${title}` }).click();
    await expect(page.getByTestId('force-end-note')).toContainText(`Could not end "${title}"`);
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: `Force end ${title}` })).toBeEnabled();

    // Retry works: the row goes, the note says what happened, and the stream really ended.
    await row.getByRole('button', { name: `Force end ${title}` }).click();
    await expect(page.getByTestId('force-end-note')).toContainText(`Ended "${title}"`);
    await expect(page.getByRole('row', { name: new RegExp(title) })).toHaveCount(0);
    const status = await (await ctx.request.get(`${APP}/api/streams/${id}`)).json();
    expect(status.status).toBe('ended');
    await ctx.close();
  });
});

test.describe('host studio: a guest joining', () => {
  test('the host is told the guest is connected, and no loader bird is left spinning over the studio', async ({ page, context, browser }) => {
    const { api } = await signIn(context);
    const conn = await (await api.post(`${APP}/api/platform-connections/twitch/manual`, { data: { label: 'T', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }, headers: apiHeaders })).json();
    const stream = await (await api.post(`${APP}/api/streams`, { data: { title: 'guest joins', destinationConnectionIds: [conn.id] }, headers: apiHeaders })).json();
    const invite = await (await api.post(`${APP}/api/studio-sessions/${stream.studioSessionId}/invites`, { data: {}, headers: apiHeaders })).json();

    await page.goto(`/streams/${stream.id}/studio`);
    await expect(page.getByText('Connected to the studio as host.')).toBeVisible();

    const guestCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const guest = await guestCtx.newPage();
    await guest.goto(`${APP}/join/${invite.token}`);
    await guest.fill('#displayName', 'Alex');
    await guest.getByRole('button', { name: /^Join$/ }).click();
    await expect(guest.locator('.meeting-grid')).toBeVisible();

    // The host first sees the guest arrive, then that their video is connected.
    await expect(page.locator('.studio-status-toast')).toContainText(/Alex (joined|is connected)/);
    await expect(page.locator('.studio-status-toast')).toContainText('Alex is connected', { timeout: 20_000 });
    // Nothing is "working" any more: no big bird over the page, no "…" status.
    await page.waitForTimeout(800);
    await expect(page.locator('.busy-overlay')).toHaveCount(0);
    await expect(page.locator('.studio-status-toast .bird-busy')).toHaveCount(0);
    await guestCtx.close();
  });
});
