import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EMAIL_SERVICE } from './email.interface';
import { FakeEmailService } from './fake-email.service';
import { ResendEmailService } from './resend-email.service';

@Module({
  imports: [HttpModule, ConfigModule],
  providers: [
    FakeEmailService,
    ResendEmailService,
    {
      provide: EMAIL_SERVICE,
      inject: [ConfigService, FakeEmailService, ResendEmailService],
      useFactory: (config: ConfigService, fake: FakeEmailService, resend: ResendEmailService) =>
        config.get<string>('nodeEnv') === 'production' ? resend : fake,
    },
  ],
  exports: [EMAIL_SERVICE],
})
export class EmailModule {}
