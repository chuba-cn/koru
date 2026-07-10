import { koboToNaira } from '@koru/shared';
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'koru-api',
      sharedCheck: koboToNaira(100_000),
      timestamp: new Date().toISOString(),
    };
  }
}
