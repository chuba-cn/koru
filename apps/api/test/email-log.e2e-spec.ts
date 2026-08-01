import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthedChurch } from './auth-utils';
import { truncateAll } from './db-utils';

async function inviteStaff(app: INestApplication, churchId: string, cookie: string, email: string) {
  const res = await request(app.getHttpServer())
    .post(`/churches/${churchId}/staff`)
    .set('Cookie', cookie)
    .send({ fullName: 'Ada Obi', email, role: 'finance' })
    .expect(201);
  return res.body as { id: string };
}

describe('Email logs (e2e, #69/#70/#68)', () => {
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

  it('logs the church welcome email on onboarding, visible to a super_admin (#69)', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);

    const list = await request(app.getHttpServer())
      .get(`/churches/${churchId}/email-logs`)
      .set('Cookie', cookie)
      .expect(200);

    const welcome = list.body.items.find(
      (item: { category: string }) => item.category === 'church_welcome',
    );
    expect(welcome).toBeTruthy();
    // 'sent' the moment the async worker beats this GET to it, 'queued'
    // otherwise — either is fine, 'failed' is the only wrong outcome here.
    expect(welcome.status).not.toBe('failed');
  });

  it('logs the staff-removed email when a staff member is removed (#70)', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);
    const staff = await inviteStaff(app, churchId, cookie, 'ada@example.test');

    await request(app.getHttpServer())
      .delete(`/churches/${churchId}/staff/${staff.id}`)
      .set('Cookie', cookie)
      .expect(204);

    const list = await request(app.getHttpServer())
      .get(`/churches/${churchId}/email-logs`)
      .set('Cookie', cookie)
      .expect(200);

    const removed = list.body.items.find(
      (item: { category: string }) => item.category === 'staff_removed',
    );
    expect(removed).toBeTruthy();
    expect(removed.recipientEmail).toBe('ada@example.test');
  });

  it('a recorder cannot list email logs — admin-tier only (#68)', async () => {
    const { cookie, churchId, staffId } = await createAuthedChurch(app);
    await prisma.staff.update({ where: { id: staffId }, data: { role: 'recorder' } });

    await request(app.getHttpServer())
      .get(`/churches/${churchId}/email-logs`)
      .set('Cookie', cookie)
      .expect(403);
  });

  it('resends a failed email verbatim, and rejects resending one that already delivered', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);
    const list = await request(app.getHttpServer())
      .get(`/churches/${churchId}/email-logs`)
      .set('Cookie', cookie)
      .expect(200);
    const welcome = list.body.items[0];

    await prisma.emailLog.update({ where: { id: welcome.id }, data: { status: 'delivered' } });
    await request(app.getHttpServer())
      .post(`/churches/${churchId}/email-logs/${welcome.id}/resend`)
      .set('Cookie', cookie)
      .expect(409);

    await prisma.emailLog.update({ where: { id: welcome.id }, data: { status: 'failed' } });
    await request(app.getHttpServer())
      .post(`/churches/${churchId}/email-logs/${welcome.id}/resend`)
      .set('Cookie', cookie)
      .expect(201);

    const logs = await prisma.emailLog.findMany({
      where: { churchId, category: 'church_welcome' },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs).toHaveLength(2);
    expect(logs[1].renderedHtml).toBe(logs[0].renderedHtml);
  });

  it('404s resending a log from a church the caller does not belong to', async () => {
    const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
    const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });

    const list = await request(app.getHttpServer())
      .get(`/churches/${alice.churchId}/email-logs`)
      .set('Cookie', alice.cookie)
      .expect(200);
    const aliceLog = list.body.items[0];
    await prisma.emailLog.update({ where: { id: aliceLog.id }, data: { status: 'failed' } });

    await request(app.getHttpServer())
      .post(`/churches/${bob.churchId}/email-logs/${aliceLog.id}/resend`)
      .set('Cookie', bob.cookie)
      .expect(404);
  });
});
