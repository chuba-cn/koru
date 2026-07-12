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
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CreateRegionDto, RegionDto, UpdateRegionDto } from './region.dto';
import { RegionService } from './region.service';

@ApiTags('regions')
@Controller('churches/:churchId/regions')
export class RegionController {
  constructor(private readonly regionService: RegionService) {}

  @Post()
  @ApiOperation({ summary: 'Create a region in a church' })
  @ApiCreatedResponse({ type: RegionDto })
  @ApiNotFoundResponse({ description: 'Church not found' })
  @ApiConflictResponse({ description: 'Region name already exists in this church' })
  @ApiBadRequestResponse({ description: 'Validation failed or malformed UUID' })
  create(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Body(new ZodValidationPipe(CreateRegionDto.schema)) body: CreateRegionDto,
  ) {
    return this.regionService.create(churchId, body);
  }

  @Get()
  @ApiOperation({ summary: 'List regions of a church' })
  @ApiOkResponse({ type: RegionDto, isArray: true })
  @ApiNotFoundResponse({ description: 'Church not found' })
  list(@Param('churchId', ParseUUIDPipe) churchId: string) {
    return this.regionService.list(churchId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename/update a region' })
  @ApiOkResponse({ type: RegionDto })
  @ApiNotFoundResponse({ description: 'Church or region not found' })
  @ApiConflictResponse({ description: 'Region name already exists in this church' })
  @ApiBadRequestResponse({ description: 'Validation failed or malformed UUID' })
  update(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateRegionDto.schema)) body: UpdateRegionDto,
  ) {
    return this.regionService.update(churchId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an empty region' })
  @ApiNoContentResponse({ description: 'Region deleted' })
  @ApiNotFoundResponse({ description: 'Church or region not found' })
  @ApiConflictResponse({ description: 'Region still has branches' })
  remove(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.regionService.remove(churchId, id);
  }
}
