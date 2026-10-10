import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { EmailService, PaymentReceiptData } from './email.interface';
import { StreamInviteData, buildStreamInviteEmail } from './stream-invite.template';
import { PendingApprovalsDigestData, buildApprovalDigest } from './approval-digest.template';

@Injectable()
export class ResendEmailService implements EmailService {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async sendLoginCode(to: string, code: string): Promise<void> {
    const apiKey = this.config.get<string>('resendApiKey');
    const from = this.config.get<string>('emailFrom');

    await firstValueFrom(
      this.http.post(
        'https://api.resend.com/emails',
        {
          from,
          to,
          subject: `${code} is your StreamBird login code`,
          text: `Your StreamBird login code is ${code}. It expires in 10 minutes.`,
        },
        { headers: { Authorization: `Bearer ${apiKey}` } },
      ),
    );
  }

  async sendPaymentReceipt(to: string, data: PaymentReceiptData): Promise<void> {
    const apiKey = this.config.get<string>('resendApiKey');
    const from = this.config.get<string>('emailFrom');
    const until = data.validUntil.toUTCString();
    await firstValueFrom(
      this.http.post(
        'https://api.resend.com/emails',
        {
          from,
          to,
          subject: `Payment received -- StreamBird ${data.planName}`,
          text: [
            `Thanks! We received ₹${data.amountInr.toLocaleString('en-IN')} for StreamBird ${data.planName}${data.kind === 'day_pass' ? ' (day pass)' : ''}.`,
            '',
            `Active until: ${until}`,
            `Payment reference: ${data.paymentId}`,
            '',
            'Questions or need a GST invoice? Reply to this email or write to support@shackyapps.in.',
          ].join('\n'),
        },
        { headers: { Authorization: `Bearer ${apiKey}` } },
      ),
    );
  }

  async sendPendingApprovalsDigest(to: string, data: PendingApprovalsDigestData): Promise<void> {
    const apiKey = this.config.get<string>('resendApiKey');
    const from = this.config.get<string>('emailFrom');
    const { subject, text, html } = buildApprovalDigest(data);
    await firstValueFrom(
      this.http.post('https://api.resend.com/emails', { from, to, subject, text, html }, { headers: { Authorization: `Bearer ${apiKey}` } }),
    );
  }

  async sendBillingNotice(to: string, subject: string, text: string): Promise<void> {
    const apiKey = this.config.get<string>('resendApiKey');
    const from = this.config.get<string>('emailFrom');
    await firstValueFrom(
      this.http.post('https://api.resend.com/emails', { from, to, subject, text }, { headers: { Authorization: `Bearer ${apiKey}` } }),
    );
  }

  async sendTeamInvite(to: string, companyName: string): Promise<void> {
    const apiKey = this.config.get<string>('resendApiKey');
    const from = this.config.get<string>('emailFrom');

    await firstValueFrom(
      this.http.post(
        'https://api.resend.com/emails',
        {
          from,
          to,
          subject: `You've been invited to join ${companyName} on StreamBird`,
          text: `You've been added to ${companyName}'s StreamBird account. Log in at any time with this email address to get started -- no separate invite link needed.`,
        },
        { headers: { Authorization: `Bearer ${apiKey}` } },
      ),
    );
  }

  async sendStreamInvite(to: string, data: StreamInviteData): Promise<void> {
    const apiKey = this.config.get<string>('resendApiKey');
    const from = this.config.get<string>('emailFrom');
    const email = buildStreamInviteEmail(data);
    const cancelled = data.kind === 'cancelled';

    await firstValueFrom(
      this.http.post(
        'https://api.resend.com/emails',
        {
          from,
          to,
          subject: email.subject,
          html: email.html,
          text: email.text,
          attachments: [
            {
              filename: cancelled ? 'cancelled.ics' : 'invite.ics',
              content: Buffer.from(email.ics, 'utf8').toString('base64'),
              content_type: `text/calendar; charset=utf-8; method=${cancelled ? 'CANCEL' : 'REQUEST'}`,
            },
          ],
        },
        { headers: { Authorization: `Bearer ${apiKey}` } },
      ),
    );
  }
}
