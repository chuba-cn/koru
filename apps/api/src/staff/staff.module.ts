import { Module } from '@nestjs/common';
import { AuthUsersService } from '../auth/auth-users.service';
import { RolesGuard } from '../auth/roles.guard';
import { ScopeService } from '../auth/scope.service';
import { TenantGuard } from '../auth/tenant.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { AcceptInviteController } from './accept-invite.controller';
import { AcceptInviteService } from './accept-invite.service';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { StaffInviteService } from './staff-invite.service';

@Module({
  imports: [NotificationsModule],
  controllers: [StaffController, AcceptInviteController],
  providers: [
    StaffService,
    TenantGuard,
    RolesGuard,
    StaffInviteService,
    AcceptInviteService,
    AuthUsersService,
    ScopeService,
  ],
})
export class StaffModule {}
