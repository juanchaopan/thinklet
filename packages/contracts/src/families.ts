import { z } from 'zod';
import { familyCodeSchema, familyNameSchema, idSchema, timeZoneSchema } from './fields.js';

/** A parent's role in a family: each family has exactly one admin. */
export const familyRoleSchema = z.enum(['admin', 'member']);

/** Request body of `POST /api/families`. */
export const createFamilyRequestSchema = z.strictObject({
  name: familyNameSchema,
  timezone: timeZoneSchema,
});

/** Request body of `PATCH /api/families/{familyId}`; a field left out keeps its value. */
export const updateFamilyRequestSchema = z.strictObject({
  name: familyNameSchema.optional(),
  timezone: timeZoneSchema.optional(),
});

/** Request body of `PUT /api/families/{familyId}/admin`: the member who becomes the admin. */
export const transferAdminRequestSchema = z.strictObject({
  parentId: idSchema,
});

/** A parent in a family, as the family's members see them. */
export const familyMemberSchema = z.strictObject({
  parentId: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  role: familyRoleSchema,
  /** Whether this member is the signed-in parent. */
  you: z.boolean(),
});

/** A family as its members see it; `role` is the signed-in parent's, members are in joining order. */
export const familyDetailSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  timezone: z.string(),
  code: familyCodeSchema,
  role: familyRoleSchema,
  members: z.array(familyMemberSchema),
});

/** Response body of `GET /api/family-codes/{code}`: whom the applicant is asking to join. */
export const familyCodeLookupResponseSchema = z.strictObject({
  familyName: z.string(),
  adminName: z.string(),
});

export type FamilyRole = z.infer<typeof familyRoleSchema>;
export type CreateFamilyRequest = z.infer<typeof createFamilyRequestSchema>;
export type UpdateFamilyRequest = z.infer<typeof updateFamilyRequestSchema>;
export type TransferAdminRequest = z.infer<typeof transferAdminRequestSchema>;
export type FamilyMember = z.infer<typeof familyMemberSchema>;
export type FamilyDetail = z.infer<typeof familyDetailSchema>;
export type FamilyCodeLookupResponse = z.infer<typeof familyCodeLookupResponseSchema>;
