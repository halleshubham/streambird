import * as crypto from 'crypto';
import { UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { GoogleIdTokenService } from './google-id-token.service';

const WEB = 'web-client.apps.googleusercontent.com';
const ANDROID = 'android-client.apps.googleusercontent.com';

const makeKey = (kid: string) => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } };
};

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function sign(key: ReturnType<typeof makeKey>, claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://accounts.google.com',
    aud: WEB,
    sub: '1234567890',
    email: 'person@example.com',
    email_verified: true,
    name: 'Person',
    iat: now,
    exp: now + 3600,
    ...claims,
  };
  const head = b64({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header });
  const body = b64(payload);
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key.privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

describe('GoogleIdTokenService', () => {
  let fetchMock: jest.Mock;
  let jwksKeys: ReturnType<typeof makeKey>[];
  let service: GoogleIdTokenService;
  const key1 = makeKey('kid-1');

  const respond = () =>
    ({
      ok: true,
      status: 200,
      headers: { get: () => 'public, max-age=3600' },
      json: async () => ({ keys: jwksKeys.map((k) => k.jwk) }),
    }) as any;

  beforeEach(() => {
    jwksKeys = [key1];
    fetchMock = jest.fn(async () => respond());
    (globalThis as any).fetch = fetchMock;
    const cfg: Record<string, unknown> = { 'google.clientId': WEB, 'google.androidClientIds': [ANDROID] };
    service = new GoogleIdTokenService({ get: (k: string) => cfg[k] } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  const rejects = async (token: string) => {
    await expect(service.verify(token)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.verify(token)).rejects.toThrow('Invalid Google sign-in');
  };

  it('accepts a valid token for the web client and returns the profile', async () => {
    await expect(service.verify(sign(key1, {}))).resolves.toEqual({ sub: '1234567890', email: 'person@example.com', name: 'Person' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://www.googleapis.com/oauth2/v3/certs');
  });

  it('accepts the bare accounts.google.com issuer and an Android client audience', async () => {
    await expect(service.verify(sign(key1, { iss: 'accounts.google.com', aud: ANDROID }))).resolves.toMatchObject({ email: 'person@example.com' });
  });

  it('caches the keys per Cache-Control max-age', async () => {
    await service.verify(sign(key1, {}));
    await service.verify(sign(key1, {}));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 3601_000);
    await service.verify(sign(key1, { exp: Math.floor(now / 1000) + 7200 }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a wrong audience, and any audience when none is configured', async () => {
    await rejects(sign(key1, { aud: 'someone-else' }));
    const bare = new GoogleIdTokenService({ get: () => undefined } as any);
    await expect(bare.verify(sign(key1, { aud: '' }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired token but allows 60 s of clock skew', async () => {
    const now = Math.floor(Date.now() / 1000);
    await rejects(sign(key1, { exp: now - 120 }));
    await expect(service.verify(sign(key1, { exp: now - 30 }))).resolves.toBeDefined();
  });

  it('rejects a wrong issuer', async () => {
    await rejects(sign(key1, { iss: 'https://evil.example.com' }));
  });

  it('rejects an unverified or missing email, and a missing sub', async () => {
    await rejects(sign(key1, { email_verified: false }));
    await rejects(sign(key1, { email_verified: 'true' }));
    await rejects(sign(key1, { email: undefined }));
    await rejects(sign(key1, { sub: undefined }));
  });

  it('rejects a bad signature (signed by another key under a known kid)', async () => {
    const other = makeKey('kid-1');
    await rejects(sign(other, {}));
  });

  it('rejects other algorithms (alg none / HS256)', async () => {
    await rejects(sign(key1, {}, { alg: 'none' }));
    await rejects(sign(key1, {}, { alg: 'HS256' }));
  });

  it('rejects malformed tokens', async () => {
    await rejects('');
    await rejects('abc');
    await rejects('a.b');
    await rejects('a.b.c');
    await rejects('###.###.###');
    await rejects(`${b64('x')}.${b64('y')}.${b64('z')}`);
  });

  it('refetches the keys once for an unknown kid, then accepts a rotated-in key', async () => {
    await service.verify(sign(key1, {}));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const key2 = makeKey('kid-2');
    jwksKeys = [key1, key2];
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 11_000);
    await expect(service.verify(sign(key2, {}))).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refetches at most once for a kid that is still unknown, and rate-limits repeats', async () => {
    await service.verify(sign(key1, {}));
    const ghost = makeKey('ghost');
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 11_000);
    await rejects(sign(ghost, {}));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('answers 503 when Google\'s keys cannot be fetched and none are cached', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(service.verify(sign(key1, {}))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('keeps using cached keys when a later refresh fails', async () => {
    await service.verify(sign(key1, {}));
    fetchMock.mockRejectedValue(new Error('network down'));
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 3601_000);
    await expect(service.verify(sign(key1, { exp: Math.floor(Date.now() / 1000) + 3600 }))).resolves.toBeDefined();
  });
});
