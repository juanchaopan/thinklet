import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  addChildRequestSchema,
  childDeviceListSchema,
  childListSchema,
  childLoginLinkSchema,
  childLoginLinkStatusResponseSchema,
  updateChildRequestSchema,
} from './children.js';
import { toFieldErrors } from './errors.js';

const childId = '3f9b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const deviceId = 'a07c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d';

/** The field errors a body is rejected with; empty when it is accepted. */
function fieldErrorsOf(schema: z.ZodType, body: unknown) {
  const result = schema.safeParse(body);
  return result.success ? [] : toFieldErrors(result.error);
}

describe('addChildRequestSchema', () => {
  it('trims the nickname and the account and keeps the consent', () => {
    expect(
      addChildRequestSchema.parse({ nickname: ' 小米 ', account: ' xiaomi ', consent: true }),
    ).toEqual({ nickname: '小米', account: 'xiaomi', consent: true });
  });

  it('rejects a consent that is false or missing as required', () => {
    for (const consent of [false, undefined, 'true', 1, null]) {
      expect(
        fieldErrorsOf(addChildRequestSchema, { nickname: '小米', account: 'xiaomi', consent }),
        String(consent),
      ).toEqual([{ path: 'consent', code: 'required' }]);
    }
  });

  it('names every field that is wrong', () => {
    expect(
      fieldErrorsOf(addChildRequestSchema, { nickname: '米'.repeat(11), account: 'XiaoMi' }),
    ).toEqual([
      { path: 'nickname', code: 'too_long' },
      { path: 'account', code: 'invalid' },
      { path: 'consent', code: 'required' },
    ]);
    expect(fieldErrorsOf(addChildRequestSchema, { consent: true })).toEqual([
      { path: 'nickname', code: 'required' },
      { path: 'account', code: 'required' },
    ]);
  });

  it('rejects other keys, such as a password', () => {
    const body = { nickname: '小米', account: 'xiaomi', consent: true, password: 'secret1' };

    expect(addChildRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('updateChildRequestSchema', () => {
  it('accepts either field alone, checked as when adding', () => {
    expect(updateChildRequestSchema.parse({ nickname: '米粒 ' })).toEqual({ nickname: '米粒' });
    expect(updateChildRequestSchema.parse({ account: 'mili' })).toEqual({ account: 'mili' });
    expect(updateChildRequestSchema.parse({})).toEqual({});
    expect(fieldErrorsOf(updateChildRequestSchema, { account: 'a'.repeat(21) })).toEqual([
      { path: 'account', code: 'too_long' },
    ]);
    expect(fieldErrorsOf(updateChildRequestSchema, { nickname: ' ' })).toEqual([
      { path: 'nickname', code: 'required' },
    ]);
  });

  it('takes no consent', () => {
    expect(updateChildRequestSchema.safeParse({ consent: true }).success).toBe(false);
  });
});

describe('childListSchema', () => {
  it('accepts children with their nickname and account', () => {
    const body = [{ id: childId, nickname: '小米', account: 'xiaomi' }];

    expect(childListSchema.parse(body)).toEqual(body);
    expect(childListSchema.safeParse([{ id: childId, nickname: '小米' }]).success).toBe(false);
  });
});

describe('childLoginLinkSchema', () => {
  it('accepts the link id, its address and when it expires', () => {
    const body = {
      id: '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a',
      url: 'https://site.example/child/qr/abc',
      expiresAt: '2026-11-22T08:40:00Z',
    };

    expect(childLoginLinkSchema.parse(body)).toEqual(body);
    expect(childLoginLinkSchema.safeParse({ ...body, token: 'abc' }).success).toBe(false);
  });
});

describe('childLoginLinkStatusResponseSchema', () => {
  it('accepts the four states of a link', () => {
    for (const status of ['active', 'used', 'expired', 'revoked']) {
      const body = { status, expiresAt: '2026-11-22T08:40:00Z' };

      expect(childLoginLinkStatusResponseSchema.parse(body), status).toEqual(body);
    }
    expect(
      childLoginLinkStatusResponseSchema.safeParse({
        status: 'pending',
        expiresAt: '2026-11-22T08:40:00Z',
      }).success,
    ).toBe(false);
  });
});

describe('childDeviceListSchema', () => {
  it('accepts devices with their name and times', () => {
    const body = [
      {
        id: deviceId,
        name: 'iPad · Safari',
        rememberedAt: '2026-11-18T08:30:00Z',
        lastUsedAt: '2026-11-22T01:12:00Z',
      },
    ];

    expect(childDeviceListSchema.parse(body)).toEqual(body);
    expect(childDeviceListSchema.safeParse([{ ...body[0], lastUsedAt: 'yesterday' }]).success).toBe(
      false,
    );
  });
});
