import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { truncateAll } from './db-utils';

const CREDS = { name: 'Ada Obi', email: 'ada@example.com', password: 'correct horse battery' };

/** Sign up via Better Auth's own endpoint and return the session cookie for later requests. */
async function signUp(app: INestApplication, creds = CREDS): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/sign-up/email')
    .send(creds)
    .expect(200);
  const cookies = res.headers['set-cookie'];
  expect(cookies).toBeDefined();
  return Array.isArray(cookies) ? cookies.join('; ') : String(cookies);
}

describe('Better Auth foundation (e2e)', () => {
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

  it('mounts the Better Auth handler', async () => {
    await request(app.getHttpServer()).get('/api/auth/ok').expect(200);
  });

  it('signs up an account and the session identifies the user', async () => {
    const cookie = await signUp(app);
    const res = await request(app.getHttpServer())
      .get('/api/auth/get-session')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.user.email).toBe(CREDS.email);

    const account = await prisma.account.findFirst();
    expect(account?.password).toBeDefined();
    expect(account?.password).not.toBe(CREDS.password);
  });

  it('signs in with correct credentials and rejects wrong ones', async () => {
    await signUp(app);
    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email: CREDS.email, password: CREDS.password })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email: CREDS.email, password: 'wrong-password' })
      .expect(401);
  });

  it('bootstraps a church: creates Church + linked super_admin Staff atomically', async () => {
    const cookie = await signUp(app);
    const res = await request(app.getHttpServer())
      .post('/onboarding/church')
      .set('Cookie', cookie)
      .send({ churchName: 'Celebration Church', fullName: 'Ada Obi' })
      .expect(201);

    expect(res.body.name).toBe('Celebration Church');
    expect(res.body.timezone).toBe('Africa/Lagos');

    const staff = await prisma.staff.findFirst({ where: { churchId: res.body.id } });
    expect(staff?.role).toBe('super_admin');
    expect(staff?.email).toBe(CREDS.email);
    expect(staff?.userId).toBeTruthy();
  });

  it('rejects bootstrap without a session (401)', async () => {
    await request(app.getHttpServer())
      .post('/onboarding/church')
      .send({ churchName: 'Celebration Church', fullName: 'Ada Obi' })
      .expect(401);
  });

  it('rejects a second church for the same account (409, standard shape)', async () => {
    const cookie = await signUp(app);
    const body = { churchName: 'Celebration Church', fullName: 'Ada Obi' };
    await request(app.getHttpServer())
      .post('/onboarding/church')
      .set('Cookie', cookie)
      .send(body)
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/onboarding/church')
      .set('Cookie', cookie)
      .send({ ...body, churchName: 'Second Church' })
      .expect(409);
    expect(res.body.error).toBe('CONFLICT');
  });
});
