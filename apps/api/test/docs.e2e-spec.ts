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
