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
      'rate_limited',
    ]) {
      expect(errorCodeSchema.safeParse(code).success, code).toBe(true);
    }
  });

  it('has the codes of the library and its books', () => {
    for (const code of ['book_not_found', 'book_in_use', 'book_not_acquired', 'book_inactive']) {
      expect(errorCodeSchema.safeParse(code).success, code).toBe(true);
    }
  });

  it('has the codes of deleting an account', () => {
    for (const code of ['still_admin', 'identity_provider_failed']) {
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

  it('accepts a rate limit with the seconds left in its window', () => {
    const body = { error: { code: 'rate_limited', requestId: 'req-5', retryAfterSeconds: 412 } };

    expect(errorResponseSchema.parse(body)).toEqual(body);
  });

  it.each([0, -1, 1.5, '60'])('rejects %j as the seconds left in a window', (seconds) => {
    const body = {
      error: { code: 'rate_limited', requestId: 'req-6', retryAfterSeconds: seconds },
    };

    expect(errorResponseSchema.safeParse(body).success).toBe(false);
  });

  it('accepts a still_admin with the families the parent is the admin of', () => {
    const body = {
      error: {
        code: 'still_admin',
        requestId: 'req-7',
        families: [{ id: '5d1e7f3a-9b2c-4d4e-a6f8-1a2b3c4d5e6f', name: '林悦的家' }],
      },
    };

    expect(errorResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects a family named by anything but its id and name', () => {
    const body = {
      error: {
        code: 'still_admin',
        requestId: 'req-8',
        families: [{ id: 'not-an-id', name: '林悦的家', code: '7KQ4MZ' }],
      },
    };

    expect(errorResponseSchema.safeParse(body).success).toBe(false);
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
