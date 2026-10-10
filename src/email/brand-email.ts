/**
 * The StreamBird email look, the same as the promo flyer: a deep-purple header with the logo, a white
 * body, a violet button and a purple footer band. Built from tables with inline styles because that is
 * what mail clients render; `bgcolor` and a solid `background-color` sit under every gradient, so clients
 * that ignore gradients (Outlook) still show the same colours.
 */
export const BRAND = {
  ink: '#1a1033',
  night: '#22104d',
  night2: '#14092f',
  violet: '#7c3aed',
  violetDark: '#5b21b6',
  lilac: '#c4a7ff',
  pink: '#ff8aa1',
  soft: '#f6f3ff',
  softBorder: '#e6defb',
  muted: '#5b5873',
  green: '#16a34a',
} as const;

export const DEFAULT_BASE_URL = 'https://streambird.app';
const FONT = "Inter,'Helvetica Neue',Arial,sans-serif";

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface BrandedEmail {
  /** Public origin of the site; the logo is loaded from it (a small icon, not the 1.7 MB master). */
  baseUrl?: string;
  /** The grey preview line some clients show next to the subject. */
  preheader: string;
  /** Small uppercase pill above the headline, e.g. "STUDIO READY". */
  badge: string;
  /** Headline, white on the dark header. `accent` is the second line in the lilac highlight colour. */
  headline: string;
  accent?: string;
  /** Trusted HTML for the white body (callers escape anything a user typed). */
  bodyHtml: string;
  cta?: { label: string; url: string };
  supportEmail: string;
}

const gradient = (a: string, b: string, deg = 160) => `background-color:${a};background-image:linear-gradient(${deg}deg,${a},${b});`;

/** The full HTML document for a branded email. */
export function brandedEmail(o: BrandedEmail): string {
  const base = (o.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const button = o.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px"><tr><td align="center" bgcolor="${BRAND.violet}" style="border-radius:10px;${gradient(BRAND.violet, BRAND.violetDark)}">` +
      `<a href="${escapeHtml(o.cta.url)}" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:15px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:10px">${escapeHtml(o.cta.label)}</a></td></tr></table>`
    : '';

  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>StreamBird</title></head>` +
    `<body style="margin:0;padding:0;background:#ece8f7">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(o.preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ece8f7"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-radius:18px;overflow:hidden;background:#ffffff;font-family:${FONT}">` +
    // ---- header
    `<tr><td bgcolor="${BRAND.night}" style="${gradient(BRAND.night, BRAND.night2)}padding:26px 30px 30px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>` +
    `<td width="48" valign="middle"><img src="${escapeHtml(base)}/icon-192.png" width="44" height="44" alt="" style="display:block;border:0"></td>` +
    `<td valign="middle" style="padding-left:10px;font-family:${FONT};font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.01em">StreamBird</td>` +
    `<td align="right" valign="middle" style="font-family:${FONT};font-size:12px;font-weight:700"><a href="${escapeHtml(base)}" style="color:#d9d3f0;text-decoration:none">streambird.app</a></td>` +
    `</tr></table>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0"><tr><td bgcolor="#4a1f4f" style="border:1px solid #ff5d7d;border-radius:99px;padding:5px 12px;font-family:${FONT};font-size:11px;font-weight:800;letter-spacing:0.09em;color:${BRAND.pink}">&#9679;&nbsp; ${escapeHtml(o.badge)}</td></tr></table>` +
    `<h1 style="margin:14px 0 0;font-family:${FONT};font-size:30px;line-height:1.12;letter-spacing:-0.02em;font-weight:900;color:#ffffff">${escapeHtml(o.headline)}${o.accent ? `<br><span style="color:${BRAND.lilac}">${escapeHtml(o.accent)}</span>` : ''}</h1>` +
    `</td></tr>` +
    // ---- body
    `<tr><td style="padding:26px 30px 26px;font-family:${FONT};font-size:15px;line-height:1.6;color:${BRAND.ink}">${o.bodyHtml}${button}</td></tr>` +
    // ---- footer band
    `<tr><td bgcolor="${BRAND.violetDark}" style="${gradient(BRAND.night, BRAND.violetDark, 120)}padding:20px 30px;font-family:${FONT};color:#e2d8ff;font-size:13px;line-height:1.5">` +
    `<b style="display:block;font-size:16px;color:#ffffff;margin-bottom:2px">Your next show starts at <span style="color:#ffd3dc">streambird.app</span></b>` +
    `Go live to YouTube, Facebook and Twitch from one browser tab.<br>` +
    `Questions? <a href="mailto:${escapeHtml(o.supportEmail)}" style="color:#ffffff;font-weight:700">${escapeHtml(o.supportEmail)}</a> &middot; A ShackyApps product</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

/** A small pill, e.g. for "Solo user" / "Company admin" in a list. */
export const pill = (text: string, tone: 'violet' | 'grey' = 'violet'): string =>
  `<span style="display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:800;${
    tone === 'violet' ? `background:${BRAND.soft};color:${BRAND.violet};border:1px solid ${BRAND.softBorder}` : 'background:#f1f0f5;color:#5b5873;border:1px solid #e3e1ea'
  }">${escapeHtml(text)}</span>`;
