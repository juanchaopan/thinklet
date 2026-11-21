# 0007 测试环境

## 背景

需要一个测试环境，每次合并到 `main` 后自动部署。生产环境要放在中国大陆，但这次不建。用户选择测试环境用 Vercel 和 Neon，家长登录用 Authing（见决策 0029）。

## 比较过的方案

- Vercel 上的布局：两个 Vercel 项目，前端把 `/api` 转给后端；一个 Vercel 项目同时发布前后端。
- 地址：Vercel 送的 `*.vercel.app` 地址；自己的域名。
- Neon 资源：新建项目放新加坡；新建项目放美国东部；用已有的 Neon 项目。
- Vercel 套餐：Hobby（免费）；Pro（每人每月 20 美元）。
- 部署方式：只由 GitHub Actions 部署；连接 Vercel 的 Git 集成。
- Authing 用户池：新建国内版 authing.cn 的免费用户池；新建国际版 authing.co 的免费用户池。

## 决定

- 两个 Vercel 项目：
  - `thinklet-web`：发布 Angular 的静态文件，把 `/api/*` 转给 `thinklet-api`。
  - `thinklet-api`：把 NestJS 发布成 Vercel 函数，函数区域是 `sin1`（新加坡）。
- 用 Vercel 送的 `*.vercel.app` 地址。
- 新建 Neon 项目 `thinklet-staging`，放在 `aws-ap-southeast-1`（新加坡），里面有一个 PostgreSQL 数据库和一个对象存储桶，用免费套餐。
- Vercel 用 Hobby 套餐。
- 只由 GitHub Actions 部署：先执行数据库迁移，再发布两个项目，最后跑冒烟测试。不连接 Vercel 的 Git 集成。
- 新建 authing.co 的一个免费用户池，里面一个 OIDC 应用，连上 Google 登录；Google 登录用的 OAuth 客户端建在 Google Cloud 上。都由用户在网站上建。
- 测试环境只放测试数据，不放真实用户的个人信息。

## 理由

- 两个项目可以用上 Vercel 对 NestJS 的零配置支持。浏览器只看到一个地址，不用处理跨域，登录的 cookie 也只属于这一个地址。
- 新加坡离中国大陆最近，函数和数据库放在同一个区域，延迟也低；authing.co 的服务器也在海外，从新加坡访问更近。
- 测试环境每月 0 元，符合每月 200 元的预算。
- 只由 CI 部署，迁移和冒烟测试才能卡在发布的前后；预览环境也不会和测试环境共用一个数据库。
- 测试环境不放真实的个人信息，服务器在境外也不违反简介里的合规要求。

## 代价

- `*.vercel.app` 在中国大陆经常打不开，在国内访问测试环境要用代理。
- Hobby 套餐只能用于个人、非商业用途，项目商用前要升级到 Pro。
- Neon 免费套餐的数据库闲置 5 分钟后会暂停，下一个请求要等不到一秒来唤醒。
- PR 没有预览环境。
- 测试环境里后端以无服务器函数运行，和生产环境的常驻进程不一样。
- Authing 和 Google Cloud 没有可用的命令行工具，用户池、应用和 OAuth 客户端要手动建，配置也只能在网站上看。
- Authing 免费用户池每天只能发 50 封邮件，只能连一个社交账号；生产环境要在 authing.cn 另建用户池。

## 何时重新考虑

- 项目商用。
- 需要在中国大陆直接访问测试环境。
- 免费额度不够用。
- 选定生产环境的云之后，想让测试环境和生产环境更接近。

Last changed: #7 (2026-11-20)
