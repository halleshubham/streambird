import type { NextFunction, Request, Response } from 'express';

/**
 * Support for moving the app to a new domain without breaking anything that
 * still points at the old one (LEGACY_HOSTS, comma-separated hostnames):
 *
 * - Page navigations on a legacy host are 301-redirected to the canonical
 *   host (PUBLIC_BASE_URL) -- old guest invite links, bookmarks, calendar
 *   entries. /api, /health and the websocket path are left alone so API-key
 *   clients, OAuth callbacks still registered on the old host and Coolify's
 *   health check keep working.
 * - Browser writes whose Origin is a legacy host stay accepted by the CSRF
 *   check (see AccountGuard) until the legacy host is removed.
 */

/** "https://Old.Example.com:443, other.example.com" -> ["old.example.com", "other.example.com"] */
export function parseLegacyHosts(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, ''))
    .filter(Boolean);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

/** Exact Origin header values a legacy host's browser pages send, e.g. "https://old.example.com". */
export function legacyOrigins(legacyHosts: string[], publicBaseUrl: string): string[] {
  let protocol = 'https:';
  try {
    protocol = new URL(publicBaseUrl).protocol;
  } catch {
    // keep https
  }
  return legacyHosts.map((host) => `${protocol}//${host}`);
}

const NEVER_REDIRECT_PREFIXES = ['/api', '/health', '/socket.io'];

export function legacyHostRedirect(legacyHosts: string[], publicBaseUrl: string) {
  const canonicalHost = hostOf(publicBaseUrl);
  const legacy = new Set(legacyHosts.filter((h) => h !== canonicalHost));

  return (req: Request, res: Response, next: NextFunction) => {
    if (legacy.size === 0 || (req.method !== 'GET' && req.method !== 'HEAD')) return next();

    const requestHost = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
    if (!legacy.has(requestHost)) return next();

    const path = req.path;
    if (NEVER_REDIRECT_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return next();

    // originalUrl keeps the path and query string, so /join/<token>?x=y survives.
    res.redirect(301, `${publicBaseUrl.replace(/\/$/, '')}${req.originalUrl}`);
  };
}
