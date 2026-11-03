import { expect, Page, test } from '@playwright/test';
import * as crypto from 'crypto';
import { APP, CONTROL } from './helpers';

// Public + auth pages of the redesign (landing, legal, 404, login, sign-up, mobile step, approval wait, cookie strip),
// at desktop and 390px: the content is there, the links work, nothing scrolls sideways.

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const newEmail = () => `ui-${crypto.randomBytes(5).toString('hex')}@test.dev`;
const bannerMode = (page: Page, on: boolean) =>
  page.route('**/api/config/public', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ cookieConsentBanner: on }) }));

const VIEWPORTS = [
  { name: 'desktop', width: 1366, height: 800 },
  { name: 'phone', width: 390, height: 800 },
];

for (const vp of VIEWPORTS) {
  test.describe(`public pages (${vp.name})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('landing: hero, sections, links, no sideways scroll', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Go live once.');
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Be everywhere.');
      await expect(page.locator('.hero-studio')).toBeVisible();
      for (const h of ['Everything a live production needs, built in', 'Three steps. Then you are live.', 'Start free. Pay when you grow.', 'Questions, answered', 'Ready when you are.']) {
        await expect(page.getByRole('heading', { level: 2, name: h })).toBeVisible();
      }
      await expect(page.getByRole('link', { name: 'Go live free' })).toHaveAttribute('href', '/login');
      await expect(page.getByRole('link', { name: 'Log in' }).first()).toHaveAttribute('href', '/login');
      await expect(page.getByRole('link', { name: 'Create company' })).toHaveAttribute('href', '/signup-company');
      await expect(page.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
      await expect(page.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
      await expect(page.getByRole('link', { name: 'Docs' }).last()).toHaveAttribute('href', 'https://shackyapps.in/docs/streambird/');
      expect(await noSideScroll(page)).toBe(true);
    });

    test('landing: pricing shows the live plans and the USD/INR toggle switches every price', async ({ page }) => {
      await page.goto('/');
      const pricing = page.locator('#pricing');
      const usd = pricing.getByRole('button', { name: 'USD' });
      const inr = pricing.getByRole('button', { name: /^INR/ });
      await usd.click();
      await expect(usd).toHaveAttribute('aria-pressed', 'true');
      await expect(pricing.locator('.pub-price').first()).toContainText('$');
      await inr.click();
      await expect(inr).toHaveAttribute('aria-pressed', 'true');
      await expect(pricing.locator('.pub-price').first()).toContainText('₹');
      await expect(pricing.getByRole('heading', { name: 'Free', exact: true })).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
    });

    test('landing: with payments on, paid plans link to /billing?plan=<key>', async ({ page }) => {
      await page.route('**/api/billing/config', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: true, keyId: 'x' }) }));
      await page.goto('/');
      const buy = page.locator('#pricing').getByRole('link', { name: 'Buy' });
      await expect(buy.first()).toBeVisible();
      expect(await buy.first().getAttribute('href')).toMatch(/^\/billing\?plan=[a-z_]+$/);
    });

    test('landing: the FAQ opens and closes', async ({ page }) => {
      await page.goto('/');
      const second = page.locator('#faq details').nth(1);
      await expect(second).not.toHaveAttribute('open', '');
      await second.locator('summary').click();
      await expect(second).toHaveAttribute('open', '');
      await expect(second.locator('p')).toBeVisible();
    });

    test('privacy and terms: shared layout, switch between the two routes, #cookies anchor, no sideways scroll', async ({ page }) => {
      await page.goto('/privacy#cookies');
      await expect(page.getByRole('heading', { level: 1, name: 'StreamBird Privacy Policy' })).toBeVisible();
      await expect(page.getByRole('heading', { name: /Cookies, analytics/ })).toBeInViewport();
      const sw = page.getByRole('navigation', { name: 'Legal documents' });
      await expect(sw.getByRole('link', { name: 'Privacy' })).toHaveAttribute('aria-current', 'page');
      expect(await noSideScroll(page)).toBe(true);
      await sw.getByRole('link', { name: 'Terms' }).click();
      await expect(page).toHaveURL(/\/terms$/);
      await expect(page.getByRole('heading', { level: 1, name: 'StreamBird Terms of Service' })).toBeVisible();
      await expect(sw.getByRole('link', { name: 'Terms' })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
      expect(await noSideScroll(page)).toBe(true);
    });

    test('404: friendly page with a way home', async ({ page }) => {
      await page.goto('/no-such-page');
      await expect(page.getByRole('heading', { level: 1, name: 'This page flew away' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
      await expect(page.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
      expect(await noSideScroll(page)).toBe(true);
    });

    test('login: email step, code step, back to a different email', async ({ page }) => {
      const email = newEmail();
      await page.goto('/login');
      await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Create your company account' })).toHaveAttribute('href', '/signup-company');
      expect(await noSideScroll(page)).toBe(true);
      await page.fill('#email', email);
      await page.getByRole('button', { name: /Send login code/ }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
      await expect(page.getByText(email)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Log in' })).toBeDisabled();
      expect(await noSideScroll(page)).toBe(true);
      await page.getByRole('button', { name: 'Use a different email' }).click();
      await expect(page.locator('#email')).toBeVisible();
    });

    test('login: a wrong code shows an error next to the field', async ({ page }) => {
      const email = newEmail();
      await page.goto('/login');
      await page.fill('#email', email);
      await page.getByRole('button', { name: /Send login code/ }).click();
      await page.fill('#code', '000000');
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
    });

    test('sign-up company: details step, then code step, terms and privacy linked', async ({ page }) => {
      const email = newEmail();
      await page.goto('/signup-company');
      await expect(page.getByRole('heading', { level: 1, name: 'Create your company account' })).toBeVisible();
      await expect(page.getByText('Step 1 of 2')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Terms', exact: true })).toHaveAttribute('href', '/terms');
      await expect(page.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy');
      await expect(page.getByRole('button', { name: 'Send verification code' })).toBeDisabled();
      expect(await noSideScroll(page)).toBe(true);
      await page.getByLabel('Company name').fill('Acme Studios');
      await page.getByLabel('Your email').fill(email);
      await page.getByRole('button', { name: 'Send verification code' }).click();
      await expect(page.getByText('Step 2 of 2')).toBeVisible();
      await expect(page.getByLabel('Verification code')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
    });

    test('mobile number step and the approval wait page after a fresh sign-up', async ({ page }) => {
      const email = newEmail();
      await page.goto('/login');
      await page.fill('#email', email);
      await page.getByRole('button', { name: /Send login code/ }).click();
      await page.waitForSelector('#code');
      const { code } = await (await page.request.get(`${CONTROL}/code?email=${email}`)).json();
      await page.fill('#code', code);
      await page.getByRole('button', { name: 'Log in' }).click();

      await expect(page.getByRole('heading', { level: 1, name: 'One last thing' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
      await page.getByLabel('Mobile number').fill('9876543210');
      await page.getByRole('button', { name: 'Continue' }).click();

      await expect(page.getByRole('heading', { level: 1, name: 'Your studio is being set up!' })).toBeVisible();
      await expect(page.getByRole('list', { name: 'Setup progress' }).locator('li')).toHaveCount(4);
      await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
    });

    test('admin login: password step on the shared auth layout', async ({ page }) => {
      await page.goto('/admin/login');
      await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
      await expect(page.getByText('ADMIN', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Email')).toBeVisible();
      await expect(page.getByLabel('Password')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}

test.describe('cookie strip', () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // a first-time visitor

  for (const vp of VIEWPORTS) {
    test(`shows once, Reject and Accept look alike, link to #cookies (${vp.name})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await bannerMode(page, true);
      await page.goto('/');
      const banner = page.getByRole('region', { name: 'Cookie consent' });
      await expect(banner).toBeVisible();
      await expect(banner.getByRole('link', { name: /how we use cookies/ })).toHaveAttribute('href', '/privacy#cookies');
      const [a, b] = await Promise.all(
        ['Reject', 'Accept'].map((n) => banner.getByRole('button', { name: n }).evaluate((el) => {
          const cs = getComputedStyle(el);
          return [cs.backgroundColor, cs.color, cs.borderTopColor, cs.fontWeight].join('|');
        })),
      );
      expect(a).toBe(b); // neither answer is nudged
      expect(await noSideScroll(page)).toBe(true);
      await banner.getByRole('button', { name: 'Reject' }).click();
      await expect(banner).toHaveCount(0);
    });
  }
});
