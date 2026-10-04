import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AccountGuard } from '../common/guards/account.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { BillingService } from './billing.service';
import { UpdateBillingSettingsDto } from './dto/billing.dto';
import { AuditLogService } from '../audit-log/audit-log.service';

/** Superadmin: the payments on/off switch, setup status and recent payments. */
@Controller('superadmin/billing')
@UseGuards(AccountGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class SuperadminBillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  async overview() {
    const [status, payments] = await Promise.all([this.billing.adminStatus(), this.billing.listRecent(100)]);
    return {
      ...status,
      payments: payments.map((p) => ({
        id: p.id,
        accountId: p.accountId,
        accountName: p.accountName,
        planKey: p.planKey,
        kind: p.kind,
        amountInr: p.amountPaise / 100,
        status: p.status,
        razorpayPaymentId: p.razorpayPaymentId,
        failureReason: p.failureReason,
        createdAt: p.createdAt,
        paidAt: p.paidAt,
      })),
    };
  }

  @Patch('settings')
  async update(@CurrentUser() admin: User, @Body() dto: UpdateBillingSettingsDto) {
    await this.billing.setPaymentsEnabled(dto.paymentsEnabled);
    await this.auditLog.log(admin, dto.paymentsEnabled ? 'enable_payments' : 'disable_payments', 'settings', null);
    return this.billing.adminStatus();
  }
}
