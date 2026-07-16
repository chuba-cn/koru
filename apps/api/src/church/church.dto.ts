import { ChurchSchema, UpdateChurchSchema } from '@koru/shared';
import { createZodDto } from 'nestjs-zod';

export class UpdateChurchDto extends createZodDto(UpdateChurchSchema) {}
export class ChurchDto extends createZodDto(ChurchSchema) {}
