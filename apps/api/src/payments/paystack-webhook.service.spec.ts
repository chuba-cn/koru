import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client';
import { PaystackWebhookService } from './paystack-webhook.service';

const RAW_BODY = Buffer.from(
  JSON.stringify({
    event: 'charge.success',
    data: { id: 1, reference: 'attempt-1', channel: 'bank_transfer' },
  }),
);

function fakeGateway(overrides: { verifies?: boolean } = {}) {
  return {
    verifySignature: vi.fn().mockReturnValue(overrides.verifies ?? true),
    parseWebhook: vi.fn().mockReturnValue({
      kind: 'charge_succeeded',
      provider: 'paystack',
      eventType: 'charge.success',
      providerEventKey: 'charge:1',
      reference: 'attempt-1',
      providerChargeId: '1',
    }),
  };
}

function fakePrisma() {
  return {
    webhookEvent: {
      create: vi.fn().mockResolvedValue({ id: 'event-1' }),
      findUnique: vi.fn().mockResolvedValue({ id: 'event-1', status: 'processed' }),
    },
  };
}

function fakeQueue() {
  return { add: vi.fn().mockResolvedValue(undefined) };
}

describe('PaystackWebhookService.receive', () => {
  it('401s on an invalid signature, writing nothing and enqueuing nothing', async () => {
    const prisma = fakePrisma();
    const queue = fakeQueue();
    const gateway = fakeGateway({ verifies: false });
    const service = new PaystackWebhookService(prisma as never, queue as never, gateway as never);

    await expect(service.receive(RAW_BODY, {})).rejects.toThrow(UnauthorizedException);
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('writes a WebhookEvent row and enqueues a job with jobId = event.id', async () => {
    const prisma = fakePrisma();
    const queue = fakeQueue();
    const gateway = fakeGateway();
    const service = new PaystackWebhookService(prisma as never, queue as never, gateway as never);

    await service.receive(RAW_BODY, { 'x-paystack-signature': 'sig' });

    expect(prisma.webhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provider: 'paystack', providerEventKey: 'charge:1' }),
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'process',
      { webhookEventId: 'event-1' },
      { jobId: 'event-1' },
    );
  });

  it('acks a duplicate delivery (P2002) without enqueuing a second job', async () => {
    const duplicateError = Object.create(Prisma.PrismaClientKnownRequestError.prototype);
    Object.assign(duplicateError, { message: 'dup', code: 'P2002', clientVersion: 'test' });
    const prisma = fakePrisma();
    prisma.webhookEvent.create.mockRejectedValueOnce(duplicateError);
    const queue = fakeQueue();
    const gateway = fakeGateway();
    const service = new PaystackWebhookService(prisma as never, queue as never, gateway as never);

    await expect(service.receive(RAW_BODY, {})).resolves.not.toThrow();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('re-enqueues a redelivery whose row is still unprocessed, rather than acking it away', async () => {
    const duplicateError = Object.create(Prisma.PrismaClientKnownRequestError.prototype);
    Object.assign(duplicateError, { message: 'dup', code: 'P2002', clientVersion: 'test' });
    const prisma = fakePrisma();
    prisma.webhookEvent.create.mockRejectedValueOnce(duplicateError);
    prisma.webhookEvent.findUnique.mockResolvedValueOnce({ id: 'event-1', status: 'received' });
    const queue = fakeQueue();
    const gateway = fakeGateway();
    const service = new PaystackWebhookService(prisma as never, queue as never, gateway as never);

    await service.receive(RAW_BODY, {});

    expect(queue.add).toHaveBeenCalledWith(
      'process',
      { webhookEventId: 'event-1' },
      { jobId: 'event-1' },
    );
  });

  it('enqueues nothing for an ignored signal, even though it is still written to the inbox', async () => {
    const prisma = fakePrisma();
    const queue = fakeQueue();
    const gateway = fakeGateway();
    gateway.parseWebhook.mockReturnValueOnce({
      kind: 'ignored',
      provider: 'paystack',
      eventType: 'transfer.success',
      providerEventKey: 'transfer.success:abc',
    });
    const service = new PaystackWebhookService(prisma as never, queue as never, gateway as never);

    await service.receive(RAW_BODY, {});

    expect(prisma.webhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ignored' }) }),
    );
    expect(queue.add).not.toHaveBeenCalled();
  });
});
