import { expect, Page, test } from '@playwright/test';
import { APP } from './helpers';
import {
  ANDROID_APK_MIN_ANDROID,
  ANDROID_APK_URL,
  ANDROID_SIGNING_SHA256,
  PLAY_STORE_URL,
  androidInstall,
  androidLinkAttrs,
} from '../../web-app/src/lib/appLinks';

// The temporary direct-APK download on the home page and the /android help page (web-app/src/lib/appLinks.ts).

const APK = 'https://github.com/halleshubham/streambird-android/releases/latest/download/streambird.apk';
const PLAY = 'https://play.google.com/store/apps/details?id=com.shackyapps.streambird';
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe('appLinks helper', () => {
  test('offers the APK while there is no Play listing, and Play instead once PLAY_STORE_URL is set', () => {
    expect(ANDROID_APK_URL).toBe(APK);
    expect(ANDROID_APK_MIN_ANDROID).toBe('8.0');
    expect(PLAY_STORE_URL).toBeNull(); // flip this when the Play listing is live (and update this test)
    expect(androidInstall(null)).toMatchObject({ kind: 'apk', href: APK, label: 'Get the Android app', note: 'APK, direct download' });
    expect(androidInstall(PLAY)).toMatchObject({ kind: 'play', href: PLAY, label: 'Get it on Google Play' });
  });

  test('the APK link is a plain download link; the Play link opens in a new tab and never points at the APK', () => {
    expect(androidLinkAttrs(androidInstall(null))).toEqual({ href: APK, download: true, rel: 'noopener' });
    expect(androidLinkAttrs(androidInstall(PLAY))).toEqual({ href: PLAY, target: '_blank', rel: 'noopener' });
  });
});

for (const vp of [
  { name: 'desktop', width: 1366, height: 800 },
  { name: 'phone', width: 390, height: 800 },
]) {
  test.describe(`Android app download (${vp.name})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('home: hero button and the Android section link to the APK as a download', async ({ page }) => {
      await page.goto('/');
      for (const id of ['apk-download-hero', 'apk-download']) {
        const a = page.getByTestId(id);
        await expect(a).toBeVisible();
        await expect(a).toHaveAttribute('href', APK);
        await expect(a).toHaveAttribute('download', '');
        await expect(a).toHaveAttribute('rel', 'noopener');
      }
      await expect(page.getByTestId('apk-download-hero')).toContainText('Get the Android app');
      await expect(page.getByTestId('apk-download-hero')).toContainText('APK, direct download');
      const section = page.locator('#android');
      await expect(section.getByRole('heading', { level: 2, name: 'Stream from your phone' })).toBeVisible();
      await expect(section).toContainText('Android 8.0+');
      await expect(section).toContainText('Google Play listing coming soon');
      await expect(section.getByRole('link', { name: 'How to install' })).toHaveAttribute('href', '/android');
      await expect(page.locator('.pub-footer').getByRole('link', { name: 'Android app' })).toHaveAttribute('href', '/android');
      // The primary call to action stays "Go live free".
      await expect(page.getByRole('link', { name: 'Go live free' })).toHaveAttribute('href', '/login');
      expect(await noSideScroll(page)).toBe(true);
      // Both buttons fit inside the viewport.
      for (const id of ['apk-download-hero', 'apk-download']) {
        const box = (await page.getByTestId(id).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
      }
    });

    test('/android: steps, fingerprint, replacement note, links, no sideways scroll', async ({ page }) => {
      await page.goto('/android');
      await expect(page).toHaveTitle('Install the StreamBird Android app (APK)');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Install the StreamBird Android app (APK)');
      await expect(page.getByTestId('apk-download')).toHaveAttribute('href', APK);
      await expect(page.getByTestId('apk-download')).toHaveAttribute('download', '');
      const article = page.locator('#android-app');
      for (const text of ['Install unknown apps', 'unrecognised developer', 'Install anyway', 'sign in with Google or your email', 'Android 8.0 or newer']) {
        await expect(article).toContainText(new RegExp(text, 'i'));
      }
      await expect(page.locator('.pub-android-steps li')).toHaveCount(5);
      await expect(page.getByTestId('apk-fingerprint')).toHaveText(ANDROID_SIGNING_SHA256);
      await expect(article).toContainText('temporary way to install');
      await expect(article).toContainText('uninstall this version first');
      await expect(article).toContainText('Your account and streams are not affected');
      await expect(article.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
      await expect(article.getByRole('link', { name: 'support@shackyapps.in' })).toHaveAttribute('href', 'mailto:support@shackyapps.in');
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}

test.describe('crawler view of /android (JavaScript off)', () => {
  test.use({ javaScriptEnabled: false });

  test('the prerendered page has its content, canonical and the sitemap lists it', async ({ page, request }) => {
    await page.goto('/android');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByTestId('apk-download')).toHaveAttribute('href', APK);
    await expect(page.getByTestId('apk-fingerprint')).toHaveText(ANDROID_SIGNING_SHA256);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${APP}/android`);
    const xml = await (await request.get('/sitemap.xml')).text();
    expect(xml).toContain(`<loc>${APP}/android</loc>`);
    // The home page ships the button in its HTML too.
    await page.goto('/');
    await expect(page.getByTestId('apk-download')).toHaveAttribute('href', APK);
    await expect(page.getByTestId('apk-download-hero')).toHaveAttribute('href', APK);
  });
});
