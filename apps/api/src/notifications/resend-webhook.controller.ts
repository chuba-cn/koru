import { BadRequestException, Controller, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Request } from 'express';
import { ResendWebhookService } from './resend-webhook.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@ApiExcludeController()
@Controller('webhooks')
export class ResendWebhookController {
  constructor(private readonly service: ResendWebhookService) {}

  @Post('resend')
  @AllowAnonymous()
  async handle(@Req() req: RawBodyRequest) {
    if (!req.rawBody) {
      throw new BadRequestException('Missing raw body');
    }

    await this.service.handle(req.rawBody, req.headers);
    return { received: true };
  }
}
