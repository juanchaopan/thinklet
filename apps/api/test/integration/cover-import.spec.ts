import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { importCovers } from '../support/app.js';
import {
  bookContentDirectory,
  migrate,
  startDatabase,
  startStorage,
  type StartedStorage,
} from '../support/containers.js';
import { query } from '../support/database.js';

interface BookCoverRow {
  id: string;
  cover_type: string | null;
  cover_sha256: string | null;
  updated_at: Date;
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A WebP header of the extended (VP8X) form for a 3:4 canvas, which is all the import reads. */
function webpCover(): Buffer {
  const canvas = Buffer.alloc(10);
  canvas.writeUIntLE(300 - 1, 4, 3);
  canvas.writeUIntLE(400 - 1, 7, 3);
  const chunkSize = Buffer.alloc(4);
  chunkSize.writeUInt32LE(canvas.length);
  const body = Buffer.concat([Buffer.from('WEBPVP8X', 'ascii'), chunkSize, canvas]);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), riffSize, body]);
}

describe('cover import', () => {
  let database: StartedPostgreSqlContainer | undefined;
  let storage: StartedStorage | undefined;
  let databaseUrl: string;
  let s3: S3Client;
  /** A copy of the repository's book folders that each test changes as it needs. */
  let content: string;
  let bookIds: string[];

  const run = () => {
    if (!storage) {
      throw new Error('Storage did not start');
    }
    return importCovers(databaseUrl, storage, content);
  };

  const rows = () =>
    query<BookCoverRow>(
      databaseUrl,
      'select id, cover_type, cover_sha256, updated_at from books order by id',
    );

  const coverPath = (bookId: string, type = 'png') => join(content, bookId, `cover.${type}`);

  async function storedKeys(): Promise<string[]> {
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: storage?.bucket }));
    return (listed.Contents ?? []).map((object) => object.Key ?? '').sort();
  }

  async function stored(key: string): Promise<{ contentType?: string; body: Uint8Array }> {
    const object = await s3.send(new GetObjectCommand({ Bucket: storage?.bucket, Key: key }));
    return {
      ...(object.ContentType === undefined ? {} : { contentType: object.ContentType }),
      body: (await object.Body?.transformToByteArray()) ?? new Uint8Array(),
    };
  }

  beforeAll(async () => {
    database = await startDatabase();
    storage = await startStorage();
    databaseUrl = database.getConnectionUri();
    await migrate(databaseUrl);
    s3 = new S3Client({
      endpoint: storage.endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: storage.accessKeyId, secretAccessKey: storage.secretAccessKey },
    });
    content = await mkdtemp(join(tmpdir(), 'thinklet-content-'));
    await cp(bookContentDirectory, content, { recursive: true });
    bookIds = (await rows()).map((row) => row.id);
  });

  afterAll(async () => {
    s3?.destroy();
    await rm(content, { recursive: true, force: true });
    await Promise.all([database?.stop(), storage?.container.stop()]);
  });

  describe('before any cover is imported', () => {
    it('changes nothing when a book has no cover, and names the book', async () => {
      const [bookId = ''] = bookIds;
      const cover = await readFile(coverPath(bookId));
      await rm(coverPath(bookId));

      await expect(run()).rejects.toThrow(`- book ${bookId}: no cover.webp or cover.png`);

      expect(
        (await rows()).every((row) => row.cover_type === null && row.cover_sha256 === null),
      ).toBe(true);
      expect(await storedKeys()).toEqual([]);
      await writeFile(coverPath(bookId), cover);
    });

    it('changes nothing when covers break the rules, and names each book', async () => {
      const [first = '', second = ''] = bookIds;
      const cover = await readFile(coverPath(first));
      await writeFile(coverPath(first), 'not an image');
      await writeFile(coverPath(second, 'webp'), webpCover());

      const failure = run();

      await expect(failure).rejects.toThrow(`- book ${first}: cover.png is not a PNG image`);
      await expect(failure).rejects.toThrow(
        `- book ${second}: both cover.webp and cover.png; keep only one`,
      );
      expect((await rows()).every((row) => row.cover_type === null)).toBe(true);
      expect(await storedKeys()).toEqual([]);
      await writeFile(coverPath(first), cover);
      await rm(coverPath(second, 'webp'));
    });
  });

  describe('importing the covers', () => {
    it('stores every cover and records its type and hash, leaving others alone', async () => {
      // A folder without a book is ignored, even with a broken cover, and the
      // stored cover of a book no longer in the table stays.
      await mkdir(join(content, 'no-such-book'));
      await writeFile(join(content, 'no-such-book', 'cover.png'), 'not an image');
      await s3.send(
        new PutObjectCommand({
          Bucket: storage?.bucket,
          Key: 'books/removed-book/cover.png',
          Body: 'old cover',
        }),
      );

      expect(await run()).toEqual({
        books: bookIds.length,
        uploaded: bookIds.length,
        unchanged: 0,
        recorded: bookIds.length,
      });

      for (const row of await rows()) {
        const file = await readFile(coverPath(row.id));
        expect(row).toMatchObject({ cover_type: 'png', cover_sha256: sha256(file) });
        expect(await stored(`books/${row.id}/cover.png`)).toEqual({
          contentType: 'image/png',
          body: new Uint8Array(file),
        });
      }
      expect(await storedKeys()).toEqual(
        [...bookIds.map((id) => `books/${id}/cover.png`), 'books/removed-book/cover.png'].sort(),
      );
    });

    it('uploads and records nothing when it runs again', async () => {
      const before = await rows();

      expect(await run()).toEqual({
        books: bookIds.length,
        uploaded: 0,
        unchanged: bookIds.length,
        recorded: 0,
      });
      expect(await rows()).toEqual(before);
    });

    it('uploads a changed cover and records its new hash', async () => {
      const [first = '', second = ''] = bookIds;
      const replacement = await readFile(coverPath(second));
      await writeFile(coverPath(first), replacement);
      const before = await rows();

      expect(await run()).toMatchObject({ uploaded: 1, recorded: 1 });

      const after = await rows();
      expect(after.find((row) => row.id === first)?.cover_sha256).toBe(sha256(replacement));
      expect((await stored(`books/${first}/cover.png`)).body).toEqual(new Uint8Array(replacement));
      expect(after.filter((row) => row.id !== first)).toEqual(
        before.filter((row) => row.id !== first),
      );
    });

    // The third book's cover turns into a WebP, and then back into a PNG
    // (the fourth book's): each time only the new format is left in storage.
    it.each([
      ['a WebP', 'png', 'webp'],
      ['a PNG again', 'webp', 'png'],
    ] as const)(
      'stores a cover that turned into %s under its new name, and deletes the old format',
      async (_name, from, to) => {
        const [, , third = '', fourth = ''] = bookIds;
        const bytes = to === 'webp' ? webpCover() : await readFile(coverPath(fourth));
        await rm(coverPath(third, from));
        await writeFile(coverPath(third, to), bytes);

        expect(await run()).toMatchObject({ uploaded: 1, recorded: 1 });

        const row = (await rows()).find((candidate) => candidate.id === third);
        expect(row).toMatchObject({ cover_type: to, cover_sha256: sha256(bytes) });
        expect(await stored(`books/${third}/cover.${to}`)).toEqual({
          contentType: `image/${to}`,
          body: new Uint8Array(bytes),
        });
        expect((await storedKeys()).filter((key) => key.startsWith(`books/${third}/`))).toEqual([
          `books/${third}/cover.${to}`,
        ]);
      },
    );

    it('keeps one cover per book, of the recorded format, and the covers of books that are gone', async () => {
      const recorded = await rows();

      expect(await storedKeys()).toEqual(
        [
          ...recorded.map((row) => `books/${row.id}/cover.${row.cover_type ?? ''}`),
          'books/removed-book/cover.png',
        ].sort(),
      );
    });

    it('stores again a cover that is gone from storage, without recording anything', async () => {
      const [, second = ''] = bookIds;
      await s3.send(
        new DeleteObjectCommand({ Bucket: storage?.bucket, Key: `books/${second}/cover.png` }),
      );

      expect(await run()).toMatchObject({ uploaded: 1, recorded: 0 });
      expect(await storedKeys()).toContain(`books/${second}/cover.png`);
    });

    it('keeps the stored covers and hashes when a later import fails', async () => {
      const [first = '', second = '', , fourth = ''] = bookIds;
      const before = await rows();
      const storedBefore = await stored(`books/${first}/cover.png`);
      await writeFile(coverPath(first), await readFile(coverPath(fourth)));
      await writeFile(coverPath(second), 'not an image');

      await expect(run()).rejects.toThrow(`- book ${second}: cover.png is not a PNG image`);

      expect(await rows()).toEqual(before);
      expect(await stored(`books/${first}/cover.png`)).toEqual(storedBefore);
    });
  });
});
