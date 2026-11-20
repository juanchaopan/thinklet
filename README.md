# thinklet

thinklet 是面向孩子的做题平台，用有趣的方式带孩子学习难懂的课程、学会解题、整理思路。

## 在本机运行

### 先装好这些

1. **Node.js 26.13.1**：用 [fnm](https://github.com/Schniz/fnm) 安装。在仓库根目录运行 `fnm install` 和 `fnm use`，fnm 会读 `.node-version` 里的版本。
2. **pnpm 12.21.0**：`npm install --global pnpm@12.21.0`。已经装了别的版本的 pnpm 也可以：根目录 `package.json` 的 `packageManager` 写着 `pnpm@12.21.0`，在仓库里运行 pnpm 时，它会自己切换到这个版本。
3. **Docker**：装好 Docker（Windows 和 macOS 上是 Docker Desktop，用 Linux 容器），并让它一直运行。开发用的数据库、对象存储和各项测试都在容器里跑。

在 Windows 上，pnpm 自己切换版本时，偶尔只装了包、没装上它的原生可执行文件，之后运行 pnpm 会报错。解决办法：进入 pnpm 主目录（设置了 `PNPM_HOME` 时就是它，Windows 上默认是 `%LOCALAPPDATA%\pnpm`）下的 `.tools\pnpm\12.21.0\node_modules\pnpm` 目录，运行 `node install.js`，再回到仓库重新运行 pnpm。

### 安装和启动

```sh
pnpm install
cp .env.example .env
pnpm exec task dev
```

`pnpm install` 同时装好任务入口 Task 和 git hooks。`.env` 里是本机开发用的值，不提交；`.env.example` 里的值配合 Docker Compose 起的服务就能用。`task dev` 起 PostgreSQL 和 SeaweedFS（模拟 S3）容器，执行数据库迁移，再启动前后端：前端在 <http://localhost:4200>，`/api` 转发给本机的后端。

### 常用命令

所有命令都通过 Task 运行：`pnpm exec task <命令>`，`pnpm exec task --list` 列出全部命令和说明。

| 命令                         | 做什么                                                                   |
| ---------------------------- | ------------------------------------------------------------------------ |
| `dev`                        | 起容器、执行迁移，启动前后端                                             |
| `check`                      | 依次跑全部静态检查                                                       |
| `format-fix`                 | 用 Prettier 改好格式                                                     |
| `test-unit`                  | 单元测试，带覆盖率下限                                                   |
| `test-component`             | 前端组件测试（axe 和截图对比），在固定的 Playwright 镜像里跑             |
| `test-component-update`      | 同上，并用新截图覆盖基准图                                               |
| `test-integration`           | 后端集成测试，临时起 PostgreSQL 和 SeaweedFS 容器                        |
| `test-security`              | 后端安全测试用例                                                         |
| `test-security-scan`         | 对临时环境跑 ZAP 基线扫描                                                |
| `test-migration`             | 迁移测试                                                                 |
| `test-e2e`                   | 端到端测试（Chromium），自己起临时环境，测完删除                         |
| `test-e2e-all-browsers`      | 端到端测试，Chromium、Firefox、WebKit 和模拟手机都跑                     |
| `test-smoke BASE_URL=<地址>` | 对已部署的地址跑冒烟测试；加 `PRODUCTION_SAFE=true` 只跑不改数据的那几条 |
| `migrate`                    | 对 `.env` 里的数据库执行迁移                                             |
