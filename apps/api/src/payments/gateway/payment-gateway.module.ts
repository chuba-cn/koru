import { Module } from '@nestjs/common';
import { PAYMENT_GATEWAY } from './payment-gateway';
import { PaystackAdapter } from './paystack.adapter';

@Module({
  providers: [{ provide: PAYMENT_GATEWAY, useClass: PaystackAdapter }, PaystackAdapter],
  exports: [PAYMENT_GATEWAY, PaystackAdapter],
})
export class PaymentGatewayModule {}
