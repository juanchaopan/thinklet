import type { INestApplicationContext, Logger, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { describeError } from '../logging/describe-error.js';

/** A class of errors whose messages a command may log as they are. */
type SafeError = abstract new (...args: never[]) => Error;

export interface Command {
  /** The module the command runs on: only what its work needs. */
  module: Type<unknown>;
  logger: Logger;
  /** What the logged failure starts with, such as "Cover import failed." */
  failure: string;
  /** Errors written to name nothing secret, logged with their own message. */
  safeErrors: readonly SafeError[];
  /** The work, on the started context; the context is closed when it ends. */
  work: (context: INestApplicationContext) => Promise<void>;
}

/** A failure as one line: a safe error's message, else its name, code and safe message. */
function failureMessage(error: unknown, safeErrors: readonly SafeError[]): string {
  if (error instanceof Error && safeErrors.some((safe) => error instanceof safe)) {
    return error.message;
  }
  const { name, code, message } = describeError(error);
  return `${name}${code === undefined ? '' : ` (${code})`}: ${message}`;
}

/**
 * Runs a command of the api, such as the cover import or the data
 * migrations: starts a Nest application context of its module, runs the
 * work and closes the context. When anything fails, it logs one line and
 * sets a non-zero exit code. That line holds no configured value: other
 * than the safe errors, an error is described through describeError, which
 * leaves out URLs and database messages.
 */
export async function runCommand(command: Command): Promise<void> {
  try {
    // abortOnError off: a failure while starting is thrown to the catch below
    // instead of aborting the process, so it gets the same exit code.
    const context = await NestFactory.createApplicationContext(command.module, {
      abortOnError: false,
      logger: ['fatal', 'error', 'warn', 'log'],
    });
    try {
      await command.work(context);
    } finally {
      await context.close();
    }
  } catch (error) {
    command.logger.error(`${command.failure} ${failureMessage(error, command.safeErrors)}`);
    process.exitCode = 1;
  }
}
