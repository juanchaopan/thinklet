import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { meResponseSchema } from './index.js';

describe('the contracts package', () => {
  it('checks values without compiled parsers, so no page needs eval', () => {
    expect(z.config().jitless).toBe(true);
    expect(meResponseSchema.safeParse({ id: 'x' }).success).toBe(false);
  });
});
