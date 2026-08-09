import { koboToNaira } from '@koru/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@AllowAnonymous()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('email') private readonly emailQueue: Queue,
    @InjectQueue('domain-events') private readonly domainEventsQueue: Queue,
    @InjectQueue('outbox-relay') private readonly relayQueue: Queue,
    @InjectQueue('payment-webhooks') private readonly paymentWebhooksQueue: Queue,
    @InjectQueue('payment-expiry') private readonly paymentExpiryQueue: Queue,
  ) {}

  @Get()
  check() {
    return {
      status: 'ok',
      service: 'koru-api',
      sharedCheck: koboToNaira(100_000),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('db')
  async checkDb() {
    const [churches, campaigns, pledges, payments] = await Promise.all([
      this.prisma.church.count(),
      this.prisma.campaign.count(),
      this.prisma.pledge.count(),
      this.prisma.payment.count(),
    ]);

    return {
      status: 'ok',
      db: 'reachable',
      churches,
      campaigns,
      pledges,
      payments,
    };
  }

  @Get('outbox')
  async checkOutbox() {
    const [unpublishedCount, oldestUnpublished, domainEventsCounts, relayCounts] =
      await Promise.all([
        this.prisma.domainEvent.count({ where: { publishedAt: null } }),
        this.prisma.domainEvent.findFirst({
          where: { publishedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        this.domainEventsQueue.getJobCounts('waiting', 'failed'),
        this.relayQueue.getJobCounts('failed'),
      ]);

    return {
      status: 'ok',
      unpublishedCount,
      oldestUnpublishedAgeSeconds: oldestUnpublished
        ? Math.floor((Date.now() - oldestUnpublished.createdAt.getTime()) / 1_000)
        : 0,
      domainEventsWaiting: domainEventsCounts.waiting ?? 0,
      domainEventsFailed: domainEventsCounts.failed ?? 0,
      relayFailed: relayCounts.failed ?? 0,
    };
  }

  @Get('payments')
  async checkPayments() {
    const [
      webhooksAwaitingProcessing,
      oldestUnprocessed,
      attemptsPendingPastExpiry,
      webhooksCounts,
      expiryCounts,
    ] = await Promise.all([
      this.prisma.webhookEvent.count({ where: { status: 'received' } }),
      this.prisma.webhookEvent.findFirst({
        where: { status: 'received' },
        orderBy: { receivedAt: 'asc' },
        select: { receivedAt: true },
      }),
      this.prisma.paymentAttempt.count({
        where: { status: 'pending', expiresAt: { lt: new Date() } },
      }),
      this.paymentWebhooksQueue.getJobCounts('waiting', 'failed'),
      this.paymentExpiryQueue.getJobCounts('failed'),
    ]);

    return {
      status: 'ok',
      webhooksAwaitingProcessing,
      oldestUnprocessedWebhookAgeSeconds: oldestUnprocessed
        ? Math.floor((Date.now() - oldestUnprocessed.receivedAt.getTime()) / 1_000)
        : 0,
      paymentWebhooksWaiting: webhooksCounts.waiting ?? 0,
      paymentWebhooksFailed: webhooksCounts.failed ?? 0,
      expirySweepFailed: expiryCounts.failed ?? 0,
      attemptsPendingPastExpiry,
    };
  }

  @Get('redis')
  async checkRedis() {
    try {
      const client = await this.emailQueue.client;
      await client.info();
      return {
        status: 'ok',
        redis: 'reachable',
      };
    } catch {
      return {
        status: 'error',
        redis: 'unreachable',
      };
    }
  }
}
