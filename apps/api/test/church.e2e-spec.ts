import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createAuthedChurch } from './auth-utils';
import { truncateAll } from './db-utils';

describe('Churches (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await truncateAll(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('reads the church back after bootstrap', async () => {
    const { cookie, churchId } = await createAuthedChurch(app, {
      churchName: 'Celebration Church',
    });

    const res = await request(app.getHttpServer())
      .get(`/churches/${churchId}`)
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.name).toBe('Celebration Church');
    expect(res.body.timezone).toBe('Africa/Lagos');
    expect(res.body.id).toBe(churchId);
  });

  it('updates name and timezone; changes persist', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);

    await request(app.getHttpServer())
      .patch(`/churches/${churchId}`)
      .set('Cookie', cookie)
      .send({ name: 'Celebration Church Intl' })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get(`/churches/${churchId}`)
      .set('Cookie', cookie)
      .expect(200);

    expect(after.body.name).toBe('Celebration Church Intl');
  });

  it('403s on a churchId that does not belong to the session (guard fires before pipe)', async () => {
    const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
    const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });

    const res = await request(app.getHttpServer())
      .get(`/churches/${bob.churchId}`)
      .set('Cookie', alice.cookie)
      .expect(403);

    expect(res.body.error).toBe('FORBIDDEN');
  });
});
