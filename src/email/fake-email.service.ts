import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from './email.interface';

/**
 * Logs the code instead of sending it. Default outside production so
 * local dev and CI never need a real Resend API key — mirrors
 * FakeCloudflareRelay's role for CloudflareRelayService.
 */
@Injectable()
export class FakeEmailService implements EmailService {
  private readonly logger = new Logger(FakeEmailService.name);

  async sendLoginCode(to: string, code: string): Promise<void> {
    this.logger.log(`[fake email] login code for ${to}: ${code}`);
  }
}
