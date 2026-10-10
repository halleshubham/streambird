import { BRAND, brandedEmail, escapeHtml, pill } from './brand-email';

const base = { preheader: 'Preview line', badge: 'STUDIO READY', headline: 'Your studio is ready.', accent: "Let's go live!", bodyHtml: '<p>Body</p>', supportEmail: 'support@shackyapps.in' };

describe('brandedEmail', () => {
  it('has the flyer look: dark header with the small logo, the headline accent, a violet button and the purple footer', () => {
    const html = brandedEmail({ ...base, baseUrl: 'https://streambird.test/', cta: { label: 'Log in', url: 'https://streambird.test/login' } });
    expect(html).toContain('src="https://streambird.test/icon-192.png"'); // the 192 px icon, not the 1.7 MB master; one slash only
    expect(html).toContain(`bgcolor="${BRAND.night}"`);
    expect(html).toContain(BRAND.lilac);
    expect(html).toContain('href="https://streambird.test/login"');
    expect(html).toContain(`bgcolor="${BRAND.violet}"`);
    expect(html).toContain('Your next show starts at');
    expect(html).toContain('mailto:support@shackyapps.in');
  });

  it('uses solid colours under every gradient, so clients that drop gradients look the same', () => {
    const html = brandedEmail(base);
    for (const m of html.matchAll(/background-image:linear-gradient\(/g)) expect(m).toBeTruthy();
    expect(html).toMatch(/background-color:#22104d;background-image:linear-gradient/);
  });

  it('has a hidden preheader, no button when there is no cta, and defaults the site to streambird.app', () => {
    const html = brandedEmail(base);
    expect(html).toContain('display:none');
    expect(html).toContain('Preview line');
    expect(html).not.toContain('Log in');
    expect(html).toContain('https://streambird.app/icon-192.png');
  });

  it('escapes the text it is given (headline, badge, button label and url, preheader)', () => {
    const html = brandedEmail({ ...base, headline: '<b>x</b>', badge: 'A&B', preheader: '"q"', cta: { label: '<i>go</i>', url: 'https://a.test/?a=1&b="2"' } });
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('A&amp;B');
    expect(html).toContain('&lt;i&gt;go&lt;/i&gt;');
    expect(html).toContain('a=1&amp;b=&quot;2&quot;');
  });

  it('escapeHtml and pill', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(pill('Solo <user>')).toContain('Solo &lt;user&gt;');
  });
});
