import { expect, test } from '@playwright/test';
import { APP } from './helpers';

// Search/crawler view of the public pages: what is in the served HTML before any JavaScript runs, the head tags the
// SPA keeps in step per route, JSON-LD, the 404 status, and the sitemap matching the canonical URLs.

const PUBLIC = ['/', '/privacy', '/terms', '/delete-account'];

test.describe('crawler view (JavaScript off)', () => {
  test.use({ javaScriptEnabled: false });

  test('landing: one h1, sections, pricing plans and FAQ are in the HTML', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Go live once.');
    for (const h of ['Everything a live production needs, built in', 'Start free. Pay when you grow.', 'Questions, answered']) {
      await expect(page.getByRole('heading', { level: 2, name: h })).toBeAttached();
    }
    const pricing = page.locator('#pricing');
    for (const plan of ['Free', 'Lite', 'Starter', 'Pro', 'Business']) await expect(pricing.getByRole('heading', { name: plan, exact: true })).toBeAttached();
    await expect(page.locator('#faq')).toContainText('Do I need to install anything?');
    await expect(page.locator('main')).toHaveCount(1);
    // No heading level is skipped inside the page.
    const levels = await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,h4')].map((h) => Number(h.tagName[1])));
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  });

  for (const path of PUBLIC) {
    test(`${path}: title, description, canonical, social tags and robots are in the HTML`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      const title = await page.title();
      expect(title.length).toBeGreaterThan(10);
      expect(title.length).toBeLessThanOrEqual(65);
      const meta = (sel: string) => page.locator(sel).getAttribute('content');
      const desc = (await meta('meta[name="description"]'))!;
      expect(desc.length).toBeGreaterThan(60);
      expect(desc.length).toBeLessThanOrEqual(165);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${APP}${path}`);
      expect(await meta('meta[property="og:title"]')).toBe(title);
      expect(await meta('meta[property="og:image"]')).toBe(`${APP}/og-image.png`);
      expect(await meta('meta[name="twitter:card"]')).toBe('summary_large_image');
      expect(await meta('meta[name="robots"]')).toContain('index');
      expect(await meta('meta[name="robots"]')).not.toContain('noindex');
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    });
  }

  test('landing JSON-LD parses and describes the organisation, website and web app', async ({ page }) => {
    await page.goto('/');
    const raw = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(raw).toHaveLength(1);
    const graph = JSON.parse(raw[0])['@graph'] as Array<Record<string, any>>;
    expect(graph.map((n) => n['@type'])).toEqual(['Organization', 'WebSite', 'WebApplication']);
    const app = graph[2];
    expect(app.name).toBe('StreamBird');
    expect(app.url).toBe(`${APP}/`);
    expect(app.offers.price).toBe('0');
    expect(app.aggregateRating).toBeUndefined();
  });

  test('the share image exists, is 1200x630 and is small', async ({ request }) => {
    const res = await request.get('/og-image.png');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
    const body = await res.body();
    expect(body.readUInt32BE(16)).toBe(1200);
    expect(body.readUInt32BE(20)).toBe(630);
    expect(body.length).toBeLessThan(150 * 1024);
  });
});

test.describe('head tags follow the route', () => {
  test('the sitemap lists exactly the pages that declare themselves canonical', async ({ page, request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.sort()).toEqual(PUBLIC.map((p) => `${APP}${p}`).sort());
    for (const loc of locs) {
      await page.goto(loc);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', loc);
    }
  });

  test('client-side navigation swaps title, canonical and robots; app pages are noindex', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page).toHaveTitle('Privacy Policy | StreamBird');
    await page.getByRole('link', { name: 'Terms' }).click();
    await expect(page).toHaveTitle('Terms of Service | StreamBird');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${APP}/terms`);
    await page.goto('/login');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page).toHaveTitle('Log in | StreamBird');
    await page.goto('/join/abc');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('app and guest pages are served with X-Robots-Tag noindex', async ({ request }) => {
    for (const path of ['/dashboard', '/streams/new', '/admin', '/join/abc', '/login']) {
      const res = await request.get(path);
      expect(res.headers()['x-robots-tag']).toMatch(/noindex/);
    }
  });

  test('an unknown URL is a real 404 that still shows the friendly page', async ({ page }) => {
    const res = await page.goto('/this-page-does-not-exist');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'This page flew away' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('the landing page keeps its content while the session check runs and is not duplicated after it', async ({ page }) => {
    await page.route('**/api/auth/me', async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Go live once.'); // already there during the wait
    await expect(page.locator('.pub-hero')).toHaveCount(1);
    await page.waitForTimeout(1200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Go live free' })).toHaveAttribute('href', '/login');
    await expect(page.locator('#pricing').getByRole('button', { name: 'INR' })).toBeVisible();
  });
});
