-- Fail fast rather than queue behind the running api's queries for a lock;
-- LOCAL keeps both settings to the migration transaction.
SET LOCAL lock_timeout = '1s';--> statement-breakpoint
SET LOCAL statement_timeout = '5s';--> statement-breakpoint
-- A book is written for a range of grades and teaches at one grade within
-- it (data.md, books). Each of the three grades references the grades table
-- by id and level together, which needs this constraint first. drizzle-kit
-- migrate runs in a transaction, where an index cannot be built
-- concurrently; the grades table holds a dozen or so rows, and the lock
-- timeout above keeps the lock short or fails the migration.
-- squawk-ignore disallowed-unique-constraint
ALTER TABLE "grades" ADD CONSTRAINT "grades_id_level_unique" UNIQUE("id","level");--> statement-breakpoint
-- The columns start out empty and are filled below before they are made
-- required. A grade's level runs from 0 to 12, so 32-bit integers are far
-- more than enough, as in the grades table.
ALTER TABLE "books" ADD COLUMN "min_grade_id" text;--> statement-breakpoint
-- squawk-ignore prefer-bigint-over-int
ALTER TABLE "books" ADD COLUMN "min_grade_level" integer;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "max_grade_id" text;--> statement-breakpoint
-- squawk-ignore prefer-bigint-over-int
ALTER TABLE "books" ADD COLUMN "max_grade_level" integer;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "teaching_grade_id" text;--> statement-breakpoint
-- squawk-ignore prefer-bigint-over-int
ALTER TABLE "books" ADD COLUMN "teaching_grade_level" integer;--> statement-breakpoint
-- Every book so far is written for its one grade, which is also the grade
-- it teaches at: the range starts and ends there.
UPDATE "books" SET
	"min_grade_id" = "grades"."id",
	"min_grade_level" = "grades"."level",
	"max_grade_id" = "grades"."id",
	"max_grade_level" = "grades"."level",
	"teaching_grade_id" = "grades"."id",
	"teaching_grade_level" = "grades"."level"
FROM "grades"
WHERE "grades"."id" = "books"."grade_id";--> statement-breakpoint
-- Every book has its grades now. Making the columns required, and adding
-- the keys and checks below, each scan the books table once inside the
-- migration transaction; the table holds the library's books only, and
-- checking the rows there is what makes the rules hold for every book, old
-- ones included.
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "books" ALTER COLUMN "min_grade_id" SET NOT NULL;--> statement-breakpoint
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "books" ALTER COLUMN "min_grade_level" SET NOT NULL;--> statement-breakpoint
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "books" ALTER COLUMN "max_grade_id" SET NOT NULL;--> statement-breakpoint
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "books" ALTER COLUMN "max_grade_level" SET NOT NULL;--> statement-breakpoint
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "books" ALTER COLUMN "teaching_grade_id" SET NOT NULL;--> statement-breakpoint
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "books" ALTER COLUMN "teaching_grade_level" SET NOT NULL;--> statement-breakpoint
-- A grade whose level changes carries its books' levels along, so they
-- always match the grades table.
-- squawk-ignore adding-foreign-key-constraint, constraint-missing-not-valid
ALTER TABLE "books" ADD CONSTRAINT "books_min_grade_fk" FOREIGN KEY ("min_grade_id","min_grade_level") REFERENCES "public"."grades"("id","level") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
-- squawk-ignore adding-foreign-key-constraint, constraint-missing-not-valid
ALTER TABLE "books" ADD CONSTRAINT "books_max_grade_fk" FOREIGN KEY ("max_grade_id","max_grade_level") REFERENCES "public"."grades"("id","level") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
-- squawk-ignore adding-foreign-key-constraint, constraint-missing-not-valid
ALTER TABLE "books" ADD CONSTRAINT "books_teaching_grade_fk" FOREIGN KEY ("teaching_grade_id","teaching_grade_level") REFERENCES "public"."grades"("id","level") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
-- The range never runs backwards, and the teaching grade lies within it,
-- both ends included.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "books" ADD CONSTRAINT "books_grade_range_check" CHECK (min_grade_level <= max_grade_level);--> statement-breakpoint
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "books" ADD CONSTRAINT "books_teaching_grade_check" CHECK (teaching_grade_level between min_grade_level and max_grade_level);--> statement-breakpoint
-- The three grades take the place of the book's one grade; its foreign key
-- to grades goes with the column. The api of this version neither reads
-- nor writes it.
-- squawk-ignore ban-drop-column
ALTER TABLE "books" DROP COLUMN "grade_id";
