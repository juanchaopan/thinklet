import { randomBytes } from 'node:crypto';

// `task child-data-key`: prints a new CHILD_DATA_KEY, 32 random bytes in
// standard base64, as a line to put into .env. The key is made on this
// machine and written only to standard output. It is for local development;
// every environment has a key of its own.

console.log(`CHILD_DATA_KEY=${randomBytes(32).toString('base64')}`);
