import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPaymentSweepScheduleEnabled } from '../config/env';
import { PaymentsModule } from './payments.module';

function restore(original: string | undefined) {
  if (original === undefined) {
    delete process.env.PAYMENT_SWEEP_SCHEDULE_ENABLED;
  } else {
    process.env.PAYMENT_SWEEP_SCHEDULE_ENABLED = original;
  }
}

describe('isPaymentSweepScheduleEnabled', () => {
  const original = process.env.PAYMENT_SWEEP_SCHEDULE_ENABLED;

  afterEach(() => restore(original));

  it('is true by default — production must actually schedule the sweep', () => {
    delete process.env.PAYMENT_SWEEP_SCHEDULE_ENABLED;
    expect(isPaymentSweepScheduleEnabled()).toBe(true);
  });

  it('is false when explicitly disabled — how .env.test opts the e2e suite out', () => {
    process.env.PAYMENT_SWEEP_SCHEDULE_ENABLED = 'false';
    expect(isPaymentSweepScheduleEnabled()).toBe(false);
  });
});

describe('PaymentsModule.onModuleInit', () => {
  const original = process.env.PAYMENT_SWEEP_SCHEDULE_ENABLED;

  afterEach(() => restore(original));

  it('registers the expiry sweep schedule when enabled', async () => {
    delete process.env.PAYMENT_SWEEP_SCHEDULE_ENABLED;
    const expiryQueue = { upsertJobScheduler: vi.fn().mockResolvedValue(undefined) };
    const module = new PaymentsModule(expiryQueue as never);

    await module.onModuleInit();

    expect(expiryQueue.upsertJobScheduler).toHaveBeenCalledWith(
      'payment-expiry',
      { every: 60_000 },
      { name: 'tick' },
    );
  });

  it('does not register the sweep schedule when disabled', async () => {
    process.env.PAYMENT_SWEEP_SCHEDULE_ENABLED = 'false';
    const expiryQueue = { upsertJobScheduler: vi.fn() };
    const module = new PaymentsModule(expiryQueue as never);

    await module.onModuleInit();

    expect(expiryQueue.upsertJobScheduler).not.toHaveBeenCalled();
  });
});
