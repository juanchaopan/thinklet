import { HttpStatus, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host.js';
import type { Request, Response } from 'express';
import { ChildRoute } from '../../infrastructure/authentication/child-route.decorator.js';
import { ParentOrChildRoute } from '../../infrastructure/authentication/parent-or-child-route.decorator.js';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import type {
  ChildSession,
  ChildSessionCheck,
  ChildSessionService,
} from '../auth/child-session.service.js';
import type { ParentSessionService } from '../auth/parent-session.service.js';
import type { ChildService } from '../child/child.service.js';
import { BookReaderGuard } from './book-reader.guard.js';

@ChildRoute()
class ChildBooksController {}

@ParentOrChildRoute()
class CoversController {}

/** The route handler; the guard reads only the metadata of the controller here. */
function handler(): void {}

const SESSION: ChildSession = {
  childId: 'child-1',
  issuedAt: new Date('2026-11-23T08:00:00Z'),
  expiresAt: new Date('2026-11-30T08:00:00Z'),
};

/** The database's time at which the child module finds a current login current. */
const CHECKED_AT = new Date('2026-11-23T09:00:00Z');

/** Whether a parent is signed in, and the child login the browser has: current, stale or none. */
interface Browser {
  parent: boolean;
  child: 'current' | 'stale' | 'none';
}

/**
 * The guard over doubles of the login checks: the auth module's parent
 * check, and its child check, which asks the child module whether the
 * verified login still counts.
 */
function setUp({ parent, child }: Browser) {
  const request = {} as Request;
  const response = {} as Response;
  const parentSessions = { authenticate: vi.fn(() => Promise.resolve(parent)) };
  const childSessions = {
    authenticate: vi.fn(
      async (_request: Request, _response: Response, currentAt: ChildSessionCheck) => {
        if (child === 'none' || (await currentAt(SESSION)) === undefined) {
          throw new ApiError('unauthenticated', HttpStatus.UNAUTHORIZED);
        }
      },
    ),
  };
  const childService = {
    currentAt: vi.fn(() => Promise.resolve(child === 'current' ? CHECKED_AT : undefined)),
  };
  const guard = new BookReaderGuard(
    new Reflector(),
    parentSessions as unknown as ParentSessionService,
    childSessions as unknown as ChildSessionService,
    childService as unknown as ChildService,
  );
  const routeOf = (controller: Type) =>
    guard.canActivate(new ExecutionContextHost([request, response], controller, handler));
  return {
    request,
    response,
    parentSessions,
    childSessions,
    childService,
    childBooks: () => routeOf(ChildBooksController),
    covers: () => routeOf(CoversController),
  };
}

describe('BookReaderGuard', () => {
  describe("on the child's own routes", () => {
    it('lets a child through whom the child module confirms', async () => {
      const { childBooks, childSessions, childService, request, response } = setUp({
        parent: false,
        child: 'current',
      });

      await expect(childBooks()).resolves.toBe(true);
      expect(childSessions.authenticate).toHaveBeenCalledWith(
        request,
        response,
        expect.any(Function),
      );
      expect(childService.currentAt).toHaveBeenCalledWith(SESSION);
    });

    it('never asks for a parent, so a parent login opens nothing', async () => {
      const { childBooks, parentSessions } = setUp({ parent: true, child: 'none' });

      await expect(childBooks()).rejects.toMatchObject({ code: 'unauthenticated' });
      expect(parentSessions.authenticate).not.toHaveBeenCalled();
    });

    it.each(['stale', 'none'] as const)('refuses a %s child login', async (child) => {
      const { childBooks } = setUp({ parent: false, child });

      await expect(childBooks()).rejects.toMatchObject({ code: 'unauthenticated' });
    });
  });

  describe('on the routes for a parent or a child', () => {
    it('lets a signed-in parent through without asking for a child', async () => {
      const { covers, childSessions } = setUp({ parent: true, child: 'none' });

      await expect(covers()).resolves.toBe(true);
      expect(childSessions.authenticate).not.toHaveBeenCalled();
    });

    it('lets a signed-in child through when no parent is signed in', async () => {
      const { covers, parentSessions } = setUp({ parent: false, child: 'current' });

      await expect(covers()).resolves.toBe(true);
      expect(parentSessions.authenticate).toHaveBeenCalledTimes(1);
    });

    it.each(['stale', 'none'] as const)(
      'refuses a browser with no parent and a %s child login',
      async (child) => {
        const { covers } = setUp({ parent: false, child });

        await expect(covers()).rejects.toMatchObject({ code: 'unauthenticated' });
      },
    );
  });
});
