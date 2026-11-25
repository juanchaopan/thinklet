-- Fail fast rather than queue behind the running api's queries for a lock;
-- LOCAL keeps both settings to the migration transaction.
SET LOCAL lock_timeout = '1s';--> statement-breakpoint
SET LOCAL statement_timeout = '5s';--> statement-breakpoint
-- Until when a child without a password may set one by logging in with the
-- family code and the account (data.md, children). A nullable column without
-- a default changes no row: children with a password keep it, and children
-- added before this without one have no such time, so they set it with a
-- login QR code or after a parent resets the password.
ALTER TABLE "children" ADD COLUMN "password_setup_until" timestamp with time zone;
