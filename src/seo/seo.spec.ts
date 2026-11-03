import { APP_PREFIXES, DISALLOWED_IN_ROBOTS, PUBLIC_PAGES, robotsTxt, sitemapXml } from './seo';

describe('seo', () => {
  const base = 'https://streambird.app';

  it('robots.txt allows the site, blocks the private areas and names the sitemap', () => {
    const txt = robotsTxt(base);
    expect(txt).toContain('Allow: /\n');
    expect(txt).toContain(`Sitemap: ${base}/sitemap.xml`);
    for (const p of DISALLOWED_IN_ROBOTS) expect(txt).toContain(`Disallow: ${p}`);
    for (const p of Object.keys(PUBLIC_PAGES).filter((x) => x !== '/')) expect(txt).not.toContain(`Disallow: ${p}\n`);
  });

  it('sitemap lists exactly the public pages as absolute URLs', () => {
    const xml = sitemapXml(base);
    expect(xml.match(/<loc>/g)).toHaveLength(Object.keys(PUBLIC_PAGES).length);
    expect(xml).toContain('<loc>https://streambird.app/</loc>');
    expect(xml).toContain('<loc>https://streambird.app/privacy</loc>');
    for (const p of APP_PREFIXES) expect(xml).not.toContain(`${base}${p}<`);
  });

  it('no path is both public and an app prefix', () => {
    for (const p of Object.keys(PUBLIC_PAGES)) expect(APP_PREFIXES).not.toContain(p);
  });
});
