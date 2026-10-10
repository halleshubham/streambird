import { BRAND, brandedEmail } from './brand-email';

/** Where a user writes to about their account; also what the pending-approval page shows. */
export const SUPPORT_EMAIL = 'support@shackyapps.in';

export interface ApprovalDecisionData {
  decision: 'approved' | 'rejected';
  /** Where the user logs in (PUBLIC_BASE_URL/login). */
  loginUrl: string;
  /** Public origin of the site (for the logo); defaults to https://streambird.app. */
  baseUrl?: string;
}

const li = (icon: string, text: string): string =>
  `<tr><td valign="top" width="30" style="padding:6px 0;font-size:18px">${icon}</td><td style="padding:6px 0;font-size:14px;line-height:1.5;color:${BRAND.ink}">${text}</td></tr>`;

/** Subject, plain text and HTML for the email a user gets when a superadmin approves or rejects their sign-up. */
export function buildApprovalDecisionEmail(data: ApprovalDecisionData): { subject: string; text: string; html: string } {
  const support = `<a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND.violet};font-weight:700">${SUPPORT_EMAIL}</a>`;

  if (data.decision === 'approved') {
    return {
      subject: 'Your StreamBird studio is ready',
      text: [
        'Good news: your StreamBird studio is ready.',
        '',
        `Log in with this email address and go live: ${data.loginUrl}`,
        '',
        'A good first step is to connect YouTube, Facebook or Twitch under Connections, then press Go live. Invite guests with a link, no downloads needed.',
        '',
        `Questions? Reply to this email or write to ${SUPPORT_EMAIL}.`,
      ].join('\n'),
      html: brandedEmail({
        baseUrl: data.baseUrl,
        preheader: 'Log in and go live in minutes.',
        badge: 'STUDIO READY',
        headline: 'Your studio is ready.',
        accent: "Let's go live!",
        bodyHtml:
          `<p style="margin:0 0 14px">Good news: our team has set everything up. Log in with this email address and you can be live in minutes.</p>` +
          `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${BRAND.soft};border:1px solid ${BRAND.softBorder};border-radius:12px"><tr><td style="padding:12px 16px">` +
          `<div style="font-size:12px;font-weight:800;letter-spacing:0.08em;color:${BRAND.violet};margin-bottom:4px">YOUR FIRST SHOW IN 3 STEPS</div>` +
          `<table role="presentation" cellpadding="0" cellspacing="0" width="100%">` +
          li('&#128279;', '<b>Connect</b> YouTube, Facebook or Twitch under Connections') +
          li('&#127909;', 'Press <b>Go live</b> and start your camera') +
          li('&#128101;', '<b>Invite guests</b> with a link, no downloads needed') +
          `</table></td></tr></table>`,
        cta: { label: 'Log in to StreamBird', url: data.loginUrl },
        supportEmail: SUPPORT_EMAIL,
      }),
    };
  }

  return {
    subject: 'About your StreamBird sign-up',
    text: [
      "Thanks for your interest in StreamBird. We're not able to set up an account for this email address right now.",
      '',
      `If you think this is a mistake, or you'd like to tell us more about what you plan to stream, write to ${SUPPORT_EMAIL} and we'll take another look.`,
    ].join('\n'),
    html: brandedEmail({
      baseUrl: data.baseUrl,
      preheader: "We can't set up an account for this address right now.",
      badge: 'ABOUT YOUR SIGN-UP',
      headline: 'Thanks for your interest',
      accent: 'in StreamBird.',
      bodyHtml:
        `<p style="margin:0 0 14px">We're not able to set up an account for this email address right now.</p>` +
        `<p style="margin:0">If you think this is a mistake, or you'd like to tell us more about what you plan to stream, write to ${support} and we'll take another look.</p>`,
      supportEmail: SUPPORT_EMAIL,
    }),
  };
}

