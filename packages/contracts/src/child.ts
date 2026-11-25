import * as z from 'zod';
import './runtime.js';
import { childNicknameSchema } from './fields.js';

/**
 * A signed-in child as every child login answers: the id gives the avatar
 * its colour, the nickname is what the child's pages greet the child by.
 */
export const signedInChildSchema = z.strictObject({
  id: z.uuid(),
  nickname: z.string(),
});

/**
 * Response body of `GET /api/child/me` and `PATCH /api/child/me`: the
 * signed-in child, with the account and the name of the child's family
 * that the child's own settings show.
 */
export const childMeResponseSchema = z.strictObject({
  ...signedInChildSchema.shape,
  account: z.string(),
  familyName: z.string(),
});

/** Request body of `PATCH /api/child/me`: the child's new nickname, by the parents' rule. */
export const updateChildMeRequestSchema = z.strictObject({
  nickname: childNicknameSchema,
});

export type SignedInChild = z.infer<typeof signedInChildSchema>;
export type ChildMeResponse = z.infer<typeof childMeResponseSchema>;
export type UpdateChildMeRequest = z.infer<typeof updateChildMeRequestSchema>;
