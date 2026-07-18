import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
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
   * Proves the observable contract, not the P2002 branch: the window between the
   * pre-check and the insert is too narrow to hit reliably over HTTP, so the
   * loser here is usually rejected by the pre-check. The unique-constraint path
   * is covered in onboarding.service.spec.ts, which can reach it directly.
   */
  it('two simultaneous bootstraps create one church and return 409, never 500', async () => {
    const email = `founder-${Date.now()}@example.test`;
    const signup = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ name: 'Ada Obi', email, password: PASSWORD })
      .expect(200);

    const cookie = String(signup.headers['set-cookie']);
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
