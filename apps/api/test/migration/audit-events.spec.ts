import { randomBytes, randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Client } from 'pg';
import { migrateThrough, migrationRows, startDatabaseBefore } from '../support/migrations.js';

const TAG = '0004_audit_events';

const CHECK_VIOLATION = '23514';

/** What the database answers any update, delete or truncate of the audit events with. */
const APPEND_ONLY = 'audit_events rows are never changed or deleted';

/** The issuer the migration test's parents sign in with (`migrationRows`). */
const ISSUER = 'https://issuer.example';

/** Times of the previous version's rows, apart from each other and from now. */
const AT = {
  consent: new Date('2026-11-20T08:00:00Z'),
  otherConsent: new Date('2026-11-20T08:30:00Z'),
  approved: new Date('2026-11-21T09:00:00Z'),
  rejected: new Date('2026-11-21T09:30:00Z'),
  withdrawn: new Date('2026-11-21T10:00:00Z'),
  acquired: new Date('2026-11-22T07:00:00Z'),
  otherAcquired: new Date('2026-11-22T07:30:00Z'),
  assigned: new Date('2026-11-23T06:00:00Z'),
  otherAssigned: new Date('2026-11-23T06:30:00Z'),
};

/** A row of the audit events as the test compares it: every column but the id. */
interface StoredEvent {
  occurred_at: Date;
  actor_kind: string;
  actor_id: string | null;
  actor_issuer: string | null;
  actor_subject: string | null;
  action: string;
  target_kind: string;
  target_id: string;
  family_id: string | null;
  details: unknown;
}

/** What a parent did to what, when, and with which details. */
interface Done {
  by: string;
  at: Date;
  action: string;
  targetKind: string;
  targetId: string;
  details?: Record<string, unknown>;
}

/** The parents, family, children and requests of the previous version. */
interface EarlierData {
  admin: string;
  other: string;
  familyId: string;
  xiaomi: string;
  doudou: string;
  approved: string;
  approvedApplicant: string;
  rejected: string;
  rejectedApplicant: string;
  pending: string;
  withdrawn: string;
}

// The who-did-it columns of the previous version (#14, 30): the guardian's
// consent of each child, the admin who decided each request, the parent who
// acquired each book and who assigned it become audit events at the time of
// their own rows, and the columns go. The audit events reference no table,
// are only ever added, and take a parent, a child or the site as the actor.
// The rows a test adds itself are of no family of the previous version.
describe(`migration ${TAG}`, () => {
  let database: StartedPostgreSqlContainer;
  let client: Client;
  let earlier: EarlierData;
  const subjects = new Map<string, string>();
  const { rows, insertedId, newParent, newFamily } = migrationRows(() => client);

  /** A parent of the previous version, whose Authing subject the test keeps. */
  async function parent(): Promise<string> {
    const id = await newParent();
    const [row] = await rows<{ oidc_subject: string }>(
      'select oidc_subject from parents where id = $1',
      [id],
    );
    subjects.set(id, row?.oidc_subject ?? '');
    return id;
  }

  /** The audit row of what a parent did in the family of the previous version. */
  const eventOf = ({ by, at, action, targetKind, targetId, details = {} }: Done) => ({
    occurred_at: at,
    actor_kind: 'parent',
    actor_id: by,
    actor_issuer: ISSUER,
    actor_subject: subjects.get(by),
    action,
    target_kind: targetKind,
    target_id: targetId,
    family_id: earlier.familyId,
    details,
  });

  /** A child of the previous version, with the consent of the parent at the time. */
  function child(familyId: string, consentParentId: string, consentedAt: Date): Promise<string> {
    return insertedId(
      `insert into children
         (family_id, nickname, account, account_lookup, consent_parent_id, consent_version, consented_at)
       values ($1, 'nickname-ciphertext', 'account-ciphertext', $2, $3, '2026-11-22', $4)
       returning id`,
      [familyId, randomBytes(32).toString('hex'), consentParentId, consentedAt],
    );
  }

  /** A join request of the previous version, closed by the parent at the time when it is closed. */
  async function request(
    familyId: string,
    status: string,
    closed?: { by: string | null; at: Date },
  ): Promise<{ id: string; applicant: string }> {
    const applicant = await parent();
    const [family] = await rows<{ code: string }>('select code from families where id = $1', [
      familyId,
    ]);
    const id = await insertedId(
      `insert into join_requests (family_id, parent_id, code, status, closed_at, closed_by)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [familyId, applicant, family?.code, status, closed?.at ?? null, closed?.by ?? null],
    );
    return { id, applicant };
  }

  async function columnsOf(table: string): Promise<string[]> {
    const found = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = $1`,
      [table],
    );
    return found.map(({ column_name }) => column_name);
  }

  /** The audit rows of the family of the previous version without their ids, in a fixed order. */
  async function storedEvents(): Promise<StoredEvent[]> {
    return rows<StoredEvent>(
      `select occurred_at, actor_kind, actor_id, actor_issuer, actor_subject, action,
              target_kind, target_id, family_id, details
       from audit_events where family_id = $1 order by occurred_at, action, target_id`,
      [earlier.familyId],
    );
  }

  /**
   * What a statement fails with: the message of an exception the database
   * raised itself, else the SQLSTATE; undefined when it succeeds.
   */
  async function failureOf(text: string, values: unknown[] = []): Promise<string | undefined> {
    try {
      await client.query(text, values);
      return undefined;
    } catch (error) {
      const { code, message } = error as { code?: string; message?: string };
      return code === 'P0001' ? message : code;
    }
  }

  beforeAll(async () => {
    const started = await startDatabaseBefore(TAG);
    ({ database, client } = started);

    const admin = await parent();
    const other = await parent();
    const familyId = await newFamily();
    await client.query(
      `insert into family_members (family_id, parent_id, role) values ($1, $2, 'admin')`,
      [familyId, admin],
    );
    const xiaomi = await child(familyId, admin, AT.consent);
    const doudou = await child(familyId, other, AT.otherConsent);
    const approved = await request(familyId, 'approved', { by: admin, at: AT.approved });
    const rejected = await request(familyId, 'rejected', { by: admin, at: AT.rejected });
    const pending = await request(familyId, 'pending');
    const withdrawn = await request(familyId, 'withdrawn', { by: null, at: AT.withdrawn });
    await client.query(
      `insert into family_books (family_id, book_id, acquired_by, acquired_at)
       values ($1, 'carrot-counting', $2, $3), ($1, 'abc-songs', $4, $5)`,
      [familyId, other, AT.acquired, admin, AT.otherAcquired],
    );
    await client.query(
      `insert into book_assignments (child_id, family_id, book_id, assigned_by, assigned_at)
       values ($1, $3, 'carrot-counting', $4, $5), ($2, $3, 'carrot-counting', $4, $5),
              ($1, $3, 'abc-songs', $6, $7)`,
      [xiaomi, doudou, familyId, admin, AT.assigned, other, AT.otherAssigned],
    );
    earlier = {
      admin,
      other,
      familyId,
      xiaomi,
      doudou,
      approved: approved.id,
      approvedApplicant: approved.applicant,
      rejected: rejected.id,
      rejectedApplicant: rejected.applicant,
      pending: pending.id,
      withdrawn: withdrawn.id,
    };

    await migrateThrough(started.url, TAG);
  });

  afterAll(async () => {
    await client?.end();
    await database?.stop();
  });

  it('writes the who-did-it columns of the previous version as audit rows, each at its own time', async () => {
    const { admin, other, xiaomi, doudou } = earlier;
    const consent = { consentVersion: '2026-11-22' };

    expect(await storedEvents()).toEqual([
      eventOf({
        by: admin,
        at: AT.consent,
        action: 'child.created',
        targetKind: 'child',
        targetId: xiaomi,
        details: consent,
      }),
      eventOf({
        by: other,
        at: AT.otherConsent,
        action: 'child.created',
        targetKind: 'child',
        targetId: doudou,
        details: consent,
      }),
      eventOf({
        by: admin,
        at: AT.approved,
        action: 'join_request.approved',
        targetKind: 'join_request',
        targetId: earlier.approved,
        details: { parentId: earlier.approvedApplicant },
      }),
      eventOf({
        by: admin,
        at: AT.rejected,
        action: 'join_request.rejected',
        targetKind: 'join_request',
        targetId: earlier.rejected,
        details: { parentId: earlier.rejectedApplicant },
      }),
      eventOf({
        by: other,
        at: AT.acquired,
        action: 'book.acquired',
        targetKind: 'book',
        targetId: 'carrot-counting',
      }),
      eventOf({
        by: admin,
        at: AT.otherAcquired,
        action: 'book.acquired',
        targetKind: 'book',
        targetId: 'abc-songs',
      }),
      eventOf({
        by: admin,
        at: AT.assigned,
        action: 'book.readers_changed',
        targetKind: 'book',
        targetId: 'carrot-counting',
        details: { added: [xiaomi, doudou].sort(), removed: [] },
      }),
      eventOf({
        by: other,
        at: AT.otherAssigned,
        action: 'book.readers_changed',
        targetKind: 'book',
        targetId: 'abc-songs',
        details: { added: [xiaomi], removed: [] },
      }),
    ]);
  });

  it('writes no row for a request no admin decided', async () => {
    const decidedRequests = await rows<{ target_id: string }>(
      `select target_id from audit_events where target_kind = 'join_request'`,
    );
    const ids = decidedRequests.map(({ target_id }) => target_id);
    expect(ids).not.toContain(earlier.pending);
    expect(ids).not.toContain(earlier.withdrawn);
  });

  it('drops the who-did-it columns and keeps the rest of the data', async () => {
    for (const [table, column] of [
      ['children', 'consent_parent_id'],
      ['children', 'consent_version'],
      ['children', 'consented_at'],
      ['join_requests', 'closed_by'],
      ['family_books', 'acquired_by'],
      ['book_assignments', 'assigned_by'],
    ] as const) {
      expect(await columnsOf(table), `${table}.${column}`).not.toContain(column);
    }
    expect(
      await rows('select id from children where family_id = $1', [earlier.familyId]),
    ).toHaveLength(2);
    expect(
      await rows('select status, closed_at from join_requests where id = $1', [earlier.approved]),
    ).toEqual([{ status: 'approved', closed_at: AT.approved }]);
    expect(
      await rows(
        'select book_id, acquired_at from family_books where family_id = $1 order by book_id',
        [earlier.familyId],
      ),
    ).toEqual([
      { book_id: 'abc-songs', acquired_at: AT.otherAcquired },
      { book_id: 'carrot-counting', acquired_at: AT.acquired },
    ]);
    expect(
      await rows('select count(*)::int as count from book_assignments where family_id = $1', [
        earlier.familyId,
      ]),
    ).toEqual([{ count: 3 }]);
  });

  it("lets a parent who only did things be deleted, keeping the parent's audit rows", async () => {
    const before = await rows('select id from audit_events where actor_id = $1', [earlier.other]);

    await client.query('delete from parents where id = $1', [earlier.other]);

    expect(await rows('select id from audit_events where actor_id = $1', [earlier.other])).toEqual(
      before,
    );
    expect(before).toHaveLength(3);
  });

  it('refuses every update, delete and truncation of the audit rows', async () => {
    expect(await failureOf("update audit_events set action = 'changed'")).toBe(APPEND_ONLY);
    expect(await failureOf('delete from audit_events')).toBe(APPEND_ONLY);
    expect(await failureOf('truncate audit_events')).toBe(APPEND_ONLY);
  });

  it('takes a parent, a child or the site as the actor, the site without an id', async () => {
    const insert = (kind: string, actorId: string | null) =>
      failureOf(
        `insert into audit_events (actor_kind, actor_id, action, target_kind, target_id)
         values ($1, $2, 'parent.deleted', 'parent', $3)`,
        [kind, actorId, randomUUID()],
      );

    expect(await insert('system', null)).toBeUndefined();
    expect(await insert('child', randomUUID())).toBeUndefined();
    expect(await insert('system', randomUUID())).toBe(CHECK_VIOLATION);
    expect(await insert('parent', null)).toBe(CHECK_VIOLATION);
    expect(await insert('robot', randomUUID())).toBe(CHECK_VIOLATION);
  });

  it('gives a new row its id, the time of now and empty details', async () => {
    const familyId = randomUUID();
    const [row] = await rows<{ id: string; occurred_at: Date; details: unknown }>(
      `insert into audit_events (actor_kind, actor_id, action, target_kind, target_id, family_id)
       values ('parent', $1, 'family.code_changed', 'family', $2, $3)
       returning id, occurred_at, details`,
      [randomUUID(), familyId, familyId],
    );
    expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Math.abs((row?.occurred_at.getTime() ?? 0) - Date.now())).toBeLessThan(60_000);
    expect(row?.details).toEqual({});
  });

  it('indexes the rows by family and time, and by what they were done to', async () => {
    expect(
      await rows<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef from pg_indexes
         where tablename = 'audit_events' and indexname <> 'audit_events_pkey' order by indexname`,
      ),
    ).toEqual([
      {
        indexname: 'audit_events_family_occurred_at_idx',
        indexdef:
          'CREATE INDEX audit_events_family_occurred_at_idx ON public.audit_events USING btree (family_id, occurred_at)',
      },
      {
        indexname: 'audit_events_target_idx',
        indexdef:
          'CREATE INDEX audit_events_target_idx ON public.audit_events USING btree (target_kind, target_id)',
      },
    ]);
  });
});
