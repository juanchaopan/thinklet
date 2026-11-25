-- Fail fast rather than queue behind the running api's queries for a lock;
-- LOCAL keeps both settings to the migration transaction.
SET LOCAL lock_timeout = '1s';--> statement-breakpoint
SET LOCAL statement_timeout = '5s';--> statement-breakpoint
-- Who did what, for every action that changes data (data.md, audit_events).
-- It references no table, so the rows outlive the parents, families and
-- children their ids name.
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" uuid,
	"actor_issuer" text,
	"actor_subject" text,
	"action" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"family_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_events_actor_kind_check" CHECK (actor_kind in ('parent', 'child', 'system')),
	CONSTRAINT "audit_events_actor_id_check" CHECK ((actor_kind = 'system') = (actor_id is null))
);
--> statement-breakpoint
CREATE INDEX "audit_events_family_occurred_at_idx" ON "audit_events" USING btree ("family_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_kind","target_id");--> statement-breakpoint
-- The rows are only ever added: every update, delete and truncate of the
-- table fails, whoever runs it.
CREATE FUNCTION "audit_events_refuse_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit_events rows are never changed or deleted';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_events_append_only" BEFORE UPDATE OR DELETE OR TRUNCATE ON "audit_events" FOR EACH STATEMENT EXECUTE FUNCTION "audit_events_refuse_change"();--> statement-breakpoint
-- The who-did-it columns become audit events before they are dropped, each
-- at the time of its own row. The guardian's consent of a child is the
-- child's creation, with the consent's version.
INSERT INTO "audit_events" ("occurred_at", "actor_kind", "actor_id", "actor_issuer", "actor_subject", "action", "target_kind", "target_id", "family_id", "details")
SELECT c."consented_at", 'parent', p."id", p."oidc_issuer", p."oidc_subject", 'child.created', 'child', c."id"::text, c."family_id", jsonb_build_object('consentVersion', c."consent_version")
FROM "children" c
JOIN "parents" p ON p."id" = c."consent_parent_id";--> statement-breakpoint
-- The admin who approved or rejected a request, with the applicant.
INSERT INTO "audit_events" ("occurred_at", "actor_kind", "actor_id", "actor_issuer", "actor_subject", "action", "target_kind", "target_id", "family_id", "details")
SELECT coalesce(r."closed_at", r."created_at"), 'parent', p."id", p."oidc_issuer", p."oidc_subject", 'join_request.' || r."status", 'join_request', r."id"::text, r."family_id", jsonb_build_object('parentId', r."parent_id")
FROM "join_requests" r
JOIN "parents" p ON p."id" = r."closed_by"
WHERE r."status" in ('approved', 'rejected');--> statement-breakpoint
INSERT INTO "audit_events" ("occurred_at", "actor_kind", "actor_id", "actor_issuer", "actor_subject", "action", "target_kind", "target_id", "family_id")
SELECT b."acquired_at", 'parent', p."id", p."oidc_issuer", p."oidc_subject", 'book.acquired', 'book', b."book_id", b."family_id"
FROM "family_books" b
JOIN "parents" p ON p."id" = b."acquired_by";--> statement-breakpoint
-- One change of a book's readers assigns it to its children in one
-- transaction, at one time and by one parent, so the assignments of the
-- same book, parent and time are one change that added those children.
INSERT INTO "audit_events" ("occurred_at", "actor_kind", "actor_id", "actor_issuer", "actor_subject", "action", "target_kind", "target_id", "family_id", "details")
SELECT a."assigned_at", 'parent', p."id", p."oidc_issuer", p."oidc_subject", 'book.readers_changed', 'book', a."book_id", a."family_id",
	jsonb_build_object('added', jsonb_agg(a."child_id" ORDER BY a."child_id"), 'removed', '[]'::jsonb)
FROM "book_assignments" a
JOIN "parents" p ON p."id" = a."assigned_by"
GROUP BY a."family_id", a."book_id", a."assigned_at", p."id", p."oidc_issuer", p."oidc_subject";--> statement-breakpoint
-- The business tables keep only where the data stands; who did it is in
-- the audit events written above. Each column's foreign key to parents
-- goes with the column. The api of this version neither reads nor writes
-- these columns.
-- squawk-ignore ban-drop-column
ALTER TABLE "book_assignments" DROP COLUMN "assigned_by";--> statement-breakpoint
-- squawk-ignore ban-drop-column
ALTER TABLE "children" DROP COLUMN "consent_parent_id";--> statement-breakpoint
-- squawk-ignore ban-drop-column
ALTER TABLE "children" DROP COLUMN "consent_version";--> statement-breakpoint
-- squawk-ignore ban-drop-column
ALTER TABLE "children" DROP COLUMN "consented_at";--> statement-breakpoint
-- squawk-ignore ban-drop-column
ALTER TABLE "family_books" DROP COLUMN "acquired_by";--> statement-breakpoint
-- squawk-ignore ban-drop-column
ALTER TABLE "join_requests" DROP COLUMN "closed_by";
