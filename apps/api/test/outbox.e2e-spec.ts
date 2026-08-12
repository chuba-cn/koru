import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { AppModule } from '../src/app.module';
import { OutboxRelayProcessor } from '../src/events/outbox-relay.processor';
import { LedgerService } from '../src/ledger/ledger.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthedChurch } from './auth-utils';
import { truncateAll } from './db-utils';

const PAYMENT = '66666666-6666-4666-8666-666666666666';
const CAMPAIGN = '22222222-2222-4222-8222-222222222222';
const PLACEHOLDER_CHURCH = '77777777-7777-4777-8777-777777777777';

const EVENT_PAYLOAD = {
  type: 'payment_settled' as const,
  paymentId: PAYMENT,
  churchId: PLACEHOLDER_CHURCH,
  campaignId: CAMPAIGN,
  memberId: null,
  amountKobo: 500_000,
};

let dedupeCounter = 0;

function postingFor(churchId: string) {
  dedupeCounter += 1;
  return {
    churchId,
    reason: 'test posting',
    entries: [
      {
        account: 'gateway_clearing' as const,
        entryType: 'debit' as const,
        amountKobo: 500_000n,
        dedupeKey: `${churchId}:clearing:${dedupeCounter}`,
      },
      {
        account: 'campaign_giving' as const,
        entryType: 'credit' as const,
        amountKobo: 500_000n,
        dedupeKey: `${churchId}:giving:${dedupeCounter}`,
      },
    ],
    eventPayload: { ...EVENT_PAYLOAD, churchId },
  };
}

describe('Transactional outbox (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;
  let relayProcessor: OutboxRelayProcessor;
  let domainEventsQueue: Queue;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    relayProcessor = app.get(OutboxRelayProcessor);
    domainEventsQueue = app.get<Queue>(getQueueToken('domain-events'));
  });

  beforeEach(async () => {
    await truncateAll(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a posting that throws after writing leaves zero LedgerEntry, LedgerTransaction, and DomainEvent rows', async () => {
    const { churchId } = await createAuthedChurch(app);

    await expect(
      prisma.$transaction(async (tx) => {
        await ledger.post(tx, postingFor(churchId));
        throw new Error('simulated failure after the ledger write');
      }),
    ).rejects.toThrow('simulated failure');

    expect(await prisma.ledgerEntry.count({ where: { churchId } })).toBe(0);
    expect(await prisma.ledgerTransaction.count({ where: { churchId } })).toBe(0);
    expect(await prisma.domainEvent.count({ where: { churchId } })).toBe(0);
  });

  it('a successful posting writes balanced entries and exactly one unpublished DomainEvent', async () => {
    const { churchId } = await createAuthedChurch(app);

    const { event } = await prisma.$transaction((tx) => ledger.post(tx, postingFor(churchId)));

    const entries = await prisma.ledgerEntry.findMany({ where: { churchId } });
    expect(entries).toHaveLength(2);
    const balance = entries.reduce(
      (sum, e) => sum + (e.entryType === 'debit' ? e.amountKobo : -e.amountKobo),
      0n,
    );
    expect(balance).toBe(0n);

    const stored = await prisma.domainEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.publishedAt).toBeNull();
  });

  it('rejects a posting that reuses a dedupeKey already recorded — a real Postgres unique-constraint hit, not a fabricated Prisma error', async () => {
    const { churchId } = await createAuthedChurch(app);
    const posting = postingFor(churchId);
    await prisma.$transaction((tx) => ledger.post(tx, posting));

    // Re-post with the exact same dedupeKeys — the "same fact, retried"
    // case (a retried webhook, a reconciliation sweep re-scanning
    // something it already saw).
    await expect(prisma.$transaction((tx) => ledger.post(tx, posting))).rejects.toThrow(
      /already recorded/,
    );

    expect(await prisma.ledgerEntry.count({ where: { churchId } })).toBe(2);
  });

  it('an event committed but never relayed is picked up and published on the next relay run — nothing is lost', async () => {
    const { churchId } = await createAuthedChurch(app);
    const { event } = await prisma.$transaction((tx) => ledger.post(tx, postingFor(churchId)));

    // "Crash": the process that would have relayed this never ran. Confirm
    // it genuinely sits unpublished first, so the next assertion proves the
    // relay recovers it rather than it never having been at risk.
    const beforeRelay = await prisma.domainEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(beforeRelay.publishedAt).toBeNull();

    const claimed = await relayProcessor.relay();
    expect(claimed.map((r) => r.id)).toContain(event.id);

    const afterRelay = await prisma.domainEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(afterRelay.publishedAt).not.toBeNull();

    const counts = await domainEventsQueue.getJobCounts('waiting', 'completed', 'active');
    expect(counts.waiting + counts.completed + counts.active).toBeGreaterThanOrEqual(1);
  });

  it('two relay ticks running concurrently against a batch of unpublished rows claim every row exactly once, with no overlap', async () => {
    const { churchId } = await createAuthedChurch(app);
    for (let i = 0; i < 10; i++) {
      await prisma.$transaction((tx) => ledger.post(tx, postingFor(churchId)));
    }

    const [a, b] = await Promise.all([relayProcessor.relay(), relayProcessor.relay()]);

    const claimedIds = [...a, ...b].map((r) => r.id);
    const uniqueIds = new Set(claimedIds);
    expect(claimedIds).toHaveLength(uniqueIds.size);
    expect(claimedIds).toHaveLength(10);
  });

  /**
   * The test above proves the outcome (exactly-once claiming) but cannot
   * distinguish SKIP LOCKED from a plain FOR UPDATE that just blocks and
   * then finds nothing left — both produce the same end state for a small
   * batch. This test proves the actual property SKIP LOCKED buys: a second
   * claim does not wait for the first transaction's lock to release. It
   * runs the exact claim query relay() uses, with a deliberate pg_sleep
   * inserted only in the test's own first transaction, never in production
   * code.
   */
  it('FOR UPDATE SKIP LOCKED lets a concurrent claim proceed without waiting on an already-locked row', async () => {
    const { churchId } = await createAuthedChurch(app);
    await prisma.$transaction((tx) => ledger.post(tx, postingFor(churchId)));

    const HOLD_MS = 2000;
    const holdingClaim = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM "DomainEvent"
          WHERE "publishedAt" IS NULL
          ORDER BY "createdAt"
          LIMIT 100
          FOR UPDATE SKIP LOCKED
        `;
        // $executeRaw, not $queryRaw — pg_sleep returns void, which
        // $queryRaw tries and fails to deserialize as a result column.
        await tx.$executeRaw`SELECT pg_sleep(${HOLD_MS / 1000})`;
      },
      { timeout: HOLD_MS + 5000 },
    );

    // Give the first transaction a moment to actually acquire its lock
    // before the second one starts racing it.
    await new Promise((resolve) => setTimeout(resolve, 200));

    try {
      const startedAt = Date.now();
      const secondClaim = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "DomainEvent"
        WHERE "publishedAt" IS NULL
        ORDER BY "createdAt"
        FOR UPDATE SKIP LOCKED
      `;
      const elapsedMs = Date.now() - startedAt;

      expect(secondClaim).toHaveLength(0);
      // Generous relative to HOLD_MS, not an absolute wall-clock guess — a
      // blocking claim would take the full HOLD_MS; this only needs to
      // prove it didn't.
      expect(elapsedMs).toBeLessThan(HOLD_MS * 0.75);
    } finally {
      await holdingClaim.catch(() => {});
    }
  });

  it('rejects a posting whose campaignId belongs to a different church', async () => {
    const { churchId: ownChurchId } = await createAuthedChurch(app);
    const { churchId: otherChurchId } = await createAuthedChurch(app);

    const settlementAccount = await prisma.settlementAccount.create({
      data: { churchId: otherChurchId, scopeType: 'church', label: 'Other church main account' },
    });
    const otherChurchCampaign = await prisma.campaign.create({
      data: {
        churchId: otherChurchId,
        title: 'Belongs to the other church',
        scopeType: 'church',
        settlementAccountId: settlementAccount.id,
        targetAmountKobo: 1_000_000n,
      },
    });

    dedupeCounter += 1;
    const posting = {
      churchId: ownChurchId,
      reason: 'cross-tenant campaign attempt',
      entries: [
        {
          account: 'gateway_clearing' as const,
          entryType: 'debit' as const,
          amountKobo: 500_000n,
          dedupeKey: `${ownChurchId}:clearing:${dedupeCounter}`,
        },
        {
          account: 'campaign_giving' as const,
          entryType: 'credit' as const,
          amountKobo: 500_000n,
          campaignId: otherChurchCampaign.id,
          dedupeKey: `${ownChurchId}:giving:${dedupeCounter}`,
        },
      ],
      eventPayload: { ...EVENT_PAYLOAD, churchId: ownChurchId },
    };

    await expect(prisma.$transaction((tx) => ledger.post(tx, posting))).rejects.toThrow(
      /do not belong to this church/,
    );

    expect(await prisma.ledgerEntry.count({ where: { churchId: ownChurchId } })).toBe(0);
  });

  /**
   * "No event is ever double-published" is not a guarantee this design (or
   * any transactional-outbox design without two-phase commit across
   * Postgres and Redis) can make. This proves what jobId: event.id actually
   * buys instead: a narrower window, not a closed one. A crash between
   * `queue.add` succeeding and the claim transaction committing is
   * simulated here by resetting publishedAt by hand — the relay re-publishes
   * on that path, but the job id collision means the queue still holds only
   * one job for it, not two.
   */
  it('re-relaying an event whose job is still in Redis does not duplicate the queue entry', async () => {
    const { churchId } = await createAuthedChurch(app);
    const { event } = await prisma.$transaction((tx) => ledger.post(tx, postingFor(churchId)));

    await relayProcessor.relay();
    await prisma.domainEvent.update({ where: { id: event.id }, data: { publishedAt: null } });
    await relayProcessor.relay();

    const jobs = await domainEventsQueue.getJobs(['waiting', 'active', 'completed']);
    const matching = jobs.filter((job) => job.data.domainEventId === event.id);
    expect(matching).toHaveLength(1);
  });
});
