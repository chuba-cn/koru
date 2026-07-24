import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RECLAIM_GRACE_MS } from '../src/staff/staff.service';
import { createAuthedChurch } from './auth-utils';
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

/** Backdates the login past the grace period, which otherwise blocks reclaim. */
async function ageLogin(prisma: PrismaService, email: string) {
  await prisma.user.updateMany({
    where: { email },
    data: { createdAt: new Date(Date.now() - RECLAIM_GRACE_MS - 60_000) },
  });
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
   * The exact scenario from #33, start to finish, through HTTP only. Any step
   * that needs raw database access to proceed means the API has no real
   * recovery path and the bug is not fixed.
   */
  it('recovers from a squatted email end to end, using only the API', async () => {
    await signUp(app, VICTIM);
    await ageLogin(prisma, VICTIM);
    const squatterId = (await prisma.user.findFirstOrThrow({ where: { email: VICTIM } })).id;

    const { cookie, churchId } = await createAuthedChurch(app);

    const staff = await addStaff(app, churchId, cookie, VICTIM);
    expect(staff.status).toBe(201);

    const blocked = await request(app.getHttpServer())
      .post('/invites/accept')
      .send({ token: staff.body.invite.token, password: PASSWORD });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/reclaim/i);

    const reclaimed = await request(app.getHttpServer())
      .post(`/churches/${churchId}/staff/${staff.body.id}/invite/reclaim`)
      .set('Cookie', cookie)
      .expect(201);

    expect(reclaimed.body.token).toBeTruthy();
    expect(await prisma.user.count({ where: { email: VICTIM } })).toBe(0);

    const accepted = await request(app.getHttpServer())
      .post('/invites/accept')
      .send({ token: reclaimed.body.token, password: PASSWORD })
      .expect(201);

    expect(accepted.body.status).toBe('active');
    expect(accepted.headers['set-cookie']).toBeUndefined();

    const linked = await prisma.staff.findFirstOrThrow({ where: { email: VICTIM } });
    expect(linked.userId).toBeTruthy();
    expect(linked.userId).not.toBe(squatterId);
  });

  it('does not tell an unauthenticated caller whether an email has a login', async () => {
    await signUp(app, VICTIM);
    const { cookie, churchId } = await createAuthedChurch(app);

    const taken = await addStaff(app, churchId, cookie, VICTIM);
    const free = await addStaff(app, churchId, cookie, 'nobody@example.test');

    expect(taken.status).toBe(201);
    expect(free.status).toBe(201);
  });

  it('never deletes a login that owns a staff record', async () => {
    const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
    const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });

    const staff = await addStaff(app, bob.churchId, bob.cookie, 'pending@example.test');
    expect(staff.status).toBe(201);

    await prisma.staff.update({
      where: { id: staff.body.id },
      data: { email: alice.email },
    });
    await ageLogin(prisma, alice.email);

    const res = await request(app.getHttpServer())
      .post(`/churches/${bob.churchId}/staff/${staff.body.id}/invite/reclaim`)
      .set('Cookie', bob.cookie);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/belongs to an existing person/i);
    expect(await prisma.user.count({ where: { email: alice.email } })).toBe(1);
  });

  it('refuses to reclaim a login created moments ago, which may be a founder mid-signup', async () => {
    await signUp(app, VICTIM);
    const { cookie, churchId } = await createAuthedChurch(app);

    await prisma.user.deleteMany({ where: { email: VICTIM } });
    const staff = await addStaff(app, churchId, cookie, VICTIM);
    await signUp(app, VICTIM, 'Founder Mid Signup');

    const res = await request(app.getHttpServer())
      .post(`/churches/${churchId}/staff/${staff.body.id}/invite/reclaim`)
      .set('Cookie', cookie);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/very recently/i);
    expect(await prisma.user.count({ where: { email: VICTIM } })).toBe(1);
  });

  it('only a super_admin of that church can reclaim', async () => {
    const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
    const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });
    const staff = await addStaff(app, alice.churchId, alice.cookie, VICTIM);

    // Bob aiming at Alice's church: TenantGuard rejects before any lookup.
    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff/${staff.body.id}/invite/reclaim`)
      .set('Cookie', bob.cookie)
      .expect(403);

    // Bob aiming at his own church with her staff id: the scoped lookup misses.
    await request(app.getHttpServer())
      .post(`/churches/${bob.churchId}/staff/${staff.body.id}/invite/reclaim`)
      .set('Cookie', bob.cookie)
      .expect(404);

    await prisma.staff.update({ where: { id: alice.staffId }, data: { role: 'finance' } });

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff/${staff.body.id}/invite/reclaim`)
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
