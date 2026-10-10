import { of } from 'rxjs';
import { ResendEmailService } from './resend-email.service';

function build() {
  const post = jest.fn(() => of({ data: {} }));
  const cfg: Record<string, string> = { resendApiKey: 're_test_key', emailFrom: 'StreamBird <login@streambird.test>', publicBaseUrl: 'https://streambird.test' };
  const service = new ResendEmailService({ post } as any, { get: (k: string) => cfg[k] } as any);
  const sent = () => post.mock.calls.map(([url, body, opts]: any[]) => ({ url, body, opts }));
  return { service, sent };
}

describe('ResendEmailService', () => {
  it('sends every mail from the same sender with the API key, as HTML plus a plain-text alternative', async () => {
    const { service, sent } = build();
    await service.sendLoginCode('a@x.test', '123456');
    await service.sendTeamInvite('b@x.test', 'Acme');
    await service.sendPaymentReceipt('c@x.test', { planName: 'Pro', kind: 'plan', amountInr: 1999, paymentId: 'pay_1', validUntil: new Date('2026-11-09T12:00:00Z') });
    await service.sendApprovalDecision('d@x.test', { decision: 'approved', loginUrl: 'https://streambird.test/login' });
    await service.sendPendingApprovalsDigest('e@x.test', { users: [], totalPending: 1, newSinceLast: 1, adminUrl: 'https://streambird.test/admin' });

    const calls = sent();
    expect(calls).toHaveLength(5);
    for (const c of calls) {
      expect(c.url).toBe('https://api.resend.com/emails');
      expect(c.opts.headers.Authorization).toBe('Bearer re_test_key');
      expect(c.body.from).toBe('StreamBird <login@streambird.test>');
      expect(c.body.html).toContain('<!doctype html>');
      expect(c.body.text.length).toBeGreaterThan(20);
    }
    expect(calls[0].body.subject).toBe('123456 is your StreamBird login code');
    expect(calls[1].body.to).toBe('b@x.test');
  });

  it('uses the configured site address for the logo and links', async () => {
    const { service, sent } = build();
    await service.sendTeamInvite('b@x.test', 'Acme');
    await service.sendLoginCode('a@x.test', '123456');
    expect(sent()[0].body.html).toContain('https://streambird.test/icon-192.png');
    expect(sent()[0].body.html).toContain('href="https://streambird.test/login"');
    expect(sent()[1].body.html).toContain('https://streambird.test/icon-192.png');
  });

  it('keeps the plain billing notice plain (text only)', async () => {
    const { service, sent } = build();
    await service.sendBillingNotice('a@x.test', 'Autopay failed', 'Please update your payment method.');
    expect(sent()[0].body).toMatchObject({ to: 'a@x.test', subject: 'Autopay failed', text: 'Please update your payment method.' });
    expect(sent()[0].body.html).toBeUndefined();
  });
});
