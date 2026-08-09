import { InjectQueue } from '@nestjs/bullmq';
import { Module, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { VerifiedPhoneGuard } from '../auth/verified-phone.guard';
import { isPaymentSweepScheduleEnabled } from '../config/env';
import { EventsModule } from '../events/events.module';
import { LedgerModule } from '../ledger/ledger.module';
import { DonationController } from './donation.controller';
import { DonationIntentService } from './donation-intent.service';
import { PaymentGatewayModule } from './gateway/payment-gateway.module';
import { PaymentExpiryProcessor } from './payment-expiry.processor';
import { PaymentSettlementService } from './payment-settlement.service';
import { PaymentWebhookProcessor } from './payment-webhook.processor';
import { PaystackWebhookController } from './paystack-webhook.controller';
import { PaystackWebhookService } from './paystack-webhook.service';

const EXPIRY_TICK_INTERVAL_MS = 60_000;

@Module({
  imports: [EventsModule, LedgerModule, PaymentGatewayModule],
  controllers: [PaystackWebhookController, DonationController],
  providers: [
    DonationIntentService,
    PaystackWebhookService,
    PaymentSettlementService,
    PaymentWebhookProcessor,
    PaymentExpiryProcessor,
    VerifiedPhoneGuard,
  ],
  exports: [DonationIntentService, PaymentSettlementService],
})
export class PaymentsModule implements OnModuleInit {
  constructor(@InjectQueue('payment-expiry') private readonly expiryQueue: Queue) {}

  async onModuleInit() {
    if (!isPaymentSweepScheduleEnabled()) return;

    await this.expiryQueue.upsertJobScheduler(
      'payment-expiry',
      { every: EXPIRY_TICK_INTERVAL_MS },
      { name: 'tick' },
    );
  }
}
