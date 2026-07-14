import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { truncateAll } from './db-utils';

async function createChurch(app: INestApplication, name = 'Celebration Church') {
  const res = await request(app.getHttpServer()).post('/churches').send({ name }).expect(201);
  return res.body as { id: string };
}

async function createBranch(app: INestApplication, churchId: string, name = 'KORU Abuja') {
  const res = await request(app.getHttpServer())
    .post(`/churches/${churchId}/branches`)
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
    const church = await createChurch(app);
    const res = await request(app.getHttpServer())
      .post(`/churches/${church.id}/settlement-accounts`)
      .send({ label: 'General Offering', accountNumber: '0123456789', bankName: 'Wema Bank' })
      .expect(201);

    expect(res.body.label).toBe('General Offering');
    expect(res.body.branchId).toBeNull();
    expect(res.body.accountNumberMasked).toBe('******6789');
    expect(JSON.stringify(res.body)).not.toContain('0123456789');
    expect(res.body.paystackSubaccountCode).toBeUndefined();
  });

  it('never persists the full account number (only the mask reaches the DB)', async () => {
    const church = await createChurch(app);
    await request(app.getHttpServer())
      .post(`/churches/${church.id}/settlement-accounts`)
      .send({ label: 'Rent', accountNumber: '9988776655', bankName: 'GTBank' })
      .expect(201);

    const row = await prisma.settlementAccount.findFirstOrThrow();
    expect(row.accountNumberMasked).toBe('******6655');
    expect(JSON.stringify(row)).not.toContain('9988776655');
  });

  it('records a branch-level account', async () => {
    const church = await createChurch(app);
    const branch = await createBranch(app, church.id);
    const res = await request(app.getHttpServer())
      .post(`/churches/${church.id}/settlement-accounts`)
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
    const churchA = await createChurch(app, 'Church A');
    const churchB = await createChurch(app, 'Church B');
    const branchB = await createBranch(app, churchB.id);

    const res = await request(app.getHttpServer())
      .post(`/churches/${churchA.id}/settlement-accounts`)
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
    const church = await createChurch(app);
    const res = await request(app.getHttpServer())
      .post(`/churches/${church.id}/settlement-accounts`)
      .send({ label: 'X', accountNumber: '123', bankName: 'Wema' })
      .expect(400);
    expect(res.body.errors.accountNumber).toBeDefined();
  });

  it('lists accounts and filters by branch', async () => {
    const church = await createChurch(app);
    const branch = await createBranch(app, church.id);
    await request(app.getHttpServer())
      .post(`/churches/${church.id}/settlement-accounts`)
      .send({ label: 'General', accountNumber: '0123456789', bankName: 'Wema' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/churches/${church.id}/settlement-accounts`)
      .send({
        label: 'Branch Rent',
        accountNumber: '1112223334',
        bankName: 'GTB',
        branchId: branch.id,
      })
      .expect(201);

    const all = await request(app.getHttpServer())
      .get(`/churches/${church.id}/settlement-accounts`)
      .expect(200);
    expect(all.body).toHaveLength(2);

    const filtered = await request(app.getHttpServer())
      .get(`/churches/${church.id}/settlement-accounts?branchId=${branch.id}`)
      .expect(200);
    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0].label).toBe('Branch Rent');
  });

  it('updates the label', async () => {
    const church = await createChurch(app);
    const acct = await request(app.getHttpServer())
      .post(`/churches/${church.id}/settlement-accounts`)
      .send({ label: 'General', accountNumber: '0123456789', bankName: 'Wema' })
      .expect(201);

    const updated = await request(app.getHttpServer())
      .patch(`/churches/${church.id}/settlement-accounts/${acct.body.id}`)
      .send({ label: 'General Offering Account' })
      .expect(200);
    expect(updated.body.label).toBe('General Offering Account');
    expect(updated.body.accountNumberMasked).toBe('******6789'); // unchanged
  });

  it('isolates tenants (church B sees/touches nothing of A)', async () => {
    const churchA = await createChurch(app, 'Church A');
    const churchB = await createChurch(app, 'Church B');
    const acct = await request(app.getHttpServer())
      .post(`/churches/${churchA.id}/settlement-accounts`)
      .send({ label: 'General', accountNumber: '0123456789', bankName: 'Wema' })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(`/churches/${churchB.id}/settlement-accounts`)
      .expect(200);
    expect(list.body).toHaveLength(0);

    await request(app.getHttpServer())
      .patch(`/churches/${churchB.id}/settlement-accounts/${acct.body.id}`)
      .send({ label: 'Hijacked' })
      .expect(404);
  });
});
