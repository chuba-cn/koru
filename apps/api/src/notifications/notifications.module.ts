import { Module } from '@nestjs/common';
import { EmailProcessor } from './email.processor';
import { MailService } from './mail.service';

@Module({
  providers: [MailService, EmailProcessor],
  exports: [MailService],
})
export class NotificationsModule {}
