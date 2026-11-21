import { z } from 'zod';

/** Response body of `POST /api/auth/logout`: the Authing address the browser goes to next. */
export const logoutResponseSchema = z.strictObject({
  endSessionUrl: z.url(),
});

export type LogoutResponse = z.infer<typeof logoutResponseSchema>;
