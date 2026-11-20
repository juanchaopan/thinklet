import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { API_SECURITY_HEADERS } from '../../src/infrastructure/security-headers/security-headers.middleware.js';
import { startAppWithoutServices } from '../support/app.js';

// The values themselves are checked against the design by the middleware's
// unit test; this one checks that the application sends them on every kind
// of /api response, whatever part of the application answers it.
const EXPECTED_HEADERS = Object.fromEntries(
  Object.entries(API_SECURITY_HEADERS).map(([name, value]) => [name.toLowerCase(), value]),
);

/** The security headers of a response, each name present even when missing from it. */
function securityHeaders(response: request.Response): Record<string, unknown> {
  const headers = response.headers as Record<string, unknown>;
  return Object.fromEntries(Object.keys(EXPECTED_HEADERS).map((name) => [name, headers[name]]));
}

describe('security response headers', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await startAppWithoutServices());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('are on the 503 of GET /api/health', async () => {
    const response = await request(app.getHttpServer()).get('/api/health');

    expect(response.status).toBe(503);
    expect(securityHeaders(response)).toEqual(EXPECTED_HEADERS);
  });

  it('are on the 404 of an unknown /api path', async () => {
    const response = await request(app.getHttpServer()).get('/api/unknown');

    expect(response.status).toBe(404);
    expect(securityHeaders(response)).toEqual(EXPECTED_HEADERS);
  });

  it('are on the 400 of a body the api cannot parse', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{');

    expect(response.status).toBe(400);
    expect(securityHeaders(response)).toEqual(EXPECTED_HEADERS);
  });
});
