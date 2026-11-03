import { Injectable, OnModuleDestroy } from '@nestjs/common';
import * as crypto from 'crypto';

export const APP_HANDOFF_TTL_MS = 120_000;
export const APP_HANDOFF_MAX_ENTRIES = 1000;

export interface AppHandoffSession {
  token: string;
  expiresAt: Date;
  userId: string;
  accountId: string;
}

interface Entry extends AppHandoffSession {
  challenge: string;
  createdAt: number;
}

const sha256Hex = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * One-time handoff of a browser-minted session to the Android app (browser fallback for "Sign in with
 * Google"). The callback parks the session here under a random code; the app redeems it with the PKCE
 * verifier whose SHA-256 it sent as the challenge when it started the flow. Entries are keyed by the
 * sha256 of the code (the code itself is never stored), live 120 s, and are single use even when the
 * verifier is wrong (so the code cannot be brute-forced). In memory only: this assumes ONE backend
 * process (CLAUDE.md rule 9) and a restart simply drops pending handoffs (the user taps sign-in again).
 */
@Injectable()
export class AppHandoffService implements OnModuleDestroy {
  private readonly entries = new Map<string, Entry>();
  private readonly timer: NodeJS.Timeout;

  constructor() {
    this.timer = setInterval(() => this.sweep(), 30_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  get size(): number {
    return this.entries.size;
  }

  /** Stores the session and returns the one-time code (43 chars, base64url). */
  create(challenge: string, session: AppHandoffSession, now = Date.now()): string {
    this.sweep(now);
    // Cap: evict the oldest (Map keeps insertion order) rather than refuse a real user.
    while (this.entries.size >= APP_HANDOFF_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    const code = crypto.randomBytes(32).toString('base64url');
    this.entries.set(sha256Hex(code), { ...session, challenge, createdAt: now });
    return code;
  }

  /**
   * Consumes the code (always, if it exists) and returns the session only when the entry is unexpired and
   * base64url(SHA-256(verifier)) equals the stored challenge. Null for every failure.
   */
  redeem(code: string, verifier: string, now = Date.now()): AppHandoffSession | null {
    this.sweep(now);
    const key = sha256Hex(code);
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key); // single use, even if the verifier is wrong
    const computed = Buffer.from(crypto.createHash('sha256').update(verifier).digest('base64url'));
    const expected = Buffer.from(entry.challenge);
    if (computed.length !== expected.length || !crypto.timingSafeEqual(computed, expected)) return null;
    const { token, expiresAt, userId, accountId } = entry;
    return { token, expiresAt, userId, accountId };
  }

  sweep(now = Date.now()): void {
    for (const [key, e] of this.entries) {
      if (now - e.createdAt > APP_HANDOFF_TTL_MS) this.entries.delete(key);
    }
  }
}
