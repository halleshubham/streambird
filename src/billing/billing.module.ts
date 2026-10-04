import { Subscription } from './entities/subscription.entity';
import { Plan } from '../plans/entities/plan.entity';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { AppSetting } from './entities/app-setting.entity';
import { Account } from '../accounts/entities/account.entity';
import { User } from '../users/entities/user.entity';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { SuperadminBillingController } from './superadmin-billing.controller';
import { RazorpayClient } from './razorpay.client';
import { PlansModule } from '../plans/plans.module';
import { AccountsModule } from '../accounts/accounts.module';
import { CommonModule } from '../common/common.module';
import { EmailModule } from '../email/email.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, AppSetting, Account, User, Subscription, Plan]),
    PlansModule,
    AccountsModule,
    CommonModule,
    EmailModule,
    AuditLogModule,
  ],
  providers: [BillingService, RazorpayClient],
  controllers: [BillingController, SuperadminBillingController],
  exports: [BillingService],
})
export class BillingModule {}
