import { BadRequestException, Controller, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Request } from 'express';
import { PaystackWebhookService } from './paystack-webhook.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@ApiExcludeController()
@Controller('webhooks')
export class PaystackWebhookController {
  constructor(private readonly service: PaystackWebhookService) {}

  @Post('paystack')
  @AllowAnonymous()
  async handle(@Req() req: RawBodyRequest) {
    if (!req.rawBody) {
      throw new BadRequestException('Missing raw body');
    }

    await this.service.receive(req.rawBody, req.headers as Record<string, string | string[]>);
    return { received: true };
  }
}
