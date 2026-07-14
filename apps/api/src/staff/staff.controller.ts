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
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/api.dto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CreateStaffDto, ReplaceScopesDto, StaffDto, UpdateStaffDto } from './staff.dto';
import { StaffService } from './staff.service';

@ApiTags('staff')
@Controller('churches/:churchId/staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post()
  @ApiOperation({ summary: 'Register a staff member' })
  @ApiCreatedResponse({ type: StaffDto })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'Email already used in this church', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed, malformed UUID, or scope not in this church',
    type: ErrorResponseDto,
  })
  create(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Body(new ZodValidationPipe(CreateStaffDto.schema)) body: CreateStaffDto,
  ) {
    return this.staffService.create(churchId, body);
  }

  @Get()
  @ApiOperation({ summary: 'List staff of a church, including their scopes' })
  @ApiOkResponse({ type: StaffDto, isArray: true })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  list(@Param('churchId', ParseUUIDPipe) churchId: string) {
    return this.staffService.list(churchId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a staff member (name/role; email is immutable)' })
  @ApiOkResponse({ type: StaffDto })
  @ApiNotFoundResponse({ description: 'Church or staff not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed or malformed UUID',
    type: ErrorResponseDto,
  })
  update(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateStaffDto.schema)) body: UpdateStaffDto,
  ) {
    return this.staffService.update(churchId, id, body);
  }

  @Put(':id/scopes')
  @ApiOperation({ summary: 'Replace ALL scopes of a staff member (send [] to clear)' })
  @ApiOkResponse({ type: StaffDto })
  @ApiNotFoundResponse({ description: 'Church or staff not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed, malformed UUID, or scope not in this church',
    type: ErrorResponseDto,
  })
  replaceScopes(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ReplaceScopesDto.schema)) body: ReplaceScopesDto,
  ) {
    return this.staffService.replaceScopes(churchId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a staff member (their scopes go with them)' })
  @ApiNoContentResponse({ description: 'Staff deleted' })
  @ApiNotFoundResponse({ description: 'Church or staff not found', type: ErrorResponseDto })
  remove(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.staffService.remove(churchId, id);
  }
}
