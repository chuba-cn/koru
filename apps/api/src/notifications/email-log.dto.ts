import { EmailLogPageSchema } from '@koru/shared';
import { createZodDto } from 'nestjs-zod';

export class EmailLogPageDto extends createZodDto(EmailLogPageSchema) {}
