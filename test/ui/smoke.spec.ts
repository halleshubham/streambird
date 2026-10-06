import { APIRequestContext, BrowserContext, expect, Page, test } from '@playwright/test';
import * as crypto from 'crypto';
import { computeLayout } from '../../web-app/src/studio/compose';

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
    await expect(page.getByText('Almost there')).toBeVisible(); // new accounts wait for approval

    await page.request.post(`${CONTROL}/approve?email=${email}`);
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText('Stream hours this period')).toBeVisible();
    await expect(page.getByText(/Free plan/)).toBeVisible();
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
    await expect(page.getByText(/We emailed a 6-digit code/)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/); // not signed in yet

    const { code } = await (await context.request.get(`${CONTROL}/code?email=${email}`)).json();
    await page.getByLabel('Code').fill(code);
    await page.getByRole('button', { name: 'Verify and log in' }).click();
    await expect(page).toHaveURL(/\/admin$/);
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

test.describe('host studio', () => {
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
});
