/**
 * Per-route search metadata, shared by the browser (`RouteHead`) and the build-time prerender
 * (`scripts/prerender.mjs`). The sitemap and robots.txt live in the backend (`src/seo/seo.ts`) and list the
 * same public paths: keep them in step (`test/ui/seo.spec.ts` checks it).
 */
export const SITE_NAME = 'StreamBird';
/** Placeholder for the site origin in prerendered HTML; the server swaps in PUBLIC_BASE_URL when it serves the page. */
export const ORIGIN_TOKEN = '__SB_ORIGIN__';
export const OG_IMAGE_PATH = '/og-image.png';
export const OG_IMAGE_ALT = 'StreamBird: go live once, be everywhere. A browser live-streaming studio for YouTube, Facebook and Twitch.';

export interface RouteSeo {
  /** Full <title>. */
  title: string;
  description: string;
  /** false = <meta name="robots" content="noindex, follow"> (the server also sends X-Robots-Tag). */
  index: boolean;
  /** Written to dist-web/_prerender/<name>.html at build time and served at that path to crawlers and browsers alike. */
  prerender?: string;
}

/** Public, indexable pages. Add a new public page here AND to `src/seo/seo.ts` (sitemap) -- see frontend.md "SEO". */
export const PUBLIC_ROUTES: Record<string, RouteSeo> = {
  '/': {
    title: 'StreamBird: multistream to YouTube, Facebook and Twitch from your browser',
    description:
      'Go live once and stream everywhere. StreamBird is a browser-based live-streaming studio with remote guests, layouts and branding that sends one broadcast to YouTube, Facebook and Twitch at once. Free plan, INR pricing.',
    index: true,
    prerender: 'home',
  },
  '/privacy': {
    title: 'Privacy Policy | StreamBird',
    description: 'How StreamBird collects, uses and protects your data, including Google and Facebook user data, cookies, retention and deletion.',
    index: true,
    prerender: 'privacy',
  },
  '/terms': {
    title: 'Terms of Service | StreamBird',
    description: 'The terms that apply when you use StreamBird, the browser live-streaming studio and multistreaming service from ShackyApps.',
    index: true,
    prerender: 'terms',
  },
  '/delete-account': {
    title: 'Delete your StreamBird account and data | StreamBird',
    description: 'How to delete your StreamBird account, what is deleted, what we keep and for how long, and what to do if you cannot log in.',
    index: true,
    prerender: 'delete-account',
  },
};

/** Reachable without signing in but not worth a search result. */
export const NOINDEX_ROUTES: Record<string, Pick<RouteSeo, 'title' | 'description'>> = {
  '/login': { title: 'Log in | StreamBird', description: 'Log in to StreamBird, the browser live-streaming studio.' },
  '/signup-company': { title: 'Create a company | StreamBird', description: 'Create a StreamBird company account.' },
  '/account-deleted': { title: 'Account deleted | StreamBird', description: 'Your StreamBird account has been deleted.' },
};

const DEFAULT_NOINDEX: RouteSeo = { title: 'StreamBird', description: PUBLIC_ROUTES['/'].description, index: false };

/** Metadata for a pathname; anything not listed (the signed-in app, guest links, admin, 404s) is noindex. */
export function seoForPath(pathname: string): RouteSeo {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const pub = PUBLIC_ROUTES[path];
  if (pub) return pub;
  const quiet = NOINDEX_ROUTES[path];
  if (quiet) return { ...quiet, index: false };
  return DEFAULT_NOINDEX;
}

export interface HeadTag {
  tag: 'meta' | 'link';
  attrs: Record<string, string>;
}

/** The tags that describe one page. Same list for the browser and the prerender so they cannot drift apart. */
export function headTags(seo: RouteSeo, origin: string, pathname: string): HeadTag[] {
  const url = `${origin}${pathname === '/' ? '/' : pathname.replace(/\/+$/, '')}`;
  const image = `${origin}${OG_IMAGE_PATH}`;
  const tags: HeadTag[] = [
    { tag: 'meta', attrs: { name: 'description', content: seo.description } },
    { tag: 'meta', attrs: { name: 'robots', content: seo.index ? 'index, follow, max-image-preview:large' : 'noindex, follow' } },
    { tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
    { tag: 'meta', attrs: { property: 'og:site_name', content: SITE_NAME } },
    { tag: 'meta', attrs: { property: 'og:locale', content: 'en_IN' } },
    { tag: 'meta', attrs: { property: 'og:title', content: seo.title } },
    { tag: 'meta', attrs: { property: 'og:description', content: seo.description } },
    { tag: 'meta', attrs: { property: 'og:url', content: url } },
    { tag: 'meta', attrs: { property: 'og:image', content: image } },
    { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
    { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
    { tag: 'meta', attrs: { property: 'og:image:alt', content: OG_IMAGE_ALT } },
    { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
    { tag: 'meta', attrs: { name: 'twitter:title', content: seo.title } },
    { tag: 'meta', attrs: { name: 'twitter:description', content: seo.description } },
    { tag: 'meta', attrs: { name: 'twitter:image', content: image } },
    { tag: 'meta', attrs: { name: 'twitter:image:alt', content: OG_IMAGE_ALT } },
  ];
  if (seo.index) tags.push({ tag: 'link', attrs: { rel: 'canonical', href: url } });
  return tags;
}
