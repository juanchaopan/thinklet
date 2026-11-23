import type { StorageService } from '../../infrastructure/storage/storage.service.js';
import type { BooksRepository, CoverRecord } from './books.repository.js';
import { CoverService } from './cover.service.js';

const HASH = 'a'.repeat(64);
const BODY = new Uint8Array([1, 2, 3]);

/** The service over a book whose recorded cover is `cover`, and storage holding `stored`. */
function createService(cover: CoverRecord | undefined, stored = true) {
  const repository = { findCover: vi.fn(() => Promise.resolve(cover)) };
  const storage = {
    getObject: vi.fn(() =>
      Promise.resolve(stored ? { contentType: 'application/octet-stream', body: BODY } : undefined),
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
    const { service } = createService({ type: 'png', sha256: HASH }, false);

    await expect(service.cover('carrot-counting', HASH)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
