import { Module } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  controllers: [StaffController],
  providers: [StaffService, TenantGuard, RolesGuard],
})
export class StaffModule {}
