import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { startAppWithoutServices } from '../support/app.js';

// Words and fragments that only appear when an error leaks into a response.
const LEAK_MARKERS = [
  /stack/i,
  /\bat\s+\S+\s+\(/,
  /\.(ts|js):\d+/,
  /node_modules/,
  /ECONNREFUSED/,
  /127\.0\.0\.1/,
];

describe('HTTP responses', () => {
  let app: NestExpressApplication;
  let closedPort: number;

  beforeAll(async () => {
    ({ app, closedPort } = await startAppWithoutServices());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 503 without error details when the checks fail', async () => {
    const response = await request(app.getHttpServer()).get('/api/health');

    expect(response.status).toBe(503);
    expect(response.body).toStrictEqual({
      status: 'error',
      checks: { database: 'error', storage: 'error' },
    });
    for (const marker of LEAK_MARKERS) {
      expect(response.text).not.toMatch(marker);
    }
    expect(response.text).not.toContain(String(closedPort));
  });

  it.each(['/api/unknown', '/unknown', '/api/health/../../etc/passwd'])(
    'returns 404 without a stack trace for %s',
    async (path) => {
      const response = await request(app.getHttpServer()).get(path);

      expect(response.status).toBe(404);
      for (const marker of LEAK_MARKERS) {
        expect(response.text).not.toMatch(marker);
      }
    },
  );

  it.each(['/api/health', '/api/unknown'])('sends no X-Powered-By header for %s', async (path) => {
    const response = await request(app.getHttpServer()).get(path);

    expect(response.headers).not.toHaveProperty('x-powered-by');
  });
});
