import {
  AUDIT_CASES,
  businessSnapshot,
  PersonalData,
  refusingAuditOf,
  rowsAddedBy,
  type AuditContext,
} from '../support/audit.js';
import { acquire, acquisitionPath, ACTIVE_BOOK, readersPath } from '../support/books.js';
import { addChildWithPassword, ChildBrowser } from '../support/child-login.js';
import { query } from '../support/database.js';
import {
  addMember,
  as,
  createFamily,
  signInParent,
  useAppWithServices,
} from '../support/families.js';
import { newUser, signIn } from '../support/login.js';

/** What the database answers any update, delete or truncate of the audit events with. */
const APPEND_ONLY = 'audit_events rows are never changed or deleted';

// Acceptance criterion covered (#14, 30): every request that changes data
// writes one audit row, with the event name, the actor, the target, the
// family and the details of the design, in the same transaction as the
// change: when the row cannot be written the change is not made either,
// neither in the database nor in the login links in Redis, and a change
// that is refused or changes nothing writes no row. Logins write none, and
// the rows are never changed or deleted.
describe('audit events', () => {
  const running = useAppWithServices();
  const context = (): AuditContext => ({
    target: running.server,
    databaseUrl: running.databaseUrl,
    personal: new PersonalData(),
  });
  const snapshot = () => businessSnapshot(running.databaseUrl, running.redisUrl);

  describe.each(AUDIT_CASES.map((auditCase) => [auditCase.action, auditCase] as const))(
    '%s',
    (_action, auditCase) => {
      it('writes the one audit row of the change, at the time of the change', async () => {
        const arranged = await auditCase.arrange(context());
        const before = Date.now();

        const { result: response, added } = await rowsAddedBy(running.databaseUrl, arranged.act);

        expect(response.status).toBe(arranged.status);
        expect(added).toHaveLength(1);
        const [row] = added;
        if (row === undefined) {
          return;
        }
        const { id, occurred_at: occurredAt, ...stored } = row;
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        expect(occurredAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
        expect(occurredAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
        expect(stored).toEqual(await arranged.expected(response));
      });

      it('makes no change when its audit row cannot be written', async () => {
        const arranged = await auditCase.arrange(context());
        const before = await snapshot();

        const { result: response, added } = await rowsAddedBy(running.databaseUrl, () =>
          refusingAuditOf(running.databaseUrl, auditCase.action, arranged.act),
        );

        expect(response.status).toBe(arranged.failedStatus ?? 500);
        expect(added).toEqual([]);
        expect(await snapshot()).toEqual(before);
      });
    },
  );

  it('covers every action of the design that the api makes today', () => {
    expect(new Set(AUDIT_CASES.map(({ action }) => action))).toEqual(
      new Set([
        'parent.created',
        'parent.renamed',
        'family.created',
        'family.updated',
        'family.code_changed',
        'member.admin_transferred',
        'member.removed',
        'member.left',
        'join_request.created',
        'join_request.withdrawn',
        'join_request.dismissed',
        'join_request.approved',
        'join_request.rejected',
        'child.created',
        'child.updated',
        'child.deleted',
        'child.password_reset',
        'child.password_set',
        'child.login_link_created',
        'child.devices_revoked',
        'book.acquired',
        'book.removed',
        'book.readers_changed',
      ]),
    );
  });

  describe('writes no row', () => {
    it('for a change that is refused', async () => {
      const admin = await signInParent(running.server);
      const member = await signInParent(running.server);
      const family = await createFamily(running.server, admin);
      await addMember(running.databaseUrl, family.id, member.id);

      const { result: response, added } = await rowsAddedBy(running.databaseUrl, () =>
        as(running.server, member).patch(`/api/families/${family.id}`, { name: '外婆家' }),
      );

      expect(response.status).toBe(403);
      expect(added).toEqual([]);
    });

    it('for a change that changes nothing', async () => {
      const admin = await signInParent(running.server);
      const family = await createFamily(running.server, admin);
      await acquire(running.server, admin, family.id, ACTIVE_BOOK);

      const { added } = await rowsAddedBy(running.databaseUrl, async () => {
        await as(running.server, admin)
          .put(acquisitionPath(family.id, ACTIVE_BOOK), {})
          .expect(200);
        await as(running.server, admin)
          .put(readersPath(family.id, ACTIVE_BOOK), { childIds: [] })
          .expect(200);
        await as(running.server, admin).patch(`/api/families/${family.id}`, {}).expect(200);
      });

      expect(added).toEqual([]);
    });

    it("for a parent's later login", async () => {
      const user = newUser();
      await signIn(running.server, user);

      const { added } = await rowsAddedBy(running.databaseUrl, () => signIn(running.server, user));

      expect(added).toEqual([]);
    });

    it("for a child's login", async () => {
      const admin = await signInParent(running.server);
      const family = await createFamily(running.server, admin);
      const child = await addChildWithPassword(running.server, admin, family.id);

      const { result: response, added } = await rowsAddedBy(running.databaseUrl, () =>
        new ChildBrowser(running.server).login({
          code: family.code,
          account: child.account,
          password: child.password,
          remember: true,
        }),
      );

      expect(response.status).toBe(200);
      expect(added).toEqual([]);
    });
  });

  it('keeps every row: the table refuses updates, deletes and truncation', async () => {
    await signInParent(running.server);

    for (const statement of [
      "update audit_events set action = 'changed'",
      'delete from audit_events',
      'truncate audit_events',
    ]) {
      await expect(query(running.databaseUrl, statement), statement).rejects.toThrow(APPEND_ONLY);
    }
  });

  it('keeps the rows of a child after the child is deleted', async () => {
    const admin = await signInParent(running.server);
    const family = await createFamily(running.server, admin);
    const child = await addChildWithPassword(running.server, admin, family.id);

    await as(running.server, admin)
      .delete(`/api/families/${family.id}/children/${child.id}`)
      .expect(204);

    const rows = await query<{ action: string }>(
      running.databaseUrl,
      "select action from audit_events where target_kind = 'child' and target_id = $1 order by occurred_at",
      [child.id],
    );
    expect(rows.map(({ action }) => action)).toEqual([
      'child.created',
      'child.login_link_created',
      'child.password_set',
      'child.deleted',
    ]);
  });
});
