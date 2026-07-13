import { ErrorResponseSchema } from '@koru/shared';
import { createZodDto } from 'nestjs-zod';

export class ErrorResponseDto extends createZodDto(ErrorResponseSchema) {}
