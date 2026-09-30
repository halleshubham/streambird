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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'web'),
      serveRoot: '/studio',
    }),
    DatabaseModule,
    CommonModule,
    AccountsModule,
    PlatformConnectionsModule,
    StreamsModule,
    StudioModule,
  ],
})
export class AppModule {}
