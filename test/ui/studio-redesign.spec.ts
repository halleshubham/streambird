import { expect, Page, test } from '@playwright/test';
import { APP, apiHeaders, signIn } from './helpers';

// Redesigned studio + guest chrome: Customize drawer/sheet, dock popovers, live layout, guest join/call.

type Api = Awaited<ReturnType<typeof signIn>>['api'];

async function makeStream(api: Api) {
  const conn = await (
    await api.post(`${APP}/api/platform-connections/twitch/manual`, { data: { label: 'Redesign Twitch', ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' }, headers: apiHeaders })
  ).json();
  return (await (await api.post(`${APP}/api/streams`, { data: { title: 'Friday product demo', destinationConnectionIds: [conn.id] }, headers: apiHeaders })).json()) as { id: string; studioSessionId: string };
}

const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe('host studio chrome', () => {
  test('desktop: Customize drawer is open beside the picture, closes and reopens from the top bar, remembered', async ({ page, context }) => {
    await page.setViewportSize({ width: 1366, height: 800 });
    const { api } = await signIn(context);
    const stream = await makeStream(api);
    await page.goto(`/streams/${stream.id}/studio`);
    const drawer = page.locator('#studio-side-panels');
    await expect(drawer).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Friday product demo' })).toBeVisible();
    const box = (await drawer.boundingBox())!;
    expect(box.x + box.width).toBeGreaterThan(1360); // docked to the right edge
    expect(box.height).toBeGreaterThan(780);
    // The picture and the dock stay clear of the drawer.
    const canvas = (await page.locator('canvas.studio-canvas').boundingBox())!;
    expect(canvas.x + canvas.width).toBeLessThanOrEqual(box.x);
    const dock = (await page.getByRole('toolbar', { name: 'Live controls' }).boundingBox())!;
    expect(dock.x + dock.width).toBeLessThanOrEqual(box.x);
    expect(await noHScroll(page)).toBe(true);

    await page.getByRole('button', { name: 'Close customize' }).click();
    await expect(drawer).toBeHidden();
    await page.reload();
    await expect(page.getByRole('toolbar', { name: 'Live controls' })).toBeVisible();
    await expect(drawer).toBeHidden(); // remembered
    await page.getByRole('toolbar', { name: 'Studio controls' }).getByRole('button', { name: 'Customize' }).click();
    await expect(drawer).toBeVisible();
    await expect(page.getByRole('tab', { name: /^People/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('tabs keep their arrow-key behaviour inside the drawer', async ({ page, context }) => {
    await page.setViewportSize({ width: 1366, height: 800 });
    const { api } = await signIn(context);
    const stream = await makeStream(api);
    await page.goto(`/streams/${stream.id}/studio`);
    const tabs = page.getByRole('tablist', { name: 'Studio panels' });
    await page.getByRole('tab', { name: /^People/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: /^Look/ })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(tabs.getByRole('tab', { name: 'Ads' })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tabs.getByRole('tab', { name: /^People/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('camera/mic chooser opens above the dock, fully on screen; invite popover opens under the top bar', async ({ page, context }) => {
    await page.setViewportSize({ width: 1366, height: 800 });
    const { api } = await signIn(context);
    const stream = await makeStream(api);
    await page.goto(`/streams/${stream.id}/studio`);
    const dock = page.getByRole('toolbar', { name: 'Live controls' });
    await dock.getByRole('button', { name: 'Choose camera and microphone' }).click();
    const pop = page.getByRole('dialog', { name: 'Camera and microphone' });
    await expect(pop).toBeVisible();
    const p = (await pop.boundingBox())!;
    const d = (await dock.boundingBox())!;
    expect(p.y + p.height).toBeLessThanOrEqual(d.y); // above the dock, not clipped by it
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeGreaterThanOrEqual(0);
    await dock.getByRole('button', { name: 'Choose camera and microphone' }).click();

    await page.getByRole('button', { name: 'Invite password options' }).click();
    const inv = page.getByRole('dialog', { name: 'Invite link settings' });
    await expect(inv).toBeVisible();
    const ib = (await inv.boundingBox())!;
    expect(ib.y).toBeGreaterThan(40);
    expect(ib.x + ib.width).toBeLessThanOrEqual(1366);
    expect(ib.x).toBeGreaterThanOrEqual(0);
  });

  test('phone: Customize is a bottom sheet above the dock, controls stay reachable, no sideways scroll', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const { api } = await signIn(context);
    const stream = await makeStream(api);
    await page.goto(`/streams/${stream.id}/studio`);
    const dock = page.getByRole('toolbar', { name: 'Live controls' });
    await expect(dock).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
    await expect(page.locator('#studio-side-panels')).toBeHidden();
    // Top-bar chip is the desktop entry; the dock button is the phone entry.
    await expect(page.getByRole('toolbar', { name: 'Studio controls' }).getByRole('button', { name: 'Customize' })).toBeHidden();
    await dock.getByRole('button', { name: 'Customize' }).click();
    const sheet = (await page.locator('#studio-side-panels').boundingBox())!;
    const dbox = (await dock.boundingBox())!;
    expect(sheet.x).toBeGreaterThanOrEqual(0);
    expect(sheet.x + sheet.width).toBeLessThanOrEqual(390);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(dbox.y);
    await page.getByRole('tab', { name: /^Look/ }).click();
    await expect(page.locator('#wallpaperInput')).toBeAttached();
    expect(await noHScroll(page)).toBe(true);
    await page.getByRole('button', { name: 'Close customize' }).click();
    await expect(page.locator('#studio-side-panels')).toBeHidden();
    // Devices, record and layout move to the top bar on phones and keep their names.
    await page.getByRole('button', { name: 'Choose camera and microphone' }).click();
    const pop = (await page.getByRole('dialog', { name: 'Camera and microphone' }).boundingBox())!;
    expect(pop.x).toBeGreaterThanOrEqual(0);
    expect(pop.x + pop.width).toBeLessThanOrEqual(390);
    await expect(page.getByRole('button', { name: 'Toggle layout' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Record to this computer/ })).toBeVisible();
  });

  test('ending the stream shows the stream-ended card', async ({ page, context }) => {
    await page.setViewportSize({ width: 1366, height: 800 });
    const { api } = await signIn(context);
    const stream = await makeStream(api);
    await page.goto(`/streams/${stream.id}/studio`);
    await page.getByRole('button', { name: 'End stream' }).click();
    await page.getByRole('button', { name: 'End stream' }).last().click(); // the confirm dialog's button
    await expect(page.getByTestId('stream-ended')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('guest pages', () => {
  for (const vp of [{ width: 1366, height: 800 }, { width: 390, height: 800 }]) {
    test(`join form and in-call grid at ${vp.width}px`, async ({ page, context, browser }) => {
      const { api } = await signIn(context);
      const stream = await makeStream(api);
      const invite = await (await api.post(`${APP}/api/studio-sessions/${stream.studioSessionId}/invites`, { data: {}, headers: apiHeaders })).json();
      const guestCtx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: vp });
      const guest = await guestCtx.newPage();
      await guest.goto(`${APP}/join/${invite.token}`);
      await expect(guest.getByRole('heading', { name: 'Join as a guest' })).toBeVisible();
      await expect(guest.locator('#displayName')).toBeVisible();
      await expect(guest.getByText('Camera and mic ready')).toBeVisible({ timeout: 15_000 });
      expect(await noHScroll(guest)).toBe(true);
      await guest.fill('#displayName', 'Priya');
      await guest.getByRole('button', { name: /^Join$/ }).click();
      await expect(guest.locator('.meeting-grid')).toBeVisible();
      const bar = guest.getByRole('toolbar', { name: 'Call controls' });
      await expect(bar.getByRole('button', { name: 'Leave room' })).toBeVisible();
      await expect(bar.getByRole('button', { name: /Mute mic/ })).toBeVisible();
      expect(await noHScroll(guest)).toBe(true);
      const b = (await bar.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
      await guestCtx.close();
    });
  }

  test('an invalid invite shows the friendly card', async ({ page }) => {
    await page.goto('/join/not-a-real-token');
    await expect(page.getByRole('heading', { name: 'This invite doesn’t work' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Try the link again' })).toBeVisible();
  });
});
