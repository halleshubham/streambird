import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { LiveStream } from '../streams/entities/live-stream.entity';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { CommonModule } from '../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { StreamsModule } from '../streams/streams.module';
import { PlatformConnectionsModule } from '../platform-connections/platform-connections.module';
import { AssetsModule } from '../assets/assets.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { EmailModule } from '../email/email.module';
import { AccountDeletionService } from './account-deletion.service';
import { AccountDeletionController } from './account-deletion.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, LiveStream, PlatformConnection]),
    CommonModule,
    AuthModule,
    BillingModule,
    StreamsModule,
    PlatformConnectionsModule,
    AssetsModule,
    AuditLogModule,
    EmailModule,
  ],
  providers: [AccountDeletionService],
  controllers: [AccountDeletionController],
})
export class AccountDeletionModule {}
