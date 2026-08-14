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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
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
@StaffRoles('super_admin', 'regional_admin', 'branch_admin', 'finance')
@ApiUnauthorizedResponse({ description: 'No active session', type: ErrorResponseDto })
@ApiForbiddenResponse({
  description: 'Church does not belong to the session, or the role is not admin-tier',
  type: ErrorResponseDto,
})
export class SettlementAccountController {
  constructor(private readonly service: SettlementAccountService) {}

  @Post()
  @ApiOperation({
    summary: 'Register a settlement account at church, region or branch level',
    description:
      'A church-level account is super_admin only. A region-level account additionally admits regional_admin and finance; a branch-level account also admits branch_admin. Delegated roles must hold a scope that covers the target region or branch',
  })
  @ApiCreatedResponse({ type: SettlementAccountDto })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description:
      'Validation failed, malformed UUID, scopeRefId not a region/branch of this church, ' +
      'an unknown bank code, or an account number the bank could not resolve',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'Church does not belong to the session, the role may not register an account at this scope level, or the caller has no scope covering it',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'That bank account is already registered for this church',
    type: ErrorResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'The payment gateway could not be reached, or failed to register the subaccount',
    type: ErrorResponseDto,
  })
  create(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @CallerStaff() caller: TenantStaff,
    @Body(new ZodValidationPipe(CreateSettlementAccountDto.schema))
    body: CreateSettlementAccountDto,
  ) {
    return this.service.create(churchId, caller, body);
  }

  @Get()
  @ApiOperation({
    summary: 'List settlement accounts, optionally filtered by scope',
    description:
      'A super_admin sees every account. A regional_admin/branch_admin/finance caller sees the accounts of the regions and branches their own scope covers, the containing region of any branch they hold (read visibility only — they cannot create or relabel that region-level account), plus the church-wide account, which they may read but not create or relabel. Cursor paginated, ordered by label (id as tiebreaker). Send the response "endCursor" value as "cursor" with "direction=forward" for Next, or the response "startCursor" value as "cursor" with "direction=backward" for previous',
  })
  @ApiOkResponse({ type: SettlementAccountPageDto })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description:
      'Malformed cursor/limit, cursor not found or not visible to the caller, or direction=backward with no cursor',
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
  @ApiOperation({
    summary: "Update a settlement account's label or scope",
    description:
      "Authorized against the account's own stored scope, and against the requested scope as well when the scope changes, a caller needs authority over both sides of a move. Re-scoping does not touch the Paystack subaccount: scope decides who may manage and see the account, never where money lands",
  })
  @ApiOkResponse({ type: SettlementAccountDto })
  @ApiNotFoundResponse({ description: 'Church or account not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description:
      'Validation failed, malformed UUID, or scopeRefId not a region/branch of this church',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      "Church does not belong to the session, or the caller may not act on this account's current or requested scope",
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'The new scope would no longer cover one or more campaigns settling into this account',
    type: ErrorResponseDto,
  })
  update(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CallerStaff() caller: TenantStaff,
    @Body(new ZodValidationPipe(UpdateSettlementAccountDto.schema))
    body: UpdateSettlementAccountDto,
  ) {
    return this.service.update(churchId, id, caller, body);
  }
}
