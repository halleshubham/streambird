import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { DatabaseModule } from './config/database.module';
import { CommonModule } from './common/common.module';
import { AccountsModule } from './accounts/accounts.module';
import { PlatformConnectionsModule } from './platform-connections/platform-connections.module';
import { StreamsModule } from './streams/streams.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    DatabaseModule,
    CommonModule,
    AccountsModule,
    PlatformConnectionsModule,
    StreamsModule,
  ],
})
export class AppModule {}
