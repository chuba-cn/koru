import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthedChurch, verifyEmailAndGetCookie } from './auth-utils';
import { truncateAll } from './db-utils';

const PASSWORD = 'correct horse battery';
const VICTIM = 'treasurer@example-church.test';

async function signUp(app: INestApplication, email: string, name = 'Squatter') {
  return request(app.getHttpServer())
    .post('/api/auth/sign-up/email')
    .send({ name, email, password: PASSWORD })
    .expect(200);
}

async function addStaff(app: INestApplication, churchId: string, cookie: string, email: string) {
  const res = await request(app.getHttpServer())
    .post(`/churches/${churchId}/staff`)
    .set('Cookie', cookie)
    .send({ fullName: 'Ada Obi', email, role: 'finance' });
  return res;
}

describe('Invite email squatting (e2e)', () => {
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
   * The original #33 scenario, updated for #59/#62: a squatter who never verifies
   * can never sign in at all, so the recovery is deleting their inert login and
   * re-inviting — clear-login, not reclaim. Start to finish through HTTP only.
   */
  it('recovers from an unverified squatted email end to end, using only the API', async () => {
    await signUp(app, VICTIM);
    const squatterId = (await prisma.user.findFirstOrThrow({ where: { email: VICTIM } })).id;

    const { cookie, churchId } = await createAuthedChurch(app);

    const staff = await addStaff(app, churchId, cookie, VICTIM);
    expect(staff.status).toBe(201);

    const blocked = await request(app.getHttpServer())
      .post('/invites/accept')
      .send({ token: staff.body.invite.token, password: PASSWORD });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/clear/i);

    const cleared = await request(app.getHttpServer())
      .post(`/churches/${churchId}/staff/${staff.body.id}/invite/clear-login`)
      .set('Cookie', cookie)
      .expect(201);

    expect(cleared.body.token).toBeTruthy();
    expect(await prisma.user.count({ where: { email: VICTIM } })).toBe(0);

    const accepted = await request(app.getHttpServer())
      .post('/invites/accept')
      .send({ token: cleared.body.token, password: PASSWORD })
      .expect(201);

    expect(accepted.body.emailVerificationRequired).toBe(true);
    expect(accepted.headers['set-cookie']).toBeUndefined();

    const linked = await prisma.staff.findFirstOrThrow({ where: { email: VICTIM } });
    expect(linked.userId).toBeTruthy();
    expect(linked.userId).not.toBe(squatterId);
  });

  /**
   * The other half of #62's collision resolution: a squatter who HAS verified is
   * a real, proven person — clear-login refuses them, and the recovery is an
   * admin linking that proven login instead of destroying it.
   */
  it('recovers from a verified squatted email via authenticated linking, not deletion', async () => {
    await signUp(app, VICTIM);
    const squatterCookie = await verifyEmailAndGetCookie(app, VICTIM);
    const squatterId = (await prisma.user.findFirstOrThrow({ where: { email: VICTIM } })).id;

    const { cookie, churchId } = await createAuthedChurch(app);

    const staff = await addStaff(app, churchId, cookie, VICTIM);
    expect(staff.status).toBe(201);

    const blocked = await request(app.getHttpServer())
      .post('/invites/accept')
      .send({ token: staff.body.invite.token, password: PASSWORD });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/link/i);

    const linked = await request(app.getHttpServer())
      .post(`/churches/${churchId}/staff/${staff.body.id}/link-login`)
      .set('Cookie', cookie)
      .send({ email: VICTIM })
      .expect(200);

    expect(linked.body.status).toBe('active');

    const linkedRow = await prisma.staff.findFirstOrThrow({ where: { email: VICTIM } });
    expect(linkedRow.userId).toBe(squatterId);

    // The invitee's own pre-existing session still works — nothing about linking
    // touched their account, it only attached the church's staff row to it.
    const session = await request(app.getHttpServer())
      .get('/api/auth/get-session')
      .set('Cookie', squatterCookie)
      .expect(200);
    expect(session.body.user.email).toBe(VICTIM);

    // The now-spent invite token can no longer be accepted.
    await request(app.getHttpServer())
      .post('/invites/accept')
      .send({ token: staff.body.invite.token, password: PASSWORD })
      .expect(400);
  });

  it('does not tell an unauthenticated caller whether an email has a login', async () => {
    await signUp(app, VICTIM);
    const { cookie, churchId } = await createAuthedChurch(app);

    const taken = await addStaff(app, churchId, cookie, VICTIM);
    const free = await addStaff(app, churchId, cookie, 'nobody@example.test');

    expect(taken.status).toBe(201);
    expect(free.status).toBe(201);
  });

  it('never deletes an unverified login that owns a staff record elsewhere', async () => {
    const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });

    await signUp(app, VICTIM);
    const squatter = await prisma.user.findFirstOrThrow({ where: { email: VICTIM } });

    // Simulates a data state assertOwnsNothing must defend against regardless of how
    // it arose: an unverified login already attached to some OTHER staff row.
    const owner = await addStaff(app, bob.churchId, bob.cookie, 'owns-a-record@example.test');
    await prisma.staff.update({ where: { id: owner.body.id }, data: { userId: squatter.id } });

    const target = await addStaff(app, bob.churchId, bob.cookie, VICTIM);

    const res = await request(app.getHttpServer())
      .post(`/churches/${bob.churchId}/staff/${target.body.id}/invite/clear-login`)
      .set('Cookie', bob.cookie);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/belongs to an existing person/i);
    expect(await prisma.user.count({ where: { email: VICTIM } })).toBe(1);
  });

  it('only a super_admin of that church can clear-login', async () => {
    const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
    const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });
    await signUp(app, VICTIM);
    const staff = await addStaff(app, alice.churchId, alice.cookie, VICTIM);

    // Bob aiming at Alice's church: TenantGuard rejects before any lookup.
    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff/${staff.body.id}/invite/clear-login`)
      .set('Cookie', bob.cookie)
      .expect(403);

    // Bob aiming at his own church with her staff id: the scoped lookup misses.
    await request(app.getHttpServer())
      .post(`/churches/${bob.churchId}/staff/${staff.body.id}/invite/clear-login`)
      .set('Cookie', bob.cookie)
      .expect(404);

    await prisma.staff.update({ where: { id: alice.staffId }, data: { role: 'finance' } });

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff/${staff.body.id}/invite/clear-login`)
      .set('Cookie', alice.cookie)
      .expect(403);
  });

  it('accepting twice concurrently provisions exactly one login', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);
    const staff = await addStaff(app, churchId, cookie, VICTIM);
    const token = staff.body.invite.token;

    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post('/invites/accept').send({ token, password: PASSWORD }),
      request(app.getHttpServer()).post('/invites/accept').send({ token, password: PASSWORD }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 400]);

    expect(await prisma.user.count({ where: { email: VICTIM } })).toBe(1);
    expect(await prisma.staffInvite.count({ where: { acceptedAt: { not: null } } })).toBe(1);
  });

  it('records which login an accepted invite provisioned', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);
    const staff = await addStaff(app, churchId, cookie, VICTIM);

    await request(app.getHttpServer())
      .post('/invites/accept')
      .send({ token: staff.body.invite.token, password: PASSWORD })
      .expect(201);

    const invite = await prisma.staffInvite.findFirstOrThrow();
    const linked = await prisma.staff.findFirstOrThrow({ where: { email: VICTIM } });

    expect(invite.provisionedUserId).toBe(linked.userId);
  });
});
