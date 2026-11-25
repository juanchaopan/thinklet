-- Fail fast rather than queue behind the running api's queries for a lock;
-- LOCAL keeps both settings to the migration transaction.
SET LOCAL lock_timeout = '1s';--> statement-breakpoint
SET LOCAL statement_timeout = '5s';--> statement-breakpoint
-- The data migrations written in code that have run (data.md,
-- data_migrations), with the SHA-256 of each one's file as it ran.
CREATE TABLE "data_migrations" (
	"name" text PRIMARY KEY NOT NULL,
	"checksum" text NOT NULL,
	"ran_at" timestamp with time zone NOT NULL,
	CONSTRAINT "data_migrations_name_check" CHECK (name ~ '^[0-9]{4}-[a-z0-9-]+$'),
	CONSTRAINT "data_migrations_checksum_check" CHECK (checksum ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
-- The ciphertexts of a child and of a remembered device are bound to the
-- row's id, so the api makes the id before it encrypts the row and the
-- database gives none of its own: a row added without the id its
-- ciphertexts were made for is refused instead of stored unreadable. The
-- only client that adds these rows is the api; the api still running while
-- this deploys cannot read the re-encrypted ciphertexts either, a short
-- break decision 0018 accepts.
-- squawk-ignore ban-drop-default
ALTER TABLE "child_devices" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
-- squawk-ignore ban-drop-default
ALTER TABLE "children" ALTER COLUMN "id" DROP DEFAULT;
