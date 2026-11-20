# 0004 后端运行时和框架

## 背景

后端用 TypeScript（见 0002），还要选运行时、框架和底层的 HTTP 服务器。测试环境里后端以 Vercel 函数运行，生产环境里是常驻的 Node.js 进程。

## 比较过的方案

- 运行时：Node.js 最新 LTS；Bun。
- 框架：NestJS；Fastify；Hono。
- HTTP 层：Express（NestJS 默认）；Fastify。
- Node.js 版本：26.13.1（最新 LTS，开发机要升级）；24.22.3（上一个 LTS）。

## 决定

- Node.js 26.13.1，写死在 `.node-version` 和各 `package.json` 的 `engines` 里。
- 框架用 NestJS，底层用 Express。

## 理由

- Node.js 最稳，NestJS、数据库驱动和各种工具都以它为准。Vercel 的函数已经支持 Node.js 26。
- NestJS 的模块、依赖注入和装饰器写法与 Angular 几乎一样，团队上手快；结构约定强，适合按业务分模块。
- Express 是 NestJS 的文档和生态的基准，Vercel 对 NestJS 的零配置部署也是按它测试的。在几百人同时在线的规模下，速度完全够用。

## 代价

- 开发机要从 Node.js 24.22.1 升级到 26.13.1。
- NestJS 比轻量框架的启动稍重，在 Vercel 函数冷启动时更明显。

## 何时重新考虑

- 冷启动的延迟影响到使用。
- 吞吐量成了瓶颈。

Last changed: #1 (2026-11-19)
