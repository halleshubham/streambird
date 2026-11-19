import { buildKitDiagnostics, buildStreamDiagnostics, describeWindowCheck } from './brand-kit-diagnostics';
import type { AdSummary, DiagnosticsInput, KitSet } from './brand-kit-diagnostics';

const asset = (over: Partial<AdSummary> = {}): AdSummary => ({
  assetId: 'a1',
  fileName: 'frame.png',
  mime: 'image/png',
  sizeBytes: 1000,
  width: 1280,
  height: 720,
  placement: 'l_shape',
  enabled: true,
  mode: 'continuous',
  showSec: null,
  everySec: null,
  ...over,
});
const set = (ads: AdSummary[] = [], extra: Partial<KitSet> = {}): KitSet => ({ logo: null, wallpaper: null, ads, ...extra });
const kit = (over: Partial<DiagnosticsInput> = {}): DiagnosticsInput => ({
  isDefault: false,
  adsShrinkPicture: true,
  channels: [],
  landscape: set(),
  portrait: set(),
  thumbnail: null,
  plan: { name: 'Pro', watermark: false },
  ...over,
});
const texts = (d: { text: string }[]) => d.map((x) => x.text).join('\n');

describe('buildKitDiagnostics', () => {
  it('says there are no ads and that an unused kit is picked up by nothing', () => {
    const t = texts(buildKitDiagnostics(kit()));
    expect(t).toContain('No ads in either set.');
    expect(t).toContain('no channel uses it');
  });

  it('lists the channels and the default role', () => {
    const t = texts(buildKitDiagnostics(kit({ channels: ['youtube: Main'], isDefault: true })));
    expect(t).toContain('Kit applies to channels: youtube: Main.');
    expect(t).toContain('Account default kit');
    expect(t).not.toContain('no channel uses it');
  });

  it('reports the L-frame file and the window found', () => {
    const d = buildKitDiagnostics(kit({ landscape: set([asset({ windowCheck: { status: 'found', x: 0.1, y: 0.1, w: 0.8, h: 0.8 } })]), portrait: set([asset()]) }));
    expect(texts(d)).toContain('L-shaped frame (landscape (16:9)): file 1280x720 PNG; window check: found 80% x 80%.');
    expect(d.find((x) => x.text.includes('window check'))!.level).toBe('info');
  });

  it('warns when no clear window is found', () => {
    const d = buildKitDiagnostics(kit({ landscape: set([asset({ windowCheck: { status: 'none' } })]) }));
    const w = d.find((x) => x.text.includes('NO CLEAR WINDOW FOUND'))!;
    expect(w.level).toBe('warning');
  });

  it('says not checked with the reason', () => {
    expect(describeWindowCheck({ status: 'not_checked', reason: 'GIF files are not decoded here' })).toBe('not checked (GIF files are not decoded here)');
    expect(describeWindowCheck(undefined)).toBe('not checked');
  });

  it('explains an interval frame: hidden first, then shown', () => {
    const d = buildKitDiagnostics(kit({ landscape: set([asset({ mode: 'interval', showSec: 20, everySec: 180 })]) }));
    expect(texts(d)).toContain('Now and then: hidden for the first 180 s of each cycle, then shown for 20 s (cycle 200 s)');
  });

  it('warns that the frame will not run when shrinking is off, but not without a frame', () => {
    const withFrame = buildKitDiagnostics(kit({ adsShrinkPicture: false, landscape: set([asset()]) }));
    expect(withFrame.find((x) => x.text.includes('Shrink picture while ads show is OFF: the L-shaped frame will not run.'))!.level).toBe('warning');
    const noFrame = buildKitDiagnostics(kit({ adsShrinkPicture: false, landscape: set([asset({ placement: 'lower_third' })]) }));
    expect(texts(noFrame)).not.toContain('Shrink picture');
  });

  it('notices a missing frame in the other set, both ways', () => {
    const land = buildKitDiagnostics(kit({ landscape: set([asset()]) }));
    expect(texts(land)).toContain('Portrait (9:16) set has no L-shaped frame (a vertical stream will not show one).');
    const port = buildKitDiagnostics(kit({ portrait: set([asset()]) }));
    expect(texts(port)).toContain('Landscape (16:9) set has no L-shaped frame (a landscape stream will not show one).');
  });

  it('notes a switched off ad and a logo only in one set', () => {
    const d = buildKitDiagnostics(kit({ landscape: set([asset({ enabled: false })], { logo: { assetId: 'l', fileName: 'l.png', mime: 'image/png', sizeBytes: 1, width: 1, height: 1 } }) }));
    expect(texts(d)).toContain('is switched off');
    expect(texts(d)).toContain('Portrait (9:16) set has no logo.');
  });

  it('flags the Free plan: no custom ads', () => {
    const d = buildKitDiagnostics(kit({ plan: { name: 'Free', watermark: true }, landscape: set([asset()]) }));
    expect(d[0].level).toBe('warning');
    expect(d[0].text).toContain('Plan Free carries the Powered-by StreamBird mark');
  });
});

describe('buildStreamDiagnostics', () => {
  const k = (over = {}) => ({ name: 'Main', adsShrinkPicture: true, landscape: set([asset()]), portrait: set(), ...over });
  const plan = { name: 'Pro', watermark: false };

  it('warns when no kit applies', () => {
    const d = buildStreamDiagnostics({ orientation: 'landscape', kit: null, kitSource: null, plan });
    expect(d[0].level).toBe('warning');
  });

  it('a vertical stream uses the portrait set, which has no frame', () => {
    const t = texts(buildStreamDiagnostics({ orientation: 'portrait', kit: k(), kitSource: 'account_default', plan }));
    expect(t).toContain('account default');
    expect(t).toContain('The portrait set has no L-shaped frame');
  });

  it('warns on shrink off and on a frame without a window', () => {
    expect(texts(buildStreamDiagnostics({ orientation: 'landscape', kit: k({ adsShrinkPicture: false }), kitSource: 'channel', plan }))).toContain('will not run on this stream');
    const noWin = k({ landscape: set([asset({ windowCheck: { status: 'none' } })]) });
    expect(texts(buildStreamDiagnostics({ orientation: 'landscape', kit: noWin, kitSource: 'channel', plan }))).toContain('no clear window');
  });
});
