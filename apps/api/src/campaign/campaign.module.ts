import { Module } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard';
import { ScopeService } from '../auth/scope.service';
import { TenantGuard } from '../auth/tenant.guard';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';

@Module({
  controllers: [CampaignController],
  providers: [CampaignService, TenantGuard, RolesGuard, ScopeService],
})
export class CampaignModule {}
