import { forwardRef, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AccountsModule } from '../accounts/accounts.module';
import { AuthModule } from '../auth/auth.module';
import { ApiKeyGuard } from './guards/api-key.guard';
import { AccountGuard } from './guards/account.guard';
import { StreamCreateThrottlerGuard } from './guards/stream-create-throttler.guard';

@Module({
  imports: [
    // forwardRef: AccountsModule imports CommonModule back, for
    // AccountGuard on AccountsController's /accounts/me route.
    forwardRef(() => AccountsModule),
    AuthModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
  ],
  providers: [ApiKeyGuard, AccountGuard, StreamCreateThrottlerGuard],
  // Re-exporting AccountsModule/AuthModule (not just the guards) so any
  // module that imports CommonModule can resolve ApiKeyGuard/AccountGuard's
  // own constructor dependencies too — Nest resolves a guard's deps in the
  // consuming module's scope, not the exporting module's.
  exports: [
    ApiKeyGuard,
    AccountGuard,
    StreamCreateThrottlerGuard,
    ThrottlerModule,
    AccountsModule,
    AuthModule,
  ],
})
export class CommonModule {}
