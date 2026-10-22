import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';
import { AccountsModule } from '../accounts/accounts.module';
import { Company } from '../companies/entities/company.entity';
import { AppSetting } from '../billing/entities/app-setting.entity';
import { RegistrationSettingsService } from './registration-settings.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Company, AppSetting]), AccountsModule],
  providers: [UsersService, RegistrationSettingsService],
  exports: [UsersService, RegistrationSettingsService],
})
export class UsersModule {}
