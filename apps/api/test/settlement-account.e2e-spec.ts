import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PAYMENT_GATEWAY } from '../src/payments/gateway/payment-gateway';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthedChurch } from './auth-utils';
import { truncateAll } from './db-utils';

const FAKE_BANKS = [
  { name: 'GTBank', slug: 'gtbank', code: '058', currency: 'NGN', active: true },
  { name: 'Zenith Bank', slug: 'zenith-bank', code: '057', currency: 'NGN', active: true },
];

let subaccountCounter = 0;

function fakeGateway() {
  return {
    provider: 'paystack' as const,
    capabilities: {
      transferCharge: true,
      webhookEventIds: false,
      settlementReporting: true,
      refunds: true,
      disputes: true,
      subaccounts: true,
      bankDirectory: true,
    },
    createTransferCharge: async () => {
      throw new Error('not used by this suite');
    },
    verifySignature: () => false,
    parseWebhook: () => {
      throw new Error('not used by this suite');
    },
    fetchCharge: async () => {
      throw new Error('not used by this suite');
    },
    listBanks: async () => FAKE_BANKS,
    resolveAccountNumber: async (input: { accountNumber: string; bankCode: string }) => {
      const bank = FAKE_BANKS.find((b) => b.code === input.bankCode);
      if (!bank) throw new Error('unresolvable in this fake');
      return { accountNumber: input.accountNumber, accountName: 'Test Account Holder' };
    },
    createSubaccount: async (input: { accountNumber: string }) => ({
      provider: 'paystack' as const,
      subaccountCode: `ACCT_fake_${++subaccountCounter}`,
      accountNumberMasked: `${'*'.repeat(input.accountNumber.length - 4)}${input.accountNumber.slice(-4)}`,
      bankCode: '058',
      isVerified: false,
    }),
  };
}

async function createRegion(
  app: INestApplication,
  churchId: string,
  cookie: string,
  name = 'North Central',
) {
  const res = await request(app.getHttpServer())
    .post(`/churches/${churchId}/regions`)
    .set('Cookie', cookie)
    .send({ name, state: 'FCT' })
    .expect(201);
  return res.body as { id: string };
}

async function createBranch(
  app: INestApplication,
  churchId: string,
  cookie: string,
  name = 'KORU Abuja',
  regionId?: string,
) {
  const res = await request(app.getHttpServer())
    .post(`/churches/${churchId}/branches`)
    .set('Cookie', cookie)
    .send({ name, regionId })
    .expect(201);
  return res.body as { id: string };
}

async function setStaffScope(
  prisma: PrismaService,
  staffId: string,
  role: string,
  scopes: { scopeType: 'region' | 'branch'; scopeRefId: string }[],
) {
  await prisma.staff.update({
    where: { id: staffId },
    data: { role, scopes: { deleteMany: {}, create: scopes } },
  });
}

let accountNumberCounter = 1_000_000_000;
const freshAccountNumber = () => String(++accountNumberCounter);

describe('Settlement accounts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let gateway: ReturnType<typeof fakeGateway>;

  beforeAll(async () => {
    gateway = fakeGateway();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(gateway)
      .compile();
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

  describe('church-level registration', () => {
    it('records a church-wide account, deriving bankName and accountName from the provider', async () => {
      const { cookie, churchId } = await createAuthedChurch(app);

      const res = await request(app.getHttpServer())
        .post(`/churches/${churchId}/settlement-accounts`)
        .set('Cookie', cookie)
        .send({
          label: 'General Offering',
          accountNumber: '0123456789',
          bankCode: '058',
          scopeType: 'church',
        })
        .expect(201);

      expect(res.body.label).toBe('General Offering');
      expect(res.body.scopeType).toBe('church');
      expect(res.body.scopeRefId).toBeNull();
      expect(res.body.bankName).toBe('GTBank');
      expect(res.body.accountName).toBe('Test Account Holder');
      expect(res.body.accountNumberMasked).toBe('******6789');
      expect(JSON.stringify(res.body)).not.toContain('0123456789');
      expect(res.body.providerSubaccountCode).toBeUndefined();
      expect(Object.keys(res.body)).not.toContain('accountNumberHash');

      const row = await prisma.settlementAccount.findFirstOrThrow();
      expect(row.providerSubaccountCode).toMatch(/^ACCT_fake_/);
    });

    it('refuses a non-super_admin registering a church-level account', async () => {
      const alice = await createAuthedChurch(app);
      const region = await createRegion(app, alice.churchId, alice.cookie);
      await setStaffScope(prisma, alice.staffId, 'regional_admin', [
        { scopeType: 'region', scopeRefId: region.id },
      ]);

      const res = await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/settlement-accounts`)
        .set('Cookie', alice.cookie)
        .send({
          label: 'Sneaky church account',
          accountNumber: freshAccountNumber(),
          bankCode: '058',
          scopeType: 'church',
        })
        .expect(403);

      expect(res.body.error).toBe('FORBIDDEN');
      expect(await prisma.settlementAccount.count()).toBe(0);
    });
  });

  describe('region-level registration', () => {
    it('lets a regional_admin register an account for their own region', async () => {
      const alice = await createAuthedChurch(app);
      const region = await createRegion(app, alice.churchId, alice.cookie);
      await setStaffScope(prisma, alice.staffId, 'regional_admin', [
        { scopeType: 'region', scopeRefId: region.id },
      ]);

      const res = await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/settlement-accounts`)
        .set('Cookie', alice.cookie)
        .send({
          label: 'Region Account',
          accountNumber: freshAccountNumber(),
          bankCode: '058',
          scopeType: 'region',
          scopeRefId: region.id,
        })
        .expect(201);

      expect(res.body.scopeType).toBe('region');
      expect(res.body.scopeRefId).toBe(region.id);
    });

    it('refuses a regional_admin registering an account for a region they do not cover', async () => {
      const alice = await createAuthedChurch(app);
      const ownRegion = await createRegion(app, alice.churchId, alice.cookie, 'Own Region');
      const otherRegion = await createRegion(app, alice.churchId, alice.cookie, 'Other Region');
      await setStaffScope(prisma, alice.staffId, 'regional_admin', [
        { scopeType: 'region', scopeRefId: ownRegion.id },
      ]);

      await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/settlement-accounts`)
        .set('Cookie', alice.cookie)
        .send({
          label: 'Not mine',
          accountNumber: freshAccountNumber(),
          bankCode: '058',
          scopeType: 'region',
          scopeRefId: otherRegion.id,
        })
        .expect(403);
    });

    it('refuses a branch_admin registering a region-level account', async () => {
      const alice = await createAuthedChurch(app);
      const region = await createRegion(app, alice.churchId, alice.cookie);
      const branch = await createBranch(app, alice.churchId, alice.cookie, 'Branch', region.id);
      await setStaffScope(prisma, alice.staffId, 'branch_admin', [
        { scopeType: 'branch', scopeRefId: branch.id },
      ]);

      await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/settlement-accounts`)
        .set('Cookie', alice.cookie)
        .send({
          label: 'Above my level',
          accountNumber: freshAccountNumber(),
          bankCode: '058',
          scopeType: 'region',
          scopeRefId: region.id,
        })
        .expect(403);
    });
  });

  describe('branch-level registration', () => {
    it('lets a branch_admin register an account for their own branch', async () => {
      const alice = await createAuthedChurch(app);
      const branch = await createBranch(app, alice.churchId, alice.cookie);
      await setStaffScope(prisma, alice.staffId, 'branch_admin', [
        { scopeType: 'branch', scopeRefId: branch.id },
      ]);

      const res = await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/settlement-accounts`)
        .set('Cookie', alice.cookie)
        .send({
          label: 'KORU Abuja Rent',
          accountNumber: freshAccountNumber(),
          bankCode: '058',
          scopeType: 'branch',
          scopeRefId: branch.id,
        })
        .expect(201);

      expect(res.body.scopeType).toBe('branch');
      expect(res.body.scopeRefId).toBe(branch.id);
    });

    it('lets a regional_admin register an account for a branch inside their region', async () => {
      const alice = await createAuthedChurch(app);
      const region = await createRegion(app, alice.churchId, alice.cookie);
      const branch = await createBranch(app, alice.churchId, alice.cookie, 'Branch', region.id);
      await setStaffScope(prisma, alice.staffId, 'regional_admin', [
        { scopeType: 'region', scopeRefId: region.id },
      ]);

      await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/settlement-accounts`)
        .set('Cookie', alice.cookie)
        .send({
          label: 'Branch in my region',
          accountNumber: freshAccountNumber(),
          bankCode: '058',
          scopeType: 'branch',
          scopeRefId: branch.id,
        })
        .expect(201);
    });

    it('refuses a branch_admin registering an account for a different branch', async () => {
      const alice = await createAuthedChurch(app);
      const ownBranch = await createBranch(app, alice.churchId, alice.cookie, 'Own Branch');
      const otherBranch = await createBranch(app, alice.churchId, alice.cookie, 'Other Branch');
      await setStaffScope(prisma, alice.staffId, 'branch_admin', [
        { scopeType: 'branch', scopeRefId: ownBranch.id },
      ]);

      await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/settlement-accounts`)
        .set('Cookie', alice.cookie)
        .send({
          label: 'Not mine',
          accountNumber: freshAccountNumber(),
          bankCode: '058',
          scopeType: 'branch',
          scopeRefId: otherBranch.id,
        })
        .expect(403);
    });

    it('refuses a recorder registering any account at all', async () => {
      const alice = await createAuthedChurch(app);
      const branch = await createBranch(app, alice.churchId, alice.cookie);
      await setStaffScope(prisma, alice.staffId, 'recorder', [
        { scopeType: 'branch', scopeRefId: branch.id },
      ]);

      await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/settlement-accounts`)
        .set('Cookie', alice.cookie)
        .send({
          label: 'Recorder cannot',
          accountNumber: freshAccountNumber(),
          bankCode: '058',
          scopeType: 'branch',
          scopeRefId: branch.id,
        })
        .expect(403);
    });

    it('400s a scopeRefId naming a branch of another church, not a raw 500', async () => {
      const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
      const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });
      const branchB = await createBranch(app, bob.churchId, bob.cookie);

      const res = await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/settlement-accounts`)
        .set('Cookie', alice.cookie)
        .send({
          label: 'Cross-church',
          accountNumber: freshAccountNumber(),
          bankCode: '058',
          scopeType: 'branch',
          scopeRefId: branchB.id,
        })
        .expect(400);

      expect(res.body.error).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('branch');
    });
  });

  describe('duplicate accounts and validation', () => {
    it('409s the second registration of the same bank account, naming the existing one', async () => {
      const { cookie, churchId } = await createAuthedChurch(app);
      const body = { accountNumber: freshAccountNumber(), bankCode: '058', scopeType: 'church' };

      await request(app.getHttpServer())
        .post(`/churches/${churchId}/settlement-accounts`)
        .set('Cookie', cookie)
        .send({ ...body, label: 'Building Fund' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/churches/${churchId}/settlement-accounts`)
        .set('Cookie', cookie)
        .send({ ...body, label: 'Building Fund 2026' })
        .expect(409);

      expect(res.body.message).toContain('Building Fund');
      expect(await prisma.settlementAccount.count({ where: { churchId } })).toBe(1);
    });

    it('allows the same bank account to be registered by a different church', async () => {
      const first = await createAuthedChurch(app);
      const second = await createAuthedChurch(app);
      const body = {
        label: 'Main',
        accountNumber: freshAccountNumber(),
        bankCode: '058',
        scopeType: 'church' as const,
      };

      await request(app.getHttpServer())
        .post(`/churches/${first.churchId}/settlement-accounts`)
        .set('Cookie', first.cookie)
        .send(body)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/churches/${second.churchId}/settlement-accounts`)
        .set('Cookie', second.cookie)
        .send(body)
        .expect(201);
    });

    it('never persists the full account number (only the mask reaches the DB)', async () => {
      const { cookie, churchId } = await createAuthedChurch(app);

      await request(app.getHttpServer())
        .post(`/churches/${churchId}/settlement-accounts`)
        .set('Cookie', cookie)
        .send({ label: 'Rent', accountNumber: '9988776655', bankCode: '058', scopeType: 'church' })
        .expect(201);

      const row = await prisma.settlementAccount.findFirstOrThrow();
      expect(row.accountNumberMasked).toBe('******6655');
      expect(JSON.stringify(row)).not.toContain('9988776655');
    });

    it('rejects an unknown bankCode before ever calling resolve or create', async () => {
      const { cookie, churchId } = await createAuthedChurch(app);

      const res = await request(app.getHttpServer())
        .post(`/churches/${churchId}/settlement-accounts`)
        .set('Cookie', cookie)
        .send({
          label: 'Bad bank',
          accountNumber: freshAccountNumber(),
          bankCode: '999999',
          scopeType: 'church',
        })
        .expect(400);

      expect(res.body.error).toBe('BAD_REQUEST');
      expect(await prisma.settlementAccount.count()).toBe(0);
    });

    it('rejects a non-10-digit account number (400 with field error)', async () => {
      const { cookie, churchId } = await createAuthedChurch(app);

      const res = await request(app.getHttpServer())
        .post(`/churches/${churchId}/settlement-accounts`)
        .set('Cookie', cookie)
        .send({ label: 'Short', accountNumber: '123', bankCode: '058', scopeType: 'church' })
        .expect(400);

      expect(res.body.errors.accountNumber).toBeDefined();
    });
  });

  describe('list, scoped visibility', () => {
    it('lists accounts and filters by scopeType/scopeRefId', async () => {
      const { cookie, churchId } = await createAuthedChurch(app);
      const branch = await createBranch(app, churchId, cookie);

      await request(app.getHttpServer())
        .post(`/churches/${churchId}/settlement-accounts`)
        .set('Cookie', cookie)
        .send({
          label: 'General',
          accountNumber: freshAccountNumber(),
          bankCode: '058',
          scopeType: 'church',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/churches/${churchId}/settlement-accounts`)
        .set('Cookie', cookie)
        .send({
          label: 'Branch Rent',
          accountNumber: freshAccountNumber(),
          bankCode: '057',
          scopeType: 'branch',
          scopeRefId: branch.id,
        })
        .expect(201);

      const all = await request(app.getHttpServer())
        .get(`/churches/${churchId}/settlement-accounts`)
        .set('Cookie', cookie)
        .expect(200);

      expect(all.body.items).toHaveLength(2);
      expect(all.body.totalCount).toBe(2);

      const filtered = await request(app.getHttpServer())
        .get(`/churches/${churchId}/settlement-accounts?scopeType=branch&scopeRefId=${branch.id}`)
        .set('Cookie', cookie)
        .expect(200);

      expect(filtered.body.items).toHaveLength(1);
      expect(filtered.body.items[0].label).toBe('Branch Rent');
    });

    it('scopes a finance caller to their own branch, containing region, and church-wide accounts, and rejects an out-of-scope cursor', async () => {
      const alice = await createAuthedChurch(app);
      const region = await createRegion(app, alice.churchId, alice.cookie);
      const ownBranch = await createBranch(
        app,
        alice.churchId,
        alice.cookie,
        'Own Branch',
        region.id,
      );
      const otherBranch = await createBranch(app, alice.churchId, alice.cookie, 'Other Branch');

      const churchWide = await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/settlement-accounts`)
        .set('Cookie', alice.cookie)
        .send({
          label: 'Church Main',
          accountNumber: freshAccountNumber(),
          bankCode: '058',
          scopeType: 'church',
        })
        .expect(201);
      const ownAccount = await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/settlement-accounts`)
        .set('Cookie', alice.cookie)
        .send({
          label: 'Own Account',
          accountNumber: freshAccountNumber(),
          bankCode: '058',
          scopeType: 'branch',
          scopeRefId: ownBranch.id,
        })
        .expect(201);
      const otherAccount = await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/settlement-accounts`)
        .set('Cookie', alice.cookie)
        .send({
          label: 'Other Account',
          accountNumber: freshAccountNumber(),
          bankCode: '058',
          scopeType: 'branch',
          scopeRefId: otherBranch.id,
        })
        .expect(201);

      await setStaffScope(prisma, alice.staffId, 'finance', [
        { scopeType: 'branch', scopeRefId: ownBranch.id },
      ]);

      const list = await request(app.getHttpServer())
        .get(`/churches/${alice.churchId}/settlement-accounts`)
        .set('Cookie', alice.cookie)
        .expect(200);

      const ids = list.body.items.map((a: { id: string }) => a.id);
      expect(ids).toContain(churchWide.body.id);
      expect(ids).toContain(ownAccount.body.id);
      expect(ids).not.toContain(otherAccount.body.id);

      for (const account of list.body.items) {
        expect(account.providerSubaccountCode).toBeUndefined();
        expect(Object.keys(account)).not.toContain('accountNumberHash');
      }

      await request(app.getHttpServer())
        .get(`/churches/${alice.churchId}/settlement-accounts`)
        .query({ cursor: otherAccount.body.id })
        .set('Cookie', alice.cookie)
        .expect(400);

      await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/settlement-accounts`)
        .set('Cookie', alice.cookie)
        .send({
          label: 'Sneaky',
          accountNumber: freshAccountNumber(),
          bankCode: '058',
          scopeType: 'branch',
          scopeRefId: otherBranch.id,
        })
        .expect(403);

      await request(app.getHttpServer())
        .patch(`/churches/${alice.churchId}/settlement-accounts/${ownAccount.body.id}`)
        .set('Cookie', alice.cookie)
        .send({ label: 'Renamed' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/churches/${alice.churchId}/settlement-accounts/${otherAccount.body.id}`)
        .set('Cookie', alice.cookie)
        .send({ label: 'Hijacked' })
        .expect(403);
    });
  });

  describe('update', () => {
    it('updates the label', async () => {
      const { cookie, churchId } = await createAuthedChurch(app);

      const acct = await request(app.getHttpServer())
        .post(`/churches/${churchId}/settlement-accounts`)
        .set('Cookie', cookie)
        .send({
          label: 'General',
          accountNumber: freshAccountNumber(),
          bankCode: '058',
          scopeType: 'church',
        })
        .expect(201);

      const updated = await request(app.getHttpServer())
        .patch(`/churches/${churchId}/settlement-accounts/${acct.body.id}`)
        .set('Cookie', cookie)
        .send({ label: 'General Offering Account' })
        .expect(200);

      expect(updated.body.label).toBe('General Offering Account');
      expect(updated.body.accountNumberMasked).toMatch(/^\*+/);
    });

    it('refuses a non-super_admin relabelling the church-wide account', async () => {
      const alice = await createAuthedChurch(app);
      const region = await createRegion(app, alice.churchId, alice.cookie);

      const acct = await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/settlement-accounts`)
        .set('Cookie', alice.cookie)
        .send({
          label: 'Church Main',
          accountNumber: freshAccountNumber(),
          bankCode: '058',
          scopeType: 'church',
        })
        .expect(201);

      await setStaffScope(prisma, alice.staffId, 'regional_admin', [
        { scopeType: 'region', scopeRefId: region.id },
      ]);

      await request(app.getHttpServer())
        .patch(`/churches/${alice.churchId}/settlement-accounts/${acct.body.id}`)
        .set('Cookie', alice.cookie)
        .send({ label: 'Renamed' })
        .expect(403);
    });
  });

  describe('tenant isolation', () => {
    it('isolates tenants (church B sees/touches nothing of A)', async () => {
      const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
      const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });

      const acct = await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/settlement-accounts`)
        .set('Cookie', alice.cookie)
        .send({
          label: 'General',
          accountNumber: freshAccountNumber(),
          bankCode: '058',
          scopeType: 'church',
        })
        .expect(201);

      const list = await request(app.getHttpServer())
        .get(`/churches/${bob.churchId}/settlement-accounts`)
        .set('Cookie', bob.cookie)
        .expect(200);

      expect(list.body.items).toHaveLength(0);

      await request(app.getHttpServer())
        .patch(`/churches/${bob.churchId}/settlement-accounts/${acct.body.id}`)
        .set('Cookie', bob.cookie)
        .send({ label: 'Hijacked' })
        .expect(404);
    });
  });
});

describe('Bank directory (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(fakeGateway())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the bank directory to an authenticated session', async () => {
    const { cookie } = await createAuthedChurch(app);

    const res = await request(app.getHttpServer()).get('/banks').set('Cookie', cookie).expect(200);

    expect(res.body).toEqual(FAKE_BANKS);
  });

  it('401s without a session', async () => {
    await request(app.getHttpServer()).get('/banks').expect(401);
  });
});
