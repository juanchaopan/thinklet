# 0009 仓库布局和包管理

## 背景

前端、后端和接口约定包放在一个仓库里，要选包管理方式和目录布局。

## 比较过的方案

- 包管理：pnpm workspaces；Nx（配 pnpm）；npm workspaces。
- 目录：`apps/` 和 `packages/`；三个包直接平铺在根目录。

## 决定

- 用 pnpm workspaces。前端用 Angular CLI 构建，后端用 Nest CLI 构建，共用包是普通的 TypeScript 包。
- 目录分成 `apps/web`、`apps/api` 和 `packages/contracts`。

## 理由

- 安装快，依赖管得严：用到但没有声明的包会报错。Vercel 直接支持。
- 只有三个包时，Nx 算受影响范围和缓存构建结果的好处不大，它自己的配置和概念反而不少。
- `apps/` 和 `packages/` 是 pnpm workspaces 最常见的分法，以后加应用或包的位置也清楚。

## 代价

- 没有 Nx 那样的“只跑受影响的”和构建缓存，端到端测试在本机只跑受影响的部分时，要由代理来判断范围。

## 何时重新考虑

- 包多了，CI 明显变慢。

Last changed: #1 (2026-11-19)
