import * as z from 'zod';
import './runtime.js';
import { signedInChildSchema } from './child.js';
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
 * this browser. The password may be left out: a child who has none yet logs
 * in to set one, and a child who has one is refused without it.
 */
export const childLoginRequestSchema = z.strictObject({
  code: familyCodeSchema,
  account: childAccountSchema,
  password: childPasswordSchema.optional(),
  remember: booleanFieldSchema,
});

/**
 * Response body of every child login that signs the child in: with the
 * family code, the account and the password, by a remembered avatar, and
 * by a login link. It is the child now signed in, its id and nickname;
 * `GET /api/child/me` answers more of the child.
 */
export const childLoginResponseSchema = signedInChildSchema;

/**
 * The answer of `POST /api/child-auth/login` for a child who has no
 * password yet and may still set one with the account: nobody is signed in,
 * and the login turns into setting the password. The child's id and
 * nickname are those a signed-in child is answered with; the id gives the
 * child's avatar its colour.
 */
export const childNeedsPasswordSchema = z.strictObject({
  needsPassword: z.literal(true),
  ...signedInChildSchema.shape,
});

/** Response body of `POST /api/child-auth/login`: the child signed in, or the child who has to set a password first. */
export const childLoginAnswerSchema = z.union([childLoginResponseSchema, childNeedsPasswordSchema]);

/**
 * Request body of `POST /api/child-auth/password`: the first password of a
 * child found by the family code and the account, within the time a parent
 * left for setting it with the account.
 */
export const setChildPasswordWithAccountRequestSchema = z.strictObject({
  code: familyCodeSchema,
  account: childAccountSchema,
  password: newChildPasswordSchema,
  remember: booleanFieldSchema,
});

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
export type ChildNeedsPassword = z.infer<typeof childNeedsPasswordSchema>;
export type ChildLoginAnswer = z.infer<typeof childLoginAnswerSchema>;
export type SetChildPasswordWithAccountRequest = z.infer<
  typeof setChildPasswordWithAccountRequestSchema
>;
export type RememberedChild = z.infer<typeof rememberedChildSchema>;
export type ChildLoginLinkInfo = z.infer<typeof childLoginLinkInfoSchema>;
export type SetChildPasswordRequest = z.infer<typeof setChildPasswordRequestSchema>;
export type ChildLinkLoginRequest = z.infer<typeof childLinkLoginRequestSchema>;
