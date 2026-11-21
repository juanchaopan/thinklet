import type { NestExpressApplication } from '@nestjs/platform-express';
import { meResponseSchema } from '@thinklet/contracts';
import request from 'supertest';
import { startAppWithServices, type AppWithServices } from '../support/app.js';
import { TEST_APP_ORIGIN } from '../support/containers.js';
import { cookieHeader, newUser, signIn } from '../support/login.js';

// Acceptance criteria covered: a parent changes their own name on the
// profile page; the name is 1 to 20 characters after trimming, with
// "请填名字" and "名字最多 20 个字" shown from the field codes.
describe('PATCH /api/me', () => {
  let started: AppWithServices;
  let app: NestExpressApplication;
  let cookies: Record<string, string>;

  const patch = (body: object) =>
    request(app.getHttpServer())
      .patch('/api/me')
      .set('Origin', TEST_APP_ORIGIN)
      .set('Cookie', cookieHeader(cookies))
      .send(body);

  beforeAll(async () => {
    started = await startAppWithServices();
    ({ app } = started);
    ({ cookies } = await signIn(
      app.getHttpServer(),
      newUser({ name: '林悦', email: 'linyue@example.com' }),
    ));
  });

  afterAll(async () => {
    await started?.stop();
  });

  it('changes the name, trimmed, and returns the parent', async () => {
    const response = await patch({ name: '  悦悦  ' });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(meResponseSchema.parse(response.body)).toMatchObject({
      name: '悦悦',
      email: 'linyue@example.com',
      families: [],
    });
    const me = await request(app.getHttpServer())
      .get('/api/me')
      .set('Cookie', cookieHeader(cookies));
    expect(me.body).toMatchObject({ name: '悦悦' });
  });

  it('accepts 20 characters of any kind, an emoji counting as one', async () => {
    const name = `林悦${'👨‍👩‍👧'.repeat(18)}`;

    const response = await patch({ name });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ name });
  });

  it.each([
    ['an empty name', { name: '' }, 'required'],
    ['a name of spaces only', { name: '   ' }, 'required'],
    ['a missing name', {}, 'required'],
    ['21 characters', { name: '一二三四五六七八九十一二三四五六七八九十多' }, 'too_long'],
    ['a name that is not text', { name: 42 }, 'invalid'],
  ])('refuses %s with 400 and the field code', async (_name, body, code) => {
    const response = await patch(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: 'invalid_request',
        requestId: response.headers['x-request-id'],
        fields: [{ path: 'name', code }],
      },
    });
  });

  it('refuses fields other than the name', async () => {
    const response = await patch({ name: '林悦', email: 'other@example.com' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { fields: [{ path: '', code: 'invalid' }] } });
  });

  it('is refused without a login', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/me')
      .set('Origin', TEST_APP_ORIGIN)
      .send({ name: '林悦' });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: 'unauthenticated' } });
  });
});
