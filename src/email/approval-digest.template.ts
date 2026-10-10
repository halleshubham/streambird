import { BRAND, brandedEmail, escapeHtml, pill } from './brand-email';

/** One account waiting for approval, as listed in the superadmin's digest email. */
export interface PendingApprovalRow {
  email: string;
  role: string;
  companyName: string | null;
  createdAt: Date;
}

export interface PendingApprovalsDigestData {
  /** The oldest first, capped by the caller (MAX_ROWS). */
  users: PendingApprovalRow[];
  /** How many are waiting in total (can exceed users.length). */
  totalPending: number;
  /** How many of them signed up after the previous digest. */
  newSinceLast: number;
  /** Where the superadmin approves or rejects them. */
  adminUrl: string;
  /** Public origin of the site (for the logo); defaults to https://streambird.app. */
  baseUrl?: string;
  /** "Now" for the "waiting for" column; injectable so tests are exact. */
  now?: Date;
}

const kind = (role: string): string => (role === 'company_admin' ? 'Company admin' : 'Solo user');

function utc(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function waited(from: Date, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  return hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} days`;
}

/** Subject, plain text and HTML for the "accounts waiting for approval" digest. Everything user-supplied is escaped. */
export function buildApprovalDigest(data: PendingApprovalsDigestData): { subject: string; text: string; html: string } {
  const now = data.now ?? new Date();
  const n = data.totalPending;
  const subject = `StreamBird: ${n} ${n === 1 ? 'account is' : 'accounts are'} waiting for approval`;
  const intro =
    data.newSinceLast > 0
      ? `${n} waiting in total, ${data.newSinceLast} new since the last email.`
      : `${n} waiting in total, none new since the last email.`;
  const more = n > data.users.length ? `…and ${n - data.users.length} more in the admin console.` : '';

  const lines = data.users.map(
    (u) => `- ${u.email} (${kind(u.role)}${u.companyName ? `, ${u.companyName}` : ''}) signed up ${utc(u.createdAt)}, waiting ${waited(u.createdAt, now)}`,
  );
  const text = [intro, '', ...lines, ...(more ? [more] : []), '', `Approve or reject: ${data.adminUrl}`, '', 'You get this email at most every few hours, and only while someone is waiting.'].join('\n');

  const rows = data.users
    .map(
      (u) =>
        `<tr>` +
        `<td style="padding:10px 12px;border-bottom:1px solid ${BRAND.softBorder};font-size:14px;color:${BRAND.ink}"><b>${escapeHtml(u.email)}</b><br>` +
        `${pill(kind(u.role), u.role === 'company_admin' ? 'violet' : 'grey')}${u.companyName ? ` <span style="color:${BRAND.muted};font-size:12px">${escapeHtml(u.companyName)}</span>` : ''}</td>` +
        `<td align="right" valign="top" style="padding:10px 12px;border-bottom:1px solid ${BRAND.softBorder};font-size:13px;white-space:nowrap;color:${BRAND.muted}">waiting<br><b style="color:${BRAND.ink};font-size:14px">${waited(u.createdAt, now)}</b></td></tr>`,
    )
    .join('');
  const html = brandedEmail({
    baseUrl: data.baseUrl,
    preheader: intro,
    badge: 'NEEDS YOUR OK',
    headline: `${n} ${n === 1 ? 'account is' : 'accounts are'}`,
    accent: 'waiting for approval.',
    bodyHtml:
      `<p style="margin:0 0 14px;color:${BRAND.muted}">${escapeHtml(intro)}</p>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${BRAND.soft};border:1px solid ${BRAND.softBorder};border-radius:12px">${rows}</table>` +
      (more ? `<p style="margin:12px 0 0;color:${BRAND.muted};font-size:14px">${escapeHtml(more)}</p>` : '') +
      `<p style="margin:16px 0 0;color:#8a87a0;font-size:12px">You get this email at most every few hours, and only while someone is waiting.</p>`,
    cta: { label: 'Review in the admin console', url: data.adminUrl },
    supportEmail: 'support@shackyapps.in',
  });
  return { subject, text, html };
}
