# 0019 各组件在开发机和 CI 里怎么运行

## 背景

开发机是 Windows，装有 Node.js 24.22.1 和 Docker 28.5.2；CI 是 GitHub 的 Linux 机器。MinIO 从 2025 年 10 月起不再发布免费镜像，LocalStack 从 2026 年 3 月起要账号令牌才能用。家长通过 Authing 登录（见决策 0029），开发和自动化测试不能依赖外部服务和它的密钥。

## 比较过的方案

- 前后端：本机直接运行；在容器里运行。
- PostgreSQL：容器（官方 postgres 镜像）；Neon 的开发分支；本机安装。
- 对象存储：SeaweedFS 容器；Garage 容器；Neon 开发项目里的存储桶。
- Authing：mock-oauth2-server 容器；在测试进程里跑 oidc-provider；开发机连测试环境的 Authing 用户池，测试再另用替身。

## 决定

- 前后端在开发机上直接运行，前端是 `ng serve`，后端是 `nest start --watch`；CI 在 Linux 机器上装 Node.js 直接运行。
- PostgreSQL 用官方 `postgres` 镜像：开发时用 Docker Compose 起，测试时用 Testcontainers 临时起。
- 对象存储用 SeaweedFS 容器模拟 S3，起的方式同上。
- Authing 用 `ghcr.io/navikt/mock-oauth2-server` 容器模拟 OIDC 服务器，打开它的登录页，填什么用户都能登录。起的方式同上，镜像按摘要固定版本；测试等它的 `/isalive` 返回 200 再开始。
- 开发机升级到 Node.js 26.13.1。

## 理由

- 本机直接运行，改了代码马上生效，编辑器也能直接用本机的依赖。测试环境本来就不是容器，用容器也得不到更接近的环境。
- 测试用 Testcontainers 临时起依赖，每次都从干净的状态开始，测完就删。
- SeaweedFS 是 Apache-2.0 许可证，还在维护，一个容器就能提供 S3 接口。
- mock-oauth2-server 是 MIT 许可证，还在维护，提供标准的发现文档、授权、换令牌、公钥和退出地址，后端用同一套代码连它；它的登录页可以直接让端到端测试操作。不用联网，也不用密钥。oidc-provider 要自己写一套配置和登录交互的代码。

## 代价

- 开发机要安装并启动 Docker。
- 后端在开发机和 CI 里以常驻进程运行，在测试环境里以 Vercel 函数运行，两种入口都要维护。
- mock-oauth2-server 和 Authing 的行为不完全一样：托管页、Google 登录、邮件和退出页面都不一样，这些差异测试发现不了。
- 多一个要跟着升级的容器镜像。

## 何时重新考虑

- SeaweedFS 停止维护，或者它的 S3 兼容性不够用。
- mock-oauth2-server 停止维护，或者本站用到了它模拟不了的 OIDC 功能。

Last changed: #7 (2026-11-20)
