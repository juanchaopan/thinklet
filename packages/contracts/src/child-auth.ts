import * as z from 'zod';
import './runtime.js';
import { childMeResponseSchema } from './child.js';
import {
  booleanFieldSchema,
  childAccountSchema,
  childPasswordSchema,
  familyCodeSchema,
  newChildPasswordSchema,
} from './fields.js';

/**
 * Request body of `POST /api/child-auth/login`. The family code is
 * case-insensitive and comes out in capitals; `remember` keeps the child on
 * this browser.
 */
export const childLoginRequestSchema = z.strictObject({
  code: familyCodeSchema,
  account: childAccountSchema,
  password: childPasswordSchema,
  remember: booleanFieldSchema,
});

/**
 * Response body of every child login: with the family code, account and
 * password, by a remembered avatar, and by a login link. It is the child
 * now signed in, as `GET /api/child/me` answers.
 */
export const childLoginResponseSchema = childMeResponseSchema;

/**
 * A child this browser remembers. The family code and the account fill in
 * the login form when the remembered login is no longer valid.
 */
export const rememberedChildSchema = z.strictObject({
  childId: z.uuid(),
  nickname: z.string(),
  familyCode: familyCodeSchema,
  account: z.string(),
});

/** Response body of `GET /api/child-auth/remembered`; empty without a device cookie. */
export const rememberedChildListSchema = z.array(rememberedChildSchema);

/**
 * Response body of `GET /api/child-login-links/{token}`: whose link it is and
 * whether they still have to set a password. Reading it does not use the link.
 */
export const childLoginLinkInfoSchema = z.strictObject({
  childId: z.uuid(),
  nickname: z.string(),
  needsPassword: z.boolean(),
});

/** Request body of `POST /api/child-login-links/{token}/password`: the child's first password. */
export const setChildPasswordRequestSchema = z.strictObject({
  password: newChildPasswordSchema,
  remember: booleanFieldSchema,
});

/** Request body of `POST /api/child-login-links/{token}/login`: the password the child has. */
export const childLinkLoginRequestSchema = z.strictObject({
  password: childPasswordSchema,
  remember: booleanFieldSchema,
});

export type ChildLoginRequest = z.infer<typeof childLoginRequestSchema>;
export type ChildLoginResponse = z.infer<typeof childLoginResponseSchema>;
export type RememberedChild = z.infer<typeof rememberedChildSchema>;
export type ChildLoginLinkInfo = z.infer<typeof childLoginLinkInfoSchema>;
export type SetChildPasswordRequest = z.infer<typeof setChildPasswordRequestSchema>;
export type ChildLinkLoginRequest = z.infer<typeof childLinkLoginRequestSchema>;
