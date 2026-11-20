# 0002 组件

## 背景

要确定项目由哪些能单独启动的部分组成。简介要求一套自适应网页，内容以书本组织，还会有图片、音频这类文件。

## 比较过的方案

- 前端：Angular、React、Vue。
- 后端语言：TypeScript（Node.js）、Kotlin（JVM）、Java（JVM）。
- 数据库：PostgreSQL、MySQL。
- 对象存储：现在就加；等第一个用到文件的 issue 再加。
- 共用代码：起初设想把题型模块做成前后端共用。用户指出题型还没有设计，而且共用包会在浏览器和服务器两边各跑一份，一般只用于接口约定。于是改为共用包只放接口约定。

## 决定

- `apps/web`：Angular 前端。
- `apps/api`：TypeScript 写的 Node.js 后端。
- `packages/contracts`：只放接口约定（Zod schema 和类型）的共用包。
- PostgreSQL 数据库。
- 兼容 S3 的对象存储，现在就加。
- 题型的结构不在架构里预先设计，由具体题型的 issue 在 design 步骤里定。

## 理由

- 团队熟悉 Angular。
- 前后端用同一种语言，接口约定写一次就能两边共用。Node.js 占用的内存少，适合小服务器。POC 也是 TypeScript 写的，分析时更容易复用。
- PostgreSQL 的 JSONB 适合存不同结构的内容，事务能保证写入后立刻可见。
- 用户决定现在就加对象存储。

## 代价

- 团队也熟悉 Kotlin 和 Java，选了 TypeScript 就用不上这部分经验。
- 对象存储在这个 issue 里还用不上，却要多维护一个资源。

## 何时重新考虑

- 题型设计出来后，发现确实有需要前后端共用的逻辑。
- 后端出现 Node.js 不擅长的负载，比如大量计算。

Last changed: #1 (2026-11-19)
