import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  bookDetailSchema,
  bookListResponseSchema,
  childBooksResponseSchema,
  type Child,
  type FamilyDetail,
} from '@thinklet/contracts';
import request from 'supertest';
import {
  ACTIVE_BOOK,
  CHILD_BOOKS_PATH,
  acquire,
  acquisitionPath,
  assignmentRows,
  bookPath,
  booksPath,
  childLoginCookie,
  familyBookRows,
  filtersPath,
  getAsChild,
  readersPath,
  setReaders,
} from '../support/books.js';
import { CHILD_SESSION_COOKIE } from '../support/child-login.js';
import { addChild, childPath } from '../support/children.js';
import { bookContentDirectory } from '../support/containers.js';
import {
  addMember,
  as,
  createFamily,
  outcomesOf,
  signInParent,
  useAppWithServices,
  type Parent,
} from '../support/families.js';
import { cookieHeader, testSessionTokens } from '../support/login.js';
import {
  FOREIGN_ORIGINS,
  each,
  expectRefused,
  fromParent,
  refusalsOn,
  signedOut,
  withChildLoginIn,
  writes,
  type Route,
} from '../support/routes.js';

/** A second active sample book, which only the other family has. */
const THEIR_BOOK = 'abc-songs';

/** A family with its admin, one member, and a child who reads the family's one book. */
interface Household {
  family: FamilyDetail;
  admin: Parent;
  member: Parent;
  child: Child;
}

/** Every book route of the family, naming the given child and book. */
function familyRoutes(familyId: string, childId: string, bookId: string): Route[] {
  return [
    { method: 'get', path: booksPath(familyId) },
    { method: 'get', path: `${booksPath(familyId)}?scope=child&child=${childId}` },
    { method: 'get', path: filtersPath(familyId) },
    { method: 'get', path: bookPath(familyId, bookId) },
    { method: 'put', path: acquisitionPath(familyId, bookId), body: {} },
    { method: 'put', path: readersPath(familyId, bookId), body: { childIds: [childId] } },
    { method: 'delete', path: acquisitionPath(familyId, bookId) },
  ];
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

// Security test cases of .docs/architecture.md ("指标和要求", 安全) for the
// book routes: a parent cannot see or change the books of a family they
// are not in, nor learn another family's books or children through their
// own family (IDOR); a book goes only to the family's own children and only
// once the family has it; a child sees only their own books; the family's
// routes need a parent's login and the child's books a child's login, so
// neither opens the other's; a cover needs either login; the writes need
// this site's Origin.
describe('book security', () => {
  const running = useAppWithServices();
  let ours: Household;
  let theirs: Household;

  /** A family whose child reads the book, the only one the family has. */
  async function household(name: string, bookId: string): Promise<Household> {
    const [admin, member] = await Promise.all([
      signInParent(running.server, { name: `${name}管理员` }),
      signInParent(running.server, { name: `${name}家长` }),
    ]);
    const family = await createFamily(running.server, admin, { name, timezone: 'Asia/Shanghai' });
    await addMember(running.databaseUrl, family.id, member.id);
    const child = await addChild(running.server, admin, family.id, { nickname: `${name}孩子` });
    await acquire(running.server, admin, family.id, bookId);
    await setReaders(running.server, admin, { familyId: family.id, bookId }, [child.id]);
    return { family, admin, member, child };
  }

  /** Everything the database holds about the household's books. */
  async function stateOf({ family }: Household) {
    return {
      books: await familyBookRows(running.databaseUrl, family.id),
      assignments: await assignmentRows(running.databaseUrl, family.id),
    };
  }

  /** Our family's book routes, naming our child and the book given. */
  const ourRoutes = (bookId = ACTIVE_BOOK) => familyRoutes(ours.family.id, ours.child.id, bookId);

  /** Refusals that must leave our family's state as it was. */
  const refused = refusalsOn(running, () => stateOf(ours));

  beforeAll(async () => {
    ours = await household('我们家', ACTIVE_BOOK);
    theirs = await household('他们家', THEIR_BOOK);
  });

  it.each(['admin', 'member'] as const)(
    'answers the %s of another family with 404 family_not_found on every book route of that family',
    async (role) => {
      await expectRefused({
        target: running.server,
        routes: familyRoutes(theirs.family.id, theirs.child.id, ACTIVE_BOOK),
        prepare: fromParent(ours[role]),
        outcome: [404, 'family_not_found'],
        state: () => stateOf(theirs),
      });
    },
  );

  it("shows nothing of another family's books or readers in the parent's own family", async () => {
    const client = as(running.server, ours.member);

    const library = bookListResponseSchema.parse(
      (await client.get(`${booksPath(ours.family.id)}?subject=english&grade=preschool`)).body,
    );
    const page = bookDetailSchema.parse(
      (await client.get(bookPath(ours.family.id, THEIR_BOOK))).body,
    );
    const ourBooks = bookListResponseSchema.parse(
      (await client.get(`${booksPath(ours.family.id)}?scope=family`)).body,
    );

    expect(library.books.find(({ id }) => id === THEIR_BOOK)).toMatchObject({
      acquired: false,
      readers: [],
    });
    expect(page).toMatchObject({ acquired: false, readers: [] });
    expect(ourBooks.books.map(({ id }) => id)).toEqual([ACTIVE_BOOK]);
  });

  it("does not list another family's child under the parent's own family", async () => {
    const client = as(running.server, ours.member);

    const responses = [
      await client.get(`${booksPath(ours.family.id)}?scope=child&child=${theirs.child.id}`),
      await client.get(`${filtersPath(ours.family.id)}?scope=child&child=${theirs.child.id}`),
    ];

    expect(outcomesOf(responses)).toEqual(each(responses, [404, 'child_not_found']));
  });

  it("does not assign a book to another family's child, and changes nothing", async () => {
    const before = { ours: await stateOf(ours), theirs: await stateOf(theirs) };

    const response = await as(running.server, ours.admin).put(
      readersPath(ours.family.id, ACTIVE_BOOK),
      { childIds: [ours.child.id, theirs.child.id] },
    );

    expect(outcomesOf([response])).toEqual([[404, 'child_not_found']]);
    expect({ ours: await stateOf(ours), theirs: await stateOf(theirs) }).toEqual(before);
  });

  it('does not assign a book the family has not acquired', async () => {
    await refused(
      [
        {
          method: 'put',
          path: readersPath(ours.family.id, THEIR_BOOK),
          body: { childIds: [ours.child.id] },
        },
      ],
      fromParent(ours.admin),
      [409, 'book_not_acquired'],
    );
  });

  it('answers a child only their own books', async () => {
    const ourBooks = childBooksResponseSchema.parse(
      (await getAsChild(running.server, ours.child.id, CHILD_BOOKS_PATH)).body,
    );
    const theirBooks = childBooksResponseSchema.parse(
      (await getAsChild(running.server, theirs.child.id, CHILD_BOOKS_PATH)).body,
    );

    expect(ourBooks.books.map(({ id }) => id)).toEqual([ACTIVE_BOOK]);
    expect(theirBooks.books.map(({ id }) => id)).toEqual([THEIR_BOOK]);
  });

  it('needs a login on every family book route', async () => {
    await refused(ourRoutes(), signedOut, [401, 'unauthenticated']);
  });

  it.each([CHILD_SESSION_COOKIE, 'thinklet_session'])(
    "does not open any family book route with a child's login in the cookie %s",
    async (cookie) => {
      await refused(ourRoutes(), await withChildLoginIn(cookie, ours.child.id), [
        401,
        'unauthenticated',
      ]);
    },
  );

  it.each(['thinklet_session', CHILD_SESSION_COOKIE])(
    "does not open the child's books with a parent's login in the cookie %s",
    async (cookie) => {
      const login = await testSessionTokens().issueSession('parent', ours.admin.id);

      const response = await request(running.server)
        .get(CHILD_BOOKS_PATH)
        .set('Cookie', cookieHeader({ [cookie]: login }));

      expect(outcomesOf([response])).toEqual([[401, 'unauthenticated']]);
    },
  );

  it.each(FOREIGN_ORIGINS)(
    "refuses every change to the family's books %s even with a parent's login",
    async (_case, foreign) => {
      await refused(writes(ourRoutes(THEIR_BOOK)), foreign(ours.admin), [403, 'bad_origin']);
    },
  );

  describe('covers', () => {
    let path: string;

    beforeAll(async () => {
      const cover = await readFile(join(bookContentDirectory, ACTIVE_BOOK, 'cover.png'));
      path = `/api/books/${ACTIVE_BOOK}/cover?v=${sha256(cover)}`;
    });

    it('needs a login', async () => {
      const response = await request(running.server).get(path);

      expect(outcomesOf([response])).toEqual([[401, 'unauthenticated']]);
      expect(response.headers['cache-control']).toBeUndefined();
    });

    it('answers a signed-in parent and a signed-in child', async () => {
      const parent = await as(running.server, ours.member).get(path);
      const child = await request(running.server)
        .get(path)
        .set('Cookie', await childLoginCookie(ours.child.id));

      expect([parent.status, child.status]).toEqual([200, 200]);
    });

    it('refuses a login of the wrong kind in each cookie, and a deleted child', async () => {
      const tokens = testSessionTokens();
      const gone = await addChild(running.server, ours.admin, ours.family.id);
      const goneLogin = await childLoginCookie(gone.id);
      await as(running.server, ours.admin).delete(childPath(ours.family.id, gone.id)).expect(204);
      const cookies = [
        cookieHeader({ thinklet_session: await tokens.issueSession('child', ours.child.id) }),
        cookieHeader({
          [CHILD_SESSION_COOKIE]: await tokens.issueSession('parent', ours.admin.id),
        }),
        goneLogin,
      ];

      const responses = await Promise.all(
        cookies.map((cookie) => request(running.server).get(path).set('Cookie', cookie)),
      );

      expect(outcomesOf(responses)).toEqual(each(responses, [401, 'unauthenticated']));
    });
  });
});
