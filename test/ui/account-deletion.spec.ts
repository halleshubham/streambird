import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as crypto from 'crypto';
import { APP, CONTROL, apiHeaders, signIn } from './helpers';

/** The public "delete your account" page and the in-app Account page with its delete dialog. */

const PHONE = { width: 390, height: 800 };
const DESKTOP = { width: 1366, height: 800 };

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

const deletionCode = async (page: Page, email: string) => {
  const { code } = await (await page.request.get(`${CONTROL}/deletion-code?email=${email}`)).json();
  return code as string;
};

test.describe('public page /delete-account', () => {
  for (const vp of [DESKTOP, PHONE]) {
    test(`explains how, what is deleted and kept, and the support alternative (${vp.width}px)`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto('/delete-account');
      await expect(page.getByRole('heading', { level: 1, name: 'Delete your StreamBird account and data' })).toBeVisible();
      for (const h of ['How to delete your account', 'Cannot log in?', 'What is deleted', 'What we keep, and for how long']) {
        await expect(page.getByRole('heading', { level: 2, name: h })).toBeVisible();
      }
      await expect(page.getByText('Delete account', { exact: false }).first()).toBeVisible();
      await expect(page.getByRole('link', { name: 'support@shackyapps.in' })).toHaveAttribute('href', 'mailto:support@shackyapps.in');
      await expect(page.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy#delete-account');
      await noSidewaysScroll(page);
    });
  }

  test('is reachable without logging in and linked from the home footer, the login page and the privacy policy', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Delete your account' })).toHaveAttribute('href', '/delete-account');
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'Delete your account' })).toHaveAttribute('href', '/delete-account');
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 2, name: 'Deleting your account and data' })).toBeVisible();
    await page.getByRole('link', { name: 'Delete your StreamBird account and data' }).click();
    await expect(page).toHaveURL(/\/delete-account$/);
  });
});

test.describe('Account page and the delete dialog', () => {
  test('shows my details and is reachable from the header link (desktop) and the More sheet (phone)', async ({ page, context }) => {
    const { email } = await signIn(context);
    await page.setViewportSize(DESKTOP);
    await page.goto('/dashboard');
    await page.getByRole('banner').getByRole('link', { name: email }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
    await expect(page.getByTestId('account-email')).toHaveText(email);
    await expect(page.getByText('Personal account')).toBeVisible();
    await noSidewaysScroll(page);

    await page.setViewportSize(PHONE);
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('dialog', { name: 'More' }).getByRole('link', { name: 'Account' }).click();
    await expect(page).toHaveURL(/\/account$/);
    await noSidewaysScroll(page);
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByRole('dialog', { name: 'Account' }).getByRole('link', { name: 'Account' })).toBeVisible();
  });

  test('wrong code is refused and nothing is deleted; the right code deletes, signs out and lands on the confirmation page', async ({ page, context }) => {
    const { email, api } = await signIn(context);
    await page.setViewportSize(DESKTOP);
    await page.goto('/account');
    await page.getByRole('button', { name: 'Delete account' }).click();

    const dialog = page.getByRole('alertdialog', { name: 'Delete your account' });
    await expect(dialog.getByTestId('delete-warnings')).toContainText('Your whole account is permanently deleted');
    const destroy = dialog.getByRole('button', { name: 'Delete account permanently' });
    await expect(destroy).toBeDisabled();
    // A solo account has no company tick.
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Send confirmation code' }).click();
    await expect(dialog.getByRole('status').filter({ hasText: 'We sent a 6-digit code' })).toContainText(email);
    const code = await deletionCode(page, email);
    expect(code).toMatch(/^\d{6}$/);

    const field = dialog.getByLabel('Confirmation code');
    await field.fill(code === '000000' ? '111111' : '000000');
    await destroy.click();
    await expect(dialog.getByRole('alert')).toContainText('Incorrect code');
    expect((await api.get(`${APP}/api/auth/me`)).ok()).toBeTruthy(); // still there

    await field.fill(code);
    await destroy.click();
    await expect(page).toHaveURL(/\/account-deleted$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Your account was deleted' })).toBeVisible();
    expect((await api.get(`${APP}/api/auth/me`)).status()).toBe(401);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('the only admin of a company with members must tick the company-deletion box before the button works', async ({ page, context }) => {
    const { email, api } = await signIn(context);
    await page.request.post(`${CONTROL}/make-company-admin?email=${email}&name=Acme%20Media`);
    for (let i = 0; i < 2; i++) {
      const r = await api.post(`${APP}/api/team/invite`, { data: { email: `m${i}-${crypto.randomBytes(3).toString('hex')}@test.dev` }, headers: apiHeaders });
      expect(r.ok()).toBeTruthy();
    }
    await page.setViewportSize(PHONE);
    await page.goto('/account');
    await expect(page.getByText('Acme Media')).toBeVisible();
    await expect(page.getByText('Company admin')).toBeVisible();
    await page.getByRole('button', { name: 'Delete account' }).click();

    const dialog = page.getByRole('alertdialog', { name: 'Delete your account' });
    await expect(dialog.getByTestId('delete-warnings')).toContainText('2 other people');
    const tick = dialog.getByRole('checkbox', { name: /deletes the whole company account for all 3 people/ });
    await dialog.getByRole('button', { name: 'Send confirmation code' }).click();
    await dialog.getByLabel('Confirmation code').fill(await deletionCode(page, email));
    const destroy = dialog.getByRole('button', { name: 'Delete account permanently' });
    await expect(destroy).toBeDisabled();
    await noSidewaysScroll(page);
    await tick.check();
    await expect(destroy).toBeEnabled();
    await destroy.click();
    await expect(page).toHaveURL(/\/account-deleted$/);
    expect((await context.request.get(`${APP}/api/auth/me`)).status()).toBe(401);
  });

  test('Cancel closes the dialog and keeps the account', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/account');
    await page.getByRole('button', { name: 'Delete account' }).click();
    await page.getByRole('alertdialog', { name: 'Delete your account' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
  });
});
