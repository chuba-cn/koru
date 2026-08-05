import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRelayScheduleEnabled } from '../config/env';
import { EventsModule } from './events.module';

function restoreRelayScheduleEnabled(original: string | undefined) {
  if (original === undefined) {
    delete process.env.RELAY_SCHEDULE_ENABLED;
  } else {
    process.env.RELAY_SCHEDULE_ENABLED = original;
  }
}

describe('isRelayScheduleEnabled', () => {
  const original = process.env.RELAY_SCHEDULE_ENABLED;

  afterEach(() => {
    restoreRelayScheduleEnabled(original);
  });

  it('is true by default — production must actually schedule the relay', () => {
    delete process.env.RELAY_SCHEDULE_ENABLED;
    expect(isRelayScheduleEnabled()).toBe(true);
  });

  it('is false when explicitly disabled — how .env.test opts the e2e suite out', () => {
    process.env.RELAY_SCHEDULE_ENABLED = 'false';
    expect(isRelayScheduleEnabled()).toBe(false);
  });
});

describe('EventsModule.onModuleInit', () => {
  const original = process.env.RELAY_SCHEDULE_ENABLED;

  afterEach(() => {
    restoreRelayScheduleEnabled(original);
  });

  it('registers the relay schedule when enabled', async () => {
    delete process.env.RELAY_SCHEDULE_ENABLED;
    const relayQueue = { upsertJobScheduler: vi.fn().mockResolvedValue(undefined) };
    const module = new EventsModule(relayQueue as never);

    await module.onModuleInit();

    expect(relayQueue.upsertJobScheduler).toHaveBeenCalledWith(
      'outbox-relay',
      { every: 1_000 },
      { name: 'tick' },
    );
  });

  it('does not register the relay schedule when disabled', async () => {
    process.env.RELAY_SCHEDULE_ENABLED = 'false';
    const relayQueue = { upsertJobScheduler: vi.fn() };
    const module = new EventsModule(relayQueue as never);

    await module.onModuleInit();

    expect(relayQueue.upsertJobScheduler).not.toHaveBeenCalled();
  });
});
