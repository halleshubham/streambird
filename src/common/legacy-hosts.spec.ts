import { legacyHostRedirect, legacyOrigins, parseLegacyHosts } from './legacy-hosts';

describe('legacy hosts (domain move)', () => {
  const NEW = 'https://new.example.com';

  function run(host: string, opts: { method?: string; url?: string; legacy?: string[]; base?: string } = {}) {
    const url = opts.url ?? '/';
    const req: any = { method: opts.method ?? 'GET', headers: { host }, originalUrl: url, path: url.split('?')[0] };
    const res: any = { redirect: jest.fn() };
    const next = jest.fn();
    legacyHostRedirect(opts.legacy ?? ['old.example.com'], opts.base ?? NEW)(req, res, next);
    return { res, next };
  }

  it('parses a comma-separated list, tolerating schemes, ports, case and blanks', () => {
    expect(parseLegacyHosts('https://Old.Example.com:443, other.example.com ,,')).toEqual(['old.example.com', 'other.example.com']);
    expect(parseLegacyHosts(undefined)).toEqual([]);
    expect(parseLegacyHosts('')).toEqual([]);
  });

  it('derives the exact Origin values from the canonical protocol', () => {
    expect(legacyOrigins(['old.example.com'], NEW)).toEqual(['https://old.example.com']);
    expect(legacyOrigins(['old.local'], 'http://localhost:3000')).toEqual(['http://old.local']);
  });

  it('301-redirects a page visit on the old host to the same path and query on the new one', () => {
    const { res, next } = run('old.example.com', { url: '/join/abc123?pw=1' });
    expect(res.redirect).toHaveBeenCalledWith(301, 'https://new.example.com/join/abc123?pw=1');
    expect(next).not.toHaveBeenCalled();
    expect(run('OLD.example.com:443', { url: '/dashboard' }).res.redirect).toHaveBeenCalledWith(301, 'https://new.example.com/dashboard');
  });

  it('leaves API calls, the health check, websockets and every non-GET alone on the old host', () => {
    for (const url of ['/api/streams', '/api/platform-connections/youtube/callback', '/health', '/socket.io/?EIO=4']) {
      const { res, next } = run('old.example.com', { url });
      expect(res.redirect).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    }
    expect(run('old.example.com', { method: 'POST', url: '/anything' }).next).toHaveBeenCalled();
  });

  it('does nothing on the canonical host, an unlisted host, or when no legacy host is configured', () => {
    expect(run('new.example.com').next).toHaveBeenCalled();
    expect(run('somewhere.else').next).toHaveBeenCalled();
    expect(run('old.example.com', { legacy: [] }).next).toHaveBeenCalled();
  });

  it('never redirects the canonical host to itself (misconfigured LEGACY_HOSTS)', () => {
    const { res, next } = run('new.example.com', { legacy: ['new.example.com'] });
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
