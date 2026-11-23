import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultContentDirectory, readBookCover } from './cover-files.js';

describe('defaultContentDirectory', () => {
  it('is the content/books folder of the repository', () => {
    const directory = defaultContentDirectory();

    expect(directory.replaceAll('\\', '/')).toMatch(/\/content\/books$/);
    expect(existsSync(join(directory, '..', '..', 'pnpm-workspace.yaml'))).toBe(true);
  });
});

describe('readBookCover', () => {
  let contentDirectory: string;
  /** A cover that meets the rules: one of the repository's sample covers. */
  let validPng: Buffer;

  beforeAll(async () => {
    validPng = await readFile(join(defaultContentDirectory(), 'abc-songs', 'cover.png'));
  });

  beforeEach(async () => {
    contentDirectory = await mkdtemp(join(tmpdir(), 'thinklet-covers-'));
  });

  afterEach(async () => {
    await rm(contentDirectory, { recursive: true, force: true });
  });

  async function writeCover(bookId: string, fileName: string, bytes: Uint8Array): Promise<void> {
    await mkdir(join(contentDirectory, bookId), { recursive: true });
    await writeFile(join(contentDirectory, bookId, fileName), bytes);
  }

  it('reads a valid cover with its type and SHA-256', async () => {
    await writeCover('book-a', 'cover.png', validPng);

    expect(await readBookCover(contentDirectory, 'book-a')).toEqual({
      cover: {
        type: 'png',
        bytes: new Uint8Array(validPng),
        sha256: createHash('sha256').update(validPng).digest('hex'),
      },
    });
  });

  it('reports a book without a folder', async () => {
    expect(await readBookCover(contentDirectory, 'book-a')).toEqual({
      problem: 'no cover.webp or cover.png',
    });
  });

  it('reports a folder without a cover file', async () => {
    await writeCover('book-a', 'cover.jpg', validPng);

    expect(await readBookCover(contentDirectory, 'book-a')).toEqual({
      problem: 'no cover.webp or cover.png',
    });
  });

  it('does not take a folder named cover.png for a cover', async () => {
    await mkdir(join(contentDirectory, 'book-a', 'cover.png'), { recursive: true });

    expect(await readBookCover(contentDirectory, 'book-a')).toEqual({
      problem: 'no cover.webp or cover.png',
    });
  });

  it('reports a folder with both cover files', async () => {
    await writeCover('book-a', 'cover.png', validPng);
    await writeCover('book-a', 'cover.webp', validPng);

    expect(await readBookCover(contentDirectory, 'book-a')).toEqual({
      problem: 'both cover.webp and cover.png; keep only one',
    });
  });

  it('reports a cover that breaks the rules, naming the file', async () => {
    await writeCover('book-a', 'cover.webp', validPng);

    expect(await readBookCover(contentDirectory, 'book-a')).toEqual({
      problem: 'cover.webp is not a WebP image',
    });
  });
});
