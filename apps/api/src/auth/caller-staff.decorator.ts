import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { TenantStaff } from './tenant.guard';

export const CallerStaff = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantStaff => {
    return context.switchToHttp().getRequest().staff;
  },
);
