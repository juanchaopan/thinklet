import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** A value the login check records on a request for the handlers to read. */
export interface RequestSlot<T> {
  /** Records the value on the request. */
  set: (request: Request, value: T) => void;
  /** The recorded value; fails when the request has none. */
  of: (request: Request) => T;
  /** Handler parameter decorator for the recorded value. */
  param: () => ParameterDecorator;
}

/**
 * A slot for one value per request. The values live in a WeakMap keyed by
 * the request rather than on the request object, so no request property,
 * header or body can set one, and they go with the request. Reading a
 * request that has none is a programming error (a route that skipped the
 * login check) and fails with the given message.
 */
export function requestSlot<T>(missingMessage: string): RequestSlot<T> {
  const values = new WeakMap<Request, T>();
  const of = (request: Request): T => {
    if (!values.has(request)) {
      throw new Error(missingMessage);
    }
    return values.get(request) as T;
  };
  return {
    set: (request, value) => {
      values.set(request, value);
    },
    of,
    param: createParamDecorator((_data: unknown, context: ExecutionContext): T =>
      of(context.switchToHttp().getRequest<Request>()),
    ),
  };
}
