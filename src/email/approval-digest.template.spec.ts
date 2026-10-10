import { buildApprovalDigest } from './approval-digest.template';

const NOW = new Date('2026-10-10T12:00:00Z');
const row = (over: Partial<{ email: string; role: string; companyName: string | null; createdAt: Date }> = {}) => ({
  email: 'new@user.test',
  role: 'user',
  companyName: null,
  createdAt: new Date('2026-10-10T09:00:00Z'),
  ...over,
});

describe('buildApprovalDigest', () => {
  it('says how many are waiting and how long, in subject, text and HTML', () => {
    const { subject, text, html } = buildApprovalDigest({ users: [row()], totalPending: 1, newSinceLast: 1, adminUrl: 'https://x.test/admin', now: NOW });
    expect(subject).toBe('StreamBird: 1 account is waiting for approval');
    expect(text).toContain('new@user.test (Solo user) signed up 2026-10-10 09:00 UTC, waiting 3 h');
    expect(text).toContain('1 waiting in total, 1 new since the last email.');
    expect(text).toContain('Approve or reject: https://x.test/admin');
    expect(html).toContain('href="https://x.test/admin"');
  });

  it('pluralises, names company admins and their company, and reports none new', () => {
    const { subject, text } = buildApprovalDigest({
      users: [row({ role: 'company_admin', companyName: 'Acme Ltd' }), row({ email: 'b@user.test' })],
      totalPending: 2,
      newSinceLast: 0,
      adminUrl: 'https://x.test/admin',
      now: NOW,
    });
    expect(subject).toBe('StreamBird: 2 accounts are waiting for approval');
    expect(text).toContain('(Company admin, Acme Ltd)');
    expect(text).toContain('none new since the last email');
  });

  it('mentions the accounts beyond the listed rows', () => {
    const { text } = buildApprovalDigest({ users: [row()], totalPending: 75, newSinceLast: 5, adminUrl: 'https://x.test/admin', now: NOW });
    expect(text).toContain('…and 74 more in the admin console.');
  });

  it('escapes anything a user typed before it goes into the HTML', () => {
    const { html } = buildApprovalDigest({
      users: [row({ email: 'a"b@x.test', role: 'company_admin', companyName: '<script>alert(1)</script> & Co' })],
      totalPending: 1,
      newSinceLast: 1,
      adminUrl: 'https://x.test/admin',
      now: NOW,
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; Co');
    expect(html).toContain('a&quot;b@x.test');
  });

  it('shows waiting time in minutes, hours and days', () => {
    const ago = (ms: number) => new Date(NOW.getTime() - ms);
    const { text } = buildApprovalDigest({
      users: [row({ email: 'm@x.test', createdAt: ago(20 * 60_000) }), row({ email: 'h@x.test', createdAt: ago(30 * 3_600_000) }), row({ email: 'd@x.test', createdAt: ago(72 * 3_600_000) })],
      totalPending: 3,
      newSinceLast: 3,
      adminUrl: 'u',
      now: NOW,
    });
    expect(text).toContain('waiting 20 min');
    expect(text).toContain('waiting 30 h');
    expect(text).toContain('waiting 3 days');
  });
});
