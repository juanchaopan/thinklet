import * as z from 'zod';
import './runtime.js';

/** Response body of `GET /api/child/me`: the signed-in child. */
export const childMeResponseSchema = z.strictObject({
  id: z.uuid(),
  nickname: z.string(),
});

export type ChildMeResponse = z.infer<typeof childMeResponseSchema>;
