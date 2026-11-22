import { expect, type APIRequestContext } from '@playwright/test';

/** The OIDC provider the site under test signs in through, and the site's client id there. */
export interface IdentityProvider {
  issuer: string;
  clientId: string;
}

/**
 * The identity provider named by `TEST_OIDC_ISSUER` and `TEST_OIDC_CLIENT_ID`,
 * or undefined when the run names none. `task test-e2e` sets both to its mock
 * provider and the deployment to the target's own provider. They are not the
 * api's `OIDC_*` variables, so a local `.env` never decides what a deployed
 * site is checked against.
 */
export function configuredIdentityProvider(): IdentityProvider | undefined {
  const issuer = process.env['TEST_OIDC_ISSUER'];
  const clientId = process.env['TEST_OIDC_CLIENT_ID'];
  return issuer && clientId ? { issuer, clientId } : undefined;
}

/** The configured identity provider, for tests that cannot run without one. */
export function requireIdentityProvider(): IdentityProvider {
  const provider = configuredIdentityProvider();
  if (!provider) {
    throw new Error('Set TEST_OIDC_ISSUER and TEST_OIDC_CLIENT_ID (task test-e2e sets them)');
  }
  return provider;
}

/** Where the provider's discovery document sends a login and a logout. */
export interface ProviderEndpoints {
  authorization: string;
  endSession: string | undefined;
}

/**
 * Reads the provider's endpoints from its discovery document, as the api
 * does. Only the public discovery document is read; nobody signs in.
 */
export async function providerEndpoints(
  request: APIRequestContext,
  issuer: string,
): Promise<ProviderEndpoints> {
  const response = await request.get(
    `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
  );
  expect(response.status()).toBe(200);
  const discovery = (await response.json()) as {
    authorization_endpoint: string;
    end_session_endpoint?: string;
  };
  return {
    authorization: discovery.authorization_endpoint,
    endSession: discovery.end_session_endpoint,
  };
}

/** The address without its query, to compare with an endpoint. */
export function endpointOf(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

/**
 * Checks that a login was sent to the configured provider's authorization
 * endpoint with the site's client id there. A run that names no provider
 * has nothing to compare with, so this checks nothing then.
 */
export async function expectConfiguredAuthorization(
  request: APIRequestContext,
  location: URL,
): Promise<void> {
  const provider = configuredIdentityProvider();
  if (!provider) {
    return;
  }
  const { authorization } = await providerEndpoints(request, provider.issuer);
  expect(endpointOf(location)).toBe(authorization);
  expect(location.searchParams.get('client_id')).toBe(provider.clientId);
}
