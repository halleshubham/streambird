import { parseSupportCommand, SUPPORT_COMMAND_TYPES, type SupportCommand } from './support-command';
import { PHONE_SUPPORTED_TYPES, PHONE_UNSUPPORTED_ERROR, PHONE_UPDATE_ERROR, PHONE_WAITING_ERROR, phoneStateToSnapshot, toPhoneCommand } from './phone-mapping';

const cmd = (type: string, payload: Record<string, unknown>): SupportCommand => {
  const r = parseSupportCommand({ id: 'c1', type, payload });
  if (!r.ok) throw new Error(r.error);
  return r.command;
};
const mapped = (type: string, payload: Record<string, unknown>) => {
  const m = toPhoneCommand(cmd(type, payload));
  if (!m.supported) throw new Error('unsupported');
  return { type: m.type, payload: m.payload };
};

describe('toPhoneCommand (support command -> phone command)', () => {
  it('ads.manual: web "manual" becomes the phone\'s "mode" (null = follow the schedule)', () => {
    expect(mapped('ads.manual', { placement: 'lower_third', manual: 'shown' })).toEqual({ type: 'ads.manual', payload: { placement: 'lower_third', mode: 'shown' } });
    expect(mapped('ads.manual', { placement: 'l_shape', manual: null }).payload).toEqual({ placement: 'l_shape', mode: null });
  });
  it('ads.enabled: web "enabled" becomes "on"', () => {
    expect(mapped('ads.enabled', { placement: 'side_third', enabled: false })).toEqual({ type: 'ads.enabled', payload: { placement: 'side_third', on: false } });
  });
  it('ads.schedule and ads.shrink pass through (optional seconds only when given)', () => {
    expect(mapped('ads.schedule', { placement: 'full_screen', mode: 'continuous' }).payload).toEqual({ placement: 'full_screen', mode: 'continuous' });
    expect(mapped('ads.schedule', { placement: 'full_screen', mode: 'interval', showSec: 10, everySec: 60 }).payload).toEqual({ placement: 'full_screen', mode: 'interval', showSec: 10, everySec: 60 });
    expect(mapped('ads.shrink', { on: true })).toEqual({ type: 'ads.shrink', payload: { on: true } });
  });
  it('ticker.set: the phone always gets {text: string|null, on: boolean}', () => {
    expect(mapped('ticker.set', { text: 'Hello', on: true }).payload).toEqual({ text: 'Hello', on: true });
    expect(mapped('ticker.set', { text: 'Hello' }).payload).toEqual({ text: 'Hello', on: true }); // text given: on by default
    expect(mapped('ticker.set', { text: 'Hello', on: false }).payload).toEqual({ text: 'Hello', on: false });
    expect(mapped('ticker.set', { on: false }).payload).toEqual({ text: null, on: false }); // hide
    expect(mapped('ticker.set', { on: true }).payload).toEqual({ text: null, on: true }); // bring back the current text
    expect(mapped('ticker.set', { text: '' }).payload).toEqual({ text: null, on: false }); // empty text clears
    expect(mapped('ticker.set', { text: null }).payload).toEqual({ text: null, on: false });
    expect(mapped('ticker.set', { text: '   ', on: true }).payload).toEqual({ text: null, on: false });
  });
  it('clock.set passes the kit clock fields through unchanged', () => {
    expect(mapped('clock.set', { enabled: true, position: 'top_left', timezone: null, alternate: false }).payload).toEqual({ enabled: true, position: 'top_left', timezone: null, alternate: false });
  });
  it('the layout and wallpaper commands are answered by the server, never queued', () => {
    const unsupported = SUPPORT_COMMAND_TYPES.filter((t) => !(PHONE_SUPPORTED_TYPES as readonly string[]).includes(t));
    expect(unsupported.sort()).toEqual(['layout.set', 'wallpaper.dim']);
    const all = { kit: true, logo: true, lowerThird: true };
    expect(toPhoneCommand(cmd('layout.set', { mode: 'grid' }), all)).toEqual({ supported: false, error: PHONE_UNSUPPORTED_ERROR });
    expect(toPhoneCommand(cmd('wallpaper.dim', { n: 10 }), all)).toEqual({ supported: false, error: PHONE_UNSUPPORTED_ERROR });
  });
  const KIT = '11111111-1111-4111-8111-111111111111';
  it('kit.apply, logo.set and lowerThird.set are relayed UNCHANGED when the phone showed the capability', () => {
    const all = { kit: true, logo: true, lowerThird: true };
    const m = (type: string, payload: Record<string, unknown>) => {
      const r = toPhoneCommand(cmd(type, payload), all);
      if (!r.supported) throw new Error('unsupported');
      return { type: r.type, payload: r.payload };
    };
    expect(m('kit.apply', { kitId: KIT })).toEqual({ type: 'kit.apply', payload: { kitId: KIT } });
    expect(m('kit.apply', { kitId: 'ABCDEF01-2345-4678-89AB-CDEF01234567' }).payload).toEqual({ kitId: 'abcdef01-2345-4678-89ab-cdef01234567' }); // lower-cased for the phone
    expect(m('logo.set', { position: 'right' })).toEqual({ type: 'logo.set', payload: { position: 'right' } });
    expect(m('logo.set', { size: 16 }).payload).toEqual({ size: 16 });
    expect(m('logo.set', { position: 'left', size: 600 }).payload).toEqual({ position: 'left', size: 600 });
    expect(m('lowerThird.set', { name: 'Ada', title: 'Host', show: true })).toEqual({ type: 'lowerThird.set', payload: { name: 'Ada', title: 'Host', show: true } });
    expect(m('lowerThird.set', { title: null }).payload).toEqual({ title: null });
    expect(m('lowerThird.set', { show: false }).payload).toEqual({ show: false });
  });
  it('capability gating: without the capability in the last snapshot the answer is "update the app" (per capability)', () => {
    const want = { supported: false, error: PHONE_UPDATE_ERROR };
    for (const caps of [{ kit: false, logo: false, lowerThird: false }]) {
      expect(toPhoneCommand(cmd('kit.apply', { kitId: KIT }), caps)).toEqual(want);
      expect(toPhoneCommand(cmd('logo.set', { position: 'left' }), caps)).toEqual(want);
      expect(toPhoneCommand(cmd('lowerThird.set', { show: false }), caps)).toEqual(want);
    }
    // no snapshot at all (just reconnected / state expired): a distinct "try again" answer, not "update the app"
    const waiting = { supported: false, error: PHONE_WAITING_ERROR };
    expect(PHONE_WAITING_ERROR).not.toBe(PHONE_UPDATE_ERROR);
    for (const caps of [undefined, null]) {
      expect(toPhoneCommand(cmd('kit.apply', { kitId: KIT }), caps)).toEqual(waiting);
      expect(toPhoneCommand(cmd('logo.set', { position: 'left' }), caps)).toEqual(waiting);
      expect(toPhoneCommand(cmd('lowerThird.set', { show: false }), caps)).toEqual(waiting);
    }
    const onlyKit = { kit: true, logo: false, lowerThird: false };
    expect(toPhoneCommand(cmd('kit.apply', { kitId: KIT }), onlyKit).supported).toBe(true);
    expect(toPhoneCommand(cmd('logo.set', { size: 100 }), onlyKit)).toEqual(want);
    expect(toPhoneCommand(cmd('lowerThird.set', { name: 'x' }), onlyKit)).toEqual(want);
    // the older commands never need a capability
    expect(toPhoneCommand(cmd('ads.shrink', { on: true })).supported).toBe(true);
  });
});

const clock = { enabled: true, position: 'top_right', format: '24h', showDate: false, showSeconds: true, timezone: 'Asia/Kolkata', size: 'medium', style: 'pill', alternate: false };
const phoneState = (over: Record<string, unknown> = {}) => ({
  v: 1,
  platform: 'android',
  appVersion: '1.0.14',
  orientation: 'portrait',
  freePlan: false,
  ads: {
    lower_third: { present: true, enabled: true, manual: 'shown', mode: 'interval', showSec: 15, everySec: 180, source: 'kit' },
    side_third: { present: false },
    full_screen: { present: true, enabled: false, manual: null, mode: 'continuous', showSec: 15, everySec: 180, source: 'phone' },
  },
  adsShrink: true,
  ticker: { text: 'Live now', on: true },
  clock,
  ...over,
});

describe('phoneStateToSnapshot (phone state -> control page snapshot)', () => {
  it('rebuilds the web snapshot shape and marks the platform', () => {
    const s = phoneStateToSnapshot(phoneState())!;
    expect(s).toMatchObject({ v: 1, platform: 'android', appVersion: '1.0.14', orientation: 'portrait', adsPlan: 'custom', adsShrink: true, kits: [], activeKitId: null });
    expect(s.ads.lower_third).toEqual({ hasMedia: true, name: 'Kit ad', enabled: true, schedule: { mode: 'interval', showSec: 15, everySec: 180 }, manual: 'shown' });
    expect(s.ads.full_screen).toEqual({ hasMedia: true, name: 'Phone ad', enabled: false, schedule: { mode: 'continuous' }, manual: null });
    expect(s.ads.side_third.hasMedia).toBe(false); // {present:false}
    expect(s.ads.l_shape.hasMedia).toBe(false); // missing placement
    expect(s.ticker).toEqual({ text: 'Live now', on: true });
    expect(s.clock).toEqual(clock);
    expect(s.lowerThird.allowed).toBe(false);
    expect(s.logo.has).toBe(false);
    expect(s.phoneCaps).toEqual({ kit: false, logo: false, lowerThird: false }); // older phone: no optional blocks
  });
  it('passes an optional ad sequence through read-only; a malformed one is ignored, never a refusal', () => {
    const withSeq = (sequence: unknown, current: unknown) =>
      phoneState({ ads: { lower_third: { present: true, enabled: true, manual: null, mode: 'continuous', source: 'kit', sequence, current } } });
    const ok = phoneStateToSnapshot(withSeq([{ enabled: true, showSec: 20 }, { enabled: false }], 1))!;
    expect(ok.ads.lower_third.sequence).toEqual([{ name: 'Ad 1', enabled: true, showSec: 20 }, { name: 'Ad 2', enabled: false, showSec: null }]);
    expect(ok.ads.lower_third.current).toBe(1);
    for (const bad of ['x', [], [{ enabled: 'yes' }], Array.from({ length: 6 }, () => ({ enabled: true }))]) {
      const s = phoneStateToSnapshot(withSeq(bad, 0))!;
      expect(s).not.toBeNull();
      expect(s.ads.lower_third.sequence).toBeUndefined();
    }
    expect(phoneStateToSnapshot(phoneState())!.ads.lower_third.sequence).toBeUndefined();
  });
  describe('optional capability blocks (kits, kit, logo, lowerThird)', () => {
    const K1 = '11111111-1111-4111-8111-111111111111';
    const K2 = '22222222-2222-4222-8222-222222222222';
    const full = () => ({
      kits: [
        { id: K1, name: 'Studio kit' },
        { id: K2, name: 'Night' },
      ],
      kit: { id: K2 },
      logo: { present: true, position: 'right', size: 120 },
      lowerThird: { available: true, name: 'Ada', title: null, show: true },
    });
    it('maps into the web snapshot fields the existing panels render', () => {
      const s = phoneStateToSnapshot(phoneState(full()))!;
      expect(s.phoneCaps).toEqual({ kit: true, logo: true, lowerThird: true });
      expect(s.kits).toEqual([
        { id: K1, name: 'Studio kit' },
        { id: K2, name: 'Night' },
      ]);
      expect(s.activeKitId).toBe(K2);
      expect(s.logo).toEqual({ position: 'right', size: 120, has: true });
      expect(s.lowerThird).toEqual({ name: 'Ada', title: '', live: true, allowed: true });
      expect(s.layout).toBe('phone'); // layout and wallpaper stay inert
      expect(s.wallpaper).toEqual({ dim: 0, has: false });
    });
    it('an empty kits array or only a kit key still switches the kit capability on', () => {
      expect(phoneStateToSnapshot(phoneState({ kits: [] }))!.phoneCaps).toEqual({ kit: true, logo: false, lowerThird: false });
      const k = phoneStateToSnapshot(phoneState({ kit: null }))!;
      expect(k.phoneCaps?.kit).toBe(true);
      expect(k.kits).toEqual([]);
      expect(k.activeKitId).toBeNull();
    });
    it('malformed blocks switch just their capability off and never fail the snapshot', () => {
      const s = phoneStateToSnapshot(
        phoneState({
          kits: 'nope',
          kit: { id: 'not-a-uuid' },
          logo: { present: true, position: 'top_left', size: 120 },
          lowerThird: { available: false, name: 'x', title: 'y', show: true },
        }),
      )!;
      expect(s.phoneCaps).toEqual({ kit: false, logo: false, lowerThird: false });
      for (const logo of [{ present: 'yes', position: 'left', size: 10 }, { present: true, position: 'left', size: 1.5 }, { present: true, position: 'left', size: 2001 }, { present: true, position: 'left', size: -1 }, 'x', null]) {
        expect(phoneStateToSnapshot(phoneState({ logo }))!.phoneCaps?.logo).toBe(false);
      }
      for (const lowerThird of [{ available: true, name: 5, title: null, show: true }, { available: true, name: 'a', title: null, show: 'yes' }, { available: 'true', name: 'a', title: null, show: true }, []]) {
        expect(phoneStateToSnapshot(phoneState({ lowerThird }))!.phoneCaps?.lowerThird).toBe(false);
      }
      expect(phoneStateToSnapshot(phoneState({ kits: new Array(51).fill({ id: K1, name: 'k' }) }))!.phoneCaps?.kit).toBe(false); // over the cap of 50
      const fifty = Array.from({ length: 50 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, name: `k${i}` }));
      expect(phoneStateToSnapshot(phoneState({ kits: fifty }))!.kits).toHaveLength(50);
    });
    it('drops kit entries with a bad id, strips control/bidi characters and limits lengths', () => {
      const evil = '\u202Egnp.exe\u0000\u200B\n' + 'x'.repeat(200);
      const s = phoneStateToSnapshot(
        phoneState({
          kits: [{ id: 'javascript:alert(1)', name: 'bad' }, { id: K1, name: evil }, { id: K2, name: '\u202E\u0007' }, { id: K1 }, 'str', null, { id: K2, name: 'ok', extra: 'dropped' }],
          lowerThird: { available: true, name: evil, title: evil + 'y'.repeat(200), show: false },
        }),
      )!;
      expect(s.kits.map((k) => k.id)).toEqual([K1, K2]); // the second K2 entry is a duplicate
      expect(s.kits[0].name).toMatch(/^gnp\.exe/);
      expect(s.kits[0].name.length).toBeLessThanOrEqual(80);
      expect(s.kits[1].name).toBe('Brand kit'); // nothing left after stripping (first K2 entry wins)
      expect(Object.keys(s.kits[1])).toEqual(['id', 'name']);
      expect(s.lowerThird.name.length).toBeLessThanOrEqual(80);
      expect(s.lowerThird.title.length).toBeLessThanOrEqual(120);
      expect(JSON.stringify(s)).not.toMatch(/[\u0000-\u001f\u202e\u200b]/);
    });
    it('duplicate kit ids are skipped (first wins, also across letter case)', () => {
      const s = phoneStateToSnapshot(phoneState({ kits: [{ id: K1, name: 'First' }, { id: K1.toUpperCase(), name: 'Second' }, { id: K2, name: 'Other' }, { id: K1, name: 'Third' }] }))!;
      expect(s.kits).toEqual([{ id: K1, name: 'First' }, { id: K2, name: 'Other' }]);
    });
    it('the phone ticker text loses control, bidi and format characters', () => {
      const s = phoneStateToSnapshot(phoneState({ ticker: { text: 'Hi\u202E\u0000 there\u200B\u2028!', on: true } }))!;
      expect(s.ticker.text).toBe('Hi there!');
    });
    it('uppercase uuids are normalised so the page selects the active kit', () => {
      const s = phoneStateToSnapshot(phoneState({ kits: [{ id: K1.toUpperCase(), name: 'A' }], kit: { id: K1.toUpperCase() } }))!;
      expect(s.kits[0].id).toBe(K1);
      expect(s.activeKitId).toBe(K1);
    });
  });
  it('freePlan maps to the free ads plan; a null ticker text becomes empty', () => {
    const s = phoneStateToSnapshot(phoneState({ freePlan: true, ticker: { text: null, on: false } }))!;
    expect(s.adsPlan).toBe('free');
    expect(s.ticker).toEqual({ text: '', on: false });
  });
  it('drops anything malformed and never lets extra keys through', () => {
    for (const bad of [
      null,
      'x',
      phoneState({ v: 2 }),
      phoneState({ platform: 'ios' }),
      phoneState({ appVersion: 'x'.repeat(40) }),
      phoneState({ appVersion: '<script>' }),
      phoneState({ orientation: 'square' }),
      phoneState({ freePlan: 'no' }),
      phoneState({ adsShrink: 1 }),
      phoneState({ ads: null }),
      phoneState({ ads: { lower_third: { present: true, enabled: true, manual: 'maybe', mode: 'continuous', source: 'kit' } } }),
      phoneState({ ads: { lower_third: { present: true, enabled: true, manual: null, mode: 'interval', showSec: 0, everySec: 60, source: 'kit' } } }),
      phoneState({ ads: { lower_third: { present: true, enabled: true, manual: null, mode: 'interval', showSec: 5, everySec: 90000, source: 'kit' } } }),
      phoneState({ ads: { lower_third: { present: true, enabled: true, manual: null, mode: 'continuous', source: 'cloud' } } }),
      phoneState({ ads: { lower_third: 'x' } }),
      phoneState({ ticker: { text: 5, on: true } }),
      phoneState({ ticker: { text: 'x'.repeat(1001), on: true } }),
      phoneState({ ticker: { text: 'a' } }),
      phoneState({ clock: { ...clock, position: 'middle' } }),
      phoneState({ clock: null }),
    ]) {
      expect(phoneStateToSnapshot(bad)).toBeNull();
    }
    const s = phoneStateToSnapshot({ ...phoneState(), secretToken: 'abc', ads: { ...phoneState().ads, lower_third: { ...phoneState().ads.lower_third, url: 'https://x' } } })!;
    expect(JSON.stringify(s)).not.toContain('abc');
    expect(JSON.stringify(s)).not.toContain('https://x');
    expect(Object.keys(s).sort()).toEqual(['activeKitId', 'ads', 'adsPlan', 'adsShrink', 'appVersion', 'clock', 'kits', 'layout', 'logo', 'lowerThird', 'orientation', 'phoneCaps', 'platform', 'ticker', 'v', 'wallpaper']);
  });
});
