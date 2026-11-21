import { loginUrl, safeReturnTo } from './login';

describe('loginUrl', () => {
  it('starts signing in at the api', () => {
    expect(loginUrl()).toBe('/api/auth/login');
  });

  it('comes back to a page of this site', () => {
    expect(loginUrl('/profile?tab=1')).toBe('/api/auth/login?returnTo=%2Fprofile%3Ftab%3D1');
  });

  it.each(['https://evil.example/', '//evil.example', '/\\evil.example', 'profile', ''])(
    'drops %s as a page to come back to',
    (value) => {
      expect(safeReturnTo(value)).toBeUndefined();
      expect(loginUrl(value)).toBe('/api/auth/login');
    },
  );
});
