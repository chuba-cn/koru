import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthedChurch } from './auth-utils';
import { truncateAll } from './db-utils';

const PASSWORD = 'correct horse battery';

async function inviteStaff(app: INestApplication, churchId: string, cookie: string, email: string) {
  const res = await request(app.getHttpServer())
    .post(`/churches/${churchId}/staff`)
    .set('Cookie', cookie)
    .send({ fullName: 'Ada Obi', email, role: 'finance' })
    .expect(201);
  return res.body as { id: string; status: string; invite: { token: string; expiresAt: string } };
}

describe('Staff invitations (e2e)', () => {
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

  it('mints a one-time token on creation and stores only its hash', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);
    const staff = await inviteStaff(app, churchId, cookie, 'ada@example.test');

    expect(staff.status).toBe('pending');
    expect(staff.invite.token).toBeTruthy();

    const stored = await prisma.staffInvite.findFirstOrThrow();
    expect(stored.tokenHash).not.toBe(staff.invite.token);
    expect(stored.acceptedAt).toBeNull();

    const rows = JSON.stringify(await prisma.staffInvite.findMany());
    expect(rows).not.toContain(staff.invite.token);
  });

  it('never shows the token again, on any later read', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);
    const staff = await inviteStaff(app, churchId, cookie, 'ada@example.test');

    const list = await request(app.getHttpServer())
      .get(`/churches/${churchId}/staff`)
      .set('Cookie', cookie)
      .expect(200);

    expect(JSON.stringify(list.body)).not.toContain(staff.invite.token);
  });

  it('accepting gives the invitee a working login and activates the record', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);
    const staff = await inviteStaff(app, churchId, cookie, 'ada@example.test');

    const accepted = await request(app.getHttpServer())
      .post('/invites/accept')
      .send({ token: staff.invite.token, password: PASSWORD })
      .expect(201);

    expect(accepted.body.status).toBe('active');

    const sessionCookie = accepted.headers['set-cookie'];
    expect(String(sessionCookie)).toContain('session_token');

    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email: 'ada@example.test', password: PASSWORD })
      .expect(200);
  });

  it('un-accepted staff cannot reach the church at all', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);
    await inviteStaff(app, churchId, cookie, 'ada@example.test');

    const signup = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ name: 'Imposter', email: 'ada@example.test', password: PASSWORD })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/churches/${churchId}/staff`)
      .set('Cookie', String(signup.headers['set-cookie']))
      .expect(403);
  });

  it('a token cannot be used twice', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);
    const staff = await inviteStaff(app, churchId, cookie, 'ada@example.test');

    await request(app.getHttpServer())
      .post('/invites/accept')
      .send({ token: staff.invite.token, password: PASSWORD })
      .expect(201);

    await request(app.getHttpServer())
      .post('/invites/accept')
      .send({ token: staff.invite.token, password: PASSWORD })
      .expect(400);
  });

  it('an expired token is rejected', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);
    const staff = await inviteStaff(app, churchId, cookie, 'ada@example.test');

    await prisma.staffInvite.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    await request(app.getHttpServer())
      .post('/invites/accept')
      .send({ token: staff.invite.token, password: PASSWORD })
      .expect(400);
  });

  it('revoking kills the token', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);
    const staff = await inviteStaff(app, churchId, cookie, 'ada@example.test');

    await request(app.getHttpServer())
      .delete(`/churches/${churchId}/staff/${staff.id}/invite`)
      .set('Cookie', cookie)
      .expect(204);

    await request(app.getHttpServer())
      .post('/invites/accept')
      .send({ token: staff.invite.token, password: PASSWORD })
      .expect(400);
  });

  it('re-issuing invalidates the previous token', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);
    const staff = await inviteStaff(app, churchId, cookie, 'ada@example.test');

    const reissued = await request(app.getHttpServer())
      .post(`/churches/${churchId}/staff/${staff.id}/invite`)
      .set('Cookie', cookie)
      .expect(201);

    expect(reissued.body.token).not.toBe(staff.invite.token);

    await request(app.getHttpServer())
      .post('/invites/accept')
      .send({ token: staff.invite.token, password: PASSWORD })
      .expect(400);

    await request(app.getHttpServer())
      .post('/invites/accept')
      .send({ token: reissued.body.token, password: PASSWORD })
      .expect(201);
  });

  it('only a super_admin of that church can re-issue or revoke', async () => {
    const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
    const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });
    const staff = await inviteStaff(app, alice.churchId, alice.cookie, 'ada@example.test');

    await request(app.getHttpServer())
      .post(`/churches/${bob.churchId}/staff/${staff.id}/invite`)
      .set('Cookie', bob.cookie)
      .expect(404);

    await prisma.staff.update({ where: { id: alice.staffId }, data: { role: 'finance' } });

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff/${staff.id}/invite`)
      .set('Cookie', alice.cookie)
      .expect(403);
  });
});
