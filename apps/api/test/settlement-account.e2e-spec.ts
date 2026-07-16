import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthedChurch } from './auth-utils';
import { truncateAll } from './db-utils';

async function createBranch(
  app: INestApplication,
  churchId: string,
  cookie: string,
  name = 'KORU Abuja',
) {
  const res = await request(app.getHttpServer())
    .post(`/churches/${churchId}/branches`)
    .set('Cookie', cookie)
    .send({ name })
    .expect(201);
  return res.body as { id: string };
}

describe('Settlement accounts (e2e)', () => {
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

  it('records a church-wide account and masks the number', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);

    const res = await request(app.getHttpServer())
      .post(`/churches/${churchId}/settlement-accounts`)
      .set('Cookie', cookie)
      .send({ label: 'General Offering', accountNumber: '0123456789', bankName: 'Wema Bank' })
      .expect(201);

    expect(res.body.label).toBe('General Offering');
    expect(res.body.branchId).toBeNull();
    expect(res.body.accountNumberMasked).toBe('******6789');
    expect(JSON.stringify(res.body)).not.toContain('0123456789');
    expect(res.body.paystackSubaccountCode).toBeUndefined();
  });

  it('never persists the full account number (only the mask reaches the DB)', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);

    await request(app.getHttpServer())
      .post(`/churches/${churchId}/settlement-accounts`)
      .set('Cookie', cookie)
      .send({ label: 'Rent', accountNumber: '9988776655', bankName: 'GTBank' })
      .expect(201);

    const row = await prisma.settlementAccount.findFirstOrThrow();
    expect(row.accountNumberMasked).toBe('******6655');
    expect(JSON.stringify(row)).not.toContain('9988776655');
  });

  it('records a branch-level account', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);
    const branch = await createBranch(app, churchId, cookie);

    const res = await request(app.getHttpServer())
      .post(`/churches/${churchId}/settlement-accounts`)
      .set('Cookie', cookie)
      .send({
        label: 'KORU Abuja Rent',
        accountNumber: '0123456789',
        bankName: 'Wema Bank',
        branchId: branch.id,
      })
      .expect(201);

    expect(res.body.branchId).toBe(branch.id);
  });

  it('rejects a branchId from another church (400)', async () => {
    const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
    const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });
    const branchB = await createBranch(app, bob.churchId, bob.cookie);

    const res = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/settlement-accounts`)
      .set('Cookie', alice.cookie)
      .send({
        label: 'Cross-church',
        accountNumber: '0123456789',
        bankName: 'Wema',
        branchId: branchB.id,
      })
      .expect(400);

    expect(res.body.error).toBe('BAD_REQUEST');
    expect(res.body.message).toContain('branch');
  });

  it('rejects a non-10-digit account number (400 with field error)', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);

    const res = await request(app.getHttpServer())
      .post(`/churches/${churchId}/settlement-accounts`)
      .set('Cookie', cookie)
      .send({ label: 'Short', accountNumber: '123', bankName: 'Wema' })
      .expect(400);

    expect(res.body.errors.accountNumber).toBeDefined();
  });

  it('lists accounts and filters by branch', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);
    const branch = await createBranch(app, churchId, cookie);

    await request(app.getHttpServer())
      .post(`/churches/${churchId}/settlement-accounts`)
      .set('Cookie', cookie)
      .send({ label: 'General', accountNumber: '0123456789', bankName: 'Wema' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/churches/${churchId}/settlement-accounts`)
      .set('Cookie', cookie)
      .send({
        label: 'Branch Rent',
        accountNumber: '1112223334',
        bankName: 'GTB',
        branchId: branch.id,
      })
      .expect(201);

    const all = await request(app.getHttpServer())
      .get(`/churches/${churchId}/settlement-accounts`)
      .set('Cookie', cookie)
      .expect(200);

    expect(all.body).toHaveLength(2);

    const filtered = await request(app.getHttpServer())
      .get(`/churches/${churchId}/settlement-accounts?branchId=${branch.id}`)
      .set('Cookie', cookie)
      .expect(200);

    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0].label).toBe('Branch Rent');
  });

  it('updates the label', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);

    const acct = await request(app.getHttpServer())
      .post(`/churches/${churchId}/settlement-accounts`)
      .set('Cookie', cookie)
      .send({ label: 'General', accountNumber: '0123456789', bankName: 'Wema' })
      .expect(201);

    const updated = await request(app.getHttpServer())
      .patch(`/churches/${churchId}/settlement-accounts/${acct.body.id}`)
      .set('Cookie', cookie)
      .send({ label: 'General Offering Account' })
      .expect(200);

    expect(updated.body.label).toBe('General Offering Account');
    expect(updated.body.accountNumberMasked).toBe('******6789');
  });

  it('isolates tenants (church B sees/touches nothing of A)', async () => {
    const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
    const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });

    const acct = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/settlement-accounts`)
      .set('Cookie', alice.cookie)
      .send({ label: 'General', accountNumber: '0123456789', bankName: 'Wema' })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(`/churches/${bob.churchId}/settlement-accounts`)
      .set('Cookie', bob.cookie)
      .expect(200);

    expect(list.body).toHaveLength(0);

    await request(app.getHttpServer())
      .patch(`/churches/${bob.churchId}/settlement-accounts/${acct.body.id}`)
      .set('Cookie', bob.cookie)
      .send({ label: 'Hijacked' })
      .expect(404);
  });
});
