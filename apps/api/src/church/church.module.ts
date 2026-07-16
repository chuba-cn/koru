import { Module } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { ChurchController } from './church.controller';
import { ChurchService } from './church.service';

@Module({
  controllers: [ChurchController],
  providers: [ChurchService, TenantGuard, RolesGuard],
})
export class ChurchModule {}
