import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PAYMENT_GATEWAY } from '../src/payments/gateway/payment-gateway';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthedChurch } from './auth-utils';
import { truncateAll } from './db-utils';

const FAKE_BANKS = [{ name: 'GTBank', slug: 'gtbank', code: '058', currency: 'NGN', active: true }];

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
    resolveAccountNumber: async (input: { accountNumber: string; bankCode: string }) => ({
      accountNumber: input.accountNumber,
      accountName: 'Test Account Holder',
    }),
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

let accountNumberCounter = 2_000_000_000;
const freshAccountNumber = () => String(++accountNumberCounter);

async function createAccount(
  app: INestApplication,
  churchId: string,
  cookie: string,
  scope: { scopeType: 'church' } | { scopeType: 'region' | 'branch'; scopeRefId: string },
  label = 'Account',
) {
  const res = await request(app.getHttpServer())
    .post(`/churches/${churchId}/settlement-accounts`)
    .set('Cookie', cookie)
    .send({ label, accountNumber: freshAccountNumber(), bankCode: '058', ...scope })
    .expect(201);
  return res.body as { id: string };
}

describe('Campaigns (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(fakeGateway())
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

  describe('create', () => {
    it('creates a church-wide campaign as super_admin', async () => {
      const { cookie, churchId } = await createAuthedChurch(app);
      const account = await createAccount(app, churchId, cookie, { scopeType: 'church' });

      const res = await request(app.getHttpServer())
        .post(`/churches/${churchId}/campaigns`)
        .set('Cookie', cookie)
        .send({
          title: 'General Offering',
          scopeType: 'church',
          settlementAccountId: account.id,
          targetAmountKobo: 1_000_000,
        })
        .expect(201);

      expect(res.body.title).toBe('General Offering');
      expect(res.body.scopeType).toBe('church');
      expect(res.body.status).toBe('draft');
      expect(res.body.targetAmountKobo).toBe(1_000_000);
    });

    it('refuses a non-super_admin creating a church-wide campaign', async () => {
      const alice = await createAuthedChurch(app);
      const region = await createRegion(app, alice.churchId, alice.cookie);
      const account = await createAccount(app, alice.churchId, alice.cookie, {
        scopeType: 'church',
      });
      await setStaffScope(prisma, alice.staffId, 'regional_admin', [
        { scopeType: 'region', scopeRefId: region.id },
      ]);

      await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/campaigns`)
        .set('Cookie', alice.cookie)
        .send({
          title: 'Sneaky church campaign',
          scopeType: 'church',
          settlementAccountId: account.id,
          targetAmountKobo: 1_000_000,
        })
        .expect(403);
    });

    it('lets a branch_admin create a campaign for their own branch, settling into their own branch account', async () => {
      const alice = await createAuthedChurch(app);
      const region = await createRegion(app, alice.churchId, alice.cookie);
      const branch = await createBranch(app, alice.churchId, alice.cookie, 'Branch', region.id);
      const account = await createAccount(
        app,
        alice.churchId,
        alice.cookie,
        { scopeType: 'branch', scopeRefId: branch.id },
        'Branch account',
      );
      await setStaffScope(prisma, alice.staffId, 'branch_admin', [
        { scopeType: 'branch', scopeRefId: branch.id },
      ]);

      const res = await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/campaigns`)
        .set('Cookie', alice.cookie)
        .send({
          title: 'Building Fund',
          scopeType: 'branch',
          scopeRefId: branch.id,
          settlementAccountId: account.id,
          targetAmountKobo: 1_000_000,
        })
        .expect(201);

      expect(res.body.scopeType).toBe('branch');
      expect(res.body.scopeRefId).toBe(branch.id);
    });

    it('allows a branch campaign to settle upward into its containing region account', async () => {
      const alice = await createAuthedChurch(app);
      const region = await createRegion(app, alice.churchId, alice.cookie);
      const branch = await createBranch(app, alice.churchId, alice.cookie, 'Branch', region.id);
      const regionAccount = await createAccount(
        app,
        alice.churchId,
        alice.cookie,
        { scopeType: 'region', scopeRefId: region.id },
        'Region account',
      );

      const res = await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/campaigns`)
        .set('Cookie', alice.cookie)
        .send({
          title: 'HQ Banked Campaign',
          scopeType: 'branch',
          scopeRefId: branch.id,
          settlementAccountId: regionAccount.id,
          targetAmountKobo: 1_000_000,
        })
        .expect(201);

      expect(res.body.settlementAccountId).toBe(regionAccount.id);
    });

    it('refuses a branch campaign settling into a sibling branch account — a misroute', async () => {
      const alice = await createAuthedChurch(app);
      const region = await createRegion(app, alice.churchId, alice.cookie);
      const branch = await createBranch(app, alice.churchId, alice.cookie, 'Branch A', region.id);
      const sibling = await createBranch(app, alice.churchId, alice.cookie, 'Branch B', region.id);
      const siblingAccount = await createAccount(
        app,
        alice.churchId,
        alice.cookie,
        { scopeType: 'branch', scopeRefId: sibling.id },
        'Sibling account',
      );

      const res = await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/campaigns`)
        .set('Cookie', alice.cookie)
        .send({
          title: 'Misrouted Campaign',
          scopeType: 'branch',
          scopeRefId: branch.id,
          settlementAccountId: siblingAccount.id,
          targetAmountKobo: 1_000_000,
        })
        .expect(400);

      expect(res.body.message).toContain('cannot receive the giving');
    });

    it('rejects a settlementAccountId from another church with a 400, not a 500', async () => {
      const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
      const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });
      const bobAccount = await createAccount(app, bob.churchId, bob.cookie, {
        scopeType: 'church',
      });

      const res = await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/campaigns`)
        .set('Cookie', alice.cookie)
        .send({
          title: 'Cross-tenant probe',
          scopeType: 'church',
          settlementAccountId: bobAccount.id,
          targetAmountKobo: 1_000_000,
        })
        .expect(400);

      expect(res.body.error).not.toBe('INTERNAL_SERVER_ERROR');
    });

    it('sets createdById from the caller', async () => {
      const { cookie, churchId, staffId } = await createAuthedChurch(app);
      const account = await createAccount(app, churchId, cookie, { scopeType: 'church' });

      const res = await request(app.getHttpServer())
        .post(`/churches/${churchId}/campaigns`)
        .set('Cookie', cookie)
        .send({
          title: 'General Offering',
          scopeType: 'church',
          settlementAccountId: account.id,
          targetAmountKobo: 1_000_000,
        })
        .expect(201);

      expect(res.body.createdById).toBe(staffId);
    });
  });

  describe('list, scoped visibility', () => {
    it('scopes a regional_admin to church-wide and their own region, and rejects an out-of-scope cursor', async () => {
      const alice = await createAuthedChurch(app);
      const ownRegion = await createRegion(app, alice.churchId, alice.cookie, 'Own Region');
      const otherRegion = await createRegion(app, alice.churchId, alice.cookie, 'Other Region');
      const churchAccount = await createAccount(app, alice.churchId, alice.cookie, {
        scopeType: 'church',
      });
      const ownAccount = await createAccount(
        app,
        alice.churchId,
        alice.cookie,
        { scopeType: 'region', scopeRefId: ownRegion.id },
        'Own',
      );
      const otherAccount = await createAccount(
        app,
        alice.churchId,
        alice.cookie,
        { scopeType: 'region', scopeRefId: otherRegion.id },
        'Other',
      );

      const church = await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/campaigns`)
        .set('Cookie', alice.cookie)
        .send({
          title: 'Church Campaign',
          scopeType: 'church',
          settlementAccountId: churchAccount.id,
          targetAmountKobo: 1_000_000,
        })
        .expect(201);
      const own = await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/campaigns`)
        .set('Cookie', alice.cookie)
        .send({
          title: 'Own Region Campaign',
          scopeType: 'region',
          scopeRefId: ownRegion.id,
          settlementAccountId: ownAccount.id,
          targetAmountKobo: 1_000_000,
        })
        .expect(201);
      const other = await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/campaigns`)
        .set('Cookie', alice.cookie)
        .send({
          title: 'Other Region Campaign',
          scopeType: 'region',
          scopeRefId: otherRegion.id,
          settlementAccountId: otherAccount.id,
          targetAmountKobo: 1_000_000,
        })
        .expect(201);

      await setStaffScope(prisma, alice.staffId, 'regional_admin', [
        { scopeType: 'region', scopeRefId: ownRegion.id },
      ]);

      const list = await request(app.getHttpServer())
        .get(`/churches/${alice.churchId}/campaigns`)
        .set('Cookie', alice.cookie)
        .expect(200);

      const ids = list.body.items.map((item: { id: string }) => item.id);
      expect(ids).toContain(church.body.id);
      expect(ids).toContain(own.body.id);
      expect(ids).not.toContain(other.body.id);

      await request(app.getHttpServer())
        .get(`/churches/${alice.churchId}/campaigns?cursor=${other.body.id}`)
        .set('Cookie', alice.cookie)
        .expect(400);
    });

    it('filters by status', async () => {
      const { cookie, churchId } = await createAuthedChurch(app);
      const account = await createAccount(app, churchId, cookie, { scopeType: 'church' });

      await request(app.getHttpServer())
        .post(`/churches/${churchId}/campaigns`)
        .set('Cookie', cookie)
        .send({
          title: 'Draft Campaign',
          scopeType: 'church',
          settlementAccountId: account.id,
          targetAmountKobo: 1_000_000,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/churches/${churchId}/campaigns`)
        .set('Cookie', cookie)
        .send({
          title: 'Active Campaign',
          scopeType: 'church',
          settlementAccountId: account.id,
          targetAmountKobo: 1_000_000,
          status: 'active',
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/churches/${churchId}/campaigns?status=active`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].title).toBe('Active Campaign');
    });
  });

  describe('findById', () => {
    it('404s a campaign outside the caller scope, the same as a nonexistent one', async () => {
      const alice = await createAuthedChurch(app);
      const region = await createRegion(app, alice.churchId, alice.cookie, 'Other Region');
      const account = await createAccount(
        app,
        alice.churchId,
        alice.cookie,
        { scopeType: 'region', scopeRefId: region.id },
        'Region account',
      );
      const campaign = await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/campaigns`)
        .set('Cookie', alice.cookie)
        .send({
          title: 'Other Region Campaign',
          scopeType: 'region',
          scopeRefId: region.id,
          settlementAccountId: account.id,
          targetAmountKobo: 1_000_000,
        })
        .expect(201);

      const ownRegion = await createRegion(app, alice.churchId, alice.cookie, 'Own Region');
      await setStaffScope(prisma, alice.staffId, 'regional_admin', [
        { scopeType: 'region', scopeRefId: ownRegion.id },
      ]);

      await request(app.getHttpServer())
        .get(`/churches/${alice.churchId}/campaigns/${campaign.body.id}`)
        .set('Cookie', alice.cookie)
        .expect(404);
    });
  });

  describe('update', () => {
    it('updates the title', async () => {
      const { cookie, churchId } = await createAuthedChurch(app);
      const account = await createAccount(app, churchId, cookie, { scopeType: 'church' });
      const campaign = await request(app.getHttpServer())
        .post(`/churches/${churchId}/campaigns`)
        .set('Cookie', cookie)
        .send({
          title: 'Old Title',
          scopeType: 'church',
          settlementAccountId: account.id,
          targetAmountKobo: 1_000_000,
        })
        .expect(201);

      const updated = await request(app.getHttpServer())
        .patch(`/churches/${churchId}/campaigns/${campaign.body.id}`)
        .set('Cookie', cookie)
        .send({ title: 'New Title' })
        .expect(200);

      expect(updated.body.title).toBe('New Title');
    });

    it('refuses to change scope once a DonationIntent exists against the campaign', async () => {
      const { cookie, churchId } = await createAuthedChurch(app);
      const account = await createAccount(app, churchId, cookie, { scopeType: 'church' });
      const campaign = await request(app.getHttpServer())
        .post(`/churches/${churchId}/campaigns`)
        .set('Cookie', cookie)
        .send({
          title: 'Giving in progress',
          scopeType: 'church',
          settlementAccountId: account.id,
          targetAmountKobo: 1_000_000,
        })
        .expect(201);

      const member = await prisma.member.create({
        data: { churchId, fullName: 'Test Giver', phone: '+2348010000000' },
      });
      await prisma.donationIntent.create({
        data: {
          churchId,
          campaignId: campaign.body.id,
          memberId: member.id,
          amountKobo: 50000,
          idempotencyKey: 'idem-1',
        },
      });

      const region = await createRegion(app, churchId, cookie);

      const res = await request(app.getHttpServer())
        .patch(`/churches/${churchId}/campaigns/${campaign.body.id}`)
        .set('Cookie', cookie)
        .send({ scopeType: 'region', scopeRefId: region.id })
        .expect(409);

      expect(res.body.message).toContain('scope');
    });

    it('renames a campaign that already has giving against it — the scope lock does not block unrelated edits', async () => {
      const { cookie, churchId } = await createAuthedChurch(app);
      const account = await createAccount(app, churchId, cookie, { scopeType: 'church' });
      const campaign = await request(app.getHttpServer())
        .post(`/churches/${churchId}/campaigns`)
        .set('Cookie', cookie)
        .send({
          title: 'Giving in progress',
          scopeType: 'church',
          settlementAccountId: account.id,
          targetAmountKobo: 1_000_000,
        })
        .expect(201);

      const member = await prisma.member.create({
        data: { churchId, fullName: 'Test Giver', phone: '+2348010000001' },
      });
      await prisma.donationIntent.create({
        data: {
          churchId,
          campaignId: campaign.body.id,
          memberId: member.id,
          amountKobo: 50000,
          idempotencyKey: 'idem-2',
        },
      });

      const updated = await request(app.getHttpServer())
        .patch(`/churches/${churchId}/campaigns/${campaign.body.id}`)
        .set('Cookie', cookie)
        .send({ title: 'Renamed mid-flight' })
        .expect(200);

      expect(updated.body.title).toBe('Renamed mid-flight');
    });

    it('refuses to repoint the settlement account once a settled Payment exists, against a real row', async () => {
      const { cookie, churchId } = await createAuthedChurch(app);
      const account = await createAccount(
        app,
        churchId,
        cookie,
        { scopeType: 'church' },
        'Original',
      );
      const otherAccount = await createAccount(
        app,
        churchId,
        cookie,
        { scopeType: 'church' },
        'Other',
      );
      const campaign = await request(app.getHttpServer())
        .post(`/churches/${churchId}/campaigns`)
        .set('Cookie', cookie)
        .send({
          title: 'Settled Campaign',
          scopeType: 'church',
          settlementAccountId: account.id,
          targetAmountKobo: 1_000_000,
        })
        .expect(201);

      await prisma.payment.create({
        data: {
          churchId,
          campaignId: campaign.body.id,
          amountKobo: 50000,
          channel: 'cash',
          paidAt: new Date(),
        },
      });

      const res = await request(app.getHttpServer())
        .patch(`/churches/${churchId}/campaigns/${campaign.body.id}`)
        .set('Cookie', cookie)
        .send({ settlementAccountId: otherAccount.id })
        .expect(409);

      expect(res.body.message).toContain('settled payment');
    });
  });

  describe('tenant isolation', () => {
    it('isolates tenants: church B cannot see or touch church A campaigns', async () => {
      const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
      const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });
      const account = await createAccount(app, alice.churchId, alice.cookie, {
        scopeType: 'church',
      });
      const campaign = await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/campaigns`)
        .set('Cookie', alice.cookie)
        .send({
          title: "Alice's Campaign",
          scopeType: 'church',
          settlementAccountId: account.id,
          targetAmountKobo: 1_000_000,
        })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/churches/${alice.churchId}/campaigns/${campaign.body.id}`)
        .set('Cookie', bob.cookie)
        .expect(403);

      await request(app.getHttpServer())
        .patch(`/churches/${alice.churchId}/campaigns/${campaign.body.id}`)
        .set('Cookie', bob.cookie)
        .send({ title: 'Hijacked' })
        .expect(403);
    });
  });
});
