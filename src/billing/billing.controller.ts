import { Body, Controller, Get, Headers, HttpCode, Post, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { BillingService } from './billing.service';
import { CreateOrderDto, VerifyPaymentDto } from './dto/billing.dto';
import { AccountGuard } from '../common/guards/account.guard';
import { CurrentAccount } from '../common/decorators/current-account.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Account } from '../accounts/entities/account.entity';
import { User } from '../users/entities/user.entity';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** Unauthenticated: tells the pricing page whether to show Buy buttons. */
  @Get('config')
  config() {
    return this.billing.publicConfig();
  }

  @Post('orders')
  @UseGuards(AccountGuard)
  createOrder(@CurrentAccount() account: Account, @CurrentUser() user: User | undefined, @Body() dto: CreateOrderDto) {
    return this.billing.createOrder(account, user, dto.planKey);
  }

  @Post('verify')
  @HttpCode(200)
  @UseGuards(AccountGuard)
  verify(@CurrentAccount() account: Account, @Body() dto: VerifyPaymentDto) {
    return this.billing.verifyCheckout(account.id, {
      orderId: dto.razorpay_order_id,
      paymentId: dto.razorpay_payment_id,
      signature: dto.razorpay_signature,
    });
  }

  @Get('payments')
  @UseGuards(AccountGuard)
  async myPayments(@CurrentAccount() account: Account) {
    const rows = await this.billing.listForAccount(account.id);
    return rows.map((p) => ({
      id: p.id,
      planKey: p.planKey,
      kind: p.kind,
      amountInr: p.amountPaise / 100,
      status: p.status,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
    }));
  }

  /** Razorpay -> us. Unauthenticated by design; trust comes only from the HMAC of the raw body. */
  @Post('webhook')
  @HttpCode(200)
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-razorpay-signature') signature?: string) {
    return this.billing.handleWebhook(req.rawBody, signature);
  }
}
