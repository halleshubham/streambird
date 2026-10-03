/**
 * Guest-invite content for a scheduled stream -- one source for the HTML
 * email, its plaintext alternative, the calendar (.ics) attachment, and the
 * plaintext the host copies from the UI ("Copy invitation"), so they can
 * never drift apart.
 */
export interface StreamInviteData {
  kind: 'invite' | 'update' | 'cancelled';
  streamId: string;
  title: string;
  description: string | null;
  notes: string | null;
  startsAt: Date;
  /** IANA timezone the host scheduled in -- only for rendering the time. */
  timezone: string;
  durationMinutes: number | null;
  hostName: string;
  joinUrl: string;
  passwordProtected: boolean;
  platforms: string[];
  /** Public watch links on the platforms, once the broadcast exists there. */
  watchLinks?: Array<{ platform: string; url: string }>;
}

export interface StreamInviteEmail {
  subject: string;
  html: string;
  text: string;
  ics: string;
}

const DEFAULT_DURATION_MINUTES = 60;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "Saturday, October 10, 2026 at 6:30 PM GMT+5:30" in the host's timezone; falls back to UTC for an unknown zone. */
export function formatWhen(startsAt: Date, timezone: string): string {
  // Explicit fields, not dateStyle/timeStyle: those can't be combined with
  // timeZoneName (RangeError), and the zone is the point of this string.
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  };
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: timezone }).format(startsAt);
  } catch {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(startsAt);
  }
}

function formatDuration(minutes: number | null): string | null {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function headline(data: StreamInviteData): string {
  if (data.kind === 'cancelled') return `Cancelled: ${data.title}`;
  if (data.kind === 'update') return `Updated: ${data.title}`;
  return `You're invited: ${data.title}`;
}

/** The plaintext invitation -- used as the email's text part and by "Copy invitation". */
export function buildInvitationText(data: StreamInviteData): string {
  const lines: string[] = [];

  if (data.kind === 'cancelled') {
    lines.push(`${data.hostName} has cancelled "${data.title}".`);
    lines.push('');
    lines.push(`It was scheduled for ${formatWhen(data.startsAt, data.timezone)}.`);
    lines.push('The join link no longer works. Sorry for the change of plans.');
    return lines.join('\n');
  }

  lines.push(
    data.kind === 'update'
      ? `Details for "${data.title}" have changed -- please note the new information below.`
      : `You're invited to join "${data.title}" as a guest.`,
  );
  lines.push('');
  lines.push(`When: ${formatWhen(data.startsAt, data.timezone)}`);
  const duration = formatDuration(data.durationMinutes);
  if (duration) lines.push(`Duration: about ${duration}`);
  lines.push(`Host: ${data.hostName}`);
  if (data.platforms.length > 0) lines.push(`Streaming live to: ${data.platforms.join(', ')}`);
  if (data.description) {
    lines.push('');
    lines.push(`About: ${data.description}`);
  }
  if (data.notes) {
    lines.push('');
    lines.push(`Note from ${data.hostName}: ${data.notes}`);
  }
  if (data.watchLinks && data.watchLinks.length > 0) {
    lines.push('');
    lines.push('Watch live:');
    for (const link of data.watchLinks) lines.push(`  ${link.platform}: ${link.url}`);
  }
  lines.push('');
  lines.push(`Join link: ${data.joinUrl}`);
  if (data.passwordProtected) lines.push('Password: required -- ask the host for it.');
  lines.push('');
  lines.push('Open the link in Chrome, Edge or Safari a few minutes early and allow camera and microphone access. Headphones are recommended.');
  return lines.join('\n');
}

function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** RFC 5545 requires lines <= 75 octets; fold with CRLF + space. */
function foldIcsLine(line: string): string {
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    chunks.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  chunks.push(rest);
  return chunks.join('\r\n');
}

export function buildIcs(data: StreamInviteData, now: Date = new Date()): string {
  const end = new Date(data.startsAt.getTime() + (data.durationMinutes ?? DEFAULT_DURATION_MINUTES) * 60_000);
  const cancelled = data.kind === 'cancelled';
  const description = [data.description, data.notes, cancelled ? null : `Join: ${data.joinUrl}`]
    .filter(Boolean)
    .join('\n\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//StreamBird//Scheduled stream//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${cancelled ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    // Stable per stream so an update/cancel replaces the calendar entry.
    `UID:${data.streamId}@streambird`,
    `DTSTAMP:${icsDate(now)}`,
    `SEQUENCE:${Math.floor(now.getTime() / 60_000)}`,
    `DTSTART:${icsDate(data.startsAt)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(data.title)}`,
    ...(description ? [`DESCRIPTION:${icsEscape(description)}`] : []),
    ...(cancelled ? [] : [`URL:${data.joinUrl}`]),
    `ORGANIZER;CN=${icsEscape(data.hostName)}:mailto:noreply@streambird.invalid`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

export function buildStreamInviteEmail(data: StreamInviteData): StreamInviteEmail {
  const when = escapeHtml(formatWhen(data.startsAt, data.timezone));
  const duration = formatDuration(data.durationMinutes);
  const cancelled = data.kind === 'cancelled';

  const detailRow = (label: string, value: string) =>
    `<tr><td style="padding:6px 16px 6px 0;color:#6b7280;font-size:14px;white-space:nowrap;vertical-align:top">${label}</td>` +
    `<td style="padding:6px 0;color:#111827;font-size:14px">${value}</td></tr>`;

  const rows = [
    detailRow('When', `<strong>${when}</strong>`),
    ...(duration && !cancelled ? [detailRow('Duration', `about ${escapeHtml(duration)}`)] : []),
    detailRow('Host', escapeHtml(data.hostName)),
    ...(data.platforms.length > 0 && !cancelled
      ? [detailRow('Streaming to', escapeHtml(data.platforms.join(', ')))]
      : []),
  ].join('');

  const intro = cancelled
    ? `${escapeHtml(data.hostName)} has cancelled this stream. The join link no longer works.`
    : data.kind === 'update'
      ? 'The details of this stream have changed — please note the new information below.'
      : `${escapeHtml(data.hostName)} has invited you to join as a guest.`;

  const block = (heading: string, body: string) =>
    `<div style="margin:20px 0 0"><div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin-bottom:4px">${heading}</div>` +
    `<div style="font-size:14px;line-height:1.55;color:#111827;white-space:pre-wrap">${escapeHtml(body)}</div></div>`;

  const watch =
    !cancelled && data.watchLinks && data.watchLinks.length > 0
      ? `<div style="margin:20px 0 0"><div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin-bottom:4px">Watch live</div>` +
        data.watchLinks
          .map(
            (l) =>
              `<div style="font-size:14px;line-height:1.7"><strong>${escapeHtml(l.platform)}:</strong> <a href="${escapeHtml(l.url)}" style="color:#7c3aed;word-break:break-all">${escapeHtml(l.url)}</a></div>`,
          )
          .join('') +
        '</div>'
      : '';

  const button = cancelled
    ? ''
    : `<div style="margin:28px 0 8px"><a href="${escapeHtml(data.joinUrl)}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#ec4899);background-color:#7c3aed;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:999px">Join the stream</a></div>` +
      `<div style="font-size:12px;color:#6b7280;word-break:break-all">Or paste this link into your browser: <a href="${escapeHtml(data.joinUrl)}" style="color:#7c3aed">${escapeHtml(data.joinUrl)}</a></div>` +
      (data.passwordProtected
        ? '<div style="margin-top:12px;font-size:13px;color:#92400e;background:#fef3c7;border-radius:8px;padding:8px 12px">This stream is password-protected — ask the host for the password.</div>'
        : '') +
      '<div style="margin-top:20px;font-size:12px;color:#6b7280;line-height:1.5">Open the link in Chrome, Edge or Safari a few minutes early and allow camera and microphone access. Headphones are recommended. A calendar file is attached so you can add this to your calendar.</div>';

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#2e1065;background-image:linear-gradient(135deg,#2e1065,#7c3aed);padding:22px 28px;color:#ffffff">
<div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.8">StreamBird</div>
<div style="font-size:22px;font-weight:700;margin-top:6px;line-height:1.25">${escapeHtml(headline(data))}</div>
</td></tr>
<tr><td style="padding:24px 28px 28px">
<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#111827">${intro}</p>
<table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>
${data.description && !cancelled ? block('About', data.description) : ''}
${data.notes && !cancelled ? block(`Note from ${data.hostName}`, data.notes) : ''}
${watch}
${button}
</td></tr></table>
<div style="font-size:11px;color:#9ca3af;margin-top:14px">Sent via StreamBird on behalf of ${escapeHtml(data.hostName)}</div>
</td></tr></table></body></html>`;

  const subjectPrefix = cancelled ? 'Cancelled' : data.kind === 'update' ? 'Updated' : 'Invitation';
  return {
    subject: `${subjectPrefix}: ${data.title} — ${formatWhen(data.startsAt, data.timezone)}`,
    html,
    text: buildInvitationText(data),
    ics: buildIcs(data),
  };
}
