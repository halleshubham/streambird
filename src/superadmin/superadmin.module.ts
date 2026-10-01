import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Account } from '../accounts/entities/account.entity';
import { Company } from '../companies/entities/company.entity';
import { LiveStream } from '../streams/entities/live-stream.entity';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { UsersModule } from '../users/users.module';
import { AccountsModule } from '../accounts/accounts.module';
import { CommonModule } from '../common/common.module';
import { SuperadminSeedService } from './superadmin-seed.service';
import { SuperadminController } from './superadmin.controller';
import { SuperadminAccountsController } from './superadmin-accounts.controller';
import { SuperadminAccountsService } from './superadmin-accounts.service';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Account, Company, LiveStream, PlatformConnection]),
    UsersModule,
    AccountsModule,
    CommonModule,
    AuditLogModule,
  ],
  controllers: [SuperadminController, SuperadminAccountsController],
  providers: [SuperadminSeedService, SuperadminAccountsService],
})
export class SuperadminModule {}
