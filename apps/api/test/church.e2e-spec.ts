import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { truncateAll } from './db-utils';

describe('Churches (e2e)', () => {
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

  it('creates a church with defaults and reads it back', async () => {
    const created = await request(app.getHttpServer())
      .post('/churches')
      .send({ name: 'Celebration Church' })
      .expect(201);

    expect(created.body.name).toBe('Celebration Church');
    expect(created.body.timezone).toBe('Africa/Lagos');
    expect(created.body.id).toBeDefined();

    const fetched = await request(app.getHttpServer())
      .get(`/churches/${created.body.id}`)
      .expect(200);
    expect(fetched.body).toMatchObject({ id: created.body.id, name: 'Celebration Church' });
  });

  it('updates name and timezone; changes persist', async () => {
    const { body: church } = await request(app.getHttpServer())
      .post('/churches')
      .send({ name: 'Celebration Church', timezone: 'Africa/Lagos' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/churches/${church.id}`)
      .send({ name: 'Celebration Church Intl' })
      .expect(200);

    const { body: after } = await request(app.getHttpServer())
      .get(`/churches/${church.id}`)
      .expect(200);
    expect(after.name).toBe('Celebration Church Intl');
    expect(after.timezone).toBe('Africa/Lagos');
  });

  it('rejects an invalid body with per-field errors', async () => {
    const res = await request(app.getHttpServer())
      .post('/churches')
      .send({ name: 'x' })
      .expect(400);
    expect(res.body.errors.name).toBeDefined();
  });

  it('404s on unknown id and 400s on malformed id', async () => {
    await request(app.getHttpServer())
      .get('/churches/6f9619ff-8b86-d011-b42d-00c04fc964ff')
      .expect(404);
    await request(app.getHttpServer()).get('/churches/not-a-uuid').expect(400);
  });
});
