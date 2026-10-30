import { expect, test } from '@playwright/test';
import * as crypto from 'crypto';

const CONTROL = `http://127.0.0.1:${process.env.UI_CONTROL_PORT ?? 4311}`;
const APP = `http://127.0.0.1:${process.env.UI_APP_PORT ?? 4310}`;

test('Connections page shows each YouTube/Facebook connection its permanent live link, with a working Copy button', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP });
  const email = `ui-${crypto.randomBytes(5).toString('hex')}@test.dev`;
  const headers = { Origin: APP };
  await context.request.post(`${APP}/api/auth/request-code`, { data: { email }, headers });
  const { code } = await (await context.request.get(`${CONTROL}/code?email=${email}`)).json();
  expect((await context.request.post(`${APP}/api/auth/verify-code`, { data: { email, code }, headers })).ok()).toBeTruthy();
  await context.request.post(`${CONTROL}/approve?email=${email}`);

  const yt = await (await context.request.post(`${CONTROL}/add-connection?email=${email}&platform=youtube&label=${encodeURIComponent('Studio Channel')}`)).json();
  const fb = await (await context.request.post(`${CONTROL}/add-connection?email=${email}&platform=facebook&label=${encodeURIComponent('Studio Page')}`)).json();
  await context.request.post(`${APP}/api/platform-connections/twitch/manual`, {
    data: { label: 'Studio Twitch', ingestServerUrl: 'rtmp://live.example/app', streamKey: crypto.randomBytes(8).toString('hex') },
    headers: { ...headers, 'Content-Type': 'application/json' },
  });

  await page.goto('/connections');
  const links = page.getByTestId('live-link');
  await expect(links).toHaveCount(2); // Twitch has none

  const ytUrl = `${APP}/stream/${yt.liveSlug}`;
  await expect(page.getByText(ytUrl, { exact: true })).toBeVisible();
  await expect(page.getByText(`${APP}/stream/${fb.liveSlug}`, { exact: true })).toBeVisible();
  await expect(links.first()).toContainText('Share this one link. It opens your live stream when you are live, and your channel otherwise.');

  const copy = page.getByRole('button', { name: 'Copy live link for Studio Channel' });
  await expect(page.getByRole('button', { name: 'Copy live link for Studio Page' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Copy live link for Studio Twitch/ })).toHaveCount(0);
  await copy.click();
  await expect(copy).toContainText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ytUrl);

  // The link itself works for a visitor: nothing live, so it points at the channel (checked without following it).
  const hop = await context.request.get(ytUrl, { maxRedirects: 0 });
  expect(hop.status()).toBe(302);
  expect(hop.headers()['location']).toMatch(/^https:\/\/www\.youtube\.com\/channel\/ui\d+$/);

  // No sideways scroll on a phone.
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
