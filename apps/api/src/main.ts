import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupDocs } from './docs/setup-docs';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  setupDocs(app);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`KORU API running on http://localhost:${port}`);
  console.log(`Domain API docs at http://localhost:${port}/docs`);
  console.log(`OpenAPI schema at http://localhost:${port}/schema.json (or /schema.yaml)`);
  console.log(`Auth API docs at http://localhost:${port}/api/auth/reference`);
}

bootstrap();
