import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { AccountsModule } from '../accounts/accounts.module';
import { CommonModule } from '../common/common.module';
import { SuperadminSeedService } from './superadmin-seed.service';
import { SuperadminController } from './superadmin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User]), UsersModule, AccountsModule, CommonModule],
  controllers: [SuperadminController],
  providers: [SuperadminSeedService],
})
export class SuperadminModule {}
