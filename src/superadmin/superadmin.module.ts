import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { AccountsModule } from '../accounts/accounts.module';
import { CommonModule } from '../common/common.module';
import { SuperadminSeedService } from './superadmin-seed.service';
import { SuperadminController } from './superadmin.controller';
import { SuperadminUsersController } from './superadmin-users.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    UsersModule,
    AccountsModule,
    CommonModule,
    AuditLogModule,
  ],
  controllers: [SuperadminController, SuperadminUsersController],
  providers: [SuperadminSeedService],
})
export class SuperadminModule {}
