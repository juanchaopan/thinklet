import * as z from 'zod';
import './runtime.js';

/**
 * The request headers that may carry the client's IP address behind the
 * proxy in front of the api, the candidates for `CLIENT_IP_HEADER`.
 */
export const CLIENT_IP_CANDIDATE_HEADERS = [
  'x-real-ip',
  'x-forwarded-for',
  'x-vercel-forwarded-for',
] as const;

/**
 * Response body of the temporary `GET /api/client-ip`: each candidate
 * header as the request carried it, `null` when it did not. It serves to
 * check which header the proxy in staging writes; the route goes once that
 * is settled.
 */
export const clientIpResponseSchema = z.strictObject({
  'x-real-ip': z.string().nullable(),
  'x-forwarded-for': z.string().nullable(),
  'x-vercel-forwarded-for': z.string().nullable(),
});

export type ClientIpResponse = z.infer<typeof clientIpResponseSchema>;
