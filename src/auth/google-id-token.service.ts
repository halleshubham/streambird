import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const CLOCK_LEEWAY_SECONDS = 60;
const JWKS_FETCH_TIMEOUT_MS = 5_000;
/** Used when Google's response has no usable Cache-Control max-age. */
const JWKS_DEFAULT_TTL_MS = 60 * 60_000;
/** A token with an unknown `kid` triggers one refetch, but never more often than this (a forged kid must not make us hammer Google). */
const JWKS_MIN_REFETCH_INTERVAL_MS = 10_000;

interface Jwk extends crypto.JsonWebKey {
  kid?: string;
}

export interface GoogleIdTokenProfile {
  sub: string;
  email: string;
  name?: string;
}

/**
 * Verifies a Google ID token (a JWT) sent by the Android app: RS256 signature
 * against Google's published keys (JWKS, cached per Cache-Control max-age),
 * then issuer, expiry, audience, subject and verified-email checks. Every
 * rejection is the same generic 401 -- the reason is only logged at debug
 * level, never returned.
 *
 * Allowed audiences: `google.clientId` (the Web client the app passes as
 * serverClientId) plus `google.androidClientIds`.
 */
@Injectable()
export class GoogleIdTokenService {
  private readonly logger = new Logger(GoogleIdTokenService.name);
  private keys = new Map<string, crypto.KeyObject>();
  private keysExpireAt = 0;
  private lastFetchAt = 0;

  constructor(private readonly config: ConfigService) {}

  async verify(idToken: string): Promise<GoogleIdTokenProfile> {
    const fail = (reason: string): never => {
      this.logger.debug(`Google ID token rejected: ${reason}`);
      throw new UnauthorizedException('Invalid Google sign-in');
    };

    const parts = typeof idToken === 'string' ? idToken.split('.') : [];
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return fail('malformed');
    const [h, p, s] = parts;

    let header: { alg?: unknown; kid?: unknown };
    let payload: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    } catch {
      return fail('malformed');
    }
    if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') return fail('malformed');
    if (header.alg !== 'RS256') return fail('alg');
    if (typeof header.kid !== 'string' || !header.kid) return fail('kid');

    const key = await this.keyFor(header.kid);
    if (!key) return fail('unknown kid');
    let signatureOk = false;
    try {
      signatureOk = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'));
    } catch {
      signatureOk = false;
    }
    if (!signatureOk) return fail('bad signature');

    if (typeof payload.iss !== 'string' || !GOOGLE_ISSUERS.includes(payload.iss)) return fail('iss');
    const exp = payload.exp;
    if (typeof exp !== 'number' || exp + CLOCK_LEEWAY_SECONDS < Date.now() / 1000) return fail('expired');
    const iat = payload.iat;
    if (typeof iat === 'number' && iat - CLOCK_LEEWAY_SECONDS > Date.now() / 1000) return fail('issued in the future');

    const audiences = this.allowedAudiences();
    if (typeof payload.aud !== 'string' || !audiences.includes(payload.aud)) return fail('aud');
    if (typeof payload.sub !== 'string' || !payload.sub) return fail('sub');
    if (typeof payload.email !== 'string' || !payload.email) return fail('email');
    if (payload.email_verified !== true) return fail('email not verified');

    return {
      sub: payload.sub,
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    };
  }

  private allowedAudiences(): string[] {
    const web = this.config.get<string>('google.clientId') ?? '';
    const android = this.config.get<string[]>('google.androidClientIds') ?? [];
    return [web, ...android].filter((id) => !!id);
  }

  private async keyFor(kid: string): Promise<crypto.KeyObject | undefined> {
    if (Date.now() >= this.keysExpireAt) await this.refreshKeys();
    let key = this.keys.get(kid);
    if (!key && Date.now() - this.lastFetchAt >= JWKS_MIN_REFETCH_INTERVAL_MS) {
      await this.refreshKeys(); // Google rotated its keys since we cached them
      key = this.keys.get(kid);
    }
    return key;
  }

  private async refreshKeys(): Promise<void> {
    this.lastFetchAt = Date.now();
    try {
      const res = await fetch(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { keys?: Jwk[] };
      const next = new Map<string, crypto.KeyObject>();
      for (const jwk of body.keys ?? []) {
        if (jwk.kty !== 'RSA' || !jwk.kid) continue;
        try {
          next.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
        } catch {
          // skip a key we cannot parse
        }
      }
      if (next.size === 0) throw new Error('no usable keys');
      this.keys = next;
      this.keysExpireAt = Date.now() + this.maxAgeMs(res.headers?.get?.('cache-control'));
    } catch (err) {
      this.logger.warn(`Fetching Google signing keys failed: ${(err as Error).message}`);
      // Keep serving from the last good key set if we have one.
      if (this.keys.size === 0) throw new ServiceUnavailableException('Google sign-in is temporarily unavailable');
      this.keysExpireAt = Date.now() + JWKS_MIN_REFETCH_INTERVAL_MS;
    }
  }

  private maxAgeMs(cacheControl: string | null | undefined): number {
    const m = /max-age=(\d+)/i.exec(cacheControl ?? '');
    return m ? Number(m[1]) * 1000 : JWKS_DEFAULT_TTL_MS;
  }
}
