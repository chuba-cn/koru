import { koboToNaira } from '@koru/shared';
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
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
    const [churches, campaigns, pledges, payments] = await Promise.all([
      this.prisma.church.count(),
      this.prisma.campaign.count(),
      this.prisma.pledge.count(),
      this.prisma.payment.count(),
    ]);

    return {
      status: 'ok',
      db: 'reachable',
      churches,
      campaigns,
      pledges,
      payments,
    };
  }
}
