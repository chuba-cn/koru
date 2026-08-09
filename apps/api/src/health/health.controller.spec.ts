import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController wiring', () => {
  /**
   * A health check must answer even when Better Auth or the session store is
   * down, which is exactly the situation an uptime monitor calls this for.
   */
  it('is public at the class level, so both routes work without a session', () => {
    expect(Reflect.getMetadata('PUBLIC', HealthController)).toBe(true);
  });

  it('carries no tenant or role guard', () => {
    const guardsOf = (target: object) =>
      (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

    expect(guardsOf(HealthController)).toEqual([]);
  });
});

describe('HealthController.checkRedis', () => {
  it('reports ok when the queue client pings successfully', async () => {
    const emailQueue = { client: Promise.resolve({ info: vi.fn().mockResolvedValue('# Server') }) };
    const controller = new HealthController(
      {} as never,
      emailQueue as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(controller.checkRedis()).resolves.toEqual({ status: 'ok', redis: 'reachable' });
  });

  it('reports error when the ping itself fails, not just an unresolved client', async () => {
    const emailQueue = {
      client: Promise.resolve({ info: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) }),
    };
    const controller = new HealthController(
      {} as never,
      emailQueue as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(controller.checkRedis()).resolves.toEqual({
      status: 'error',
      redis: 'unreachable',
    });
  });
});

describe('HealthController.checkOutbox', () => {
  it('reports zero backlog when nothing is unpublished', async () => {
    const prisma = {
      domainEvent: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const domainEventsQueue = {
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, failed: 0 }),
    };
    const relayQueue = { getJobCounts: vi.fn().mockResolvedValue({ failed: 0 }) };
    const controller = new HealthController(
      prisma as never,
      {} as never,
      domainEventsQueue as never,
      relayQueue as never,
      {} as never,
      {} as never,
    );

    await expect(controller.checkOutbox()).resolves.toEqual({
      status: 'ok',
      unpublishedCount: 0,
      oldestUnpublishedAgeSeconds: 0,
      domainEventsWaiting: 0,
      domainEventsFailed: 0,
      relayFailed: 0,
    });
  });

  it('reports the age of the oldest unpublished event and both queues failed counts, not just a total', async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const prisma = {
      domainEvent: {
        count: vi.fn().mockResolvedValue(3),
        findFirst: vi.fn().mockResolvedValue({ createdAt: fiveMinutesAgo }),
      },
    };
    const domainEventsQueue = {
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 2, failed: 1 }),
    };
    const relayQueue = { getJobCounts: vi.fn().mockResolvedValue({ failed: 4 }) };
    const controller = new HealthController(
      prisma as never,
      {} as never,
      domainEventsQueue as never,
      relayQueue as never,
      {} as never,
      {} as never,
    );

    const result = await controller.checkOutbox();

    expect(result.unpublishedCount).toBe(3);
    expect(result.oldestUnpublishedAgeSeconds).toBeGreaterThanOrEqual(295);
    expect(result.domainEventsWaiting).toBe(2);
    expect(result.domainEventsFailed).toBe(1);
    expect(result.relayFailed).toBe(4);
  });
});

describe('HealthController.checkPayments', () => {
  it('reports zero backlog when nothing is stuck', async () => {
    const prisma = {
      webhookEvent: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      paymentAttempt: { count: vi.fn().mockResolvedValue(0) },
    };
    const paymentWebhooksQueue = {
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, failed: 0 }),
    };
    const paymentExpiryQueue = { getJobCounts: vi.fn().mockResolvedValue({ failed: 0 }) };
    const controller = new HealthController(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      paymentWebhooksQueue as never,
      paymentExpiryQueue as never,
    );

    await expect(controller.checkPayments()).resolves.toEqual({
      status: 'ok',
      webhooksAwaitingProcessing: 0,
      oldestUnprocessedWebhookAgeSeconds: 0,
      paymentWebhooksWaiting: 0,
      paymentWebhooksFailed: 0,
      expirySweepFailed: 0,
      attemptsPendingPastExpiry: 0,
    });
  });

  it('reports the age of the oldest unprocessed webhook and the past-expiry backlog', async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const prisma = {
      webhookEvent: {
        count: vi.fn().mockResolvedValue(2),
        findFirst: vi.fn().mockResolvedValue({ receivedAt: tenMinutesAgo }),
      },
      paymentAttempt: { count: vi.fn().mockResolvedValue(5) },
    };
    const paymentWebhooksQueue = {
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 1, failed: 3 }),
    };
    const paymentExpiryQueue = { getJobCounts: vi.fn().mockResolvedValue({ failed: 1 }) };
    const controller = new HealthController(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      paymentWebhooksQueue as never,
      paymentExpiryQueue as never,
    );

    const result = await controller.checkPayments();

    expect(result.webhooksAwaitingProcessing).toBe(2);
    expect(result.oldestUnprocessedWebhookAgeSeconds).toBeGreaterThanOrEqual(595);
    expect(result.paymentWebhooksWaiting).toBe(1);
    expect(result.paymentWebhooksFailed).toBe(3);
    expect(result.expirySweepFailed).toBe(1);
    expect(result.attemptsPendingPastExpiry).toBe(5);
  });
});
