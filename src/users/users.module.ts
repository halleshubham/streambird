import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';
import { AccountsModule } from '../accounts/accounts.module';
import { Company } from '../companies/entities/company.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Company]), AccountsModule],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
