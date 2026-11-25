import { childBooksResponseSchema, type Child, type FamilyDetail } from '@thinklet/contracts';
import {
  ACTIVE_BOOK,
  CHILD_BOOKS_PATH,
  INACTIVE_BOOK,
  acquire,
  getAsChild,
  insertAssignment,
  insertFamilyBook,
  markOpened,
  setReaders,
} from '../support/books.js';
import { addChild } from '../support/children.js';
import {
  createFamily,
  signInParent,
  useAppWithServices,
  type Parent,
} from '../support/families.js';

const COVER_URL = /^\/api\/books\/[a-z0-9-]+\/cover\?v=[0-9a-f]{64}$/;

// Acceptance criteria covered: a signed-in child sees the books assigned
// to them, all at once, the latest assignment first, with the inactive ones
// marked; the books the child has not opened are new, and their number is
// answered with them; a book taken away is gone at once.
describe("the child's books", () => {
  const running = useAppWithServices();
  let parent: Parent;
  let family: FamilyDetail;

  const booksOf = async (child: Child) => {
    const response = await getAsChild(running.server, child.id, CHILD_BOOKS_PATH);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return childBooksResponseSchema.parse(response.body);
  };

  beforeAll(async () => {
    parent = await signInParent(running.server, { name: '林悦' });
    family = await createFamily(running.server, parent);
    for (const bookId of [ACTIVE_BOOK, 'abc-songs', 'pinyin-train']) {
      await acquire(running.server, parent, family.id, bookId);
    }
  });

  it('answers no books for a child who has none', async () => {
    const child = await addChild(running.server, parent, family.id);

    expect(await booksOf(child)).toEqual({ books: [], newCount: 0 });
  });

  it('answers the books assigned to the child, latest first, all new', async () => {
    const child = await addChild(running.server, parent, family.id);
    for (const bookId of [ACTIVE_BOOK, 'abc-songs', 'pinyin-train']) {
      await setReaders(running.server, parent, { familyId: family.id, bookId }, [child.id]);
    }

    const { books, newCount } = await booksOf(child);

    expect(books.map(({ id }) => id)).toEqual(['pinyin-train', 'abc-songs', ACTIVE_BOOK]);
    expect(newCount).toBe(3);
    expect(books.find(({ id }) => id === ACTIVE_BOOK)).toEqual({
      id: ACTIVE_BOOK,
      title: '胡萝卜数数大冒险',
      intro: expect.any(String),
      grade: { id: 'grade-1', name: '一年级' },
      subject: { id: 'math', name: '数学' },
      status: 'active',
      coverUrl: expect.stringMatching(COVER_URL),
      isNew: true,
    });
  });

  it('answers a book the child has opened as not new and leaves it out of the count', async () => {
    const child = await addChild(running.server, parent, family.id);
    await setReaders(running.server, parent, { familyId: family.id, bookId: ACTIVE_BOOK }, [
      child.id,
    ]);
    await setReaders(running.server, parent, { familyId: family.id, bookId: 'abc-songs' }, [
      child.id,
    ]);
    await markOpened(running.databaseUrl, child.id, ACTIVE_BOOK);

    const { books, newCount } = await booksOf(child);

    expect(books.map(({ id, isNew }) => ({ id, isNew }))).toEqual([
      { id: 'abc-songs', isNew: true },
      { id: ACTIVE_BOOK, isNew: false },
    ]);
    expect(newCount).toBe(1);
  });

  it('answers an inactive book the child still has, marked inactive', async () => {
    const ours = await createFamily(running.server, parent);
    const child = await addChild(running.server, parent, ours.id);
    await insertFamilyBook(running.databaseUrl, ours.id, INACTIVE_BOOK);
    await insertAssignment(
      running.databaseUrl,
      { familyId: ours.id, bookId: INACTIVE_BOOK },
      child.id,
    );

    const { books } = await booksOf(child);

    expect(books.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: INACTIVE_BOOK, status: 'inactive' },
    ]);
  });

  it("answers only the child's own books and drops a book taken away at once", async () => {
    const child = await addChild(running.server, parent, family.id);
    const sibling = await addChild(running.server, parent, family.id);
    await setReaders(running.server, parent, { familyId: family.id, bookId: 'pinyin-train' }, [
      child.id,
      sibling.id,
    ]);
    await setReaders(running.server, parent, { familyId: family.id, bookId: 'abc-songs' }, [
      sibling.id,
    ]);

    const before = await booksOf(child);
    await setReaders(running.server, parent, { familyId: family.id, bookId: 'pinyin-train' }, [
      sibling.id,
    ]);
    const after = await booksOf(child);

    expect(before.books.map(({ id }) => id)).toEqual(['pinyin-train']);
    expect(after).toEqual({ books: [], newCount: 0 });
    expect((await booksOf(sibling)).books.map(({ id }) => id)).toEqual([
      'abc-songs',
      'pinyin-train',
    ]);
  });
});
