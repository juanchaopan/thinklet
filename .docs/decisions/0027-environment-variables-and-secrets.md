# 0027 环境变量和密钥

## 背景

测试环境的部署、迁移、冒烟测试和后端运行，都要用到一些地址和凭据。密钥的值任何时候都不能显示在对话里。后端是 Vercel 函数，运行时只能从 Vercel 项目里读环境变量；前端的 `/api/*` 转发规则写在 `vercel.json` 里，而 `vercel.json` 读不了环境变量。

## 比较过的方案

- **分放两处**：CD 用的放 GitHub `staging` 环境，后端运行时用的只放 Vercel 项目 `thinklet-api`，转发地址放 Vercel 项目 `thinklet-web`。数据库和存储的密钥不经过 GitHub Actions，但要在两个平台上分别维护，转发地址还得先用 `vercel pull` 取出来才能生成 `vercel.json`。
- **都放 GitHub**：全部只在 GitHub `staging` 环境里维护，CD 每次发布前把后端运行时用的几项覆盖写进 Vercel，并用转发地址生成 `vercel.json`。
- `VERCEL_TOKEN` 的录入：由用户生成，存成不提交的文件，由代理从文件读入 GitHub；或者由用户在 GitHub 网页上手动粘贴。

## 决定

- 全部环境变量和密钥只在 GitHub `staging` 环境里维护，清单见 `architecture.md` 的“环境变量和密钥”一节。密钥的名称里不带环境。
- CD 每次发布 `thinklet-api` 前，用 `vercel env add <名称> --environment production --force` 从标准输入把后端运行时用的几项写进 Vercel；发布 `thinklet-web` 前，按 `API_ORIGIN` 生成 `vercel.json`。
- `VERCEL_TOKEN` 由用户在 Vercel 网站上生成，存成不提交的文件，由代理从文件读入 GitHub。
- 由建资源产生的值，直接从命令输出写进 GitHub，从不显示。

## 理由

- 只有一个地方要维护，查看和修改都在 GitHub 上。
- 公开仓库能按环境保存密钥，生产环境建好后用它自己的环境，名称不冲突。
- 值不经过对话，也不进入 shell 历史；CD 里从标准输入传给 vercel 命令行，不出现在命令行和日志里。

## 代价

- 数据库和存储的密钥每次发布都要经过 GitHub Actions。
- Vercel 上留着一份副本；改了值要重新部署才生效，在 Vercel 网站上直接改的会被下次发布覆盖。
- `VERCEL_TOKEN` 既能发布，也能改 Vercel 项目的环境变量，泄漏后影响更大。

## 何时重新考虑

- 第一个存孩子个人信息的 issue，要加加密用的密钥。
- 某个测试第一次需要外部账号。
- 建生产环境时。

Last changed: #1 (2026-11-19)
