import { PhoneRemoteService, PHONE_ACTIVE_MS, PHONE_COMMAND_TTL_MS, PHONE_MAX_COMMANDS_PER_ANSWER, PHONE_MAX_HELD_GLOBAL, PHONE_MAX_HELD_PER_ACCOUNT, PHONE_MAX_PENDING_PER_STREAM } from './phone-remote.service';

const S1 = 'stream-1';
const S2 = 'stream-2';
const base = { studioSessionId: 'ss', accountId: 'acc', after: 0, waitSec: 0 };

function build(t0 = 1_800_000_000_000) {
  const svc = new PhoneRemoteService();
  let t = t0;
  svc.now = () => t;
  const events = { host: [] as any[], ack: [] as any[], state: [] as any[] };
  svc.onHost((e) => events.host.push(e));
  svc.onAck((e) => events.ack.push(e));
  svc.onState((e) => events.state.push(e));
  return { svc, events, advance: (ms: number) => (t += ms), clock: () => t };
}
const cmd = (id: string) => ({ id, type: 'ads.shrink' as const, payload: { on: true } });
const poll = async (svc: PhoneRemoteService, over: Record<string, unknown> = {}) => (await svc.poll({ streamId: S1, ...base, ...over } as any).result);
const goodState = () => ({
  rev: 1,
  state: {
    v: 1, platform: 'android', appVersion: '1.0.14', orientation: 'landscape', freePlan: false, ads: {}, adsShrink: false, ticker: { text: null, on: false },
    clock: { enabled: false, position: 'top_right', format: '12h', showDate: true, showSeconds: false, timezone: null, size: 'small', style: 'text', alternate: true },
  },
});

describe('PhoneRemoteService queue', () => {
  it('a phone that never polled is not connected: nothing can be queued', () => {
    const { svc } = build();
    expect(svc.isActive(S1)).toBe(false);
    expect(svc.enqueue(S1, cmd('a'))).toEqual({ ok: false, error: 'The phone app is not connected' });
  });

  it('seq is strictly increasing, in order, and polls answer only what is newer than `after`', async () => {
    const { svc } = build();
    expect((await poll(svc)).status).toBe('empty');
    const a = svc.enqueue(S1, cmd('a')) as { seq: number };
    const b = svc.enqueue(S1, cmd('b')) as { seq: number };
    const c = svc.enqueue(S1, cmd('c')) as { seq: number };
    expect(b.seq).toBeGreaterThan(a.seq);
    expect(c.seq).toBeGreaterThan(b.seq);
    const r = (await poll(svc, { after: 0 })) as any;
    expect(r.commands.map((x: any) => x.id)).toEqual(['a', 'b', 'c']);
    expect(r.commands.map((x: any) => x.seq)).toEqual([a.seq, b.seq, c.seq]);
    expect(typeof r.commands[0].at).toBe('string');
    expect(new Date(r.now).toISOString()).toBe(r.now);
    const r2 = (await poll(svc, { after: b.seq })) as any;
    expect(r2.commands.map((x: any) => x.id)).toEqual(['c']);
    expect((await poll(svc, { after: c.seq })).status).toBe('empty');
  });

  it('an answer holds at most 100 commands', async () => {
    const { svc } = build();
    await poll(svc);
    for (let i = 0; i < 150; i++) expect(svc.enqueue(S1, cmd(`c${i}`)).ok).toBe(true);
    const r = (await poll(svc, { after: 0 })) as any;
    expect(r.commands).toHaveLength(PHONE_MAX_COMMANDS_PER_ANSWER);
    expect(r.commands[0].id).toBe('c0');
  });

  it('the queue is bounded (200 pending), duplicate ids are refused, expired commands are dropped', async () => {
    const { svc, advance } = build();
    await poll(svc);
    for (let i = 0; i < PHONE_MAX_PENDING_PER_STREAM; i++) expect(svc.enqueue(S1, cmd(`c${i}`)).ok).toBe(true);
    expect(svc.enqueue(S1, cmd('over'))).toEqual({ ok: false, error: 'Too many commands are waiting for the phone app' });
    expect(svc.pendingCount(S1)).toBe(200);
    advance(PHONE_COMMAND_TTL_MS + 1);
    await poll(svc); // keeps the phone active, expires the old ones
    expect(svc.pendingCount(S1)).toBe(0);
    expect(svc.enqueue(S1, cmd('x')).ok).toBe(true);
    expect(svc.enqueue(S1, cmd('x'))).toEqual({ ok: false, error: 'Duplicate command id' });
  });

  it('a held poll wakes when a command is queued; with nothing it answers empty after the wait', async () => {
    jest.useFakeTimers();
    try {
      const { svc } = build();
      const held = svc.poll({ streamId: S1, ...base, waitSec: 25 });
      expect(svc.heldCount()).toBe(1);
      expect(svc.enqueue(S1, cmd('a')).ok).toBe(true); // the held poll makes the phone active
      const r = (await held.result) as any;
      expect(r.status).toBe('commands');
      expect(r.commands[0].id).toBe('a');
      expect(svc.heldCount()).toBe(0);
      const idle = svc.poll({ streamId: S1, ...base, after: r.commands[0].seq, waitSec: 25 });
      jest.advanceTimersByTime(25_001);
      expect((await idle.result).status).toBe('empty');
      expect(svc.heldCount()).toBe(0);
      // `wait` is capped at 25 s however large it is asked
      const big = svc.poll({ streamId: S1, ...base, after: r.commands[0].seq, waitSec: 9999 });
      jest.advanceTimersByTime(25_001);
      expect((await big.result).status).toBe('empty');
    } finally {
      jest.useRealTimers();
    }
  });

  it('a new poll supersedes the held one (the old answers empty); cancel frees the hold', async () => {
    jest.useFakeTimers();
    try {
      const { svc } = build();
      const first = svc.poll({ streamId: S1, ...base, waitSec: 25 });
      const second = svc.poll({ streamId: S1, ...base, waitSec: 25 });
      expect((await first.result).status).toBe('empty');
      expect(svc.heldCount()).toBe(1);
      second.cancel();
      expect(svc.heldCount()).toBe(0);
      expect((await second.result).status).toBe('empty');
    } finally {
      jest.useRealTimers();
    }
  });

  it('caps held polls per account (10); a superseding poll needs no extra slot; other accounts are unaffected', async () => {
    jest.useFakeTimers();
    try {
      const { svc } = build();
      const held = (streamId: string, accountId: string) => svc.poll({ streamId, studioSessionId: 'ss', accountId, after: 0, waitSec: 25 });
      for (let i = 0; i < PHONE_MAX_HELD_PER_ACCOUNT; i++) held(`s${i}`, 'acc');
      expect(svc.heldCount()).toBe(10);
      expect((await held('s-over', 'acc').result).status).toBe('limited');
      held('s0', 'acc'); // supersedes the held poll of s0: still 10
      expect(svc.heldCount()).toBe(10);
      held('other-stream', 'other-account');
      expect(svc.heldCount()).toBe(11);
      svc.onModuleDestroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('caps held polls globally (200)', async () => {
    jest.useFakeTimers();
    try {
      const { svc } = build();
      for (let i = 0; i < PHONE_MAX_HELD_GLOBAL; i++) svc.poll({ streamId: `g${i}`, studioSessionId: 'ss', accountId: `acct${i}`, after: 0, waitSec: 25 });
      expect(svc.heldCount()).toBe(200);
      expect((await svc.poll({ streamId: 'one-more', studioSessionId: 'ss', accountId: 'acct-new', after: 0, waitSec: 25 }).result).status).toBe('limited');
      svc.onModuleDestroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('rate limits polls per stream', async () => {
    const { svc } = build();
    let limited = 0;
    for (let i = 0; i < 60; i++) if ((await poll(svc)).status === 'limited') limited++;
    expect(limited).toBeGreaterThan(0);
  });

  it('ack: matches only a command pending for THAT stream and account, once; no replay', async () => {
    const { svc, events } = build();
    await poll(svc);
    await svc.poll({ streamId: S2, ...base }).result;
    svc.enqueue(S1, cmd('a'));
    expect(svc.ack({ streamId: S2, accountId: 'acc', id: 'a', ok: true })).toBe('ignored'); // other stream
    expect(svc.ack({ streamId: S1, accountId: 'other', id: 'a', ok: true })).toBe('ignored'); // other account
    expect(svc.ack({ streamId: S1, accountId: 'acc', id: 'zzz', ok: true })).toBe('ignored'); // unknown
    expect(svc.ack({ streamId: S1, accountId: 'acc', id: 5, ok: true })).toBe('ignored');
    expect(svc.ack({ streamId: S1, accountId: 'acc', id: 'a', ok: 'yes' })).toBe('ignored');
    expect(events.ack).toHaveLength(0);
    expect(svc.ack({ streamId: S1, accountId: 'acc', id: 'a', ok: false, error: 'x'.repeat(300), appliedAt: '2026-01-01T00:00:00Z' })).toBe('accepted');
    expect(events.ack).toHaveLength(1);
    expect(events.ack[0]).toMatchObject({ streamId: S1, id: 'a', ok: false, appliedAt: Date.parse('2026-01-01T00:00:00Z') });
    expect(events.ack[0].error).toHaveLength(120);
    expect(svc.ack({ streamId: S1, accountId: 'acc', id: 'a', ok: true })).toBe('ignored'); // replay
    expect(svc.pendingCount(S1)).toBe(0);
  });

  it('cancel takes a timed-out command out so the phone never sees it', async () => {
    const { svc } = build();
    await poll(svc);
    svc.enqueue(S1, cmd('a'));
    svc.cancel(S1, 'a');
    expect((await poll(svc)).status).toBe('empty');
  });

  it('connected / disconnected events: 60 s without a poll clears the state and tells the gateway', async () => {
    const { svc, events, advance } = build();
    await poll(svc);
    expect(events.host.map((e) => e.connected)).toEqual([true]);
    expect(svc.putState({ streamId: S1, studioSessionId: 'ss', accountId: 'acc', body: goodState() })).toBe('accepted');
    expect(svc.getState(S1)).not.toBeNull();
    advance(PHONE_ACTIVE_MS - 1000);
    svc.sweepNow();
    expect(svc.isActive(S1)).toBe(true);
    advance(2000);
    svc.sweepNow();
    expect(svc.isActive(S1)).toBe(false);
    expect(svc.getState(S1)).toBeNull();
    expect(events.host.map((e) => e.connected)).toEqual([true, false]);
    expect(svc.wasPhone(S1)).toBe(true);
    expect(svc.enqueue(S1, cmd('a')).ok).toBe(false);
  });

  it('seq never goes backwards, also after a simulated restart (queue lost) and when the phone is ahead', async () => {
    const { svc, advance } = build();
    await poll(svc);
    let last = 0;
    for (let i = 0; i < 20; i++) last = (svc.enqueue(S1, cmd(`c${i}`)) as { seq: number }).seq;
    svc.resetForTests(); // the backend restarted within the same millisecond clock tick: the in-memory counter is gone
    const afterRestart = (await poll(svc, { after: last })) as any;
    expect(afterRestart.status).toBe('empty');
    const next = svc.enqueue(S1, cmd('n')) as { seq: number };
    expect(next.seq).toBeGreaterThan(last);
    // A phone whose `after` is far above the clock-based seed (it handled bigger numbers): still strictly above it.
    svc.resetForTests();
    await poll(svc, { after: last + 1_000_000 });
    expect((svc.enqueue(S1, cmd('m')) as { seq: number }).seq).toBeGreaterThan(last + 1_000_000);
    advance(1);
  });

  it('the phone can never create commands: the queue only grows through enqueue()', async () => {
    const { svc } = build();
    await poll(svc);
    svc.ack({ streamId: S1, accountId: 'acc', id: 'made-up', ok: true });
    svc.putState({ streamId: S1, studioSessionId: 'ss', accountId: 'acc', body: { rev: 1, state: { type: 'ads.shrink' } } });
    expect(svc.pendingCount(S1)).toBe(0);
  });
});

describe('PhoneRemoteService state', () => {
  it('rebuilds strictly, rejects malformed / oversize, rate limits to 5 per second and notifies the gateway', () => {
    const { svc, events, advance } = build();
    const put = (body: unknown) => svc.putState({ streamId: S1, studioSessionId: 'ss', accountId: 'acc', body });
    expect(put(goodState())).toBe('accepted');
    expect(events.state).toHaveLength(1);
    expect(events.state[0].state.platform).toBe('android');
    expect(put({ rev: 2, state: { v: 1 } })).toBe('invalid');
    expect(put({ state: goodState().state })).toBe('invalid'); // rev missing
    expect(put({ rev: -1, state: goodState().state })).toBe('invalid');
    expect(put(null)).toBe('invalid');
    expect(put({ rev: 1, state: { ...goodState().state, pad: 'x'.repeat(40 * 1024) } })).toBe('too_large');
    advance(1100); // a fresh rate-limit window
    expect(put({ rev: 1, state: { ...goodState().state, pad: 'x'.repeat(26 * 1024) } })).toBe('too_large');
    expect(events.state).toHaveLength(1);
    // 5 per second per stream
    let limited = 0;
    for (let i = 0; i < 10; i++) if (put(goodState()) === 'limited') limited++;
    expect(limited).toBeGreaterThan(0);
  });
  it('state is not served once the phone is gone', async () => {
    const { svc, advance } = build();
    await poll(svc);
    svc.putState({ streamId: S1, studioSessionId: 'ss', accountId: 'acc', body: goodState() });
    expect(svc.appVersion(S1)).toBe('1.0.14');
    advance(PHONE_ACTIVE_MS + 1);
    expect(svc.getState(S1)).toBeNull();
  });
});
