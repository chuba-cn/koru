import { koboToNaira } from '@koru/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@AllowAnonymous()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('email') private readonly emailQueue: Queue,
  ) {}

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

  @Get('redis')
  async checkRedis() {
    try {
      const client = await this.emailQueue.client;
      await client.info();
      return {
        status: 'ok',
        redis: 'reachable',
      };
    } catch {
      return {
        status: 'error',
        redis: 'unreachable',
      };
    }
  }
}
