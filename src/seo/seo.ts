import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import type { NextFunction, Request, Response } from 'express';

/**
 * Search-engine behaviour of the web app (see .claude/docs/frontend.md "SEO"):
 *  - robots.txt and sitemap.xml are generated from PUBLIC_BASE_URL, so staging never advertises production URLs;
 *  - the public pages (/, /privacy, /terms, /delete-account) are served from the build-time prerender
 *    (dist-web/_prerender/*.html) so crawlers get real HTML;
 *  - every other page URL answers with X-Robots-Tag: noindex; URLs the SPA does not know answer 404 (not a soft 200).
 * Runs before ServeStaticModule (registered in configureApp), so it only handles page URLs and calls next() for assets.
 */

/** Public, indexable paths and the prerendered file that serves each. Keep in step with web-app/src/seo/routes.ts. */
export const PUBLIC_PAGES: Record<string, string> = {
  '/': 'home',
  '/privacy': 'privacy',
  '/terms': 'terms',
  '/delete-account': 'delete-account',
};

/** Client-side routes that exist but must not be indexed (signed-in app, guest links, admin). Matched as path or path/... */
export const APP_PREFIXES = [
  '/login',
  '/signup-company',
  '/account-deleted',
  '/dashboard',
  '/connections',
  '/billing',
  '/brand',
  '/streams',
  '/team',
  '/account',
  '/join',
  '/admin',
];

/** Crawling is blocked for areas that need a login and are never linked publicly. /join, /login and the like are left
 * crawlable on purpose: a crawler must be able to fetch a page to see its noindex. */
export const DISALLOWED_IN_ROBOTS = [
  '/api/',
  '/dashboard',
  '/connections',
  '/billing',
  '/brand',
  '/streams',
  '/team',
  '/account',
  '/admin',
  '/socket.io/',
];

export function robotsTxt(base: string): string {
  return [
    '# StreamBird: public pages are the home page, privacy, terms and delete-account.',
    'User-agent: *',
    'Allow: /',
    ...DISALLOWED_IN_ROBOTS.map((p) => `Disallow: ${p}`),
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
}

export function sitemapXml(base: string): string {
  const urls = Object.keys(PUBLIC_PAGES).map((p) => `  <url><loc>${base}${p}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

const isApp = (path: string) => APP_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

/** Token baked into prerendered/base HTML in place of the site origin (web-app/src/seo/routes.ts ORIGIN_TOKEN). */
const ORIGIN_TOKEN = '__SB_ORIGIN__';

export function seoMiddleware(opts: { publicBaseUrl: string; webRoot: string }) {
  const base = opts.publicBaseUrl.replace(/\/$/, '');
  const cache = new Map<string, { mtimeMs: number; html: string }>();
  // Re-read when the file changes (a rebuilt web app in dev/tests); otherwise served from memory.
  const page = (file: string): string | null => {
    const path = join(opts.webRoot, file);
    try {
      const { mtimeMs } = statSync(path);
      const hit = cache.get(file);
      if (hit && hit.mtimeMs === mtimeMs) return hit.html;
      const html = readFileSync(path, 'utf8').split(ORIGIN_TOKEN).join(base);
      cache.set(file, { mtimeMs, html });
      return html;
    } catch {
      return null;
    }
  };
  const send = (res: Response, html: string, status: number, headers: Record<string, string> = {}) => {
    res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...headers }).send(html);
  };

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const path = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;

    if (path === '/robots.txt') return void res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(robotsTxt(base));
    if (path === '/sitemap.xml') return void res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(sitemapXml(base));

    // API and the public live-link redirect: never index.
    if (path.startsWith('/api/') || path.startsWith('/stream/')) {
      res.set('X-Robots-Tag', 'noindex, nofollow');
      return next();
    }
    // Files (assets, icons, llms.txt, ...) and the health check: leave to the static handler / controllers.
    const last = path.split('/').pop() ?? '';
    if (last.includes('.') || path === '/health' || path.startsWith('/socket.io') || path.startsWith('/_prerender')) return next();

    const prerendered = PUBLIC_PAGES[path];
    if (prerendered) {
      const html = page(`_prerender/${prerendered}.html`);
      if (html) return send(res, html, 200);
      return next(); // no prerender in this build (dev): the SPA shell
    }

    const noindex = { 'X-Robots-Tag': 'noindex, nofollow' };
    const shell = page('index.html');
    if (isApp(path)) {
      if (shell) return send(res, shell, 200, noindex);
      res.set(noindex);
      return next();
    }
    // Not a route of the app: a real 404 (the SPA still draws its "page flew away" screen).
    if (shell) return send(res, shell, 404, noindex);
    return next();
  };
}
