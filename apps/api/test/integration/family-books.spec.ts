import {
  bookDetailSchema,
  bookListResponseSchema,
  type Child,
  type FamilyDetail,
} from '@thinklet/contracts';
import type request from 'supertest';
import {
  ACTIVE_BOOK,
  INACTIVE_BOOK,
  acquire,
  acquisitionPath,
  assignmentRows,
  bookPath,
  booksPath,
  familyBookRows,
  insertAssignment,
  insertFamilyBook,
  markOpened,
  readersPath,
  setReaders,
} from '../support/books.js';
import { addChild, childPath } from '../support/children.js';
import { query } from '../support/database.js';
import {
  addMember,
  as,
  createFamily,
  outcomesOf,
  signInParent,
  useAppWithServices,
  type Parent,
} from '../support/families.js';

/** How many times a test of two requests at the same time sends them, to meet their interleavings. */
const RACE_ROUNDS = 10;

/** A second active sample book. */
const OTHER_BOOK = 'abc-songs';

/** A family of the admin with the member in it and two children. */
interface Household {
  family: FamilyDetail;
  xiaomi: Child;
  doudou: Child;
}

/** The statuses of the responses. */
const statusesOf = (responses: request.Response[]) => responses.map(({ status }) => status);

// Acceptance criteria covered: a parent acquires a book into the family's
// books and removes it again while no child reads it, both safe to repeat;
// an inactive book cannot be acquired; a parent sets the children who read
// a family's book, adding and taking it away in one change that keeps the
// children who read it already as they were; who acquired a book and who
// assigned it are in the audit events; only the family's own children, only
// books the family has, and only active books for new readers; deleting a
// child takes its books with it; the outcomes of two parents doing these at
// the same time (`.docs/design/rules.md`, "同时操作"); every change is seen
// by the next read.
describe("the family's books", () => {
  const running = useAppWithServices();
  let admin: Parent;
  let member: Parent;

  const asAdmin = () => as(running.server, admin);
  const asMember = () => as(running.server, member);
  const rowsOf = ({ family }: Household) => assignmentRows(running.databaseUrl, family.id);
  const readerIdsOf = async (household: Household) =>
    (await rowsOf(household)).map(({ child_id }) => child_id);

  /** Who did what to the family's book, as its audit events record it, oldest first. */
  const bookEventsOf = (familyId: string, bookId: string) =>
    query<{ action: string; actor_id: string; details: Record<string, unknown> }>(
      running.databaseUrl,
      `select action, actor_id, details from audit_events
       where family_id = $1 and target_kind = 'book' and target_id = $2
       order by occurred_at, id`,
      [familyId, bookId],
    );

  /** A new household with no books. */
  async function household(): Promise<Household> {
    const family = await createFamily(running.server, admin);
    await addMember(running.databaseUrl, family.id, member.id);
    const xiaomi = await addChild(running.server, admin, family.id, { nickname: '小米' });
    const doudou = await addChild(running.server, admin, family.id, { nickname: '豆豆' });
    return { family, xiaomi, doudou };
  }

  /** A new household that has the active book, read by the children picked, by none at first. */
  async function withBook(
    readers: (household: Household) => Child[] = () => [],
  ): Promise<Household> {
    const created = await household();
    await acquire(running.server, admin, created.family.id, ACTIVE_BOOK);
    const childIds = readers(created).map(({ id }) => id);
    if (childIds.length > 0) {
      await setReaders(running.server, admin, bookOf(created), childIds);
    }
    return created;
  }

  /** The household's active book. */
  const bookOf = ({ family }: Household) => ({ familyId: family.id, bookId: ACTIVE_BOOK });

  /** Asks to set the household's active book's readers as the parent, by the client given. */
  const putReaders = (client: ReturnType<typeof as>, { family }: Household, childIds: string[]) =>
    client.put(readersPath(family.id, ACTIVE_BOOK), { childIds });

  beforeAll(async () => {
    [admin, member] = await Promise.all([
      signInParent(running.server, { name: '林悦' }),
      signInParent(running.server, { name: '周子航' }),
    ]);
  });

  describe('acquiring', () => {
    it('takes the book into the family, recording when, and who in the audit events, and answers it', async () => {
      const { family } = await household();
      const before = Date.now();

      const response = await asMember().put(acquisitionPath(family.id, ACTIVE_BOOK), {});

      expect(response.status).toBe(200);
      expect(bookDetailSchema.parse(response.body)).toMatchObject({
        id: ACTIVE_BOOK,
        acquired: true,
        readers: [],
        replacement: null,
      });
      const [row] = await familyBookRows(running.databaseUrl, family.id);
      expect(row).toMatchObject({ book_id: ACTIVE_BOOK });
      expect(row?.acquired_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(await bookEventsOf(family.id, ACTIVE_BOOK)).toEqual([
        { action: 'book.acquired', actor_id: member.id, details: {} },
      ]);
    });

    it('is seen at once by the book page and the family scope', async () => {
      const { family } = await household();

      await acquire(running.server, member, family.id, OTHER_BOOK);

      const page = await asAdmin().get(bookPath(family.id, OTHER_BOOK));
      const list = await asAdmin().get(`${booksPath(family.id)}?scope=family`);
      expect(bookDetailSchema.parse(page.body).acquired).toBe(true);
      expect(bookListResponseSchema.parse(list.body).books.map(({ id }) => id)).toEqual([
        OTHER_BOOK,
      ]);
    });

    it('answers a book the family has already with 200 and keeps the first acquisition', async () => {
      const { family } = await withBook();
      const before = await familyBookRows(running.databaseUrl, family.id);

      const response = await asMember().put(acquisitionPath(family.id, ACTIVE_BOOK), {});

      expect(response.status).toBe(200);
      expect(await familyBookRows(running.databaseUrl, family.id)).toEqual(before);
    });

    it('refuses an inactive book the family does not have with 409 book_inactive', async () => {
      const { family } = await household();

      const response = await asMember().put(acquisitionPath(family.id, INACTIVE_BOOK), {});

      expect(outcomesOf([response])).toEqual([[409, 'book_inactive']]);
      expect(await familyBookRows(running.databaseUrl, family.id)).toEqual([]);
    });

    it('answers an inactive book the family has already with 200', async () => {
      const { family } = await household();
      await insertFamilyBook(running.databaseUrl, family.id, INACTIVE_BOOK);

      const response = await asMember().put(acquisitionPath(family.id, INACTIVE_BOOK), {});

      expect(response.status).toBe(200);
      expect(bookDetailSchema.parse(response.body)).toMatchObject({
        status: 'inactive',
        acquired: true,
      });
    });

    it('answers a book that does not exist with 404 book_not_found', async () => {
      const { family } = await household();

      const responses = [
        await asMember().put(acquisitionPath(family.id, 'no-such-book'), {}),
        await asMember().put(acquisitionPath(family.id, 'Bad_Id'), {}),
      ];

      expect(outcomesOf(responses)).toEqual([
        [404, 'book_not_found'],
        [404, 'book_not_found'],
      ]);
    });

    it('acquires once, and records it once, when two parents acquire the book at the same time', async () => {
      for (let round = 0; round < RACE_ROUNDS; round += 1) {
        const { family } = await household();

        const responses = await Promise.all([
          asAdmin().put(acquisitionPath(family.id, ACTIVE_BOOK), {}),
          asMember().put(acquisitionPath(family.id, ACTIVE_BOOK), {}),
        ]);

        expect(statusesOf(responses)).toEqual([200, 200]);
        expect(await familyBookRows(running.databaseUrl, family.id)).toHaveLength(1);
        expect(await bookEventsOf(family.id, ACTIVE_BOOK)).toHaveLength(1);
      }
    });
  });

  describe('removing', () => {
    it('removes a book no child reads, and the next read sees it gone', async () => {
      const { family } = await withBook();

      const response = await asMember().delete(acquisitionPath(family.id, ACTIVE_BOOK));

      expect(response.status).toBe(204);
      expect(await familyBookRows(running.databaseUrl, family.id)).toEqual([]);
      const page = await asMember().get(bookPath(family.id, ACTIVE_BOOK));
      expect(bookDetailSchema.parse(page.body).acquired).toBe(false);
    });

    it('answers 204 for a book the family does not have, and for a removal done already', async () => {
      const { family } = await withBook();

      const responses = [
        await asMember().delete(acquisitionPath(family.id, ACTIVE_BOOK)),
        await asAdmin().delete(acquisitionPath(family.id, ACTIVE_BOOK)),
        await asAdmin().delete(acquisitionPath(family.id, OTHER_BOOK)),
        await asAdmin().delete(acquisitionPath(family.id, INACTIVE_BOOK)),
      ];

      expect(statusesOf(responses)).toEqual([204, 204, 204, 204]);
    });

    it('removes an inactive book, which its page then does not find', async () => {
      const { family } = await household();
      await insertFamilyBook(running.databaseUrl, family.id, INACTIVE_BOOK);

      await asMember().delete(acquisitionPath(family.id, INACTIVE_BOOK)).expect(204);

      const page = await asMember().get(bookPath(family.id, INACTIVE_BOOK));
      expect(outcomesOf([page])).toEqual([[404, 'book_not_found']]);
    });

    it('refuses a book a child reads with 409 book_in_use and keeps it', async () => {
      const ours = await withBook(({ xiaomi }) => [xiaomi]);
      const removal = () => asMember().delete(acquisitionPath(ours.family.id, ACTIVE_BOOK));

      const refused = await removal();
      await setReaders(running.server, admin, bookOf(ours), []);
      const removed = await removal();

      expect(outcomesOf([refused])).toEqual([[409, 'book_in_use']]);
      expect(removed.status).toBe(204);
    });

    it('answers a book that does not exist with 404 book_not_found', async () => {
      const { family } = await household();

      const response = await asMember().delete(acquisitionPath(family.id, 'no-such-book'));

      expect(outcomesOf([response])).toEqual([[404, 'book_not_found']]);
    });

    it('removes once when two parents remove the book at the same time', async () => {
      for (let round = 0; round < RACE_ROUNDS; round += 1) {
        const { family } = await withBook();

        const responses = await Promise.all([
          asAdmin().delete(acquisitionPath(family.id, ACTIVE_BOOK)),
          asMember().delete(acquisitionPath(family.id, ACTIVE_BOOK)),
        ]);

        expect(statusesOf(responses)).toEqual([204, 204]);
        expect(await familyBookRows(running.databaseUrl, family.id)).toEqual([]);
      }
    });

    it('never leaves a reader of a removed book when one parent removes it as another assigns it', async () => {
      for (let round = 0; round < RACE_ROUNDS; round += 1) {
        const ours = await withBook();

        const [removal, assignment] = await Promise.all([
          asAdmin().delete(acquisitionPath(ours.family.id, ACTIVE_BOOK)),
          putReaders(asMember(), ours, [ours.xiaomi.id]),
        ]);

        const books = await familyBookRows(running.databaseUrl, ours.family.id);
        if (removal.status === 204) {
          expect(outcomesOf([assignment])).toEqual([[409, 'book_not_acquired']]);
          expect([books, await rowsOf(ours)]).toEqual([[], []]);
        } else {
          expect(outcomesOf([removal])).toEqual([[409, 'book_in_use']]);
          expect(assignment.status).toBe(200);
          expect(await readerIdsOf(ours)).toEqual([ours.xiaomi.id]);
        }
      }
    });
  });

  describe('setting the readers', () => {
    it('assigns the book to the children, records who did, and answers them in the order they were added', async () => {
      const ours = await withBook();

      const response = await putReaders(asMember(), ours, [
        ours.doudou.id,
        ours.xiaomi.id,
        ours.doudou.id,
      ]);

      expect(response.status).toBe(200);
      expect(bookDetailSchema.parse(response.body).readers).toEqual([
        { childId: ours.xiaomi.id, nickname: '小米' },
        { childId: ours.doudou.id, nickname: '豆豆' },
      ]);
      const rows = await rowsOf(ours);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row).toMatchObject({ book_id: ACTIVE_BOOK, opened_at: null });
      }
      expect((await bookEventsOf(ours.family.id, ACTIVE_BOOK)).at(-1)).toEqual({
        action: 'book.readers_changed',
        actor_id: member.id,
        details: { added: [ours.doudou.id, ours.xiaomi.id], removed: [] },
      });
    });

    it('takes the book from the children left out and leaves those kept as they were', async () => {
      const ours = await withBook(({ xiaomi, doudou }) => [xiaomi, doudou]);
      await markOpened(running.databaseUrl, ours.doudou.id, ACTIVE_BOOK);
      const kept = (await rowsOf(ours)).find(({ child_id }) => child_id === ours.doudou.id);

      const detail = await setReaders(running.server, member, bookOf(ours), [ours.doudou.id]);

      expect(detail.readers).toEqual([{ childId: ours.doudou.id, nickname: '豆豆' }]);
      expect(await rowsOf(ours)).toEqual([kept]);
      expect(kept?.opened_at).not.toBeNull();
    });

    it('answers the readers it has already with 200 and changes nothing', async () => {
      const ours = await withBook(({ xiaomi }) => [xiaomi]);
      const before = await rowsOf(ours);

      const detail = await setReaders(running.server, member, bookOf(ours), [ours.xiaomi.id]);

      expect(detail.readers).toEqual([{ childId: ours.xiaomi.id, nickname: '小米' }]);
      expect(await rowsOf(ours)).toEqual(before);
    });

    it('assigns a book taken away and given again as a new, unopened one', async () => {
      const ours = await withBook(({ xiaomi }) => [xiaomi]);
      await markOpened(running.databaseUrl, ours.xiaomi.id, ACTIVE_BOOK);

      await setReaders(running.server, admin, bookOf(ours), []);
      await setReaders(running.server, admin, bookOf(ours), [ours.xiaomi.id]);

      expect(await rowsOf(ours)).toEqual([
        expect.objectContaining({ child_id: ours.xiaomi.id, opened_at: null }),
      ]);
    });

    it('refuses a book the family does not have with 409 book_not_acquired', async () => {
      const ours = await household();

      const responses = [
        await putReaders(asMember(), ours, [ours.xiaomi.id]),
        await putReaders(asMember(), ours, []),
      ];

      expect(outcomesOf(responses)).toEqual([
        [409, 'book_not_acquired'],
        [409, 'book_not_acquired'],
      ]);
      expect(await rowsOf(ours)).toEqual([]);
    });

    it('takes an inactive book from its readers but refuses a new reader with 409 book_inactive', async () => {
      const ours = await household();
      const { family, xiaomi, doudou } = ours;
      const inactive = { familyId: family.id, bookId: INACTIVE_BOOK };
      await insertFamilyBook(running.databaseUrl, family.id, INACTIVE_BOOK);
      await insertAssignment(running.databaseUrl, inactive, xiaomi.id);
      const setTo = (childIds: string[]) =>
        asMember().put(readersPath(family.id, INACTIVE_BOOK), { childIds });

      const refused = await setTo([xiaomi.id, doudou.id]);
      const kept = await setTo([xiaomi.id]);
      const taken = await setTo([]);

      expect(outcomesOf([refused])).toEqual([[409, 'book_inactive']]);
      expect([kept.status, taken.status]).toEqual([200, 200]);
      expect(bookDetailSchema.parse(taken.body).readers).toEqual([]);
      expect(await rowsOf(ours)).toEqual([]);
    });

    it('refuses a child not in the family with 404 child_not_found and changes nothing', async () => {
      const ours = await withBook(({ xiaomi }) => [xiaomi]);
      const other = await household();
      const deleted = await addChild(running.server, admin, ours.family.id);
      await asAdmin().delete(childPath(ours.family.id, deleted.id)).expect(204);
      const before = await rowsOf(ours);

      const responses = await Promise.all(
        [other.xiaomi.id, deleted.id, crypto.randomUUID()].map((childId) =>
          putReaders(asMember(), ours, [ours.doudou.id, childId]),
        ),
      );

      expect(outcomesOf(responses)).toEqual(responses.map(() => [404, 'child_not_found']));
      expect(await rowsOf(ours)).toEqual(before);
      expect(await rowsOf(other)).toEqual([]);
    });

    it('answers a book that does not exist with 404 book_not_found', async () => {
      const { family, xiaomi } = await household();

      const response = await asMember().put(readersPath(family.id, 'no-such-book'), {
        childIds: [xiaomi.id],
      });

      expect(outcomesOf([response])).toEqual([[404, 'book_not_found']]);
    });

    it('answers a malformed body with 400 and the fields', async () => {
      const ours = await withBook();

      const cases: Array<[object, Array<{ path: string; code: string }>]> = [
        [{}, [{ path: 'childIds', code: 'required' }]],
        [{ childIds: 'all' }, [{ path: 'childIds', code: 'invalid' }]],
        [{ childIds: ['not-a-uuid'] }, [{ path: 'childIds.0', code: 'invalid' }]],
        [{ childIds: [], familyId: ours.family.id }, [{ path: '', code: 'invalid' }]],
      ];

      for (const [body, fields] of cases) {
        const response = await asMember().put(readersPath(ours.family.id, ACTIVE_BOOK), body);

        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({ error: { code: 'invalid_request', fields } });
      }
    });

    it('takes the book from a child who is deleted', async () => {
      const ours = await withBook(({ xiaomi, doudou }) => [xiaomi, doudou]);

      await asAdmin().delete(childPath(ours.family.id, ours.xiaomi.id)).expect(204);

      expect(await readerIdsOf(ours)).toEqual([ours.doudou.id]);
      const page = await asMember().get(bookPath(ours.family.id, ACTIVE_BOOK)).expect(200);
      expect(bookDetailSchema.parse(page.body).readers).toEqual([
        { childId: ours.doudou.id, nickname: '豆豆' },
      ]);
    });

    it('keeps the last change when two parents set the readers at the same time', async () => {
      for (let round = 0; round < RACE_ROUNDS; round += 1) {
        const ours = await withBook();
        const choices = [[ours.xiaomi.id], [ours.doudou.id]];

        const responses = await Promise.all([
          putReaders(asAdmin(), ours, choices[0] ?? []),
          putReaders(asMember(), ours, choices[1] ?? []),
        ]);

        expect(statusesOf(responses)).toEqual([200, 200]);
        expect(choices).toContainEqual(await readerIdsOf(ours));
      }
    });

    it('answers 200 to both parents choosing the same readers at the same time', async () => {
      for (let round = 0; round < RACE_ROUNDS; round += 1) {
        const ours = await withBook();

        const responses = await Promise.all([
          putReaders(asAdmin(), ours, [ours.xiaomi.id]),
          putReaders(asMember(), ours, [ours.xiaomi.id]),
        ]);

        expect(statusesOf(responses)).toEqual([200, 200]);
        expect(await rowsOf(ours)).toHaveLength(1);
      }
    });

    it('refuses a child deleted while it is being assigned, or assigns it before the deletion', async () => {
      for (let round = 0; round < RACE_ROUNDS; round += 1) {
        const ours = await withBook();

        const [assignment, deletion] = await Promise.all([
          putReaders(asMember(), ours, [ours.xiaomi.id]),
          asAdmin().delete(childPath(ours.family.id, ours.xiaomi.id)),
        ]);

        expect(deletion.status).toBe(204);
        if (assignment.status !== 200) {
          expect(outcomesOf([assignment])).toEqual([[404, 'child_not_found']]);
        }
        expect(await rowsOf(ours)).toEqual([]);
      }
    });
  });
});
