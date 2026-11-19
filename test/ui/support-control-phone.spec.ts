import { expect, test, type APIRequestContext } from '@playwright/test';
import { APP, apiHeaders, newStream, patchFreePlan, signIn } from './helpers';

// Remote support control of a stream started from the ANDROID APP: there is no web host studio, a fake phone (the
// customer's own session, no browser page) long-polls the server, acks commands and uploads its state; the SAME
// control page shows "Phone app connected", the controls the phone has and a greyed note for the rest.

const CONSENT = { cookies: [], origins: [{ origin: APP, localStorage: [{ name: 'streambird:consent:v1', value: 'denied' }, { name: 'streambird:tour:studio:v1', value: 'done' }] }] };
const clockState = { enabled: false, position: 'top_right', format: '12h', showDate: true, showSeconds: false, timezone: null, size: 'small', style: 'text', alternate: true };

/** A minimal fake phone: polls, applies ads.manual / ticker.set to its own state, acks, uploads state. */
type Caps = { kits: Array<{ id: string; name: string }>; kit: { id: string } | null; logo: { present: boolean; position: string; size: number }; lowerThird: { available: boolean; name: string | null; title: string | null; show: boolean } };

function fakePhone(api: APIRequestContext, streamId: string, caps?: Caps) {
  const base = `${APP}/api/streams/${streamId}/remote-control`;
  const st = {
    v: 1, platform: 'android', appVersion: '1.0.14', orientation: 'portrait', freePlan: false,
    ads: { lower_third: { present: true, enabled: true, manual: null as string | null, mode: 'continuous', showSec: 15, everySec: 180, source: 'phone' }, side_third: { present: false }, full_screen: { present: false }, l_shape: { present: false } },
    adsShrink: false, ticker: { text: null as string | null, on: false }, clock: clockState,
    ...(caps ?? {}),
  } as Record<string, any>;
  const received: Array<{ type: string; payload: Record<string, unknown> }> = [];
  let rev = 0;
  let stopped = false;
  // The server allows 5 state uploads per second per stream (429 above that): like the real app, retry shortly with the latest state.
  const putState = async () => {
    for (let i = 0; i < 10; i++) {
      const res = await api.put(`${base}/state`, { data: { rev: ++rev, state: st }, headers: apiHeaders });
      if (res.status() !== 429) return res;
      await new Promise((r) => setTimeout(r, 300));
    }
  };
  const loop = (async () => {
    let after = 0;
    await putState();
    while (!stopped) {
      const res = await api.get(`${base}?after=${after}&wait=2`, { timeout: 15_000 }).catch(() => null);
      if (!res || res.status() === 204) continue;
      if (res.status() !== 200) break;
      for (const c of (await res.json()).commands as Array<{ seq: number; id: string; type: string; payload: Record<string, any> }>) {
        after = Math.max(after, c.seq);
        received.push({ type: c.type, payload: c.payload });
        if (c.type === 'ads.manual') st.ads.lower_third.manual = c.payload.mode;
        if (c.type === 'kit.apply') st.kit = { id: c.payload.kitId };
        if (c.type === 'logo.set') {
          if (c.payload.position) st.logo.position = c.payload.position;
          if (c.payload.size) st.logo.size = c.payload.size;
        }
        if (c.type === 'lowerThird.set') {
          if (c.payload.name !== undefined) st.lowerThird.name = c.payload.name;
          if (c.payload.title !== undefined) st.lowerThird.title = c.payload.title;
          if (c.payload.show !== undefined) st.lowerThird.show = c.payload.show;
        }
        if (c.type === 'ticker.set') {
          if (c.payload.text) st.ticker.text = c.payload.text;
          st.ticker.on = c.payload.on;
        }
        await api.post(`${base}/ack`, { data: { id: c.id, ok: true, appliedAt: new Date().toISOString() }, headers: apiHeaders });
        await putState();
      }
    }
  })();
  return { received, stop: async () => { stopped = true; await loop.catch(() => undefined); } };
}

test('control page for an OLDER phone app (no capabilities): connected state, ads/ticker/clock work, the rest is greyed', async ({ browser, context }) => {
  const cust = await signIn(context);
  const streamId = await newStream(cust.api);
  const phone = fakePhone(cust.api, streamId);

  const adminCtx = await browser.newContext({ baseURL: APP, storageState: CONSENT, viewport: { width: 1366, height: 800 } });
  try {
    const adminSignIn = await signIn(adminCtx, { superadmin: true });
    const found = await (await adminSignIn.api.get(`${APP}/api/superadmin/accounts?q=${encodeURIComponent(cust.email)}`)).json();
    const admin = await adminCtx.newPage();
    await admin.goto(`/admin/accounts/${found.items[0].id}`);
    await admin.getByTestId('admin-impersonate-act').click();
    await admin.getByTestId('impersonate-act-confirm').click();
    await expect(admin.getByTestId('impersonation-banner')).toBeVisible();
    await admin.goto(`/streams/${streamId}/studio`);

    const status = admin.getByTestId('support-host-status');
    await expect(status).toContainText('Phone app (version 1.0.14) connected', { timeout: 15_000 });
    await expect(status).toHaveAttribute('data-host-kind', 'phone');
    await expect(admin.getByTestId('support-phone-grid')).toBeVisible();
    // Web-only controls are not offered; one greyed note names them.
    await expect(admin.getByTestId('support-layout')).toHaveCount(0);
    await expect(admin.getByTestId('support-kit')).toHaveCount(0);
    await expect(admin.getByTestId('support-lt-name')).toHaveCount(0);
    await expect(admin.getByTestId('support-logo-left')).toHaveCount(0);
    await expect(admin.getByTestId('support-wallpaper-dim')).toHaveCount(0);
    const note = admin.getByTestId('support-phone-unavailable');
    await expect(note).toContainText('Not available on the phone app');
    await expect(note).toContainText('Wallpaper dim');
    for (const name of ['Layout', 'Brand kit', 'Lower third', 'Logo', 'Wallpaper dim']) await expect(note.getByRole('listitem').filter({ hasText: name })).toHaveCount(1);
    // What the phone has: the loaded ad, the ticker, the clock.
    await expect(admin.getByTestId('support-ad-lower_third')).toContainText('Phone ad');
    await expect(admin.getByTestId('support-ad-side_third')).toContainText('No picture loaded');
    await admin.screenshot({ path: test.info().outputPath('phone-control-desktop.png') });

    // An ad command goes through the server queue to the phone and back as the phone's own state.
    await admin.getByTestId('support-ad-lower_third-hide').click();
    await expect(admin.getByTestId('support-command-entry').filter({ hasText: 'Lower third ad: hide' }).first()).toContainText('applied');
    await expect(admin.getByTestId('support-ad-lower_third-hide')).toHaveAttribute('aria-pressed', 'true', { timeout: 8000 });
    expect(phone.received[0]).toEqual({ type: 'ads.manual', payload: { placement: 'lower_third', mode: 'hidden' } });

    // Ticker.
    await admin.getByTestId('support-ticker-text').fill('Welcome from support');
    await admin.getByTestId('support-ticker-show').click();
    await expect(admin.getByTestId('support-command-entry').filter({ hasText: 'Ticker: show' }).first()).toContainText('applied');
    expect(phone.received.at(-1)).toEqual({ type: 'ticker.set', payload: { text: 'Welcome from support', on: true } });

    // Phone width.
    await admin.setViewportSize({ width: 390, height: 800 });
    await expect(admin.getByTestId('support-phone-unavailable')).toBeVisible();
    await admin.screenshot({ path: test.info().outputPath('phone-control-mobile.png') });
  } finally {
    await phone.stop();
    await adminCtx.close();
  }
});

test.describe('phone app 1.0.15+: brand kit, logo and name banner', () => {
  test.beforeEach(async ({ browser }) => patchFreePlan(browser, { assetStorageMb: 5 }));
  test.afterEach(async ({ browser }) => patchFreePlan(browser, { assetStorageMb: 0 }));

  test('a capable snapshot shows the panels and every click reaches the phone as the right command; layout and wallpaper stay greyed', async ({ browser, context }) => {
    const cust = await signIn(context);
    const streamId = await newStream(cust.api);
    const kitA = await (await cust.api.post(`${APP}/api/brand-kits`, { data: { name: 'Morning show' }, headers: apiHeaders })).json();
    const kitB = await (await cust.api.post(`${APP}/api/brand-kits`, { data: { name: 'Night show' }, headers: apiHeaders })).json();
    const phone = fakePhone(cust.api, streamId, {
      kits: [{ id: kitA.id, name: 'Morning show' }, { id: kitB.id, name: 'Night show' }],
      kit: null,
      logo: { present: true, position: 'left', size: 90 },
      lowerThird: { available: true, name: null, title: null, show: false },
    });
    const adminCtx = await browser.newContext({ baseURL: APP, storageState: CONSENT, viewport: { width: 1366, height: 800 } });
    try {
      const adminSignIn = await signIn(adminCtx, { superadmin: true });
      const found = await (await adminSignIn.api.get(`${APP}/api/superadmin/accounts?q=${encodeURIComponent(cust.email)}`)).json();
      const admin = await adminCtx.newPage();
      await admin.goto(`/admin/accounts/${found.items[0].id}`);
      await admin.getByTestId('admin-impersonate-act').click();
      await admin.getByTestId('impersonate-act-confirm').click();
      await expect(admin.getByTestId('impersonation-banner')).toBeVisible();
      await admin.goto(`/streams/${streamId}/studio`);
      await expect(admin.getByTestId('support-host-status')).toContainText('Phone app (version 1.0.14) connected', { timeout: 15_000 });

      // The three panels are there; only Layout and Wallpaper dim are greyed.
      await expect(admin.getByTestId('support-kit')).toBeVisible();
      await expect(admin.getByTestId('support-lt-name')).toBeVisible();
      await expect(admin.getByTestId('support-logo-left')).toBeVisible();
      await expect(admin.getByTestId('support-layout')).toHaveCount(0);
      await expect(admin.getByTestId('support-wallpaper-dim')).toHaveCount(0);
      const note = admin.getByTestId('support-phone-unavailable');
      await expect(note.getByRole('listitem')).toHaveText(['Layout', 'Wallpaper dim']);
      await admin.screenshot({ path: test.info().outputPath('phone-capable-desktop.png') });

      // Brand kit: the customer's kits, applied live.
      await expect(admin.getByTestId('support-kit').locator('option')).toHaveText(['Choose a kit…', 'Morning show', 'Night show']);
      await admin.getByTestId('support-kit').selectOption(kitB.id);
      await admin.getByTestId('support-kit-apply').click();
      await expect(admin.getByTestId('support-command-entry').filter({ hasText: 'Apply brand kit "Night show"' }).first()).toContainText('applied');
      expect(phone.received.at(-1)).toEqual({ type: 'kit.apply', payload: { kitId: kitB.id } });
      await expect(admin.getByTestId('support-kit')).toHaveValue(kitB.id); // the phone reports the applied kit back

      // Logo: position and size.
      await admin.getByTestId('support-logo-right').click();
      await expect(admin.getByTestId('support-logo-right')).toHaveAttribute('aria-pressed', 'true', { timeout: 8000 });
      expect(phone.received.at(-1)).toEqual({ type: 'logo.set', payload: { position: 'right' } });
      await admin.getByTestId('support-logo-size').fill('200');
      await admin.getByTestId('support-logo-size-set').click();
      await expect(admin.getByTestId('support-command-entry').filter({ hasText: 'Logo size' }).first()).toContainText('applied');
      expect(phone.received.at(-1)).toEqual({ type: 'logo.set', payload: { size: 200 } });

      // Name banner.
      await admin.getByTestId('support-lt-name').fill('Ada Lovelace');
      await admin.getByTestId('support-lt-show').click();
      await expect(admin.getByTestId('support-command-entry').filter({ hasText: 'Lower third: show' }).first()).toContainText('applied');
      expect(phone.received.at(-1)).toEqual({ type: 'lowerThird.set', payload: { name: 'Ada Lovelace', title: null, show: true } });
      await expect(admin.getByTestId('support-lt-hide')).toBeEnabled({ timeout: 8000 }); // the phone reports the banner as showing
      await admin.getByTestId('support-lt-title').fill('Guest');
      await admin.getByTestId('support-lt-show').click();
      await expect.poll(() => phone.received.at(-1)).toEqual({ type: 'lowerThird.set', payload: { name: 'Ada Lovelace', title: 'Guest', show: true } });
      await admin.getByTestId('support-lt-hide').click();
      await expect.poll(() => phone.received.at(-1)).toEqual({ type: 'lowerThird.set', payload: { show: false } });
      await expect(admin.getByTestId('support-lt-hide')).toBeDisabled({ timeout: 8000 });

      await admin.setViewportSize({ width: 390, height: 800 });
      await expect(admin.getByTestId('support-kit')).toBeVisible();
      expect(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await admin.screenshot({ path: test.info().outputPath('phone-capable-mobile.png') });
    } finally {
      await phone.stop();
      await adminCtx.close();
    }
  });

  test('a phone with only the name banner shows just that panel; Brand kit and Logo stay greyed', async ({ browser, context }) => {
    const cust = await signIn(context);
    const streamId = await newStream(cust.api);
    const phone = fakePhone(cust.api, streamId, { lowerThird: { available: true, name: 'Jo', title: null, show: false } } as unknown as Caps);
    const adminCtx = await browser.newContext({ baseURL: APP, storageState: CONSENT, viewport: { width: 1366, height: 800 } });
    try {
      const adminSignIn = await signIn(adminCtx, { superadmin: true });
      const found = await (await adminSignIn.api.get(`${APP}/api/superadmin/accounts?q=${encodeURIComponent(cust.email)}`)).json();
      const admin = await adminCtx.newPage();
      await admin.goto(`/admin/accounts/${found.items[0].id}`);
      await admin.getByTestId('admin-impersonate-act').click();
      await admin.getByTestId('impersonate-act-confirm').click();
      await admin.goto(`/streams/${streamId}/studio`);
      await expect(admin.getByTestId('support-lt-name')).toHaveValue('Jo', { timeout: 15_000 });
      await expect(admin.getByTestId('support-kit')).toHaveCount(0);
      await expect(admin.getByTestId('support-logo-left')).toHaveCount(0);
      await expect(admin.getByTestId('support-phone-unavailable').getByRole('listitem')).toHaveText(['Layout', 'Brand kit', 'Logo', 'Wallpaper dim']);
    } finally {
      await phone.stop();
      await adminCtx.close();
    }
  });
});
