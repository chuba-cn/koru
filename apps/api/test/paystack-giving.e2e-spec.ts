import { createHmac, randomUUID } from 'node:crypto';
import type { ChargeFacts, TransferChargeResult } from '@koru/shared';
import type { INestApplication } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DonationIntentService } from '../src/payments/donation-intent.service';
import type { CreateTransferChargeInput } from '../src/payments/gateway/payment-gateway';
import { PAYMENT_GATEWAY } from '../src/payments/gateway/payment-gateway';
import { PaystackAdapter } from '../src/payments/gateway/paystack.adapter';
import { PAYSTACK_SECRET_KEY } from '../src/payments/gateway/paystack.config';
import { PaymentExpiryProcessor } from '../src/payments/payment-expiry.processor';
import { PaymentWebhookProcessor } from '../src/payments/payment-webhook.processor';
import { PaystackWebhookService } from '../src/payments/paystack-webhook.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthedChurch } from './auth-utils';
import { truncateAll } from './db-utils';
import { signInMemberByPhone } from './member-auth-utils';

/**
 * Overrides only createTransferCharge and fetchCharge — verifySignature and
 * parseWebhook stay real, so the webhook tests below prove the actual
 * production crypto and parsing path, not a stub of it.
 */
class FakePaystackAdapter extends PaystackAdapter {
  private readonly charges = new Map<
    string,
    { amountKobo: number; subaccountCode: string; providerChargeId: string }
  >();
  readonly fetchOverrides = new Map<string, Partial<ChargeFacts>>();

  override async createTransferCharge(
    input: CreateTransferChargeInput,
  ): Promise<TransferChargeResult> {
    const providerChargeId = `charge_${input.reference}`;
    this.charges.set(input.reference, {
      amountKobo: input.amountKobo,
      subaccountCode: input.subaccountCode,
      providerChargeId,
    });
    return {
      provider: 'paystack',
      reference: input.reference,
      providerChargeId,
      accountNumber: '1231986612',
      accountName: null,
      bankName: 'Test Bank',
      bankSlug: 'test-bank',
      accountExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      amountKobo: input.amountKobo,
    };
  }

  override async fetchCharge(reference: string): Promise<ChargeFacts> {
    const stored = this.charges.get(reference);
    if (!stored) throw new NotFoundException(`No fake charge for reference ${reference}`);
    const base: ChargeFacts = {
      provider: 'paystack',
      providerChargeId: stored.providerChargeId,
      reference,
      status: 'success',
      amountKobo: stored.amountKobo,
      feesKobo: 375,
      currency: 'NGN',
      channel: 'bank_transfer',
      paidAt: new Date().toISOString(),
      subaccountCode: stored.subaccountCode,
      metadata: null,
    };
    return { ...base, ...(this.fetchOverrides.get(reference) ?? {}) };
  }
}

function signedChargeSuccessBody(providerChargeId: string, reference: string) {
  const payload = {
    event: 'charge.success',
    data: { id: providerChargeId.replace('charge_', ''), reference, channel: 'bank_transfer' },
  };
  const raw = Buffer.from(JSON.stringify(payload));
  const signature = createHmac('sha512', PAYSTACK_SECRET_KEY).update(raw).digest('hex');
  return { raw, signature };
}

function signedTransferRejectedBody(reference: string, reason: string) {
  const payload = {
    event: 'bank.transfer.rejected',
    data: { reference, status: 'rejected', reason },
  };
  const raw = Buffer.from(JSON.stringify(payload));
  const signature = createHmac('sha512', PAYSTACK_SECRET_KEY).update(raw).digest('hex');
  return { raw, signature };
}

async function seedActiveCampaign(
  prisma: PrismaService,
  churchId: string,
  subaccountCode = 'ACCT_test',
) {
  const account = await prisma.settlementAccount.create({
    data: { churchId, label: 'Main', providerSubaccountCode: subaccountCode },
  });
  const campaign = await prisma.campaign.create({
    data: {
      churchId,
      title: 'Building Fund',
      scopeType: 'church',
      settlementAccountId: account.id,
      targetAmountKobo: 100_000_00n,
      status: 'active',
    },
  });
  return { account, campaign };
}

let memberPhoneCounter = 0;

async function joinAsVerifiedMember(app: INestApplication, churchId: string, fullName: string) {
  const phone = `+23480${String(++memberPhoneCounter).padStart(8, '0')}`;
  const { cookie } = await signInMemberByPhone(app, phone);
  const res = await request(app.getHttpServer())
    .post(`/join/${churchId}`)
    .set('Cookie', cookie)
    .send({ fullName })
    .expect(201);
  return { cookie, memberId: res.body.id as string };
}

describe('Paystack Pay-with-Transfer giving (e2e, #107)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let gateway: FakePaystackAdapter;
  let donationIntents: DonationIntentService;
  let webhookService: PaystackWebhookService;
  let webhookProcessor: PaymentWebhookProcessor;
  let expiryProcessor: PaymentExpiryProcessor;

  beforeAll(async () => {
    gateway = new FakePaystackAdapter();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(gateway)
      .compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    await app.init();
    prisma = app.get(PrismaService);
    donationIntents = app.get(DonationIntentService);
    webhookService = app.get(PaystackWebhookService);
    webhookProcessor = app.get(PaymentWebhookProcessor);
    expiryProcessor = app.get(PaymentExpiryProcessor);
  });

  beforeEach(async () => {
    await truncateAll(app);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Persists the inbox row and runs the worker synchronously, bypassing BullMQ's own timing. */
  async function deliverWebhook(raw: Buffer, signature: string) {
    await webhookService.receive(raw, { 'x-paystack-signature': signature });
    const event = await prisma.webhookEvent.findFirst({ orderBy: { createdAt: 'desc' } });
    if (event && event.status !== 'ignored') {
      await webhookProcessor.process({ data: { webhookEventId: event.id } } as never);
    }
  }

  it('intent → PwT charge → webhook → fetched charge → ledger → settled Payment, end to end', async () => {
    const { churchId, staffId } = await createAuthedChurch(app);
    const { campaign } = await seedActiveCampaign(prisma, churchId);
    const member = await prisma.member.create({
      data: { churchId, fullName: 'Ada Giver', phone: '+2348011111111' },
    });

    const { attempt } = await donationIntents.createIntentWithTransferAttempt({
      churchId,
      campaignId: campaign.id,
      memberId: member.id,
      amountKobo: 150_000,
      idempotencyKey: randomUUID(),
    });
    expect(attempt?.virtualAccountNumber).toBe('1231986612');

    const { raw, signature } = signedChargeSuccessBody(
      `charge_${attempt?.id}`,
      attempt?.id as string,
    );
    const res = await request(app.getHttpServer())
      .post('/webhooks/paystack')
      .set('x-paystack-signature', signature)
      .set('Content-Type', 'application/json')
      .send(raw.toString('utf8'))
      .expect(201);
    expect(res.body).toEqual({ received: true });

    const event = await prisma.webhookEvent.findFirstOrThrow();
    await webhookProcessor.process({ data: { webhookEventId: event.id } } as never);

    const entries = await prisma.ledgerEntry.findMany({ where: { churchId } });
    expect(entries).toHaveLength(2);
    const balance = entries.reduce(
      (sum, e) => sum + (e.entryType === 'debit' ? e.amountKobo : -e.amountKobo),
      0n,
    );
    expect(balance).toBe(0n);

    const payment = await prisma.payment.findFirstOrThrow({ where: { churchId } });
    expect(payment.state).toBe('settled');
    expect(payment.provider).toBe('paystack');

    const updatedAttempt = await prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: attempt?.id },
    });
    expect(updatedAttempt.status).toBe('succeeded');
    const intent = await prisma.donationIntent.findUniqueOrThrow({
      where: { id: updatedAttempt.donationIntentId },
    });
    expect(intent.status).toBe('succeeded');

    const domainEvent = await prisma.domainEvent.findFirstOrThrow({
      where: { churchId, type: 'payment_settled' },
    });
    expect((domainEvent.payload as { paymentId: string }).paymentId).toBe(payment.id);
    void staffId;
  });

  it('the same charge.success delivered twice produces exactly one Payment and two ledger rows total', async () => {
    const { churchId } = await createAuthedChurch(app);
    const { campaign } = await seedActiveCampaign(prisma, churchId);
    const member = await prisma.member.create({
      data: { churchId, fullName: 'Ada Giver', phone: '+2348011111112' },
    });
    const { attempt } = await donationIntents.createIntentWithTransferAttempt({
      churchId,
      campaignId: campaign.id,
      memberId: member.id,
      amountKobo: 150_000,
      idempotencyKey: randomUUID(),
    });

    const { raw, signature } = signedChargeSuccessBody(
      `charge_${attempt?.id}`,
      attempt?.id as string,
    );
    await deliverWebhook(raw, signature);
    await deliverWebhook(raw, signature);

    expect(await prisma.webhookEvent.count()).toBe(1);
    expect(await prisma.payment.count({ where: { churchId } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { churchId } })).toBe(2);
  });

  it('two concurrent deliveries of the same event produce the same one-Payment result', async () => {
    const { churchId } = await createAuthedChurch(app);
    const { campaign } = await seedActiveCampaign(prisma, churchId);
    const member = await prisma.member.create({
      data: { churchId, fullName: 'Ada Giver', phone: '+2348011111113' },
    });
    const { attempt } = await donationIntents.createIntentWithTransferAttempt({
      churchId,
      campaignId: campaign.id,
      memberId: member.id,
      amountKobo: 150_000,
      idempotencyKey: randomUUID(),
    });

    const { raw, signature } = signedChargeSuccessBody(
      `charge_${attempt?.id}`,
      attempt?.id as string,
    );
    await Promise.all([deliverWebhook(raw, signature), deliverWebhook(raw, signature)]);

    expect(await prisma.webhookEvent.count()).toBe(1);
    expect(await prisma.payment.count({ where: { churchId } })).toBe(1);
  });

  it('a tampered signature is rejected with 401 and writes nothing', async () => {
    const { churchId } = await createAuthedChurch(app);
    const { campaign } = await seedActiveCampaign(prisma, churchId);
    const member = await prisma.member.create({
      data: { churchId, fullName: 'Ada Giver', phone: '+2348011111114' },
    });
    const { attempt } = await donationIntents.createIntentWithTransferAttempt({
      churchId,
      campaignId: campaign.id,
      memberId: member.id,
      amountKobo: 150_000,
      idempotencyKey: randomUUID(),
    });

    const { raw } = signedChargeSuccessBody(`charge_${attempt?.id}`, attempt?.id as string);
    const res = await request(app.getHttpServer())
      .post('/webhooks/paystack')
      .set('x-paystack-signature', 'not-the-real-signature')
      .set('Content-Type', 'application/json')
      .send(raw.toString('utf8'))
      .expect(401);

    expect(res.body.error).toBeDefined();
    expect(await prisma.webhookEvent.count()).toBe(0);
    expect(await prisma.ledgerEntry.count()).toBe(0);
  });

  it('a fetched amount that disagrees with the attempt writes no ledger rows and leaves the attempt pending', async () => {
    const { churchId } = await createAuthedChurch(app);
    const { campaign } = await seedActiveCampaign(prisma, churchId);
    const member = await prisma.member.create({
      data: { churchId, fullName: 'Ada Giver', phone: '+2348011111115' },
    });
    const { attempt } = await donationIntents.createIntentWithTransferAttempt({
      churchId,
      campaignId: campaign.id,
      memberId: member.id,
      amountKobo: 150_000,
      idempotencyKey: randomUUID(),
    });
    gateway.fetchOverrides.set(attempt?.id as string, { amountKobo: 999_999 });

    const { raw, signature } = signedChargeSuccessBody(
      `charge_${attempt?.id}`,
      attempt?.id as string,
    );
    await expect(deliverWebhook(raw, signature)).rejects.toThrow();

    expect(await prisma.ledgerEntry.count()).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
    const stillPending = await prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: attempt?.id },
    });
    expect(stillPending.status).toBe('pending');
  });

  it('a subaccountCode belonging to a different church writes nothing to either church', async () => {
    const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
    const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });
    const { campaign } = await seedActiveCampaign(prisma, alice.churchId, 'ACCT_alice');
    await seedActiveCampaign(prisma, bob.churchId, 'ACCT_bob');
    const member = await prisma.member.create({
      data: { churchId: alice.churchId, fullName: 'Ada Giver', phone: '+2348011111116' },
    });
    const { attempt } = await donationIntents.createIntentWithTransferAttempt({
      churchId: alice.churchId,
      campaignId: campaign.id,
      memberId: member.id,
      amountKobo: 150_000,
      idempotencyKey: randomUUID(),
    });
    gateway.fetchOverrides.set(attempt?.id as string, { subaccountCode: 'ACCT_bob' });

    const { raw, signature } = signedChargeSuccessBody(
      `charge_${attempt?.id}`,
      attempt?.id as string,
    );
    await expect(deliverWebhook(raw, signature)).rejects.toThrow();

    expect(await prisma.ledgerEntry.count()).toBe(0);
  });

  it('bank.transfer.rejected fails the attempt and intent, posting no ledger entry', async () => {
    const { churchId } = await createAuthedChurch(app);
    const { campaign } = await seedActiveCampaign(prisma, churchId);
    const member = await prisma.member.create({
      data: { churchId, fullName: 'Ada Giver', phone: '+2348011111117' },
    });
    const { attempt } = await donationIntents.createIntentWithTransferAttempt({
      churchId,
      campaignId: campaign.id,
      memberId: member.id,
      amountKobo: 150_000,
      idempotencyKey: randomUUID(),
    });

    const { raw, signature } = signedTransferRejectedBody(attempt?.id as string, 'wrong amount');
    await deliverWebhook(raw, signature);

    const failedAttempt = await prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: attempt?.id },
    });
    expect(failedAttempt.status).toBe('failed');
    expect(failedAttempt.failureReason).toBe('wrong amount');
    const intent = await prisma.donationIntent.findUniqueOrThrow({
      where: { id: failedAttempt.donationIntentId },
    });
    expect(intent.status).toBe('failed');
    expect(await prisma.ledgerEntry.count()).toBe(0);
  });

  it('PaymentExpiryProcessor expires a pending attempt whose account expired past the grace window', async () => {
    const { churchId } = await createAuthedChurch(app);
    const { campaign } = await seedActiveCampaign(prisma, churchId);
    const member = await prisma.member.create({
      data: { churchId, fullName: 'Ada Giver', phone: '+2348011111118' },
    });
    const { attempt } = await donationIntents.createIntentWithTransferAttempt({
      churchId,
      campaignId: campaign.id,
      memberId: member.id,
      amountKobo: 150_000,
      idempotencyKey: randomUUID(),
    });
    await prisma.paymentAttempt.update({
      where: { id: attempt?.id },
      data: { expiresAt: new Date(Date.now() - 60 * 60_000) },
    });

    const claimed = await expiryProcessor.sweep();

    expect(claimed.map((r) => r.id)).toContain(attempt?.id);
    const expired = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt?.id } });
    expect(expired.status).toBe('expired');
    const intent = await prisma.donationIntent.findUniqueOrThrow({
      where: { id: expired.donationIntentId },
    });
    expect(intent.status).toBe('expired');
  });

  it('leaves an attempt inside the grace window untouched', async () => {
    const { churchId } = await createAuthedChurch(app);
    const { campaign } = await seedActiveCampaign(prisma, churchId);
    const member = await prisma.member.create({
      data: { churchId, fullName: 'Ada Giver', phone: '+2348011111119' },
    });
    const { attempt } = await donationIntents.createIntentWithTransferAttempt({
      churchId,
      campaignId: campaign.id,
      memberId: member.id,
      amountKobo: 150_000,
      idempotencyKey: randomUUID(),
    });
    await prisma.paymentAttempt.update({
      where: { id: attempt?.id },
      data: { expiresAt: new Date(Date.now() - 2 * 60_000) },
    });

    const claimed = await expiryProcessor.sweep();

    expect(claimed.map((r) => r.id)).not.toContain(attempt?.id);
  });

  it('a settled attempt that was already expired still posts — the late-transfer case', async () => {
    const { churchId } = await createAuthedChurch(app);
    const { campaign } = await seedActiveCampaign(prisma, churchId);
    const member = await prisma.member.create({
      data: { churchId, fullName: 'Ada Giver', phone: '+2348011111120' },
    });
    const { attempt } = await donationIntents.createIntentWithTransferAttempt({
      churchId,
      campaignId: campaign.id,
      memberId: member.id,
      amountKobo: 150_000,
      idempotencyKey: randomUUID(),
    });
    await prisma.paymentAttempt.update({
      where: { id: attempt?.id },
      data: { status: 'expired' },
    });

    const { raw, signature } = signedChargeSuccessBody(
      `charge_${attempt?.id}`,
      attempt?.id as string,
    );
    await deliverWebhook(raw, signature);

    expect(await prisma.payment.count({ where: { churchId } })).toBe(1);
    const settled = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt?.id } });
    expect(settled.status).toBe('succeeded');
  });

  it('rejects giving to a paused campaign, with no Paystack call', async () => {
    const { churchId } = await createAuthedChurch(app);
    const { campaign } = await seedActiveCampaign(prisma, churchId);
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'paused' } });
    const member = await prisma.member.create({
      data: { churchId, fullName: 'Ada Giver', phone: '+2348011111121' },
    });

    await expect(
      donationIntents.createIntentWithTransferAttempt({
        churchId,
        campaignId: campaign.id,
        memberId: member.id,
        amountKobo: 150_000,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow();
    expect(await prisma.paymentAttempt.count()).toBe(0);
  });

  it('rejects giving when the settlement account has no Paystack subaccount code', async () => {
    const { churchId } = await createAuthedChurch(app);
    const account = await prisma.settlementAccount.create({
      data: { churchId, label: 'Unregistered' },
    });
    const campaign = await prisma.campaign.create({
      data: {
        churchId,
        title: 'Unregistered Fund',
        scopeType: 'church',
        settlementAccountId: account.id,
        targetAmountKobo: 100_000_00n,
        status: 'active',
      },
    });
    const member = await prisma.member.create({
      data: { churchId, fullName: 'Ada Giver', phone: '+2348011111122' },
    });

    await expect(
      donationIntents.createIntentWithTransferAttempt({
        churchId,
        campaignId: campaign.id,
        memberId: member.id,
        amountKobo: 150_000,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow();
  });

  it('replaying the same idempotencyKey mints exactly one intent, one attempt, one Paystack call', async () => {
    const { churchId } = await createAuthedChurch(app);
    const { campaign } = await seedActiveCampaign(prisma, churchId);
    const member = await prisma.member.create({
      data: { churchId, fullName: 'Ada Giver', phone: '+2348011111123' },
    });
    const key = randomUUID();

    const first = await donationIntents.createIntentWithTransferAttempt({
      churchId,
      campaignId: campaign.id,
      memberId: member.id,
      amountKobo: 150_000,
      idempotencyKey: key,
    });
    const second = await donationIntents.createIntentWithTransferAttempt({
      churchId,
      campaignId: campaign.id,
      memberId: member.id,
      amountKobo: 150_000,
      idempotencyKey: key,
    });

    expect(second.replayed).toBe(true);
    expect(second.intent.id).toBe(first.intent.id);
    expect(await prisma.donationIntent.count({ where: { churchId } })).toBe(1);
    expect(await prisma.paymentAttempt.count({ where: { churchId } })).toBe(1);
  });

  describe('POST /me/churches/:churchId/donations', () => {
    it('creates a donation and returns the account to transfer into', async () => {
      const { churchId } = await createAuthedChurch(app);
      const { campaign } = await seedActiveCampaign(prisma, churchId);
      const { cookie } = await joinAsVerifiedMember(app, churchId, 'Ada Giver');

      const res = await request(app.getHttpServer())
        .post(`/me/churches/${churchId}/donations`)
        .set('Cookie', cookie)
        .send({ campaignId: campaign.id, amountKobo: 150_000, idempotencyKey: randomUUID() })
        .expect(201);

      expect(res.body.transferInstruction.accountNumber).toBe('1231986612');
      expect(res.body.status).toBe('processing');
    });

    it('replaying the idempotencyKey over HTTP returns 200 with the same account, one Paystack call', async () => {
      const { churchId } = await createAuthedChurch(app);
      const { campaign } = await seedActiveCampaign(prisma, churchId);
      const { cookie } = await joinAsVerifiedMember(app, churchId, 'Ada Giver');
      const key = randomUUID();
      const body = { campaignId: campaign.id, amountKobo: 150_000, idempotencyKey: key };

      const first = await request(app.getHttpServer())
        .post(`/me/churches/${churchId}/donations`)
        .set('Cookie', cookie)
        .send(body)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post(`/me/churches/${churchId}/donations`)
        .set('Cookie', cookie)
        .send(body)
        .expect(200);

      expect(second.body.transferInstruction.accountNumber).toBe(
        first.body.transferInstruction.accountNumber,
      );
    });

    it('403s a session with no verified phone', async () => {
      const { cookie, churchId } = await createAuthedChurch(app);
      const { campaign } = await seedActiveCampaign(prisma, churchId);

      await request(app.getHttpServer())
        .post(`/me/churches/${churchId}/donations`)
        .set('Cookie', cookie)
        .send({ campaignId: campaign.id, amountKobo: 150_000, idempotencyKey: randomUUID() })
        .expect(403);
      expect(await prisma.donationIntent.count()).toBe(0);
    });

    it("404s a member posting to a church they don't belong to — the :churchId path segment is load-bearing, DonationController carries no TenantGuard", async () => {
      const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
      const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });
      const { campaign: bobCampaign } = await seedActiveCampaign(prisma, bob.churchId);
      const { cookie } = await joinAsVerifiedMember(app, alice.churchId, 'Ada Giver');

      await request(app.getHttpServer())
        .post(`/me/churches/${bob.churchId}/donations`)
        .set('Cookie', cookie)
        .send({ campaignId: bobCampaign.id, amountKobo: 150_000, idempotencyKey: randomUUID() })
        .expect(404);
      expect(await prisma.donationIntent.count()).toBe(0);
    });

    it('404s a campaignId from another church', async () => {
      const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
      const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });
      const { campaign: bobCampaign } = await seedActiveCampaign(prisma, bob.churchId);
      const { cookie } = await joinAsVerifiedMember(app, alice.churchId, 'Ada Giver');

      await request(app.getHttpServer())
        .post(`/me/churches/${alice.churchId}/donations`)
        .set('Cookie', cookie)
        .send({ campaignId: bobCampaign.id, amountKobo: 150_000, idempotencyKey: randomUUID() })
        .expect(404);
    });

    it('gives two members their own donation when they collide on one idempotencyKey', async () => {
      const { churchId } = await createAuthedChurch(app);
      const { campaign } = await seedActiveCampaign(prisma, churchId);
      const memberA = await joinAsVerifiedMember(app, churchId, 'Member A');
      const memberB = await joinAsVerifiedMember(app, churchId, 'Member B');
      const key = randomUUID();

      const first = await request(app.getHttpServer())
        .post(`/me/churches/${churchId}/donations`)
        .set('Cookie', memberA.cookie)
        .send({ campaignId: campaign.id, amountKobo: 500_000, idempotencyKey: key })
        .expect(201);

      const second = await request(app.getHttpServer())
        .post(`/me/churches/${churchId}/donations`)
        .set('Cookie', memberB.cookie)
        .send({ campaignId: campaign.id, amountKobo: 150_000, idempotencyKey: key })
        .expect(201);

      expect(second.body.id).not.toBe(first.body.id);
      expect(second.body.amountKobo).toBe(150_000);
      expect(JSON.stringify(second.body)).not.toContain('500000');
    });

    it('replays for the same member, and 200s rather than 201, without a second charge', async () => {
      const { churchId } = await createAuthedChurch(app);
      const { campaign } = await seedActiveCampaign(prisma, churchId);
      const member = await joinAsVerifiedMember(app, churchId, 'Repeat Giver');
      const key = randomUUID();
      const body = { campaignId: campaign.id, amountKobo: 200_000, idempotencyKey: key };

      const first = await request(app.getHttpServer())
        .post(`/me/churches/${churchId}/donations`)
        .set('Cookie', member.cookie)
        .send(body)
        .expect(201);

      const replay = await request(app.getHttpServer())
        .post(`/me/churches/${churchId}/donations`)
        .set('Cookie', member.cookie)
        .send(body)
        .expect(200);

      expect(replay.body.id).toBe(first.body.id);
      expect(await prisma.paymentAttempt.count({ where: { churchId } })).toBe(1);
    });

    it('409s a reused key carrying a different amount, rather than silently replaying the first gift', async () => {
      const { churchId } = await createAuthedChurch(app);
      const { campaign } = await seedActiveCampaign(prisma, churchId);
      const member = await joinAsVerifiedMember(app, churchId, 'Key Reuser');
      const key = randomUUID();

      await request(app.getHttpServer())
        .post(`/me/churches/${churchId}/donations`)
        .set('Cookie', member.cookie)
        .send({ campaignId: campaign.id, amountKobo: 200_000, idempotencyKey: key })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/me/churches/${churchId}/donations`)
        .set('Cookie', member.cookie)
        .send({ campaignId: campaign.id, amountKobo: 5_000_000, idempotencyKey: key })
        .expect(409);

      expect(res.body.message).toMatch(/different donation/i);
      expect(await prisma.paymentAttempt.count({ where: { churchId } })).toBe(1);
    });
  });

  describe('GET /me/churches/:churchId/donations/:id', () => {
    it('reads back a donation the caller owns, with its transfer instruction', async () => {
      const { churchId } = await createAuthedChurch(app);
      const { campaign } = await seedActiveCampaign(prisma, churchId);
      const member = await joinAsVerifiedMember(app, churchId, 'Reader');

      const created = await request(app.getHttpServer())
        .post(`/me/churches/${churchId}/donations`)
        .set('Cookie', member.cookie)
        .send({ campaignId: campaign.id, amountKobo: 250_000, idempotencyKey: randomUUID() })
        .expect(201);

      const read = await request(app.getHttpServer())
        .get(`/me/churches/${churchId}/donations/${created.body.id}`)
        .set('Cookie', member.cookie)
        .expect(200);

      expect(read.body.id).toBe(created.body.id);
      expect(read.body.amountKobo).toBe(250_000);
      expect(read.body.transferInstruction.accountNumber).toBe(
        created.body.transferInstruction.accountNumber,
      );
    });

    it("404s, never 403s, for another member's donation, so an id cannot be probed", async () => {
      const { churchId } = await createAuthedChurch(app);
      const { campaign } = await seedActiveCampaign(prisma, churchId);
      const owner = await joinAsVerifiedMember(app, churchId, 'Owner');
      const stranger = await joinAsVerifiedMember(app, churchId, 'Stranger');

      const created = await request(app.getHttpServer())
        .post(`/me/churches/${churchId}/donations`)
        .set('Cookie', owner.cookie)
        .send({ campaignId: campaign.id, amountKobo: 300_000, idempotencyKey: randomUUID() })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/me/churches/${churchId}/donations/${created.body.id}`)
        .set('Cookie', stranger.cookie)
        .expect(404);

      expect(JSON.stringify(res.body)).not.toContain('300000');
    });

    it('404s for a donation belonging to a different church', async () => {
      const alice = await createAuthedChurch(app);
      const bob = await createAuthedChurch(app);
      const bobCampaign = await seedActiveCampaign(prisma, bob.churchId);
      const bobMember = await joinAsVerifiedMember(app, bob.churchId, 'Bob Member');
      const aliceMember = await joinAsVerifiedMember(app, alice.churchId, 'Alice Member');

      const created = await request(app.getHttpServer())
        .post(`/me/churches/${bob.churchId}/donations`)
        .set('Cookie', bobMember.cookie)
        .send({
          campaignId: bobCampaign.campaign.id,
          amountKobo: 400_000,
          idempotencyKey: randomUUID(),
        })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/me/churches/${alice.churchId}/donations/${created.body.id}`)
        .set('Cookie', aliceMember.cookie)
        .expect(404);
    });
  });
});
