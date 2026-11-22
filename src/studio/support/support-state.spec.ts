import { sanitizeSupportState } from './support-state';

const noAd = { hasMedia: false, name: null, enabled: false, schedule: { mode: 'continuous' }, manual: null };
const good = () => ({
  v: 1,
  layout: 'grid',
  orientation: 'landscape',
  adsPlan: 'custom',
  ads: { lower_third: { ...noAd, hasMedia: true, name: 'Sponsor', enabled: true, schedule: { mode: 'interval', showSec: 15, everySec: 180 }, manual: 'shown' }, side_third: noAd, full_screen: noAd, l_shape: noAd },
  adsShrink: true,
  kits: [{ id: 'k1', name: 'Kit one' }],
  activeKitId: 'k1',
  ticker: { text: 'hello', on: true },
  lowerThird: { name: 'A', title: 'B', live: false, allowed: true },
  clock: { enabled: true, position: 'top_left', format: '24h', showDate: false, showSeconds: true, timezone: 'Asia/Kolkata', size: 'large', style: 'pill', alternate: false },
  logo: { position: 'right', size: 120, has: true },
  wallpaper: { dim: 30, has: true },
});

describe('sanitizeSupportState', () => {
  it('accepts a complete snapshot and returns an equal copy', () => {
    expect(sanitizeSupportState(good())).toEqual(good());
  });

  it('strips unknown keys at every level (nothing rides along)', () => {
    const dirty: any = good();
    dirty.hostToken = 'SECRET';
    dirty.clock.extra = 1;
    dirty.ads.lower_third.previewUrl = 'blob:x';
    dirty.kits[0].secret = 's';
    expect(JSON.stringify(sanitizeSupportState(dirty))).not.toMatch(/SECRET|extra|blob|secret/);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a wrong version', { ...good(), v: 2 }],
    ['a missing ads placement', { ...good(), ads: { lower_third: noAd } }],
    ['a bad manual value', { ...good(), ads: { ...good().ads, side_third: { ...noAd, manual: 'maybe' } } }],
    ['a schedule out of range', { ...good(), ads: { ...good().ads, side_third: { ...noAd, schedule: { mode: 'interval', showSec: 0, everySec: 5 } } } }],
    ['kits that are not a list', { ...good(), kits: 'x' }],
    ['more than 50 kits', { ...good(), kits: Array.from({ length: 51 }, (_, i) => ({ id: `k${i}`, name: 'n' })) }],
    ['an unknown clock format', { ...good(), clock: { ...good().clock, format: '99h' } }],
    ['a layout that is not an id', { ...good(), layout: 'Not valid!' }],
    ['an over-long ticker', { ...good(), ticker: { text: 'x'.repeat(1001), on: true } }],
    ['a wallpaper dim out of range', { ...good(), wallpaper: { dim: 500, has: true } }],
    ['a logo size that is not a number', { ...good(), logo: { position: 'left', size: '90', has: true } }],
  ])('refuses %s', (_name, raw) => {
    expect(sanitizeSupportState(raw)).toBeNull();
  });

  it('never throws on hostile input', () => {
    const cyclic: any = {};
    cyclic.self = cyclic;
    expect(sanitizeSupportState(cyclic)).toBeNull();
    expect(sanitizeSupportState(JSON.parse('{"__proto__":{"v":1}}'))).toBeNull();
  });

  it('accepts an ad sequence (read-only list, current index) and strips what rides along; older snapshots without it still pass', () => {
    const g: any = good();
    g.ads.l_shape = { ...noAd, hasMedia: true, name: 'F1', enabled: true, sequence: [{ name: 'F1', enabled: true, showSec: 20 }, { name: 'F2', enabled: false, showSec: null, extra: 'x' }], current: 0 };
    const out: any = sanitizeSupportState(g);
    expect(out.ads.l_shape.sequence).toEqual([{ name: 'F1', enabled: true, showSec: 20 }, { name: 'F2', enabled: false, showSec: null }]);
    expect(out.ads.l_shape.current).toBe(0);
    expect(sanitizeSupportState(good())).toEqual(good()); // no sequence key appears
  });

  it('refuses a malformed ad sequence (too long, bad entry, bad current)', () => {
    const mk = (seq: unknown, current: unknown = 0) => {
      const g: any = good();
      g.ads.l_shape = { ...noAd, hasMedia: true, name: 'F', enabled: true, sequence: seq, current };
      return sanitizeSupportState(g);
    };
    const e = { name: 'x', enabled: true, showSec: 5 };
    expect(mk([e, e, e, e, e, e])).toBeNull();
    expect(mk('nope')).toBeNull();
    expect(mk([{ name: 'x', enabled: 'yes', showSec: 5 }])).toBeNull();
    expect(mk([{ name: 'x', enabled: true, showSec: 99999 }])).toBeNull();
    expect(mk([e], 7)).toBeNull();
    expect(mk([e, e])).not.toBeNull();
  });
});
