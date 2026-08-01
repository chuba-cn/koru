import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthedChurch } from './auth-utils';
import { truncateAll } from './db-utils';

const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET ?? '';

function signedHeaders(payload: string) {
  const id = 'msg_e2e';
  const timestamp = Math.floor(Date.now() / 1000);
  const key = Buffer.from(WEBHOOK_SECRET.replace(/^whsec_/, ''), 'base64');
  const signature = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64');

  return {
    'svix-id': id,
    'svix-timestamp': String(timestamp),
    'svix-signature': `v1,${signature}`,
  };
}

describe('Resend webhook receiver (e2e, #67)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    // Mirrors main.ts: Nest's own body parser must stay off so AuthModule's
    // rawBody-capturing parser is the only one to touch the request stream —
    // the webhook receiver needs the exact bytes to verify Resend's signature.
    app = moduleRef.createNestApplication({ bodyParser: false });
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await truncateAll(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a request with no valid signature, before touching the database', async () => {
    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'msg-1' } });

    await request(app.getHttpServer())
      .post('/webhooks/resend')
      .set('svix-id', 'msg_e2e')
      .set('svix-timestamp', String(Math.floor(Date.now() / 1000)))
      .set('svix-signature', 'v1,not-the-real-signature')
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(401);
  });

  it('marks the matching EmailLog delivered on a validly signed email.delivered event', async () => {
    const { churchId } = await createAuthedChurch(app);
    const log = await prisma.emailLog.create({
      data: {
        churchId,
        category: 'church_welcome',
        recipientEmail: 'a@example.test',
        subject: 'Welcome',
        renderedHtml: '<p>Welcome</p>',
        providerName: 'resend',
        status: 'sent',
        providerMessageId: 'provider-msg-1',
      },
    });

    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'provider-msg-1' } });

    await request(app.getHttpServer())
      .post('/webhooks/resend')
      .set(signedHeaders(body))
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(201);

    const updated = await prisma.emailLog.findUniqueOrThrow({ where: { id: log.id } });
    expect(updated.status).toBe('delivered');
    expect(updated.deliveredAt).not.toBeNull();
  });

  it('acknowledges a webhook for a provider message id with no matching EmailLog, without writing anything', async () => {
    const body = JSON.stringify({ type: 'email.bounced', data: { email_id: 'no-such-message' } });

    await request(app.getHttpServer())
      .post('/webhooks/resend')
      .set(signedHeaders(body))
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(201);
  });

  it('acknowledges a non-email event (domain.created) as a clean no-op', async () => {
    const body = JSON.stringify({ type: 'domain.created', data: { id: 'dom_1' } });

    const res = await request(app.getHttpServer())
      .post('/webhooks/resend')
      .set(signedHeaders(body))
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(201);

    expect(res.body).toEqual({ received: true });
  });
});
