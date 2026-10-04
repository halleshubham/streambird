import { APIRequestContext, BrowserContext, expect, Page, test } from '@playwright/test';
import * as crypto from 'crypto';

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
  async function newStream(context: BrowserContext, api: APIRequestContext): Promise<string> {
    const conn = await (
      await api.post(`${APP}/api/platform-connections/twitch/manual`, {
        data: { label: 'UI Twitch', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' },
        headers: apiHeaders,
      })
    ).json();
    const stream = await (await api.post(`${APP}/api/streams`, { data: { title: 'UI smoke stream', destinationConnectionIds: [conn.id] }, headers: apiHeaders })).json();
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
