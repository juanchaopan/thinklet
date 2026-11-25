import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// A stand-in for Authing's management API and its webhook (decision 0038),
// for tests and the development machine: it exchanges the user pool's id
// and secret for a management token, deletes users with that token, and
// reports every deletion to the api's webhook with the webhook secret, as
// Authing does. It imports nothing but Node.js, so the end-to-end
// environment and `task dev`, which Node.js runs directly, can start it too.
// It keeps everything in memory.

/** Where the user pool's id and secret are exchanged for a management token. */
export const STUB_TOKEN_PATH = '/api/v3/get-management-token';
/** Where users are deleted with a management token. */
export const STUB_DELETE_USERS_PATH = '/api/v3/delete-users-batch';
/** The header that names the user pool of a management call. */
export const STUB_USER_POOL_HEADER = 'x-authing-userpool-id';
/** The header the webhook carries its secret in. */
export const STUB_WEBHOOK_SECRET_HEADER = 'x-authing-webhook-secret';
/** The event the webhook reports deleted users with. */
export const STUB_USER_DELETED_EVENT = 'user:deleted';

/** What a deletion does instead of succeeding: answer with an error, or never answer. */
export type DeletionFailure = 'error' | 'hang';

/**
 * When deletions are reported to the webhook: once the test asks for it
 * (`manual`), or by itself that many milliseconds after the deletion.
 */
export type WebhookDelivery = 'manual' | number;

export interface AuthingStubOptions {
  userPoolId: string;
  userPoolSecret: string;
  webhookSecret: string;
  /** The interface to listen on; the loopback unless given. */
  host?: string;
  /** The port to listen on; a free one unless given. */
  port?: number;
  /** The api's webhook address; it can also be given later with `reportTo`. */
  webhookUrl?: string;
  delivery?: WebhookDelivery;
}

/** A notification the stand-in sent to the webhook and the status the webhook answered. */
export interface DeliveredReport {
  userIds: string[];
  status: number;
}

export interface AuthingStub {
  /** The origin of the management API, AUTHING_MANAGEMENT_ORIGIN for the api. */
  readonly origin: string;
  /** The ids of the users deleted so far, in order. */
  readonly deletedUserIds: readonly string[];
  /** Every management token handed out so far, for tests that look for them where they must not be. */
  readonly issuedTokens: readonly string[];
  /** Sets the address of the api's webhook. */
  reportTo: (webhookUrl: string) => void;
  /** Makes every deletion fail as given from now on, or succeed again when undefined. */
  failDeletions: (failure: DeletionFailure | undefined) => void;
  /** Deletes users as the platform team does in Authing's console, which only the webhook reports. */
  deleteInConsole: (userIds: string[]) => void;
  /** Sends every report not sent yet and answers what the webhook said to each. */
  deliverReports: () => Promise<DeliveredReport[]>;
  /** Waits until every report sent by itself has been answered. */
  settled: () => Promise<void>;
  /** Stops listening and drops every connection, also one left hanging. */
  close: () => Promise<void>;
}

/** The body of a request as JSON, or undefined when it is not JSON. */
async function jsonOf(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/** Answers in Authing's form: the HTTP status repeated as `statusCode`, with data or an error. */
function answer(response: ServerResponse, status: number, data?: unknown): void {
  const body =
    status === 200
      ? { statusCode: 200, message: '', apiCode: 0, data }
      : { statusCode: status, message: 'Stand-in refused the request', apiCode: status * 10 };
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

/** A member of an object, or undefined. */
function member(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[name]
    : undefined;
}

/** The user ids of a deletion request, or undefined when it names none. */
function userIdsOf(body: unknown): string[] | undefined {
  const userIds = member(body, 'userIds');
  return Array.isArray(userIds) &&
    userIds.length > 0 &&
    userIds.every((id): id is string => typeof id === 'string' && id !== '')
    ? userIds
    : undefined;
}

/** Starts the stand-in and resolves once it listens. */
export async function startAuthingStub(options: AuthingStubOptions): Promise<AuthingStub> {
  const issuedTokens: string[] = [];
  const deletedUserIds: string[] = [];
  const held: string[][] = [];
  const inFlight = new Set<Promise<unknown>>();
  let webhookUrl = options.webhookUrl;
  let failure: DeletionFailure | undefined;
  const delivery = options.delivery ?? 'manual';

  /** Posts one report to the webhook, as Authing does, and answers the webhook's status. */
  const send = async (userIds: string[]): Promise<DeliveredReport> => {
    if (webhookUrl === undefined) {
      throw new Error('The stand-in has no webhook address to report to');
    }
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [STUB_WEBHOOK_SECRET_HEADER]: options.webhookSecret,
      },
      body: JSON.stringify({
        eventName: STUB_USER_DELETED_EVENT,
        data: { users: userIds.map((userId) => ({ userId })) },
      }),
    });
    await response.arrayBuffer();
    return { userIds, status: response.status };
  };

  /** Holds the report, or sends it by itself after the delay. */
  const report = (userIds: string[]): void => {
    if (delivery === 'manual') {
      held.push(userIds);
      return;
    }
    const sending = new Promise((resolve) => setTimeout(resolve, delivery))
      .then(() => send(userIds))
      .catch((error: unknown) => {
        console.error('The Authing stand-in could not report a deletion:', error);
      });
    inFlight.add(sending);
    void sending.finally(() => inFlight.delete(sending));
  };

  const issueToken = (response: ServerResponse, body: unknown): void => {
    if (
      member(body, 'accessKeyId') !== options.userPoolId ||
      member(body, 'accessKeySecret') !== options.userPoolSecret
    ) {
      answer(response, 403);
      return;
    }
    const token = randomUUID();
    issuedTokens.push(token);
    answer(response, 200, { access_token: token, expires_in: 7200 });
  };

  const deleteUsers = (request: IncomingMessage, response: ServerResponse, body: unknown): void => {
    const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
    if (
      token === undefined ||
      !issuedTokens.includes(token) ||
      request.headers[STUB_USER_POOL_HEADER] !== options.userPoolId
    ) {
      answer(response, 401);
      return;
    }
    if (failure === 'hang') {
      return;
    }
    const userIds = userIdsOf(body);
    if (failure === 'error' || userIds === undefined) {
      answer(response, failure === 'error' ? 500 : 400);
      return;
    }
    deletedUserIds.push(...userIds);
    answer(response, 200, { success: true });
    report(userIds);
  };

  const server = createServer((request, response) => {
    void jsonOf(request).then((body) => {
      if (request.method === 'POST' && request.url === STUB_TOKEN_PATH) {
        issueToken(response, body);
      } else if (request.method === 'POST' && request.url === STUB_DELETE_USERS_PATH) {
        deleteUsers(request, response, body);
      } else {
        answer(response, 404);
      }
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve);
  });
  const { address, port } = server.address() as AddressInfo;
  const host = address.includes(':') ? `[${address}]` : address;

  return {
    origin: `http://${host}:${String(port)}`,
    deletedUserIds,
    issuedTokens,
    reportTo: (url) => {
      webhookUrl = url;
    },
    failDeletions: (next) => {
      failure = next;
    },
    deleteInConsole: (userIds) => {
      deletedUserIds.push(...userIds);
      report(userIds);
    },
    deliverReports: async () => {
      const delivered: DeliveredReport[] = [];
      for (const userIds of held.splice(0)) {
        delivered.push(await send(userIds));
      }
      return delivered;
    },
    settled: async () => {
      await Promise.all([...inFlight]);
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
