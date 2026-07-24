import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { truncateAll } from './db-utils';

describe('Health (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
});
