import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { EmailService } from './email.interface';

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
}
