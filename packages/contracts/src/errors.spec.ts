import { describe, expect, it } from 'vitest';
import { setChildPasswordRequestSchema } from './child-auth.js';
import { errorCodeSchema, errorResponseSchema, toFieldErrors } from './errors.js';
import { createFamilyRequestSchema } from './families.js';
import { updateMeRequestSchema } from './me.js';

/** The field errors a request body is rejected with. */
function fieldErrorsOf(
  schema:
    | typeof updateMeRequestSchema
    | typeof createFamilyRequestSchema
    | typeof setChildPasswordRequestSchema,
  body: unknown,
) {
  const result = schema.safeParse(body);
  if (result.success) {
    throw new Error('Expected the body to be rejected');
  }
  return toFieldErrors(result.error);
}

describe('toFieldErrors', () => {
  it('names the rejected field and why', () => {
    expect(fieldErrorsOf(updateMeRequestSchema, { name: '家'.repeat(21) })).toEqual([
      { path: 'name', code: 'too_long' },
    ]);
    expect(fieldErrorsOf(updateMeRequestSchema, { name: '   ' })).toEqual([
      { path: 'name', code: 'required' },
    ]);
    expect(fieldErrorsOf(updateMeRequestSchema, {})).toEqual([{ path: 'name', code: 'required' }]);
    expect(fieldErrorsOf(updateMeRequestSchema, { name: 7 })).toEqual([
      { path: 'name', code: 'invalid' },
    ]);
  });

  it('reports a value that is too short', () => {
    expect(
      fieldErrorsOf(setChildPasswordRequestSchema, { password: '12345', remember: true }),
    ).toEqual([{ path: 'password', code: 'too_short' }]);
  });

  it('lists every rejected field', () => {
    expect(fieldErrorsOf(createFamilyRequestSchema, { name: '', timezone: 'Mars/Phobos' })).toEqual(
      [
        { path: 'name', code: 'required' },
        { path: 'timezone', code: 'invalid' },
      ],
    );
  });

  it('reports unknown keys and bodies that are not objects as invalid at the root', () => {
    expect(fieldErrorsOf(updateMeRequestSchema, { name: '林悦', email: 'a@example.com' })).toEqual([
      { path: '', code: 'invalid' },
    ]);
    expect(fieldErrorsOf(updateMeRequestSchema, 'name')).toEqual([{ path: '', code: 'invalid' }]);
  });
});

describe('errorCodeSchema', () => {
  it('has the codes of child accounts and child login', () => {
    for (const code of [
      'account_taken',
      'child_not_found',
      'login_failed',
      'remember_invalid',
      'link_invalid',
      'wrong_password',
      'password_already_set',
      'password_not_set',
    ]) {
      expect(errorCodeSchema.safeParse(code).success, code).toBe(true);
    }
  });
});

describe('errorResponseSchema', () => {
  it('accepts an error with its request id', () => {
    const body = { error: { code: 'family_not_found', requestId: 'req-1' } };

    expect(errorResponseSchema.parse(body)).toEqual(body);
  });

  it('accepts an invalid request with its fields', () => {
    const body = {
      error: {
        code: 'invalid_request',
        requestId: 'req-2',
        fields: [
          { path: 'name', code: 'too_long' },
          { path: 'password', code: 'too_short' },
        ],
      },
    };

    expect(errorResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects unknown error codes', () => {
    const body = { error: { code: 'teapot', requestId: 'req-3' } };

    expect(errorResponseSchema.safeParse(body).success).toBe(false);
  });

  it('rejects error details and a missing request id', () => {
    const details = { error: { code: 'internal', requestId: 'req-4', message: 'boom' } };
    const noId = { error: { code: 'internal' } };

    expect(errorResponseSchema.safeParse(details).success).toBe(false);
    expect(errorResponseSchema.safeParse(noId).success).toBe(false);
  });
});
