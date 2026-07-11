import { PhoneSchema } from '@koru/shared';
import { Body, Controller, type INestApplication, Post, UsePipes } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe';

const EchoSchema = z.object({
  name: z.string().min(1),
  phone: PhoneSchema,
});

@Controller('echo')
class EchoController {
  @Post()
  @UsePipes(new ZodValidationPipe(EchoSchema))
  echo(@Body() body: z.infer<typeof EchoSchema>) {
    return { received: body };
  }
}

describe('ZodValidationPipe (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EchoController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts valid body and returns the parsed value', async () => {
    const res = await request(app.getHttpServer())
      .post('/echo')
      .send({ name: 'Chinemelum', phone: '+2348012345678' })
      .expect(201);
    expect(res.body.received.name).toBe('Chinemelum');
  });

  it('rejects an invalid body naming each bad field', async () => {
    const res = await request(app.getHttpServer())
      .post('/echo')
      .send({ name: '', phone: '12345' })
      .expect(400);
    expect(res.body.errors.name).toBeDefined();
    expect(res.body.errors.phone).toBeDefined();
  });
});
