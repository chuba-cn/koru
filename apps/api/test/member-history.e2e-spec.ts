import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthedChurch } from './auth-utils';
import { truncateAll } from './db-utils';
import { signInMemberByPhone } from './member-auth-utils';

async function joinChurch(
  app: INestApplication,
  churchId: string,
  cookie: string,
  fullName: string,
) {
  const res = await request(app.getHttpServer())
    .post(`/join/${churchId}`)
    .set('Cookie', cookie)
    .send({ fullName })
    .expect(201);
  return res.body as { id: string };
}

async function seedGiving(
  prisma: PrismaService,
  churchId: string,
  memberId: string,
  title: string,
) {
  const account = await prisma.settlementAccount.create({
    data: { churchId, label: `${title} account` },
  });
  const campaign = await prisma.campaign.create({
    data: {
      churchId,
      title,
      scopeType: 'church',
      settlementAccountId: account.id,
      targetAmountKobo: 100_000_00n,
    },
  });
  const pledge = await prisma.pledge.create({
    data: { campaignId: campaign.id, memberId, pledgeAmountKobo: 50_000_00n },
  });
  const payment = await prisma.payment.create({
    data: {
      campaignId: campaign.id,
      memberId,
      pledgeId: pledge.id,
      amountKobo: 20_000_00n,
      channel: 'paystack_transfer',
      status: 'success',
    },
  });
  return { campaign, pledge, payment };
}

describe('Member pledge history (e2e)', () => {
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

  it("returns a member's own pledges, with the campaign title and a numeric amount", async () => {
    const church = await createAuthedChurch(app);
    const ada = await signInMemberByPhone(app, '+2348012345701');
    const member = await joinChurch(app, church.churchId, ada.cookie, 'Ada Lovelace');
    await seedGiving(prisma, church.churchId, member.id, 'Building Fund');

    const res = await request(app.getHttpServer())
      .get(`/me/churches/${church.churchId}/pledges`)
      .set('Cookie', ada.cookie)
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].campaign.title).toBe('Building Fund');
    expect(res.body.items[0].pledgeAmountKobo).toBe(5_000_000);
    expect(typeof res.body.items[0].pledgeAmountKobo).toBe('number');
    expect(res.body.items[0]).not.toHaveProperty('member');
  });

  it("returns a member's own payments, excluding anonymous giving with no member attached", async () => {
    const church = await createAuthedChurch(app);
    const ada = await signInMemberByPhone(app, '+2348012345702');
    const member = await joinChurch(app, church.churchId, ada.cookie, 'Ada Lovelace');
    const { campaign } = await seedGiving(prisma, church.churchId, member.id, 'Building Fund');
    await prisma.payment.create({
      data: {
        campaignId: campaign.id,
        memberId: null,
        amountKobo: 10_000_00n,
        channel: 'cash',
        status: 'success',
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/me/churches/${church.churchId}/payments`)
      .set('Cookie', ada.cookie)
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].amountKobo).toBe(2_000_000);
    expect(res.body.items[0].status).toBe('success');
    expect(res.body.items[0]).not.toHaveProperty('paystackReference');
  });

  /**
   * Two members in the same church, and one
   * can never see the other's giving. Isolation is enforced by the query's
   * userId filter, not by a guard.
   */
  it("never shows another member's pledges or payments", async () => {
    const church = await createAuthedChurch(app);

    const ada = await signInMemberByPhone(app, '+2348012345703');
    const adaMember = await joinChurch(app, church.churchId, ada.cookie, 'Ada Lovelace');
    await seedGiving(prisma, church.churchId, adaMember.id, "Ada's Campaign");

    const grace = await signInMemberByPhone(app, '+2348012345704');
    const graceMember = await joinChurch(app, church.churchId, grace.cookie, 'Grace Hopper');
    await seedGiving(prisma, church.churchId, graceMember.id, "Grace's Campaign");

    const pledges = await request(app.getHttpServer())
      .get(`/me/churches/${church.churchId}/pledges`)
      .set('Cookie', ada.cookie)
      .expect(200);

    expect(pledges.body.items).toHaveLength(1);
    expect(pledges.body.items[0].campaign.title).toBe("Ada's Campaign");

    const payments = await request(app.getHttpServer())
      .get(`/me/churches/${church.churchId}/payments`)
      .set('Cookie', ada.cookie)
      .expect(200);

    expect(payments.body.items).toHaveLength(1);
    expect(payments.body.items[0].campaign.title).toBe("Ada's Campaign");
  });

  it('returns an empty list for a church the member never joined, leaking nothing', async () => {
    const church = await createAuthedChurch(app);
    const other = await createAuthedChurch(app, { emailPrefix: 'other' });
    const ada = await signInMemberByPhone(app, '+2348012345705');
    const member = await joinChurch(app, church.churchId, ada.cookie, 'Ada Lovelace');
    await seedGiving(prisma, church.churchId, member.id, 'Building Fund');

    // Seed real giving in the other church too, so this proves isolation —
    // not just that the other church happens to have no data at all.
    const otherAda = await prisma.member.create({
      data: { churchId: other.churchId, phone: '+2348099999996', fullName: 'Other Church Ada' },
    });
    await seedGiving(prisma, other.churchId, otherAda.id, 'Other Church Fund');

    const res = await request(app.getHttpServer())
      .get(`/me/churches/${other.churchId}/pledges`)
      .set('Cookie', ada.cookie)
      .expect(200);

    expect(res.body.items).toEqual([]);
  });

  /**
   * Dual identity: one Better Auth login is both a super_admin Staff and a
   * Member, and the member endpoint returns their giving with no special case.
   * The Staff user signs up by email (no verified phone), so the Member link is
   * seeded directly — which is exactly the "linkable to both" the schema allows.
   */
  it('lets a staff login that is also a member see their own giving, no special case', async () => {
    const church = await createAuthedChurch(app);

    const member = await prisma.member.create({
      data: {
        churchId: church.churchId,
        phone: '+2348012345799',
        fullName: 'Staff Who Also Gives',
        userId: church.userId,
      },
    });
    await seedGiving(prisma, church.churchId, member.id, 'Staff Gift');

    const res = await request(app.getHttpServer())
      .get(`/me/churches/${church.churchId}/pledges`)
      .set('Cookie', church.cookie)
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].campaign.title).toBe('Staff Gift');
  });

  it('leaves the shared login intact when the member link is severed', async () => {
    const church = await createAuthedChurch(app);
    const member = await prisma.member.create({
      data: {
        churchId: church.churchId,
        phone: '+2348012345798',
        fullName: 'Severable Member',
        userId: church.userId,
      },
    });

    await prisma.member.update({ where: { id: member.id }, data: { userId: null } });

    // The staff login still works — severing the member link touched nothing on the Staff side.
    await request(app.getHttpServer())
      .get(`/churches/${church.churchId}/staff`)
      .set('Cookie', church.cookie)
      .expect(200);

    const stillThere = await prisma.member.findUnique({ where: { id: member.id } });
    expect(stillThere?.userId).toBeNull();
  });

  /**
   * #84: the giving history paginates. A stable forward walk across a page
   * boundary must repeat no row and drop none, and the Kobo conversion must
   * survive the paging.
   */
  it('paginates pledge history with a stable walk across a page boundary', async () => {
    const church = await createAuthedChurch(app);
    const ada = await signInMemberByPhone(app, '+2348012345710');
    const member = await joinChurch(app, church.churchId, ada.cookie, 'Ada Lovelace');

    const account = await prisma.settlementAccount.create({
      data: { churchId: church.churchId, label: 'Walk account' },
    });
    const campaign = await prisma.campaign.create({
      data: {
        churchId: church.churchId,
        title: 'Walk Fund',
        scopeType: 'church',
        settlementAccountId: account.id,
        targetAmountKobo: 100_000_00n,
      },
    });
    for (let i = 1; i <= 3; i++) {
      await prisma.pledge.create({
        data: {
          campaignId: campaign.id,
          memberId: member.id,
          pledgeAmountKobo: BigInt(i * 1_000_00),
        },
      });
    }

    const first = await request(app.getHttpServer())
      .get(`/me/churches/${church.churchId}/pledges`)
      .query({ limit: 2 })
      .set('Cookie', ada.cookie)
      .expect(200);

    expect(first.body.items).toHaveLength(2);
    expect(first.body.hasNextPage).toBe(true);
    expect(first.body.hasPreviousPage).toBe(false);
    expect(typeof first.body.items[0].pledgeAmountKobo).toBe('number');

    const second = await request(app.getHttpServer())
      .get(`/me/churches/${church.churchId}/pledges`)
      .query({ limit: 2, cursor: first.body.endCursor })
      .set('Cookie', ada.cookie)
      .expect(200);

    const firstIds = first.body.items.map((p: { id: string }) => p.id);
    const secondIds = second.body.items.map((p: { id: string }) => p.id);
    expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(3);
    expect(second.body.hasPreviousPage).toBe(true);

    const back = await request(app.getHttpServer())
      .get(`/me/churches/${church.churchId}/pledges`)
      .query({ limit: 2, direction: 'backward', cursor: second.body.startCursor })
      .set('Cookie', ada.cookie)
      .expect(200);

    expect(back.body.items.map((p: { id: string }) => p.id)).toEqual(firstIds);
  });

  /**
   * The security-relevant behaviour of the new pagination: a cursor is only
   * valid within the caller's own where-clause. Another member's real pledge id
   * must be rejected as not visible, never silently treated as a valid cursor
   * into Ada's own list.
   */
  it("400s a cursor that is another member's pledge, rather than treating it as visible", async () => {
    const church = await createAuthedChurch(app);
    const ada = await signInMemberByPhone(app, '+2348012345711');
    const adaMember = await joinChurch(app, church.churchId, ada.cookie, 'Ada Lovelace');
    await seedGiving(prisma, church.churchId, adaMember.id, "Ada's Fund");

    const grace = await signInMemberByPhone(app, '+2348012345712');
    const graceMember = await joinChurch(app, church.churchId, grace.cookie, 'Grace Hopper');
    const { pledge: gracePledge } = await seedGiving(
      prisma,
      church.churchId,
      graceMember.id,
      "Grace's Fund",
    );

    await request(app.getHttpServer())
      .get(`/me/churches/${church.churchId}/pledges`)
      .query({ cursor: gracePledge.id })
      .set('Cookie', ada.cookie)
      .expect(400);
  });
});
