import { Controller, Get, type INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { truncateAll } from './db-utils';

describe('Error contract (e2e)', () => {
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

  it('404 conforms to the standard shape', async () => {
    const res = await request(app.getHttpServer())
      .get('/churches/6f9619ff-8b86-d011-b42d-00c04fc964ff')
      .expect(404);

    expect(res.body.statusCode).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
    expect(typeof res.body.message).toBe('string');
    expect(res.body.errors).toBeUndefined();
  });

  it('validation 400 conforms and carries per-field errors', async () => {
    const res = await request(app.getHttpServer())
      .post('/churches')
      .send({ name: 'x' })
      .expect(400);

    expect(res.body.statusCode).toBe(400);
    expect(res.body.error).toBe('BAD_REQUEST');
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.errors.name).toBeDefined();
  });

  it('malformed-UUID 400 (ParseUUIDPipe) conforms', async () => {
    const res = await request(app.getHttpServer()).get('/churches/not-a-uuid').expect(400);

    expect(res.body.statusCode).toBe(400);
    expect(res.body.error).toBe('BAD_REQUEST');
    expect(typeof res.body.message).toBe('string');
  });

  it('409 conflict conforms', async () => {
    const church = await request(app.getHttpServer())
      .post('/churches')
      .send({ name: 'Celebration Church' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/churches/${church.body.id}/regions`)
      .send({ name: 'Abuja (FCT)', state: 'FCT' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/churches/${church.body.id}/regions`)
      .send({ name: 'Abuja (FCT)', state: 'FCT' })
      .expect(409);

    expect(res.body.statusCode).toBe(409);
    expect(res.body.error).toBe('CONFLICT');
  });
});

// A throwaway controller that crashes on purpose — same in-test-controller trick
// as the validation spec — to prove unexpected errors are shaped and don't leak.
@Controller('boom')
class BoomController {
  @Get()
  boom() {
    throw new Error('secret internal detail: db password is hunter2');
  }
}

describe('Error contract: unexpected exceptions (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BoomController],
      providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('500 is shaped and leaks nothing internal', async () => {
    const res = await request(app.getHttpServer()).get('/boom').expect(500);

    expect(res.body).toEqual({
      statusCode: 500,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    });

    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });
});
