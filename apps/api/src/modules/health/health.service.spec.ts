import { Logger } from '@nestjs/common';
import type { StorageService } from '../../infrastructure/storage/storage.service.js';
import type { HealthRepository } from './health.repository.js';
import { CHECK_TIMEOUT_MS, HealthService } from './health.service.js';

const never = () => new Promise<void>(() => {});
const after = (ms: number) => () => new Promise<void>((resolve) => setTimeout(resolve, ms));

function createService(
  ping: () => Promise<void>,
  checkBucket: (signal: AbortSignal) => Promise<void>,
) {
  const repository = { ping: vi.fn(ping) } as unknown as HealthRepository;
  const storage = { checkBucket: vi.fn(checkBucket) } as unknown as StorageService;
  return new HealthService(repository, storage);
}

describe('HealthService', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports ok when the database and the bucket both answer', async () => {
    const service = createService(
      () => Promise.resolve(),
      () => Promise.resolve(),
    );

    await expect(service.check()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'ok', storage: 'ok' },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('marks the database when its check fails', async () => {
    const service = createService(
      () => Promise.reject(new Error('connect ECONNREFUSED')),
      () => Promise.resolve(),
    );

    await expect(service.check()).resolves.toEqual({
      status: 'error',
      checks: { database: 'error', storage: 'ok' },
    });
  });

  it('marks the storage when its check fails', async () => {
    const service = createService(
      () => Promise.resolve(),
      () => Promise.reject(new Error('NotFound')),
    );

    await expect(service.check()).resolves.toEqual({
      status: 'error',
      checks: { database: 'ok', storage: 'error' },
    });
  });

  it('marks both when both checks fail', async () => {
    const service = createService(
      () => Promise.reject(new Error('down')),
      () => Promise.reject(new Error('down')),
    );

    await expect(service.check()).resolves.toEqual({
      status: 'error',
      checks: { database: 'error', storage: 'error' },
    });
  });

  it('runs both checks in parallel', async () => {
    vi.useFakeTimers();
    const service = createService(after(CHECK_TIMEOUT_MS - 1), after(CHECK_TIMEOUT_MS - 1));

    const result = service.check();
    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS - 1);

    await expect(result).resolves.toMatchObject({ status: 'ok' });
  });

  it('fails a check that takes longer than the timeout and aborts it', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const service = createService(never, (received) => {
      signal = received;
      return never();
    });

    const result = service.check();
    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);

    await expect(result).resolves.toEqual({
      status: 'error',
      checks: { database: 'error', storage: 'error' },
    });
    expect(signal?.aborted).toBe(true);
  });

  it('does not fail a check that answers just before the timeout', async () => {
    vi.useFakeTimers();
    const service = createService(after(CHECK_TIMEOUT_MS - 1), () => Promise.resolve());

    const result = service.check();
    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);

    await expect(result).resolves.toMatchObject({ checks: { database: 'ok' } });
  });

  it('logs the failed check and the cause without URLs', async () => {
    const service = createService(
      () => Promise.reject(new Error('cannot reach postgresql://user:secret@host/db')),
      () => Promise.resolve(),
    );

    await service.check();

    expect(warn).toHaveBeenCalledWith(
      { check: 'database', error: { name: 'Error', message: 'cannot reach [url]' } },
      'Health check failed',
    );
  });

  it('logs a timeout as the cause', async () => {
    vi.useFakeTimers();
    const service = createService(() => Promise.resolve(), never);

    const result = service.check();
    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
    await result;

    expect(warn).toHaveBeenCalledWith(
      {
        check: 'storage',
        error: { name: 'CheckTimeoutError', message: `No answer within ${CHECK_TIMEOUT_MS} ms` },
      },
      'Health check failed',
    );
  });
});
