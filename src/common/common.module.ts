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
  exports: [ApiKeyGuard, StreamCreateThrottlerGuard, ThrottlerModule],
})
export class CommonModule {}
