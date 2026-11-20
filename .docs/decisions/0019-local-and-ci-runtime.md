# 0019 各组件在开发机和 CI 里怎么运行

## 背景

开发机是 Windows，装有 Node.js 24.22.1 和 Docker 28.5.2；CI 是 GitHub 的 Linux 机器。MinIO 从 2025 年 10 月起不再发布免费镜像，LocalStack 从 2026 年 3 月起要账号令牌才能用。

## 比较过的方案

- 前后端：本机直接运行；在容器里运行。
- PostgreSQL：容器（官方 postgres 镜像）；Neon 的开发分支；本机安装。
- 对象存储：SeaweedFS 容器；Garage 容器；Neon 开发项目里的存储桶。

## 决定

- 前后端在开发机上直接运行，前端是 `ng serve`，后端是 `nest start --watch`；CI 在 Linux 机器上装 Node.js 直接运行。
- PostgreSQL 用官方 `postgres` 镜像：开发时用 Docker Compose 起，测试时用 Testcontainers 临时起。
- 对象存储用 SeaweedFS 容器模拟 S3，起的方式同上。
- 开发机升级到 Node.js 26.13.1。

## 理由

- 本机直接运行，改了代码马上生效，编辑器也能直接用本机的依赖。测试环境本来就不是容器，用容器也得不到更接近的环境。
- 测试用 Testcontainers 临时起依赖，每次都从干净的状态开始，测完就删。
- SeaweedFS 是 Apache-2.0 许可证，还在维护，一个容器就能提供 S3 接口。

## 代价

- 开发机要安装并启动 Docker。
- 后端在开发机和 CI 里以常驻进程运行，在测试环境里以 Vercel 函数运行，两种入口都要维护。

## 何时重新考虑

- SeaweedFS 停止维护，或者它的 S3 兼容性不够用。

Last changed: #1 (2026-11-19)
