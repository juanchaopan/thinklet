import * as z from 'zod';
import { environmentSchema } from './environment.js';

// Each test file loads its own modules, so this one sees only what
// environment.ts itself brings in before building its schemas.
describe('the environment schemas', () => {
  it("are built under the contracts package's jitless Zod setting", () => {
    expect(z.config().jitless).toBe(true);
    expect(environmentSchema.safeParse({}).success).toBe(false);
  });
});
