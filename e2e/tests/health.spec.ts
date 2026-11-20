import { expect, test } from '@playwright/test';
import { healthResponseSchema } from '@thinklet/contracts';

test(
  'GET /api/health through the web origin returns 200 with every check ok',
  { tag: ['@smoke', '@production-safe'] },
  async ({ request }) => {
    const response = await request.get('/api/health');

    expect(response.status()).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({
      status: 'ok',
      checks: { database: 'ok', storage: 'ok' },
    });
  },
);
