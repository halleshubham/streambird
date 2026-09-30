import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EncryptionModule } from '../encryption/encryption.module';
import { TwitchProvider } from './twitch/twitch.provider';
import { STREAM_PROVIDERS } from './provider.tokens';
import { StreamProvider } from './stream-provider.interface';

@Module({
  imports: [HttpModule, EncryptionModule],
  providers: [
    TwitchProvider,
    {
      provide: STREAM_PROVIDERS,
      useFactory: (twitch: TwitchProvider): StreamProvider[] => [twitch],
      inject: [TwitchProvider],
    },
  ],
  exports: [STREAM_PROVIDERS],
})
export class ProvidersModule {}
