import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
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
import { ErrorResponseDto } from '../common/api.dto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  CreateStaffDto,
  ReplaceScopesDto,
  StaffDto,
  StaffInviteDto,
  StaffWithInviteDto,
  UpdateStaffDto,
} from './staff.dto';
import { StaffService } from './staff.service';

@ApiTags('staff')
@Controller('churches/:churchId/staff')
@UseGuards(TenantGuard, RolesGuard)
@StaffRoles('super_admin')
@ApiUnauthorizedResponse({ description: 'No active session', type: ErrorResponseDto })
@ApiForbiddenResponse({
  description: 'Church does not belong to the session, or role is not super_admin',
  type: ErrorResponseDto,
})
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post()
  @StaffRoles('super_admin', 'regional_admin', 'branch_admin')
  @ApiOperation({ summary: 'Register a staff member' })
  @ApiCreatedResponse({
    type: StaffWithInviteDto,
    description: 'Staff created, with a one-time invite token',
  })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'Email already used in this church', type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description:
      'Church does not belong to the session, role cannot create a staff, or a delegated admin tried to grant a role/scope outside their own',
  })
  @ApiBadRequestResponse({
    description: 'Validation failed, malformed UUID, or scope not in this church',
    type: ErrorResponseDto,
  })
  create(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Body(new ZodValidationPipe(CreateStaffDto.schema)) body: CreateStaffDto,
    @CallerStaff() caller: TenantStaff,
  ) {
    return this.staffService.create(churchId, body, caller);
  }

  @Get()
  @StaffRoles('super_admin', 'regional_admin', 'branch_admin')
  @ApiOperation({
    summary: 'List staff of a church, including their scopes',
    description:
      'A delegated admin (regional_admin/branch_admin) sees only staff they could manage — their own tier or below, within their own scope. super_admin sees everyone.',
  })
  @ApiOkResponse({ type: StaffDto, isArray: true })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  list(@Param('churchId', ParseUUIDPipe) churchId: string, @CallerStaff() caller: TenantStaff) {
    return this.staffService.list(churchId, caller);
  }

  @Patch(':id')
  @StaffRoles('super_admin', 'regional_admin', 'branch_admin')
  @ApiOperation({ summary: 'Update a staff member (name/role; email is immutable)' })
  @ApiOkResponse({ type: StaffDto })
  @ApiNotFoundResponse({ description: 'Church or staff not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed or malformed UUID',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'Church does not belong to the session, or a delegated admin tried to manage staff outside their tier/scope, or assign a role above their ceiling',
    type: ErrorResponseDto,
  })
  update(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateStaffDto.schema)) body: UpdateStaffDto,
    @CallerStaff() caller: TenantStaff,
  ) {
    return this.staffService.update(churchId, id, body, caller);
  }

  @Put(':id/scopes')
  @StaffRoles('super_admin', 'regional_admin', 'branch_admin')
  @ApiOperation({ summary: 'Replace ALL scopes of a staff member (send [] to clear)' })
  @ApiOkResponse({ type: StaffDto })
  @ApiNotFoundResponse({ description: 'Church or staff not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed, malformed UUID, or scope not in this church',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'Church does not belong to the session, or a delegated admin tried to manage staff, or grant a scope, outside their own authority',
    type: ErrorResponseDto,
  })
  replaceScopes(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ReplaceScopesDto.schema)) body: ReplaceScopesDto,
    @CallerStaff() caller: TenantStaff,
  ) {
    return this.staffService.replaceScopes(churchId, id, body, caller);
  }

  @Post(':id/invite')
  @StaffRoles('super_admin', 'regional_admin', 'branch_admin')
  @ApiOperation({ summary: 'Re-issue an invite, invalidating any previous one' })
  @ApiCreatedResponse({
    type: StaffInviteDto,
    description: 'A new invite; the token is shown only once',
  })
  @ApiConflictResponse({ description: 'Staff member has already accepted', type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description:
      'Church does not belong to the session, or a delegated admin tried to manage staff outside their tier/scope',
    type: ErrorResponseDto,
  })
  reissueInvite(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CallerStaff() caller: TenantStaff,
  ) {
    return this.staffService.reissueInvite(churchId, id, caller);
  }

  @Post(':id/invite/reclaim')
  @ApiOperation({
    summary: 'Delete a login squatting on this staff email, then issue a fresh invite',
  })
  @ApiCreatedResponse({
    type: StaffInviteDto,
    description: 'Login reclaimed; a new invite token is returned once',
  })
  @ApiNotFoundResponse({ description: 'Staff not found, or no login holds that email' })
  @ApiConflictResponse({
    description: 'Already accepted, the login owns data, or it is inside the grace period',
    type: ErrorResponseDto,
  })
  reclaimLogin(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.staffService.reclaimLogin(churchId, id);
  }

  @Delete(':id/invite')
  @HttpCode(HttpStatus.NO_CONTENT)
  @StaffRoles('super_admin', 'regional_admin', 'branch_admin')
  @ApiOperation({ summary: 'Revoke any outstanding invite for a staff member' })
  @ApiNoContentResponse({ description: 'Invite revoked' })
  @ApiForbiddenResponse({
    description:
      'Church does not belong to the session, or a delegated admin tried to manage staff outside their tier/scope',
    type: ErrorResponseDto,
  })
  revokeInvite(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CallerStaff() caller: TenantStaff,
  ) {
    return this.staffService.revokeInvite(churchId, id, caller);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @StaffRoles('super_admin', 'regional_admin', 'branch_admin')
  @ApiOperation({ summary: 'Remove a staff member (their scopes go with them)' })
  @ApiNoContentResponse({ description: 'Staff deleted' })
  @ApiNotFoundResponse({ description: 'Church or staff not found', type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description:
      'Church does not belong to the session, or a delegated admin tried to manage staff outside their tier/scope',
    type: ErrorResponseDto,
  })
  remove(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CallerStaff() caller: TenantStaff,
  ) {
    return this.staffService.remove(churchId, id, caller);
  }
}
