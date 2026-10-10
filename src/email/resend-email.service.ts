import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { EmailService, PaymentReceiptData } from './email.interface';
import { StreamInviteData, buildStreamInviteEmail } from './stream-invite.template';
import { PendingApprovalsDigestData, buildApprovalDigest } from './approval-digest.template';
import { ApprovalDecisionData, buildApprovalDecisionEmail } from './approval-decision.template';
import { buildLoginCodeEmail } from './login-code.template';
import { buildTeamInviteEmail } from './team-invite.template';
import { buildPaymentReceiptEmail } from './payment-receipt.template';

@Injectable()
export class ResendEmailService implements EmailService {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /** One place for the Resend call, so every mail is sent the same way (same sender, same auth). */
  private async send(payload: { to: string; subject: string; text: string; html?: string }): Promise<void> {
    const apiKey = this.config.get<string>('resendApiKey');
    const from = this.config.get<string>('emailFrom');
    await firstValueFrom(this.http.post('https://api.resend.com/emails', { from, ...payload }, { headers: { Authorization: `Bearer ${apiKey}` } }));
  }

  private baseUrl(): string | undefined {
    return this.config.get<string>('publicBaseUrl');
  }

  async sendLoginCode(to: string, code: string): Promise<void> {
    await this.send({ to, ...buildLoginCodeEmail({ code, baseUrl: this.baseUrl() }) });
  }

  async sendPaymentReceipt(to: string, data: PaymentReceiptData): Promise<void> {
    await this.send({ to, ...buildPaymentReceiptEmail({ ...data, baseUrl: this.baseUrl() }) });
  }

  async sendPendingApprovalsDigest(to: string, data: PendingApprovalsDigestData): Promise<void> {
    await this.send({ to, ...buildApprovalDigest({ ...data, baseUrl: data.baseUrl ?? this.baseUrl() }) });
  }

  async sendApprovalDecision(to: string, data: ApprovalDecisionData): Promise<void> {
    // The same sender as login codes.
    await this.send({ to, ...buildApprovalDecisionEmail({ ...data, baseUrl: data.baseUrl ?? this.baseUrl() }) });
  }

  async sendBillingNotice(to: string, subject: string, text: string): Promise<void> {
    await this.send({ to, subject, text });
  }

  async sendTeamInvite(to: string, companyName: string): Promise<void> {
    await this.send({ to, ...buildTeamInviteEmail({ companyName, baseUrl: this.baseUrl() }) });
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
