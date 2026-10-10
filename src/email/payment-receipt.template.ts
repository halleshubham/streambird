import { BRAND, brandedEmail, escapeHtml } from './brand-email';
import type { PaymentReceiptData } from './email.interface';

export interface PaymentReceiptEmailData extends PaymentReceiptData {
  /** Public origin of the site; the dashboard link and the logo hang off it. Defaults to https://streambird.app. */
  baseUrl?: string;
}

/** "10 Nov 2026, 5:30 pm IST": what the customer (an Indian payer) reads, not a UTC string. */
function ist(d: Date): string {
  return `${d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })} IST`;
}

const row = (label: string, value: string, last = false): string =>
  `<tr><td style="padding:9px 14px;${last ? '' : `border-bottom:1px solid ${BRAND.softBorder};`}font-size:13px;color:${BRAND.muted};white-space:nowrap">${label}</td>` +
  `<td align="right" style="padding:9px 14px;${last ? '' : `border-bottom:1px solid ${BRAND.softBorder};`}font-size:14px;font-weight:700;color:${BRAND.ink}">${value}</td></tr>`;

/** The receipt after a successful Razorpay payment. */
export function buildPaymentReceiptEmail(data: PaymentReceiptEmailData): { subject: string; text: string; html: string } {
  const base = (data.baseUrl ?? 'https://streambird.app').replace(/\/$/, '');
  const amount = `₹${data.amountInr.toLocaleString('en-IN')}`;
  const what = `${data.planName}${data.kind === 'day_pass' ? ' (day pass)' : ''}`;
  return {
    subject: `Payment received -- StreamBird ${data.planName}`,
    text: [
      `Thanks! We received ${amount} for StreamBird ${what}.`,
      '',
      `Active until: ${data.validUntil.toUTCString()}`,
      `Payment reference: ${data.paymentId}`,
      '',
      'Questions or need a GST invoice? Reply to this email or write to support@shackyapps.in.',
    ].join('\n'),
    html: brandedEmail({
      baseUrl: data.baseUrl,
      preheader: `We received ${amount} for StreamBird ${what}.`,
      badge: 'PAYMENT RECEIVED',
      headline: 'Thank you!',
      accent: "You're all set.",
      bodyHtml:
        `<p style="margin:0 0 14px">We received your payment. Your plan is active and ready to use.</p>` +
        `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${BRAND.soft};border:1px solid ${BRAND.softBorder};border-radius:12px">` +
        row('Plan', escapeHtml(what)) +
        row('Amount paid', `<span style="font-size:18px;color:${BRAND.violetDark}">${escapeHtml(amount)}</span>`) +
        row('Active until', escapeHtml(ist(data.validUntil))) +
        row('Payment reference', `<span style="font-family:Consolas,'Liberation Mono',monospace;font-size:12px">${escapeHtml(data.paymentId)}</span>`, true) +
        `</table>` +
        `<p style="margin:14px 0 0;font-size:13px;color:#8a87a0">Keep this email as your receipt. Need a GST invoice? Reply to this email or write to <a href="mailto:support@shackyapps.in" style="color:${BRAND.violet};font-weight:700">support@shackyapps.in</a>.</p>`,
      cta: { label: 'Go to your dashboard', url: `${base}/dashboard` },
      supportEmail: 'support@shackyapps.in',
    }),
  };
}
