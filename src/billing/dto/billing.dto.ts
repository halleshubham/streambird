import { IsBoolean, IsString, MaxLength } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  @MaxLength(40)
  planKey!: string;
}

/** Field names are Razorpay Checkout's own. */
export class VerifyPaymentDto {
  @IsString() @MaxLength(100)
  razorpay_order_id!: string;

  @IsString() @MaxLength(100)
  razorpay_payment_id!: string;

  @IsString() @MaxLength(200)
  razorpay_signature!: string;
}

/** Field names are Razorpay Checkout's own for subscriptions. */
export class VerifySubscriptionDto {
  @IsString() @MaxLength(100)
  razorpay_subscription_id!: string;

  @IsString() @MaxLength(100)
  razorpay_payment_id!: string;

  @IsString() @MaxLength(200)
  razorpay_signature!: string;
}

export class UpdateBillingSettingsDto {
  @IsBoolean()
  paymentsEnabled!: boolean;
}
