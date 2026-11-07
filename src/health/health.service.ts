import { Inject, Injectable } from '@nestjs/common';
import { HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly healthCheck: HealthCheckService,
    private readonly healthIndicator: HealthIndicatorService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  check() {
    return this.healthCheck.check([
      () =>
        this.healthIndicator
          .check('database')
          .attempt(() => this.prisma.$queryRaw`SELECT 1`)
          .withTimeout(1000),
    ]);
  }
}
