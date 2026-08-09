import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_GATEWAY, type PaymentGateway } from './gateway/payment-gateway';
import { PaymentSettlementService } from './payment-settlement.service';

@Processor('payment-webhooks')
export class PaymentWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentWebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settlement: PaymentSettlementService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {
    super();
  }

  async process(job: Job<{ webhookEventId: string }>) {
    const event = await this.prisma.webhookEvent.findUnique({
      where: { id: job.data.webhookEventId },
    });

    if (!event) {
      this.logger.warn(`No WebhookEvent row for id ${job.data.webhookEventId}, nothing to do`);
      return;
    }
    if (event.status === 'processed' || event.status === 'ignored') {
      return;
    }

    const signal = this.gateway.parseWebhook(Buffer.from(event.rawBody, 'utf-8'));
    let resolvedChurchId: string | null = null;

    switch (signal.kind) {
      case 'charge_succeeded': {
        const facts = await this.gateway.fetchCharge(signal.reference);
        const result = await this.settlement.postCharge(facts);
        resolvedChurchId = result?.churchId ?? null;
        break;
      }
      case 'transfer_rejected': {
        const result = await this.settlement.recordTransferRejection(
          signal.reference,
          signal.reason,
        );
        resolvedChurchId = result?.churchId ?? null;
        break;
      }
      default:
        break;
    }

    await this.prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: 'processed', processedAt: new Date(), churchId: resolvedChurchId },
    });
  }
}
