import { ErrorResponseSchema, PaginationQuerySchema } from '@koru/shared';
import { createZodDto } from 'nestjs-zod';

export class ErrorResponseDto extends createZodDto(ErrorResponseSchema) {}
export class PaginationQueryDto extends createZodDto(PaginationQuerySchema) {}
