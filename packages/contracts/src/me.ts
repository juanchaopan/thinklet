import * as z from 'zod';
import './runtime.js';
import { familyRoleSchema } from './families.js';
import { parentNameSchema } from './fields.js';

/** One family of the signed-in parent; `pendingRequests` is there only where they are the admin. */
export const meFamilySchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  role: familyRoleSchema,
  pendingRequests: z.int().nonnegative().optional(),
});

/**
 * Response body of `GET /api/me` and `PATCH /api/me`; families are in joining
 * order. `requestResults` counts the parent's own requests that were
 * approved, rejected or expired and that they have not dismissed: the red dot
 * on 加入家庭 and on the avatar.
 */
export const meResponseSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  families: z.array(meFamilySchema),
  requestResults: z.int().nonnegative(),
});

/** Request body of `PATCH /api/me`: the parent's own new name. */
export const updateMeRequestSchema = z.strictObject({
  name: parentNameSchema,
});

export type MeFamily = z.infer<typeof meFamilySchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;
