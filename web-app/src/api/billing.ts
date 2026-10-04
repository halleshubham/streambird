import { api } from './client';
import type { AdminBilling, BillingConfig, CheckoutOrder, MyPayment } from '../types/api';

export function getBillingConfig(): Promise<BillingConfig> {
  return api.get('/billing/config');
}

export function createOrder(planKey: string): Promise<CheckoutOrder> {
  return api.post('/billing/orders', { planKey });
}

/** Razorpay Checkout's success payload, passed straight through for the server to verify. */
export function verifyPayment(payload: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): Promise<{ status: 'paid' }> {
  return api.post('/billing/verify', payload);
}

export function getMyPayments(): Promise<MyPayment[]> {
  return api.get('/billing/payments');
}

export function getAdminBilling(): Promise<AdminBilling> {
  return api.get('/superadmin/billing');
}

export function setPaymentsEnabled(paymentsEnabled: boolean): Promise<Omit<AdminBilling, 'payments'>> {
  return api.patch('/superadmin/billing/settings', { paymentsEnabled });
}
