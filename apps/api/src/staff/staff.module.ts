import { Module } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { AcceptInviteController } from './accept-invite.controller';
import { AcceptInviteService } from './accept-invite.service';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { StaffInviteService } from './staff-invite.service';

@Module({
  controllers: [StaffController, AcceptInviteController],
  providers: [StaffService, TenantGuard, RolesGuard, StaffInviteService, AcceptInviteService],
})
export class StaffModule {}
