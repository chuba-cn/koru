import { ChurchSchema, CreateChurchSchema, UpdateChurchSchema } from '@koru/shared';
import { createZodDto } from 'nestjs-zod';

export class CreateChurchDto extends createZodDto(CreateChurchSchema) {}
export class UpdateChurchDto extends createZodDto(UpdateChurchSchema) {}
export class ChurchDto extends createZodDto(ChurchSchema) {}
