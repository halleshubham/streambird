import { BrowserContext, expect, Page, test } from '@playwright/test';
import { APP, apiHeaders, canvasPixel, newStream, signIn } from './helpers';

// Choosing and switching the camera / microphone in the host studio. The browser is Chromium with its fake camera;
// enumerateDevices and getUserMedia are wrapped so the page sees several cameras and microphones and the test can
// read every request. "cam-front" is the real fake camera (green); "cam-back" paints red; "cam-usb" paints blue.

type Cfg = { granted?: boolean; labels?: Record<string, string>; fail?: { id: string; name: string } | null; remembered?: { cameraId?: string; micId?: string } };
type W = Window & {
  __devs: { deviceId: string; kind: string; label: string; groupId: string }[];
  __granted: boolean;
  __gum: { video?: Record<string, unknown> | boolean; audio?: Record<string, unknown> | boolean }[];
  __fail: { id: string; name: string } | null;
  __replaced: string[];
  __lastVideo?: MediaStreamTrack;
};

const green = (p: [number, number, number]) => p[1] > 100 && p[0] < 120 && p[2] < 120;
const red = (p: [number, number, number]) => p[0] > 150 && p[1] < 90 && p[2] < 90;
const blue = (p: [number, number, number]) => p[2] > 150 && p[0] < 90 && p[1] < 120;

async function stubDevices(page: Page, cfg: Cfg = {}) {
  await page.addInitScript((c: Cfg) => {
    const w = window as unknown as W;
    const label = (id: string, fallback: string) => c.labels?.[id] ?? fallback;
    w.__devs = [
      { deviceId: 'cam-front', kind: 'videoinput', label: label('cam-front', 'Front Camera'), groupId: 'g1' },
      { deviceId: 'cam-back', kind: 'videoinput', label: label('cam-back', 'Back Camera'), groupId: 'g2' },
      { deviceId: 'cam-usb', kind: 'videoinput', label: label('cam-usb', 'USB Webcam'), groupId: 'g3' },
      { deviceId: 'mic-1', kind: 'audioinput', label: 'Built-in Mic', groupId: 'g1' },
      { deviceId: 'mic-2', kind: 'audioinput', label: 'USB Mic', groupId: 'g3' },
    ];
    w.__granted = !!c.granted;
    w.__gum = [];
    w.__fail = c.fail ?? null;
    w.__replaced = [];
    if (c.remembered) {
      try {
        if (!sessionStorage.getItem('cam-seeded')) {
          localStorage.setItem('streambird:studio:devices:v1', JSON.stringify(c.remembered));
          sessionStorage.setItem('cam-seeded', '1');
        }
      } catch {
        // ignore
      }
    }
    const md = navigator.mediaDevices;
    md.enumerateDevices = async () => (w.__granted ? w.__devs : w.__devs.map((d) => ({ ...d, label: '', deviceId: '' }))) as unknown as MediaDeviceInfo[];
    const orig = md.getUserMedia.bind(md);
    const pick = (v: unknown, key: 'deviceId'): string | null => {
      const o = v as { deviceId?: { exact?: string; ideal?: string } } | undefined;
      return v && typeof v === 'object' ? (o?.[key]?.exact ?? o?.[key]?.ideal ?? null) : null;
    };
    const paint = (color: string) => {
      const cv = document.createElement('canvas');
      cv.width = 640;
      cv.height = 480;
      const g = cv.getContext('2d')!;
      let n = 0;
      const draw = () => {
        g.fillStyle = color;
        g.fillRect(0, 0, 640, 480);
        g.fillStyle = n++ % 2 ? '#fff' : color;
        g.fillRect(0, 0, 2, 2);
      };
      draw();
      setInterval(draw, 60);
      return cv.captureStream(15).getVideoTracks()[0];
    };
    md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      w.__gum.push(JSON.parse(JSON.stringify(constraints ?? {})));
      const v = constraints?.video;
      const facing = v && typeof v === 'object' ? (v.facingMode as { exact?: string; ideal?: string } | undefined) : undefined;
      let vid = pick(v, 'deviceId');
      if (vid && !w.__devs.some((d) => d.deviceId === vid)) {
        if (v && typeof v === 'object' && (v.deviceId as { exact?: string }).exact) throw Object.assign(new Error('gone'), { name: 'OverconstrainedError' });
        vid = null;
      }
      if (!vid && facing) vid = (facing.exact ?? facing.ideal) === 'environment' ? 'cam-back' : 'cam-front';
      if (!vid && v) vid = 'cam-front';
      const aid = pick(constraints?.audio, 'deviceId') ?? 'mic-1';
      if (w.__fail && (w.__fail.id === vid || w.__fail.id === aid)) throw Object.assign(new Error('simulated'), { name: w.__fail.name });
      w.__granted = true;
      const out = new MediaStream();
      if (v && vid) {
        let t: MediaStreamTrack;
        if (vid === 'cam-front') t = (await orig({ video: true })).getVideoTracks()[0];
        else t = paint(vid === 'cam-back' ? '#e02020' : '#2020e0');
        const real = t.getSettings.bind(t);
        t.getSettings = () => ({ ...real(), deviceId: vid!, facingMode: vid === 'cam-back' ? 'environment' : 'user' });
        w.__lastVideo = t;
        out.addTrack(t);
      }
      if (constraints?.audio) {
        const t = (await orig({ audio: true })).getAudioTracks()[0];
        const real = t.getSettings.bind(t);
        t.getSettings = () => ({ ...real(), deviceId: aid });
        out.addTrack(t);
      }
      return out;
    };
    const origReplace = RTCRtpSender.prototype.replaceTrack;
    RTCRtpSender.prototype.replaceTrack = function (t: MediaStreamTrack | null) {
      w.__replaced.push(t?.kind ?? 'null');
      return origReplace.call(this, t);
    };
    // Going live without MediaMTX: the fake WHIP answer is accepted, real answers (to guests) are not touched.
    const origSet = RTCPeerConnection.prototype.setRemoteDescription;
    RTCPeerConnection.prototype.setRemoteDescription = function (d: RTCSessionDescriptionInit) {
      if (d?.type === 'answer' && d.sdp === 'v=0\r\n') return Promise.resolve();
      return origSet.call(this, d);
    };
  }, cfg);
}

const gum = (page: Page) => page.evaluate(() => (window as unknown as W).__gum);
const replaced = (page: Page) => page.evaluate(() => (window as unknown as W).__replaced);
const openDevices = async (page: Page) => {
  const dialog = page.getByRole('dialog', { name: 'Camera and microphone' });
  if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Choose camera and microphone' }).click();
  return dialog;
};
const optionLabels = (page: Page, sel: string) => page.locator(`${sel} option`).allTextContents();
const size = (page: Page) => page.evaluate(() => { const c = document.querySelector('canvas.studio-canvas') as HTMLCanvasElement; return { width: c.width, height: c.height }; });
const centre = async (page: Page) => {
  const { width, height } = await size(page);
  return canvasPixel(page, width / 2, height / 2);
};

/** With a guest on stage the host is the left tile of the grid. */
const hostTile = async (page: Page) => {
  const { width, height } = await size(page);
  return canvasPixel(page, width / 4, height / 2);
};

async function openStudio(page: Page, context: BrowserContext, opts: { orientation?: 'portrait' | 'landscape'; start?: boolean } = {}) {
  const { api } = await signIn(context);
  const id = await newStream(api, opts.orientation);
  await page.goto(`/streams/${id}/studio`);
  await page.locator('canvas.studio-canvas').waitFor();
  if (opts.start !== false) {
    await page.getByRole('button', { name: 'Start my camera' }).click();
    await expect(page.getByRole('button', { name: 'Camera on' })).toBeVisible();
  }
  return { api, id };
}

async function goLive(page: Page) {
  let posts = 0;
  await page.route('**/*whip*', (route) => {
    if (route.request().method() === 'POST') posts++;
    return route.fulfill({ status: 201, contentType: 'application/sdp', headers: { Location: '/whip/resource' }, body: 'v=0\r\n' });
  });
  await page.getByRole('button', { name: /Go live/ }).click();
  await expect(page.getByRole('button', { name: 'Live', exact: true })).toBeVisible({ timeout: 15_000 });
  return () => posts;
}

test.describe('camera and microphone choice (desktop)', () => {
  test('before the camera is on the popover explains; after permission it lists cameras and microphones by label', async ({ page, context }) => {
    await stubDevices(page);
    await openStudio(page, context, { start: false });
    let dialog = await openDevices(page);
    await expect(dialog).toContainText('Turn your camera on first');
    await expect(page.locator('#cameraSelect')).toHaveCount(0);
    await page.getByRole('button', { name: 'Start my camera' }).click();
    await expect(page.getByRole('button', { name: 'Camera on' })).toBeVisible();
    dialog = await openDevices(page);
    await expect(page.locator('#cameraSelect')).toBeVisible();
    expect(await optionLabels(page, '#cameraSelect')).toEqual(['Front Camera', 'Back Camera', 'USB Webcam']);
    expect(await optionLabels(page, '#micSelect')).toEqual(['Built-in Mic', 'USB Mic']);
    await expect(page.locator('#cameraSelect')).toHaveValue('cam-front');
    await expect(page.getByRole('button', { name: 'Flip camera' })).toHaveCount(0); // a mouse-and-keyboard computer: no flip
  });

  test('choosing a camera asks for exactly that device and the tile changes; the picture comes from the new camera', async ({ page, context }) => {
    await stubDevices(page);
    await openStudio(page, context);
    await expect.poll(async () => green(await centre(page))).toBe(true);
    await openDevices(page);
    await page.locator('#cameraSelect').selectOption('cam-back');
    await expect.poll(async () => red(await centre(page)), { timeout: 10_000 }).toBe(true);
    const calls = await gum(page);
    expect(calls[calls.length - 1].video).toMatchObject({ deviceId: { exact: 'cam-back' } });
    expect(calls[calls.length - 1].audio).toBeUndefined(); // only the camera was asked for
    await expect(page.locator('.studio-status-toast')).toContainText('Camera: Back Camera');
    await page.locator('#cameraSelect').selectOption('cam-usb');
    await expect.poll(async () => blue(await centre(page)), { timeout: 10_000 }).toBe(true);
  });

  test('choosing a camera before starting it starts the camera with that choice', async ({ page, context }) => {
    await stubDevices(page, { granted: true });
    await openStudio(page, context, { start: false });
    await openDevices(page);
    await page.locator('#cameraSelect').selectOption('cam-usb');
    await expect(page.getByRole('button', { name: 'Camera on' })).toBeVisible();
    const calls = await gum(page);
    expect(calls[0].video).toMatchObject({ deviceId: { ideal: 'cam-usb' } });
    await expect.poll(async () => blue(await centre(page)), { timeout: 10_000 }).toBe(true);
  });

  test('the choice is remembered across a reload; a remembered device that no longer exists is ignored', async ({ page, context }) => {
    await stubDevices(page, { granted: true });
    const { id } = await openStudio(page, context, { start: false });
    await openDevices(page);
    await page.locator('#cameraSelect').selectOption('cam-usb');
    await expect(page.getByRole('button', { name: 'Camera on' })).toBeVisible();
    await page.locator('#micSelect').selectOption('mic-2');
    await expect(page.locator('.studio-status-toast')).toContainText('Microphone: USB Mic');
    await page.reload();
    await page.locator('canvas.studio-canvas').waitFor();
    await page.getByRole('button', { name: 'Start my camera' }).click();
    await expect(page.getByRole('button', { name: 'Camera on' })).toBeVisible();
    let calls = await gum(page);
    expect(calls[0].video).toMatchObject({ deviceId: { ideal: 'cam-usb' } });
    expect(calls[0].audio).toMatchObject({ deviceId: { ideal: 'mic-2' } });

    // The remembered camera is unplugged for good.
    await page.evaluate(() => localStorage.setItem('streambird:studio:devices:v1', JSON.stringify({ cameraId: 'unplugged', micId: 'also-gone' })));
    await page.goto(`/streams/${id}/studio`);
    await page.locator('canvas.studio-canvas').waitFor();
    await page.getByRole('button', { name: 'Start my camera' }).click();
    await expect(page.getByRole('button', { name: 'Camera on' })).toBeVisible();
    calls = await gum(page);
    expect(calls[0].video).toBe(true);
    expect(JSON.stringify(calls[0].audio)).not.toContain('deviceId');
  });

  test('plugging a webcam in or out updates the list', async ({ page, context }) => {
    await stubDevices(page);
    await openStudio(page, context);
    await openDevices(page);
    expect(await optionLabels(page, '#cameraSelect')).toHaveLength(3);
    await page.evaluate(() => {
      const w = window as unknown as W;
      w.__devs.push({ deviceId: 'cam-new', kind: 'videoinput', label: 'Capture Card', groupId: 'g9' });
      navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    });
    await expect.poll(() => optionLabels(page, '#cameraSelect')).toContain('Capture Card');
    await page.evaluate(() => {
      const w = window as unknown as W;
      w.__devs = w.__devs.filter((d) => d.deviceId !== 'cam-usb');
      navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    });
    await expect.poll(() => optionLabels(page, '#cameraSelect')).not.toContain('USB Webcam');
  });

  test('a failing switch keeps the old camera and says why (camera busy, camera not available)', async ({ page, context }) => {
    await stubDevices(page);
    await openStudio(page, context);
    await openDevices(page);
    await page.evaluate(() => { (window as unknown as W).__fail = { id: 'cam-usb', name: 'NotReadableError' }; });
    await page.locator('#cameraSelect').selectOption('cam-usb');
    const toast = page.locator('.studio-status-toast');
    await expect(toast).toContainText('busy');
    await expect(toast).toContainText('previous camera stays on');
    await expect(page.locator('#cameraSelect')).toHaveValue('cam-front');
    await expect.poll(async () => green(await centre(page))).toBe(true); // still showing the first camera
    await page.evaluate(() => { (window as unknown as W).__fail = { id: 'cam-back', name: 'OverconstrainedError' }; });
    await page.locator('#cameraSelect').selectOption('cam-back');
    await expect(toast).toContainText('not available');
    await expect(page.locator('#cameraSelect')).toHaveValue('cam-front');
    await expect.poll(async () => green(await centre(page))).toBe(true);
    // the studio is still usable afterwards
    await page.evaluate(() => { (window as unknown as W).__fail = null; });
    await page.locator('#cameraSelect').selectOption('cam-back');
    await expect.poll(async () => red(await centre(page)), { timeout: 10_000 }).toBe(true);
  });

  test('a vertical stream keeps asking for a tall picture on the new camera too', async ({ page, context }) => {
    await stubDevices(page);
    await openStudio(page, context, { orientation: 'portrait' });
    await openDevices(page);
    await page.locator('#cameraSelect').selectOption('cam-usb');
    await expect.poll(async () => (await gum(page)).length).toBeGreaterThan(1);
    for (const c of await gum(page)) expect(c.video).toMatchObject({ aspectRatio: { ideal: 9 / 16 } });
    const last = (await gum(page)).pop()!;
    expect(last.video).toMatchObject({ deviceId: { exact: 'cam-usb' }, aspectRatio: { ideal: 9 / 16 } });
  });

  test('switching while live keeps the stream live: no second publish, guests get replaceTrack for video and audio', async ({ page, context, browser }) => {
    await stubDevices(page);
    const { api, id } = await openStudio(page, context);
    const stream = await (await api.get(`${APP}/api/streams/${id}`)).json();
    const invite = await (await api.post(`${APP}/api/studio-sessions/${stream.studioSessionId}/invites`, { data: {}, headers: apiHeaders })).json();
    const guestCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const guest = await guestCtx.newPage();
    await guest.goto(`${APP}/join/${invite.token}`);
    await guest.fill('#displayName', 'Alex');
    await guest.getByRole('button', { name: /^Join$/ }).click();
    await expect(guest.locator('.meeting-grid')).toBeVisible();
    await expect(page.locator('.studio-status-toast')).toContainText('Alex is connected', { timeout: 20_000 });

    const posts = await goLive(page);
    expect(posts()).toBe(1);
    await openDevices(page);
    await page.locator('#cameraSelect').selectOption('cam-back');
    await expect.poll(async () => red(await hostTile(page)), { timeout: 10_000 }).toBe(true);
    await page.locator('#micSelect').selectOption('mic-2');
    await expect(page.locator('.studio-status-toast')).toContainText('Microphone: USB Mic');
    const kinds = await replaced(page);
    expect(kinds).toContain('video');
    expect(kinds).toContain('audio');
    await expect(page.getByRole('button', { name: 'Live', exact: true })).toBeVisible();
    expect(posts()).toBe(1);
    // the guest still gets a picture from the host
    await expect(guest.locator('.meeting-grid video').first()).toBeVisible();
    await guestCtx.close();
  });

  test('a camera that disappears while live falls back to the default and the stream stays up', async ({ page, context }) => {
    await stubDevices(page);
    await openStudio(page, context);
    await openDevices(page);
    await page.locator('#cameraSelect').selectOption('cam-usb');
    await expect.poll(async () => blue(await centre(page)), { timeout: 10_000 }).toBe(true);
    const posts = await goLive(page);
    await page.evaluate(() => {
      const w = window as unknown as W;
      w.__devs = w.__devs.filter((d) => d.deviceId !== 'cam-usb');
      w.__lastVideo!.dispatchEvent(new Event('ended'));
    });
    await expect(page.locator('.studio-status-toast')).toContainText('switched to the default camera');
    await expect.poll(async () => green(await centre(page)), { timeout: 10_000 }).toBe(true);
    await expect(page.getByRole('button', { name: 'Live', exact: true })).toBeVisible();
    expect(posts()).toBe(1);
  });

  test('a muted microphone and a disabled camera stay that way after switching', async ({ page, context }) => {
    await stubDevices(page);
    await openStudio(page, context);
    await page.getByRole('tab', { name: /^People/ }).click();
    await page.getByRole('button', { name: 'Mute' }).click();
    await page.getByRole('button', { name: 'Disable camera' }).click();
    await openDevices(page);
    await page.locator('#micSelect').selectOption('mic-2');
    await expect(page.locator('.studio-status-toast')).toContainText('Microphone: USB Mic');
    await page.locator('#cameraSelect').selectOption('cam-back');
    await expect(page.locator('.studio-status-toast')).toContainText('Camera: Back Camera');
    await expect(page.getByRole('button', { name: 'Unmute' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enable camera' })).toBeVisible();
    const enabled = await page.evaluate(() => (window as unknown as W).__lastVideo!.enabled);
    expect(enabled).toBe(false);
    await page.getByRole('button', { name: 'Enable camera' }).click();
    await expect.poll(async () => red(await centre(page)), { timeout: 10_000 }).toBe(true);
  });
});

test.describe('camera flip on a phone', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

  test('Flip camera swaps front and back by name, and the page fits the phone', async ({ page, context }) => {
    await stubDevices(page);
    await openStudio(page, context, { start: false });
    await expect(page.getByRole('button', { name: 'Flip camera' })).toHaveCount(0); // camera not on yet
    await page.getByRole('button', { name: 'Start my camera' }).click();
    await expect(page.getByRole('button', { name: 'Camera on' })).toBeVisible();
    const flip = page.getByRole('button', { name: 'Flip camera' });
    await expect(flip).toBeVisible();
    await flip.click();
    await expect.poll(async () => red(await centre(page)), { timeout: 10_000 }).toBe(true);
    let last = (await gum(page)).pop()!;
    expect(last.video).toMatchObject({ deviceId: { exact: 'cam-back' } });
    await flip.click();
    await expect.poll(async () => green(await centre(page)), { timeout: 10_000 }).toBe(true);
    last = (await gum(page)).pop()!;
    expect(last.video).toMatchObject({ deviceId: { exact: 'cam-front' } });

    await openDevices(page);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits).toBe(true);
    const box = await page.getByRole('dialog', { name: 'Camera and microphone' }).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });

  test('when the camera names do not say front or back, Flip asks for the other facingMode and back again', async ({ page, context }) => {
    await stubDevices(page, { labels: { 'cam-front': 'Camera A', 'cam-back': 'Camera B', 'cam-usb': 'Camera C' } });
    await openStudio(page, context);
    const flip = page.getByRole('button', { name: 'Flip camera' });
    await flip.click();
    await expect.poll(async () => red(await centre(page)), { timeout: 10_000 }).toBe(true);
    expect((await gum(page)).pop()!.video).toMatchObject({ facingMode: { exact: 'environment' } });
    await flip.click();
    await expect.poll(async () => green(await centre(page)), { timeout: 10_000 }).toBe(true);
    expect((await gum(page)).pop()!.video).toMatchObject({ facingMode: { exact: 'user' } });
  });

  test('a flip that fails keeps the camera and says so', async ({ page, context }) => {
    await stubDevices(page, { labels: { 'cam-front': 'Camera A', 'cam-back': 'Camera B', 'cam-usb': 'Camera C' } });
    await openStudio(page, context);
    await page.evaluate(() => { (window as unknown as W).__fail = { id: 'cam-back', name: 'OverconstrainedError' }; });
    await page.getByRole('button', { name: 'Flip camera' }).click();
    await expect(page.locator('.studio-status-toast')).toContainText('Could not flip the camera');
    await expect.poll(async () => green(await centre(page))).toBe(true);
  });

  test('with only one camera there is no Flip button', async ({ page, context }) => {
    await stubDevices(page);
    await openStudio(page, context, { start: false });
    await page.evaluate(() => { const w = window as unknown as W; w.__devs = w.__devs.filter((d) => d.deviceId !== 'cam-back' && d.deviceId !== 'cam-usb'); });
    await page.getByRole('button', { name: 'Start my camera' }).click();
    await expect(page.getByRole('button', { name: 'Camera on' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Flip camera' })).toHaveCount(0);
  });
});
