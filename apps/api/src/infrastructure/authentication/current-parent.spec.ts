import type { Request } from 'express';
import { currentParentIdOf, setCurrentParentId } from './current-parent.js';

describe('current parent', () => {
  it('reads the parent the login check recorded on the request', () => {
    const request = {} as Request;

    setCurrentParentId(request, 'parent-1');

    expect(currentParentIdOf(request)).toBe('parent-1');
  });

  it('fails on a request without a signed-in parent', () => {
    expect(() => currentParentIdOf({} as Request)).toThrow('The request has no signed-in parent');
  });

  it('cannot be set through a request property named like it', () => {
    const request = { currentParentId: 'parent-1' } as unknown as Request;

    expect(() => currentParentIdOf(request)).toThrow();
  });
});
