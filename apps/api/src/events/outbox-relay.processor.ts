import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

const CLAIM_BATCH_SIZE = 100;

type ClaimedRow = { id: string };

const CLAIM_TRANSACTION_TIMEOUT_MS = 10_000;

/** Claims, enqueues, and marks unpublished DomainEvent rows. See docs/architecture/transactional-outbox-and-relay.md. */
@Processor('outbox-relay')
export class OutboxRelayProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboxRelayProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('domain-events') private readonly domainEventsQueue: Queue,
    @InjectQueue('outbox-relay') private readonly relayQueue: Queue,
  ) {
    super();
  }

  async process() {
    const claimed = await this.relay();

    if (claimed.length === CLAIM_BATCH_SIZE) {
      // The batch was full — more may be waiting. Drain immediately rather
      // than waiting for the next scheduled tick, without shortening the
      // schedule itself.
      await this.relayQueue.add('tick', {});
    }
  }

  async relay(): Promise<ClaimedRow[]> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<ClaimedRow[]>`
          SELECT id FROM "DomainEvent"
          WHERE "publishedAt" IS NULL
          ORDER BY "createdAt"
          LIMIT ${CLAIM_BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        `;

        if (rows.length === 0) return rows;

        await this.domainEventsQueue.addBulk(
          rows.map((row) => ({
            name: 'deliver',
            data: { domainEventId: row.id },
            opts: { jobId: row.id },
          })),
        );

        const ids = rows.map((row) => row.id);
        await tx.domainEvent.updateMany({
          where: { id: { in: ids } },
          data: { publishedAt: new Date() },
        });

        this.logger.debug(`Relayed ${rows.length} domain events`);
        return rows;
      },
      { timeout: CLAIM_TRANSACTION_TIMEOUT_MS },
    );
  }
}
