import { Module } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard';
import { ScopeService } from '../auth/scope.service';
import { TenantGuard } from '../auth/tenant.guard';
import { EmailProcessor } from './email.processor';
import { EmailLogController } from './email-log.controller';
import { EmailLogService } from './email-log.service';
import { MailService } from './mail.service';
import { ResendWebhookController } from './resend-webhook.controller';
import { ResendWebhookService } from './resend-webhook.service';

@Module({
  controllers: [ResendWebhookController, EmailLogController],
  providers: [
    MailService,
    EmailProcessor,
    ResendWebhookService,
    EmailLogService,
    TenantGuard,
    RolesGuard,
    ScopeService,
  ],
  exports: [MailService],
})
export class NotificationsModule {}
