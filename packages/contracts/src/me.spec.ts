import { describe, expect, it } from 'vitest';
import { meResponseSchema, updateMeRequestSchema } from './me.js';

describe('meResponseSchema', () => {
  it('accepts a parent with families, the pending count only where they are the admin', () => {
    const body = {
      id: '0b7c2f4e-8d1a-4c3b-9e5f-6a7b8c9d0e1f',
      name: '林悦',
      email: 'linyue@example.com',
      families: [
        {
          id: '5d1e6f70-8192-4a3b-8c4d-5e6f708192a3',
          name: '林悦的家',
          role: 'admin',
          pendingRequests: 2,
        },
        { id: '8a40b1c2-d3e4-4f50-a617-28394a5b6c7d', name: '外婆家', role: 'member' },
      ],
      requestResults: 1,
    };

    expect(meResponseSchema.parse(body)).toEqual(body);
  });

  it('accepts a parent without an email or a family', () => {
    const body = {
      id: '0b7c2f4e-8d1a-4c3b-9e5f-6a7b8c9d0e1f',
      name: '林悦',
      email: null,
      families: [],
      requestResults: 0,
    };

    expect(meResponseSchema.parse(body)).toEqual(body);
  });

  it('needs the count of request results, a whole number of at least zero', () => {
    const body = {
      id: '0b7c2f4e-8d1a-4c3b-9e5f-6a7b8c9d0e1f',
      name: '林悦',
      email: null,
      families: [],
    };

    expect(meResponseSchema.safeParse(body).success).toBe(false);
    expect(meResponseSchema.safeParse({ ...body, requestResults: -1 }).success).toBe(false);
    expect(meResponseSchema.safeParse({ ...body, requestResults: 1.5 }).success).toBe(false);
  });
});

describe('updateMeRequestSchema', () => {
  it('trims the new name', () => {
    expect(updateMeRequestSchema.parse({ name: ' 林悦 ' })).toEqual({ name: '林悦' });
  });

  it('rejects names that are empty or longer than 20 characters', () => {
    expect(updateMeRequestSchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(updateMeRequestSchema.safeParse({ name: 'a'.repeat(21) }).success).toBe(false);
  });
});
