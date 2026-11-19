import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { APP, CONTROL, apiHeaders, newStream, patchFreePlan, signIn } from './helpers';

// Superadmin support sessions ("View as customer" / "Act as customer"): the admin buttons, the banner everywhere,
// editing as the customer, the blocked actions and Exit / expiry.

const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** A company customer with one kit and a stream. Returns the account id the admin page needs. */
async function customer(browser: Browser, admin: { api: BrowserContext['request'] }) {
  const ctx = await browser.newContext();
  const { email, api } = await signIn(ctx);
  await api.post(`${CONTROL}/make-company-admin?email=${email}&name=Acme%20Media`);
  const kit = await (await api.post(`${APP}/api/brand-kits`, { data: { name: 'Support look', isDefault: true }, headers: apiHeaders })).json();
  expect(kit.id).toBeTruthy();
  const streamId = await newStream(api);
  const found = await (await admin.api.get(`${APP}/api/superadmin/accounts?q=${encodeURIComponent(email)}`)).json();
  const accountId = found.items[0].id as string;
  const names = async () => ((await (await api.get(`${APP}/api/brand-kits`)).json()) as Array<{ name: string }>).map((k) => k.name);
  return { email, accountId, streamId, names, close: () => ctx.close() };
}

test.describe('superadmin support sessions', () => {
  test.beforeEach(async ({ browser }) => patchFreePlan(browser, { watermark: false, assetStorageMb: 5 }));
  test.afterEach(async ({ browser }) => patchFreePlan(browser, { watermark: true, assetStorageMb: 0 }));

  test('act as customer: banner on every page and width, editing works, billing and the studio are blocked, Exit returns to admin', async ({ page, context, browser }) => {
    const admin = await signIn(context, { superadmin: true });
    const cust = await customer(browser, admin);

    await page.setViewportSize({ width: 1366, height: 800 });
    await page.goto(`/admin/accounts/${cust.accountId}`);
    await expect(page.getByTestId('impersonation-banner')).toHaveCount(0);
    await expect(page.getByTestId('admin-impersonate-view')).toBeVisible();
    await page.getByTestId('admin-impersonate-act').click();
    const dialog = page.getByTestId('impersonate-act-dialog');
    await expect(dialog).toContainText('Payments and plan changes');
    await expect(dialog).toContainText('Going live');
    await dialog.getByLabel('Reason (optional, kept in the audit log)').fill('ticket 77');
    await page.getByTestId('impersonate-act-confirm').click();

    // Now the app is the customer's, with the banner.
    await expect(page).toHaveURL(/\/dashboard$/);
    const banner = page.getByTestId('impersonation-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('role', 'status');
    await expect(banner).toContainText('Support session');
    await expect(banner).toContainText('Acme Media');
    await expect(banner).toContainText(cust.email);
    await expect(banner).toContainText('Can edit');
    await expect(page.getByTestId('impersonation-countdown')).toHaveText(/^(29|30):\d\d$/);
    await expect(page.getByTestId('impersonation-exit')).toBeVisible();
    const box = (await banner.boundingBox())!;
    expect(box.y).toBe(0);
    expect(box.width).toBeGreaterThan(1300);
    // The app header sits below the banner, not under it.
    expect((await page.locator('.app-header').boundingBox())!.y).toBeGreaterThanOrEqual(box.height - 1);

    // Phone width: still there, still unmistakable, nothing overflows.
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(banner).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
    await expect(page.getByTestId('impersonation-exit')).toBeVisible();
    await page.setViewportSize({ width: 1366, height: 800 });

    // Brand page: the same banner, and the customer's kit can be edited.
    await page.goto('/brand');
    await expect(banner).toBeVisible();
    await page.getByRole('button', { name: 'Edit Support look' }).click();
    const form = page.getByRole('form', { name: 'Brand kit Support look' });
    await form.getByLabel('Kit name').fill('Renamed by support');
    await form.getByRole('button', { name: 'Save kit' }).click();
    await expect(page.getByText('Saved "Renamed by support".')).toBeVisible();
    expect(await cust.names()).toEqual(['Renamed by support']);

    // Billing: an info note, and the server refuses too (with the plain sentence).
    await page.goto('/billing');
    await expect(banner).toBeVisible();
    await expect(page.getByTestId('billing-support-note')).toContainText('payments and plan changes are not allowed');
    await expect(page.getByRole('button', { name: /Subscribe|Buy/ })).toHaveCount(0);
    const refused = await context.request.post(`${APP}/api/billing/orders`, { data: { planKey: 'pro' }, headers: apiHeaders });
    expect(refused.status()).toBe(403);
    expect(JSON.stringify(await refused.json())).toContain('Not allowed while acting as a customer: payments and plan changes');

    // The studio shell: banner present (also on a phone), the live studio itself cannot be opened as the host.
    await page.goto(`/streams/${cust.streamId}/studio`);
    await expect(banner).toBeVisible();
    await expect(page.getByTestId('studio-support-note')).toBeVisible();
    await expect(page.getByText('Not allowed while acting as a customer')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(banner).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
    await page.setViewportSize({ width: 1366, height: 800 });

    // The admin area is not reachable as the customer: it sends you back to the app.
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/dashboard$/);

    // Exit: back to the admin page of that customer, banner gone, the admin is the admin again.
    await page.getByTestId('impersonation-exit').click();
    await expect(page).toHaveURL(new RegExp(`/admin/accounts/${cust.accountId}$`));
    await expect(banner).toHaveCount(0);
    await expect(page.getByText('Support session ended.')).toBeVisible();
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin$/);
    await expect(banner).toHaveCount(0);
    await cust.close();
  });

  test('view as customer: read-only, the server message shows, nothing is changed', async ({ page, context, browser }) => {
    const admin = await signIn(context, { superadmin: true });
    const cust = await customer(browser, admin);
    await page.setViewportSize({ width: 1366, height: 800 });
    await page.goto(`/admin/accounts/${cust.accountId}`);
    await page.getByTestId('admin-impersonate-view').click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const banner = page.getByTestId('impersonation-banner');
    await expect(banner).toContainText('View-only');
    await expect(banner).toHaveAttribute('data-mode', 'view');

    await page.goto('/brand');
    await expect(page.getByText('Support look').first()).toBeVisible();
    await page.getByRole('button', { name: 'Edit Support look' }).click();
    const form = page.getByRole('form', { name: 'Brand kit Support look' });
    await form.getByLabel('Kit name').fill('Should not save');
    await form.getByRole('button', { name: 'Save kit' }).click();
    await expect(page.getByText('View-only support session')).toBeVisible();
    expect(await cust.names()).toEqual(['Support look']);
    await page.getByTestId('impersonation-exit').click();
    await expect(page).toHaveURL(new RegExp(`/admin/accounts/${cust.accountId}$`));
    await cust.close();
  });

  test('when the time is up the app returns to the admin area with a notice', async ({ page, context, browser }) => {
    const admin = await signIn(context, { superadmin: true });
    const cust = await customer(browser, admin);
    await page.goto(`/admin/accounts/${cust.accountId}`);
    await page.getByTestId('admin-impersonate-view').click();
    await expect(page.getByTestId('impersonation-banner')).toBeVisible();
    const adminEmail = admin.email;
    expect((await context.request.post(`${CONTROL}/impersonation-expires?email=${adminEmail}&seconds=3`)).ok()).toBeTruthy();
    // The tab learns the new end time when it is focused again; the countdown then reaches zero, the app asks the server, and the session is over.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page).toHaveURL(new RegExp(`/admin/accounts/${cust.accountId}$`), { timeout: 15_000 });
    await expect(page.getByTestId('impersonation-banner')).toHaveCount(0);
    await expect(page.getByText('The support session has ended')).toBeVisible();
    await cust.close();
  });

  test('the privacy policy says that authorised support staff may access an account, and that it is logged', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByTestId('privacy-support-access')).toContainText('support staff may access an account to resolve an issue');
    await expect(page.getByTestId('privacy-support-access')).toContainText('Every such access is logged');
  });
});
