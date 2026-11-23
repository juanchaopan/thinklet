import type { CoverType } from '../../infrastructure/database/schema.js';

/** The cover file types, in the order the import looks for them. */
export const COVER_TYPES: readonly CoverType[] = ['webp', 'png'];

/** The media type a cover of each type is stored and served with. */
export const COVER_MEDIA_TYPES: Readonly<Record<CoverType, string>> = {
  webp: 'image/webp',
  png: 'image/png',
};

/** The largest cover accepted: 300 KB, counted in KiB as file managers show it. */
export const MAX_COVER_BYTES = 300 * 1024;

/** The file name of a cover in its book's folder, in the repository and in storage alike. */
export function coverFileName(type: CoverType): string {
  return `cover.${type}`;
}

/** Where a book's cover is stored: one folder per book, as in content/books/. */
export function coverStorageKey(bookId: string, type: CoverType): string {
  return `books/${bookId}/${coverFileName(type)}`;
}

/** What an image file's header says about it. */
export interface ImageHeader {
  type: CoverType;
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** The signature, IHDR's length and type, and its width and height. */
const PNG_HEADER_BYTES = 24;
/** The RIFF header, the first chunk's header and the most of its data any format needs here. */
const WEBP_HEADER_BYTES = 30;
const VP8_START_CODE = [0x9d, 0x01, 0x2a];
const VP8L_SIGNATURE = 0x2f;
/** VP8 and VP8L store each dimension in 14 bits. */
const FOURTEEN_BITS = 0x3fff;

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** A 24-bit little-endian number, as VP8X stores the canvas size. */
function uint24(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

/** A PNG starts with its signature and then the IHDR chunk, whose data opens with the width and height. */
function readPngHeader(bytes: Uint8Array): ImageHeader | undefined {
  if (
    bytes.length < PNG_HEADER_BYTES ||
    !hasBytes(bytes, 0, PNG_SIGNATURE) ||
    ascii(bytes, 12, 4) !== 'IHDR'
  ) {
    return undefined;
  }
  const view = viewOf(bytes);
  return { type: 'png', width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * A WebP is a RIFF file of form WEBP whose first chunk is one of three: VP8
 * (lossy), with the size after the frame tag and start code; VP8L
 * (lossless), with the size packed into the bits after its signature byte;
 * or VP8X (extended), with the canvas size after its flags. Every stored
 * size is one less than the real one except VP8's.
 */
function readWebpHeader(bytes: Uint8Array): ImageHeader | undefined {
  if (
    bytes.length < WEBP_HEADER_BYTES ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 4) !== 'WEBP'
  ) {
    return undefined;
  }
  const view = viewOf(bytes);
  switch (ascii(bytes, 12, 4)) {
    case 'VP8 ':
      if (!hasBytes(bytes, 23, VP8_START_CODE)) {
        return undefined;
      }
      return {
        type: 'webp',
        width: view.getUint16(26, true) & FOURTEEN_BITS,
        height: view.getUint16(28, true) & FOURTEEN_BITS,
      };
    case 'VP8L': {
      if (bytes[20] !== VP8L_SIGNATURE) {
        return undefined;
      }
      const bits = view.getUint32(21, true);
      return {
        type: 'webp',
        width: (bits & FOURTEEN_BITS) + 1,
        height: ((bits >>> 14) & FOURTEEN_BITS) + 1,
      };
    }
    case 'VP8X':
      return { type: 'webp', width: uint24(bytes, 24) + 1, height: uint24(bytes, 27) + 1 };
    default:
      return undefined;
  }
}

/** The type and size of a WebP or PNG image, read from its header; undefined for anything else. */
export function readImageHeader(bytes: Uint8Array): ImageHeader | undefined {
  return readPngHeader(bytes) ?? readWebpHeader(bytes);
}

/**
 * What is wrong with a cover file of the given type, or undefined when it
 * meets the rules: at most MAX_COVER_BYTES, a real image of the type its
 * name says, and exactly 3:4 (width:height). Only the header is read, so no
 * image library is needed; the covers are made to size, never resized.
 */
export function coverProblem(type: CoverType, bytes: Uint8Array): string | undefined {
  if (bytes.length > MAX_COVER_BYTES) {
    return `is ${bytes.length} bytes, over the limit of ${MAX_COVER_BYTES} bytes (300 KB)`;
  }
  const header = readImageHeader(bytes);
  if (header?.type !== type) {
    return `is not a ${type === 'webp' ? 'WebP' : 'PNG'} image`;
  }
  const { width, height } = header;
  if (width === 0 || height === 0 || width * 4 !== height * 3) {
    return `is ${width}×${height} pixels, not 3:4 (width:height)`;
  }
  return undefined;
}
