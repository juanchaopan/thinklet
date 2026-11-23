import type { StorageService } from '../../infrastructure/storage/storage.service.js';
import { readBookCover, type CoverReading } from './cover-files.js';
import type { CoverImportRepository } from './cover-import.repository.js';
import { CoverImportError, CoverImportService } from './cover-import.service.js';

vi.mock('./cover-files.js', () => ({ readBookCover: vi.fn() }));

const pngCover = { type: 'png', bytes: new Uint8Array([1]), sha256: 'a'.repeat(64) } as const;
const webpCover = { type: 'webp', bytes: new Uint8Array([2]), sha256: 'b'.repeat(64) } as const;

function setUp(readings: Record<string, CoverReading>) {
  vi.mocked(readBookCover).mockImplementation((_directory, bookId) =>
    Promise.resolve(readings[bookId] ?? { problem: 'not set up' }),
  );
  const repository = {
    listBookIds: vi.fn().mockResolvedValue(Object.keys(readings)),
    recordCovers: vi.fn().mockResolvedValue(0),
  };
  const storage = {
    headObject: vi.fn().mockResolvedValue(undefined),
    putObject: vi.fn().mockResolvedValue(undefined),
  };
  const service = new CoverImportService(
    repository as unknown as CoverImportRepository,
    storage as unknown as StorageService,
  );
  return { service, repository, storage };
}

describe('CoverImportService', () => {
  it('reads every book folder under the content directory', async () => {
    const { service } = setUp({ a: { cover: pngCover }, b: { cover: webpCover } });

    await service.importCovers('/content');

    expect(vi.mocked(readBookCover).mock.calls).toEqual([
      ['/content', 'a'],
      ['/content', 'b'],
    ]);
  });

  it('changes nothing and names every book with a problem', async () => {
    const { service, repository, storage } = setUp({
      a: { cover: pngCover },
      b: { problem: 'no cover.webp or cover.png' },
      c: { problem: 'cover.png is not a PNG image' },
    });

    const failure = service.importCovers('/content');

    await expect(failure).rejects.toBeInstanceOf(CoverImportError);
    await expect(failure).rejects.toThrow(
      [
        'Nothing was imported: 2 book(s) have no usable cover.',
        '- book b: no cover.webp or cover.png',
        '- book c: cover.png is not a PNG image',
      ].join('\n'),
    );
    expect(storage.headObject).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(repository.recordCovers).not.toHaveBeenCalled();
  });

  it('writes a missing cover with its media type and hash, then records it', async () => {
    const { service, repository, storage } = setUp({ a: { cover: webpCover } });
    repository.recordCovers.mockResolvedValue(1);

    const summary = await service.importCovers('/content');

    expect(storage.headObject).toHaveBeenCalledWith('books/a/cover.webp');
    expect(storage.putObject).toHaveBeenCalledWith('books/a/cover.webp', {
      body: webpCover.bytes,
      contentType: 'image/webp',
      metadata: { sha256: webpCover.sha256 },
    });
    expect(repository.recordCovers).toHaveBeenCalledWith([
      { bookId: 'a', type: 'webp', sha256: webpCover.sha256 },
    ]);
    expect(summary).toEqual({ books: 1, uploaded: 1, unchanged: 0, recorded: 1 });
  });

  it('leaves a stored cover with the same hash and media type alone', async () => {
    const { service, storage } = setUp({ a: { cover: pngCover } });
    storage.headObject.mockResolvedValue({
      contentType: 'image/png',
      metadata: { sha256: pngCover.sha256 },
    });

    const summary = await service.importCovers('/content');

    expect(storage.putObject).not.toHaveBeenCalled();
    expect(summary).toEqual({ books: 1, uploaded: 0, unchanged: 1, recorded: 0 });
  });

  it.each([
    ['another hash', { contentType: 'image/png', metadata: { sha256: 'c'.repeat(64) } }],
    ['no hash', { contentType: 'image/png', metadata: {} }],
    [
      'another media type',
      { contentType: 'application/octet-stream', metadata: { sha256: pngCover.sha256 } },
    ],
  ])('writes over a stored cover with %s', async (_name, stored) => {
    const { service, storage } = setUp({ a: { cover: pngCover } });
    storage.headObject.mockResolvedValue(stored);

    const summary = await service.importCovers('/content');

    expect(storage.putObject).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ uploaded: 1, unchanged: 0 });
  });

  it('records nothing when storage fails', async () => {
    const { service, repository, storage } = setUp({ a: { cover: pngCover } });
    storage.putObject.mockRejectedValue(new Error('storage down'));

    await expect(service.importCovers('/content')).rejects.toThrow('storage down');
    expect(repository.recordCovers).not.toHaveBeenCalled();
  });

  it('imports nothing when the book table is empty', async () => {
    const { service, repository } = setUp({});

    expect(await service.importCovers('/content')).toEqual({
      books: 0,
      uploaded: 0,
      unchanged: 0,
      recorded: 0,
    });
    expect(repository.recordCovers).toHaveBeenCalledWith([]);
  });
});
