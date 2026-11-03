import { OG_IMAGE_PATH, PUBLIC_ROUTES, SITE_NAME } from './routes';

/**
 * Structured data for the landing page, written into the prerendered HTML (`scripts/prerender.mjs`).
 * Only facts that are on the page or in the product: no ratings, review counts or invented statistics.
 * FAQPage is deliberately not emitted: Google limits FAQ rich results to a few site types, and one landing answer
 * (billing) is not the whole story -- add it back only when the FAQ copy is final.
 */
export function landingJsonLd(origin: string): Record<string, unknown> {
  const org = `${origin}/#organization`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': org,
        name: 'ShackyApps',
        url: 'https://shackyapps.in',
        email: 'support@shackyapps.in',
        logo: `${origin}/icon-512.png`,
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        url: `${origin}/`,
        name: SITE_NAME,
        inLanguage: 'en',
        publisher: { '@id': org },
      },
      {
        '@type': 'WebApplication',
        '@id': `${origin}/#app`,
        name: SITE_NAME,
        url: `${origin}/`,
        description: PUBLIC_ROUTES['/'].description,
        applicationCategory: 'MultimediaApplication',
        operatingSystem: 'Any (runs in a web browser)',
        browserRequirements: 'Requires a modern browser with WebRTC and camera/microphone access',
        image: `${origin}${OG_IMAGE_PATH}`,
        featureList: [
          'Stream to YouTube, Facebook and Twitch at the same time',
          'Invite remote guests with a link, no account or install needed',
          'Mix-minus audio for guests',
          'Grid and spotlight layouts with your own logo and ticker',
          'Screen share and saved scenes',
          'Schedule streams ahead, vertical 9:16 or landscape 16:9',
        ],
        offers: {
          '@type': 'Offer',
          name: 'Free plan',
          price: '0',
          priceCurrency: 'USD',
          url: `${origin}/#pricing`,
        },
        publisher: { '@id': org },
      },
    ],
  };
}
