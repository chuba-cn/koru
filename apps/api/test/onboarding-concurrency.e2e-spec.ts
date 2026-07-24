import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { verifyEmailAndGetCookie } from './auth-utils';
import { truncateAll } from './db-utils';

const PASSWORD = 'correct horse battery';

describe('Onboarding concurrency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Do not read this as the regression test for the P2002 mapping — it cannot
   * reach that branch reliably, because the window between the pre-check and the
   * insert is too narrow over HTTP, so the loser is usually caught by the
   * pre-check. Removing the catch leaves this test green. The branch is covered
   * in onboarding.service.spec.ts, which reaches it directly.
   *
   * What this does prove is that the nested write is atomic: a losing bootstrap
   * leaves no orphan Church behind.
   */
  it('concurrent bootstraps leave exactly one church and no orphan rows', async () => {
    const email = `founder-${Date.now()}@example.test`;
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ name: 'Ada Obi', email, password: PASSWORD })
      .expect(200);

    const cookie = await verifyEmailAndGetCookie(app, email);
    const body = { churchName: 'Celebration Church', fullName: 'Ada Obi' };

    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post('/onboarding/church').set('Cookie', cookie).send(body),
      request(app.getHttpServer()).post('/onboarding/church').set('Cookie', cookie).send(body),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const loser = [first, second].find((r) => r.status === 409);
    expect(loser?.body.error).toBe('CONFLICT');
    expect(loser?.body.message).toMatch(/already administers/i);

    expect(await prisma.church.count()).toBe(1);
    expect(await prisma.staff.count()).toBe(1);
  });
});
