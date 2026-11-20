# 0011 数据访问

## 背景

后端要读写 PostgreSQL。测试环境里后端以 Vercel 函数运行，连的是 Neon 的连接池地址；生产环境里是常驻进程，连普通的 PostgreSQL。

## 比较过的方案

- Drizzle ORM：用 TypeScript 定义表结构，查询写法接近 SQL。
- Prisma：用自己的 schema 文件定义表，再生成客户端。
- Kysely：只是类型安全的查询构造器，不管表结构和迁移。

## 决定

用 Drizzle ORM 加 node-postgres（`pg`）驱动。

## 理由

- 类型完整，对 JSONB 支持好。
- 体积小、启动快，适合 Vercel 函数。
- 同一个驱动在测试环境连 Neon 的连接池地址，在生产环境连普通的 PostgreSQL，代码不用改。
- 和迁移工具 Drizzle Kit 是一套（0018）。

## 代价

- Neon 的连接池是 PgBouncer 的事务模式，不能用依赖会话状态的功能。
- 上手和文档不如 Prisma。

## 何时重新考虑

- Drizzle 停止维护，或者出现它写不了、要大量手写 SQL 的查询。

Last changed: #1 (2026-11-19)
