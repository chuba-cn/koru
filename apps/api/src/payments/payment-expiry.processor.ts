import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const CLAIM_BATCH_SIZE = 200;
/**
 * Expiring exactly at expiresAt races a transfer initiated in the last
 * seconds of the window. Marking expired isn't itself destructive, an
 * expired attempt can still settle if the money lands later, but it's a
 * lie the operator will read as final, so the grace widens the gap.
 */
const EXPIRY_GRACE_MINUTES = 10;

type ClaimedRow = { id: string; donationIntentId: string };

/**
 * Detects an unpaid PaymentAttempt whose virtual account expired and never
 * got settled. No `charge.failed` webhook exists for the bank-transfer
 * channel, so this timer is the only way expiry is ever noticed.
 */
@Processor('payment-expiry')
export class PaymentExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentExpiryProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process() {
    await this.sweep();
  }

  async sweep(): Promise<ClaimedRow[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimedRow[]>`
        SELECT id, "donationIntentId" FROM "PaymentAttempt"
        WHERE status = 'pending'
          AND "expiresAt" IS NOT NULL
          AND "expiresAt" < now() - (interval '1 minute' * ${EXPIRY_GRACE_MINUTES})
        ORDER BY "expiresAt"
        LIMIT ${CLAIM_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) return rows;

      const ids = rows.map((row) => row.id);
      await tx.paymentAttempt.updateMany({
        where: { id: { in: ids } },
        data: {
          status: 'expired',
          failureReason: 'Virtual account expired before payment was received',
        },
      });

      const intentIds = [...new Set(rows.map((row) => row.donationIntentId))];
      for (const intentId of intentIds) {
        const otherLiveAttempt = await tx.paymentAttempt.findFirst({
          where: {
            donationIntentId: intentId,
            id: { notIn: ids },
            status: { in: ['pending', 'processing', 'succeeded'] },
          },
          select: { id: true },
        });
        if (!otherLiveAttempt) {
          await tx.donationIntent.updateMany({
            where: { id: intentId, status: { notIn: ['succeeded', 'cancelled'] } },
            data: { status: 'expired' },
          });
        }
      }

      this.logger.debug(`Expired ${rows.length} payment attempt(s)`);
      return rows;
    });
  }
}
