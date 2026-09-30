import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from './entities/account.entity';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { CommonModule } from '../common/common.module';

@Module({
  // forwardRef: CommonModule needs AccountsService to build AccountGuard/
  // ApiKeyGuard, and AccountsController needs AccountGuard for /accounts/me
  // -- a genuine two-way dependency, not an accidental one.
  imports: [TypeOrmModule.forFeature([Account]), forwardRef(() => CommonModule)],
  providers: [AccountsService],
  controllers: [AccountsController],
  exports: [AccountsService],
})
export class AccountsModule {}
