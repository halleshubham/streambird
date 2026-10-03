import { StreamInviteData, buildIcs, buildInvitationText, buildStreamInviteEmail, formatWhen } from './stream-invite.template';

const base: StreamInviteData = {
  kind: 'invite',
  streamId: '11111111-1111-4111-8111-111111111111',
  title: 'Product launch Q&A',
  description: 'Live walkthrough of the new release',
  notes: 'Please join 10 minutes early.',
  startsAt: new Date('2026-10-10T13:00:00Z'),
  timezone: 'Asia/Kolkata',
  durationMinutes: 90,
  hostName: 'Acme Studio',
  joinUrl: 'https://streambird.example.com/join/abc123',
  passwordProtected: false,
  platforms: ['Youtube', 'Twitch'],
};

describe('stream invite template', () => {
  it('renders the start time in the host timezone', () => {
    expect(formatWhen(base.startsAt, 'Asia/Kolkata')).toContain('6:30 PM');
    expect(formatWhen(base.startsAt, 'Asia/Kolkata')).toContain('October 10, 2026');
    // An unknown zone must not throw (falls back to UTC).
    expect(formatWhen(base.startsAt, 'Not/AZone')).toContain('1:00 PM');
  });

  it('plaintext invitation includes every relevant detail and the join link', () => {
    const text = buildInvitationText(base);
    expect(text).toContain('You\'re invited to join "Product launch Q&A" as a guest.');
    expect(text).toContain('When: ');
    expect(text).toContain('Duration: about 1 h 30 min');
    expect(text).toContain('Host: Acme Studio');
    expect(text).toContain('Streaming live to: Youtube, Twitch');
    expect(text).toContain('About: Live walkthrough of the new release');
    expect(text).toContain('Note from Acme Studio: Please join 10 minutes early.');
    expect(text).toContain('Join link: https://streambird.example.com/join/abc123');
    expect(text).not.toContain('Password');
  });

  it('mentions the password requirement without ever including a password', () => {
    expect(buildInvitationText({ ...base, passwordProtected: true })).toContain('Password: required');
  });

  it('HTML email escapes user-supplied content', () => {
    const { html } = buildStreamInviteEmail({
      ...base,
      title: '<script>alert(1)</script>',
      hostName: 'A "quoted" <b>host</b>',
      notes: '<img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;host&lt;/b&gt;');
  });

  it('HTML email has the join button and a subject carrying title + time', () => {
    const email = buildStreamInviteEmail(base);
    expect(email.html).toContain('href="https://streambird.example.com/join/abc123"');
    expect(email.html).toContain('Join the stream');
    expect(email.subject).toMatch(/^Invitation: Product launch Q&A — /);
  });

  it('update and cancelled variants say so, and cancelled has no join link', () => {
    expect(buildStreamInviteEmail({ ...base, kind: 'update' }).subject).toMatch(/^Updated: /);

    const cancelled = buildStreamInviteEmail({ ...base, kind: 'cancelled' });
    expect(cancelled.subject).toMatch(/^Cancelled: /);
    expect(cancelled.html).not.toContain('Join the stream');
    expect(cancelled.text).toContain('has cancelled');
    expect(cancelled.text).not.toContain('abc123');
    expect(cancelled.ics).toContain('METHOD:CANCEL');
    expect(cancelled.ics).toContain('STATUS:CANCELLED');
  });

  it('builds a valid .ics with UTC times, escaped text and a stable UID', () => {
    const ics = buildIcs({ ...base, title: 'Q&A; part 1, live', description: 'line1\nline2' }, new Date('2026-10-01T00:00:00Z'));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('UID:11111111-1111-4111-8111-111111111111@streambird');
    expect(ics).toContain('DTSTART:20261010T130000Z');
    expect(ics).toContain('DTEND:20261010T143000Z'); // +90 min
    expect(ics).toContain('SUMMARY:Q&A\; part 1\\, live');
    expect(ics).toContain('line1\\nline2');
    // Folded lines never exceed 75 octets.
    for (const line of ics.split('\r\n')) expect(line.length).toBeLessThanOrEqual(75);
  });

  it('defaults the calendar duration to an hour when none was set', () => {
    expect(buildIcs({ ...base, durationMinutes: null })).toContain('DTEND:20261010T140000Z');
  });
});
