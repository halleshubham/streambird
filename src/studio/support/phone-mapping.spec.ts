import { parseSupportCommand, SUPPORT_COMMAND_TYPES, type SupportCommand } from './support-command';
import { PHONE_SUPPORTED_TYPES, PHONE_UNSUPPORTED_ERROR, phoneStateToSnapshot, toPhoneCommand } from './phone-mapping';

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
  it('the web-only commands are answered by the server, never queued', () => {
    const unsupported = SUPPORT_COMMAND_TYPES.filter((t) => !(PHONE_SUPPORTED_TYPES as readonly string[]).includes(t));
    expect(unsupported.sort()).toEqual(['kit.apply', 'layout.set', 'logo.set', 'lowerThird.set', 'wallpaper.dim']);
    expect(toPhoneCommand(cmd('layout.set', { mode: 'grid' }))).toEqual({ supported: false, error: PHONE_UNSUPPORTED_ERROR });
    expect(toPhoneCommand(cmd('wallpaper.dim', { n: 10 }))).toEqual({ supported: false, error: PHONE_UNSUPPORTED_ERROR });
    expect(toPhoneCommand(cmd('kit.apply', { kitId: '11111111-1111-4111-8111-111111111111' })).supported).toBe(false);
    expect(toPhoneCommand(cmd('lowerThird.set', { show: false })).supported).toBe(false);
    expect(toPhoneCommand(cmd('logo.set', { position: 'left' })).supported).toBe(false);
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
    expect(Object.keys(s).sort()).toEqual(['activeKitId', 'ads', 'adsPlan', 'adsShrink', 'appVersion', 'clock', 'kits', 'layout', 'logo', 'lowerThird', 'orientation', 'platform', 'ticker', 'v', 'wallpaper']);
  });
});
