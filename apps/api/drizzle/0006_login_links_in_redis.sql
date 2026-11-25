-- Fail fast rather than queue behind the running api's queries for a lock;
-- LOCAL keeps both settings to the migration transaction.
SET LOCAL lock_timeout = '1s';--> statement-breakpoint
SET LOCAL statement_timeout = '5s';--> statement-breakpoint
-- The children's login links live in Redis, where they expire by
-- themselves (data.md, Redis 里的), so their table goes, and its foreign
-- keys to children and parents with it. The links are not moved: each one
-- lives ten minutes, and one not used yet when this deploys stops working;
-- the parent makes a new one (architecture.md, data migration). The api
-- still running while this deploys cannot read or make a link either, a
-- short break decision 0018 accepts.
-- squawk-ignore ban-drop-table
DROP TABLE "child_login_links";
