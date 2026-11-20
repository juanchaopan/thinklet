import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, parseApiOrigin, vercelConfig } from './write-vercel-config.ts';

describe('parseApiOrigin', () => {
  it.each([
    ['https://thinklet-api.vercel.app', 'https://thinklet-api.vercel.app'],
    ['https://thinklet-api.vercel.app/', 'https://thinklet-api.vercel.app'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['HTTPS://API.Example.com:8443', 'https://api.example.com:8443'],
  ])('accepts %s as %s', (value, origin) => {
    expect(parseApiOrigin(value)).toBe(origin);
  });

  it.each([
    [undefined, 'API_ORIGIN is not set'],
    ['', 'API_ORIGIN is not set'],
    ['thinklet-api.vercel.app', 'API_ORIGIN is not a URL'],
    ['ftp://api.example.com', 'API_ORIGIN must use https or http'],
    ['https://api.example.com/api', 'API_ORIGIN must be an origin only'],
    ['https://api.example.com?x=1', 'API_ORIGIN must be an origin only'],
    ['https://api.example.com#top', 'API_ORIGIN must be an origin only'],
    ['https://user:secret@api.example.com', 'API_ORIGIN must be an origin only'],
  ])('rejects %j', (value, message) => {
    expect(() => parseApiOrigin(value)).toThrow(message);
  });
});

describe('vercelConfig', () => {
  it('forwards /api/* to the api and serves index.html for every other path', () => {
    const config = vercelConfig('https://api.example.com');

    expect(config.outputDirectory).toBe('dist/web/browser');
    expect(config.rewrites).toEqual([
      { source: '/api/:path*', destination: 'https://api.example.com/api/:path*' },
      { source: '/(.*)', destination: '/index.html' },
    ]);
  });
});

describe('main', () => {
  let directory: string;
  let output: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'vercel-config-'));
    output = join(directory, 'vercel.json');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('writes the configuration for API_ORIGIN as JSON', async () => {
    const exitCode = await main({ API_ORIGIN: 'https://api.example.com' }, output);

    expect(exitCode).toBe(0);
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(
      vercelConfig('https://api.example.com'),
    );
  });

  it('prints the reason and writes nothing when API_ORIGIN is wrong', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const exitCode = await main({ API_ORIGIN: 'ftp://api.example.com' }, output);

    expect(exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('must use https or http'));
    await expect(readFile(output)).rejects.toThrow();
  });

  it('exits with code 1 when the script runs without API_ORIGIN', async () => {
    const script = fileURLToPath(new URL('./write-vercel-config.ts', import.meta.url));
    const environment = { ...process.env };
    delete environment['API_ORIGIN'];

    const run = promisify(execFile)(process.execPath, [script, output], { env: environment });

    await expect(run).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('API_ORIGIN is not set'),
    });
  });
});
