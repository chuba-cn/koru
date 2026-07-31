import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthedChurchWithRegion } from './auth-utils';
import { truncateAll } from './db-utils';
import { fakeClientIp } from './fake-client-ip';
import { signInMemberByPhone } from './member-auth-utils';

describe('Member phone OTP + join (e2e)', () => {
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

  it('rejects a locally-formatted phone number before it ever reaches the OTP store', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/phone-number/send-otp')
      .send({ phoneNumber: '08012345678' })
      .expect(400);
  });

  it('lists branches for a session with neither a Staff nor a Member row', async () => {
    const church = await createAuthedChurchWithRegion(app);
    await prisma.branch.create({ data: { churchId: church.churchId, name: 'Main Branch' } });
    const phone = '+2348012345601';
    const { cookie } = await signInMemberByPhone(app, phone);

    const res = await request(app.getHttpServer())
      .get(`/join/${church.churchId}/branches`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toEqual([expect.objectContaining({ name: 'Main Branch' })]);
  });

  it('creates a Member on first join, with no branch selected', async () => {
    const church = await createAuthedChurchWithRegion(app);
    const phone = '+2348012345602';
    const { cookie, userId } = await signInMemberByPhone(app, phone);

    const res = await request(app.getHttpServer())
      .post(`/join/${church.churchId}`)
      .set('Cookie', cookie)
      .send({ fullName: 'Ada Lovelace' })
      .expect(201);

    expect(res.body.homeBranchId).toBeNull();
    expect(res.body.phone).toBe(phone);
    expect(res.body).not.toHaveProperty('userId');
    const member = await prisma.member.findFirst({ where: { churchId: church.churchId, phone } });
    expect(member?.userId).toBe(userId);
  });

  it('rejects a homeBranchId that belongs to a different church', async () => {
    const church = await createAuthedChurchWithRegion(app);
    const otherChurch = await createAuthedChurchWithRegion(app, { emailPrefix: 'other' });
    const otherBranch = await prisma.branch.create({
      data: { churchId: otherChurch.churchId, name: 'Not Yours' },
    });
    const phone = '+2348012345603';
    const { cookie } = await signInMemberByPhone(app, phone);

    await request(app.getHttpServer())
      .post(`/join/${church.churchId}`)
      .set('Cookie', cookie)
      .send({ fullName: 'Ada Lovelace', homeBranchId: otherBranch.id })
      .expect(400);
  });

  it('is idempotent: joining the same church twice updates rather than duplicates', async () => {
    const church = await createAuthedChurchWithRegion(app);
    const phone = '+2348012345604';
    const { cookie } = await signInMemberByPhone(app, phone);

    await request(app.getHttpServer())
      .post(`/join/${church.churchId}`)
      .set('Cookie', cookie)
      .send({ fullName: 'Ada Lovelace' })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/join/${church.churchId}`)
      .set('Cookie', cookie)
      .send({ fullName: 'Ada, Countess of Lovelace' })
      .expect(200);

    expect(second.body.fullName).toBe('Ada, Countess of Lovelace');
    const members = await prisma.member.findMany({ where: { churchId: church.churchId, phone } });
    expect(members).toHaveLength(1);
  });

  it('409s when the phone is already linked to a different login', async () => {
    const church = await createAuthedChurchWithRegion(app);
    const phone = '+2348012345605';
    const { cookie } = await signInMemberByPhone(app, phone);

    /**
     * Models SIM recycling: a Member row for this phone is already linked to a
     * different login than the one currently holding the number. Better Auth's
     * own unique constraint on user.phoneNumber means two real sessions can never
     * verify the same phone at once, so the only way to produce this state is to
     * seed it directly — exactly how it would arise in production, from an old
     * record surviving a number reassignment.
     */
    await prisma.member.create({
      data: { churchId: church.churchId, phone, fullName: 'Previous Owner', userId: church.userId },
    });

    await request(app.getHttpServer())
      .post(`/join/${church.churchId}`)
      .set('Cookie', cookie)
      .send({ fullName: 'New Owner' })
      .expect(409);
  });

  it('returns every membership across churches, empty when there are none', async () => {
    const churchA = await createAuthedChurchWithRegion(app, { emailPrefix: 'a' });
    const churchB = await createAuthedChurchWithRegion(app, { emailPrefix: 'b' });
    const phone = '+2348012345606';
    const { cookie } = await signInMemberByPhone(app, phone);

    const empty = await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(200);
    expect(empty.body.memberships).toEqual([]);

    await request(app.getHttpServer())
      .post(`/join/${churchA.churchId}`)
      .set('Cookie', cookie)
      .send({ fullName: 'Ada Lovelace' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/join/${churchB.churchId}`)
      .set('Cookie', cookie)
      .send({ fullName: 'Ada Lovelace' })
      .expect(201);

    const res = await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(200);
    expect(res.body.memberships).toHaveLength(2);
    expect(res.body.phoneNumber).toBe(phone);
    expect(res.body.memberships[0]).not.toHaveProperty('userId');
  });

  it('403s a session with no verified phone attempting to join', async () => {
    const church = await createAuthedChurchWithRegion(app);

    await request(app.getHttpServer())
      .post(`/join/${church.churchId}`)
      .set('Cookie', church.cookie)
      .send({ fullName: 'Someone' })
      .expect(403);
  });

  it('429s once send-otp is called more than 3 times in a minute', async () => {
    const phone = '+2348012345607';
    const ip = fakeClientIp(phone);

    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/api/auth/phone-number/send-otp')
        .set('X-Forwarded-For', ip)
        .send({ phoneNumber: phone })
        .expect(200);
    }

    await request(app.getHttpServer())
      .post('/api/auth/phone-number/send-otp')
      .set('X-Forwarded-For', ip)
      .send({ phoneNumber: phone })
      .expect(429);
  });

  it('does not reveal whether a phone number is already registered', async () => {
    const knownPhone = '+2348012345608';
    const unknownPhone = '+2348012345609';
    await signInMemberByPhone(app, knownPhone);

    const known = await request(app.getHttpServer())
      .post('/api/auth/phone-number/send-otp')
      .set('X-Forwarded-For', fakeClientIp(knownPhone))
      .send({ phoneNumber: knownPhone })
      .expect(200);

    const unknown = await request(app.getHttpServer())
      .post('/api/auth/phone-number/send-otp')
      .set('X-Forwarded-For', fakeClientIp(unknownPhone))
      .send({ phoneNumber: unknownPhone })
      .expect(200);

    expect(Object.keys(known.body)).toEqual(Object.keys(unknown.body));
  });
});
