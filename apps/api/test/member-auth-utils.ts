import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { smsSender } from '../src/notifications/sms-sender';
import { fakeClientIp } from './fake-client-ip';

export async function signInMemberByPhone(app: INestApplication, phone: string) {
  const ip = fakeClientIp(phone);

  await request(app.getHttpServer())
    .post('/api/auth/phone-number/send-otp')
    .set('X-Forwarded-For', ip)
    .send({ phoneNumber: phone })
    .expect(200);

  const sent = smsSender.lastSentTo(phone);
  if (!sent) throw new Error(`No OTP was sent to ${phone}`);
  const code = sent.body.match(/\d{6}/)?.[0];
  if (!code) throw new Error(`Could not find a 6-digit code in "${sent.body}"`);

  const verify = await request(app.getHttpServer())
    .post('/api/auth/phone-number/verify')
    .set('X-Forwarded-For', ip)
    .send({ phoneNumber: phone, code })
    .expect(200);

  const rawCookies = verify.headers['set-cookie'];
  if (!rawCookies) throw new Error('Better Auth did not set a session cookie on verify');
  const cookie = Array.isArray(rawCookies) ? rawCookies.join('; ') : String(rawCookies);

  return { cookie, userId: verify.body.user.id as string };
}
