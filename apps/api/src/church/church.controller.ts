import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
import { ChurchDto, UpdateChurchDto } from './church.dto';
import { ChurchService } from './church.service';

@ApiTags('churches')
@Controller('churches')
@UseGuards(TenantGuard)
@ApiUnauthorizedResponse({ description: 'No active session', type: ErrorResponseDto })
@ApiForbiddenResponse({
  description: 'Church does not belong to the session, or role is not super_admin (PATCH only)',
  type: ErrorResponseDto,
})
export class ChurchController {
  constructor(private readonly churchService: ChurchService) {}

  @Get(':churchId')
  @ApiOperation({ summary: 'Get a church by ID' })
  @ApiOkResponse({ type: ChurchDto })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({ description: 'Malformed UUID', type: ErrorResponseDto })
  findOne(@Param('churchId', ParseUUIDPipe) churchId: string) {
    return this.churchService.findById(churchId);
  }

  @Patch(':churchId')
  @StaffRoles('super_admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Update a church' })
  @ApiOkResponse({ type: ChurchDto })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed or malformed UUID',
    type: ErrorResponseDto,
  })
  update(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Body(new ZodValidationPipe(UpdateChurchDto.schema)) body: UpdateChurchDto,
  ) {
    return this.churchService.update(churchId, body);
  }
}
