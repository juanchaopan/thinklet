import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { childMeResponseSchema } from './child.js';
import {
  childLinkLoginRequestSchema,
  childLoginAnswerSchema,
  childLoginLinkInfoSchema,
  childLoginRequestSchema,
  childLoginResponseSchema,
  childNeedsPasswordSchema,
  rememberedChildListSchema,
  setChildPasswordRequestSchema,
  setChildPasswordWithAccountRequestSchema,
} from './child-auth.js';
import { toFieldErrors } from './errors.js';

const childId = '3f9b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

/** The field errors a body is rejected with; empty when it is accepted. */
function rejectedFields(schema: z.ZodType, body: unknown) {
  const result = schema.safeParse(body);
  return result.success ? [] : toFieldErrors(result.error);
}

describe('childLoginRequestSchema', () => {
  const withoutPassword = { code: '7KQ4MZ', account: 'xiaomi', remember: false };
  const login = { ...withoutPassword, password: 'secret 1' };

  it('accepts the family code, the account, the password and whether to remember', () => {
    expect(childLoginRequestSchema.parse(login)).toEqual(login);
  });

  it('turns the family code into capitals, as the family code lookup does', () => {
    expect(childLoginRequestSchema.parse({ ...login, code: '7kq4mz' }).code).toBe('7KQ4MZ');
  });

  it('takes a login without a password, as a child who has none yet sends it', () => {
    expect(childLoginRequestSchema.parse(withoutPassword)).toEqual(withoutPassword);
  });

  it('keeps a password as typed and checks only that one sent is not empty', () => {
    expect(childLoginRequestSchema.parse({ ...login, password: ' abc ' }).password).toBe(' abc ');
    expect(rejectedFields(childLoginRequestSchema, { ...login, password: '' })).toEqual([
      { path: 'password', code: 'required' },
    ]);
  });

  it('names every field that is missing or wrong', () => {
    expect(rejectedFields(childLoginRequestSchema, {})).toEqual([
      { path: 'code', code: 'required' },
      { path: 'account', code: 'required' },
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

describe('childLoginAnswerSchema', () => {
  const signedIn = { id: childId, nickname: '豆豆' };
  const needsPassword = { needsPassword: true, id: childId, nickname: '豆豆' };

  it('is the child signed in, or the child who has to set a password first', () => {
    expect(childLoginAnswerSchema.parse(signedIn)).toEqual(signedIn);
    expect(childLoginAnswerSchema.parse(needsPassword)).toEqual(needsPassword);
    expect(childNeedsPasswordSchema.safeParse(signedIn).success).toBe(false);
  });

  it('takes needsPassword only as true', () => {
    expect(
      childLoginAnswerSchema.safeParse({ ...needsPassword, needsPassword: false }).success,
    ).toBe(false);
  });
});

describe('setChildPasswordWithAccountRequestSchema', () => {
  const body = { code: '7kq4mz', account: 'doudou', password: 'dd 2019', remember: true };

  it('accepts the family code in capitals, the account, a new password and whether to remember', () => {
    expect(setChildPasswordWithAccountRequestSchema.parse(body)).toEqual({
      ...body,
      code: '7KQ4MZ',
    });
  });

  it('checks the password as a new one: 6 to 32 characters', () => {
    expect(
      rejectedFields(setChildPasswordWithAccountRequestSchema, { ...body, password: 'abcde' }),
    ).toEqual([{ path: 'password', code: 'too_short' }]);
    expect(
      rejectedFields(setChildPasswordWithAccountRequestSchema, {
        ...body,
        password: 'a'.repeat(33),
      }),
    ).toEqual([{ path: 'password', code: 'too_long' }]);
  });

  it('names every field that is missing', () => {
    expect(rejectedFields(setChildPasswordWithAccountRequestSchema, {})).toEqual([
      { path: 'code', code: 'required' },
      { path: 'account', code: 'required' },
      { path: 'password', code: 'required' },
      { path: 'remember', code: 'required' },
    ]);
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
