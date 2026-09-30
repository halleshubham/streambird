import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AccountsModule } from '../accounts/accounts.module';
import { ApiKeyGuard } from './guards/api-key.guard';
import { StreamCreateThrottlerGuard } from './guards/stream-create-throttler.guard';

@Module({
  imports: [
    AccountsModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
  ],
  providers: [ApiKeyGuard, StreamCreateThrottlerGuard],
  // Re-exporting AccountsModule (not just the guards) so any module that
  // imports CommonModule can resolve ApiKeyGuard's own AccountsService
  // dependency too — Nest resolves a guard's constructor deps in the
  // consuming module's scope, not the exporting module's.
  exports: [ApiKeyGuard, StreamCreateThrottlerGuard, ThrottlerModule, AccountsModule],
})
export class CommonModule {}
