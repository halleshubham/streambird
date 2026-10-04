import { buildFacebookDialogUrl } from './facebook-dialog';

describe('buildFacebookDialogUrl', () => {
  const base = { clientId: 'app1', redirectUri: 'https://x.test/cb', state: 'st', scope: 'email,public_profile' };

  it('uses scope for classic Facebook Login', () => {
    const q = new URL(buildFacebookDialogUrl(base)).searchParams;
    expect(q.get('scope')).toBe('email,public_profile');
    expect(q.get('config_id')).toBeNull();
    expect(q.get('response_type')).toBe('code');
  });

  it('uses config_id instead of scope for Facebook Login for Business', () => {
    const q = new URL(buildFacebookDialogUrl({ ...base, configId: '123' })).searchParams;
    expect(q.get('config_id')).toBe('123');
    expect(q.get('scope')).toBeNull();
    expect(q.get('override_default_response_type')).toBe('true');
  });
});
