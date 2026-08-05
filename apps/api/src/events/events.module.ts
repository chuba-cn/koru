import { InjectQueue } from '@nestjs/bullmq';
import { Module, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { isRelayScheduleEnabled } from '../config/env';
import { DomainEventProcessor } from './domain-event.processor';
import { OutboxService } from './outbox.service';
import { OutboxRelayProcessor } from './outbox-relay.processor';

const RELAY_TICK_INTERVAL_MS = 1_000;

@Module({
  providers: [OutboxService, OutboxRelayProcessor, DomainEventProcessor],
  exports: [OutboxService],
})
export class EventsModule implements OnModuleInit {
  constructor(@InjectQueue('outbox-relay') private readonly relayQueue: Queue) {}

  async onModuleInit() {
    if (!isRelayScheduleEnabled()) return;

    // upsertJobScheduler is idempotent — safe to call on every boot, every replica.
    await this.relayQueue.upsertJobScheduler(
      'outbox-relay',
      { every: RELAY_TICK_INTERVAL_MS },
      { name: 'tick' },
    );
  }
}
