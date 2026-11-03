import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import * as crypto from 'crypto';
import { APP, CONTROL, acceptConfirm, apiHeaders, cancelConfirm, confirmDialog, signIn } from './helpers';

// The redesigned superadmin console: pages, phone layouts, plan drawer, dialogs (accept and cancel), toasts, empty states.

const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function pendingSignup(context: BrowserContext): Promise<string> {
  const email = `pend-${crypto.randomBytes(5).toString('hex')}@test.dev`;
  const headers = { Origin: APP };
  await context.request.post(`${APP}/api/auth/request-code`, { data: { email }, headers });
  const { code } = await (await context.request.get(`${CONTROL}/code?email=${email}`)).json();
  await context.request.post(`${APP}/api/auth/verify-code`, { data: { email, code }, headers });
  return email;
}

const toastHost = (page: Page) => page.getByTestId('toast-host');

test.describe('admin redesign: approvals', () => {
  test('desktop: Approve toasts, Reject confirms (cancel keeps the row, accept deletes it), Approve all asks first', async ({ page, context, browser }) => {
    const a = await pendingSignup(await browser.newContext());
    const b = await pendingSignup(await browser.newContext());
    await signIn(context, { superadmin: true });
    await page.setViewportSize({ width: 1366, height: 800 });
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Pending approvals' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Registration mode' })).toBeVisible();

    // Reject: cancel path, then accept path.
    const rowA = page.getByRole('row', { name: new RegExp(a) });
    await rowA.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByRole('alertdialog', { name: 'Reject this signup?' })).toBeVisible();
    await cancelConfirm(page);
    await expect(rowA).toBeVisible();
    await rowA.getByRole('button', { name: 'Reject' }).click();
    await acceptConfirm(page);
    await expect(rowA).toHaveCount(0);
    await expect(toastHost(page)).toContainText(`${a} rejected.`);

    // Approve toasts.
    await page.getByRole('row', { name: new RegExp(b) }).getByRole('button', { name: 'Approve' }).click();
    await expect(toastHost(page)).toContainText(`${b} approved`);
    await expect(page.getByRole('row', { name: new RegExp(b) })).toHaveCount(0);

    // Approve all: cancel leaves the queue alone.
    const c = await pendingSignup(await browser.newContext());
    await page.reload();
    await page.getByRole('button', { name: /^Approve all \(\d+\)$/ }).click();
    await expect(confirmDialog(page)).toContainText(/Approve all \d+ signup/);
    await cancelConfirm(page);
    await expect(page.getByRole('row', { name: new RegExp(c) })).toBeVisible();
    await page.screenshot({ path: 'test-results/admin-approvals-desktop.png', fullPage: true });
  });

  test('phone 390: rows are cards, Approve and Reject sit side by side on screen, no sideways scroll', async ({ page, context, browser }) => {
    const email = await pendingSignup(await browser.newContext());
    await signIn(context, { superadmin: true });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/admin');
    const row = page.getByRole('row', { name: new RegExp(email) });
    await expect(row).toBeVisible();
    const approve = (await row.getByRole('button', { name: 'Approve' }).boundingBox())!;
    const reject = (await row.getByRole('button', { name: 'Reject' }).boundingBox())!;
    expect(approve.x + approve.width).toBeLessThanOrEqual(390);
    expect(reject.x + reject.width).toBeLessThanOrEqual(390);
    expect(Math.abs(approve.y - reject.y)).toBeLessThan(4); // same line
    expect(approve.height).toBeGreaterThanOrEqual(44);
    expect(await noHScroll(page)).toBe(true);
    await page.screenshot({ path: 'test-results/admin-approvals-phone.png', fullPage: true });
  });

  test('empty state: "All caught up" when nobody is waiting', async ({ page, context }) => {
    await signIn(context, { superadmin: true });
    await page.route('**/api/superadmin/pending-approvals', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.continue()));
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'All caught up' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Approve all/ })).toHaveCount(0);
  });

  test('registration switch reports through a dismissible notice', async ({ page, context }) => {
    await signIn(context, { superadmin: true });
    await page.goto('/admin');
    const paused = page.getByRole('button', { name: 'Paused, manual review' });
    await expect(paused).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Open, auto-approve' }).click();
    const note = page.getByRole('status').filter({ hasText: 'Auto-approve is on' });
    await expect(note).toBeVisible();
    await note.getByRole('button', { name: 'Dismiss' }).click();
    await expect(note).toHaveCount(0);
    await paused.click();
    await expect(page.getByRole('status').filter({ hasText: 'Registrations paused' })).toBeVisible();
  });
});

test.describe('admin redesign: companies', () => {
  test('search, Clear, empty result and Show more (server paged)', async ({ page, context }) => {
    await signIn(context, { superadmin: true });
    await page.setViewportSize({ width: 1366, height: 800 });
    await page.route('**/api/superadmin/accounts?*', async (route) => {
      const url = new URL(route.request().url());
      const offset = Number(url.searchParams.get('offset'));
      const items = Array.from({ length: offset === 0 ? 50 : 10 }, (_, i) => ({
        id: crypto.randomUUID(), name: `Acme ${offset + i}`, currentTier: 'free', planKey: 'free', includedHoursOverride: null, maxDestinationsOverride: null, maxGuestsOverride: null,
        dayPassPlanKey: null, dayPassExpiresAt: null, includedHoursPerMonth: '5', streamHourUsageCurrentPeriod: '1', billingPeriodStart: null, suspendedAt: null, createdAt: new Date().toISOString(), companyName: `Acme ${offset + i}`, userCount: 2,
      }));
      await route.fulfill({ json: { items, total: 60 } });
    });
    await page.goto('/admin/accounts');
    await expect(page.locator('.admin-toolbar-count')).toHaveText('60 accounts');
    await expect(page.locator('tbody tr')).toHaveCount(50);
    await page.getByRole('button', { name: 'Show 10 more' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(60);
    await expect(page.getByRole('button', { name: /Show .* more/ })).toHaveCount(0);

    const search = page.getByLabel('Search companies');
    await search.fill('zzz');
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(search).toHaveValue('');
    await page.screenshot({ path: 'test-results/admin-companies-desktop.png' });
  });

  test('phone 390: company cards fold plan, users and joined date under the name; no sideways scroll', async ({ page, context, browser }) => {
    const { email } = await signIn(await browser.newContext());
    await signIn(context, { superadmin: true });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/admin/accounts');
    await page.getByLabel('Search companies').fill(email);
    const row = page.getByRole('row', { name: new RegExp(email) });
    await expect(row).toBeVisible();
    await expect(row.locator('.show-sm')).toContainText(/Free · 1 user · Joined/);
    await expect(row.locator('.hide-sm').first()).toBeHidden();
    expect(await noHScroll(page)).toBe(true);
    await page.screenshot({ path: 'test-results/admin-companies-phone.png' });
  });
});

test.describe('admin redesign: company detail dialogs', () => {
  async function openCompany(page: Page, context: BrowserContext, browser: import('@playwright/test').Browser) {
    const target = await signIn(await browser.newContext());
    await signIn(context, { superadmin: true });
    await page.goto('/admin/accounts');
    await page.getByLabel('Search companies').fill(target.email);
    await page.getByRole('link', { name: target.email }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(target.email);
    return target;
  }

  test('day pass: grant dialog (cancel, then grant), revoke confirm (cancel, then revoke), with toasts', async ({ page, context, browser }) => {
    await openCompany(page, context, browser);
    await page.getByRole('button', { name: 'Grant day pass' }).click();
    const dlg = page.getByRole('dialog', { name: 'Grant a day pass' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(dlg).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Grant day pass' })).toBeVisible();

    await page.getByRole('button', { name: 'Grant day pass' }).click();
    await page.getByRole('dialog', { name: 'Grant a day pass' }).getByRole('button', { name: 'Grant', exact: true }).click();
    await expect(toastHost(page)).toContainText('Day pass granted.');
    await expect(page.getByText(/Active until/)).toBeVisible();

    await page.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByRole('alertdialog', { name: 'Revoke this day pass?' })).toBeVisible();
    await cancelConfirm(page);
    await expect(page.getByText(/Active until/)).toBeVisible();
    await page.getByRole('button', { name: 'Revoke' }).click();
    await acceptConfirm(page);
    await expect(toastHost(page)).toContainText('Day pass revoked.');
    await expect(page.getByRole('button', { name: 'Grant day pass' })).toBeVisible();
  });

  test('suspend user and reactivate user confirm first; suspend account is typed; subscription save toasts', async ({ page, context, browser }) => {
    const target = await openCompany(page, context, browser);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(toastHost(page)).toContainText('Subscription saved.');

    const userRow = page.getByRole('row', { name: new RegExp(target.email) });
    await userRow.getByRole('button', { name: 'Suspend' }).click();
    await expect(page.getByRole('alertdialog', { name: 'Suspend this user?' })).toBeVisible();
    await cancelConfirm(page);
    await expect(userRow).toContainText('Approved');
    await userRow.getByRole('button', { name: 'Suspend' }).click();
    await acceptConfirm(page);
    await expect(userRow).toContainText('Suspended');
    await userRow.getByRole('button', { name: 'Reactivate' }).click();
    await expect(page.getByRole('dialog', { name: 'Reactivate this user?' })).toBeVisible();
    await cancelConfirm(page);
    await userRow.getByRole('button', { name: 'Reactivate' }).click();
    await acceptConfirm(page);
    await expect(userRow).toContainText('Approved');

    // Account: cancel leaves it active; the typed name is required (covered in ui-kit.spec).
    await page.getByRole('button', { name: 'Suspend account' }).click();
    await cancelConfirm(page);
    await expect(page.getByRole('heading', { level: 1 }).getByText('Active')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 800 });
    expect(await noHScroll(page)).toBe(true);
    await page.screenshot({ path: 'test-results/admin-detail-phone.png', fullPage: true });
  });
});

test.describe('admin redesign: plans drawer', () => {
  test('opens on Edit, Esc and Cancel close it without saving, Save closes it with a toast; New plan opens an empty drawer', async ({ page, context }) => {
    await signIn(context, { superadmin: true });
    await page.setViewportSize({ width: 1366, height: 800 });
    await page.goto('/admin/plans');
    const edit = page.getByRole('row', { name: /Starter/ }).getByRole('button', { name: 'Edit' });
    await edit.click();
    const drawer = page.getByRole('dialog', { name: 'Edit plan: Starter' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByLabel('Key (fixed)')).toBeDisabled();
    const guests = drawer.getByLabel('Max guests (at once)');
    await guests.fill('9');
    await page.screenshot({ path: 'test-results/admin-plan-drawer.png' });

    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(edit).toBeFocused(); // focus returns to the opener
    await edit.click();
    await expect(page.getByRole('dialog', { name: 'Edit plan: Starter' }).getByLabel('Max guests (at once)')).toHaveValue('4'); // the unsaved 9 is gone

    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'New plan' }).click();
    const fresh = page.getByRole('dialog', { name: 'New plan' });
    await expect(fresh.getByLabel('Key')).toBeEnabled();
    await expect(fresh.getByLabel('Name', { exact: true })).toHaveValue('');
    await page.keyboard.press('Escape');
  });

  test('create a hidden plan, then disable it: the disable confirm can be cancelled (drawer stays) or accepted', async ({ page, context }) => {
    await signIn(context, { superadmin: true });
    await page.goto('/admin/plans');
    const key = `uitest${crypto.randomBytes(3).toString('hex')}`;
    await page.getByRole('button', { name: 'New plan' }).click();
    const d = page.getByRole('dialog', { name: 'New plan' });
    await d.getByLabel('Key').fill(key);
    await d.getByLabel('Name', { exact: true }).fill(`Test ${key}`);
    await d.getByLabel('Show on the public pricing page').uncheck();
    await d.getByRole('button', { name: 'Save plan' }).click();
    await expect(toastHost(page)).toContainText(`Created Test ${key}.`);
    const row = page.getByRole('row', { name: new RegExp(key) });
    await expect(row).toContainText('Hidden');

    await row.getByRole('button', { name: 'Edit' }).click();
    const e = page.getByRole('dialog', { name: `Edit plan: Test ${key}` });
    await e.getByLabel('Active', { exact: true }).uncheck();
    await e.getByRole('button', { name: 'Save plan' }).click();
    await expect(confirmDialog(page)).toContainText(`Disable Test ${key}?`);
    await cancelConfirm(page);
    await expect(e).toBeVisible();
    await e.getByRole('button', { name: 'Save plan' }).click();
    await acceptConfirm(page);
    await expect(row).toContainText('Inactive');
  });

  test('phone 390: the drawer fits the screen and the table scrolls inside its card', async ({ page, context }) => {
    await signIn(context, { superadmin: true });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/admin/plans');
    expect(await noHScroll(page)).toBe(true);
    await page.getByRole('row', { name: /Starter/ }).getByRole('button', { name: 'Edit' }).click();
    // The drawer slides in (0.2 s): measure once it has settled, not mid-animation.
    await expect
      .poll(async () => {
        const box = (await page.getByRole('dialog').boundingBox())!;
        return box.x >= 0 && box.x + box.width <= 390.5;
      })
      .toBe(true);
    await expect(page.getByRole('button', { name: 'Save plan' })).toBeInViewport();
    await page.screenshot({ path: 'test-results/admin-plan-drawer-phone.png' });
  });
});

test.describe('admin redesign: billing, analytics, audit', () => {
  const billing = (enabled: boolean) => ({
    enabled, keysConfigured: true, webhookSecretConfigured: true, mode: 'test', webhookUrl: 'https://example.test/api/billing/webhook', webhookEvents: ['payment.captured'], subscriptions: [], payments: [],
  });

  test('payments switch: turning off asks first (cancel keeps it on), accept turns it off with a toast; turning on needs no dialog', async ({ page, context }) => {
    await signIn(context, { superadmin: true });
    let enabled = true;
    await page.route('**/api/superadmin/billing', (r) => r.fulfill({ json: billing(enabled) }));
    await page.route('**/api/superadmin/billing/settings', async (r) => {
      enabled = (r.request().postDataJSON() as { paymentsEnabled: boolean }).paymentsEnabled;
      await r.fulfill({ json: billing(enabled) });
    });
    await page.goto('/admin/billing');
    const sw = page.getByRole('switch', { name: 'Online payments' });
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await sw.click();
    await expect(page.getByRole('alertdialog', { name: 'Turn online payments off?' })).toBeVisible();
    await cancelConfirm(page);
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await sw.click();
    await acceptConfirm(page);
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(toastHost(page)).toContainText('Online payments are off.');
    await sw.click();
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({ path: 'test-results/admin-billing.png', fullPage: true });
  });

  test('billing lists show 20 and "Show more" reveals the rest; empty lists say so', async ({ page, context }) => {
    await signIn(context, { superadmin: true });
    const payments = Array.from({ length: 25 }, (_, i) => ({ id: `p${i}`, accountId: crypto.randomUUID(), accountName: `Co ${i}`, planKey: 'pro', kind: 'plan', amountInr: 100, status: 'paid', failureReason: null, razorpayPaymentId: `pay_${i}`, paidAt: null, createdAt: new Date().toISOString() }));
    await page.route('**/api/superadmin/billing', (r) => r.fulfill({ json: { ...billing(false), payments } }));
    await page.goto('/admin/billing');
    await expect(page.getByText('No subscriptions yet.')).toBeVisible();
    const table = page.getByRole('table', { name: 'Recent payments' });
    await expect(table.locator('tbody tr')).toHaveCount(20);
    await page.getByRole('button', { name: 'Show 5 more' }).click();
    await expect(table.locator('tbody tr')).toHaveCount(25);
    expect(await noHScroll(page)).toBe(true);
  });

  test('force end: Cancel ("Keep streaming") leaves the stream; analytics fits a phone', async ({ page, context, browser }) => {
    const ctx = await browser.newContext();
    const { api } = await signIn(ctx);
    const conn = await (await api.post(`${APP}/api/platform-connections/twitch/manual`, { data: { label: 'T', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }, headers: apiHeaders })).json();
    const title = `Keep me ${crypto.randomBytes(3).toString('hex')}`;
    await api.post(`${APP}/api/streams`, { data: { title, destinationConnectionIds: [conn.id] }, headers: apiHeaders });
    await signIn(context, { superadmin: true });
    await page.goto('/admin/analytics');
    const row = page.getByRole('row', { name: new RegExp(title) });
    await row.getByRole('button', { name: `Force end ${title}` }).click();
    await expect(page.getByRole('alertdialog', { name: 'Force end this live stream?' })).toBeVisible();
    await confirmDialog(page).getByRole('button', { name: 'Keep streaming' }).click();
    await expect(row).toBeVisible();
    await expect(page.getByTestId('force-end-note')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/admin-analytics-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 800 });
    expect(await noHScroll(page)).toBe(true);
    await page.screenshot({ path: 'test-results/admin-analytics-phone.png', fullPage: true });
    await ctx.close();
  });

  test('audit log: filter + Clear, details open on demand, "Load older entries" pages in more', async ({ page, context }) => {
    await signIn(context, { superadmin: true });
    const mk = (i: number, action: string) => ({ id: crypto.randomUUID(), actorUserId: null, action, targetType: 'user', targetId: crypto.randomUUID(), metadata: { n: i }, createdAt: new Date().toISOString() });
    await page.route('**/api/superadmin/audit-log?*', async (r) => {
      const offset = Number(new URL(r.request().url()).searchParams.get('offset'));
      await r.fulfill({ json: offset === 0 ? Array.from({ length: 50 }, (_, i) => mk(i, i % 2 ? 'signup.approved' : 'plan.updated')) : [mk(99, 'plan.updated')] });
    });
    await page.goto('/admin/audit-log');
    await expect(page.locator('tbody tr')).toHaveCount(50);
    await page.getByLabel('Filter by action').selectOption({ label: 'Plan updated' });
    await expect(page.locator('.admin-toolbar-count')).toHaveText('25 shown');
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.locator('.admin-toolbar-count')).toHaveText('50 shown');
    const first = page.locator('details').first();
    await expect(first.locator('pre')).toBeHidden();
    await first.getByText('Show details').click();
    await expect(first.locator('pre')).toBeVisible();
    await page.getByRole('button', { name: 'Load older entries' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(51);
    await page.setViewportSize({ width: 390, height: 800 });
    expect(await noHScroll(page)).toBe(true);
  });

  test('audit log empty state', async ({ page, context }) => {
    await signIn(context, { superadmin: true });
    await page.route('**/api/superadmin/audit-log?*', (r) => r.fulfill({ json: [] }));
    await page.goto('/admin/audit-log');
    await expect(page.getByRole('heading', { name: 'Nothing recorded yet' })).toBeVisible();
  });
});
