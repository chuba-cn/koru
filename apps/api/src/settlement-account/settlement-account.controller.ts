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
import { RolesGuard } from '../auth/roles.guard';
import { StaffRoles } from '../auth/staff-roles.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { ErrorResponseDto } from '../common/api.dto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  CreateSettlementAccountDto,
  ListSettlementAccountsQueryDto,
  SettlementAccountDto,
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
  @ApiOperation({ summary: 'List settlement accounts, optionally filtered by branch' })
  @ApiOkResponse({ type: SettlementAccountDto, isArray: true })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({ description: 'Malformed query', type: ErrorResponseDto })
  list(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Query(new ZodValidationPipe(ListSettlementAccountsQueryDto.schema))
    query: ListSettlementAccountsQueryDto,
  ) {
    return this.service.list(churchId, query);
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
