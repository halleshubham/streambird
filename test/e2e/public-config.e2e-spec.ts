import { describeE2E, bootApp, Client, Harness } from './harness';

describeE2E('public config: the cookie banner is off unless COOKIE_CONSENT_BANNER turns it on', () => {
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env.COOKIE_CONSENT_BANNER;
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.COOKIE_CONSENT_BANNER;
    else process.env.COOKIE_CONSENT_BANNER = previous;
  });

  const withFlag = async (value: string | undefined): Promise<unknown> => {
    if (value === undefined) delete process.env.COOKIE_CONSENT_BANNER;
    else process.env.COOKIE_CONSENT_BANNER = value;
    const h: Harness = await bootApp();
    try {
      const res = await new Client(h.baseUrl).get('/config/public'); // no sign-in needed
      expect(res.status).toBe(200);
      return res.body;
    } finally {
      await h.close();
    }
  };

  it('defaults to off, and treats junk as off', async () => {
    expect(await withFlag(undefined)).toEqual({ cookieConsentBanner: false });
    expect(await withFlag('')).toEqual({ cookieConsentBanner: false });
    expect(await withFlag('maybe')).toEqual({ cookieConsentBanner: false });
  });

  it('turns on for true / 1 / yes, whatever the case', async () => {
    expect(await withFlag('true')).toEqual({ cookieConsentBanner: true });
    expect(await withFlag('TRUE')).toEqual({ cookieConsentBanner: true });
    expect(await withFlag('1')).toEqual({ cookieConsentBanner: true });
  });
});
