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
  /** "Now" for the "waiting for" column; injectable so tests are exact. */
  now?: Date;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${escapeHtml(u.email)}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${kind(u.role)}${u.companyName ? `<br><span style="color:#777">${escapeHtml(u.companyName)}</span>` : ''}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap">${waited(u.createdAt, now)}</td></tr>`,
    )
    .join('');
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:560px">` +
    `<h2 style="margin:0 0 6px;font-size:18px">${n} ${n === 1 ? 'account is' : 'accounts are'} waiting for approval</h2>` +
    `<p style="margin:0 0 12px;color:#555">${escapeHtml(intro)}</p>` +
    `<table style="border-collapse:collapse;width:100%"><tr style="text-align:left;color:#777;font-size:12px"><th style="padding:6px 10px">Email</th><th style="padding:6px 10px">Type</th><th style="padding:6px 10px">Waiting</th></tr>${rows}</table>` +
    (more ? `<p style="color:#555">${escapeHtml(more)}</p>` : '') +
    `<p><a href="${escapeHtml(data.adminUrl)}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold">Review in the admin console</a></p>` +
    `<p style="color:#888;font-size:12px">You get this email at most every few hours, and only while someone is waiting.</p></div>`;
  return { subject, text, html };
}
