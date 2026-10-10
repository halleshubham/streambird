import { BRAND, brandedEmail, escapeHtml } from './brand-email';

export interface TeamInviteData {
  companyName: string;
  /** Public origin of the site; the login link and the logo hang off it. Defaults to https://streambird.app. */
  baseUrl?: string;
}

/** Sent when a company admin adds someone to their team: no invite token, they just log in with this address. */
export function buildTeamInviteEmail(data: TeamInviteData): { subject: string; text: string; html: string } {
  const base = (data.baseUrl ?? 'https://streambird.app').replace(/\/$/, '');
  const company = data.companyName;
  return {
    subject: `You've been invited to join ${company} on StreamBird`,
    text: `You've been added to ${company}'s StreamBird account. Log in at any time with this email address to get started -- no separate invite link needed: ${base}/login`,
    html: brandedEmail({
      baseUrl: data.baseUrl,
      preheader: `${company} added you to their StreamBird account.`,
      badge: "YOU'RE INVITED",
      headline: 'Join your team',
      accent: `at ${company}.`,
      bodyHtml:
        `<p style="margin:0 0 14px"><b>${escapeHtml(company)}</b> has added you to their StreamBird account, so you can go live to YouTube, Facebook and Twitch together.</p>` +
        `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${BRAND.soft};border:1px solid ${BRAND.softBorder};border-radius:12px"><tr><td style="padding:12px 16px;font-size:14px;color:${BRAND.ink}">` +
        `<b>No invite link to find.</b> Just log in with this email address and you are in. We send a one-time code to confirm it is you.</td></tr></table>`,
      cta: { label: 'Log in to StreamBird', url: `${base}/login` },
      supportEmail: 'support@shackyapps.in',
    }),
  };
}
