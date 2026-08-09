import { describe, expect, it, vi } from 'vitest';
import { PaymentExpiryProcessor } from './payment-expiry.processor';

function fakePrisma(claimedRows: { id: string; donationIntentId: string }[]) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue(claimedRows),
    paymentAttempt: {
      updateMany: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    donationIntent: { updateMany: vi.fn() },
  };
  return {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    _tx: tx,
  };
}

describe('PaymentExpiryProcessor.sweep', () => {
  it('does nothing when no attempts are past the grace window', async () => {
    const prisma = fakePrisma([]);
    const processor = new PaymentExpiryProcessor(prisma as never);

    const result = await processor.sweep();

    expect(result).toEqual([]);
    expect(prisma._tx.paymentAttempt.updateMany).not.toHaveBeenCalled();
  });

  it('marks claimed attempts expired with a failureReason', async () => {
    const prisma = fakePrisma([{ id: 'attempt-1', donationIntentId: 'intent-1' }]);
    const processor = new PaymentExpiryProcessor(prisma as never);

    await processor.sweep();

    expect(prisma._tx.paymentAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['attempt-1'] } },
      data: { status: 'expired', failureReason: expect.stringContaining('expired') },
    });
  });

  it('expires the intent when the swept attempt was its only live one', async () => {
    const prisma = fakePrisma([{ id: 'attempt-1', donationIntentId: 'intent-1' }]);
    const processor = new PaymentExpiryProcessor(prisma as never);

    await processor.sweep();

    expect(prisma._tx.donationIntent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'intent-1' }) }),
    );
  });

  it('leaves the intent alone when another attempt is still live', async () => {
    const prisma = fakePrisma([{ id: 'attempt-1', donationIntentId: 'intent-1' }]);
    prisma._tx.paymentAttempt.findFirst.mockResolvedValueOnce({ id: 'attempt-2' });
    const processor = new PaymentExpiryProcessor(prisma as never);

    await processor.sweep();

    expect(prisma._tx.donationIntent.updateMany).not.toHaveBeenCalled();
  });
});
