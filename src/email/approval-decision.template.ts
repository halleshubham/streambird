/** Where a user writes to about their account; also what the pending-approval page shows. */
export const SUPPORT_EMAIL = 'support@shackyapps.in';

export interface ApprovalDecisionData {
  decision: 'approved' | 'rejected';
  /** Where the user logs in (PUBLIC_BASE_URL/login). */
  loginUrl: string;
}

/** Subject, plain text and HTML for the email a user gets when a superadmin approves or rejects their sign-up. */
export function buildApprovalDecisionEmail(data: ApprovalDecisionData): { subject: string; text: string; html: string } {
  const shell = (title: string, paragraphs: string[], button?: { label: string; url: string }) =>
    `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#222;max-width:520px">` +
    `<h2 style="margin:0 0 12px;font-size:20px">${title}</h2>` +
    paragraphs.map((p) => `<p style="margin:0 0 12px">${p}</p>`).join('') +
    (button
      ? `<p style="margin:18px 0"><a href="${button.url}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:bold">${button.label}</a></p>`
      : '') +
    `<p style="margin:18px 0 0;color:#777;font-size:13px">StreamBird &middot; <a href="mailto:${SUPPORT_EMAIL}" style="color:#7c3aed">${SUPPORT_EMAIL}</a></p></div>`;

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
      html: shell(
        'Your StreamBird studio is ready',
        [
          'Good news: your studio is set up. Log in with this email address and you can go live in minutes.',
          'A good first step: connect YouTube, Facebook or Twitch under <b>Connections</b>, then press <b>Go live</b>. Invite guests with a link, no downloads needed.',
          `Questions? Write to <a href="mailto:${SUPPORT_EMAIL}" style="color:#7c3aed">${SUPPORT_EMAIL}</a>.`,
        ],
        { label: 'Log in to StreamBird', url: data.loginUrl },
      ),
    };
  }

  return {
    subject: 'About your StreamBird sign-up',
    text: [
      "Thanks for your interest in StreamBird. We're not able to set up an account for this email address right now.",
      '',
      `If you think this is a mistake, or you'd like to tell us more about what you plan to stream, write to ${SUPPORT_EMAIL} and we'll take another look.`,
    ].join('\n'),
    html: shell('About your StreamBird sign-up', [
      "Thanks for your interest in StreamBird. We're not able to set up an account for this email address right now.",
      `If you think this is a mistake, or you'd like to tell us more about what you plan to stream, write to <a href="mailto:${SUPPORT_EMAIL}" style="color:#7c3aed">${SUPPORT_EMAIL}</a> and we'll take another look.`,
    ]),
  };
}
