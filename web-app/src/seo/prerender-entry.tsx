import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { LandingPage } from '../routes/LandingPage';
import { PrivacyPolicyPage } from '../routes/PrivacyPolicyPage';
import { TermsOfServicePage } from '../routes/TermsOfServicePage';
import { DeleteAccountInfoPage } from '../routes/DeleteAccountInfoPage';
import { landingJsonLd } from './jsonld';
import { ORIGIN_TOKEN, PUBLIC_ROUTES, headTags, type RouteSeo } from './routes';

/**
 * Build-time only (loaded by scripts/prerender.mjs through Vite's SSR loader; never part of the browser bundle).
 * Renders the public pages to static HTML so crawlers and no-JS clients get the real content; the SPA then replaces
 * it on load. Pages are rendered as an anonymous visitor.
 */
const PAGES: Record<string, () => React.ReactElement> = {
  '/': () => <LandingPage />,
  '/privacy': () => <PrivacyPolicyPage />,
  '/terms': () => <TermsOfServicePage />,
  '/delete-account': () => <DeleteAccountInfoPage />,
};

const anonymous = {
  status: 'anonymous' as const,
  user: null,
  accountId: null,
  login: async () => undefined,
  setSession: () => undefined,
  logout: async () => undefined,
  refresh: async () => undefined,
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export interface Prerendered {
  path: string;
  name: string;
  seo: RouteSeo;
  /** Markup for <div id="root">. */
  body: string;
  /** Tags for <head> (without the <title>). */
  head: string;
}

export function prerenderAll(): Prerendered[] {
  return Object.entries(PUBLIC_ROUTES).map(([path, seo]) => {
    const page = PAGES[path];
    if (!page || !seo.prerender) throw new Error(`No prerender entry for ${path}`);
    const body = renderToString(
      <AuthContext.Provider value={anonymous}>
        <StaticRouter location={path}>{page()}</StaticRouter>
      </AuthContext.Provider>,
    );
    const tags = headTags(seo, ORIGIN_TOKEN, path).map((t) => {
      const attrs = Object.entries(t.attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
      return `<${t.tag} ${attrs} />`;
    });
    if (path === '/') {
      // "</" is escaped so the JSON can never close its own <script>.
      const json = JSON.stringify(landingJsonLd(ORIGIN_TOKEN)).replace(/</g, '\\u003c');
      tags.push(`<script type="application/ld+json">${json}</script>`);
    }
    return { path, name: seo.prerender, seo, body, head: tags.join('\n    ') };
  });
}
