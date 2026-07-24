import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { requireEnv } from '../config/env';

/**
 * @nestjs/bullmq's connection option takes a parsed { host, port, ... } shape,
 * not a raw connection string — Node's URL parser does the parsing so this
 * doesn't need its own regex or a new dependency.
 */
const DEFAULT_REDIS_PORT = 6379;

export function parseRedisUrl(url: string) {
  const parsed = new URL(url);

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : DEFAULT_REDIS_PORT,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
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
  ],
  exports: [BullModule],
})
export class QueueModule {}
