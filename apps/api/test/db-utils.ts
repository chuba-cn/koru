import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../src/prisma/prisma.service';

const QUEUE_DRAIN_TIMEOUT_MS = 5000;

/**
 * A row must not be truncated while a job referencing it is still active —
 * the worker's row lookup would then fail permanently, not transiently,
 * poisoning the job into the failed set. Pausing first closes the window
 * where a delayed/retrying job gets promoted to active between the count
 * check and the obliterate call.
 */
async function resetQueue(queue: Queue, drainTimeoutMs: number) {
  await queue.pause();
  try {
    const start = Date.now();
    while ((await queue.getJobCounts('active')).active > 0) {
      if (Date.now() - start > drainTimeoutMs) {
        throw new Error(
          `Queue "${queue.name}" still has an active job after ${drainTimeoutMs}ms — it's stuck, not just slow.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await queue.obliterate({ force: true });
  } finally {
    await queue.resume();
  }
}

export async function truncateAll(app: INestApplication) {
  const prisma = app.get(PrismaService);
  await Promise.all(
    ['email', 'outbox-relay', 'domain-events', 'payment-webhooks', 'payment-expiry'].map((name) =>
      resetQueue(app.get<Queue>(getQueueToken(name)), QUEUE_DRAIN_TIMEOUT_MS),
    ),
  );

  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
    `;

  if (tables.length === 0) return;

  const list = tables.map((table) => `"public"."${table.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
