import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CallerStaff } from '../auth/caller-staff.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { StaffRoles } from '../auth/staff-roles.decorator';
import { TenantGuard, TenantStaff } from '../auth/tenant.guard';
import { ErrorResponseDto, PaginationQueryDto } from '../common/api.dto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { EmailLogPageDto } from './email-log.dto';
import { EmailLogService } from './email-log.service';

@ApiTags('email-logs')
@Controller('churches/:churchId/email-logs')
@UseGuards(TenantGuard, RolesGuard)
@StaffRoles('super_admin', 'regional_admin', 'branch_admin', 'finance')
@ApiUnauthorizedResponse({ description: 'No active session', type: ErrorResponseDto })
@ApiForbiddenResponse({
  description: 'Church mismatch or role not admin-tier',
  type: ErrorResponseDto,
})
export class EmailLogController {
  constructor(private readonly emailLogService: EmailLogService) {}

  @Get()
  @ApiOperation({ summary: 'List email logs visible to the caller' })
  @ApiOkResponse({ type: EmailLogPageDto })
  list(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @CallerStaff() caller: TenantStaff,
    @Query(new ZodValidationPipe(PaginationQueryDto.schema)) query: PaginationQueryDto,
  ) {
    return this.emailLogService.list(churchId, caller, query);
  }

  @Post(':id/resend')
  @ApiOperation({ summary: 'Resend a failed/bounced/complained email verbatim' })
  @ApiNotFoundResponse({ description: 'Email log not found', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'Log is not in a resendable status', type: ErrorResponseDto })
  resend(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CallerStaff() caller: TenantStaff,
  ) {
    return this.emailLogService.resend(churchId, id, caller);
  }
}
