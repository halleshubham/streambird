import { expect, Page, test } from '@playwright/test';
import { signIn } from './helpers';

// The homepage is a homepage for everyone: a signed-in visitor is not redirected, the header button becomes "Dashboard".

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const VIEWPORTS = [
  { name: 'desktop', width: 1366, height: 800 },
  { name: 'phone', width: 390, height: 800 },
];

for (const vp of VIEWPORTS) {
  test.describe(`home page for a signed-in visitor (${vp.name})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('stays on / with the marketing page and a Dashboard button that opens the dashboard', async ({ page, context }) => {
      await signIn(context);
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Go live once.');
      const nav = page.getByTestId('nav-dashboard');
      await expect(nav).toHaveText('Dashboard');
      await expect(nav).toHaveAttribute('href', '/dashboard');
      await expect(page.getByRole('link', { name: 'Log in' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Go live free' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Open dashboard' }).first()).toHaveAttribute('href', '/dashboard');
      await expect(page.getByRole('link', { name: 'Create company' })).toHaveCount(0);
      await expect(page.locator('#pricing')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
      await expect(page).toHaveURL(/\/$/);
      await nav.click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByText('Stream hours this period')).toBeVisible();
    });

    test('the pricing section (/#pricing) keeps the page and the Dashboard button', async ({ page, context }) => {
      await signIn(context);
      await page.goto('/#pricing');
      await expect(page.locator('#pricing')).toBeVisible();
      await expect(page).toHaveURL(/\/#pricing$/);
      await expect(page.getByTestId('nav-dashboard')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
    });

    test('an unknown URL shows Dashboard instead of Log in', async ({ page, context }) => {
      await signIn(context);
      await page.goto('/no-such-page');
      await expect(page.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
      await expect(page.getByRole('link', { name: 'Log in' })).toHaveCount(0);
    });
  });

  test.describe(`home page for an anonymous visitor (${vp.name})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, storageState: { cookies: [], origins: [] } });

    test('still shows Log in and the sign-up calls to action, and no Dashboard button', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('link', { name: 'Log in' }).first()).toHaveAttribute('href', '/login');
      await expect(page.getByRole('link', { name: 'Go live free' })).toHaveAttribute('href', '/login');
      await expect(page.getByRole('link', { name: 'Create company' })).toBeVisible();
      await expect(page.getByTestId('nav-dashboard')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
