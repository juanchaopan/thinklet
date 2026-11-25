import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as client from 'openid-client';
import type { Environment } from '../../infrastructure/config/environment.js';
import { callbackUrl, endSessionUrl } from './end-session.js';

/** The scopes asked for: the parent's identity, name and email. */
const SCOPES = 'openid profile email';

/** How long each request to the identity provider may take, in seconds. */
const REQUEST_TIMEOUT_SECONDS = 10;

/** What the authorization request carries to tie the parent's return to this login. */
export interface AuthorizationRequest {
  state: string;
  nonce: string;
  codeChallenge: string;
}

/** What the callback is checked against: the values the login started with. */
export interface CallbackChecks {
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** The ID token of a completed login, and its validated claims. */
export interface CompletedLogin {
  idToken: string;
  claims: client.IDToken;
}

/**
 * openid-client refuses plain-HTTP endpoints unless told otherwise. Only an
 * issuer configured with plain HTTP (the mock provider of development and
 * tests) is allowed them; staging and production issuers use HTTPS.
 */
function transportFor(issuer: URL): Array<(configuration: client.Configuration) => void> {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- deprecated only as a warning sign; used for plain-HTTP issuers alone
  return issuer.protocol === 'http:' ? [client.allowInsecureRequests] : [];
}

/**
 * The OIDC client of the identity provider, through openid-client with
 * standard OIDC only: every endpoint comes from the issuer's discovery
 * document, which is read on first use and kept. The authorization code
 * flow uses PKCE (S256) and `client_secret_post`; the ID token's signature
 * is checked against the provider's published keys, besides its issuer,
 * audience, expiry and nonce.
 */
@Injectable()
export class OidcService {
  private readonly issuer: URL;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly appOrigin: string;
  private configuration: Promise<client.Configuration> | undefined;

  constructor(config: ConfigService<Environment, true>) {
    this.issuer = new URL(config.get('OIDC_ISSUER', { infer: true }));
    this.clientId = config.get('OIDC_CLIENT_ID', { infer: true });
    this.clientSecret = config.get('OIDC_CLIENT_SECRET', { infer: true });
    this.appOrigin = config.get('APP_ORIGIN', { infer: true });
  }

  /** The provider's authorization address for a new login. */
  async authorizationUrl({ state, nonce, codeChallenge }: AuthorizationRequest): Promise<string> {
    return client.buildAuthorizationUrl(await this.discover(), {
      redirect_uri: callbackUrl(this.appOrigin),
      scope: SCOPES,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }).href;
  }

  /**
   * Checks the callback's query against the login under way, exchanges its
   * code for the tokens and validates the ID token. Throws on an error from
   * the provider, a state or nonce that does not match, or a token that is
   * not valid.
   */
  async completeLogin(callbackQuery: string, checks: CallbackChecks): Promise<CompletedLogin> {
    const configuration = await this.discover();
    const currentUrl = new URL(callbackUrl(this.appOrigin));
    currentUrl.search = callbackQuery;
    const tokens = await client.authorizationCodeGrant(configuration, currentUrl, {
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      pkceCodeVerifier: checks.codeVerifier,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (tokens.id_token === undefined || claims === undefined) {
      throw new Error('The token response has no ID token');
    }
    return { idToken: tokens.id_token, claims };
  }

  /**
   * The issuer exactly as the provider's discovery document names it, which
   * is the `iss` of every ID token a login accepts and so the issuer every
   * parent is stored with. It can differ from OIDC_ISSUER as written: the
   * discovery accepts any issuer that is the same URL once normalised, so
   * an issuer configured without the slash after its host has the slash in
   * the document.
   */
  async issuerIdentifier(): Promise<string> {
    return (await this.discover()).serverMetadata().issuer;
  }

  /** The provider's logout address, with the ID token as a hint when there is one. */
  async endSessionUrl(idTokenHint: string | undefined): Promise<string> {
    return endSessionUrl(await this.discover(), {
      clientId: this.clientId,
      appOrigin: this.appOrigin,
      idTokenHint,
    });
  }

  /**
   * The client configuration from the discovery document. A failed discovery
   * is forgotten, so the next use tries again.
   */
  private discover(): Promise<client.Configuration> {
    if (this.configuration === undefined) {
      const discovery = client
        .discovery(
          this.issuer,
          this.clientId,
          undefined,
          client.ClientSecretPost(this.clientSecret),
          { execute: transportFor(this.issuer), timeout: REQUEST_TIMEOUT_SECONDS },
        )
        .then((configuration) => {
          client.enableNonRepudiationChecks(configuration);
          return configuration;
        });
      discovery.catch(() => {
        if (this.configuration === discovery) {
          this.configuration = undefined;
        }
      });
      this.configuration = discovery;
    }
    return this.configuration;
  }
}
