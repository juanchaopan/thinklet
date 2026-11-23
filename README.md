# thinklet

thinklet 是面向孩子的做题平台，用有趣的方式带孩子学习难懂的课程、学会解题、整理思路。

## 在本机运行

### 先装好这些

1. **Node.js 26.13.1**：用 [fnm](https://github.com/Schniz/fnm) 安装。在仓库根目录运行 `fnm install` 和 `fnm use`，fnm 会读 `.node-version` 里的版本。
2. **pnpm 12.21.0**：`npm install --global pnpm@12.21.0`。已经装了别的版本的 pnpm 也可以：根目录 `package.json` 的 `packageManager` 写着 `pnpm@12.21.0`，在仓库里运行 pnpm 时，它会自己切换到这个版本。
3. **Docker**：装好 Docker（Windows 和 macOS 上是 Docker Desktop，用 Linux 容器），并让它一直运行。开发用的数据库、对象存储、模拟的登录服务和各项测试都在容器里跑。

在 Windows 上，pnpm 自己切换版本时，偶尔只装了包、没装上它的原生可执行文件，之后运行 pnpm 会报错。解决办法：进入 pnpm 主目录（设置了 `PNPM_HOME` 时就是它，Windows 上默认是 `%LOCALAPPDATA%\pnpm`）下的 `.tools\pnpm\12.21.0\node_modules\pnpm` 目录，运行 `node install.js`，再回到仓库重新运行 pnpm。

### 安装和启动

```sh
pnpm install
cp .env.example .env
pnpm exec task jwt-key
pnpm exec task child-data-key
pnpm exec task dev
```

`pnpm install` 同时装好任务入口 Task 和 git hooks。`.env` 里是本机开发用的值，不提交；`.env.example` 里的值配合 Docker Compose 起的服务就能用，只有两把密钥是空的：

- 签发登录状态的私钥 `JWT_SIGNING_KEY`：`task jwt-key` 在本机新生成一把，打印出 `JWT_SIGNING_KEY='…'` 这一行，把它换掉 `.env` 里的那一行。
- 加密孩子个人信息的主密钥 `CHILD_DATA_KEY`：`task child-data-key` 在本机新生成一把，打印出 `CHILD_DATA_KEY=…` 这一行，同样换掉 `.env` 里的那一行。这把密钥换了以后，本机数据库里已有的孩子信息就读不出来了，要清空本机数据重来。

这两把密钥只在本机用，不要提交，也不要用到别的环境。

`task dev` 起 PostgreSQL、SeaweedFS（模拟 S3）和 mock-oauth2-server（模拟 Authing 的 OIDC 登录服务）容器，执行数据库迁移（书本数据也在迁移脚本里），再把 `content/books/` 里的封面导入对象存储，最后启动前后端：前端在 <http://localhost:4200>，`/api` 转发给本机的后端。登录时会跳到模拟登录服务的页面，填任意用户名都能登录；这个服务不保存任何数据，容器重启后所有登录都要重来。

改了 `content/books/` 里的封面以后，运行 `pnpm exec task rebuild` 重新导入；内容没变的封面不重传。

### 停止

- 在运行 `task dev` 的终端按 Ctrl+C，停掉前后端。三个容器还在后台运行，下次 `task dev` 直接用它们。
- `docker compose down`：停掉并删除这些容器。数据留在 Docker 卷里，下次启动还在。
- `docker compose down -v`：连 Docker 卷一起删除，本机数据库和对象存储里的数据全部清空。下次 `task dev` 从空库开始，重新执行迁移、导入封面。

### 端口

| 服务                 | 默认端口 | 在哪里改                                                                              |
| -------------------- | -------- | ------------------------------------------------------------------------------------- |
| 前端（`ng serve`）   | 4200     | `Taskfile.yml` 里 `dev-web` 任务的 `PORT`（不在 `.env` 里），同时改 `APP_ORIGIN`      |
| 后端                 | 3000     | `.env` 的 `PORT`，同时改 `API_ORIGIN` 里的端口                                        |
| PostgreSQL           | 5432     | `.env` 的 `POSTGRES_PORT`，同时改 `DATABASE_URL` 和 `MIGRATION_DATABASE_URL` 里的端口 |
| SeaweedFS（S3 接口） | 8333     | `.env` 的 `S3_PORT`，同时改 `S3_ENDPOINT` 里的端口                                    |
| 模拟登录服务         | 8080     | `.env` 的 `MOCK_OIDC_PORT`，同时改 `OIDC_ISSUER` 里的端口                             |

端口被别的程序占用时，在 `.env` 里换一个空闲端口。`docker-compose.yml` 从 `.env` 读 `POSTGRES_PORT`、`S3_PORT` 和 `MOCK_OIDC_PORT`，后端从 `.env` 读连接地址，所以端口和地址要一起改。

### 同一台机器上的多个副本

`docker-compose.yml` 把 Compose 项目名定为 `thinklet`（`name: thinklet`），所以同一台机器上这个仓库的所有副本（另一个克隆、git worktree）共用同一组容器和数据卷：一个副本执行的迁移和封面导入，另一个副本也看得到；在任何一个副本里执行 `docker compose down -v`，所有副本的本机数据都会被删掉。两个副本同时 `task dev` 时，前后端的端口也会冲突。测试不受影响：它们自己在随机端口上起临时容器，不用 Compose。

### 常用命令

所有命令都通过 Task 运行：`pnpm exec task <命令>`，`pnpm exec task --list` 列出全部命令和说明。

| 命令                         | 做什么                                                                   |
| ---------------------------- | ------------------------------------------------------------------------ |
| `dev`                        | 起容器、执行迁移、导入封面，启动前后端                                   |
| `jwt-key`                    | 新生成一把本机用的登录签名私钥，打印成 `.env` 里的一行                   |
| `child-data-key`             | 新生成一把本机用的孩子信息主密钥，打印成 `.env` 里的一行                 |
| `check`                      | 依次跑全部静态检查                                                       |
| `format-fix`                 | 用 Prettier 改好格式                                                     |
| `test-unit`                  | 单元测试，带覆盖率下限                                                   |
| `test-component`             | 前端组件测试（axe 和截图对比），在加了中文字体的 Playwright 镜像里跑     |
| `test-component-update`      | 同上，并用新截图覆盖基准图                                               |
| `test-integration`           | 后端集成测试，临时起 PostgreSQL、SeaweedFS 和模拟登录服务的容器          |
| `test-security`              | 后端安全测试用例                                                         |
| `test-security-scan`         | 对临时环境跑 ZAP 基线扫描                                                |
| `test-migration`             | 迁移测试                                                                 |
| `test-e2e`                   | 端到端测试（Chromium），自己起临时环境，测完删除                         |
| `test-e2e-all-browsers`      | 端到端测试，Chromium、Firefox、WebKit 和模拟手机都跑                     |
| `test-smoke BASE_URL=<地址>` | 对已部署的地址跑冒烟测试；加 `PRODUCTION_SAFE=true` 只跑不改数据的那几条 |
| `migrate`                    | 对 `.env` 里的数据库执行迁移                                             |
| `rebuild`                    | 构建后端，把 `content/books/` 里的封面导入 `.env` 里的对象存储           |
