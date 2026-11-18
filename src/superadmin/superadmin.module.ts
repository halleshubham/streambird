import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Account } from '../accounts/entities/account.entity';
import { Company } from '../companies/entities/company.entity';
import { LiveStream } from '../streams/entities/live-stream.entity';
import { LiveStreamDestination } from '../streams/entities/live-stream-destination.entity';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { UsersModule } from '../users/users.module';
import { AccountsModule } from '../accounts/accounts.module';
import { CommonModule } from '../common/common.module';
import { SuperadminSeedService } from './superadmin-seed.service';
import { ApprovalDigestService } from './approval-digest.service';
import { AppSetting } from '../billing/entities/app-setting.entity';
import { EmailModule } from '../email/email.module';
import { SuperadminController } from './superadmin.controller';
import { SuperadminAnalyticsController } from './superadmin-analytics.controller';
import { SuperadminAnalyticsService } from './superadmin-analytics.service';
import { SuperadminUsersController } from './superadmin-users.controller';
import { SuperadminAccountsController } from './superadmin-accounts.controller';
import { SuperadminAccountsService } from './superadmin-accounts.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StreamsModule } from '../streams/streams.module';
import { AssetsModule } from '../assets/assets.module';
import { Asset } from '../assets/entities/asset.entity';
import { BrandKit } from '../assets/entities/brand-kit.entity';
import { BrandKitAd } from '../assets/entities/brand-kit-ad.entity';
import { SuperadminBrandKitsController } from './superadmin-brand-kits.controller';
import { SuperadminBrandKitsService } from './superadmin-brand-kits.service';
import { PlansModule } from '../plans/plans.module';
import { SuperadminPlansController } from './superadmin-plans.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Account, Company, LiveStream, LiveStreamDestination, PlatformConnection, AppSetting, Asset, BrandKit, BrandKitAd]),
    EmailModule,
    UsersModule,
    AccountsModule,
    CommonModule,
    AuditLogModule,
    StreamsModule,
    PlansModule,
    AssetsModule,
  ],
  controllers: [
    SuperadminController,
    SuperadminAnalyticsController,
    SuperadminUsersController,
    SuperadminAccountsController,
    SuperadminPlansController,
    SuperadminBrandKitsController,
  ],
  providers: [SuperadminSeedService, SuperadminAnalyticsService, SuperadminAccountsService, SuperadminBrandKitsService, ApprovalDigestService],
})
export class SuperadminModule {}
