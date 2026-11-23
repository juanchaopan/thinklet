import { coverProblem, coverStorageKey, MAX_COVER_BYTES, readImageHeader } from './cover-image.js';

// Each builder writes only the header the import reads, followed by
// `padding` zero bytes to reach a file size.

function png(width: number, height: number, padding = 0): Uint8Array {
  const bytes = Buffer.alloc(33 + padding);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/** A RIFF WEBP file whose first chunk is `chunk` with the given data. */
function webp(chunk: string, data: Buffer): Uint8Array {
  const bytes = Buffer.alloc(20 + Math.max(data.length, 10));
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WEBP', 8, 'ascii');
  bytes.write(chunk, 12, 'ascii');
  bytes.writeUInt32LE(data.length, 16);
  data.copy(bytes, 20);
  return bytes;
}

function webpLossy(width: number, height: number): Uint8Array {
  const data = Buffer.alloc(10);
  Buffer.from([0x9d, 0x01, 0x2a]).copy(data, 3);
  data.writeUInt16LE(width, 6);
  data.writeUInt16LE(height, 8);
  return webp('VP8 ', data);
}

function webpLossless(width: number, height: number): Uint8Array {
  const data = Buffer.alloc(5);
  data[0] = 0x2f;
  data.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
  return webp('VP8L', data);
}

function webpExtended(width: number, height: number): Uint8Array {
  const data = Buffer.alloc(10);
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  return webp('VP8X', data);
}

describe('readImageHeader', () => {
  it('reads the size of a PNG from IHDR', () => {
    expect(readImageHeader(png(600, 800))).toEqual({ type: 'png', width: 600, height: 800 });
  });

  it.each([
    ['lossy (VP8)', webpLossy(300, 400)],
    ['lossless (VP8L)', webpLossless(300, 400)],
    ['extended (VP8X)', webpExtended(300, 400)],
  ])('reads the size of a %s WebP', (_name, bytes) => {
    expect(readImageHeader(bytes)).toEqual({ type: 'webp', width: 300, height: 400 });
  });

  it('reads sizes up to the 14 bits VP8 and VP8L have', () => {
    expect(readImageHeader(webpLossy(16_383, 16_383))).toMatchObject({ width: 16_383 });
    expect(readImageHeader(webpLossless(16_384, 16_384))).toMatchObject({ height: 16_384 });
  });

  it('reads the 24-bit canvas size of VP8X', () => {
    expect(readImageHeader(webpExtended(30_000, 40_000))).toMatchObject({
      width: 30_000,
      height: 40_000,
    });
  });

  it.each([
    ['a JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(40)])],
    ['an empty file', new Uint8Array()],
    ['a PNG cut off in IHDR', png(3, 4).subarray(0, 20)],
    ['a PNG whose first chunk is not IHDR', Buffer.from(png(3, 4)).fill(0x41, 12, 16)],
    ['a WebP cut off in its first chunk', webpExtended(3, 4).subarray(0, 25)],
    ['a RIFF file of another form', Buffer.from(webpLossy(3, 4)).fill(0x41, 8, 12)],
    ['a WebP with an unknown first chunk', webp('ALPH', Buffer.alloc(10))],
    ['a VP8 chunk without its start code', webp('VP8 ', Buffer.alloc(10))],
    ['a VP8L chunk without its signature', webp('VP8L', Buffer.alloc(10))],
  ])('does not read %s', (_name, bytes) => {
    expect(readImageHeader(bytes)).toBeUndefined();
  });
});

describe('coverProblem', () => {
  it('accepts a 3:4 PNG named cover.png', () => {
    expect(coverProblem('png', png(600, 800))).toBeUndefined();
  });

  it('accepts a 3:4 WebP named cover.webp', () => {
    expect(coverProblem('webp', webpLossy(3, 4))).toBeUndefined();
  });

  it('accepts a cover of exactly 300 KB', () => {
    expect(coverProblem('png', png(3, 4, MAX_COVER_BYTES - 33))).toBeUndefined();
  });

  it('refuses a cover over 300 KB', () => {
    expect(coverProblem('png', png(3, 4, MAX_COVER_BYTES - 32))).toBe(
      `is ${MAX_COVER_BYTES + 1} bytes, over the limit of ${MAX_COVER_BYTES} bytes (300 KB)`,
    );
  });

  it('refuses a file whose header is not the type its name says', () => {
    expect(coverProblem('png', webpLossy(3, 4))).toBe('is not a PNG image');
    expect(coverProblem('webp', png(3, 4))).toBe('is not a WebP image');
  });

  it('refuses a file with a wrong signature', () => {
    expect(coverProblem('png', Buffer.from(png(3, 4)).fill(0, 0, 1))).toBe('is not a PNG image');
  });

  it.each([
    [600, 600],
    [601, 800],
    [800, 600],
    [0, 0],
  ])('refuses a %i×%i image, which is not 3:4', (width, height) => {
    expect(coverProblem('png', png(width, height))).toBe(
      `is ${width}×${height} pixels, not 3:4 (width:height)`,
    );
  });
});

describe('coverStorageKey', () => {
  it('stores a cover in its book folder, as in the repository', () => {
    expect(coverStorageKey('abc-songs', 'webp')).toBe('books/abc-songs/cover.webp');
  });
});
