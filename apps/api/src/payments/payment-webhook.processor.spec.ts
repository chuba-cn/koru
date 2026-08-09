import { describe, expect, it, vi } from 'vitest';
import { PaymentWebhookProcessor } from './payment-webhook.processor';

function fakeJob(webhookEventId: string) {
  return { data: { webhookEventId } } as never;
}

describe('PaymentWebhookProcessor.process', () => {
  it('returns quietly when the WebhookEvent row is gone', async () => {
    const prisma = {
      webhookEvent: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
    };
    const settlement = { postCharge: vi.fn(), recordTransferRejection: vi.fn() };
    const gateway = { parseWebhook: vi.fn() };
    const processor = new PaymentWebhookProcessor(
      prisma as never,
      settlement as never,
      gateway as never,
    );

    await processor.process(fakeJob('missing'));

    expect(gateway.parseWebhook).not.toHaveBeenCalled();
  });

  it('is a no-op re-delivery guard for an already-processed event', async () => {
    const prisma = {
      webhookEvent: {
        findUnique: vi.fn().mockResolvedValue({ id: 'e1', status: 'processed', rawBody: '{}' }),
        update: vi.fn(),
      },
    };
    const settlement = { postCharge: vi.fn(), recordTransferRejection: vi.fn() };
    const gateway = { parseWebhook: vi.fn() };
    const processor = new PaymentWebhookProcessor(
      prisma as never,
      settlement as never,
      gateway as never,
    );

    await processor.process(fakeJob('e1'));

    expect(gateway.parseWebhook).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.update).not.toHaveBeenCalled();
  });

  it('fetches the real charge and calls postCharge for a charge_succeeded signal, then marks processed', async () => {
    const prisma = {
      webhookEvent: {
        findUnique: vi.fn().mockResolvedValue({ id: 'e1', status: 'received', rawBody: '{}' }),
        update: vi.fn(),
      },
    };
    const settlement = {
      postCharge: vi.fn().mockResolvedValue({ churchId: 'church-1' }),
      recordTransferRejection: vi.fn(),
    };
    const gateway = {
      parseWebhook: vi.fn().mockReturnValue({ kind: 'charge_succeeded', reference: 'attempt-1' }),
      fetchCharge: vi.fn().mockResolvedValue({ reference: 'attempt-1', status: 'success' }),
    };
    const processor = new PaymentWebhookProcessor(
      prisma as never,
      settlement as never,
      gateway as never,
    );

    await processor.process(fakeJob('e1'));

    expect(gateway.fetchCharge).toHaveBeenCalledWith('attempt-1');
    expect(settlement.postCharge).toHaveBeenCalled();
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'processed', churchId: 'church-1' }),
      }),
    );
  });

  it('calls recordTransferRejection for a transfer_rejected signal', async () => {
    const prisma = {
      webhookEvent: {
        findUnique: vi.fn().mockResolvedValue({ id: 'e1', status: 'received', rawBody: '{}' }),
        update: vi.fn(),
      },
    };
    const settlement = {
      postCharge: vi.fn(),
      recordTransferRejection: vi.fn().mockResolvedValue({ churchId: 'church-1' }),
    };
    const gateway = {
      parseWebhook: vi.fn().mockReturnValue({
        kind: 'transfer_rejected',
        reference: 'attempt-1',
        reason: 'bad amount',
      }),
    };
    const processor = new PaymentWebhookProcessor(
      prisma as never,
      settlement as never,
      gateway as never,
    );

    await processor.process(fakeJob('e1'));

    expect(settlement.recordTransferRejection).toHaveBeenCalledWith('attempt-1', 'bad amount');
    expect(settlement.postCharge).not.toHaveBeenCalled();
  });

  it('marks an ignored signal processed without calling settlement at all', async () => {
    const prisma = {
      webhookEvent: {
        findUnique: vi.fn().mockResolvedValue({ id: 'e1', status: 'received', rawBody: '{}' }),
        update: vi.fn(),
      },
    };
    const settlement = { postCharge: vi.fn(), recordTransferRejection: vi.fn() };
    const gateway = { parseWebhook: vi.fn().mockReturnValue({ kind: 'ignored' }) };
    const processor = new PaymentWebhookProcessor(
      prisma as never,
      settlement as never,
      gateway as never,
    );

    await processor.process(fakeJob('e1'));

    expect(settlement.postCharge).not.toHaveBeenCalled();
    expect(settlement.recordTransferRejection).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.update).toHaveBeenCalled();
  });
});
