import { BRAND, brandedEmail, escapeHtml } from './brand-email';

export interface LoginCodeData {
  code: string;
  /** Public origin of the site (for the logo); defaults to https://streambird.app. */
  baseUrl?: string;
}

/** The one-time login code email: the code is the whole point, so it is the biggest thing in it. */
export function buildLoginCodeEmail(data: LoginCodeData): { subject: string; text: string; html: string } {
  const { code } = data;
  return {
    subject: `${code} is your StreamBird login code`,
    text: `Your StreamBird login code is ${code}. It expires in 10 minutes. If you didn't ask for it, you can ignore this email.`,
    html: brandedEmail({
      baseUrl: data.baseUrl,
      preheader: `Your code: ${code}. It expires in 10 minutes.`,
      badge: 'YOUR LOGIN CODE',
      headline: 'Here is your code.',
      accent: 'Welcome back!',
      bodyHtml:
        `<p style="margin:0 0 14px">Enter this code on the StreamBird login page to sign in:</p>` +
        `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="background:${BRAND.soft};border:2px dashed ${BRAND.lilac};border-radius:14px;padding:18px 10px">` +
        `<div style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:38px;line-height:1.1;font-weight:800;letter-spacing:0.28em;padding-left:0.28em;color:${BRAND.violetDark}">${escapeHtml(code)}</div>` +
        `<div style="margin-top:8px;font-size:13px;color:${BRAND.muted}">Expires in 10 minutes</div></td></tr></table>` +
        `<p style="margin:16px 0 0;font-size:13px;color:#8a87a0">If you didn't ask for this code, you can safely ignore this email. Nobody can sign in without it.</p>`,
      supportEmail: 'support@shackyapps.in',
    }),
  };
}
