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
}
