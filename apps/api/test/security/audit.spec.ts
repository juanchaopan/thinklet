import { AUDIT_CASES, auditRows, PersonalData, type AuditRow } from '../support/audit.js';
import { useAppWithServices } from '../support/families.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The values the details of an audit row may hold besides ids: field names, versions and channels. */
const DETAIL_WORDS = new Set(['name', 'timezone', 'nickname', 'account', 'self', 'webhook', 'qr']);
const VERSION = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a value of an audit row's details is an id, a count or one of the allowed words. */
function isIdentifier(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.every(isIdentifier);
  }
  if (typeof value === 'number') {
    return Number.isInteger(value);
  }
  return (
    typeof value === 'string' &&
    (UUID.test(value) || DETAIL_WORDS.has(value) || VERSION.test(value))
  );
}

// The audit events keep ids and identifiers only (#14, 30;
// `.docs/design/data.md`, "audit_events"): every data-changing request
// of the api runs with a parent's name and email, a family name, a
// child's nickname and account and a device name of its own, and none of
// them reaches any audit row, in any column.
describe('Personal data in the audit events', () => {
  const running = useAppWithServices();
  const personal = new PersonalData();
  let rows: AuditRow[];

  beforeAll(async () => {
    for (const auditCase of AUDIT_CASES) {
      const arranged = await auditCase.arrange({
        target: running.server,
        databaseUrl: running.databaseUrl,
        personal,
      });
      const response = await arranged.act();
      expect(response.status, auditCase.action).toBe(arranged.status);
    }
    rows = await auditRows(running.databaseUrl);
  });

  it('records the changes the requests made', () => {
    expect(new Set(rows.map(({ action }) => action))).toEqual(
      new Set(AUDIT_CASES.map(({ action }) => action)),
    );
  });

  it('holds no name, email, family name, nickname, account or device name', () => {
    expect(personal.given.length).toBeGreaterThan(AUDIT_CASES.length);
    const stored = rows.map((row) => JSON.stringify(row));
    for (const value of personal.given) {
      expect(
        stored.filter((text) => text.includes(value)),
        value,
      ).toEqual([]);
    }
  });

  it('names who acted and on what by ids, and the details only by ids, counts and allowed words', () => {
    for (const row of rows) {
      expect(row.actor_id === null || UUID.test(row.actor_id), row.action).toBe(true);
      expect(row.family_id === null || UUID.test(row.family_id), row.action).toBe(true);
      expect(
        Object.values(row.details).every(isIdentifier),
        `${row.action} ${JSON.stringify(row.details)}`,
      ).toBe(true);
    }
  });
});
