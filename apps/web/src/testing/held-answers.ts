import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { http } from 'msw';
import { worker } from './network';
import { nextFrames } from './pointer';

/** An api answer that a slow server holds back until the test lets it go. */
export interface HeldAnswer {
  /** Resolves once the request has reached the server. */
  readonly reached: Promise<void>;
  /** Sends the answer and resolves once the app has handled it and shown the result. */
  release(): Promise<void>;
}

/** A promise with the function that resolves it. */
function gate(): { readonly passed: Promise<void>; open(): void } {
  let resolve: (() => void) | undefined;
  const passed = new Promise<void>((done) => {
    resolve = done;
  });
  return { passed, open: () => resolve?.() };
}

/**
 * Holds back the answer to the next request of the method to the path,
 * which then answers with `answer`, given the request; later requests go to
 * the stubs added before. A test must release every answer it holds, since
 * the app is not settled while one is still on its way.
 */
export function holdNext(
  method: 'get' | 'post',
  path: string,
  answer: (request: Request) => Response | Promise<Response>,
): HeldAnswer {
  const reached = gate();
  const released = gate();
  worker.use(
    http[method](
      path,
      async ({ request }) => {
        reached.open();
        await released.passed;
        return answer(request);
      },
      { once: true },
    ),
  );
  return {
    reached: reached.passed,
    release: async () => {
      released.open();
      await TestBed.inject(ApplicationRef).whenStable();
      await nextFrames();
    },
  };
}

/** Holds back the answer to the next `GET` of the path (see holdNext). */
export function holdNextGet(
  path: string,
  answer: (request: Request) => Response | Promise<Response>,
): HeldAnswer {
  return holdNext('get', path, answer);
}
