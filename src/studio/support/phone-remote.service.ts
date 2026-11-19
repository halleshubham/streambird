import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SlidingWindowLimiter, SUPPORT_COMMAND_ID_RE, SUPPORT_STATE_MAX_BYTES } from './support-command';
import { phoneStateToSnapshot, type PhoneCommandType } from './phone-mapping';
import type { SanitizedSupportState } from './support-state';

/** The phone is "connected" while it polled within this long (a held poll counts as connected for its whole hold). */
export const PHONE_ACTIVE_MS = 60_000;
export const PHONE_MAX_WAIT_SEC = 25;
export const PHONE_MAX_COMMANDS_PER_ANSWER = 100;
export const PHONE_MAX_PENDING_PER_STREAM = 200;
/** A queued command is dropped unanswered after this long (the phone itself refuses anything older than 2 minutes). */
export const PHONE_COMMAND_TTL_MS = 120_000;
export const PHONE_MAX_HELD_GLOBAL = 200;
export const PHONE_MAX_HELD_PER_ACCOUNT = 10;
export const PHONE_STATE_BODY_MAX_BYTES = 32 * 1024;
/** `after` may exceed the clock by at most this much (sequence numbers start at the epoch-ms clock). */
export const PHONE_MAX_AFTER_AHEAD = 1e9;
/** Per ACCOUNT, checked before any database read: a normal phone polls ~2.4 times a minute (up to ~2/s while commands flow). */
const ACCOUNT_LIMITS = { poll: 240, ack: 120, state: 120 } as const;
const POLL_LIMIT = { limit: 40, windowMs: 10_000 };
const ACK_LIMIT = { limit: 40, windowMs: 10_000 };
/** 5 per second per stream. */
const STATE_LIMIT = { limit: 5, windowMs: 1000 };
const MAX_CHANNELS = 5000;
const CHANNEL_KEEP_MS = 30 * 60_000;
const SWEEP_MS = 5000;

export interface PhoneCommand {
  seq: number;
  id: string;
  type: PhoneCommandType;
  payload: Record<string, unknown>;
  at: string;
}
interface QueuedCommand extends PhoneCommand {
  expiresAt: number;
}

export type PollResult = { status: 'commands'; commands: PhoneCommand[]; now: string } | { status: 'empty' } | { status: 'limited' };
export interface PollHandle {
  result: Promise<PollResult>;
  /** The HTTP client went away: free the hold. */
  cancel(): void;
}
export type AckOutcome = 'accepted' | 'ignored' | 'limited';
export type StateOutcome = 'accepted' | 'invalid' | 'too_large' | 'limited';

interface Holder {
  accountId: string;
  timer: ReturnType<typeof setTimeout>;
  settle: (r: PollResult) => void;
}
interface Channel {
  streamId: string;
  studioSessionId: string;
  accountId: string;
  /** Last sequence number handed out. Only ever grows (see `seed`). */
  seq: number;
  queue: QueuedCommand[];
  lastPollAt: number;
  active: boolean;
  holder: Holder | null;
  /** The `after` of the held poll: what a wake-up answers from. */
  wakeAfter: number;
  state: SanitizedSupportState | null;
  pollLimiter: SlidingWindowLimiter;
  ackLimiter: SlidingWindowLimiter;
  stateLimiter: SlidingWindowLimiter;
}

export interface PhoneHostEvent {
  streamId: string;
  studioSessionId: string;
  accountId: string;
  connected: boolean;
}
export interface PhoneAckEvent {
  streamId: string;
  id: string;
  ok: boolean;
  error?: string;
  appliedAt?: number;
}
export interface PhoneStateEvent {
  streamId: string;
  studioSessionId: string;
  state: SanitizedSupportState;
}

/**
 * The server side of the Android app's remote-control channel (an HTTP long poll instead of the studio socket; see
 * `.claude/docs/backend.md` "Phone remote control"). One in-memory channel per LIVE stream (single backend process,
 * CLAUDE.md rule 9): a bounded command queue that ONLY `enqueue` (called by the gateway after a support command passed
 * every check) can fill, the one held poll, the phone's latest state snapshot and the activity clock.
 *
 * `seq` never goes backwards: a channel's counter is seeded from `max(epoch milliseconds, the `after` the phone sends)`
 * when it is created (first poll after a backend restart included) and every command adds one. A restart therefore
 * cannot reuse a number the phone already handled, even though the queue itself is lost (an unacked command is simply
 * answered "The phone app did not respond" by the 8 s timeout of the support path).
 */
@Injectable()
export class PhoneRemoteService implements OnModuleInit, OnModuleDestroy {
  /** Overridable in unit tests. */
  now: () => number = () => Date.now();
  private readonly channels = new Map<string, Channel>();
  private accountLimiters = { poll: new SlidingWindowLimiter(ACCOUNT_LIMITS.poll, 60_000), ack: new SlidingWindowLimiter(ACCOUNT_LIMITS.ack, 60_000), state: new SlidingWindowLimiter(ACCOUNT_LIMITS.state, 60_000) };
  private sweeps = 0;
  private heldGlobal = 0;
  private readonly heldByAccount = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly hostListeners: Array<(e: PhoneHostEvent) => void> = [];
  private readonly ackListeners: Array<(e: PhoneAckEvent) => void> = [];
  private readonly stateListeners: Array<(e: PhoneStateEvent) => void> = [];

  onModuleInit(): void {
    this.timer = setInterval(() => this.sweep(), SWEEP_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    for (const ch of this.channels.values()) if (ch.holder) this.release(ch, { status: 'empty' });
    this.channels.clear();
  }

  onHost(cb: (e: PhoneHostEvent) => void): void {
    this.hostListeners.push(cb);
  }
  onAck(cb: (e: PhoneAckEvent) => void): void {
    this.ackListeners.push(cb);
  }
  onState(cb: (e: PhoneStateEvent) => void): void {
    this.stateListeners.push(cb);
  }

  // ---- queries -------------------------------------------------------------------------------------------------

  /** Did the phone poll this stream recently (or is its poll being held right now)? */
  isActive(streamId: string): boolean {
    const ch = this.channels.get(streamId);
    return !!ch && this.activeNow(ch);
  }
  /** Has this stream ever been polled by a phone in this process (so "not connected" can name the phone)? */
  wasPhone(streamId: string): boolean {
    const ch = this.channels.get(streamId);
    return !!ch && ch.lastPollAt > 0;
  }
  /** The phone's latest accepted snapshot, only while the phone is connected. */
  getState(streamId: string): SanitizedSupportState | null {
    const ch = this.channels.get(streamId);
    return ch && this.activeNow(ch) ? ch.state : null;
  }
  appVersion(streamId: string): string | null {
    return this.getState(streamId)?.appVersion ?? null;
  }
  pendingCount(streamId: string): number {
    return this.channels.get(streamId)?.queue.length ?? 0;
  }
  heldCount(): number {
    return this.heldGlobal;
  }

  private activeNow(ch: Channel): boolean {
    return !!ch.holder || (ch.lastPollAt > 0 && this.now() - ch.lastPollAt < PHONE_ACTIVE_MS);
  }

  /** Cheap per-account request budget, checked BEFORE the controller touches the database (wait=0 floods). */
  allowAccount(kind: 'poll' | 'ack' | 'state', accountId: string): boolean {
    return this.accountLimiters[kind].allow(accountId, this.now());
  }

  // ---- the phone's three calls ---------------------------------------------------------------------------------

  /**
   * GET remote-control. The caller (controller) has already proven the caller owns the stream and that it is LIVE.
   * Answers at once when commands with seq > `after` are queued, else holds up to `waitSec` (capped at 25). A new poll
   * supersedes a held one (the old one answers empty). Held polls are capped globally and per account.
   */
  poll(args: { streamId: string; studioSessionId: string; accountId: string; after: number; waitSec: number }): PollHandle {
    const done = (r: PollResult): PollHandle => ({ result: Promise.resolve(r), cancel: () => undefined });
    const ch = this.channel(args.streamId, args.studioSessionId, args.accountId, args.after);
    if (!ch.pollLimiter.allow('p', this.now())) return done({ status: 'limited' });
    if (args.after > ch.seq) ch.seq = args.after; // the phone has seen further than we know (restart): never go below it
    this.expire(ch);
    if (ch.holder) this.release(ch, { status: 'empty' }); // superseded
    this.touch(ch);

    const ready = this.pending(ch, args.after);
    if (ready.length) return done(this.answer(ready));
    const waitSec = Math.min(Math.max(Math.floor(args.waitSec), 0), PHONE_MAX_WAIT_SEC);
    if (waitSec === 0) return done({ status: 'empty' });
    if (this.heldGlobal >= PHONE_MAX_HELD_GLOBAL || (this.heldByAccount.get(ch.accountId) ?? 0) >= PHONE_MAX_HELD_PER_ACCOUNT) return done({ status: 'limited' });

    let settle!: (r: PollResult) => void;
    const result = new Promise<PollResult>((resolve) => (settle = resolve));
    const holder: Holder = {
      accountId: ch.accountId,
      settle,
      timer: setTimeout(() => {
        if (ch.holder === holder) this.release(ch, { status: 'empty' });
      }, waitSec * 1000),
    };
    holder.timer.unref?.();
    ch.holder = holder;
    this.heldGlobal++;
    this.heldByAccount.set(ch.accountId, (this.heldByAccount.get(ch.accountId) ?? 0) + 1);
    // Woken by enqueue(): answer with whatever is newer than `after`.
    ch.wakeAfter = args.after;
    return {
      result,
      cancel: () => {
        if (ch.holder === holder) this.release(ch, { status: 'empty' });
      },
    };
  }

  /** POST remote-control/ack. Ignored (204) unless the id is pending for THAT stream and account. */
  ack(args: { streamId: string; accountId: string; id: unknown; ok: unknown; error?: unknown; appliedAt?: unknown }): AckOutcome {
    const ch = this.channels.get(args.streamId);
    if (!ch || ch.accountId !== args.accountId) return 'ignored';
    if (!ch.ackLimiter.allow('a', this.now())) return 'limited';
    if (typeof args.id !== 'string' || !SUPPORT_COMMAND_ID_RE.test(args.id) || typeof args.ok !== 'boolean') return 'ignored';
    this.touch(ch);
    const index = ch.queue.findIndex((c) => c.id === args.id);
    if (index < 0) return 'ignored'; // unknown, already answered, timed out or expired: no replay
    ch.queue.splice(index, 1);
    // Control, bidi and other format characters (RLO, zero-width, line separators) never reach the support page or the audit log.
    const error = typeof args.error === 'string' ? args.error.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trim().slice(0, 120) : undefined;
    const parsed = typeof args.appliedAt === 'string' ? Date.parse(args.appliedAt) : NaN;
    const nowMs = this.now();
    const event: PhoneAckEvent = { streamId: ch.streamId, id: args.id, ok: args.ok, ...(!args.ok ? { error: error || 'The phone app could not apply it' } : {}), appliedAt: Number.isFinite(parsed) && parsed >= nowMs - 5 * 60_000 && parsed <= nowMs ? parsed : nowMs };
    for (const cb of this.ackListeners) cb(event);
    return 'accepted';
  }

  /** PUT remote-control/state. `body` is the whole request body ({rev, state}); the snapshot is rebuilt strictly. */
  putState(args: { streamId: string; studioSessionId: string; accountId: string; body: unknown }): StateOutcome {
    const ch = this.channel(args.streamId, args.studioSessionId, args.accountId, 0);
    let size = 0;
    try {
      size = Buffer.byteLength(JSON.stringify(args.body));
    } catch {
      return 'invalid';
    }
    if (size > PHONE_STATE_BODY_MAX_BYTES) return 'too_large';
    if (!ch.stateLimiter.allow('s', this.now())) return 'limited';
    const b = args.body as { rev?: unknown; state?: unknown } | null;
    if (!b || typeof b !== 'object' || typeof b.rev !== 'number' || !Number.isInteger(b.rev) || b.rev < 0) return 'invalid';
    let stateSize = 0;
    try {
      stateSize = Buffer.byteLength(JSON.stringify(b.state));
    } catch {
      return 'invalid';
    }
    if (stateSize > SUPPORT_STATE_MAX_BYTES) return 'too_large';
    const clean = phoneStateToSnapshot(b.state);
    if (!clean) return 'invalid';
    ch.state = clean;
    this.touch(ch);
    for (const cb of this.stateListeners) cb({ streamId: ch.streamId, studioSessionId: ch.studioSessionId, state: clean });
    return 'accepted';
  }

  // ---- the support side ----------------------------------------------------------------------------------------

  /**
   * Queues a command (already validated and mapped) for the phone. Only the gateway's support path calls this; the
   * phone can never create commands. Refused when the phone is not connected or 200 commands are already waiting.
   */
  enqueue(streamId: string, cmd: { id: string; type: PhoneCommandType; payload: Record<string, unknown> }): { ok: true; seq: number } | { ok: false; error: string } {
    const ch = this.channels.get(streamId);
    if (!ch || !this.activeNow(ch)) return { ok: false, error: 'The phone app is not connected' };
    this.expire(ch);
    if (ch.queue.length >= PHONE_MAX_PENDING_PER_STREAM) return { ok: false, error: 'Too many commands are waiting for the phone app' };
    if (ch.queue.some((c) => c.id === cmd.id)) return { ok: false, error: 'Duplicate command id' };
    const now = this.now();
    const seq = Math.max(ch.seq + 1, 1);
    ch.seq = seq;
    ch.queue.push({ seq, id: cmd.id, type: cmd.type, payload: cmd.payload, at: new Date(now).toISOString(), expiresAt: now + PHONE_COMMAND_TTL_MS });
    if (ch.holder) {
      const after = ch.wakeAfter;
      const ready = this.pending(ch, after);
      if (ready.length) this.release(ch, this.answer(ready));
    }
    return { ok: true, seq };
  }

  /** Takes a command back out (the support path timed out): the phone must not apply it later. */
  cancel(streamId: string, id: string): void {
    const ch = this.channels.get(streamId);
    if (ch) ch.queue = ch.queue.filter((c) => c.id !== id);
  }

  /** The stream is over (or not the phone's): drop everything. */
  forget(streamId: string): void {
    const ch = this.channels.get(streamId);
    if (!ch) return;
    this.markInactive(ch);
    if (ch.holder) this.release(ch, { status: 'empty' });
    this.channels.delete(streamId);
  }

  // ---- internals -----------------------------------------------------------------------------------------------

  private channel(streamId: string, studioSessionId: string, accountId: string, after: number): Channel {
    const existing = this.channels.get(streamId);
    if (existing && existing.accountId === accountId) return existing;
    if (existing) this.forget(streamId); // a different owner for the same id cannot happen; never mix accounts
    if (this.channels.size >= MAX_CHANNELS) {
      const oldest = [...this.channels.values()].filter((c) => !c.holder).sort((a, b) => a.lastPollAt - b.lastPollAt)[0];
      if (oldest) this.forget(oldest.streamId);
    }
    const ch: Channel = {
      streamId,
      studioSessionId,
      accountId,
      seq: Math.max(this.now(), after), // seed: strictly above anything an earlier incarnation can have handed out
      queue: [],
      lastPollAt: 0,
      active: false,
      holder: null,
      wakeAfter: 0,
      state: null,
      pollLimiter: new SlidingWindowLimiter(POLL_LIMIT.limit, POLL_LIMIT.windowMs),
      ackLimiter: new SlidingWindowLimiter(ACK_LIMIT.limit, ACK_LIMIT.windowMs),
      stateLimiter: new SlidingWindowLimiter(STATE_LIMIT.limit, STATE_LIMIT.windowMs),
    };
    this.channels.set(streamId, ch);
    return ch;
  }

  private touch(ch: Channel): void {
    ch.lastPollAt = this.now();
    if (!ch.active) {
      ch.active = true;
      this.emitHost(ch, true);
    }
  }

  private markInactive(ch: Channel): void {
    if (!ch.active) return;
    ch.active = false;
    ch.state = null;
    this.emitHost(ch, false);
  }

  private emitHost(ch: Channel, connected: boolean): void {
    const e: PhoneHostEvent = { streamId: ch.streamId, studioSessionId: ch.studioSessionId, accountId: ch.accountId, connected };
    for (const cb of this.hostListeners) cb(e);
  }

  private expire(ch: Channel): void {
    const now = this.now();
    if (ch.queue.some((c) => c.expiresAt <= now)) ch.queue = ch.queue.filter((c) => c.expiresAt > now);
  }

  /** Commands with seq > after, strictly increasing, at most 100. */
  private pending(ch: Channel, after: number): QueuedCommand[] {
    return ch.queue
      .filter((c) => c.seq > after)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, PHONE_MAX_COMMANDS_PER_ANSWER);
  }

  private answer(commands: QueuedCommand[]): PollResult {
    return { status: 'commands', commands: commands.map(({ seq, id, type, payload, at }) => ({ seq, id, type, payload, at })), now: new Date(this.now()).toISOString() };
  }

  /** Ends the held poll with `result` and frees its slots. */
  private release(ch: Channel, result: PollResult): void {
    const holder = ch.holder;
    if (!holder) return;
    ch.holder = null;
    clearTimeout(holder.timer);
    this.heldGlobal = Math.max(0, this.heldGlobal - 1);
    const n = (this.heldByAccount.get(holder.accountId) ?? 1) - 1;
    if (n <= 0) this.heldByAccount.delete(holder.accountId);
    else this.heldByAccount.set(holder.accountId, n);
    ch.lastPollAt = this.now();
    holder.settle(result);
  }

  private sweep(): void {
    const now = this.now();
    if (++this.sweeps % 120 === 0) {
      // Every ~10 minutes: forget idle accounts' windows (the windows are 1 minute long).
      this.accountLimiters = { poll: new SlidingWindowLimiter(ACCOUNT_LIMITS.poll, 60_000), ack: new SlidingWindowLimiter(ACCOUNT_LIMITS.ack, 60_000), state: new SlidingWindowLimiter(ACCOUNT_LIMITS.state, 60_000) };
    }
    for (const ch of [...this.channels.values()]) {
      this.expire(ch);
      if (ch.active && !this.activeNow(ch)) this.markInactive(ch);
      if (!ch.holder && now - ch.lastPollAt > CHANNEL_KEEP_MS) this.channels.delete(ch.streamId);
    }
  }

  /** For tests: run the sweeper once. */
  sweepNow(): void {
    this.sweep();
  }
  /** For tests: simulate a backend restart (the in-memory channels are lost). */
  resetForTests(): void {
    for (const ch of this.channels.values()) if (ch.holder) this.release(ch, { status: 'empty' });
    this.channels.clear();
  }
}
