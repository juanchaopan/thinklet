import type { ArgumentMetadata } from '@nestjs/common';
import { idSchema, updateMeRequestSchema } from '@thinklet/contracts';
import type { z } from 'zod';
import { ApiError } from '../errors/api-error.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

/** The error a rejected value throws. */
function rejection(schema: z.ZodType, value: unknown, metadata?: ArgumentMetadata): ApiError {
  try {
    new ZodValidationPipe(schema).transform(value, metadata);
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
    const error = rejection(updateMeRequestSchema, { name: '' }, { type: 'body' });

    expect(error.getStatus()).toBe(400);
    expect(error.code).toBe('invalid_request');
    expect(error.fields).toEqual([{ path: 'name', code: 'required' }]);
  });

  it('reports a body that is not an object as invalid', () => {
    expect(rejection(updateMeRequestSchema, undefined).fields).toEqual([
      { path: '', code: 'invalid' },
    ]);
  });

  it('reports a rejected named argument under its name', () => {
    expect(rejection(idSchema, 'someone', { type: 'param', data: 'parentId' }).fields).toEqual([
      { path: 'parentId', code: 'invalid' },
    ]);
    expect(
      rejection(updateMeRequestSchema, { name: '' }, { type: 'body', data: 'profile' }).fields,
    ).toEqual([{ path: 'profile.name', code: 'required' }]);
  });
});
