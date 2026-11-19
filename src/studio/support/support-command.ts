/**
 * Remote control of a LIVE studio by a superadmin support session (act mode only).
 *
 * This file is the single place that decides WHAT a support session may do to a running studio: a strict whitelist of
 * picture-composition commands, each validated by a hand-written schema (no extra keys, bounded sizes). The server
 * relays only commands that pass this to the HOST socket(s) of the stream. Never added, whatever the reason: start /
 * stop / go-live / end, publishing, resolution / bitrate, camera / mic / mute, screen share, guest admit / kick / mute,
 * recording, invite creation, anything that changes who can join or what is published beyond the composition below.
 *
 * Pure (no Nest, no I/O): unit-tested in support-command.spec.ts.
 */

export const SUPPORT_COMMAND_TYPES = [
  'layout.set',
  'ads.manual',
  'ads.enabled',
  'ads.schedule',
  'ads.shrink',
  'kit.apply',
  'ticker.set',
  'lowerThird.set',
  'clock.set',
  'logo.set',
  'wallpaper.dim',
] as const;
export type SupportCommandType = (typeof SUPPORT_COMMAND_TYPES)[number];

/** Free text (ticker, lower third) is capped here; the host studio applies its own, tighter limits too. */
export const SUPPORT_TEXT_MAX = 200;
export const SUPPORT_PAYLOAD_MAX_BYTES = 1024;
export const SUPPORT_COMMAND_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const AD_PLACEMENT_IDS = ['lower_third', 'side_third', 'full_screen', 'l_shape'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SupportCommand {
  id: string;
  type: SupportCommandType;
  payload: Record<string, unknown>;
}

export type ParseResult = { ok: true; command: SupportCommand } | { ok: false; error: string };

type Check = (v: unknown) => string | null; // null = valid, else the reason
interface Field {
  check: Check;
  optional?: boolean;
  /** true: the value is free text, so the audit summary records its LENGTH only. */
  text?: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool: Check = (v) => (typeof v === 'boolean' ? null : 'must be true or false');
const oneOf =
  (...values: readonly string[]): Check =>
  (v) =>
    typeof v === 'string' && values.includes(v) ? null : `must be one of ${values.join(', ')}`;
const int =
  (min: number, max: number): Check =>
  (v) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? null : `must be a whole number from ${min} to ${max}`;
const text =
  (max: number): Check =>
  (v) =>
    typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? null : `must be text of at most ${max} characters without control characters`;
const nullable =
  (inner: Check): Check =>
  (v) =>
    v === null ? null : inner(v);
const layoutId: Check = (v) => (typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v) ? null : 'must be a layout id');
const uuid: Check = (v) => (typeof v === 'string' && UUID_RE.test(v) ? null : 'must be an id');

const placement: Field = { check: oneOf(...AD_PLACEMENT_IDS) };

/** The schema: every field a command may carry. Anything else is rejected. `atLeastOne` = a partial update must change something. */
const SCHEMAS: Record<SupportCommandType, { fields: Record<string, Field>; atLeastOne?: boolean }> = {
  'layout.set': { fields: { mode: { check: layoutId } } },
  'ads.manual': { fields: { placement, manual: { check: nullable(oneOf('shown', 'hidden')) } } },
  'ads.enabled': { fields: { placement, enabled: { check: bool } } },
  'ads.schedule': {
    fields: { placement, mode: { check: oneOf('continuous', 'interval') }, showSec: { check: int(1, 3600), optional: true }, everySec: { check: int(1, 86400), optional: true } },
  },
  'ads.shrink': { fields: { on: { check: bool } } },
  'kit.apply': { fields: { kitId: { check: uuid } } },
  'ticker.set': { fields: { text: { check: nullable(text(SUPPORT_TEXT_MAX)), optional: true, text: true }, on: { check: bool, optional: true } }, atLeastOne: true },
  'lowerThird.set': {
    fields: {
      name: { check: text(80), optional: true, text: true },
      title: { check: nullable(text(120)), optional: true, text: true },
      show: { check: bool, optional: true },
    },
    atLeastOne: true,
  },
  'clock.set': {
    fields: {
      enabled: { check: bool, optional: true },
      position: { check: oneOf('top_left', 'top_right', 'bottom_left', 'bottom_right'), optional: true },
      format: { check: oneOf('12h', '24h'), optional: true },
      showDate: { check: bool, optional: true },
      showSeconds: { check: bool, optional: true },
      timezone: { check: nullable(text(64)), optional: true, text: true },
      size: { check: oneOf('small', 'medium', 'large'), optional: true },
      style: { check: oneOf('text', 'pill'), optional: true },
      alternate: { check: bool, optional: true },
    },
    atLeastOne: true,
  },
  'logo.set': { fields: { position: { check: oneOf('left', 'right'), optional: true }, size: { check: int(16, 600), optional: true } }, atLeastOne: true },
  'wallpaper.dim': { fields: { n: { check: int(0, 70) } } },
};

/** Validates an untrusted command (from a socket). Never throws. */
export function parseSupportCommand(raw: unknown): ParseResult {
  if (!isObj(raw)) return { ok: false, error: 'Invalid command' };
  const { id, type, payload } = raw as { id?: unknown; type?: unknown; payload?: unknown };
  if (typeof id !== 'string' || !SUPPORT_COMMAND_ID_RE.test(id)) return { ok: false, error: 'Invalid command id' };
  if (typeof type !== 'string' || !(SUPPORT_COMMAND_TYPES as readonly string[]).includes(type)) return { ok: false, error: 'Unknown command' };
  const body = payload === undefined ? {} : payload;
  if (!isObj(body)) return { ok: false, error: 'Invalid command payload' };
  let size = 0;
  try {
    size = Buffer.byteLength(JSON.stringify(body));
  } catch {
    return { ok: false, error: 'Invalid command payload' };
  }
  if (size > SUPPORT_PAYLOAD_MAX_BYTES) return { ok: false, error: 'Command payload too large' };

  const schema = SCHEMAS[type as SupportCommandType];
  for (const key of Object.keys(body)) {
    if (!Object.prototype.hasOwnProperty.call(schema.fields, key)) return { ok: false, error: `Unknown parameter "${key}"` };
  }
  for (const [key, field] of Object.entries(schema.fields)) {
    const present = Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
    if (!present) {
      if (!field.optional) return { ok: false, error: `Missing parameter "${key}"` };
      continue;
    }
    const problem = field.check(body[key]);
    if (problem) return { ok: false, error: `Parameter "${key}" ${problem}` };
  }
  if (schema.atLeastOne && Object.keys(body).length === 0) return { ok: false, error: 'Nothing to change' };
  if (type === 'ads.schedule') {
    const b = body as { mode: string; showSec?: number; everySec?: number };
    if (b.mode === 'interval' && (b.showSec === undefined || b.everySec === undefined)) return { ok: false, error: 'An interval schedule needs showSec and everySec' };
  }
  // Re-built from the schema's own keys so nothing else can ride along.
  const clean: Record<string, unknown> = {};
  for (const key of Object.keys(schema.fields)) if (body[key] !== undefined) clean[key] = body[key];
  return { ok: true, command: { id, type: type as SupportCommandType, payload: clean } };
}

/**
 * A sanitised line for the audit log (<= 100 chars): the type, the parameter NAMES, small non-secret values
 * (placement, on/off, layout, numbers, a kit id) and, for free text, only its LENGTH. Never the text itself.
 */
export function summarizeCommand(cmd: SupportCommand): string {
  const schema = SCHEMAS[cmd.type];
  const parts = Object.entries(cmd.payload).map(([key, value]) => {
    if (schema.fields[key]?.text) return typeof value === 'string' ? `${key}[len=${value.length}]` : `${key}=null`;
    return `${key}=${typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null ? String(value) : '?'}`;
  });
  return `${cmd.type}{${parts.join(',')}}`.slice(0, 100);
}

/** Sliding-window rate limiter (per key): at most `limit` hits per `windowMs`. */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records a hit and returns true when it is allowed. */
  allow(key: string, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  forget(key: string): void {
    this.hits.delete(key);
  }
}

export const SUPPORT_RATE_LIMIT = { limit: 20, windowMs: 10_000 } as const;
/** The host's own change this recently blocks a support command touching the same setting (see the host-side tracker). */
export const SUPPORT_CONFLICT_WINDOW_MS = 3000;
/** How long the server waits for the host's `support:ack` before telling the support socket. */
export const SUPPORT_ACK_TIMEOUT_MS = 8000;
export const SUPPORT_STATE_MAX_BYTES = 24 * 1024;
/** Host snapshots are coalesced to at most 5 per second per studio session. */
export const SUPPORT_STATE_MIN_INTERVAL_MS = 200;
/** Control windows (support sockets) per stream. */
export const SUPPORT_MAX_SOCKETS_PER_SESSION = 3;
