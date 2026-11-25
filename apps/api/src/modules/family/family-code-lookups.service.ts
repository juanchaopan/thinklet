import { Injectable } from '@nestjs/common';
import type { FamilyCodeLookupResponse } from '@thinklet/contracts';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import { RateLimiter, type RateCounter } from '../../infrastructure/rate-limit/rate-limiter.js';
import { JoinRequestsService } from './join-requests.service.js';

/**
 * How many family codes a source may look up and not find in an hour from
 * its first miss (rules.md, 限流).
 */
export const FAMILY_CODE_MISSES: RateCounter = {
  name: 'family-code',
  limit: 30,
  windowSeconds: 60 * 60,
};

function isMiss(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'code_not_found';
}

/**
 * Looking up a family code before applying, limited per source so codes
 * cannot be tried one after another: only a code no family has counts, and
 * a source at its limit is refused before the code is looked up. A code
 * found, or one the parent cannot apply to, counts nothing.
 */
@Injectable()
export class FamilyCodeLookups {
  constructor(
    private readonly joinRequests: JoinRequestsService,
    private readonly limiter: RateLimiter,
  ) {}

  /** The family of the code for the parent, as JoinRequestsService answers it, within the limit. */
  lookUp(
    parentId: string,
    code: string,
    clientIp: string | undefined,
  ): Promise<FamilyCodeLookupResponse> {
    return this.limiter.attempt(
      clientIp,
      [FAMILY_CODE_MISSES],
      () => this.joinRequests.lookUp(parentId, code),
      isMiss,
    );
  }
}
