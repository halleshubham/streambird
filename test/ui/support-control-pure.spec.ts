import { expect, test } from '@playwright/test';
import {
  HOST_CHANGED_MESSAGE,
  HostChangeTracker,
  SUPPORT_CONFLICT_WINDOW_MS,
  applySupportCommand,
  buildSupportState,
  touchedKeys,
  trackedValues,
  type ApplyEnv,
  type HostControls,
  type SnapshotInput,
} from '../../web-app/src/studio/supportControl';
import { DEFAULT_CLOCK } from '../../web-app/src/studio/clock';
import { DEFAULT_LOWER_THIRD } from '../../web-app/src/studio/lowerThird';
import type { AdPlacement } from '../../web-app/src/studio/ads';

// The pure parts of the support remote control that live in the host studio: the snapshot, the "host changed it just
// now" conflict rule and the command applier (routing to the host's own setters). No browser page involved.

const NO_AD = { hasMedia: false, name: null, enabled: false, schedule: { mode: 'continuous' } as const, manual: null };
function input(over: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    layout: 'grid',
    orientation: 'landscape',
    adsPlan: 'custom',
    ads: { lower_third: { ...NO_AD, hasMedia: true, name: 'Sponsor', enabled: true }, side_third: NO_AD, full_screen: NO_AD, l_shape: NO_AD },
    adsShrink: true,
    kits: [{ id: 'k1', name: 'Kit one' }],
    activeKitId: null,
    tickerText: '',
    tickerStash: '',
    lowerThird: { ...DEFAULT_LOWER_THIRD },
    lowerThirdLive: false,
    canLowerThird: true,
    clock: { ...DEFAULT_CLOCK },
    logoPosition: 'left',
    logoSize: 90,
    hasLogo: true,
    wallpaperDim: 0,
    hasWallpaper: false,
    ...over,
  };
}

/** A fake host: records which setter was called with what, and keeps tiny bits of state the applier reads. */
function fakeHost(over: Partial<{ plan: 'custom' | 'free'; media: AdPlacement[]; kits: string[]; canLt: boolean; ticker: string }> = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const st = { ticker: over.ticker ?? '', lt: { ...DEFAULT_LOWER_THIRD }, clock: { ...DEFAULT_CLOCK } };
  const c: HostControls = {
    adsPlan: () => over.plan ?? 'custom',
    adHasMedia: (p) => (over.media ?? ['lower_third']).includes(p),
    setLayout: (id) => calls.push(['setLayout', id]),
    setAdManual: (p, m) => calls.push(['setAdManual', p, m]),
    setAdEnabled: (p, e) => calls.push(['setAdEnabled', p, e]),
    setAdSchedule: (p, s) => calls.push(['setAdSchedule', p, s]),
    setAdsShrink: (on) => calls.push(['setAdsShrink', on]),
    hasKit: (id) => (over.kits ?? ['kit-1']).includes(id),
    applyKit: async (id) => void calls.push(['applyKit', id]),
    tickerText: () => st.ticker,
    setTicker: (t) => {
      st.ticker = t.trim();
      calls.push(['setTicker', t]);
    },
    canLowerThird: () => over.canLt ?? true,
    lowerThird: () => st.lt,
    setLowerThird: (patch) => {
      st.lt = { ...st.lt, ...patch };
      calls.push(['setLowerThird', patch]);
    },
    showLowerThird: () => calls.push(['showLowerThird']),
    hideLowerThird: () => calls.push(['hideLowerThird']),
    clock: () => st.clock,
    setClock: (patch) => calls.push(['setClock', patch]),
    setLogoPosition: (p) => calls.push(['setLogoPosition', p]),
    setLogoSize: (n) => calls.push(['setLogoSize', n]),
    setWallpaperDim: (n) => calls.push(['setWallpaperDim', n]),
  };
  let now = 100_000;
  const env: ApplyEnv = { controls: c, tracker: new HostChangeTracker(), now: () => now, tickerStash: { text: '' } };
  return { calls, env, st, advance: (ms: number) => (now += ms), nowMs: () => now };
}

test.describe('snapshot', () => {
  test('carries only the controllable settings (no secrets, tokens or media)', () => {
    const polluted = { ...input(), hostToken: 'SECRET-HOST-TOKEN', streamKey: 'SECRET-KEY', whipUrl: 'https://x/whip', logoDataUrl: 'data:image/png;base64,AAAA' } as SnapshotInput;
    const s = buildSupportState(polluted);
    const json = JSON.stringify(s);
    expect(json).not.toMatch(/SECRET|whip|data:image|logoDataUrl/);
    expect(Object.keys(s).sort()).toEqual(['activeKitId', 'ads', 'adsPlan', 'adsShrink', 'clock', 'kits', 'layout', 'logo', 'lowerThird', 'orientation', 'ticker', 'v', 'wallpaper'].sort());
    expect(s.ads.lower_third).toEqual({ hasMedia: true, name: 'Sponsor', enabled: true, schedule: { mode: 'continuous' }, manual: null });
    expect(JSON.stringify(s).length).toBeLessThan(4000);
  });

  test('ticker: shows the text while on, remembers the last text while off', () => {
    expect(buildSupportState(input({ tickerText: 'Live now' })).ticker).toEqual({ text: 'Live now', on: true });
    expect(buildSupportState(input({ tickerText: '', tickerStash: 'Last text' })).ticker).toEqual({ text: 'Last text', on: false });
  });

  test('lower third maps the big line to name and the small line to title', () => {
    const s = buildSupportState(input({ lowerThird: { ...DEFAULT_LOWER_THIRD, title: 'Asha Rao', subtitle: 'Editor' }, lowerThirdLive: true }));
    expect(s.lowerThird).toEqual({ name: 'Asha Rao', title: 'Editor', live: true, allowed: true });
  });

  test('tracked values change per setting group only', () => {
    const a = trackedValues(buildSupportState(input()));
    const b = trackedValues(buildSupportState(input({ layout: 'spotlight', tickerText: 'x' })));
    const changed = Object.keys(a).filter((k) => a[k] !== b[k]);
    expect(changed.sort()).toEqual(['layout', 'ticker']);
  });

  test('every command names the setting groups it changes', () => {
    expect(touchedKeys('layout.set', { mode: 'grid' })).toEqual(['layout']);
    expect(touchedKeys('ads.manual', { placement: 'full_screen' })).toEqual(['ads.full_screen.manual']);
    expect(touchedKeys('ads.schedule', { placement: 'l_shape' })).toEqual(['ads.l_shape.schedule']);
    expect(touchedKeys('kit.apply', {})).toEqual(expect.arrayContaining(['kit', 'logo', 'clock', 'ads.shrink', 'ads.lower_third.enabled']));
  });
});

test.describe('conflict rule: the host wins', () => {
  test('a host change blocks a support command on the same setting for 3 s, then it passes; other settings are free', () => {
    const t = new HostChangeTracker();
    const base = trackedValues(buildSupportState(input()));
    t.observe(base, 1000); // baseline: nothing stamped
    expect(t.recentHostChange(['layout'], 1001)).toBeNull();
    t.observe(trackedValues(buildSupportState(input({ layout: 'spotlight' }))), 5000); // the host changed the layout
    expect(t.recentHostChange(['layout'], 5000)).toBe('layout');
    expect(t.recentHostChange(['layout'], 5000 + SUPPORT_CONFLICT_WINDOW_MS - 1)).toBe('layout');
    expect(t.recentHostChange(['layout'], 5000 + SUPPORT_CONFLICT_WINDOW_MS)).toBeNull();
    expect(t.recentHostChange(['ticker', 'clock'], 5001)).toBeNull();
  });

  test('a change caused by a support command is not counted as the host\'s', () => {
    const t = new HostChangeTracker();
    t.observe(trackedValues(buildSupportState(input())), 0);
    t.expect(['layout'], 1000);
    t.observe(trackedValues(buildSupportState(input({ layout: 'podcast-split' }))), 1100);
    expect(t.recentHostChange(['layout'], 1200)).toBeNull();
    // Only the FIRST change belongs to the support command: a host click right after counts (and wins).
    t.observe(trackedValues(buildSupportState(input({ layout: 'grid' }))), 1300);
    expect(t.recentHostChange(['layout'], 1400)).toBe('layout');
    // A command that changed nothing leaves no expectation behind for long.
    const t2 = new HostChangeTracker();
    t2.observe(trackedValues(buildSupportState(input())), 0);
    t2.expect(['layout'], 1000);
    t2.observe(trackedValues(buildSupportState(input({ layout: 'grid', tickerText: 'x' }))), 1500);
    expect(t2.recentHostChange(['ticker'], 1500)).toBe('ticker');
  });

  test('applySupportCommand refuses within 3 s of a host change and applies after; the support value never beats a later host change', async () => {
    const h = fakeHost();
    h.env.tracker.observe(trackedValues(buildSupportState(input())), h.nowMs());
    h.advance(10_000);
    h.env.tracker.observe(trackedValues(buildSupportState(input({ layout: 'spotlight' }))), h.nowMs()); // host clicked
    h.advance(2900);
    expect(await applySupportCommand({ type: 'layout.set', payload: { mode: 'grid' } }, h.env)).toEqual({ ok: false, error: HOST_CHANGED_MESSAGE });
    expect(h.calls).toEqual([]);
    h.advance(200);
    expect(await applySupportCommand({ type: 'layout.set', payload: { mode: 'grid' } }, h.env)).toEqual({ ok: true });
    expect(h.calls).toEqual([['setLayout', 'grid']]);
    // The host changes it again right after: that is the host's change, and the next support command waits.
    h.advance(500);
    h.env.tracker.observe(trackedValues(buildSupportState(input({ layout: 'podcast-center' }))), h.nowMs());
    h.advance(1000);
    expect((await applySupportCommand({ type: 'layout.set', payload: { mode: 'grid' } }, h.env)).ok).toBe(false);
  });
});

test.describe('applySupportCommand routes to the host setters', () => {
  test('layout, ads, shrink, kit, logo, wallpaper dim', async () => {
    const h = fakeHost();
    const run = (type: any, payload: any) => applySupportCommand({ type, payload }, h.env);
    expect(await run('layout.set', { mode: 'podcast-split' })).toEqual({ ok: true });
    expect(await run('ads.manual', { placement: 'lower_third', manual: 'shown' })).toEqual({ ok: true });
    expect(await run('ads.manual', { placement: 'lower_third', manual: null })).toEqual({ ok: true });
    expect(await run('ads.enabled', { placement: 'lower_third', enabled: false })).toEqual({ ok: true });
    expect(await run('ads.schedule', { placement: 'lower_third', mode: 'interval', showSec: 15, everySec: 180 })).toEqual({ ok: true });
    expect(await run('ads.schedule', { placement: 'lower_third', mode: 'continuous' })).toEqual({ ok: true });
    expect(await run('ads.shrink', { on: false })).toEqual({ ok: true });
    expect(await run('kit.apply', { kitId: 'kit-1' })).toEqual({ ok: true });
    expect(await run('logo.set', { position: 'right', size: 150 })).toEqual({ ok: true });
    expect(await run('wallpaper.dim', { n: 30 })).toEqual({ ok: true });
    expect(h.calls).toEqual([
      ['setLayout', 'podcast-split'],
      ['setAdManual', 'lower_third', 'shown'],
      ['setAdManual', 'lower_third', null],
      ['setAdEnabled', 'lower_third', false],
      ['setAdSchedule', 'lower_third', { mode: 'interval', showSec: 15, everySec: 180 }],
      ['setAdSchedule', 'lower_third', { mode: 'continuous' }],
      ['setAdsShrink', false],
      ['applyKit', 'kit-1'],
      ['setLogoPosition', 'right'],
      ['setLogoSize', 150],
      ['setWallpaperDim', 30],
    ]);
  });

  test('ticker on/off keeps the text, lower third maps name/title, clock patches', async () => {
    const h = fakeHost();
    const run = (type: any, payload: any) => applySupportCommand({ type, payload }, h.env);
    await run('ticker.set', { text: 'Breaking news', on: true });
    expect(h.st.ticker).toBe('Breaking news');
    await run('ticker.set', { on: false });
    expect(h.st.ticker).toBe('');
    await run('ticker.set', { on: true });
    expect(h.st.ticker).toBe('Breaking news');
    await run('ticker.set', { text: null });
    expect(h.st.ticker).toBe('');

    expect(await run('lowerThird.set', { name: 'Asha', title: 'Editor', show: true })).toEqual({ ok: true });
    expect(h.calls).toContainEqual(['setLowerThird', { title: 'Asha', subtitle: 'Editor' }]);
    expect(h.calls).toContainEqual(['showLowerThird']);
    await run('lowerThird.set', { show: false });
    expect(h.calls).toContainEqual(['hideLowerThird']);

    await run('clock.set', { enabled: true, format: '24h', timezone: 'Asia/Kolkata', showSeconds: true });
    expect(h.calls).toContainEqual(['setClock', { enabled: true, format: '24h', timezone: 'Asia/Kolkata', showSeconds: true }]);
  });

  test('refusals: bad layout, ads on a plan without ads or without a picture, missing kit, plan without lower thirds, bad time zone', async () => {
    const run = (h: ReturnType<typeof fakeHost>, type: any, payload: any) => applySupportCommand({ type, payload }, h.env);
    const h = fakeHost();
    expect(await run(h, 'layout.set', { mode: 'no-such-layout' })).toEqual({ ok: false, error: 'Unknown layout' });
    expect((await run(h, 'ads.manual', { placement: 'side_third', manual: 'shown' })).ok).toBe(false); // no picture
    expect((await run(h, 'ads.enabled', { placement: 'side_third', enabled: true })).ok).toBe(false);
    expect((await run(h, 'ads.schedule', { placement: 'lower_third', mode: 'interval', showSec: 0, everySec: 5 })).ok).toBe(false);
    expect(await run(h, 'kit.apply', { kitId: 'someone-elses' })).toEqual({ ok: false, error: 'Unknown brand kit' });
    expect((await run(h, 'clock.set', { timezone: 'Mars/Olympus' })).ok).toBe(false);
    expect(h.calls).toEqual([]);
    const free = fakeHost({ plan: 'free' });
    expect((await run(free, 'ads.manual', { placement: 'lower_third', manual: 'shown' })).ok).toBe(false);
    expect(free.calls).toEqual([]);
    const noLt = fakeHost({ canLt: false });
    expect(await run(noLt, 'lowerThird.set', { name: 'A', show: true })).toEqual({ ok: false, error: 'Lower thirds are not available on this plan' });
    expect(await run(h, 'lowerThird.set', { show: true })).toEqual({ ok: false, error: 'Add the lower third text first' });
  });

  test('an unknown command type does nothing', async () => {
    const h = fakeHost();
    expect(await applySupportCommand({ type: 'stream.stop' as any, payload: {} }, h.env)).toEqual({ ok: false, error: 'Unknown command' });
    expect(h.calls).toEqual([]);
  });
});
