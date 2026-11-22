import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { childMeResponseSchema } from './child.js';
import {
  childLinkLoginRequestSchema,
  childLoginLinkInfoSchema,
  childLoginRequestSchema,
  childLoginResponseSchema,
  rememberedChildListSchema,
  setChildPasswordRequestSchema,
} from './child-auth.js';
import { toFieldErrors } from './errors.js';

const childId = '3f9b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

/** The field errors a body is rejected with; empty when it is accepted. */
function rejectedFields(schema: z.ZodType, body: unknown) {
  const result = schema.safeParse(body);
  return result.success ? [] : toFieldErrors(result.error);
}

describe('childLoginRequestSchema', () => {
  const login = { code: '7KQ4MZ', account: 'xiaomi', password: 'secret 1', remember: false };

  it('accepts the family code, the account, the password and whether to remember', () => {
    expect(childLoginRequestSchema.parse(login)).toEqual(login);
  });

  it('turns the family code into capitals, as the family code lookup does', () => {
    expect(childLoginRequestSchema.parse({ ...login, code: '7kq4mz' }).code).toBe('7KQ4MZ');
  });

  it('keeps the password as typed and checks only that it is there', () => {
    expect(childLoginRequestSchema.parse({ ...login, password: ' abc ' }).password).toBe(' abc ');
    expect(rejectedFields(childLoginRequestSchema, { ...login, password: '' })).toEqual([
      { path: 'password', code: 'required' },
    ]);
  });

  it('names every field that is missing or wrong', () => {
    expect(rejectedFields(childLoginRequestSchema, {})).toEqual([
      { path: 'code', code: 'required' },
      { path: 'account', code: 'required' },
      { path: 'password', code: 'required' },
      { path: 'remember', code: 'required' },
    ]);
    expect(
      rejectedFields(childLoginRequestSchema, { ...login, code: '7KQ4M', account: 'XiaoMi' }),
    ).toEqual([
      { path: 'code', code: 'invalid' },
      { path: 'account', code: 'invalid' },
    ]);
  });
});

describe('childLoginResponseSchema', () => {
  it('is the signed-in child, as GET /api/child/me answers', () => {
    const body = { id: childId, nickname: '小米' };

    expect(childLoginResponseSchema.parse(body)).toEqual(body);
    expect(childMeResponseSchema.parse(body)).toEqual(body);
    expect(childMeResponseSchema.safeParse({ ...body, account: 'xiaomi' }).success).toBe(false);
  });
});

describe('rememberedChildListSchema', () => {
  it('accepts the remembered children with what fills in the login form', () => {
    const body = [{ childId, nickname: '小米', familyCode: '7KQ4MZ', account: 'xiaomi' }];

    expect(rememberedChildListSchema.parse(body)).toEqual(body);
    expect(rememberedChildListSchema.parse([])).toEqual([]);
  });
});

describe('childLoginLinkInfoSchema', () => {
  it('says whose link it is and whether a password is still to be set', () => {
    const body = { childId, nickname: '小米', needsPassword: true };

    expect(childLoginLinkInfoSchema.parse(body)).toEqual(body);
    expect(childLoginLinkInfoSchema.safeParse({ childId, nickname: '小米' }).success).toBe(false);
  });
});

describe('setChildPasswordRequestSchema', () => {
  it('accepts 6 and 32 characters', () => {
    for (const password of ['abcdef', 'a'.repeat(32)]) {
      expect(rejectedFields(setChildPasswordRequestSchema, { password, remember: true })).toEqual(
        [],
      );
    }
  });

  it('rejects 5 characters as too short and 33 as too long', () => {
    expect(
      rejectedFields(setChildPasswordRequestSchema, { password: 'abcde', remember: true }),
    ).toEqual([{ path: 'password', code: 'too_short' }]);
    expect(
      rejectedFields(setChildPasswordRequestSchema, { password: 'a'.repeat(33), remember: true }),
    ).toEqual([{ path: 'password', code: 'too_long' }]);
  });

  it('requires the password and whether to remember', () => {
    expect(rejectedFields(setChildPasswordRequestSchema, { password: '' })).toEqual([
      { path: 'password', code: 'required' },
      { path: 'remember', code: 'required' },
    ]);
  });
});

describe('childLinkLoginRequestSchema', () => {
  it('accepts any password that is there, so a wrong length is a wrong password', () => {
    for (const password of ['abcde', 'a'.repeat(33)]) {
      expect(rejectedFields(childLinkLoginRequestSchema, { password, remember: false })).toEqual(
        [],
      );
    }
    expect(rejectedFields(childLinkLoginRequestSchema, { password: '', remember: false })).toEqual([
      { path: 'password', code: 'required' },
    ]);
  });

  it('rejects other keys', () => {
    const body = { password: 'abcdef', remember: true, account: 'xiaomi' };

    expect(childLinkLoginRequestSchema.safeParse(body).success).toBe(false);
  });
});
