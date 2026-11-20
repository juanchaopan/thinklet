import { Injectable, Logger } from '@nestjs/common';
import type { CheckStatus, HealthCheckName, HealthResponse } from '@thinklet/contracts';
import { describeError } from '../../infrastructure/logging/describe-error.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import { HealthRepository } from './health.repository.js';

/** How long one check may take before it counts as failed; long enough for Neon to wake up. */
export const CHECK_TIMEOUT_MS = 5_000;

class CheckTimeoutError extends Error {
  override readonly name = 'CheckTimeoutError';

  constructor() {
    super(`No answer within ${CHECK_TIMEOUT_MS} ms`);
  }
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly repository: HealthRepository,
    private readonly storage: StorageService,
  ) {}

  /** Runs every check in parallel; the overall status is ok only when all of them are. */
  async check(): Promise<HealthResponse> {
    const [database, storage] = await Promise.all([
      this.runCheck('database', () => this.repository.ping()),
      this.runCheck('storage', (signal) => this.storage.checkBucket(signal)),
    ]);
    const status = database === 'ok' && storage === 'ok' ? 'ok' : 'error';
    return { status, checks: { database, storage } };
  }

  private async runCheck(
    name: HealthCheckName,
    probe: (signal: AbortSignal) => Promise<void>,
  ): Promise<CheckStatus> {
    const abort = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new CheckTimeoutError();
        abort.abort(error);
        reject(error);
      }, CHECK_TIMEOUT_MS);
    });

    try {
      await Promise.race([probe(abort.signal), timeout]);
      return 'ok';
    } catch (error) {
      this.logger.warn({ check: name, error: describeError(error) }, 'Health check failed');
      return 'error';
    } finally {
      clearTimeout(timer);
    }
  }
}
