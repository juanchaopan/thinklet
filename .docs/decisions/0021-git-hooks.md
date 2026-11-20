# 0021 git hooks

## 背景

提交前、推送前、写提交信息时要自动跑检查。开发机是 Windows。

## 比较过的方案

- lefthook：一个 Go 写的程序，用 pnpm 就能装。
- husky 加 lint-staged：JavaScript 项目最常见的组合。

## 决定

用 lefthook，配置在 `lefthook.yml`。

## 理由

- 能并行跑钩子，能只针对暂存的文件跑，不用再加 lint-staged。
- 在 Windows 上稳定。

## 代价

- 钩子可以用 `--no-verify` 跳过，所以钩子里的每项检查在 CI 里也要再跑一遍。

## 何时重新考虑

- lefthook 停止维护。

Last changed: #1 (2026-11-19)
