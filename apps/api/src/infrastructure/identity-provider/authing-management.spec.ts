import { Logger } from '@nestjs/common';
import {
  AuthingManagement,
  DELETE_USERS_PATH,
  IdentityProviderError,
  MANAGEMENT_TIMEOUT_MS,
  MANAGEMENT_TOKEN_PATH,
} from './authing-management.js';

const ORIGIN = 'https://authing.example';
const POOL_ID = 'pool-id-1';
const POOL_SECRET = 'pool-secret-1';
const TOKEN = 'management-token-1';

/** A call the client made: where, with which headers and body. */
interface Call {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  redirect: RequestRedirect | undefined;
}

/** An answer of the stubbed Authing: a JSON body with a status, text that is not JSON, or none. */
type Answer =
  { status: number; body: unknown } | { status: number; text: string } | 'hang' | 'unreachable';

const TOKEN_ANSWER: Answer = {
  status: 200,
  body: { statusCode: 200, message: '', data: { access_token: TOKEN, expires_in: 7200 } },
};
const DELETED_ANSWER: Answer = {
  status: 200,
  body: { statusCode: 200, message: '', data: { success: true } },
};

/**
 * A fetch that answers the token and the deletion as given and records
 * every call. The client always calls it with a URL and a JSON body.
 */
function stubFetch(answers: { token?: Answer; delete?: Answer }) {
  const calls: Call[] = [];
  const stub = (async (input: URL, init?: RequestInit) => {
    const url = input.href;
    calls.push({
      url,
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(init?.body as string) as unknown,
      redirect: init?.redirect,
    });
    const answer =
      (url.endsWith(MANAGEMENT_TOKEN_PATH) ? answers.token : answers.delete) ?? DELETED_ANSWER;
    if (answer === 'unreachable') {
      throw new TypeError('fetch failed');
    }
    if (answer === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason as Error);
        });
      });
    }
    return 'text' in answer
      ? new Response(answer.text, { status: answer.status })
      : Response.json(answer.body, { status: answer.status });
  }) as typeof fetch;
  return { calls, stub };
}

function client(fetchStub: typeof fetch, timeoutMs?: number): AuthingManagement {
  return new AuthingManagement({
    origin: ORIGIN,
    userPoolId: POOL_ID,
    userPoolSecret: POOL_SECRET,
    fetch: fetchStub,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

describe('AuthingManagement', () => {
  let logged: unknown[][];

  beforeEach(() => {
    logged = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gets a management token with the user pool id and secret, then deletes the user with it', async () => {
    const { calls, stub } = stubFetch({ token: TOKEN_ANSWER });

    await client(stub).deleteUser('user-1');

    expect(calls).toEqual([
      {
        url: `${ORIGIN}${MANAGEMENT_TOKEN_PATH}`,
        headers: { 'content-type': 'application/json' },
        body: { accessKeyId: POOL_ID, accessKeySecret: POOL_SECRET },
        redirect: 'error',
      },
      {
        url: `${ORIGIN}${DELETE_USERS_PATH}`,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${TOKEN}`,
          'x-authing-userpool-id': POOL_ID,
        },
        body: { userIds: ['user-1'] },
        redirect: 'error',
      },
    ]);
    expect(logged).toEqual([]);
  });

  it('gets a new token for every deletion', async () => {
    const { calls, stub } = stubFetch({ token: TOKEN_ANSWER });
    const management = client(stub);

    await management.deleteUser('user-1');
    await management.deleteUser('user-2');

    expect(calls.map(({ url }) => url.slice(ORIGIN.length))).toEqual([
      MANAGEMENT_TOKEN_PATH,
      DELETE_USERS_PATH,
      MANAGEMENT_TOKEN_PATH,
      DELETE_USERS_PATH,
    ]);
  });

  it.each([
    ['an error status', { status: 403, body: { statusCode: 403, apiCode: 2001, message: 'no' } }],
    ['a failure in the body', { status: 200, body: { statusCode: 400, apiCode: 2004 } }],
    ['no token', { status: 200, body: { statusCode: 200, data: {} } }],
    ['a body that is not JSON', { status: 502, text: '<html>Bad gateway</html>' }],
  ] as const)('fails without deleting when the token request gets %s', async (_case, answer) => {
    const { calls, stub } = stubFetch({ token: answer });

    await expect(client(stub).deleteUser('user-1')).rejects.toThrow(IdentityProviderError);

    expect(calls).toHaveLength(1);
  });

  it.each([
    ['an error status', { status: 500, body: { statusCode: 500, apiCode: 500 } }],
    ['a failure in the body', { status: 200, body: { statusCode: 404, apiCode: 2004 } }],
    ['no success', { status: 200, body: { statusCode: 200, data: { success: false } } }],
    ['a body that is not JSON', { status: 200, text: 'ok' }],
  ] as const)('fails when the deletion gets %s', async (_case, answer) => {
    const { stub } = stubFetch({ token: TOKEN_ANSWER, delete: answer });

    await expect(client(stub).deleteUser('user-1')).rejects.toMatchObject({
      step: 'delete',
      reason: `status ${answer.status}`,
    });
  });

  it('fails when Authing cannot be reached', async () => {
    const { stub } = stubFetch({ token: 'unreachable' });

    await expect(client(stub).deleteUser('user-1')).rejects.toMatchObject({
      step: 'token',
      reason: 'unreachable',
    });
  });

  it.each(['token', 'delete'] as const)(
    'gives up on a %s call that does not answer in time',
    async (step) => {
      const { stub } = stubFetch(
        step === 'token' ? { token: 'hang' } : { token: TOKEN_ANSWER, delete: 'hang' },
      );

      await expect(client(stub, 50).deleteUser('user-1')).rejects.toMatchObject({
        step,
        reason: 'timeout',
      });
    },
  );

  it('waits ten seconds for each call by default', () => {
    expect(MANAGEMENT_TIMEOUT_MS).toBe(10_000);
  });

  it("logs a failure with the status and Authing's codes only, never the token, the secret or Authing's message", async () => {
    const { stub } = stubFetch({
      token: TOKEN_ANSWER,
      delete: {
        status: 403,
        body: { statusCode: 403, apiCode: 2001, message: `bad ${TOKEN} ${POOL_SECRET}` },
      },
    });

    await expect(client(stub).deleteUser('user-1')).rejects.toThrow(IdentityProviderError);

    expect(logged).toEqual([
      [
        { step: 'delete', reason: 'status 403', statusCode: 403, apiCode: 2001 },
        "Authing's management API failed",
      ],
    ]);
    const text = JSON.stringify(logged);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(POOL_SECRET);
  });

  it('names the step and what went wrong in its error, and no secret', async () => {
    const { stub } = stubFetch({ token: { status: 401, body: { statusCode: 401 } } });

    const error = await client(stub)
      .deleteUser('user-1')
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(IdentityProviderError);
    expect((error as Error).message).toBe("Authing's management API failed at token: status 401");
  });
});
