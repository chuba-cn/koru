import { koboToNaira } from '@koru/shared';
import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'koru-api',
      sharedCheck: koboToNaira(100_000),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('db')
  async checkDb() {
    const [churches, campaigns] = await Promise.all([
      this.prisma.church.count(),
      this.prisma.campaign.count(),
    ]);

    return {
      status: 'ok',
      db: 'reachable',
      churches,
      campaigns,
    };
  }
}
