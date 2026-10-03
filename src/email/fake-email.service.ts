import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from './email.interface';
import { StreamInviteData } from './stream-invite.template';

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
}
