import { StreamInviteData } from './stream-invite.template';
import { PendingApprovalsDigestData } from './approval-digest.template';
import { ApprovalDecisionData } from './approval-decision.template';

export interface PaymentReceiptData {
  planName: string;
  kind: 'plan' | 'day_pass';
  amountInr: number;
  paymentId: string;
  /** When the plan period / day pass ends. */
  validUntil: Date;
}

export const EMAIL_SERVICE = Symbol('EMAIL_SERVICE');

export interface EmailService {
  sendLoginCode(to: string, code: string): Promise<void>;
  /** Sent when a Company Admin invites a Normal User -- see
   * TeamService.invite. Deliberately plain/simple, consistent with
   * sendLoginCode: no separate invite-acceptance token, since the
   * invitee just logs in normally (magic-code or Google) with the
   * invited email and lands straight in their new company. */
  sendTeamInvite(to: string, companyName: string): Promise<void>;
  /** Guest invite / schedule-change / cancellation for a scheduled stream
   * (HTML + plaintext + .ics calendar attachment -- see stream-invite.template). */
  sendStreamInvite(to: string, data: StreamInviteData): Promise<void>;
  /** Receipt after a successful Razorpay payment. Best-effort: callers never fail a payment over it. */
  sendPaymentReceipt(to: string, data: PaymentReceiptData): Promise<void>;
  /** Plain billing notice (autopay failed, autopay cancelled...). Best-effort. */
  sendBillingNotice(to: string, subject: string, text: string): Promise<void>;
  /** One consolidated "accounts waiting for approval" email to the superadmin (see ApprovalDigestService). */
  sendPendingApprovalsDigest(to: string, data: PendingApprovalsDigestData): Promise<void>;
  /** Tells a user their sign-up was approved ("studio is ready") or declined. Best-effort: never fails the approval itself. */
  sendApprovalDecision(to: string, data: ApprovalDecisionData): Promise<void>;
}
