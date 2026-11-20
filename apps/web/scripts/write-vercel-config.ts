import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Writes apps/web/vercel.json for the `thinklet-web` Vercel project before it
// is built and deployed: the static Angular output, `/api/*` forwarded to the
// api at API_ORIGIN, and every other path served by index.html so the
// router handles it. vercel.json cannot read environment variables, so the
// file is generated here and never committed.
//
//   API_ORIGIN=https://api.example.com node scripts/write-vercel-config.ts [output file]

const DEFAULT_OUTPUT = fileURLToPath(new URL('../vercel.json', import.meta.url));

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
