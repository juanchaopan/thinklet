import { describe, expect, it } from 'vitest';
import { childMeResponseSchema, signedInChildSchema, updateChildMeRequestSchema } from './child.js';
import { toFieldErrors } from './errors.js';

/** What a request to change the nickname is refused for, by field; empty when it is taken. */
function refusalsOf(body: unknown) {
  const parsed = updateChildMeRequestSchema.safeParse(body);
  return parsed.error === undefined ? [] : toFieldErrors(parsed.error);
}

describe('childMeResponseSchema', () => {
  const xiaomi = {
    id: '3f9b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    nickname: '小米',
    account: 'xiaomi',
    familyName: '林悦的家',
  };

  it('is the signed-in child with the account and the family’s name', () => {
    expect(childMeResponseSchema.parse(xiaomi)).toEqual(xiaomi);
  });

  it('needs the account and the family’s name, which a login answer leaves out', () => {
    const { id, nickname } = xiaomi;

    expect(childMeResponseSchema.safeParse({ id, nickname }).success).toBe(false);
    expect(signedInChildSchema.safeParse(xiaomi).success).toBe(false);
  });
});

describe('updateChildMeRequestSchema', () => {
  it('trims the new nickname', () => {
    expect(updateChildMeRequestSchema.parse({ nickname: ' 米米 ' })).toEqual({ nickname: '米米' });
  });

  it('takes 10 characters of any kind, an emoji counting once', () => {
    expect(refusalsOf({ nickname: `小米🦊${'米'.repeat(7)}` })).toEqual([]);
  });

  it('refuses a nickname that is missing, empty or blank as required', () => {
    for (const body of [{}, { nickname: '' }, { nickname: '   ' }]) {
      expect(refusalsOf(body)).toEqual([{ path: 'nickname', code: 'required' }]);
    }
  });

  it('refuses 11 characters, and 160 bytes passed in fewer, as too long', () => {
    const combining = `a${'́'.repeat(80)}`;

    for (const nickname of ['米'.repeat(11), combining]) {
      expect(refusalsOf({ nickname })).toEqual([{ path: 'nickname', code: 'too_long' }]);
    }
  });

  it('takes only the nickname: the child changes neither the account nor anything else', () => {
    expect(refusalsOf({ nickname: '米米', account: 'mimi' })).not.toEqual([]);
  });
});
