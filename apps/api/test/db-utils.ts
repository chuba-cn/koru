import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../src/prisma/prisma.service';

const EMAIL_QUEUE_DRAIN_TIMEOUT_MS = 5000;

/**
 * EmailLog must not be truncated while a job referencing it is still active —
 * the worker's row lookup would then fail permanently, not transiently,
 * poisoning the job into the failed set. Pausing first closes the window
 * where a delayed/retrying job gets promoted to active between the count
 * check and the obliterate call.
 */
async function resetEmailQueue(queue: Queue) {
  await queue.pause();
  const start = Date.now();
  while ((await queue.getJobCounts('active')).active > 0) {
    if (Date.now() - start > EMAIL_QUEUE_DRAIN_TIMEOUT_MS) {
      throw new Error(
        `Email queue still has an active job after ${EMAIL_QUEUE_DRAIN_TIMEOUT_MS}ms — it's stuck, not just slow.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await queue.obliterate({ force: true });
  await queue.resume();
}

export async function truncateAll(app: INestApplication) {
  const prisma = app.get(PrismaService);
  await resetEmailQueue(app.get<Queue>(getQueueToken('email')));

  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
    `;

  if (tables.length === 0) return;

  const list = tables.map((table) => `"public"."${table.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
