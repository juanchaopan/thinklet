import { decodeCursor, encodeCursor, isCreatedAt, type BookPosition } from './book-cursor.js';

const POSITION: BookPosition = { createdAt: '2026-11-23T07:46:00.123456Z', id: 'carrot-counting' };

/** The cursor of any JSON value, encoded the way the api encodes its own. */
const cursorOf = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('isCreatedAt', () => {
  it.each(['2026-11-23T07:46:00.000000Z', '2024-02-29T23:59:59.999999Z'])(
    'accepts the real time %s to the microsecond',
    (value) => {
      expect(isCreatedAt(value)).toBe(true);
    },
  );

  it.each([
    '2026-11-23T07:46:00Z',
    '2026-11-23T07:46:00.000Z',
    '2026-11-23T07:46:00.0000000Z',
    '2026-11-23 07:46:00.000000Z',
    '2026-11-23T07:46:00.000000+08:00',
    '2026-02-30T07:46:00.000000Z',
    '2025-02-29T07:46:00.000000Z',
    '2026-11-23T24:00:00.000000Z',
    '2026-13-01T00:00:00.000000Z',
  ])('refuses %s', (value) => {
    expect(isCreatedAt(value)).toBe(false);
  });
});

describe('cursors', () => {
  it('decodes the cursor it encodes into the same position', () => {
    const cursor = encodeCursor(POSITION);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual(POSITION);
  });

  it('takes the same encoding of a time and a book id from anywhere', () => {
    expect(decodeCursor(cursorOf([POSITION.createdAt, POSITION.id]))).toEqual(POSITION);
  });

  it.each([
    ['text that is not base64url', 'not a cursor'],
    ['padded base64', `${encodeCursor(POSITION)}=`],
    [
      'standard base64',
      Buffer.from(JSON.stringify([POSITION.createdAt, POSITION.id])).toString('base64'),
    ],
    ['a cut-off cursor', encodeCursor(POSITION).slice(0, -2)],
    ['bytes that are not JSON', Buffer.from('[1,').toString('base64url')],
    [
      'JSON spaced out',
      Buffer.from(`[ "${POSITION.createdAt}", "${POSITION.id}" ]`).toString('base64url'),
    ],
    ['an object', cursorOf({ createdAt: POSITION.createdAt, id: POSITION.id })],
    ['a third item', cursorOf([POSITION.createdAt, POSITION.id, 'x'])],
    ['one item', cursorOf([POSITION.createdAt])],
    ['a time in milliseconds', cursorOf(['2026-11-23T07:46:00.123Z', POSITION.id])],
    ['a time that is no date', cursorOf(['2026-02-30T07:46:00.000000Z', POSITION.id])],
    ['a number for the time', cursorOf([1, POSITION.id])],
    ['an id with capitals', cursorOf([POSITION.createdAt, 'Carrot'])],
    ['an id with SQL', cursorOf([POSITION.createdAt, "x' or '1'='1"])],
    ['an id that is too long', cursorOf([POSITION.createdAt, 'a'.repeat(61)])],
    ['a very long text', 'A'.repeat(201)],
  ])('refuses %s', (_case, cursor) => {
    expect(decodeCursor(cursor)).toBeUndefined();
  });
});
