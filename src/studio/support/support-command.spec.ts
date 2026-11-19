import {
  SUPPORT_COMMAND_TYPES,
  SUPPORT_TEXT_MAX,
  SlidingWindowLimiter,
  parseSupportCommand,
  summarizeCommand,
} from './support-command';

const ok = (type: string, payload: unknown, id = 'c1') => parseSupportCommand({ id, type, payload });

describe('parseSupportCommand: the whitelist', () => {
  it('knows exactly the founder-approved command types', () => {
    expect([...SUPPORT_COMMAND_TYPES].sort()).toEqual(
      ['ads.enabled', 'ads.manual', 'ads.schedule', 'ads.shrink', 'clock.set', 'kit.apply', 'layout.set', 'logo.set', 'lowerThird.set', 'ticker.set', 'wallpaper.dim'].sort(),
    );
  });

  it.each([
    ['layout.set', { mode: 'podcast-split' }],
    ['ads.manual', { placement: 'lower_third', manual: 'shown' }],
    ['ads.manual', { placement: 'full_screen', manual: null }],
    ['ads.enabled', { placement: 'l_shape', enabled: false }],
    ['ads.schedule', { placement: 'side_third', mode: 'interval', showSec: 15, everySec: 180 }],
    ['ads.schedule', { placement: 'side_third', mode: 'continuous' }],
    ['ads.shrink', { on: true }],
    ['kit.apply', { kitId: '0b9a8c5e-3f2d-4a6b-8c1d-2e3f4a5b6c7d' }],
    ['ticker.set', { text: 'Breaking news', on: true }],
    ['ticker.set', { text: null }],
    ['ticker.set', { on: false }],
    ['lowerThird.set', { name: 'Asha', title: 'Host', show: true }],
    ['lowerThird.set', { show: false }],
    ['clock.set', { enabled: true, position: 'top_left', format: '24h', showDate: false, showSeconds: true, timezone: 'Asia/Kolkata', size: 'large', style: 'pill', alternate: false }],
    ['logo.set', { position: 'right', size: 120 }],
    ['wallpaper.dim', { n: 40 }],
  ])('accepts %s %j', (type, payload) => {
    const r = ok(type, payload);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command).toEqual({ id: 'c1', type, payload });
  });

  it.each([
    'stream.start',
    'stream.stop',
    'go-live',
    'end',
    'publish',
    'resolution.set',
    'bitrate.set',
    'camera.set',
    'mic.mute',
    'screen.share',
    'guest.admit',
    'guest.kick',
    'guest.mute',
    'recording.start',
    'invite.create',
    '__proto__',
    'constructor',
    '',
  ])('rejects the unknown / excluded command %p', (type) => {
    expect(ok(type, {})).toEqual({ ok: false, error: 'Unknown command' });
  });

  it('rejects bad ids, non-objects and non-object payloads', () => {
    expect(parseSupportCommand(null).ok).toBe(false);
    expect(parseSupportCommand('x').ok).toBe(false);
    expect(parseSupportCommand({ type: 'layout.set', payload: { mode: 'grid' } }).ok).toBe(false);
    expect(parseSupportCommand({ id: 'has space', type: 'layout.set', payload: { mode: 'grid' } }).ok).toBe(false);
    expect(parseSupportCommand({ id: 'x'.repeat(65), type: 'layout.set', payload: { mode: 'grid' } }).ok).toBe(false);
    expect(ok('layout.set', ['grid']).ok).toBe(false);
    expect(ok('layout.set', 'grid').ok).toBe(false);
  });

  it('rejects unknown parameters, missing required ones and wrong types', () => {
    expect(ok('layout.set', { mode: 'grid', extra: 1 })).toEqual({ ok: false, error: 'Unknown parameter "extra"' });
    expect(ok('layout.set', {}).ok).toBe(false);
    expect(ok('layout.set', { mode: 'Not A Layout!' }).ok).toBe(false);
    expect(ok('ads.manual', { placement: 'nowhere', manual: 'shown' }).ok).toBe(false);
    expect(ok('ads.manual', { placement: 'lower_third', manual: 'maybe' }).ok).toBe(false);
    expect(ok('ads.enabled', { placement: 'lower_third', enabled: 'yes' }).ok).toBe(false);
    expect(ok('ads.shrink', { on: 1 }).ok).toBe(false);
    expect(ok('kit.apply', { kitId: 'not-a-uuid' }).ok).toBe(false);
    expect(ok('clock.set', { format: '36h' }).ok).toBe(false);
    expect(ok('clock.set', { position: 'middle' }).ok).toBe(false);
    expect(ok('logo.set', { position: 'up' }).ok).toBe(false);
  });

  it('rejects numbers out of range or not whole', () => {
    expect(ok('wallpaper.dim', { n: 71 }).ok).toBe(false);
    expect(ok('wallpaper.dim', { n: -1 }).ok).toBe(false);
    expect(ok('wallpaper.dim', { n: 1.5 }).ok).toBe(false);
    expect(ok('wallpaper.dim', { n: '10' }).ok).toBe(false);
    expect(ok('logo.set', { size: 15 }).ok).toBe(false);
    expect(ok('logo.set', { size: 601 }).ok).toBe(false);
    expect(ok('ads.schedule', { placement: 'lower_third', mode: 'interval', showSec: 0, everySec: 10 }).ok).toBe(false);
    expect(ok('ads.schedule', { placement: 'lower_third', mode: 'interval', showSec: 3601, everySec: 10 }).ok).toBe(false);
    expect(ok('ads.schedule', { placement: 'lower_third', mode: 'interval', showSec: 5, everySec: 86401 }).ok).toBe(false);
    expect(ok('ads.schedule', { placement: 'lower_third', mode: 'interval', showSec: 5 }).ok).toBe(false);
  });

  it('enforces the text size limits and refuses control characters', () => {
    expect(ok('ticker.set', { text: 'x'.repeat(SUPPORT_TEXT_MAX) }).ok).toBe(true);
    expect(ok('ticker.set', { text: 'x'.repeat(SUPPORT_TEXT_MAX + 1) }).ok).toBe(false);
    expect(ok('ticker.set', { text: 'a\u0000b' }).ok).toBe(false);
    expect(ok('lowerThird.set', { name: 'n'.repeat(81) }).ok).toBe(false);
    expect(ok('lowerThird.set', { title: 't'.repeat(121) }).ok).toBe(false);
    expect(ok('clock.set', { timezone: 'z'.repeat(65) }).ok).toBe(false);
  });

  it('refuses an empty partial update and an oversize payload', () => {
    expect(ok('ticker.set', {}).ok).toBe(false);
    expect(ok('clock.set', {}).ok).toBe(false);
    expect(ok('lowerThird.set', {}).ok).toBe(false);
    expect(ok('logo.set', {}).ok).toBe(false);
    const big = { text: 'x'.repeat(100), pad: 'y'.repeat(2000) };
    expect(ok('ticker.set', big)).toEqual({ ok: false, error: 'Command payload too large' });
  });

  it('drops anything that rides along (prototype pollution included)', () => {
    const payload = JSON.parse('{"mode":"grid","__proto__":{"admin":true}}');
    expect(ok('layout.set', payload).ok).toBe(false);
  });
});

describe('summarizeCommand: what the audit log sees', () => {
  const sum = (type: string, payload: unknown) => {
    const r = ok(type, payload);
    if (!r.ok) throw new Error(r.error);
    return summarizeCommand(r.command);
  };

  it('keeps small non-secret values', () => {
    expect(sum('layout.set', { mode: 'grid' })).toBe('layout.set{mode=grid}');
    expect(sum('ads.manual', { placement: 'lower_third', manual: 'shown' })).toBe('ads.manual{placement=lower_third,manual=shown}');
    expect(sum('ads.shrink', { on: false })).toBe('ads.shrink{on=false}');
  });

  it('records free text by LENGTH only, never the text', () => {
    const s = sum('ticker.set', { text: 'secret breaking news', on: true });
    expect(s).toBe('ticker.set{text[len=20],on=true}');
    expect(s).not.toContain('secret');
    const lt = sum('lowerThird.set', { name: 'Jane Customer', title: 'CEO of Acme', show: true });
    expect(lt).toBe('lowerThird.set{name[len=13],title[len=11],show=true}');
    expect(lt).not.toContain('Jane');
    expect(sum('clock.set', { timezone: 'Asia/Kolkata' })).toBe('clock.set{timezone[len=12]}');
  });

  it('is never longer than 100 characters', () => {
    const s = sum('clock.set', { enabled: true, position: 'bottom_right', format: '24h', showDate: false, showSeconds: true, timezone: 'x'.repeat(40), size: 'medium', style: 'pill', alternate: false });
    expect(s.length).toBeLessThanOrEqual(100);
  });
});

describe('SlidingWindowLimiter', () => {
  it('allows `limit` hits per window, then refuses, then recovers', () => {
    const l = new SlidingWindowLimiter(20, 10_000);
    for (let i = 0; i < 20; i++) expect(l.allow('s', 1000 + i)).toBe(true);
    expect(l.allow('s', 1100)).toBe(false);
    expect(l.allow('s', 9999)).toBe(false);
    expect(l.allow('s', 11_005)).toBe(true); // the first hits left the window
  });

  it('counts per key', () => {
    const l = new SlidingWindowLimiter(1, 1000);
    expect(l.allow('a', 0)).toBe(true);
    expect(l.allow('a', 10)).toBe(false);
    expect(l.allow('b', 10)).toBe(true);
    l.forget('a');
    expect(l.allow('a', 20)).toBe(true);
  });

  it('refused hits do not extend the lockout', () => {
    const l = new SlidingWindowLimiter(2, 1000);
    l.allow('k', 0);
    l.allow('k', 1);
    for (let t = 2; t < 900; t += 100) expect(l.allow('k', t)).toBe(false);
    expect(l.allow('k', 1001)).toBe(true);
  });
});
