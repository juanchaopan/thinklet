import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair } from 'jose';

// `task jwt-key`: prints a new ES256 private key as a JWK with a key id, in
// the form JWT_SIGNING_KEY takes, as a line to put into .env. The key is made
// on this machine and written only to standard output. It is for local
// development; every environment has a key of its own.

const { privateKey } = await generateKeyPair('ES256', { extractable: true });
const jwk = { ...(await exportJWK(privateKey)), kid: randomUUID(), alg: 'ES256' };

// Single quotes keep the JSON as it is for both Task's and Docker Compose's
// .env readers.
console.log(`JWT_SIGNING_KEY='${JSON.stringify(jwk)}'`);
