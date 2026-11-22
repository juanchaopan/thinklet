import { buildEndSessionUrl, type Configuration } from 'openid-client';

/** What the identity provider's logout address is built from. */
export interface EndSession {
  clientId: string;
  /** The site's origin; the provider sends the browser back to its home page. */
  appOrigin: string;
  /** The ID token of the login, when the browser still has it. */
  idTokenHint?: string | undefined;
}

/** The address the identity provider sends the parent to after its login: this site's callback route. */
export function callbackUrl(appOrigin: string): string {
  return `${appOrigin}/api/auth/callback`;
}

/**
 * The identity provider's logout address from its discovery document
 * (`end_session_endpoint`), with the client id, the site's home page to
 * return to, and the ID token as `id_token_hint` when there is one. Without
 * the hint some providers (Authing among them) end the logout on their own
 * page instead of returning.
 */
export function endSessionUrl(
  configuration: Configuration,
  { clientId, appOrigin, idTokenHint }: EndSession,
): string {
  const parameters: Record<string, string> = {
    client_id: clientId,
    post_logout_redirect_uri: `${appOrigin}/`,
  };
  if (idTokenHint !== undefined) {
    parameters['id_token_hint'] = idTokenHint;
  }
  return buildEndSessionUrl(configuration, parameters).href;
}
