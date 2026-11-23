import type { Request } from 'express';
import { currentChildIdOf, setCurrentChildId } from './current-child.js';
import { currentParentIdOf, setCurrentParentId } from './current-parent.js';

describe.each([
  ['parent', setCurrentParentId, currentParentIdOf, 'The request has no signed-in parent'],
  ['child', setCurrentChildId, currentChildIdOf, 'The request has no signed-in child'],
] as const)('current %s', (kind, set, of, missing) => {
  it('reads what the login check recorded on the request', () => {
    const request = {} as Request;

    set(request, `${kind}-1`);

    expect(of(request)).toBe(`${kind}-1`);
  });

  it('keeps each request to its own value', () => {
    const first = {} as Request;
    const second = {} as Request;

    set(first, `${kind}-1`);
    set(second, `${kind}-2`);

    expect(of(first)).toBe(`${kind}-1`);
    expect(of(second)).toBe(`${kind}-2`);
  });

  it('fails on a request without one', () => {
    expect(() => of({} as Request)).toThrow(missing);
  });

  it('cannot be set through a request property named like it', () => {
    const request = {
      currentParentId: 'parent-1',
      currentChildId: 'child-1',
    } as unknown as Request;

    expect(() => of(request)).toThrow(missing);
  });
});

it('keeps the signed-in parent and the signed-in child apart', () => {
  const request = {} as Request;

  setCurrentParentId(request, 'parent-1');

  expect(() => currentChildIdOf(request)).toThrow('The request has no signed-in child');
});
