import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('KORU API')
    .setDescription('Church pledge & project-giving platform - API reference')
    .setVersion('0.1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, cleanupOpenApiDoc(document));

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`KORU API running on http://localhost:${port}`);
  console.log(`API docs at http://localhost:${port}/docs`);
}

bootstrap();
