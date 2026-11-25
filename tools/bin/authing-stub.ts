import { startAuthingStub } from '../../apps/api/test/support/authing-stub.ts';

// `task dev` runs this to play Authing's management API and webhook on the
// development machine with the stand-in the tests use. It listens on
// AUTHING_STUB_PORT, accepts the user pool id and secret of the local .env,
// and reports every deletion a second later to the api's webhook at
// API_ORIGIN with AUTHING_WEBHOOK_SECRET, as Authing reports one after it
// is done.

/** How long after a deletion it is reported, so the api has finished its own deletion first. */
const REPORT_DELAY_MS = 1_000;

/** The value of a variable the stand-in cannot start without. */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set; copy it from .env.example to .env`);
  }
  return value;
}

const stub = await startAuthingStub({
  port: Number(required('AUTHING_STUB_PORT')),
  userPoolId: required('AUTHING_USER_POOL_ID'),
  userPoolSecret: required('AUTHING_USER_POOL_SECRET'),
  webhookSecret: required('AUTHING_WEBHOOK_SECRET'),
  webhookUrl: new URL('/api/webhooks/authing', required('API_ORIGIN')).toString(),
  delivery: REPORT_DELAY_MS,
});
console.log(`Authing stand-in listening on ${stub.origin}`);

const stop = () => {
  void stub.close().then(() => process.exit(0));
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
