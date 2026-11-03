# StreamBird SEO audit, November 2026

Scope: streambird.app (`/`, `/login`, `/privacy`, `/terms`, `/delete-account`, 404 behaviour, redirects) and shackyapps.in (home + `/docs/streambird/*`).
Method: the checklists and 0-100 category weighting of the claude-seo skills (Technical 22%, Content 23%, On-page 20%, Schema 10%, Performance 10%, AI-search readiness 10%, Images 5%), applied by hand with `curl` and Playwright against the public pages on 2026-11-03. No Search Console, no ranking, traffic or crawl-log data was available, so **scores are judgement from the checklists, not measured rankings**. "After" scores describe the branches `claude/seo-streambird` (this repo) and `claude/seo-docs` (shackyapps-landing); **nothing is deployed yet**, so live behaviour is unverified until the founder merges and deploys.

## 1. Scores

| Area (weight) | streambird.app before | after (branch) | shackyapps.in before | after (branch) |
|---|---|---|---|---|
| Technical (22) | 35 | 80 | 55 | 85 |
| Content quality (23) | 45 | 55 | 60 | 62 |
| On-page (20) | 25 | 80 | 55 | 80 |
| Schema (10) | 0 | 80 | 45 | 70 |
| Performance (10) | 55 | 75 | 75 | 75 |
| AI-search readiness (10) | 15 | 65 | 40 | 50 |
| Images (5) | 30 | 75 | 55 | 70 |
| **Weighted total** | **32** | **72** | **56** | **72** |

Content stays the lowest area: the code can make the existing content visible and well-labelled, but only new pages (section 5) raise it further.

## 2. Findings (evidence)

### streambird.app
1. **The landing is invisible without JavaScript.** Raw HTML is a 1 KB shell: `<title>StreamBird</title>`, empty `<div id="root">`, no description, no canonical, no h1, no pricing or FAQ text. Everything (h1 "Go live once. Be everywhere.", 6 h2s, plans, FAQ) exists only in the rendered DOM. Google can render JS, but other crawlers, link-preview bots and most AI crawlers do not.
2. **Soft 404s everywhere.** `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/manifest.webmanifest` and `/nope-xyz` all return **200 text/html** (the SPA shell). A crawler reading `/robots.txt` gets HTML; unknown URLs look like real pages.
3. **No noindex on the app.** `/dashboard`, `/studio`-style, `/admin`, `/join/*` return the same indexable shell (200, no `X-Robots-Tag`, no meta robots). `/join/<token>` links shared publicly could be indexed.
4. **No page titles or descriptions per route.** One title for all pages; legal pages and login are indistinguishable in search results and browser history.
5. **No Open Graph / Twitter cards, no share image.** Links shared to WhatsApp, X, LinkedIn show a bare URL.
6. **No structured data.**
7. **Performance:** one 743 KB JS entry (220 KB gzip) containing the studio, admin and every signed-in screen; 156 KB CSS; the 1704x1704, 458 KB `logo.png` was used as a ~28 px header icon on every page; the Google Fonts stylesheet was render-blocking; all assets `Cache-Control: public, max-age=0` (hashed assets re-validated on every visit). Lab (Playwright through the sandbox proxy, so latency-inflated): landing LCP 4.3 s desktop / 2.9 s mobile profile, CLS 0, TBT 129 / 78 ms, FCP = LCP (blank until JS ran), no sideways scroll at 1366 or 390 px. Font load is only 2 woff2 files (27 KB), `preconnect` and `display=swap` were already present. Compression: gzip/zstd present (via Cloudflare).
8. **Headings and links (rendered DOM):** one h1, h2 per section, h3 in cards, no skipped levels. Footer links to Privacy, Terms, Delete account, Docs; header had no docs link; no landmark `<main>`. Docs are linked only from the footer.
9. **Redirects:** `http://` 302 to `https://` at Cloudflare (a 302; 301 preferred). `www.streambird.app` could not be fetched through the audit proxy (502): **unverified**, see checklist.
10. **Headers:** no HSTS, `X-Content-Type-Options`, `Referrer-Policy`; `x-powered-by: Express` exposed. Not ranking factors, but cheap hygiene (a CSP needs care because of Google Fonts, Analytics and the studio).
11. **hreflang:** English-only product with INR pricing; no separate locale pages, so **hreflang is not needed**. Set `og:locale` to `en_IN` (done). Revisit only if you create a genuinely distinct India page.
12. **AI-search readiness:** no `llms.txt`, nothing citable in raw HTML. Cloudflare's managed robots on shackyapps.in blocks training bots (see below); streambird.app currently serves HTML at `/robots.txt`, so crawlers there see no rules at all.
13. **Landing copy issues to fix by hand (not changed, they are product copy):** the FAQ "How does billing work?" says billing is handled by the team outside StreamBird while the pricing section says you can pay online (UPI, card, netbanking) when payments are on; the FAQ makes comparative claims about StreamYard pricing that should be backed by a dated source or softened.

### shackyapps.in
1. **Docs canonicals disagree with the server.** Canonical and sitemap use `/docs/streambird/go-live` (no slash) but nginx 301-redirects that to `/docs/streambird/go-live/` (and the `Location` header was `http://`, one more hop through Cloudflare). All 20 sitemap URLs were redirects.
2. **robots.txt has no `Sitemap:` line**; `/sitemap.xml` is 404; the docs sitemap at `/docs/sitemap.xml` exists (34 URLs, includes `/docs/search`, with meaningless changefreq/priority).
3. **Cloudflare managed robots.txt blocks AI training crawlers** (ClaudeBot, GPTBot, Google-Extended, Applebot-Extended, CCBot, Amazonbot, Bytespider, meta-externalagent and more; `Content-Signal: search=yes, ai-train=no`). Search crawlers are allowed. This is a business choice; it also reduces presence in model training (not in search). Decide deliberately.
4. **Titles and descriptions:** every docs page had a unique title but the generic suffix; 4 pages had auto-generated descriptions of 10 to 62 characters (Getting started, Presets, Schedule, Privacy) and others were truncated at 150+ characters of the first paragraph. The docs root `/docs/` has a 57-char description.
5. **Structured data:** Docusaurus already emits BreadcrumbList on docs pages. Home page had none; no Organization.
6. **Landing `index.html`:** description present, but no canonical, no Open Graph/Twitter, no social image, `/` and `/index.html` both resolve; privacy/terms/app pages had no canonical.
7. **Images:** content screenshots in docs all have alt text; only 2 logos per page and the docs-home app logos are decorative (empty alt, acceptable).
8. **Social card:** none for docs.
9. Static nginx, gzip on, security headers (nosniff, SAMEORIGIN, referrer policy) present: good.

## 3. What changed

### streambird (`claude/seo-streambird`)
- **Per-route head tags** (`web-app/src/seo/routes.ts` registry + `components/RouteHead.tsx`): title, description, canonical, robots, Open Graph, Twitter card, updated on every client-side navigation; anything not listed is `noindex`.
- **Build-time prerender** (`web-app/scripts/prerender.mjs`, runs in `npm run build`, no browser needed): `/`, `/privacy`, `/terms`, `/delete-account` are written as static HTML with head tags and full page markup; the landing also carries JSON-LD (Organization, WebSite, WebApplication with a free offer; no FAQPage, no ratings). The server serves them (`src/seo/seo.ts`); React replaces them on load and `/` keeps showing the same markup while the session check runs (no flash).
- **Server SEO behaviour** (`src/seo/seo.ts`): generated `robots.txt` and `sitemap.xml` (public URLs only, from `PUBLIC_BASE_URL`, correct content types), `X-Robots-Tag: noindex` on every app/guest/admin/login route, `/api` and `/stream/*`, real **404** for unknown page URLs (SPA still shows its 404 screen), hashed `/assets/*` cached `immutable` for a year, HTML `no-cache`.
- **Share image** `public/og-image.png` (1200x630, 138 KB), `llms.txt`, `manifest.webmanifest`, `theme-color`.
- **Performance:** route-level code splitting (entry JS 743 to 339 KB, 220 to 106 KB gzip; entry CSS 156 to 95 KB), 35 KB `logo-256.png` for header/loader icons instead of the 458 KB original (canvas watermark still uses the original), non-blocking Google Fonts stylesheet (with `noscript` fallback).
- **Landing:** `<main>` landmark, docs "Guides" link in the header and three contextual guide links under "How it works"; still one h1 and no skipped levels.
- **Docs for agents:** `.claude/docs/frontend.md` ("SEO"), `operations.md`, `testing.md`, `decisions-and-gotchas.md`; build command in `CLAUDE.md` and skills is now `npm run build --prefix web-app` (includes the prerender).
- **robots.txt design:** `Disallow` only for login-only areas that are never linked (`/api/`, `/dashboard`, `/streams`, `/connections`, `/billing`, `/brand`, `/team`, `/account`, `/admin`, `/socket.io/`). `/join/*`, `/login`, `/signup-company` are deliberately not disallowed so crawlers can read their noindex. `/login` is noindex (decision; switch it in `routes.ts` if you want it to rank for "streambird login").

### shackyapps-landing (`claude/seo-docs`)
- 20 StreamBird docs pages: unique descriptions (130 to 155 chars, only facts already on the page), clearer titles for generic ones ("Go live with StreamBird", "Getting started with StreamBird", ...; sidebar labels unchanged).
- `trailingSlash: true` so canonical, sitemap and nginx agree; 91 relative links (StreamBird and SocioBird docs) rewritten from `./page` to `./page.md` so they still resolve (build with `onBrokenLinks: throw` passes). `nginx.conf` `absolute_redirect off` (no more `http://` Location).
- Sitemap plugin: no changefreq/priority noise, `/docs/search` excluded. Root `robots.txt` (Sitemap lines for `/sitemap.xml` and `/docs/sitemap.xml`; Cloudflare still prepends its managed rules) and a hand-listed root `sitemap.xml`; Dockerfile copies both.
- Social cards: `docs-site/static/img/social-card.png` (docs), `assets/img/og-shackyapps.png` (home), both 1200x630 under 90 KB; Organization JSON-LD on every docs page (plus the built-in BreadcrumbList).
- Home `index.html`: title, description, canonical, robots, Open Graph, Twitter, JSON-LD (Organization with the social profiles already in the footer, WebSite, StreamBird WebApplication), a "Guides" link on the StreamBird card; canonicals on privacy, terms and app pages.
- Build: `npm ci && npm run build` in `docs-site` succeeds.

## 4. Prioritised fix list (impact vs effort)

| # | Item | Impact | Effort | Status |
|---|---|---|---|---|
| 1 | Prerendered landing/legal HTML | high | M | done (branch) |
| 2 | robots.txt + sitemap.xml as real files, 404s, noindex on app | high | S | done |
| 3 | Titles, descriptions, canonical, OG/Twitter, share image | high | S | done |
| 4 | Docs canonical/sitemap/redirect mismatch, robots Sitemap lines | high | S | done |
| 5 | JSON-LD (Organization, WebSite, WebApplication) | medium | S | done |
| 6 | Code splitting, small logo, immutable assets, async font CSS | medium | M | done |
| 7 | Search Console and Bing verification, submit both sitemaps | high | S | founder |
| 8 | Fix FAQ billing answer and comparative claims on the landing | medium | S | needs founder wording |
| 9 | New content pages (section 5) | high | L | founder/content |
| 10 | Cloudflare: 301 http to https, `www` to apex, HSTS, decide AI-bot policy | medium | S | founder |
| 11 | Security headers (nosniff, Referrer-Policy; CSP needs care) in the Nest app | low | S | not done |
| 12 | Pricing on its own indexable page (`/pricing`), dated and kept in sync with plans | medium | M | not done |
| 13 | Self-host Plus Jakarta Sans (drops two third-party origins) | low | S | not done |

## 5. Keyword and page plan (no search-volume data was available; validate in Search Console / a keyword tool before writing)

Only features that exist today may be claimed: YouTube, Facebook Pages, Twitch and custom RTMP destinations; guests by link without an account; mix-minus audio; grid/spotlight and designed layouts; logo, wallpaper, ticker, lower thirds, brand kits (paid); slides; screen share; presets; schedule; vertical 9:16; recording to the host's computer (Pro/Business); background removal (Pro/Business); INR pricing with Free, Lite, Starter, Pro, Business, Day Pass. No testimonials, user counts or ratings exist, so none may be shown.

| Target keywords | Owner page | Status |
|---|---|---|
| multistream to YouTube Facebook Twitch, stream to multiple platforms at once, live stream from browser | `/` | exists (now crawlable) |
| streaming software pricing in rupees, live streaming tool India price | `/pricing` (new) or the pricing section | new page worth making |
| StreamYard alternative, StreamYard alternative India, restream alternative | `/alternatives/streamyard` (new; factual feature/price table, dated, no unverifiable claims) | missing |
| live stream without OBS, OBS alternative in browser | `/live-stream-without-obs` (new) | missing |
| invite guests to a live stream, remote guest link live stream | `/features/guest-studio` (new), docs "Join as a guest" for how-to | missing |
| vertical live stream 9:16, YouTube Shorts live | `/features/vertical-live` (new) | missing |
| live stream branding, logo overlay, lower thirds, news ticker | `/features/branding` (new) | missing |
| schedule a live stream on YouTube and Facebook | docs "Schedule a stream and invite guests" | exists |
| stream to Kick / custom RTMP | docs "Add an RTMP destination" | exists |
| remove background live stream, green screen browser | docs "Remove the background" | exists |
| use cases: webinars, video podcasts, classes and coaching, events (Day Pass), local news with ticker | `/use-cases/<name>` (new, one per use case, only real features) | missing |
| StreamBird login / sign in | `/login` is noindex; allow if brand-navigational traffic matters | decision |

## 6. AI-search readiness
- Done: `llms.txt` (facts, destinations, docs, legal), real HTML content for the landing and legal pages, consistent entity naming ("StreamBird, from ShackyApps") in titles, JSON-LD and llms.txt.
- Open: the Cloudflare policy on shackyapps.in blocks AI training crawlers; streambird.app has no such rule (robots now allows all and lists no AI-specific rules). Decide one policy for both. Answer-style content (FAQ, how-to pages) is the main lever for being cited; write it in the pages above. Possible name collision with other products called StreamBird could not be checked from here.

## 7. Verification done and not done
- Done locally: typecheck, unit tests, e2e (`seo.e2e-spec.ts` plus the full suite), UI suite incl. `seo.spec.ts` (JS-off crawler view, head tags per route, JSON-LD parse, 404 status, noindex headers, sitemap equals canonicals, OG image 1200x630 under 150 KB), docs-site build.
- **Not verified:** production behaviour after deploy; Googlebot rendering (no Search Console, no URL Inspection); rich-result eligibility (Rich Results Test not run); real Core Web Vitals (only lab numbers through a proxy); ranking or traffic; `www.streambird.app` behaviour; Facebook/X/WhatsApp preview rendering; backlinks.

## 8. Founder checklist
1. Merge/deploy both branches (`claude/seo-streambird`, `claude/seo-docs`); confirm `PUBLIC_BASE_URL=https://streambird.app` in Coolify.
2. Google Search Console: add `https://streambird.app` and `https://shackyapps.in` (domain properties via DNS), submit `https://streambird.app/sitemap.xml`, `https://shackyapps.in/sitemap.xml` and `https://shackyapps.in/docs/sitemap.xml`; run URL Inspection on `/` to confirm the rendered HTML and canonical.
3. Bing Webmaster Tools: import from Search Console, submit the same sitemaps.
4. Cloudflare: 301 (not 302) http to https, redirect `www.streambird.app` to the apex, enable HSTS, check `/robots.txt` on streambird.app is served by the app, and decide the AI-crawler policy.
5. Share-preview check after deploy with the Facebook Sharing Debugger, the LinkedIn Post Inspector and WhatsApp; run the Rich Results Test on `/`.
6. No change to OAuth scopes or platform reviews: `youtube.force-ssl` is untouched.
7. Profiles and entity: Google Business Profile is not needed for an online product; keep ShackyApps social profiles (Facebook, Instagram, LinkedIn, GitHub) linked from both sites with the same name and logo; consider Product Hunt, G2/Capterra and AlternativeTo listings only with real, accurate descriptions.
8. Content: approve and write the pages in section 5 (and the FAQ billing fix), then add each to `PUBLIC_ROUTES` (see `frontend.md` "SEO").
9. Backlinks and outreach: ask partners/early users for links to the landing and docs; guest-post and community answers (YouTube creator, Indian webinar, church and education communities) with no spam; no purchased links.
10. Review the AGPL repo README so its first lines match the landing description (it is a high-authority page about the product).
