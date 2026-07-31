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
  BranchDto,
  BranchPageDto,
  CreateBranchDto,
  ListBranchesQueryDto,
  UpdateBranchDto,
} from './branch.dto';
import { BranchService } from './branch.service';

@ApiTags('branches')
@Controller('/churches/:churchId/branches')
@UseGuards(TenantGuard)
@ApiUnauthorizedResponse({ description: 'No active session', type: ErrorResponseDto })
@ApiForbiddenResponse({
  description: 'Church does not belong to the session, or role cannot manage branches',
  type: ErrorResponseDto,
})
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  @Post()
  @StaffRoles('super_admin', 'regional_admin', 'branch_admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Create a branch (optionally inside a region)' })
  @ApiCreatedResponse({ type: BranchDto })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiConflictResponse({
    description: 'Branch name already exists in this church',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed, malformed UUID, or regionId not in this church',
    type: ErrorResponseDto,
  })
  create(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @CallerStaff() caller: TenantStaff,
    @Body(new ZodValidationPipe(CreateBranchDto.schema)) body: CreateBranchDto,
  ) {
    return this.branchService.create(churchId, caller, body);
  }

  @Get()
  @ApiOperation({
    summary: 'List branches of a church, optionally filtered by region',
    description:
      'A delegated caller sees only branches within their own scope — their own branch(es), or every branch inside their region(s). super_admin sees everyone. The optional regionId filter narrows within that scope, it never widens past it. Cursor paginated, ordered by name (id as tiebreaker). Send the response "endCursor" value as "cursor" with "direction=forward" for Next, or the response "startCursor" value as "cursor" with "direction=backward" for previous',
  })
  @ApiOkResponse({ type: BranchPageDto })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description:
      'Malformed cursor/limit, cursor not found or not visible to the caller, or direction=backward with no cursor',
    type: ErrorResponseDto,
  })
  list(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @CallerStaff() caller: TenantStaff,
    @Query(new ZodValidationPipe(ListBranchesQueryDto.schema)) query: ListBranchesQueryDto,
  ) {
    return this.branchService.list(churchId, caller, query);
  }

  @Patch(':id')
  @StaffRoles('super_admin', 'regional_admin', 'branch_admin')
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: 'Update a branch; set regionId to move it, null to remove it from its region',
  })
  @ApiOkResponse({ type: BranchDto })
  @ApiNotFoundResponse({ description: 'Church or branch not found', type: ErrorResponseDto })
  @ApiConflictResponse({
    description: 'Branch name already exists in this church',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed, malformed UUID, or regionId not in this church',
    type: ErrorResponseDto,
  })
  update(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CallerStaff() caller: TenantStaff,
    @Body(new ZodValidationPipe(UpdateBranchDto.schema)) body: UpdateBranchDto,
  ) {
    return this.branchService.update(churchId, id, caller, body);
  }
}
