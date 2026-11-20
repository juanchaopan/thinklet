# 0010 任务入口

## 背景

安装、启动、检查、测试这些命令，要收拢到仓库根目录的一个任务入口里，开发者和 CI 都调用它。开发机是 Windows，CI 是 Linux。

## 比较过的方案

- Task：一个单独的程序，用 YAML 写任务，内置跨平台的 shell。
- just：语法简洁，但默认用 POSIX shell，Windows 上要装 Git Bash 或另外配置。
- Make：Windows 上要另装，命令也很难兼顾 Windows。

## 决定

用 Task，任务写在 `Taskfile.yml`。它作为仓库根目录的开发依赖（`@go-task/cli`）由 pnpm 安装。

## 理由

- 在 Windows、macOS、Linux 上行为一致，不依赖 Git Bash。
- 做成开发依赖后，开发机上只要先装 Node.js、pnpm 和 Docker，版本也由锁文件固定。

## 代价

- 第一次 `pnpm install` 之前，还不能用 Task 的命令。

## 何时重新考虑

- Task 停止维护，或者 npm 包不再跟上它的新版本。

Last changed: #1 (2026-11-19)
