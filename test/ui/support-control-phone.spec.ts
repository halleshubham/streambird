import { expect, test, type APIRequestContext } from '@playwright/test';
import { APP, apiHeaders, newStream, signIn } from './helpers';

// Remote support control of a stream started from the ANDROID APP: there is no web host studio, a fake phone (the
// customer's own session, no browser page) long-polls the server, acks commands and uploads its state; the SAME
// control page shows "Phone app connected", the controls the phone has and a greyed note for the rest.

const CONSENT = { cookies: [], origins: [{ origin: APP, localStorage: [{ name: 'streambird:consent:v1', value: 'denied' }, { name: 'streambird:tour:studio:v1', value: 'done' }] }] };
const clockState = { enabled: false, position: 'top_right', format: '12h', showDate: true, showSeconds: false, timezone: null, size: 'small', style: 'text', alternate: true };

/** A minimal fake phone: polls, applies ads.manual / ticker.set to its own state, acks, uploads state. */
function fakePhone(api: APIRequestContext, streamId: string) {
  const base = `${APP}/api/streams/${streamId}/remote-control`;
  const st = {
    v: 1, platform: 'android', appVersion: '1.0.14', orientation: 'portrait', freePlan: false,
    ads: { lower_third: { present: true, enabled: true, manual: null as string | null, mode: 'continuous', showSec: 15, everySec: 180, source: 'phone' }, side_third: { present: false }, full_screen: { present: false }, l_shape: { present: false } },
    adsShrink: false, ticker: { text: null as string | null, on: false }, clock: clockState,
  };
  const received: Array<{ type: string; payload: Record<string, unknown> }> = [];
  let rev = 0;
  let stopped = false;
  const putState = () => api.put(`${base}/state`, { data: { rev: ++rev, state: st }, headers: apiHeaders });
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

test('control page for a phone stream: connected state, phone controls work, the rest is greyed', async ({ browser, context }) => {
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
