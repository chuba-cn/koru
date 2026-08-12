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
  Query,
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
import { ErrorResponseDto, PaginationQueryDto } from '../common/api.dto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CreateRegionDto, RegionDto, RegionPageDto, UpdateRegionDto } from './region.dto';
import { RegionService } from './region.service';

@ApiTags('regions')
@Controller('churches/:churchId/regions')
@UseGuards(TenantGuard)
@ApiUnauthorizedResponse({ description: 'No active session', type: ErrorResponseDto })
@ApiForbiddenResponse({
  description: 'Church does not belong to the session, or role cannot manage regions',
  type: ErrorResponseDto,
})
export class RegionController {
  constructor(private readonly regionService: RegionService) {}

  @Post()
  @StaffRoles('super_admin', 'regional_admin', 'branch_admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Create a region in a church' })
  @ApiCreatedResponse({ type: RegionDto })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiConflictResponse({
    description: 'Region name already exists in this church',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed or malformed UUID',
    type: ErrorResponseDto,
  })
  create(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Body(new ZodValidationPipe(CreateRegionDto.schema)) body: CreateRegionDto,
  ) {
    return this.regionService.create(churchId, body);
  }

  @Get()
  @ApiOperation({
    summary: 'List regions of a church',
    description:
      'A delegated caller sees only regions within their own scope — their own region(s), or the region(s) containing their branch(es). super_admin sees everyone. Cursor paginated, ordered by name (id as tiebreaker). Send the response "endCursor" value as "cursor" with "direction=forward" for Next, or the response "startCursor" value as "cursor" with "direction=backward" for previous',
  })
  @ApiOkResponse({ type: RegionPageDto })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description:
      'Malformed cursor/limit, cursor not found or not visible to the caller, or direction=backward with no cursor',
    type: ErrorResponseDto,
  })
  list(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @CallerStaff() caller: TenantStaff,
    @Query(new ZodValidationPipe(PaginationQueryDto.schema)) query: PaginationQueryDto,
  ) {
    return this.regionService.list(churchId, caller, query);
  }

  @Patch(':id')
  @StaffRoles('super_admin', 'regional_admin', 'branch_admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Rename/update a region' })
  @ApiOkResponse({ type: RegionDto })
  @ApiNotFoundResponse({ description: 'Church or region not found', type: ErrorResponseDto })
  @ApiConflictResponse({
    description: 'Region name already exists in this church',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed or malformed UUID',
    type: ErrorResponseDto,
  })
  update(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CallerStaff() caller: TenantStaff,
    @Body(new ZodValidationPipe(UpdateRegionDto.schema)) body: UpdateRegionDto,
  ) {
    return this.regionService.update(churchId, id, caller, body);
  }

  @Delete(':id')
  @StaffRoles('super_admin', 'regional_admin', 'branch_admin')
  @UseGuards(RolesGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an empty region' })
  @ApiNoContentResponse({ description: 'Region deleted' })
  @ApiNotFoundResponse({ description: 'Church or region not found', type: ErrorResponseDto })
  @ApiConflictResponse({
    description: 'Region still has branches, campaigns or settlement accounts',
    type: ErrorResponseDto,
  })
  remove(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CallerStaff() caller: TenantStaff,
  ) {
    return this.regionService.remove(churchId, id, caller);
  }
}
