import { clientIpResponseSchema } from '@thinklet/contracts';
import request from 'supertest';
import { useAppWithServices } from '../support/families.js';

// The temporary GET /api/client-ip (.docs/design/interfaces.md): it shows
// the requester the candidate client IP headers of its own request, with no
// login, so the header the proxy in staging writes can be checked.
describe('GET /api/client-ip', () => {
  const running = useAppWithServices();

  it('echoes the candidate headers the request carries, without a login and uncached', async () => {
    const response = await request(running.server)
      .get('/api/client-ip')
      .set('X-Real-IP', '203.0.113.7')
      .set('X-Forwarded-For', '198.51.100.20, 203.0.113.7')
      .set('X-Vercel-Forwarded-For', '203.0.113.7');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(clientIpResponseSchema.parse(response.body)).toEqual({
      'x-real-ip': '203.0.113.7',
      'x-forwarded-for': '198.51.100.20, 203.0.113.7',
      'x-vercel-forwarded-for': '203.0.113.7',
    });
  });

  it('answers null for each header the request does not carry, and echoes no other header', async () => {
    const response = await request(running.server)
      .get('/api/client-ip')
      .set('X-Client-IP', '203.0.113.7');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      'x-real-ip': null,
      'x-forwarded-for': null,
      'x-vercel-forwarded-for': null,
    });
  });
});
