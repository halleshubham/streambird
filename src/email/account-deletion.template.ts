import { BRAND, brandedEmail, escapeHtml } from './brand-email';

const SUPPORT = 'support@shackyapps.in';

export interface AccountDeletionCodeData {
  code: string;
  baseUrl?: string;
}

/** The code that confirms "delete my account": says clearly what it is for, so nobody types it in by habit. */
export function buildAccountDeletionCodeEmail(data: AccountDeletionCodeData): { subject: string; text: string; html: string } {
  const { code } = data;
  return {
    subject: `${code} is your StreamBird account deletion code`,
    text: `Your StreamBird account deletion code is ${code}. It expires in 10 minutes. Entering it permanently deletes your account. If you did not ask to delete your account, do not share this code and ignore this email.`,
    html: brandedEmail({
      baseUrl: data.baseUrl,
      preheader: `Deletion code: ${code}. It expires in 10 minutes.`,
      badge: 'CONFIRM DELETION',
      headline: 'Confirm account deletion.',
      accent: 'This cannot be undone.',
      bodyHtml:
        `<p style="margin:0 0 14px">Someone asked to permanently delete this StreamBird account. Enter this code in StreamBird to confirm:</p>` +
        `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="background:${BRAND.soft};border:2px dashed ${BRAND.lilac};border-radius:14px;padding:18px 10px">` +
        `<div style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:38px;line-height:1.1;font-weight:800;letter-spacing:0.28em;padding-left:0.28em;color:${BRAND.violetDark}">${escapeHtml(code)}</div>` +
        `<div style="margin-top:8px;font-size:13px;color:${BRAND.muted}">Expires in 10 minutes</div></td></tr></table>` +
        `<p style="margin:16px 0 0;font-size:13px;color:#8a87a0">If this was not you, ignore this email and do not share the code. Nothing is deleted without it.</p>`,
      supportEmail: SUPPORT,
    }),
  };
}

export interface AccountDeletedData {
  /** True when a company admin deleted the whole company account this person belonged to. */
  companyDeleted: boolean;
  baseUrl?: string;
}

/** Sent after a deletion; says only that it happened (no names, no details). */
export function buildAccountDeletedEmail(data: AccountDeletedData): { subject: string; text: string; html: string } {
  const what = data.companyDeleted
    ? 'The StreamBird company account you were part of has been deleted by its administrator, and your access to it has ended.'
    : 'Your StreamBird account and the data linked to it have been deleted.';
  const more =
    'Some records we must keep by law (payment records, with no name or email) and backup copies that are overwritten on a schedule can remain for a limited time.';
  return {
    subject: 'Your StreamBird account was deleted',
    text: `${what}\n\n${more}\n\nIf you did not do this, or you have questions, write to ${SUPPORT}.`,
    html: brandedEmail({
      baseUrl: data.baseUrl,
      preheader: 'Your StreamBird account was deleted.',
      badge: 'ACCOUNT DELETED',
      headline: 'Your account was deleted.',
      accent: 'Thanks for streaming with us.',
      bodyHtml:
        `<p style="margin:0 0 14px">${escapeHtml(what)}</p>` +
        `<p style="margin:0 0 14px;font-size:13px;color:${BRAND.muted}">${escapeHtml(more)}</p>` +
        `<p style="margin:0;font-size:13px;color:#8a87a0">If you did not do this, write to ${escapeHtml(SUPPORT)} right away.</p>`,
      supportEmail: SUPPORT,
    }),
  };
}
