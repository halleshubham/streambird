import { ConfigService } from '@nestjs/config';
import { FacebookLoginService } from './facebook-login.service';

describe('FacebookLoginService', () => {
  const config = {
    get: (k: string) => ({ 'facebook.appId': 'app1', 'facebook.appSecret': 'sec' })[k],
  } as unknown as ConfigService;
  const service = new FacebookLoginService(config);

  afterEach(() => jest.restoreAllMocks());

  it('asks only for email and public_profile', () => {
    const url = new URL(service.buildAuthUrl('st', 'https://x.test/cb'));
    expect(url.searchParams.get('scope')).toBe('email,public_profile');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('redirect_uri')).toBe('https://x.test/cb');
  });

  it('returns the profile, with email undefined when Facebook withholds it', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'A' }) } as Response);
    await expect(service.exchangeCodeForProfile('c', 'https://x.test/cb')).resolves.toEqual({
      email: undefined,
      name: 'A',
    });
  });

  it('throws when the token exchange fails', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 400 } as Response);
    await expect(service.exchangeCodeForProfile('c', 'u')).rejects.toThrow('400');
  });
});
