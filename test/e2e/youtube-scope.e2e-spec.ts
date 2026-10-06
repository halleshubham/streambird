import { describeE2E, bootApp, Harness } from './harness';

describeE2E('YouTube connect asks Google for the one narrow scope', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await bootApp();
  });
  afterAll(() => h.close());

  it('sends the user to Google asking only for youtube.force-ssl (offline access, consent shown)', async () => {
    const { client } = await h.signIn();
    const reply = await client.getRedirect('/platform-connections/youtube/connect');
    expect(reply.status).toBe(302);
    const url = new URL(reply.location!);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    // One scope, and it is not the broader "manage your YouTube account" one.
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/youtube.force-ssl');
    expect(url.searchParams.get('scope')).not.toBe('https://www.googleapis.com/auth/youtube');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('redirect_uri')).toMatch(/\/api\/platform-connections\/youtube\/callback$/);
  });

  it('Google sign-in asks for identity only (openid, email, profile) and nothing from YouTube', async () => {
    const reply = await h.signIn().then(({ client }) => client.getRedirect('/auth/google'));
    expect(reply.status).toBe(302);
    const scope = new URL(reply.location!).searchParams.get('scope')!.split(' ').sort();
    expect(scope).toEqual(['email', 'openid', 'profile']);
  });
});
