-- Fail fast rather than queue behind the running api's queries for a lock;
-- LOCAL keeps both settings to the migration transaction.
SET LOCAL lock_timeout = '1s';--> statement-breakpoint
SET LOCAL statement_timeout = '5s';--> statement-breakpoint
-- book_assignments references a child together with its family, which needs
-- this constraint first. drizzle-kit migrate runs in a transaction, where an
-- index cannot be built concurrently; the children table is small, and the
-- lock timeout above keeps the lock short or fails the migration.
-- squawk-ignore disallowed-unique-constraint
ALTER TABLE "children" ADD CONSTRAINT "children_id_family_unique" UNIQUE("id","family_id");--> statement-breakpoint
-- Only the applicant dismisses a closed request: the api keeps that in
-- dismissed_by_applicant_at alone and has no use for the admin's column.
-- squawk-ignore ban-drop-column
ALTER TABLE "join_requests" DROP COLUMN "dismissed_by_admin_at";--> statement-breakpoint
-- A grade's level runs from 0 to 12 and its position counts a dozen or so
-- grades, so 32-bit integers are far more than enough.
CREATE TABLE "grades" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	-- squawk-ignore prefer-bigint-over-int
	"level" integer NOT NULL,
	-- squawk-ignore prefer-bigint-over-int
	"position" integer NOT NULL,
	CONSTRAINT "grades_level_unique" UNIQUE("level"),
	CONSTRAINT "grades_position_unique" UNIQUE("position"),
	CONSTRAINT "grades_id_check" CHECK (id ~ '^[a-z0-9-]{1,30}$'),
	CONSTRAINT "grades_name_length_check" CHECK (char_length(name) between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	-- squawk-ignore prefer-bigint-over-int
	"position" integer NOT NULL,
	CONSTRAINT "subjects_position_unique" UNIQUE("position"),
	CONSTRAINT "subjects_id_check" CHECK (id ~ '^[a-z0-9-]{1,30}$'),
	CONSTRAINT "subjects_name_length_check" CHECK (char_length(name) between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"intro" text NOT NULL,
	"grade_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"status" text NOT NULL,
	"replacement_id" text,
	"cover_type" text,
	"cover_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "books_id_check" CHECK (id ~ '^[a-z0-9-]{1,60}$'),
	CONSTRAINT "books_title_length_check" CHECK (char_length(title) between 1 and 30),
	CONSTRAINT "books_intro_length_check" CHECK (char_length(intro) between 1 and 200),
	CONSTRAINT "books_status_check" CHECK (status in ('active', 'inactive')),
	CONSTRAINT "books_replacement_check" CHECK (replacement_id <> id),
	CONSTRAINT "books_cover_type_check" CHECK (cover_type in ('webp', 'png')),
	CONSTRAINT "books_cover_sha256_check" CHECK (cover_sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "books_cover_check" CHECK ((cover_type is null) = (cover_sha256 is null))
);
--> statement-breakpoint
CREATE TABLE "family_books" (
	"family_id" uuid NOT NULL,
	"book_id" text NOT NULL,
	"acquired_by" uuid NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "family_books_family_id_book_id_pk" PRIMARY KEY("family_id","book_id")
);
--> statement-breakpoint
CREATE TABLE "book_assignments" (
	"child_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"book_id" text NOT NULL,
	"assigned_by" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	CONSTRAINT "book_assignments_child_id_book_id_pk" PRIMARY KEY("child_id","book_id")
);
--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_replacement_id_books_id_fk" FOREIGN KEY ("replacement_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_books" ADD CONSTRAINT "family_books_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_books" ADD CONSTRAINT "family_books_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_books" ADD CONSTRAINT "family_books_acquired_by_parents_id_fk" FOREIGN KEY ("acquired_by") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_assignments" ADD CONSTRAINT "book_assignments_assigned_by_parents_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_assignments" ADD CONSTRAINT "book_assignments_child_fk" FOREIGN KEY ("child_id","family_id") REFERENCES "public"."children"("id","family_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_assignments" ADD CONSTRAINT "book_assignments_family_book_fk" FOREIGN KEY ("family_id","book_id") REFERENCES "public"."family_books"("family_id","book_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_assignments_family_book_idx" ON "book_assignments" USING btree ("family_id","book_id");--> statement-breakpoint
CREATE INDEX "books_created_at_id_idx" ON "books" USING btree ("created_at" DESC NULLS LAST,"id");--> statement-breakpoint
-- The grades from preschool (level 0) to the last year of senior high
-- (level 12), shown in that order.
INSERT INTO "grades" ("id", "name", "level", "position") VALUES
	('preschool', '学前', 0, 1),
	('grade-1', '一年级', 1, 2),
	('grade-2', '二年级', 2, 3),
	('grade-3', '三年级', 3, 4),
	('grade-4', '四年级', 4, 5),
	('grade-5', '五年级', 5, 6),
	('grade-6', '六年级', 6, 7),
	('grade-7', '初一', 7, 8),
	('grade-8', '初二', 8, 9),
	('grade-9', '初三', 9, 10),
	('grade-10', '高一', 10, 11),
	('grade-11', '高二', 11, 12),
	('grade-12', '高三', 12, 13);--> statement-breakpoint
INSERT INTO "subjects" ("id", "name", "position") VALUES
	('chinese', '语文', 1),
	('math', '数学', 2),
	('english', '英语', 3),
	('science', '科学', 4),
	('coding', '编程', 5);--> statement-breakpoint
-- The sample books, newest first, one minute apart. bunny-counts has left
-- the library for carrot-counting. Covers are set by the cover import.
INSERT INTO "books" ("id", "title", "intro", "grade_id", "subject_id", "status", "replacement_id", "created_at", "updated_at") VALUES
	('garden-rhymes', '花园里的小儿歌', '跟着小兔老师在花园里念儿歌：小草发芽、蝴蝶跳舞、雨点敲门。每首儿歌都配着拍手的节奏，念着念着就记住了常用的字。', 'preschool', 'chinese', 'active', NULL, '2026-11-23 08:00:00+00', '2026-11-23 08:00:00+00'),
	('carrot-counting', '胡萝卜数数大冒险', '小兔要把 20 根胡萝卜分给朋友们。一边帮它分，一边学会数到 100、比较多少，还能认识加号和减号。', 'grade-1', 'math', 'active', NULL, '2026-11-23 07:59:00+00', '2026-11-23 07:59:00+00'),
	('hello-animals', 'Hello，动物朋友', '认识 cat、dog、rabbit 等 30 个动物单词，跟着简单的句子说一说它们住在哪里、爱吃什么。', 'grade-2', 'english', 'active', NULL, '2026-11-23 07:58:00+00', '2026-11-23 07:58:00+00'),
	('moon-phases', '月亮为什么会变脸', '有时圆圆的像盘子，有时弯弯的像小船。我们用一个手电筒和一个皮球，在家里就能做出月亮的样子变化，弄明白月相是怎么回事。最后还有一张月亮观察表，可以连续画一个月。', 'grade-3', 'science', 'active', NULL, '2026-11-23 07:57:00+00', '2026-11-23 07:57:00+00'),
	('robot-maze', '让小机器人走出迷宫', '用拖动积木的方式给小机器人下指令：前进、转弯、重复。从一步一步走到学会用循环，一共 12 个关卡。', 'grade-4', 'coding', 'active', NULL, '2026-11-23 07:56:00+00', '2026-11-23 07:56:00+00'),
	('seasons-poems', '四季里的古诗', '春天读《春晓》，夏天读《小池》，秋天读《山行》，冬天读《江雪》。每首诗都配了一幅画和一个小问题，帮你想一想诗人看到了什么、心里在想什么。', 'grade-5', 'chinese', 'active', NULL, '2026-11-23 07:55:00+00', '2026-11-23 07:55:00+00'),
	('shape-hide-and-seek', '形状捉迷藏', '圆形藏在钟表里，三角形躲在屋顶上。跟着小兔在家里找一找，认识身边的形状。', 'preschool', 'math', 'active', NULL, '2026-11-23 07:54:00+00', '2026-11-23 07:54:00+00'),
	('pizza-fractions', '分披萨学分数', '一张披萨分给四个人，每人能吃几块？两张披萨分给三个人呢？从切披萨开始认识分数，再学会分数的比较、加减和约分。书里有 40 道生活里的小题，做完就能自己算清楚怎么分最公平。', 'grade-6', 'math', 'active', NULL, '2026-11-23 07:53:00+00', '2026-11-23 07:53:00+00'),
	('my-school-day', 'My School Day 我的一天', '跟着交换生 Amy 过完学校的一天，学会用英语介绍课程表、时间和喜欢的科目。', 'grade-7', 'english', 'active', NULL, '2026-11-23 07:52:00+00', '2026-11-23 07:52:00+00'),
	('pinyin-train', '拼音小火车', '声母是车头，韵母是车厢，拼在一起就开动啦。', 'grade-1', 'chinese', 'active', NULL, '2026-11-23 07:51:00+00', '2026-11-23 07:51:00+00'),
	('seed-journey', '一颗种子的旅行', '种子是怎么跑到远方的？有的乘着风，有的粘在小动物身上，有的被小鸟吃下又带走。观察身边的种子，再亲手种一盆豆芽。', 'grade-2', 'science', 'active', NULL, '2026-11-23 07:50:00+00', '2026-11-23 07:50:00+00'),
	('linear-functions', '一次函数的故事', '从出租车计费、手机套餐讲起，看懂一次函数的图像，学会用它解决生活里的选择题。', 'grade-8', 'math', 'active', NULL, '2026-11-23 07:49:00+00', '2026-11-23 07:49:00+00'),
	('abc-songs', 'ABC 唱唱书', '26 个字母，每个都有一首短短的歌和一个好玩的动作。', 'preschool', 'english', 'active', NULL, '2026-11-23 07:48:00+00', '2026-11-23 07:48:00+00'),
	('times-table-garden', '乘法花园', '九九乘法表种在花园里：每一行是一畦菜，每一格是一棵。数一数，背一背，再玩一玩乘法接龙。', 'grade-3', 'math', 'active', NULL, '2026-11-23 07:47:00+00', '2026-11-23 07:47:00+00'),
	('bunny-counts', '小兔数萝卜', '跟着小兔数一数菜园里的萝卜，学会 20 以内的数。', 'grade-1', 'math', 'inactive', 'carrot-counting', '2026-11-23 07:46:00+00', '2026-11-23 07:46:00+00'),
	('write-a-diary', '一起来写日记', '今天发生了什么？从一件小事写起，学会把时间、地点、心情写清楚。', 'grade-4', 'chinese', 'active', NULL, '2026-11-23 07:45:00+00', '2026-11-23 07:45:00+00'),
	('electricity-at-home', '家里的电从哪里来', '电是怎么从发电站跑进家里的插座的？认识电路、开关和导体，动手做一个会亮的小灯泡，还要记住用电的安全规则。', 'grade-5', 'science', 'active', NULL, '2026-11-23 07:44:00+00', '2026-11-23 07:44:00+00'),
	('argument-writing', '把道理说清楚：议论文入门', '什么是论点、论据和论证？用身边的例子练习把一个想法说清楚、说服别人。', 'grade-9', 'chinese', 'active', NULL, '2026-11-23 07:43:00+00', '2026-11-23 07:43:00+00'),
	('arrow-cards', '箭头卡片编程', '不用电脑也能学编程：用箭头卡片给小伙伴下指令，让他走到宝藏那里。', 'grade-1', 'coding', 'active', NULL, '2026-11-23 07:42:00+00', '2026-11-23 07:42:00+00'),
	('travel-english', '旅行英语小手册', '问路、点餐、买票，用简单的英语在旅途中照顾好自己。', 'grade-6', 'english', 'active', NULL, '2026-11-23 07:41:00+00', '2026-11-23 07:41:00+00'),
	('reading-clocks', '认识钟表和时间', '几点起床、几点上学？认识时针和分针，学会看整点、半点和几时几分。', 'grade-2', 'math', 'active', NULL, '2026-11-23 07:40:00+00', '2026-11-23 07:40:00+00'),
	('tiny-cells', '细胞：看不见的小世界', '用显微镜看洋葱表皮，你会发现一格一格的小房间，那就是细胞。认识细胞的结构，比较植物细胞和动物细胞的不同，再了解细胞怎样分裂、长大。每一章都有一个可以在家完成的小实验。', 'grade-7', 'science', 'active', NULL, '2026-11-23 07:39:00+00', '2026-11-23 07:39:00+00'),
	('mixing-colors', '颜色变变变', '红色和黄色在一起会变成什么颜色？用水彩做实验，发现颜色的秘密。', 'preschool', 'science', 'active', NULL, '2026-11-23 07:38:00+00', '2026-11-23 07:38:00+00'),
	('my-family-tree', 'My Family 我的家人', '用英语介绍爸爸妈妈、爷爷奶奶和兄弟姐妹，画一棵自己的家庭树。', 'grade-3', 'english', 'active', NULL, '2026-11-23 07:37:00+00', '2026-11-23 07:37:00+00'),
	('big-numbers', '大数有多大', '一万粒米有多少？一亿秒有多长？用生活里的例子感受大数，学会读写和比较大数。', 'grade-4', 'math', 'active', NULL, '2026-11-23 07:36:00+00', '2026-11-23 07:36:00+00'),
	('scratch-games', '用 Scratch 做小游戏', '从一只会走路的小猫开始，加上按键控制、计分和关卡，做出属于自己的接水果游戏。', 'grade-5', 'coding', 'active', NULL, '2026-11-23 07:35:00+00', '2026-11-23 07:35:00+00'),
	('classical-chinese', '文言文不难读', '从《论语》里的短句读起，认识常见的文言词，学会用联系上下文的方法猜词义。', 'grade-8', 'chinese', 'active', NULL, '2026-11-23 07:34:00+00', '2026-11-23 07:34:00+00'),
	('weather-station', '做一个小小气象站', '用瓶子、吸管和纸杯做出雨量计、风向标和温度记录表，连续记录一周的天气。', 'grade-6', 'science', 'active', NULL, '2026-11-23 07:33:00+00', '2026-11-23 07:33:00+00'),
	('negative-numbers', '零下的温度：认识负数', '冬天的温度为什么会是零下？从温度计和电梯楼层认识负数，学会在数轴上比较大小。', 'grade-7', 'math', 'active', NULL, '2026-11-23 07:32:00+00', '2026-11-23 07:32:00+00'),
	('reading-strategies', '英语阅读有方法', '先看标题猜内容，再找关键词抓主旨。12 篇短文带你练会快速阅读。', 'grade-9', 'english', 'active', NULL, '2026-11-23 07:31:00+00', '2026-11-23 07:31:00+00'),
	('idiom-stories', '成语小故事', '守株待兔、亡羊补牢、画蛇添足……每个成语都是一个小故事，读完还能讲给家人听。', 'grade-2', 'chinese', 'active', NULL, '2026-11-23 07:30:00+00', '2026-11-23 07:30:00+00');
