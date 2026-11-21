import * as z from 'zod';

// The schemas check values without compiling them into generated functions.
// Zod otherwise probes for `new Function` when a schema is built, which the
// web app's Content Security Policy (no 'unsafe-eval') reports as a
// violation. The index imports this module first, so the setting is in
// place before any schema exists.
z.config({ jitless: true });
