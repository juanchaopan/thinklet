import * as z from 'zod';
import './runtime.js';
import { childAccountSchema, childNicknameSchema } from './fields.js';

/**
 * A child of a family, as the family's parents see it. `passwordSet` is
 * whether the child has set a password; `passwordSetupUntil` is, while the
 * child has none, until when the child may set one by logging in with the
 * account, and null once a password is set or when there is no such time.
 */
export const childSchema = z.strictObject({
  id: z.uuid(),
  nickname: z.string(),
  account: z.string(),
  passwordSet: z.boolean(),
  passwordSetupUntil: z.iso.datetime().nullable(),
});

/** Response body of `GET /api/families/{familyId}/children`, in the order they were added. */
export const childListSchema = z.array(childSchema);

/**
 * The guardian's consent to processing the child's data. Anything but
 * `true`, left out included, is reported as `required`: the box has to be
 * ticked.
 */
export const guardianConsentSchema = z.literal(true, { error: 'required' });

/** Request body of `POST /api/families/{familyId}/children`; the child sets the password. */
export const addChildRequestSchema = z.strictObject({
  nickname: childNicknameSchema,
  account: childAccountSchema,
  consent: guardianConsentSchema,
});

/** Request body of `PATCH /api/families/{familyId}/children/{childId}`; a field left out keeps its value. */
export const updateChildRequestSchema = z.strictObject({
  nickname: childNicknameSchema.optional(),
  account: childAccountSchema.optional(),
});

/**
 * Response body of `POST /api/families/{familyId}/children/{childId}/login-links`.
 * The token is in `url` and in no other response.
 */
export const childLoginLinkSchema = z.strictObject({
  id: z.uuid(),
  url: z.url(),
  expiresAt: z.iso.datetime(),
});

/** Every state of a login link: `active` until it is used, expires or a newer link revokes it. */
export const childLoginLinkStatusSchema = z.enum(['active', 'used', 'expired', 'revoked']);

/** Response body of `GET /api/families/{familyId}/children/{childId}/login-links/{linkId}`. */
export const childLoginLinkStatusResponseSchema = z.strictObject({
  status: childLoginLinkStatusSchema,
  expiresAt: z.iso.datetime(),
});

/** A browser a child is remembered on; `name` is derived from the browser when it is remembered. */
export const childDeviceSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  rememberedAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
});

/** Response body of `GET /api/families/{familyId}/children/{childId}/devices`, latest login first. */
export const childDeviceListSchema = z.array(childDeviceSchema);

export type Child = z.infer<typeof childSchema>;
export type AddChildRequest = z.infer<typeof addChildRequestSchema>;
export type UpdateChildRequest = z.infer<typeof updateChildRequestSchema>;
export type ChildLoginLink = z.infer<typeof childLoginLinkSchema>;
export type ChildLoginLinkStatus = z.infer<typeof childLoginLinkStatusSchema>;
export type ChildLoginLinkStatusResponse = z.infer<typeof childLoginLinkStatusResponseSchema>;
export type ChildDevice = z.infer<typeof childDeviceSchema>;
