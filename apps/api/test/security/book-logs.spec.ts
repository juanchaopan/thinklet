import type request from 'supertest';
import { startBuiltAppWithServices, type BuiltAppWithServices } from '../support/app.js';
import {
  ACTIVE_BOOK,
  CHILD_BOOKS_PATH,
  acquire,
  acquisitionPath,
  bookPath,
  booksPath,
  getAsChild,
  readersPath,
  setReaders,
} from '../support/books.js';
import { addChild } from '../support/children.js';
import { as, createFamily, signInParent } from '../support/families.js';

// The library answers with the nicknames of the children who read a book,
// which are a child's personal data, so none may reach the logs: not on
// the routes that answer with them, nor when a change is refused. The
// built api runs as a separate process and everything it writes is read,
// as the platform's log collector would.
describe('Logs of the book routes', () => {
  const nickname = '米粒书logs';
  let started: BuiltAppWithServices;
  let output: string;
  let responses: request.Response[];

  beforeAll(async () => {
    started = await startBuiltAppWithServices();
    const parent = await signInParent(started.api);
    const familyId = (await createFamily(started.api, parent)).id;
    const child = await addChild(started.api, parent, familyId, { nickname });
    const book = { familyId, bookId: ACTIVE_BOOK };
    await acquire(started.api, parent, familyId, ACTIVE_BOOK);
    await setReaders(started.api, parent, book, [child.id]);

    const client = as(started.api, parent);
    responses = [
      await client.get(booksPath(familyId)),
      await client.get(`${booksPath(familyId)}?scope=child&child=${child.id}`),
      await client.get(bookPath(familyId, ACTIVE_BOOK)),
      await client.delete(acquisitionPath(familyId, ACTIVE_BOOK)),
      await client.put(readersPath(familyId, ACTIVE_BOOK), {
        childIds: [child.id, crypto.randomUUID()],
      }),
      await getAsChild(started.api, child.id, CHILD_BOOKS_PATH),
    ];

    output = await started.stopApp();
  });

  afterAll(async () => {
    await started?.stop();
  });

  it('logged the requests, answered as expected', () => {
    expect(responses.map(({ status }) => status)).toEqual([200, 200, 200, 409, 404, 200]);
    expect(output).toContain('/books');
  });

  it("contains no child's nickname", () => {
    expect(output).not.toContain(nickname);
  });
});
