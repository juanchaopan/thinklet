import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../infrastructure/config/environment.js';
import { OidcService } from './oidc.service.js';

/**
 * A provider on this machine that serves only its discovery document, at
 * the host's root, naming as its issuer whatever `issuerOf` makes of the
 * provider's origin.
 */
async function providerAtRoot(issuerOf: (origin: string) => string) {
  const server: Server = createServer((request, response) => {
    if (request.url !== '/.well-known/openid-configuration') {
      response.writeHead(404).end();
      return;
    }
    const issuer = issuerOf(origin());
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        issuer,
        authorization_endpoint: `${origin()}/authorize`,
        token_endpoint: `${origin()}/token`,
        jwks_uri: `${origin()}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
      }),
    );
  });
  const origin = () => `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { origin: origin(), close: () => new Promise((resolve) => server.close(resolve)) };
}

function serviceFor(issuer: string): OidcService {
  const values: Partial<Environment> = {
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: 'thinklet-test',
    OIDC_CLIENT_SECRET: 'test-client-secret',
    APP_ORIGIN: 'http://127.0.0.1:5173',
  };
  return new OidcService({
    get: (name: keyof Environment) => values[name],
  } as unknown as ConfigService<Environment, true>);
}

describe('OidcService', () => {
  describe('issuerIdentifier', () => {
    it("is the discovery document's issuer, with its slash, for an issuer configured without the slash after its host", async () => {
      const provider = await providerAtRoot((origin) => `${origin}/`);
      try {
        await expect(serviceFor(provider.origin).issuerIdentifier()).resolves.toBe(
          `${provider.origin}/`,
        );
      } finally {
        await provider.close();
      }
    });

    it("is the discovery document's issuer, without a slash, for an issuer configured with the slash", async () => {
      const provider = await providerAtRoot((origin) => origin);
      try {
        await expect(serviceFor(`${provider.origin}/`).issuerIdentifier()).resolves.toBe(
          provider.origin,
        );
      } finally {
        await provider.close();
      }
    });
  });
});
