import { UnauthorizedException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));

vi.mock('resend', () => ({
  Resend: class {
    webhooks = { verify };
  },
}));

afterEach(() => {
  verify.mockReset();
});

function fakePrisma(log: { id: string } | null = { id: 'log-1' }) {
  return {
    emailLog: {
      findFirst: vi.fn(() => Promise.resolve(log)),
      update: vi.fn((_args: { where: { id: string }; data: Record<string, unknown> }) =>
        Promise.resolve(),
      ),
    },
  };
}

const HEADERS = {
  'webhook-id': 'msg-1',
  'webhook-timestamp': '1700000000',
  'webhook-signature': 'v1,valid-signature',
};

describe('ResendWebhookService.handle', () => {
  it('rejects an invalid signature before touching the database', async () => {
    verify.mockImplementation(() => {
      throw new Error('bad signature');
    });
    const { ResendWebhookService } = await import('./resend-webhook.service.js');
    const prisma = fakePrisma();
    const service = new ResendWebhookService(prisma as never);

    await expect(service.handle(Buffer.from('{}'), HEADERS)).rejects.toThrow(UnauthorizedException);
    expect(prisma.emailLog.findFirst).not.toHaveBeenCalled();
    expect(prisma.emailLog.update).not.toHaveBeenCalled();
  });

  it('sets status delivered and deliveredAt on a verified email.delivered event', async () => {
    verify.mockReturnValue({ type: 'email.delivered', data: { email_id: 'msg-1' } });
    const { ResendWebhookService } = await import('./resend-webhook.service.js');
    const prisma = fakePrisma({ id: 'log-1' });
    const service = new ResendWebhookService(prisma as never);

    await service.handle(Buffer.from('{}'), HEADERS);

    expect(prisma.emailLog.update).toHaveBeenCalledWith({
      where: { id: 'log-1' },
      data: { status: 'delivered', deliveredAt: expect.any(Date) },
    });
  });

  it.each([
    'email.bounced',
    'email.complained',
    'email.failed',
  ])('sets status on a %s event without touching deliveredAt', async (type) => {
    verify.mockReturnValue({ type, data: { email_id: 'msg-1' } });
    const { ResendWebhookService } = await import('./resend-webhook.service.js');
    const prisma = fakePrisma({ id: 'log-1' });
    const service = new ResendWebhookService(prisma as never);

    await service.handle(Buffer.from('{}'), HEADERS);

    const call = prisma.emailLog.update.mock.calls[0]?.[0];
    expect(call.data).not.toHaveProperty('deliveredAt');
  });

  it('acknowledges an unmapped email event type without any EmailLog write', async () => {
    verify.mockReturnValue({ type: 'email.opened', data: { email_id: 'msg-1' } });
    const { ResendWebhookService } = await import('./resend-webhook.service.js');
    const prisma = fakePrisma();
    const service = new ResendWebhookService(prisma as never);

    await service.handle(Buffer.from('{}'), HEADERS);

    expect(prisma.emailLog.findFirst).not.toHaveBeenCalled();
    expect(prisma.emailLog.update).not.toHaveBeenCalled();
  });

  it('acknowledges a non-email event (no email_id) without any EmailLog write', async () => {
    verify.mockReturnValue({ type: 'domain.created', data: { id: 'dom_1' } });
    const { ResendWebhookService } = await import('./resend-webhook.service.js');
    const prisma = fakePrisma();
    const service = new ResendWebhookService(prisma as never);

    await service.handle(Buffer.from('{}'), HEADERS);

    expect(prisma.emailLog.findFirst).not.toHaveBeenCalled();
    expect(prisma.emailLog.update).not.toHaveBeenCalled();
  });

  it('does not throw, and does not write, when the provider message id matches no EmailLog row', async () => {
    verify.mockReturnValue({ type: 'email.delivered', data: { email_id: 'unknown-id' } });
    const { ResendWebhookService } = await import('./resend-webhook.service.js');
    const prisma = fakePrisma(null);
    const service = new ResendWebhookService(prisma as never);

    await expect(service.handle(Buffer.from('{}'), HEADERS)).resolves.toBeUndefined();
    expect(prisma.emailLog.update).not.toHaveBeenCalled();
  });
});
