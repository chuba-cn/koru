import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { cleanupOpenApiDoc } from 'nestjs-zod';

export const DOCS_PATH = 'docs';
export const SCHEMA_JSON_PATH = 'schema.json';
export const SCHEMA_YAML_PATH = 'schema.yaml';

export function setupDocs(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('KORU API')
    .setDescription('Church pledge & project-giving platform - API reference')
    .setVersion('0.1.0')
    .build();

  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));

  app.use(`/${DOCS_PATH}`, apiReference({ theme: 'saturn', content: document }));

  SwaggerModule.setup(DOCS_PATH, app, document, {
    ui: false,
    raw: ['json', 'yaml'],
    jsonDocumentUrl: SCHEMA_JSON_PATH,
    yamlDocumentUrl: SCHEMA_YAML_PATH,
  });

  return document;
}
