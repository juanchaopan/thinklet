import { updateMeRequestSchema } from '@thinklet/contracts';
import { ApiError } from '../errors/api-error.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

/** The error a rejected value throws. */
function rejection(value: unknown): ApiError {
  try {
    new ZodValidationPipe(updateMeRequestSchema).transform(value);
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error('The value was accepted');
}

describe('ZodValidationPipe', () => {
  it('passes on the parsed value', () => {
    expect(new ZodValidationPipe(updateMeRequestSchema).transform({ name: '  林悦 ' })).toEqual({
      name: '林悦',
    });
  });

  it('rejects a value with 400 invalid_request and the field codes', () => {
    const error = rejection({ name: '' });

    expect(error.getStatus()).toBe(400);
    expect(error.code).toBe('invalid_request');
    expect(error.fields).toEqual([{ path: 'name', code: 'required' }]);
  });

  it('reports a body that is not an object as invalid', () => {
    expect(rejection(undefined).fields).toEqual([{ path: '', code: 'invalid' }]);
  });
});
