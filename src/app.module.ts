import { PlansModule } from './plans/plans.module';
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
import { TeamModule } from './team/team.module';
import { SuperadminModule } from './superadmin/superadmin.module';
import { AppController } from './app.controller';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    // The React SPA build (see web-app/, built to dist-web/ by the
    // Dockerfile's web-builder stage). Its own client-side routes (e.g.
    // /streams/new, /streams/:id/studio, /join/:token) fall through to
    // index.html via this module's standard SPA-fallback behavior for any
    // unmatched, non-excluded GET -- which is exactly why every real API
    // route lives under /api (see main.ts's setGlobalPrefix). maxAge: 0 --
    // serve-static's default (4h) bit us once already: a fixed bug wasn't
    // visible to a browser that had cached the old copy, and the same risk
    // applies to index.html pointing at a hashed asset filename a later
    // deploy has removed. ETag/Last-Modified conditional requests still
    // keep re-fetches cheap (a 304 when nothing changed), so this doesn't
    // mean re-downloading on every load, just always re-validating.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'dist-web'),
      exclude: ['/api/(.*)', '/health'],
      serveStaticOptions: { maxAge: 0 },
    }),
    DatabaseModule,
    CommonModule,
    AccountsModule,
    PlansModule,
    PlatformConnectionsModule,
    StreamsModule,
    StudioModule,
    AuthModule,
    TeamModule,
    SuperadminModule,
  ],
})
export class AppModule {}
