import * as z from 'zod';
import './runtime.js';
import { familyCodeSchema } from './fields.js';

/** Every state of a join request; only `pending` ever changes. */
export const joinRequestStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'withdrawn',
  'expired',
]);

/** Request body of `POST /api/join-requests`. */
export const createJoinRequestRequestSchema = z.strictObject({
  code: familyCodeSchema,
});

/**
 * A join request as its applicant sees it. Withdrawn requests are gone, so
 * the status is one of the other four. `familyTimezone` is the time zone its
 * time is shown in.
 */
export const applicantJoinRequestSchema = z.strictObject({
  id: z.uuid(),
  familyName: z.string(),
  familyTimezone: z.string(),
  adminName: z.string(),
  status: joinRequestStatusSchema.extract(['pending', 'approved', 'rejected', 'expired']),
  createdAt: z.iso.datetime(),
});

/** Response body of `GET /api/join-requests`. */
export const applicantJoinRequestListSchema = z.array(applicantJoinRequestSchema);

/**
 * A pending request to join a family, as the admin sees it. `parentId` is
 * the applicant's, which their avatar takes its colour from.
 */
export const pendingJoinRequestSchema = z.strictObject({
  id: z.uuid(),
  parentId: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

/**
 * A request the admin has just approved or rejected: the response body of
 * `POST /api/families/{familyId}/join-requests/{requestId}/approve` and
 * `.../reject`, with when it was closed.
 */
export const handledJoinRequestSchema = z.strictObject({
  id: z.uuid(),
  parentId: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  status: joinRequestStatusSchema.extract(['approved', 'rejected']),
  closedAt: z.iso.datetime(),
});

/**
 * Response body of `GET /api/families/{familyId}/join-requests`: the
 * family's pending requests, newest first. Closed requests are not listed.
 */
export const familyJoinRequestsResponseSchema = z.strictObject({
  pending: z.array(pendingJoinRequestSchema),
});

export type JoinRequestStatus = z.infer<typeof joinRequestStatusSchema>;
export type CreateJoinRequestRequest = z.infer<typeof createJoinRequestRequestSchema>;
export type ApplicantJoinRequest = z.infer<typeof applicantJoinRequestSchema>;
export type PendingJoinRequest = z.infer<typeof pendingJoinRequestSchema>;
export type HandledJoinRequest = z.infer<typeof handledJoinRequestSchema>;
export type FamilyJoinRequestsResponse = z.infer<typeof familyJoinRequestsResponseSchema>;
