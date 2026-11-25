import * as z from 'zod';
import './runtime.js';
import { fieldErrorCodeSchema, type FieldErrorCode } from './fields.js';

/** Every error code the api answers with; the web app picks the message to show by it. */
export const errorCodeSchema = z.enum([
  // 400: the request body, query or path did not pass its schema; `fields` says which.
  'invalid_request',
  // 401: not signed in, or the JWT has expired, its signature is wrong or it is of the other kind.
  'unauthenticated',
  // 401: the family code, the account or the password of a child login is wrong, or the child has no password yet.
  'login_failed',
  // 401: the browser no longer remembers the child: revoked, expired or never there.
  'remember_invalid',
  // 401: the password entered on a login link is not the child's.
  'wrong_password',
  // 403: a request that changes data came without this site's Origin.
  'bad_origin',
  // 403: the action needs the family's admin.
  'not_admin',
  // 404: the family does not exist or the parent is not one of its members.
  'family_not_found',
  // 404: nothing at this address, a join request that is not the parent's own, a login link that is not the child's, or no such cover.
  'not_found',
  // 404: no family has this code.
  'code_not_found',
  // 404: the family has no such child, or the child has been deleted.
  'child_not_found',
  // 404: the book does not exist, or it is inactive and the family does not have it.
  'book_not_found',
  // 404: the login link has expired, been used or revoked, does not exist, or its child has been deleted.
  'link_invalid',
  // 409: the parent is already a member of the family.
  'already_member',
  // 409: the parent already has a pending request to the family, or the request is still pending.
  'request_pending',
  // 409: the join request has already been approved, rejected, withdrawn or expired.
  'request_closed',
  // 409: the admin has to hand the admin role to someone else before leaving.
  'admin_cannot_leave',
  // 409: the parent named as the family's new admin is its admin already.
  'already_admin',
  // 409: the parent is no longer a member of the family.
  'not_a_member',
  // 409: another child of the family has this account.
  'account_taken',
  // 409: the child of the login link has a password already, so it is entered, not set.
  'password_already_set',
  // 409: the child of the login link has no password yet, so it is set, not entered.
  'password_not_set',
  // 409: a child of the family still reads the book, so the family cannot remove it.
  'book_in_use',
  // 409: the family does not have the book, so it cannot be assigned to its children.
  'book_not_acquired',
  // 409: the book has left the library, so it cannot be acquired or assigned to another child.
  'book_inactive',
  // 429: the request's source failed too often in the window; `retryAfterSeconds` says when it ends.
  'rate_limited',
  // 500: anything unexpected; the response carries only the request id.
  'internal',
]);

/** One rejected field of an `invalid_request`; `path` joins the field's keys with dots. */
export const fieldErrorSchema = z.strictObject({
  path: z.string(),
  code: fieldErrorCodeSchema,
});

/**
 * The body of every error response; `requestId` is the error id shown on
 * screen. A `rate_limited` carries `retryAfterSeconds`, the seconds left in
 * the window that refused it, as its `Retry-After` header does.
 */
export const errorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: errorCodeSchema,
    requestId: z.string().min(1),
    fields: z.array(fieldErrorSchema).optional(),
    retryAfterSeconds: z.int().positive().optional(),
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
