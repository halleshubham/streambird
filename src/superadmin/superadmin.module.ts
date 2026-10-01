import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { AccountsModule } from '../accounts/accounts.module';
import { Account } from '../accounts/entities/account.entity';
import { LiveStream } from '../streams/entities/live-stream.entity';
import { LiveStreamDestination } from '../streams/entities/live-stream-destination.entity';
import { CommonModule } from '../common/common.module';
import { SuperadminSeedService } from './superadmin-seed.service';
import { SuperadminController } from './superadmin.controller';
import { SuperadminAnalyticsController } from './superadmin-analytics.controller';
import { SuperadminAnalyticsService } from './superadmin-analytics.service';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Account, LiveStream, LiveStreamDestination]),
    UsersModule,
    AccountsModule,
    CommonModule,
    AuditLogModule,
  ],
  controllers: [SuperadminController, SuperadminAnalyticsController],
  providers: [SuperadminSeedService, SuperadminAnalyticsService],
})
export class SuperadminModule {}
