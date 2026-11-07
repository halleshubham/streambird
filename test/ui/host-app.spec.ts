import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { APP, acceptConfirm, apiHeaders, cancelConfirm, confirmDialog, patchFreePlan, signIn, solidPng } from './helpers';

/**
 * The redesigned host-app pages (Dashboard, Upcoming, New stream, Stream detail, Connections, Brand, Billing, Team):
 * their states, the dialogs/toasts they use, and "no sideways scroll" at desktop and phone width.
 */

const PHONE = { width: 390, height: 800 };
const DESKTOP = { width: 1366, height: 800 };

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function bothWidths(page: Page, path: string, ready: () => Promise<void>) {
  for (const vp of [DESKTOP, PHONE]) {
    await page.setViewportSize(vp);
    await page.goto(path);
    await ready();
    await noSidewaysScroll(page);
  }
}

async function addTwitch(api: APIRequestContext, label = 'Host Twitch') {
  const r = await api.post(`${APP}/api/platform-connections/twitch/manual`, {
    data: { label, ingestServerUrl: 'rtmp://live.example.com/app', streamKey: 'k' },
    headers: apiHeaders,
  });
  expect(r.ok()).toBeTruthy();
  return (await r.json()) as { id: string };
}

async function schedule(api: APIRequestContext, connId: string, title: string, inHours = 5) {
  const r = await api.post(`${APP}/api/streams/schedule`, {
    data: { title, scheduledAt: new Date(Date.now() + inHours * 3600_000).toISOString(), timezone: 'UTC', destinationConnectionIds: [connId], guestEmails: ['sam@example.com'] },
    headers: apiHeaders,
  });
  expect(r.ok()).toBeTruthy();
  return (await r.json()) as { id: string };
}

test.describe('dashboard', () => {
  test('first run: a hero asks to connect a platform, with the three steps; fits the phone', async ({ page, context }) => {
    await signIn(context);
    await bothWidths(page, '/dashboard', async () => {
      await expect(page.getByRole('heading', { name: 'Welcome to StreamBird' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Connect where you stream' })).toBeVisible();
    });
    await expect(page.getByRole('list', { name: 'Setup steps' }).getByRole('listitem')).toHaveCount(3);
    await expect(page.getByRole('link', { name: 'Connect a platform' })).toHaveAttribute('href', '/connections');
    await expect(page.getByText('No presets yet')).toBeVisible();
    await expect(page.locator('a.go-live-cta')).toHaveCount(0); // nothing to go live to yet
  });

  test('with connections: presets, upcoming, connections, recent and usage; fits the phone', async ({ page, context }) => {
    const { api } = await signIn(context);
    const conn = await addTwitch(api);
    await schedule(api, conn.id, 'Product walkthrough');
    await api.post(`${APP}/api/presets`, { data: { name: 'Friday show', config: { orientation: 'landscape', destinationIds: [conn.id], quality: 'hd', tickerEnabled: false } }, headers: apiHeaders });
    await bothWidths(page, '/dashboard', async () => {
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
      await expect(page.getByRole('article', { name: 'Friday show' })).toBeVisible();
    });
    const card = page.getByRole('article', { name: 'Friday show' });
    await expect(card).toContainText('Twitch');
    await expect(card.getByRole('button', { name: 'Go live now with Friday show' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'New preset' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Upcoming streams' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Product walkthrough' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent streams' })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Streaming hours used' })).toBeVisible();
    // The edit form opens in place, keeps its fields, and a destination is a real checkbox.
    await card.getByRole('button', { name: 'Edit preset Friday show' }).click();
    await expect(page.getByLabel('Preset name')).toHaveValue('Friday show');
    await expect(page.getByLabel(/Host Twitch/)).toBeChecked();
    await noSidewaysScroll(page);
  });

  test('a preset saved from the dashboard confirms with a toast', async ({ page, context }) => {
    const { api } = await signIn(context);
    await addTwitch(api);
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'New preset' }).click();
    await page.getByLabel('Preset name').fill('Toasty');
    await page.getByRole('button', { name: 'Save preset' }).click();
    await expect(page.getByTestId('toast-host')).toContainText('Preset "Toasty" saved');
  });
});

test.describe('upcoming', () => {
  test('empty state, then a scheduled stream grouped by day with Open studio and Details', async ({ page, context }) => {
    const { api } = await signIn(context);
    await bothWidths(page, '/streams/upcoming', async () => {
      await expect(page.getByRole('heading', { name: 'Upcoming streams' })).toBeVisible();
      await expect(page.getByText('Nothing scheduled yet')).toBeVisible();
    });
    const conn = await addTwitch(api);
    const s = await schedule(api, conn.id, 'Community hangout');
    await bothWidths(page, '/streams/upcoming', async () => {
      await expect(page.getByRole('heading', { name: 'Community hangout' })).toBeVisible();
    });
    await expect(page.getByRole('link', { name: 'Open studio for Community hangout' })).toHaveAttribute('href', `/streams/${s.id}/studio`);
    await expect(page.getByRole('link', { name: 'Details for Community hangout' })).toHaveAttribute('href', `/streams/${s.id}`);
    await expect(page.getByText('1 guest invited')).toBeVisible();
  });
});

test.describe('new stream', () => {
  test('no connections: asks to connect, and Go live now is disabled', async ({ page, context }) => {
    await signIn(context);
    await bothWidths(page, '/streams/new', async () => {
      await expect(page.getByRole('heading', { name: 'Where should this stream go?' })).toBeVisible();
    });
    await expect(page.getByRole('button', { name: 'Go live now' })).toBeDisabled();
    await expect(page.getByText('Choose at least one destination to go live.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Connect a platform' })).toHaveAttribute('href', '/connections');
  });

  test('Go live now / Schedule tabs, destination pills, More options collapsed then open; fits the phone', async ({ page, context }) => {
    const { api } = await signIn(context);
    await addTwitch(api, 'Pill Twitch');
    await bothWidths(page, '/streams/new', async () => {
      await expect(page.getByRole('heading', { name: 'New stream' })).toBeVisible();
    });
    const more = page.getByRole('button', { name: /More options/ });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('more-options-summary')).toContainText('720p');
    await expect(page.locator('#orientation')).toBeHidden();
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#orientation')).toBeVisible();
    await noSidewaysScroll(page);

    const pill = page.getByLabel(/Pill Twitch/);
    await expect(pill).not.toBeChecked();
    await pill.check();
    await expect(pill).toBeChecked();

    await page.getByRole('tab', { name: 'Schedule' }).click();
    await expect(page.getByRole('tab', { name: 'Schedule' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Date and time')).toBeVisible();
    await expect(page.getByLabel('Invite guests by email (optional)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Schedule stream' })).toBeVisible();
    await noSidewaysScroll(page);
  });

  test('Schedule stream creates the stream and opens its detail page with the confirmation', async ({ page, context }) => {
    const { api } = await signIn(context);
    await addTwitch(api, 'Sched Twitch');
    await page.goto('/streams/new');
    await page.getByLabel('Title').fill('Planned show');
    await page.getByLabel(/Sched Twitch/).check();
    await page.getByRole('tab', { name: 'Schedule' }).click();
    await page.getByRole('button', { name: 'Schedule stream' }).click();
    await expect(page).toHaveURL(/\/streams\/[^/]+$/);
    await expect(page.getByRole('heading', { name: /Planned show/ })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Stream scheduled' })).toBeVisible();
  });
});

test.describe('stream detail', () => {
  test('scheduled: crumb, badge, actions, invitation, guests, destinations, thumbnail and details; fits the phone', async ({ page, context }) => {
    const { api } = await signIn(context);
    const conn = await addTwitch(api, 'Detail Twitch');
    const s = await schedule(api, conn.id, 'Detail show');
    await bothWidths(page, `/streams/${s.id}`, async () => {
      await expect(page.getByRole('heading', { name: /Detail show/ })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Invitation' })).toBeVisible();
    });
    await expect(page.getByRole('link', { name: /Upcoming/ }).first()).toBeVisible();
    for (const name of ['Edit details', 'Open studio', 'Start stream now', 'Cancel stream', 'Copy invitation']) {
      await expect(page.getByRole('button', { name })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Guests' })).toBeVisible();
    await expect(page.getByText('sam@example.com')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();
    await expect(page.getByText('Landscape 16:9')).toBeVisible();
    // Cancelling asks first, and "Keep stream" leaves it alone.
    await page.getByRole('button', { name: 'Cancel stream' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Cancel this stream?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep stream' }).click();
    await expect(dialog).toHaveCount(0);
    // Edit details opens the editor in place.
    await page.getByRole('button', { name: 'Edit details' }).click();
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Detail show');
    await page.getByRole('button', { name: 'Close editor' }).click();
  });

  test('an unscheduled stream shows destinations and an Open studio button; fits the phone', async ({ page, context }) => {
    const { api } = await signIn(context);
    const conn = await addTwitch(api, 'Plain Twitch');
    const created = await (await api.post(`${APP}/api/streams`, { data: { title: 'Plain stream', destinationConnectionIds: [conn.id] }, headers: apiHeaders })).json();
    await bothWidths(page, `/streams/${created.id}`, async () => {
      await expect(page.getByRole('heading', { name: /Plain stream/ })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Destinations' })).toBeVisible();
    });
    await expect(page.getByRole('link', { name: 'Open studio' })).toHaveAttribute('href', `/streams/${created.id}/studio`);
    await expect(page.getByText('Plain Twitch')).toBeVisible();
  });
});

test.describe('connections', () => {
  test('connected list with a live link, add-a-platform cards and the RTMP form; fits the phone', async ({ page, context }) => {
    const { api } = await signIn(context);
    await addTwitch(api, 'Backup server');
    await bothWidths(page, '/connections', async () => {
      await expect(page.getByRole('heading', { name: 'Connected' })).toBeVisible();
    });
    await expect(page.getByText('Backup server')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connect YouTube' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connect Facebook' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Twitch and custom RTMP' })).toBeVisible();
    await expect(page.getByLabel('Ingest server URL')).toBeVisible();
    // Saving the form adds a connection and says so.
    await page.getByLabel('Label').fill('Second server');
    await page.getByLabel('Ingest server URL').fill('rtmp://live.example.com/app');
    await page.getByLabel('Stream key').fill('k');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByTestId('toast-host')).toContainText('Connection saved');
    await expect(page.getByText('Second server')).toBeVisible();
  });

  test('state: YouTube connected is a dismissible success notice', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/connections?connected=youtube');
    const note = page.getByRole('status').filter({ hasText: 'YouTube connected' });
    await expect(note).toBeVisible();
    await note.getByRole('button', { name: 'Dismiss' }).click();
    await expect(note).toHaveCount(0);
  });

  test('state: Facebook returned no Page explains why and offers to try again; fits the phone', async ({ page, context }) => {
    await signIn(context);
    await bothWidths(page, '/connections?error=facebook_no_pages', async () => {
      await expect(page.getByRole('alert').filter({ hasText: "We couldn't find a Facebook Page you manage" })).toBeVisible();
    });
    await expect(page.getByRole('link', { name: 'Try Facebook again' })).toHaveAttribute('href', '/api/platform-connections/facebook/connect');
    await expect(page.getByTestId('facebook-no-pages')).toContainText('Edit settings');
  });

  test('state: choosing a Facebook Page uses a radio group and Use this Page', async ({ page, context }) => {
    await signIn(context);
    await page.route('**/api/platform-connections/facebook/pages', async (route) => {
      await route.fulfill({ json: [{ id: '111', name: 'Acme Studio', pictureUrl: null }, { id: '222', name: 'Acme Community', pictureUrl: null }] });
    });
    let chosen = '';
    await page.route('**/api/platform-connections/facebook/select', async (route) => {
      chosen = String(route.request().postDataJSON()?.pageId ?? '');
      await route.fulfill({ status: 400, json: { message: 'Stubbed: not really connected.' } });
    });
    await page.goto('/connections?facebookPagesPending=1');
    const group = page.getByRole('radiogroup', { name: 'Which Page should StreamBird use?' });
    await expect(group).toBeVisible();
    await expect(group.getByRole('radio', { name: /Acme Studio/ })).toBeChecked();
    await group.getByRole('radio', { name: /Acme Community/ }).check();
    await page.getByRole('button', { name: 'Use this Page' }).click();
    await expect.poll(() => chosen).toBe('222');
    await expect(page.getByRole('alert')).toContainText('Stubbed');
    await noSidewaysScroll(page);
  });

  test('removing a connection asks first and then confirms with a toast', async ({ page, context }) => {
    const { api } = await signIn(context);
    await addTwitch(api, 'Gone server');
    await page.goto('/connections');
    await page.getByRole('button', { name: 'Remove Gone server' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Remove Gone server?' });
    await dialog.getByRole('button', { name: 'Remove connection' }).click();
    await expect(page.getByTestId('toast-host')).toContainText('Gone server removed');
    await expect(page.getByRole('button', { name: 'Remove Gone server' })).toHaveCount(0);
  });
});

test.describe('brand', () => {
  test('Free plan: a locked hero points to the plans; fits the phone', async ({ page, context }) => {
    await signIn(context);
    await bothWidths(page, '/brand', async () => {
      await expect(page.getByRole('heading', { name: 'Make every stream look like yours' })).toBeVisible();
    });
    await expect(page.getByTestId('brand-free-notice')).toContainText('stay saved in this browser');
    await expect(page.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/billing');
  });

  test.describe('on a plan with brand storage', () => {
    test.beforeAll(async ({ browser }) => patchFreePlan(browser, { assetStorageMb: 5, watermark: false }));
    test.afterAll(async ({ browser }) => patchFreePlan(browser, { assetStorageMb: 0, watermark: true }));

    test('empty kit list, the unified editor (slots, shape toggle, look, switch), save, rename a file in a dialog; fits the phone', async ({ page, context }) => {
      const { api } = await signIn(context);
      await addTwitch(api, 'Brand Twitch');
      await bothWidths(page, '/brand', async () => {
        await expect(page.getByText('No brand kits yet')).toBeVisible();
      });
      await page.getByRole('button', { name: 'New brand kit' }).click();
      const form = page.getByRole('form', { name: 'New brand kit' });
      await form.getByLabel('Kit name').fill('Acme brand');
      await expect(form.getByRole('tab', { name: '16:9 landscape' })).toHaveAttribute('aria-selected', 'true');
      for (const slot of ['logo', 'wallpaper', 'lower_third', 'side_third', 'full_screen']) {
        await expect(form.getByTestId(`slot-size-${slot}`)).toContainText('Suggested');
      }
      await form.getByLabel('Logo file').setInputFiles({ name: 'acme-logo.png', mimeType: 'image/png', buffer: solidPng(124, 58, 237, 200, 200) });
      await expect(form.getByTestId('kit-slot-logo')).toHaveAttribute('data-has-file', 'true');
      await form.getByRole('tab', { name: '9:16 vertical' }).click();
      await expect(form.getByTestId('kit-preview')).toHaveAttribute('data-orientation', 'portrait');
      await form.getByRole('tab', { name: '16:9 landscape' }).click();
      const shrink = form.getByRole('checkbox', { name: 'Shrink picture while ads show' });
      const was = await shrink.isChecked();
      await shrink.setChecked(!was, { force: true });
      expect(await shrink.isChecked()).toBe(!was);
      await noSidewaysScroll(page);
      await form.getByRole('button', { name: 'Create kit' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Created "Acme brand"' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Acme brand' })).toBeVisible();
      await expect(page.getByTestId('brand-usage')).toContainText('of 5.0 MB used');

      // The file rename is a dialog now (no inline field, no window.prompt).
      await page.locator('summary', { hasText: 'Uploaded files' }).click();
      await page.getByRole('button', { name: 'Rename acme-logo' }).click();
      const dialog = page.getByRole('dialog', { name: 'Rename file' });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('File name').fill('acme-mark');
      await dialog.getByRole('button', { name: 'Save name' }).click();
      await expect(page.getByTestId('toast-host')).toContainText('File renamed');
      await expect(page.getByRole('button', { name: 'Delete acme-mark' })).toBeVisible();
      await noSidewaysScroll(page);
    });

    test('each kit card has a bin button beside Edit: Cancel keeps the kit, confirming deletes it; fits the phone', async ({ page, context }) => {
      const { api } = await signIn(context);
      for (const name of ['Morning show', 'Evening show']) {
        const r = await api.post(`${APP}/api/brand-kits`, { data: { name }, headers: apiHeaders });
        expect(r.ok()).toBeTruthy();
      }
      for (const vp of [DESKTOP, PHONE]) {
        await page.setViewportSize(vp);
        await page.goto('/brand');
        const edit = page.getByRole('button', { name: 'Edit Morning show' });
        const bin = page.getByRole('button', { name: 'Delete Morning show' });
        await expect(edit).toBeVisible();
        await expect(bin).toBeVisible();
        // Beside Edit: same row, to its right, and a real touch target.
        const [e, b] = [await edit.boundingBox(), await bin.boundingBox()];
        expect(Math.abs(e!.y - b!.y)).toBeLessThan(8);
        expect(b!.x).toBeGreaterThan(e!.x + e!.width - 1);
        expect(b!.width).toBeGreaterThanOrEqual(40);
        expect(b!.height).toBeGreaterThanOrEqual(40);
        await noSidewaysScroll(page);
      }
      await page.setViewportSize(DESKTOP);
      await page.goto('/brand');
      await page.getByRole('button', { name: 'Delete Morning show' }).click();
      await expect(confirmDialog(page)).toContainText('Channels that use this kit go back to the account default');
      await cancelConfirm(page);
      await expect(page.getByRole('heading', { name: 'Morning show' })).toBeVisible();
      expect((await (await api.get(`${APP}/api/brand-kits`)).json()).length).toBe(2);

      await page.getByRole('button', { name: 'Delete Morning show' }).click();
      await acceptConfirm(page);
      await expect(page.getByRole('status').filter({ hasText: 'Deleted "Morning show"' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Morning show' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Evening show' })).toBeVisible();
      const left = (await (await api.get(`${APP}/api/brand-kits`)).json()) as { name: string }[];
      expect(left.map((k) => k.name)).toEqual(['Evening show']);
    });
  });
});

test.describe('billing', () => {
  test('Free plan: the plan card, the upgrade plans, and no payments yet; fits the phone', async ({ page, context }) => {
    await signIn(context);
    await bothWidths(page, '/billing', async () => {
      await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
      await expect(page.getByRole('heading', { name: /You are on the Free plan/ })).toBeVisible();
    });
    await expect(page.getByRole('heading', { name: 'Upgrade when you are ready' })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Hours used' })).toBeVisible();
    await expect(page.getByText('No payments yet')).toBeVisible();
    await expect(page.getByText(/Online payments aren't switched on yet/)).toBeVisible();
  });
});

test.describe('team', () => {
  test('a company admin invites and lists members; fits the phone', async ({ page, context }) => {
    const { email } = await signIn(context);
    await page.route('**/api/auth/me', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, user: { ...body.user, role: 'company_admin' } } });
    });
    await page.route('**/api/team', async (route) => {
      await route.fulfill({
        json: [
          { id: 'u1', email, role: 'company_admin', createdAt: new Date().toISOString() },
          { id: 'u2', email: 'maya@acme.example', role: 'user', createdAt: new Date().toISOString() },
        ],
      });
    });
    await bothWidths(page, '/team', async () => {
      await expect(page.getByRole('heading', { name: 'Invite a teammate' })).toBeVisible();
      await expect(page.getByRole('cell', { name: 'maya@acme.example', exact: true })).toBeVisible();
    });
    await expect(page.getByRole('button', { name: 'Remove maya@acme.example' })).toBeVisible();
    await expect(page.getByRole('cell', { name: new RegExp(`${email}.*\\(you\\)`) })).toBeVisible();
  });

  test('anyone else is told only a company admin can manage the team', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/team');
    await expect(page.getByRole('heading', { name: 'Only a Company Admin can manage the team' })).toBeVisible();
  });
});

test.describe('feedback', () => {
  test('toasts: success, and an error with an action; both are announced and dismissible', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/dashboard');
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('streambird:toast', { detail: { kind: 'success', message: 'Join link copied' } }));
      window.dispatchEvent(new CustomEvent('streambird:toast', { detail: { kind: 'error', message: "Couldn't reach Twitch", action: { label: 'Retry' } } }));
    });
    const host = page.getByTestId('toast-host');
    await expect(host.getByRole('status')).toContainText('Join link copied');
    await expect(host.getByRole('alert')).toContainText("Couldn't reach Twitch");
    await expect(host.getByRole('button', { name: 'Dismiss notification' }).first()).toBeVisible();
    await noSidewaysScroll(page);
  });

  test('a dashboard that cannot load shows an error with Try again', async ({ page, context }) => {
    await signIn(context);
    await page.route('**/api/accounts/me', (route) => route.fulfill({ status: 500, json: { message: 'Server hiccup' } }));
    await page.goto('/dashboard');
    await expect(page.getByRole('alert')).toContainText("We couldn't load your dashboard");
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});
