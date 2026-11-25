import { Logger } from '@nestjs/common';
import { z } from 'zod';

/** How long each call to the management API may take (`.docs/design/interfaces.md`, "Authing 的管理 API"). */
export const MANAGEMENT_TIMEOUT_MS = 10_000;

/** Where the user pool's id and secret are exchanged for a management token. */
export const MANAGEMENT_TOKEN_PATH = '/api/v3/get-management-token';

/** Where users are deleted, a batch of user ids at a time. */
export const DELETE_USERS_PATH = '/api/v3/delete-users-batch';

/** The header that names the user pool a management call is about. */
export const USER_POOL_HEADER = 'x-authing-userpool-id';

/** The step of deleting a user that failed: getting the management token or deleting. */
export type ManagementStep = 'token' | 'delete';

/**
 * Authing did not delete the user: it answered with an error, an answer
 * that is not a success, or no answer within the time. The message names
 * the step and what went wrong, never a token or a secret.
 */
export class IdentityProviderError extends Error {
  override readonly name = 'IdentityProviderError';

  constructor(
    readonly step: ManagementStep,
    readonly reason: string,
  ) {
    super(`Authing's management API failed at ${step}: ${reason}`);
  }
}

/** A successful answer to the token request: the token and how long it lasts. */
const tokenAnswerSchema = z.object({
  statusCode: z.literal(200),
  data: z.object({ access_token: z.string().min(1), expires_in: z.number().optional() }),
});

/** A successful answer to the deletion. */
const deletionAnswerSchema = z.object({
  statusCode: z.literal(200),
  data: z.object({ success: z.literal(true) }),
});

/** The codes an Authing answer carries, which are all that is logged of a failed one. */
const answerCodesSchema = z.object({
  statusCode: z.number().optional(),
  apiCode: z.number().optional(),
});

/** What the client needs: where the API is and the user pool's credentials. */
export interface AuthingManagementOptions {
  origin: string;
  userPoolId: string;
  userPoolSecret: string;
  timeoutMs?: number;
  /** The fetch the calls are made with; Node's own unless a test gives another. */
  fetch?: typeof fetch;
}

/** One call to the management API: its step, where it goes, what it sends. */
interface ManagementCall {
  step: ManagementStep;
  path: string;
  body: object;
  headers: Record<string, string>;
}

/** Why a call got no answer: it ran out of time or could not reach Authing. */
function noAnswer(error: unknown): string {
  return error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'unreachable';
}

/** The answer's body as JSON, or undefined when it is not JSON. */
async function bodyOf(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Authing's management API, used for one thing: deleting a parent's
 * account in Authing when the parent deletes it here (decision 0038). Every
 * deletion asks for a new management token with the user pool's id and
 * secret, then deletes the user by its id, the parent's `sub`. Each call
 * gives up after MANAGEMENT_TIMEOUT_MS. Any failure, an error answer, an
 * answer that is not a success or no answer, is logged with the HTTP
 * status and Authing's own codes only and thrown as IdentityProviderError:
 * neither the token, nor the secret, nor a message of Authing's is logged.
 */
export class AuthingManagement {
  private readonly logger = new Logger(AuthingManagement.name);
  private readonly timeoutMs: number;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: AuthingManagementOptions) {
    this.timeoutMs = options.timeoutMs ?? MANAGEMENT_TIMEOUT_MS;
    this.fetch = options.fetch ?? fetch;
  }

  /** Deletes the user with the id from the user pool; resolves once Authing says it is deleted. */
  async deleteUser(userId: string): Promise<void> {
    const { data } = await this.call(
      {
        step: 'token',
        path: MANAGEMENT_TOKEN_PATH,
        body: {
          accessKeyId: this.options.userPoolId,
          accessKeySecret: this.options.userPoolSecret,
        },
        headers: {},
      },
      tokenAnswerSchema,
    );
    await this.call(
      {
        step: 'delete',
        path: DELETE_USERS_PATH,
        body: { userIds: [userId] },
        headers: {
          authorization: `Bearer ${data.access_token}`,
          [USER_POOL_HEADER]: this.options.userPoolId,
        },
      },
      deletionAnswerSchema,
    );
  }

  private async call<T>(
    { step, path, body, headers }: ManagementCall,
    schema: z.ZodType<T>,
  ): Promise<T> {
    let response: Response;
    let answer: unknown;
    try {
      response = await this.fetch(new URL(path, this.options.origin), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      answer = await bodyOf(response);
    } catch (error) {
      throw this.failure(step, noAnswer(error));
    }
    const parsed = schema.safeParse(answer);
    if (!response.ok || !parsed.success) {
      throw this.failure(step, `status ${response.status}`, answer);
    }
    return parsed.data;
  }

  private failure(step: ManagementStep, reason: string, answer?: unknown): IdentityProviderError {
    const codes = answerCodesSchema.safeParse(answer);
    this.logger.error(
      { step, reason, ...(codes.success ? codes.data : {}) },
      "Authing's management API failed",
    );
    return new IdentityProviderError(step, reason);
  }
}
