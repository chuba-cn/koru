import { Module } from '@nestjs/common';
import { TenantGuard } from '../auth/tenant.guard';
import { BranchController } from './branch.controller';
import { BranchService } from './branch.service';

@Module({
  controllers: [BranchController],
  providers: [BranchService, TenantGuard],
})
export class BranchModule {}
