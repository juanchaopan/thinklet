import { Injectable, Module, type Logger, type OnApplicationShutdown } from '@nestjs/common';
import { runCommand, type Command } from './run-command.js';

/** An error whose message a command may log as it is. */
class SafeFailure extends Error {}

/** Records whether the context it lives in was closed. */
@Injectable()
class Lifecycle implements OnApplicationShutdown {
  static closed = false;

  onApplicationShutdown(): void {
    Lifecycle.closed = true;
  }
}

@Module({ providers: [Lifecycle] })
class CommandModule {}

@Module({
  providers: [
    {
      provide: 'broken',
      useFactory: () => {
        throw new Error('cannot reach postgresql://owner:secret@db.example/app');
      },
    },
  ],
})
class BrokenModule {}

describe('runCommand', () => {
  const error = vi.fn();
  const logger = { error } as unknown as Logger;

  const run = (command: Partial<Command>) =>
    runCommand({
      module: CommandModule,
      logger,
      failure: 'Command failed.',
      safeErrors: [SafeFailure],
      work: () => Promise.resolve(),
      ...command,
    });

  beforeEach(() => {
    Lifecycle.closed = false;
    error.mockReset();
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('runs the work on the started context and closes it', async () => {
    const work = vi.fn((context: { get: (token: typeof Lifecycle) => Lifecycle }) => {
      expect(context.get(Lifecycle)).toBeInstanceOf(Lifecycle);
      return Promise.resolve();
    });

    await run({ work });

    expect(work).toHaveBeenCalledOnce();
    expect(Lifecycle.closed).toBe(true);
    expect(error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("logs a safe error's own message, closes the context and exits with a non-zero code", async () => {
    await run({ work: () => Promise.reject(new SafeFailure('Migration 0002 has changed')) });

    expect(error).toHaveBeenCalledExactlyOnceWith('Command failed. Migration 0002 has changed');
    expect(Lifecycle.closed).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('logs any other error without the address in its message', async () => {
    await run({
      work: () => Promise.reject(new TypeError('fetch https://user:pass@storage.example failed')),
    });

    const [line] = error.mock.calls[0] as [string];
    expect(line).toMatch(/^Command failed\. TypeError: /);
    expect(line).not.toContain('user:pass');
    expect(process.exitCode).toBe(1);
  });

  it('logs a failure while starting the same way', async () => {
    await run({ module: BrokenModule });

    const [line] = error.mock.calls[0] as [string];
    expect(line).toMatch(/^Command failed\. /);
    expect(line).not.toContain('secret');
    expect(process.exitCode).toBe(1);
  });
});
