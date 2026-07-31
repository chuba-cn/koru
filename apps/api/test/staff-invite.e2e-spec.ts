import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthedChurch, verifyEmailAndGetCookie } from './auth-utils';
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
    await truncateAll(app);
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

  /**
   * MailService.send() writes the EmailLog row synchronously (before enqueueing
   * the BullMQ job that actually delivers it), so this row's existence and
   * content are guaranteed by the time the HTTP response returns — unlike
   * ConsoleMailSender's tail, which only fills in once EmailProcessor's worker
   * picks the job up, asynchronously and on no fixed schedule. Asserting against
   * the row avoids racing that worker.
   */
  it('sends the invite by email, in addition to returning the raw token in the response (#61)', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);
    const staff = await inviteStaff(app, churchId, cookie, 'invitee@example.test');

    const log = await prisma.emailLog.findFirstOrThrow({
      where: { recipientEmail: 'invitee@example.test', category: 'staff_invite' },
    });
    expect(log.recipientStaffId).toBe(staff.id);
    expect(log.renderedHtml).toContain(`token=${staff.invite.token}`);
  });

  it('re-issuing sends a fresh invite email for the new token', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);
    const staff = await inviteStaff(app, churchId, cookie, 'invitee2@example.test');

    const reissued = await request(app.getHttpServer())
      .post(`/churches/${churchId}/staff/${staff.id}/invite`)
      .set('Cookie', cookie)
      .expect(201);

    const logs = await prisma.emailLog.findMany({
      where: { recipientEmail: 'invitee2@example.test', category: 'staff_invite' },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs).toHaveLength(2);
    expect(logs[0].renderedHtml).toContain(`token=${staff.invite.token}`);
    expect(logs[1].renderedHtml).toContain(`token=${reissued.body.token}`);
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
    expect(accepted.body.emailVerificationRequired).toBe(true);
    expect(accepted.headers['set-cookie']).toBeUndefined();

    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email: 'ada@example.test', password: PASSWORD })
      .expect(403);

    const sessionCookie = await verifyEmailAndGetCookie(app, 'ada@example.test');
    expect(sessionCookie).toContain('session_token');

    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email: 'ada@example.test', password: PASSWORD })
      .expect(200);
  });

  it('un-accepted staff cannot reach the church at all', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);
    await inviteStaff(app, churchId, cookie, 'ada@example.test');

    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ name: 'Imposter', email: 'ada@example.test', password: PASSWORD })
      .expect(200);

    const imposterCookie = await verifyEmailAndGetCookie(app, 'ada@example.test');

    await request(app.getHttpServer())
      .get(`/churches/${churchId}/staff`)
      .set('Cookie', imposterCookie)
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
