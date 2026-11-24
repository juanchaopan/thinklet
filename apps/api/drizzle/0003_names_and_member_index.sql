-- Fail fast rather than queue behind the running api's queries for a lock;
-- LOCAL keeps both settings to the migration transaction.
SET LOCAL lock_timeout = '1s';--> statement-breakpoint
SET LOCAL statement_timeout = '5s';--> statement-breakpoint
-- A parent's families are found by parent_id, which the primary key does not
-- lead with. drizzle-kit migrate runs in a transaction, where an index cannot
-- be built concurrently; the table is small, and the lock timeout above keeps
-- the lock short or fails the migration.
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX "family_members_parent_id_idx" ON "family_members" USING btree ("parent_id");--> statement-breakpoint
-- The byte limits of names and nicknames (data.md, 长度). Each check scans a
-- small table once inside the migration transaction; checking the rows
-- there is what makes the limit hold for every row, old ones included.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "children" ADD CONSTRAINT "children_nickname_length_check" CHECK (octet_length(split_part(nickname, '.', 3)) <= 214);--> statement-breakpoint
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "families" ADD CONSTRAINT "families_name_length_check" CHECK (octet_length(name) <= 320);--> statement-breakpoint
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "parents" ADD CONSTRAINT "parents_name_length_check" CHECK (octet_length(name) <= 320);
