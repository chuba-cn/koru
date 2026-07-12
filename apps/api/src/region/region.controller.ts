import {
  type CreateRegionInput,
  CreateRegionSchema,
  type UpdateRegionInput,
  UpdateRegionSchema,
} from '@koru/shared';
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
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RegionService } from './region.service';

@Controller('churches/:churchId/regions')
export class RegionController {
  constructor(private readonly regionService: RegionService) {}

  @Post()
  create(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Body(new ZodValidationPipe(CreateRegionSchema)) body: CreateRegionInput,
  ) {
    return this.regionService.create(churchId, body);
  }

  @Get()
  list(@Param('churchId', ParseUUIDPipe) churchId: string) {
    return this.regionService.list(churchId);
  }

  @Patch(':id')
  update(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateRegionSchema)) body: UpdateRegionInput,
  ) {
    return this.regionService.update(churchId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.regionService.remove(churchId, id);
  }
}
