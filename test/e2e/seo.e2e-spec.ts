import { existsSync } from 'fs';
import { join } from 'path';
import { describeE2E, bootApp, Harness } from './harness';

// Search-engine behaviour of the served app: robots.txt, sitemap.xml, prerendered public pages, noindex on the app,
// real 404s. The HTML cases need the built SPA (`npm run build --prefix web-app`, which also prerenders).
const built = existsSync(join(__dirname, '..', '..', 'dist-web', '_prerender', 'home.html'));
const itBuilt = built ? it : it.skip;

describeE2E('SEO: robots, sitemap, prerendered pages, noindex, 404s', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await bootApp();
  });
  afterAll(async () => {
    await h.close();
  });
  const get = (path: string) => fetch(`${h.baseUrl}${path}`, { redirect: 'manual' });

  it('serves robots.txt as text/plain with the sitemap and the private areas disallowed', async () => {
    const res = await get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('User-agent: *');
    expect(body).toContain(`Sitemap: ${h.baseUrl}/sitemap.xml`);
    for (const p of ['/api/', '/dashboard', '/streams', '/admin', '/account', '/billing']) expect(body).toContain(`Disallow: ${p}`);
    expect(body).not.toMatch(/^Disallow: \/$/m);
    expect(body).not.toContain('Disallow: /join'); // a crawler has to fetch /join/... to see its noindex
  });

  it('serves sitemap.xml as XML with only the public pages', async () => {
    const res = await get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('xml');
    const locs = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(['/', '/privacy', '/terms', '/delete-account'].map((p) => `${h.baseUrl}${p}`));
  });

  it('serves llms.txt and the manifest as files, not as the app shell', async () => {
    if (!built) return;
    const llms = await get('/llms.txt');
    expect(llms.status).toBe(200);
    expect(llms.headers.get('content-type')).toContain('text/plain');
    expect(await llms.text()).toContain('# StreamBird');
    const manifest = await get('/manifest.webmanifest');
    expect(manifest.status).toBe(200);
    expect(JSON.parse(await manifest.text()).name).toBe('StreamBird');
  });

  itBuilt('serves the public pages as prerendered HTML with their own head tags and no noindex', async () => {
    const expected: Record<string, { h1: RegExp; canonical: string }> = {
      '/': { h1: /<h1>Go live once\./, canonical: `${h.baseUrl}/` },
      '/privacy': { h1: /<h1>StreamBird Privacy Policy/, canonical: `${h.baseUrl}/privacy` },
      '/terms': { h1: /<h1>StreamBird Terms of Service/, canonical: `${h.baseUrl}/terms` },
      '/delete-account': { h1: /<h1>Delete your StreamBird account/, canonical: `${h.baseUrl}/delete-account` },
    };
    for (const [path, want] of Object.entries(expected)) {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-robots-tag')).toBeNull();
      const html = await res.text();
      expect(html).toMatch(want.h1);
      expect(html).toContain(`<link rel="canonical" href="${want.canonical}" />`);
      expect(html).toMatch(/<title>[^<]{10,}<\/title>/);
      expect(html).toContain('property="og:image" content="' + h.baseUrl + '/og-image.png"');
      expect(html).toContain('name="twitter:card" content="summary_large_image"');
      expect(html).not.toContain('__SB_ORIGIN__');
      expect(html).toContain('<script type="module"'); // the SPA still loads on top of the static HTML
    }
  });

  itBuilt('the landing HTML has its sections, pricing, FAQ and valid JSON-LD without running any JavaScript', async () => {
    const html = await (await get('/')).text();
    for (const text of ['Everything a live production needs', 'Start free. Pay when you grow.', 'Questions, answered', 'Do I need to install anything?', 'Pro', 'Business']) {
      expect(html).toContain(text);
    }
    expect((html.match(/<h1[ >]/g) ?? []).length).toBe(1);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map((m) => JSON.parse(m[1]));
    expect(blocks).toHaveLength(1);
    const types = blocks[0]['@graph'].map((n: any) => n['@type']);
    expect(types).toEqual(['Organization', 'WebSite', 'WebApplication']);
    expect(blocks[0]['@graph'][1].url).toBe(`${h.baseUrl}/`);
    expect(JSON.stringify(blocks)).not.toMatch(/aggregateRating|review/i);
  });

  itBuilt('marks every signed-in, guest and admin page noindex (header), and still serves the app shell', async () => {
    for (const path of ['/dashboard', '/streams/new', '/streams/abc/studio', '/connections', '/billing', '/team', '/account', '/admin', '/admin/accounts', '/join/some-token', '/login', '/signup-company']) {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-robots-tag')).toMatch(/noindex/);
      expect(await res.text()).toContain('<div id="root">');
    }
  });

  itBuilt('answers 404 (not a soft 200) with noindex for pages the app does not have, but still draws the SPA', async () => {
    for (const path of ['/nope', '/privacy/extra', '/some/deep/page']) {
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(res.headers.get('x-robots-tag')).toMatch(/noindex/);
      expect(await res.text()).toContain('<div id="root">');
    }
  });

  it('keeps /api answers out of the index and does not 404 the health check', async () => {
    const api = await get('/api/config/public');
    expect(api.status).toBe(200);
    expect(api.headers.get('x-robots-tag')).toMatch(/noindex/);
    expect((await get('/health')).status).toBe(200);
  });

  itBuilt('caches hashed assets for a year but lets HTML revalidate', async () => {
    const html = await (await get('/dashboard')).text();
    const asset = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    expect(asset).toBeTruthy();
    const res = await get(asset!);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect((await get('/')).headers.get('cache-control')).toBe('no-cache');
  });
});
