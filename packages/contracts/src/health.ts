import { z } from 'zod';

/** Result of one health check item. */
export const checkStatusSchema = z.enum(['ok', 'error']);

/** Response body of `GET /api/health`; unknown keys are rejected so no error details can leak. */
export const healthResponseSchema = z.strictObject({
  status: checkStatusSchema,
  checks: z.strictObject({
    database: checkStatusSchema,
    storage: checkStatusSchema,
  }),
});

export type CheckStatus = z.infer<typeof checkStatusSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type HealthCheckName = keyof HealthResponse['checks'];
