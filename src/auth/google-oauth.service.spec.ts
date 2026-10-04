import { GoogleOAuthService } from './google-oauth.service';

describe('GoogleOAuthService.revokeToken', () => {
  let fetchMock: jest.Mock;
  const service = new GoogleOAuthService({ get: () => '' } as any);

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  it('POSTs the token form-encoded to Google\'s revoke endpoint', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

    await expect(service.revokeToken('rt_abc')).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/revoke');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(new URLSearchParams(init.body).get('token')).toBe('rt_abc');
  });

  it('treats a 400 (token already revoked or invalid) as done', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400 });
    await expect(service.revokeToken('rt_old')).resolves.toBe(true);
  });

  it('throws on any other failure so the caller can log it', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(service.revokeToken('rt_abc')).rejects.toThrow(/status 503/);
  });
});
