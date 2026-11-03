import { expect, test, type Page } from '@playwright/test';
import { APP, acceptConfirm, apiHeaders, cancelConfirm, confirmDialog, signIn } from './helpers';
import { cx, initialsFor, nextFocusIndex, toastDurationMs, typedConfirmationMatches } from '../../web-app/src/components/ui/helpers';

// The redesign foundation: UI kit (confirm dialog, toasts, sheets) and the app shells (header, phone tab bar, admin).

test.describe('ui kit helpers (pure)', () => {
  test('nextFocusIndex wraps in both directions and pulls stray focus in', () => {
    expect(nextFocusIndex(0, 3, false)).toBe(1);
    expect(nextFocusIndex(2, 3, false)).toBe(0);
    expect(nextFocusIndex(0, 3, true)).toBe(2);
    expect(nextFocusIndex(2, 3, true)).toBe(1);
    expect(nextFocusIndex(-1, 3, false)).toBe(0);
    expect(nextFocusIndex(-1, 3, true)).toBe(2);
    expect(nextFocusIndex(0, 0, false)).toBe(-1);
  });

  test('typedConfirmationMatches ignores case and surrounding spaces but needs the whole phrase', () => {
    expect(typedConfirmationMatches('Old Mill Radio', 'Old Mill Radio')).toBe(true);
    expect(typedConfirmationMatches('  old mill radio ', 'Old Mill Radio')).toBe(true);
    expect(typedConfirmationMatches('Old Mill', 'Old Mill Radio')).toBe(false);
    expect(typedConfirmationMatches('', 'Old Mill Radio')).toBe(false);
    expect(typedConfirmationMatches('x', '')).toBe(false);
  });

  test('toastDurationMs keeps errors and actionable toasts longer', () => {
    expect(toastDurationMs('success', false)).toBe(4000);
    expect(toastDurationMs('error', false)).toBe(8000);
    expect(toastDurationMs('success', true)).toBe(10000);
  });

  test('initialsFor and cx', () => {
    expect(initialsFor('maya.k@acme.example')).toBe('MK');
    expect(initialsFor('you@acme.example')).toBe('YO');
    expect(initialsFor('')).toBe('?');
    expect(initialsFor(null)).toBe('?');
    expect(cx('a', false, null, undefined, 'b')).toBe('a b');
  });
});

async function addTwitch(api: Awaited<ReturnType<typeof signIn>>['api'], label: string): Promise<void> {
  const res = await api.post(`${APP}/api/platform-connections/twitch/manual`, {
    data: { label, ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' },
    headers: apiHeaders,
  });
  expect(res.ok()).toBeTruthy();
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('confirm dialog (replaces window.confirm)', () => {
  test('destructive: alertdialog named by its title, focus starts on Cancel and stays trapped, Esc cancels and returns focus, confirm runs the action', async ({ page, context }) => {
    const { api } = await signIn(context);
    await addTwitch(api, 'Kit Twitch');
    await page.goto('/connections');
    const remove = page.getByRole('button', { name: /Remove/ }).first();
    await remove.click();

    const dialog = page.getByRole('alertdialog', { name: 'Remove Kit Twitch?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toContainText('revoke its access');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused(); // safe default for destructive actions
    const confirm = dialog.getByRole('button', { name: 'Remove connection' });
    // Destructive = the red button with white text.
    await expect(confirm).toHaveCSS('background-color', 'rgb(201, 48, 47)');

    // Tab cycles Cancel -> Remove connection -> Cancel; focus never leaves the dialog.
    await page.keyboard.press('Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirm).toBeFocused();

    // Esc cancels: nothing removed, focus is back on the button that opened it.
    await page.keyboard.press('Escape');
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(remove).toBeFocused();
    await expect(page.getByText('Kit Twitch').first()).toBeVisible();

    // Clicking the scrim does not dismiss a destructive dialog; Cancel does.
    await remove.click();
    await page.mouse.click(5, 5);
    await expect(confirmDialog(page)).toBeVisible();
    await cancelConfirm(page);
    await expect(page.getByText('Kit Twitch').first()).toBeVisible();

    // Confirm runs the action.
    await remove.click();
    await acceptConfirm(page);
    await expect(page.getByText('Kit Twitch')).toHaveCount(0);
  });

  test('typed confirmation: the button stays off until the company name is typed (suspend account); reactivate is a plain dialog that starts on its confirm button', async ({ page, context, browser }) => {
    const target = await signIn(await browser.newContext());
    await signIn(context, { superadmin: true });
    await page.goto('/admin/accounts');
    await page.getByLabel('Search companies').fill(target.email);
    await page.getByRole('link', { name: target.email }).first().click();
    await page.getByRole('button', { name: 'Suspend account' }).click();

    const dialog = confirmDialog(page);
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('alertdialog', { name: /^Suspend / })).toBeVisible();
    const accept = dialog.getByTestId('confirm-accept');
    const input = dialog.getByLabel('Type the company name to confirm');
    await expect(input).toBeFocused();
    await expect(accept).toBeDisabled();
    await input.fill('not it');
    await expect(accept).toBeDisabled();
    await input.fill(target.email.toUpperCase()); // case and spaces are forgiven
    await expect(accept).toBeEnabled();
    await accept.click();
    await expect(page.getByRole('heading', { level: 1 }).getByText('Suspended')).toBeVisible();

    // Reactivating is not destructive: role=dialog, focus on the confirm button.
    await page.getByRole('button', { name: 'Reactivate account' }).click();
    await expect(page.getByRole('dialog', { name: /^Reactivate / })).toBeVisible();
    await expect(confirmDialog(page).getByTestId('confirm-accept')).toBeFocused();
    await acceptConfirm(page);
    await expect(page.getByRole('heading', { level: 1 }).getByText('Active')).toBeVisible();
  });
});

test.describe('toasts', () => {
  test('success is a polite status, errors are alerts with an action; Dismiss and the action work; nothing blocks the page', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/dashboard');
    await page.evaluate(() => {
      const w = window as unknown as { __undone?: number };
      window.dispatchEvent(new CustomEvent('streambird:toast', { detail: { kind: 'success', message: 'Preset saved', action: { label: 'Undo', onClick: () => (w.__undone = (w.__undone ?? 0) + 1) } } }));
      window.dispatchEvent(new CustomEvent('streambird:toast', { detail: { kind: 'error', message: "Couldn't reach Twitch. Try again." } }));
    });
    const ok = page.getByRole('status').filter({ hasText: 'Preset saved' });
    const err = page.getByRole('alert').filter({ hasText: "Couldn't reach Twitch" });
    await expect(ok).toBeVisible();
    await expect(err).toBeVisible();
    // The page behind stays usable (toasts never trap focus or cover the nav).
    await expect(page.getByRole('link', { name: 'Connections' })).toBeVisible();

    await ok.getByRole('button', { name: 'Undo' }).click();
    await expect(ok).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __undone?: number }).__undone)).toBe(1);

    await err.getByRole('button', { name: 'Dismiss notification' }).click();
    await expect(err).toHaveCount(0);
  });

  test('a plain success toast disappears by itself', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/dashboard');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('streambird:toast', { detail: { kind: 'info', message: 'Join link copied', durationMs: 600 } })));
    const t = page.getByRole('status').filter({ hasText: 'Join link copied' });
    await expect(t).toBeVisible();
    await expect(t).toHaveCount(0, { timeout: 5000 });
  });
});

test.describe('app shell', () => {
  test('desktop: sticky header with the usual link names, Log out, no tab bar', async ({ page, context }) => {
    await page.setViewportSize({ width: 1366, height: 800 });
    const { email } = await signIn(context);
    await page.goto('/dashboard');
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const name of ['Dashboard', 'Upcoming', 'Connections', 'Brand', 'Billing']) await expect(nav.getByRole('link', { name })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Tab bar' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeHidden();
    // Sticky: still at the top after scrolling.
    await page.evaluate(() => {
      (document.querySelector('.app-main') as HTMLElement).style.minHeight = '3000px';
      window.scrollTo(0, 1200);
    });
    expect((await page.locator('.app-header').boundingBox())!.y).toBe(0);
    await page.screenshot({ path: 'test-results/shell-desktop.png' });
  });

  test('phone (390px): bottom tab bar with Home/Upcoming/Connect/Brand/More, More sheet (Billing, Docs, Log out), no horizontal scroll, toasts sit above the bar', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await signIn(context);
    await page.goto('/dashboard');
    const bar = page.getByRole('navigation', { name: 'Tab bar' });
    await expect(bar).toBeVisible();
    for (const name of ['Home', 'Upcoming', 'Connect', 'Brand']) await expect(bar.getByRole('link', { name })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden(); // desktop nav is replaced, never both
    await noHorizontalScroll(page);
    const box = (await bar.boundingBox())!;
    expect(Math.round(box.y + box.height)).toBe(800); // pinned to the bottom edge
    for (const el of await bar.getByRole('link').all()) expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // A toast sits above the bar, not under it.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('streambird:toast', { detail: { kind: 'success', message: 'Above the bar' } })));
    const toastBox = (await page.getByRole('status').filter({ hasText: 'Above the bar' }).boundingBox())!;
    expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(box.y);
    await page.screenshot({ path: 'test-results/shell-phone.png' });

    // Navigation through the bar.
    await bar.getByRole('link', { name: 'Connect' }).click();
    await expect(page).toHaveURL(/\/connections$/);
    await noHorizontalScroll(page);

    // More: a bottom sheet with Billing, Docs and Log out; Esc closes it and focus returns to More.
    const more = bar.getByRole('button', { name: 'More' });
    await more.click();
    const sheet = page.getByRole('dialog', { name: 'More' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Billing' })).toBeVisible();
    await expect(sheet.getByRole('link', { name: /Docs/ })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Log out' })).toBeVisible();
    await page.screenshot({ path: 'test-results/shell-phone-more.png' });
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(more).toBeFocused();

    await more.click();
    await page.getByRole('dialog', { name: 'More' }).getByRole('link', { name: 'Billing' }).click();
    await expect(page).toHaveURL(/\/billing$/);
    await expect(page.getByRole('dialog', { name: 'More' })).toHaveCount(0);
    await noHorizontalScroll(page);

    // The avatar opens the account sheet with Log out.
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/(login)?$/);
  });

  test('admin shell: ADMIN badge, nav with the pending count, sticky header', async ({ page, context }) => {
    await page.setViewportSize({ width: 1366, height: 800 });
    await signIn(context, { superadmin: true });
    await page.goto('/admin');
    await expect(page.locator('.admin-badge')).toHaveText('ADMIN');
    const nav = page.getByRole('navigation', { name: 'Admin' });
    for (const name of ['Approvals', 'Companies', 'Plans', 'Billing', 'Analytics', 'Audit log']) await expect(nav.getByRole('link', { name })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Tab bar' })).toHaveCount(0);
    expect((await page.locator('.app-header').boundingBox())!.y).toBe(0);
    await page.screenshot({ path: 'test-results/shell-admin.png' });
    await page.setViewportSize({ width: 390, height: 800 });
    await noHorizontalScroll(page);
  });
});
