import { HttpAdapterHost } from '@nestjs/core';
import type { Express } from 'express';
import { createApp } from './create-app.js';

// Entry point of the Vercel function: the platform imports this module and
// passes every request to its default export, the Express instance under the
// initialized Nest application. It is the only Vercel-specific code.
const app = await createApp();
await app.init();

const server: Express = app.get(HttpAdapterHost).httpAdapter.getInstance();
export default server;
