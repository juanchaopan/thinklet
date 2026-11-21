import { z } from 'zod';
import { fieldErrorCodeSchema, type FieldErrorCode } from './fields.js';

/** Every error code the api answers with; the web app picks the message to show by it. */
export const errorCodeSchema = z.enum([
  // 400: the request body, query or path did not pass its schema; `fields` says which.
  'invalid_request',
  // 401: not signed in, or the JWT has expired or its signature is wrong.
  'unauthenticated',
  // 403: a request that changes data came without this site's Origin.
  'bad_origin',
  // 403: the action needs the family's admin.
  'not_admin',
  // 404: the family does not exist or the parent is not one of its members.
  'family_not_found',
  // 404: nothing at this address, or a join request that is not the parent's own.
  'not_found',
  // 404: no family has this code.
  'code_not_found',
  // 409: the parent is already a member of the family.
  'already_member',
  // 409: the parent already has a pending request to the family, or the request is still pending.
  'request_pending',
  // 409: the join request has already been approved, rejected, withdrawn or expired.
  'request_closed',
  // 409: the admin has to hand the admin role to someone else before leaving.
  'admin_cannot_leave',
  // 409: the parent is no longer a member of the family.
  'not_a_member',
  // 500: anything unexpected; the response carries only the request id.
  'internal',
]);

/** One rejected field of an `invalid_request`; `path` joins the field's keys with dots. */
export const fieldErrorSchema = z.strictObject({
  path: z.string(),
  code: fieldErrorCodeSchema,
});

/** The body of every error response; `requestId` is the error id shown on screen. */
export const errorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: errorCodeSchema,
    requestId: z.string().min(1),
    fields: z.array(fieldErrorSchema).optional(),
  }),
});

export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type FieldError = z.infer<typeof fieldErrorSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

const fieldErrorCodes: ReadonlySet<string> = new Set(fieldErrorCodeSchema.options);

/**
 * The rejected fields of a failed parse. The field schemas use field error
 * codes as their messages; any other issue (an unknown key, a body that is
 * not an object) is reported as `invalid`.
 */
export function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: fieldErrorCodes.has(issue.message) ? (issue.message as FieldErrorCode) : 'invalid',
  }));
}
