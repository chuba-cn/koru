import { ResendWebhookEventSchema } from '@koru/shared';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Resend } from 'resend';
import { requireEnv } from '../config/env';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const WEBHOOK_SECRET = requireEnv('RESEND_WEBHOOK_SECRET');

const DELIVERED_STATUSES: Record<string, { status: string; setDeliveredAt: boolean }> = {
  'email.delivered': { status: 'delivered', setDeliveredAt: true },
  'email.bounced': { status: 'bounced', setDeliveredAt: false },
  'email.complained': { status: 'complained', setDeliveredAt: false },
  'email.failed': { status: 'failed', setDeliveredAt: false },
};

@Injectable()
export class ResendWebhookService {
  private readonly logger = new Logger(ResendWebhookService.name);
  // Only used for local webhook signature verification, which never touches
  // the network or the key itself — so this must not require a real Resend
  // API key, or the receiver can't boot in dev/SMTP environments.
  private readonly client = new Resend(process.env.RESEND_API_KEY || 'unused-webhook-verify-only');

  constructor(private readonly prisma: PrismaService) {}

  async handle(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    let payload: unknown;

    try {
      // Resend delivers webhooks over Svix, whose wire headers are
      // Svix-Id/Svix-Timestamp/Svix-Signature (lowercased by Express) — not
      // "webhook-*", despite that being the name resend's own verify() options
      // use internally. Confirmed against a real Resend webhook delivery.
      payload = this.client.webhooks.verify({
        payload: rawBody.toString('utf-8'),
        headers: {
          id: String(headers['svix-id'] ?? ''),
          timestamp: String(headers['svix-timestamp'] ?? ''),
          signature: String(headers['svix-signature'] ?? ''),
        },
        webhookSecret: WEBHOOK_SECRET,
      });
    } catch (error) {
      this.logger.warn(`Rejected webhook: invalid signature (${error})`);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const event = ResendWebhookEventSchema.parse(payload);

    if (!event.data.email_id) return;

    const mapping = DELIVERED_STATUSES[event.type];

    if (!mapping) return;

    const log = await this.prisma.emailLog.findFirst({
      where: { providerMessageId: event.data.email_id },
      select: { id: true },
    });

    if (!log) {
      this.logger.warn(`No EmailLog for provider message id ${event.data.email_id}`);
      return;
    }

    await this.prisma.emailLog.update({
      where: { id: log.id },
      data: {
        status: mapping.status as Prisma.EnumEmailDeliveryStatusFieldUpdateOperationsInput,
        ...(mapping.setDeliveredAt ? { deliveredAt: new Date() } : {}),
      },
    });
  }
}
