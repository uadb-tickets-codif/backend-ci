import { Controller, Get } from '@nestjs/common';
import { HealthCheck } from '@nestjs/terminus';
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @HealthCheck()
  @Get()
  @ApiOkResponse({
    description: 'API et base de données disponibles',
    schema: {
      example: {
        status: 'ok',
        info: { database: { status: 'up' } },
        error: {},
        details: { database: { status: 'up' } },
      },
    },
  })
  @ApiServiceUnavailableResponse({
    description: 'Base de données PostgreSQL indisponible',
  })
  check() {
    return this.healthService.check();
  }
}
