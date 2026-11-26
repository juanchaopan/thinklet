import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ACTIVE_BOOK,
  getAsChild,
  insertBook,
  insertGrade,
  insertSubject,
} from '../support/books.js';
import { addChild } from '../support/children.js';
import { bookContentDirectory } from '../support/containers.js';
import { query } from '../support/database.js';
import {
  as,
  createFamily,
  signInParent,
  useAppWithServices,
  type Parent,
} from '../support/families.js';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The cover path of the book, with the hash it is asked for by. */
const coverPath = (bookId: string, version?: string) =>
  `/api/books/${bookId}/cover${version === undefined ? '' : `?v=${version}`}`;

// Acceptance criteria covered: a book's cover is read through the api by a
// signed-in parent or child, by the hash the book table records, exactly as
// the repository holds it, for the browser to keep for good; any other hash,
// a book without a cover, a cover missing from storage and a stored cover
// under another hash are not found, so the web app shows the default cover.
describe('covers', () => {
  const running = useAppWithServices();
  let parent: Parent;
  let cover: Buffer;

  const asParent = () => as(running.server, parent);

  /** Records `hash` as the cover hash of the book. */
  const recordHash = (bookId: string, hash: string) =>
    query(running.databaseUrl, 'update books set cover_sha256 = $2 where id = $1', [bookId, hash]);

  /** A book of the test's own grade and subject, which has no cover yet. */
  async function insertCoverlessBook(): Promise<string> {
    const minGradeId = await insertGrade(running.databaseUrl);
    const subjectId = await insertSubject(running.databaseUrl);
    return insertBook(running.databaseUrl, { minGradeId, subjectId });
  }

  beforeAll(async () => {
    parent = await signInParent(running.server, { name: '林悦' });
    cover = await readFile(join(bookContentDirectory, ACTIVE_BOOK, 'cover.png'));
  });

  it('answers the cover of the hash to a parent, as stored, kept privately for a year', async () => {
    const response = await asParent().get(coverPath(ACTIVE_BOOK, sha256(cover)));

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(response.headers['content-length']).toBe(String(cover.length));
    expect(Buffer.from(response.body as Buffer).equals(cover)).toBe(true);
  });

  it("carries the api's security headers", async () => {
    const response = await asParent().get(coverPath(ACTIVE_BOOK, sha256(cover)));

    expect(response.headers).toMatchObject({
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
    });
  });

  it('answers the cover to a signed-in child', async () => {
    const family = await createFamily(running.server, parent);
    const child = await addChild(running.server, parent, family.id);

    const response = await getAsChild(
      running.server,
      child.id,
      coverPath(ACTIVE_BOOK, sha256(cover)),
    );

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
  });

  it('answers another hash, none or several with 404 not_found, kept by no cache', async () => {
    const versions = [
      undefined,
      '0'.repeat(64),
      sha256(cover).toUpperCase(),
      `${sha256(cover)}&v=${sha256(cover)}`,
    ];

    for (const version of versions) {
      const response = await asParent().get(coverPath(ACTIVE_BOOK, version));

      expect(response.status, version).toBe(404);
      expect(response.body).toMatchObject({ error: { code: 'not_found' } });
      expect(response.headers['cache-control']).toBeUndefined();
    }
  });

  it('answers a book without a cover, and one that does not exist, with 404 not_found', async () => {
    const coverless = await insertCoverlessBook();

    const responses = [
      await asParent().get(coverPath(coverless, '0'.repeat(64))),
      await asParent().get(coverPath(coverless)),
      await asParent().get(coverPath('no-such-book', sha256(cover))),
      await asParent().get(coverPath('Bad_Id', sha256(cover))),
    ];

    expect(responses.map(({ status }) => status)).toEqual([404, 404, 404, 404]);
  });

  it('answers a cover missing from storage with 404 not_found', async () => {
    const bookId = await insertCoverlessBook();
    const version = 'a'.repeat(64);
    await query(
      running.databaseUrl,
      "update books set cover_type = 'png', cover_sha256 = $2 where id = $1",
      [bookId, version],
    );

    const response = await asParent().get(coverPath(bookId, version));

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'not_found' } });
  });

  it('answers the recorded hash with 404 not_found, kept by no cache, while storage holds a cover under another hash', async () => {
    // The book table still records an earlier hash while storage already
    // holds the bytes of the current cover, as between an import's upload
    // and the recording of the hashes.
    const recorded = 'b'.repeat(64);
    await recordHash(ACTIVE_BOOK, recorded);
    try {
      const response = await asParent().get(coverPath(ACTIVE_BOOK, recorded));

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ error: { code: 'not_found' } });
      expect(response.headers['cache-control']).toBeUndefined();
    } finally {
      await recordHash(ACTIVE_BOOK, sha256(cover));
    }
  });
});
