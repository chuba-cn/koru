import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/api.dto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BranchDto, CreateBranchDto, ListBranchesQueryDto, UpdateBranchDto } from './branch.dto';
import { BranchService } from './branch.service';

@ApiTags('branches')
@Controller('/churches/:churchId/branches')
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  @Post()
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
    @Body(new ZodValidationPipe(CreateBranchDto.schema)) body: CreateBranchDto,
  ) {
    return this.branchService.create(churchId, body);
  }

  @Get()
  @ApiOperation({ summary: 'List branches of a church, optionally filtered by region' })
  @ApiOkResponse({ type: BranchDto, isArray: true })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({ description: 'Malformed query', type: ErrorResponseDto })
  list(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Query(new ZodValidationPipe(ListBranchesQueryDto.schema)) query: ListBranchesQueryDto,
  ) {
    return this.branchService.list(churchId, query);
  }

  @Patch(':id')
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
    @Body(new ZodValidationPipe(UpdateBranchDto.schema)) body: UpdateBranchDto,
  ) {
    return this.branchService.update(churchId, id, body);
  }
}
