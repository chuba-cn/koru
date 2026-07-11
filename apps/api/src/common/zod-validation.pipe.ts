import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of result.error.issues) {
        const field = issue.path.join('.') || '(root)';
        fieldErrors[field] = fieldErrors[field] ?? [];
        fieldErrors[field].push(issue.message);
      }

      throw new BadRequestException({
        message: 'Validation failed',
        errors: fieldErrors,
      });
    }

    return result.data;
  }
}
