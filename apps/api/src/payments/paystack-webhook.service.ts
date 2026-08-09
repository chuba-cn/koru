import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_GATEWAY, type PaymentGateway } from './gateway/payment-gateway';

/**
 * Receives, verifies and dedupes a Paystack webhook, then hands off
 * to async processing. Must return in single-digit milliseconds
 */
@Injectable()
export class PaystackWebhookService {
  private readonly logger = new Logger(PaystackWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('payment-webhooks') private readonly queue: Queue,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async receive(rawBody: Buffer, headers: Record<string, string | string[]>) {
    if (!this.gateway.verifySignature(rawBody, headers)) {
      this.logger.warn('Rejected Paystack webhook: invalid signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const signal = this.gateway.parseWebhook(rawBody);

    let event: { id: string };
    try {
      event = await this.prisma.webhookEvent.create({
        data: {
          provider: signal.provider,
          providerEventKey: signal.providerEventKey,
          type: signal.eventType,
          payload: JSON.parse(rawBody.toString('utf-8')),
          signature: String(headers['x-paystack-signature'] ?? ''),
          rawBody: rawBody.toString('utf-8'),
          churchId: null,
          status: signal.kind === 'ignored' ? 'ignored' : 'received',
        },
        select: { id: true },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.webhookEvent.findUnique({
          where: {
            provider_providerEventKey: {
              provider: signal.provider,
              providerEventKey: signal.providerEventKey,
            },
          },
          select: { id: true, status: true },
        });
        if (existing && existing.status === 'received') {
          this.logger.warn(
            `Duplicate Paystack webhook ${signal.providerEventKey} is still unprocessed - re-enqueuing`,
          );
          await this.enqueue(existing.id);
          return;
        }
        this.logger.log(
          `Duplicate Paystack webhook ${signal.providerEventKey} - already in the inbox`,
        );
        return;
      }
      throw error;
    }

    if (signal.kind === 'ignored') return;

    await this.enqueue(event.id);
  }

  private async enqueue(webhookEventId: string) {
    await this.queue.add('process', { webhookEventId }, { jobId: webhookEventId });
  }
}
