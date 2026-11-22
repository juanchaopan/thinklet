import { safeReturnTo } from './return-to.js';

describe('safeReturnTo', () => {
  it.each([
    '/',
    '/profile',
    '/families/5d1e/members?tab=new#top',
    '/join/7KQ4MZ',
    '/%2F%2Fevil.example',
    '/a//b',
  ])('keeps the path %s of this site', (path) => {
    expect(safeReturnTo(path)).toBe(path);
  });

  it.each([
    ['nothing', undefined],
    ['an empty value', ''],
    ['several values', ['/a', '/b']],
    ['a number', 42],
    ['a relative path', 'profile'],
    ['a protocol-relative URL', '//evil.example'],
    ['a protocol-relative URL with a path', '//evil.example/profile'],
    ['a backslash after the slash', '/\\evil.example'],
    ['a backslash later in the path', '/profile\\..\\x'],
    ['an absolute URL', 'https://evil.example/'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,<script>alert(1)</script>'],
    ['a tab that browsers strip', '/\t/evil.example'],
    ['a newline', '/profile\nSet-Cookie: x=y'],
    ['a null character', '/profile\u0000'],
    ['a delete character', '/profile\u007f'],
    ['a value longer than 2000 characters', `/${'a'.repeat(2_000)}`],
  ])('falls back to / for %s', (_name, value) => {
    expect(safeReturnTo(value)).toBe('/');
  });
});
