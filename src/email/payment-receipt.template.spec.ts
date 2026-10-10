import { buildPaymentReceiptEmail } from './payment-receipt.template';

const base = { planName: 'Pro', kind: 'plan' as const, amountInr: 1999, paymentId: 'pay_ABC123', validUntil: new Date('2026-11-09T12:00:00Z') };

describe('buildPaymentReceiptEmail', () => {
  it('keeps the subject and the plain text, and shows plan, amount, end date and reference in the HTML', () => {
    const { subject, text, html } = buildPaymentReceiptEmail({ ...base, baseUrl: 'https://streambird.test' });
    expect(subject).toBe('Payment received -- StreamBird Pro');
    expect(text).toContain('We received ₹1,999 for StreamBird Pro.');
    expect(text).toContain('Active until: Mon, 09 Nov 2026 12:00:00 GMT');
    expect(text).toContain('Payment reference: pay_ABC123');
    expect(html).toContain('PAYMENT RECEIVED');
    expect(html).toContain('₹1,999');
    expect(html).toContain('pay_ABC123');
    expect(html).toContain('href="https://streambird.test/dashboard"');
  });

  it('shows the end date in Indian time, not UTC', () => {
    const { html } = buildPaymentReceiptEmail(base);
    expect(html).toMatch(/9 Nov 2026, 5:30\s?pm IST/i);
  });

  it('names a day pass as one, and uses Indian digit grouping for big amounts', () => {
    const { text, html } = buildPaymentReceiptEmail({ ...base, planName: 'Day Pass', kind: 'day_pass', amountInr: 199 });
    expect(text).toContain('for StreamBird Day Pass (day pass).');
    expect(html).toContain('Day Pass (day pass)');
    expect(buildPaymentReceiptEmail({ ...base, amountInr: 123456 }).html).toContain('₹1,23,456');
  });

  it('escapes the payment reference and plan name', () => {
    const { html } = buildPaymentReceiptEmail({ ...base, planName: '<i>Pro</i>', paymentId: 'pay_<x>' });
    expect(html).not.toContain('<i>Pro</i>');
    expect(html).not.toContain('pay_<x>');
  });
});
