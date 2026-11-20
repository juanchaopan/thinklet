import { ConfigService } from '@nestjs/config';
import { createApp } from './create-app.js';
import type { Environment } from './infrastructure/config/environment.js';

// Entry point of the long-running process (development, CI and any server).
// It does not import @nestjs/core itself, so Vercel's entry detection, which
// takes the first of src/main, src/app, src/index and src/server that imports
// @nestjs/core, picks server.ts instead.
const app = await createApp();
app.enableShutdownHooks();
await app.listen(app.get(ConfigService<Environment, true>).get('PORT', { infer: true }));
