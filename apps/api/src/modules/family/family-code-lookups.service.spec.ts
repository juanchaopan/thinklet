import { HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@thinklet/contracts';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import type { RateLimiter } from '../../infrastructure/rate-limit/rate-limiter.js';
import { FamilyCodeLookups } from './family-code-lookups.service.js';
import type { JoinRequestsService } from './join-requests.service.js';

const CLIENT_IP = '203.0.113.7';
const PARENT_ID = '0b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d';
const FOUND = { familyName: '林悦的家', adminName: '林悦', adminId: PARENT_ID };

describe('FamilyCodeLookups', () => {
  const joinRequests = { lookUp: vi.fn(() => Promise.resolve(FOUND)) };
  /** A limiter that makes every attempt, recording what it was asked to count. */
  const limiter = {
    attempt: vi.fn((...[, , attempt]: Parameters<RateLimiter['attempt']>) => attempt()),
  };
  const lookups = new FamilyCodeLookups(
    joinRequests as unknown as JoinRequestsService,
    limiter as unknown as RateLimiter,
  );

  beforeEach(() => {
    joinRequests.lookUp.mockClear();
    limiter.attempt.mockClear();
  });

  it('looks the code up within 30 misses an hour per source', async () => {
    await expect(lookups.lookUp(PARENT_ID, '7KQ4MW', CLIENT_IP)).resolves.toEqual(FOUND);

    expect(joinRequests.lookUp).toHaveBeenCalledWith(PARENT_ID, '7KQ4MW');
    expect(limiter.attempt).toHaveBeenCalledWith(
      CLIENT_IP,
      [{ name: 'family-code', limit: 30, windowSeconds: 3600 }],
      expect.any(Function),
      expect.any(Function),
    );
  });

  it.each<[ErrorCode, boolean]>([
    ['code_not_found', true],
    ['already_member', false],
    ['request_pending', false],
  ])('counts %s as a miss: %s', async (code, counted) => {
    await lookups.lookUp(PARENT_ID, '7KQ4MW', CLIENT_IP);
    const isMiss = limiter.attempt.mock.calls[0]?.[3];

    expect(isMiss?.(new ApiError(code, HttpStatus.NOT_FOUND))).toBe(counted);
  });
});
