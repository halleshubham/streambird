import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EncryptionModule } from '../encryption/encryption.module';
import { AuthModule } from '../auth/auth.module';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { TwitchProvider } from './twitch/twitch.provider';
import { YouTubeProvider } from './youtube/youtube.provider';
import { FacebookProvider } from './facebook/facebook.provider';
import { STREAM_PROVIDERS } from './provider.tokens';
import { StreamProvider } from './stream-provider.interface';

@Module({
  imports: [
    HttpModule,
    EncryptionModule,
    AuthModule, // YouTubeProvider needs GoogleOAuthService for token refresh
    TypeOrmModule.forFeature([PlatformConnection]), // YouTubeProvider persists refreshed tokens back onto the connection row
  ],
  providers: [
    TwitchProvider,
    YouTubeProvider,
    FacebookProvider,
    {
      provide: STREAM_PROVIDERS,
      useFactory: (
        twitch: TwitchProvider,
        youtube: YouTubeProvider,
        facebook: FacebookProvider,
      ): StreamProvider[] => [twitch, youtube, facebook],
      inject: [TwitchProvider, YouTubeProvider, FacebookProvider],
    },
  ],
  exports: [STREAM_PROVIDERS],
})
export class ProvidersModule {}
