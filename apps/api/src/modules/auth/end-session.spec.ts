import { Configuration } from 'openid-client';
import { callbackUrl, endSessionUrl } from './end-session.js';

const configuration = new Configuration(
  {
    issuer: 'https://idp.example.com/oidc',
    end_session_endpoint: 'https://idp.example.com/oidc/session/end',
  },
  'client-1',
);

describe('callbackUrl', () => {
  it('is the callback route under the site origin', () => {
    expect(callbackUrl('https://app.example.com')).toBe(
      'https://app.example.com/api/auth/callback',
    );
  });
});

describe('endSessionUrl', () => {
  it('goes to the end_session_endpoint with the client id, the home page and the ID token', () => {
    const url = new URL(
      endSessionUrl(configuration, {
        clientId: 'client-1',
        appOrigin: 'https://app.example.com',
        idTokenHint: 'id-token-1',
      }),
    );

    expect(url.origin + url.pathname).toBe('https://idp.example.com/oidc/session/end');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-1',
      post_logout_redirect_uri: 'https://app.example.com/',
      id_token_hint: 'id-token-1',
    });
  });

  it('leaves out the hint when there is no ID token', () => {
    const url = new URL(
      endSessionUrl(configuration, { clientId: 'client-1', appOrigin: 'https://app.example.com' }),
    );

    expect(url.searchParams.has('id_token_hint')).toBe(false);
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://app.example.com/');
  });

  it('fails when the provider publishes no end_session_endpoint', () => {
    const withoutLogout = new Configuration({ issuer: 'https://idp.example.com' }, 'client-1');

    expect(() =>
      endSessionUrl(withoutLogout, { clientId: 'client-1', appOrigin: 'https://app.example.com' }),
    ).toThrow();
  });
});
