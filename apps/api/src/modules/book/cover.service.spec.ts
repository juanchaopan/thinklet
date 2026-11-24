import type { StorageService } from '../../infrastructure/storage/storage.service.js';
import type { BooksRepository, CoverRecord } from './books.repository.js';
import { CoverService } from './cover.service.js';

const HASH = 'a'.repeat(64);
const BODY = new Uint8Array([1, 2, 3]);

/**
 * The service over a book whose recorded cover is `cover`, and storage
 * holding an object with the metadata `stored`, or no object when it is
 * null.
 */
function createService(
  cover: CoverRecord | undefined,
  stored: Record<string, string> | null = { sha256: HASH },
) {
  const repository = { findCover: vi.fn(() => Promise.resolve(cover)) };
  const storage = {
    getObject: vi.fn(() =>
      Promise.resolve(
        stored === null
          ? undefined
          : { contentType: 'application/octet-stream', metadata: stored, body: BODY },
      ),
    ),
  };
  const service = new CoverService(
    repository as unknown as BooksRepository,
    storage as unknown as StorageService,
  );
  return { service, storage };
}

describe('CoverService', () => {
  it.each([
    ['png', 'image/png'],
    ['webp', 'image/webp'],
  ] as const)('reads a %s cover from its key and serves it as %s', async (type, contentType) => {
    const { service, storage } = createService({ type, sha256: HASH });

    expect(await service.cover('carrot-counting', HASH)).toEqual({ body: BODY, contentType });
    expect(storage.getObject).toHaveBeenCalledWith(`books/carrot-counting/cover.${type}`);
  });

  it.each([
    ['another hash', { type: 'png', sha256: HASH } as const, 'b'.repeat(64)],
    ['no hash', { type: 'png', sha256: HASH } as const, undefined],
    ['a book without a cover', undefined, HASH],
  ])('answers %s with not_found without reading storage', async (_case, cover, version) => {
    const { service, storage } = createService(cover);

    await expect(service.cover('carrot-counting', version)).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    });
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('answers a cover missing from storage with not_found', async () => {
    const { service } = createService({ type: 'png', sha256: HASH }, null);

    await expect(service.cover('carrot-counting', HASH)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it.each([
    ['another hash', { sha256: 'b'.repeat(64) }],
    ['no hash', {}],
  ])(
    'answers a stored cover whose metadata carries %s with not_found',
    async (_case, stored: Record<string, string>) => {
      const { service } = createService({ type: 'png', sha256: HASH }, stored);

      await expect(service.cover('carrot-counting', HASH)).rejects.toMatchObject({
        code: 'not_found',
        status: 404,
      });
    },
  );
});
