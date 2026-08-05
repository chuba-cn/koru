import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { requireEnv } from '../config/env';

/**
 * @nestjs/bullmq's connection option takes a parsed { host, port, ... } shape,
 * not a raw connection string. Node's URL parser does the parsing so this
 * doesn't need its own regex or a new dependency.
 */
const DEFAULT_REDIS_PORT = 6379;

export function parseRedisUrl(url: string) {
  const parsed = new URL(url);
  const dbSegment = parsed.pathname.replace(/^\//, '');
  const db = dbSegment ? Number(dbSegment) : 0;
  if (!Number.isSafeInteger(db) || db < 0) {
    throw new Error(`Invalid Redis database index in REDIS_URL: "${dbSegment}"`);
  }

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : DEFAULT_REDIS_PORT,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db,
  };
}

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: parseRedisUrl(requireEnv('REDIS_URL')),
      }),
    }),
    BullModule.registerQueue({
      name: 'email',
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 1_000 },
      },
    }),
    BullModule.registerQueue({
      name: 'outbox-relay',
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 100 },
      },
    }),
    BullModule.registerQueue({
      name: 'domain-events',
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 1_000 },
        removeOnFail: { count: 5_000 },
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
