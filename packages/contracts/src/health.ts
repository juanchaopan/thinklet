import * as z from 'zod';
import './runtime.js';

/** Result of one health check item. */
export const checkStatusSchema = z.enum(['ok', 'error']);

/**
 * Response body of `GET /api/health`: the database, the bucket and Redis;
 * unknown keys are rejected so no error details can leak.
 */
export const healthResponseSchema = z.strictObject({
  status: checkStatusSchema,
  checks: z.strictObject({
    database: checkStatusSchema,
    storage: checkStatusSchema,
    redis: checkStatusSchema,
  }),
});

export type CheckStatus = z.infer<typeof checkStatusSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type HealthCheckName = keyof HealthResponse['checks'];
