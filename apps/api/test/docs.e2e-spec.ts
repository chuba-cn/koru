import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { setupDocs } from '../src/docs/setup-docs';

describe('API documentation surface (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupDocs(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the Scalar UI at /docs', async () => {
    const res = await request(app.getHttpServer()).get('/docs').expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Scalar API Reference');
  });

  it('does not publish internal-only field names, in either format', async () => {
    // These live on Prisma models but must never reach a shared Zod schema,
    // since every Zod schema becomes public documentation (ADR-0005).
    const json = await request(app.getHttpServer()).get('/schema.json').expect(200);
    const yaml = await request(app.getHttpServer()).get('/schema.yaml').expect(200);

    for (const document of [JSON.stringify(json.body), yaml.text]) {
      expect(document).not.toContain('providerSubaccountCode');
      expect(document).not.toContain('accountNumberHash');
      expect(document).not.toContain('passwordHash');
    }
  });

  it('does not leak secret values into the published document', async () => {
    // Asserts the values, not the variable names. Matching on names would pass
    // even if the real secret were interpolated into a description or example,
    // which is the only way one could actually get in here.
    const secrets = [process.env.BETTER_AUTH_SECRET, process.env.GOOGLE_CLIENT_SECRET];

    const json = await request(app.getHttpServer()).get('/schema.json').expect(200);
    const yaml = await request(app.getHttpServer()).get('/schema.yaml').expect(200);

    for (const secret of secrets) {
      expect(secret).toBeTruthy();
      expect(JSON.stringify(json.body)).not.toContain(secret);
      expect(yaml.text).not.toContain(secret);
    }
  });

  it('serves a downloadable JSON schema covering the domain routes', async () => {
    const res = await request(app.getHttpServer()).get('/schema.json').expect(200);
    expect(res.headers['content-type']).toContain('application/json');

    expect(res.body.info.title).toBe('KORU API');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/health',
        '/churches/{churchId}',
        '/churches/{churchId}/regions',
        '/churches/{churchId}/branches',
        '/churches/{churchId}/staff',
        '/churches/{churchId}/settlement-accounts',
        '/onboarding/church',
      ]),
    );
  });

  it('serves a downloadable YAML schema with the same content as the JSON one', async () => {
    const yamlRes = await request(app.getHttpServer()).get('/schema.yaml').expect(200);
    expect(yamlRes.headers['content-type']).toContain('yaml');
    expect(yamlRes.text.startsWith('openapi:')).toBe(true);

    const jsonRes = await request(app.getHttpServer()).get('/schema.json').expect(200);
    expect(yamlRes.text).toContain(`title: ${jsonRes.body.info.title}`);
  });

  it('serves the cleaned document — no nestjs-zod artefacts leak into the download', async () => {
    const res = await request(app.getHttpServer()).get('/schema.json').expect(200);
    expect(JSON.stringify(res.body)).not.toContain('x-zod');
  });
});
