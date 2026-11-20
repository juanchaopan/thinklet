import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WEB_SECURITY_HEADERS } from './security-headers.ts';

// Writes apps/web/vercel.json for the `thinklet-web` Vercel project before it
// is built and deployed: the static Angular output, `/api/*` forwarded to the
// api at API_ORIGIN, every other path served by index.html so the router
// handles it, and the web security headers on everything outside `/api`.
// vercel.json cannot read environment variables, so the file is generated
// here and never committed.
//
//   API_ORIGIN=https://api.example.com node scripts/write-vercel-config.ts [output file]

const DEFAULT_OUTPUT = fileURLToPath(new URL('../vercel.json', import.meta.url));

/**
 * Every request path except `/api` and `/api/...`, in Vercel's path-to-regexp
 * `source` syntax (matched case-sensitively against the whole path). Those
 * responses come from the api through the rewrite with the api's own security
 * headers, which the web's must not be added to. The lookahead ends at `/` or
 * the end of the path, so a page such as `/apiary` still gets the headers.
 */
export const OUTSIDE_API_SOURCE = '/((?!api(?:/|$)).*)';

/** Returns the origin in API_ORIGIN, or throws naming what is wrong with it. */
export function parseApiOrigin(value: string | undefined): string {
  if (!value) {
    throw new Error(
      'API_ORIGIN is not set; set it to the api origin, e.g. https://api.example.com',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`API_ORIGIN is not a URL: ${value}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`API_ORIGIN must use https or http: ${value}`);
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
      `API_ORIGIN must be an origin only, without a path, query or credentials: ${value}`,
    );
  }
  return url.origin;
}

/** The Vercel project configuration that forwards `/api/*` to `apiOrigin`. */
export function vercelConfig(apiOrigin: string) {
  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    framework: null,
    buildCommand: 'pnpm --filter web... run build',
    outputDirectory: 'dist/web/browser',
    rewrites: [
      { source: '/api/:path*', destination: `${apiOrigin}/api/:path*` },
      { source: '/(.*)', destination: '/index.html' },
    ],
    headers: [
      {
        source: OUTSIDE_API_SOURCE,
        headers: Object.entries(WEB_SECURITY_HEADERS).map(([key, value]) => ({ key, value })),
      },
    ],
  };
}

/** Writes the configuration for API_ORIGIN; returns the exit code. */
export async function main(
  environment: Record<string, string | undefined>,
  outputFile: string = DEFAULT_OUTPUT,
): Promise<number> {
  try {
    const config = vercelConfig(parseApiOrigin(environment['API_ORIGIN']));
    await writeFile(outputFile, `${JSON.stringify(config, null, 2)}\n`);
    return 0;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.env, process.argv[2]);
}
