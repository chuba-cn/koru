import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
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
import { ErrorResponseDto } from '../common/api.dto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  CreateSettlementAccountDto,
  ListSettlementAccountsQueryDto,
  SettlementAccountDto,
  SettlementAccountPageDto,
  UpdateSettlementAccountDto,
} from './settlement-account.dto';
import { SettlementAccountService } from './settlement-account.service';

@ApiTags('settlement-accounts')
@Controller('churches/:churchId/settlement-accounts')
@UseGuards(TenantGuard, RolesGuard)
@StaffRoles('super_admin')
@ApiUnauthorizedResponse({ description: 'No active session', type: ErrorResponseDto })
@ApiForbiddenResponse({
  description: 'Church does not belong to the session, or role is not super_admin',
  type: ErrorResponseDto,
})
export class SettlementAccountController {
  constructor(private readonly service: SettlementAccountService) {}

  @Post()
  @ApiOperation({ summary: 'Record a settlement account (church-wide or branch-level)' })
  @ApiCreatedResponse({ type: SettlementAccountDto })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed, malformed UUID, or branchId not in this church',
    type: ErrorResponseDto,
  })
  create(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Body(new ZodValidationPipe(CreateSettlementAccountDto.schema))
    body: CreateSettlementAccountDto,
  ) {
    return this.service.create(churchId, body);
  }

  @Get()
  @StaffRoles('super_admin', 'regional_admin', 'branch_admin', 'finance')
  @ApiOperation({
    summary: 'List settlement accounts, optionally filtered by branch',
    description:
      'Unlike the rest of this controller, readable by delegated roles: a regional_admin/branch_admin/finance caller sees the accounts of branches within their own scope, plus any church-wide account (branchId null). super_admin sees everyone. Cursor paginated, ordered by label (id as tiebreaker). Send the response "endCursor" value as "cursor" with "direction=forward" for Next, or the response "startCursor" value as "cursor" with "direction=backward" for previous',
  })
  @ApiOkResponse({ type: SettlementAccountPageDto })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description:
      'Malformed cursor/limit, cursor not found or not visible to the caller, or direction=backward with no cursor',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Church does not belong to the session, or role cannot read settlement accounts',
    type: ErrorResponseDto,
  })
  list(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @CallerStaff() caller: TenantStaff,
    @Query(new ZodValidationPipe(ListSettlementAccountsQueryDto.schema))
    query: ListSettlementAccountsQueryDto,
  ) {
    return this.service.list(churchId, caller, query);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a settlement account label' })
  @ApiOkResponse({ type: SettlementAccountDto })
  @ApiNotFoundResponse({ description: 'Church or account not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed or malformed UUID',
    type: ErrorResponseDto,
  })
  update(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateSettlementAccountDto.schema))
    body: UpdateSettlementAccountDto,
  ) {
    return this.service.update(churchId, id, body);
  }
}
