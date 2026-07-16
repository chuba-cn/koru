import { Module } from '@nestjs/common';
import { TenantGuard } from '../auth/tenant.guard';
import { RegionController } from './region.controller';
import { RegionService } from './region.service';

@Module({
  controllers: [RegionController],
  providers: [RegionService, TenantGuard],
})
export class RegionModule {}
