import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CoverType } from '../../infrastructure/database/schema.js';
import { COVER_TYPES, coverFileName, coverProblem } from './cover-image.js';

/** A cover read from a book's folder that meets the rules. */
export interface LocalCover {
  type: CoverType;
  bytes: Uint8Array;
  /** The SHA-256 of the file, in lowercase hex as the book table keeps it. */
  sha256: string;
}

/** A book's cover, or what keeps it from being imported. */
export type CoverReading = { cover: LocalCover } | { problem: string };

/** The file that marks the repository's root folder. */
const REPOSITORY_MARKER = 'pnpm-workspace.yaml';

/**
 * The repository's content/books/ folder, found by walking up from this
 * file to the folder holding the workspace file. It is the same folder
 * whether this runs from src/ or dist/, and whatever the working directory.
 */
export function defaultContentDirectory(): string {
  const start = dirname(fileURLToPath(import.meta.url));
  let folder = start;
  while (!existsSync(join(folder, REPOSITORY_MARKER))) {
    const parent = dirname(folder);
    if (parent === folder) {
      throw new Error(`No ${REPOSITORY_MARKER} in ${start} or any folder above it`);
    }
    folder = parent;
  }
  return join(folder, 'content', 'books');
}

/** Whether a regular file is at the path; a missing path, or one under a file, is not. */
async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    const { code } = error as { code?: unknown };
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return false;
    }
    throw error;
  }
}

/**
 * Reads the cover in `<contentDirectory>/<bookId>/`: exactly one of
 * cover.webp and cover.png, which must meet the cover rules.
 */
export async function readBookCover(
  contentDirectory: string,
  bookId: string,
): Promise<CoverReading> {
  const folder = join(contentDirectory, bookId);
  const present: CoverType[] = [];
  for (const type of COVER_TYPES) {
    if (await isFile(join(folder, coverFileName(type)))) {
      present.push(type);
    }
  }
  if (present.length === 0) {
    return { problem: `no ${COVER_TYPES.map(coverFileName).join(' or ')}` };
  }
  if (present.length > 1) {
    return { problem: `both ${present.map(coverFileName).join(' and ')}; keep only one` };
  }
  const [type] = present;
  const bytes = new Uint8Array(await readFile(join(folder, coverFileName(type))));
  const problem = coverProblem(type, bytes);
  if (problem !== undefined) {
    return { problem: `${coverFileName(type)} ${problem}` };
  }
  return { cover: { type, bytes, sha256: createHash('sha256').update(bytes).digest('hex') } };
}
