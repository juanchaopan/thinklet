import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';

// A self-signed TLS certificate for the loopback, made with nothing but
// Node.js: its crypto makes keys and signatures but no certificates, so the
// few DER structures of an X.509 certificate are written out here.

/** A private key and its certificate, both PEM, as `https.createServer` takes them. */
export interface TlsCredentials {
  key: string;
  cert: string;
}

/** How long the certificate is valid on either side of now, generous for any clock skew. */
const VALIDITY_MS = 24 * 60 * 60 * 1000;

/** The object identifiers the certificate uses. */
const OID = {
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
  commonName: '2.5.4.3',
  subjectAltName: '2.5.29.17',
};

/** A DER length: short form below 128, long form above. */
function length(size: number): Buffer {
  if (size < 0x80) {
    return Buffer.from([size]);
  }
  const bytes: number[] = [];
  for (let rest = size; rest > 0; rest = Math.floor(rest / 0x100)) {
    bytes.unshift(rest % 0x100);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** A DER element with this tag around these contents. */
function element(tag: number, ...contents: Buffer[]): Buffer {
  const body = Buffer.concat(contents);
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
}

const sequence = (...contents: Buffer[]) => element(0x30, ...contents);
const set = (...contents: Buffer[]) => element(0x31, ...contents);

/** A non-negative INTEGER from big-endian bytes, with a leading zero when the top bit is set. */
function integer(bytes: Buffer): Buffer {
  const negative = bytes.readUInt8(0) >= 0x80;
  return element(0x02, negative ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
}

/** An OBJECT IDENTIFIER from its dotted form, each arc after the first two in base 128. */
function objectIdentifier(dotted: string): Buffer {
  const [first = 0, second = 0, ...rest] = dotted.split('.').map(Number);
  const bytes = [first * 40 + second];
  for (const arc of rest) {
    const groups = [arc % 0x80];
    for (let high = Math.floor(arc / 0x80); high > 0; high = Math.floor(high / 0x80)) {
      groups.unshift(0x80 | (high % 0x80));
    }
    bytes.push(...groups);
  }
  return element(0x06, Buffer.from(bytes));
}

/** A UTCTime, `YYMMDDHHMMSSZ`, which covers the years 1950 to 2049. */
function utcTime(date: Date): Buffer {
  const text = date.toISOString().replace(/[-:T]/g, '').slice(2, 14);
  return element(0x17, Buffer.from(`${text}Z`, 'ascii'));
}

/** A name with only a common name. */
function name(commonName: string): Buffer {
  return sequence(
    set(sequence(objectIdentifier(OID.commonName), element(0x0c, Buffer.from(commonName)))),
  );
}

/**
 * A new P-256 key and a certificate for `localhost` and `127.0.0.1`, signed
 * by that key and valid for a day either side of now. Browsers do not trust
 * it, so a client of a server using it must ignore certificate errors.
 */
export function loopbackCertificate(): TlsCredentials {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const signatureAlgorithm = sequence(objectIdentifier(OID.ecdsaWithSha256));
  // A positive serial number of at most 16 bytes, as RFC 5280 asks.
  const serial = randomBytes(16);
  serial.writeUInt8(serial.readUInt8(0) & 0x7f, 0);
  const now = Date.now();
  const subject = name('localhost');
  const alternativeNames = sequence(
    element(0x82, Buffer.from('localhost', 'ascii')),
    element(0x87, Buffer.from([127, 0, 0, 1])),
  );
  const toBeSigned = sequence(
    element(0xa0, integer(Buffer.from([2]))),
    integer(serial),
    signatureAlgorithm,
    subject,
    sequence(utcTime(new Date(now - VALIDITY_MS)), utcTime(new Date(now + VALIDITY_MS))),
    subject,
    publicKey.export({ type: 'spki', format: 'der' }),
    element(
      0xa3,
      sequence(sequence(objectIdentifier(OID.subjectAltName), element(0x04, alternativeNames))),
    ),
  );
  const signature = sign('sha256', toBeSigned, privateKey);
  const certificate = sequence(
    toBeSigned,
    signatureAlgorithm,
    element(0x03, Buffer.from([0]), signature),
  );
  const lines = certificate.toString('base64').match(/.{1,64}/g) ?? [];
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    cert: ['-----BEGIN CERTIFICATE-----', ...lines, '-----END CERTIFICATE-----', ''].join('\n'),
  };
}
