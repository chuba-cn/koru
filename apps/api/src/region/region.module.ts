import { Module } from '@nestjs/common';
import { ScopeService } from '../auth/scope.service';
import { TenantGuard } from '../auth/tenant.guard';
import { RegionController } from './region.controller';
import { RegionService } from './region.service';

@Module({
  controllers: [RegionController],
  providers: [RegionService, TenantGuard, ScopeService],
})
export class RegionModule {}
