import { Controller, Get, Header, HttpStatus, Res } from '@nestjs/common';
import { healthResponseSchema, type HealthResponse } from '@thinklet/contracts';
import type { Response } from 'express';
import { Public } from '../../infrastructure/authentication/public.decorator.js';
import { HealthService } from './health.service.js';

/** The health check needs no login: the smoke tests and the platform call it. */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** 200 when every check is ok, 503 otherwise; the body names only which check failed. */
  @Get()
  @Header('Cache-Control', 'no-store')
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthResponse> {
    const result = healthResponseSchema.parse(await this.healthService.check());
    response.status(result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
