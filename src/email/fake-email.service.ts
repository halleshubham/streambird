import { Injectable, Logger } from '@nestjs/common';
import { EmailService, PaymentReceiptData } from './email.interface';
import { StreamInviteData } from './stream-invite.template';
import { PendingApprovalsDigestData } from './approval-digest.template';
import { ApprovalDecisionData } from './approval-decision.template';

/**
 * Logs the code instead of sending it. Default outside production so
 * local dev and CI never need a real Resend API key — mirrors
 * FakeRelayProvider's role for CloudflareRelayService/MuxRelayService.
 */
@Injectable()
export class FakeEmailService implements EmailService {
  private readonly logger = new Logger(FakeEmailService.name);

  async sendLoginCode(to: string, code: string): Promise<void> {
    this.logger.log(`[fake email] login code for ${to}: ${code}`);
  }

  async sendTeamInvite(to: string, companyName: string): Promise<void> {
    this.logger.log(`[fake email] ${to} invited to join ${companyName} on StreamBird`);
  }

  async sendStreamInvite(to: string, data: StreamInviteData): Promise<void> {
    this.logger.log(`[fake email] ${data.kind} for "${data.title}" to ${to}: ${data.joinUrl}`);
  }

  async sendPaymentReceipt(to: string, data: PaymentReceiptData): Promise<void> {
    this.logger.log(`[fake email] receipt to ${to}: ${data.planName} Rs${data.amountInr}, valid until ${data.validUntil.toISOString()}`);
  }

  async sendBillingNotice(to: string, subject: string): Promise<void> {
    this.logger.log(`[fake email] billing notice to ${to}: ${subject}`);
  }

  async sendPendingApprovalsDigest(to: string, data: PendingApprovalsDigestData): Promise<void> {
    this.logger.log(`[fake email] approvals digest to ${to}: ${data.totalPending} waiting (${data.newSinceLast} new)`);
  }

  async sendApprovalDecision(to: string, data: ApprovalDecisionData): Promise<void> {
    this.logger.log(`[fake email] sign-up ${data.decision} notice to ${to}`);
  }
}
