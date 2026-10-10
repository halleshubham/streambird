import { SUPPORT_EMAIL, buildApprovalDecisionEmail } from './approval-decision.template';

describe('buildApprovalDecisionEmail', () => {
  it('approval: says the studio is ready and links to the login page', () => {
    const { subject, text, html } = buildApprovalDecisionEmail({ decision: 'approved', loginUrl: 'https://streambird.test/login' });
    expect(subject).toBe('Your StreamBird studio is ready');
    expect(text).toContain('https://streambird.test/login');
    expect(html).toContain('href="https://streambird.test/login"');
    expect(html).toContain('Log in to StreamBird');
    expect(html).toContain('STUDIO READY');
    expect(html).toContain('/icon-192.png');
    expect(text).toContain(SUPPORT_EMAIL);
  });

  it('rejection: polite, gives no reason, no login link, and points to support', () => {
    const { subject, text, html } = buildApprovalDecisionEmail({ decision: 'rejected', loginUrl: 'https://streambird.test/login' });
    expect(subject).toBe('About your StreamBird sign-up');
    expect(text).toContain("not able to set up an account");
    expect(text).toContain(SUPPORT_EMAIL);
    expect(text).not.toContain('/login');
    expect(html).not.toContain('Log in to StreamBird');
    expect(html).toContain(`mailto:${SUPPORT_EMAIL}`);
  });
});
