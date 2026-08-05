import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { LedgerService } from '../src/ledger/ledger.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthedChurch } from './auth-utils';
import { truncateAll } from './db-utils';

describe('Health (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
  });

  beforeEach(async () => {
    await truncateAll(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok with shared-pacakge check', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.sharedCheck).toBe(1000);
  });

  it('GET /health/db reaches the database with empty counts', async () => {
    const res = await request(app.getHttpServer()).get('/health/db').expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      db: 'reachable',
      churches: 0,
      campaigns: 0,
      pledges: 0,
      payments: 0,
    });
  });

  it('GET /health/redis reports reachable against the running Redis', async () => {
    const res = await request(app.getHttpServer()).get('/health/redis').expect(200);
    expect(res.body).toEqual({ status: 'ok', redis: 'reachable' });
  });

  it('GET /health/outbox reports zero backlog with nothing posted', async () => {
    const res = await request(app.getHttpServer()).get('/health/outbox').expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      unpublishedCount: 0,
      oldestUnpublishedAgeSeconds: 0,
      domainEventsWaiting: 0,
      domainEventsFailed: 0,
      relayFailed: 0,
    });
  });

  it('GET /health/outbox reports a real backlog after a real ledger posting', async () => {
    const { churchId } = await createAuthedChurch(app);
    await prisma.$transaction((tx) =>
      ledger.post(tx, {
        churchId,
        reason: 'health check posting',
        entries: [
          {
            account: 'gateway_clearing',
            entryType: 'debit',
            amountKobo: 500_000n,
            dedupeKey: `${churchId}:health-check:clearing`,
          },
          {
            account: 'campaign_giving',
            entryType: 'credit',
            amountKobo: 500_000n,
            dedupeKey: `${churchId}:health-check:giving`,
          },
        ],
        eventPayload: {
          type: 'payment_settled',
          paymentId: '66666666-6666-4666-8666-666666666666',
          churchId,
          campaignId: '22222222-2222-4222-8222-222222222222',
          memberId: null,
          amountKobo: 500_000,
        },
      }),
    );

    const res = await request(app.getHttpServer()).get('/health/outbox').expect(200);
    expect(res.body.unpublishedCount).toBeGreaterThanOrEqual(1);
    expect(res.body.oldestUnpublishedAgeSeconds).toBeGreaterThanOrEqual(0);
  });
});
