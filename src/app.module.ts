import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import configuration from './config/configuration';
import { DatabaseModule } from './config/database.module';
import { CommonModule } from './common/common.module';
import { AccountsModule } from './accounts/accounts.module';
import { PlatformConnectionsModule } from './platform-connections/platform-connections.module';
import { StreamsModule } from './streams/streams.module';
import { StudioModule } from './studio/studio.module';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'web'),
      serveRoot: '/studio',
    }),
    // The React SPA build (see web-app/, built to dist-web/ by the
    // Dockerfile's web-builder stage). Its own client-side routes (e.g.
    // /streams/new) fall through to index.html via this module's standard
    // SPA-fallback behavior for any unmatched, non-excluded GET -- which is
    // exactly why every real API route lives under /api (see main.ts's
    // setGlobalPrefix) and /studio's static files are excluded here too.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'dist-web'),
      exclude: ['/api/(.*)', '/studio/(.*)', '/health'],
    }),
    DatabaseModule,
    CommonModule,
    AccountsModule,
    PlatformConnectionsModule,
    StreamsModule,
    StudioModule,
    AuthModule,
  ],
})
export class AppModule {}
