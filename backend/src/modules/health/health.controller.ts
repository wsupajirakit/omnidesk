import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '@/common';

import { HealthService, type HealthReport } from './health.service';

/**
 * Liveness and readiness probes.
 *
 * Public by design — the platform's health checker has no credentials. The
 * responses carry no configuration values, only up/down status, so exposing
 * them reveals nothing about the deployment.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness: the process is running. Never touches dependencies. */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  live(): { status: 'ok'; service: string } {
    return { status: 'ok', service: 'omnidesk-api' };
  }

  /** Readiness: dependencies are reachable, so traffic can be routed here. */
  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — checks Mongo and Redis' })
  async ready(): Promise<HealthReport> {
    return this.health.check();
  }
}
