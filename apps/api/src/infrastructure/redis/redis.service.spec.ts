import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';

/** node-redis's client as far as the service uses it, driven by the tests. */
class FakeClient extends EventEmitter {
  isOpen = false;
  readonly connect = vi.fn(() => {
    this.isOpen = true;
    return new Promise<void>(() => {});
  });
  readonly destroy = vi.fn(() => {
    this.isOpen = false;
  });
  readonly ping = vi.fn(() => Promise.resolve('PONG'));
}

/** The client createClient hands out, and the options it was last called with. */
const created = vi.hoisted((): { client: unknown; options: unknown } => ({
  client: undefined,
  options: undefined,
}));

vi.mock('redis', () => ({
  createClient: (options: unknown) => {
    created.options = options;
    return created.client;
  },
}));

const { COMMAND_TIMEOUT_MS, RedisService, RedisUnavailableError } =
  await import('./redis.service.js');

const REDIS_URL = 'rediss://default:redis-secret@cache.example:6379';
const config = { get: () => REDIS_URL } as unknown as ConfigService<Environment, true>;

describe('RedisService', () => {
  let client: FakeClient;
  let errors: ReturnType<typeof vi.spyOn>;
  let infos: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new FakeClient();
    created.client = client;
    errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    infos = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('connects to REDIS_URL with every command timed out, sent or not', () => {
    new RedisService(config);

    expect(created.options).toEqual({
      url: REDIS_URL,
      socket: { connectTimeout: COMMAND_TIMEOUT_MS },
      commandOptions: { timeout: COMMAND_TIMEOUT_MS, rejectInFlight: true },
    });
  });

  it('connects in the background when the application starts', () => {
    const service = new RedisService(config);

    service.onModuleInit();

    expect(client.connect).toHaveBeenCalledOnce();
  });

  it('answers PING while the first connection is being made, as node-redis queues it', async () => {
    const service = new RedisService(config);
    service.onModuleInit();

    await expect(service.ping()).resolves.toBeUndefined();
    expect(client.ping).toHaveBeenCalledOnce();
  });

  it('refuses commands at once after a connection failed, logging the failure once without the address', async () => {
    const service = new RedisService(config);
    client.emit('error', new Error(`connect ECONNREFUSED for ${REDIS_URL}`));
    client.emit('error', new Error('connect ECONNREFUSED'));

    await expect(service.ping()).rejects.toBeInstanceOf(RedisUnavailableError);
    await expect(service.run(() => Promise.resolve('never'))).rejects.toBeInstanceOf(
      RedisUnavailableError,
    );
    expect(client.ping).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledExactlyOnceWith(
      { error: { name: 'Error', message: 'connect ECONNREFUSED for [url]' } },
      'Redis connection failed',
    );
  });

  it('runs commands again once a connection is made again, logging that it is back', async () => {
    const service = new RedisService(config);
    client.emit('error', new Error('connect ECONNREFUSED'));
    client.emit('ready');

    await expect(service.ping()).resolves.toBeUndefined();
    expect(infos).toHaveBeenCalledExactlyOnceWith('Redis connection restored');
  });

  it('closes an open connection on shutdown, and leaves a closed one alone', () => {
    const service = new RedisService(config);
    service.onApplicationShutdown();
    expect(client.destroy).not.toHaveBeenCalled();

    service.onModuleInit();
    service.onApplicationShutdown();
    expect(client.destroy).toHaveBeenCalledOnce();
  });
});
