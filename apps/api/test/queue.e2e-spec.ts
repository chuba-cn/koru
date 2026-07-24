import { Queue, Worker } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { parseRedisUrl } from '../src/queue/queue.module';

describe('BullMQ smoke test', () => {
  it('processes a job end-to-end against the real Redis instance', async () => {
    const connection = parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const queueName = `smoke-test-${Date.now()}`;
    const queue = new Queue(queueName, { connection });
    const processed: string[] = [];

    const worker = new Worker(
      queueName,
      async (job) => {
        processed.push(job.data.marker);
      },
      { connection },
    );

    try {
      await worker.waitUntilReady();
      await queue.add('job', { marker: 'hello' });

      await new Promise<void>((resolve, reject) => {
        worker.on('completed', () => resolve());
        worker.on('failed', (_job, error) => reject(error));
      });

      expect(processed).toEqual(['hello']);
    } finally {
      await worker.close();
      await queue.close();
    }
  });
});
