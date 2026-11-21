# thinklet 给 AI 代理的规则

项目的目标、用户和范围见 `.docs/brief.md`，架构见 `.docs/architecture.md`，设计见 `.docs/design/`，评审标准见 `REVIEW.md`。

## 语言

| 用途             | 语言     |
| ---------------- | -------- |
| 代码注释         | 英文     |
| 文档             | 中文     |
| 原型和界面文字   | 简体中文 |
| issue 和评审意见 | 中文     |

代码注释只说明现在的代码做什么、为什么这样设计，不写修改历史。

## 任务命令

所有日常命令都通过 Task（`Taskfile.yml`）运行：`pnpm exec task <命令>`。`pnpm exec task --list` 列出全部命令和说明。

| 命令                                                                                 | 运行什么                                                        |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `dev`                                                                                | 本机起容器、执行迁移，启动前后端                                |
| `jwt-key`                                                                            | 生成本机开发用的 JWT 签名密钥，贴进 `.env` 的 `JWT_SIGNING_KEY` |
| `check`                                                                              | 全部静态检查                                                    |
| `format`、`format-fix`                                                               | 检查格式、改好格式（Prettier）                                  |
| `lint`                                                                               | ESLint                                                          |
| `typecheck`                                                                          | 各包的 `tsc --noEmit`                                           |
| `build`                                                                              | 编译和构建全部包                                                |
| `architecture`                                                                       | 架构规则（dependency-cruiser）                                  |
| `duplicates`                                                                         | 重复代码（jscpd）                                               |
| `migrations-lint`                                                                    | 新增迁移脚本的检查（Squawk）                                    |
| `secrets`                                                                            | 密钥泄漏（gitleaks）                                            |
| `workflows`                                                                          | GitHub Actions 工作流（actionlint、zizmor）                     |
| `licenses`                                                                           | 产品运行时依赖的许可证                                          |
| `vulnerabilities`                                                                    | 依赖漏洞（OSV-Scanner）                                         |
| `docs`                                                                               | Markdown 格式，以及 `.docs/` 文档结尾的 `Last changed:` 一行    |
| `commits`、`step-check`、`pr-title`、`risk`                                          | 提交信息、步骤检查、PR 标题、风险分级                           |
| `test-unit`、`test-component`、`test-integration`、`test-security`、`test-migration` | 各测试对象，测试自己起临时环境，测完删除                        |
| `test-e2e`、`test-e2e-all-browsers`                                                  | 端到端测试：只用 Chromium；三种浏览器加模拟手机                 |
| `test-security-scan`                                                                 | ZAP 基线扫描                                                    |
| `test-smoke BASE_URL=<地址>`                                                         | 对已部署的目标跑冒烟测试；`PRODUCTION_SAFE=true` 只跑不改数据的 |
| `test-component-update`                                                              | 重新生成截图基准图（只在 Linux 的 Playwright 镜像里生成）       |
| `migrate`                                                                            | 执行数据库迁移（`drizzle-kit migrate`）                         |

## 改动怎么检查

- **git hooks**（lefthook，`lefthook.yml`，`pnpm install` 时装好）：
  - 提交前：暂存文件的格式和代码规范、gitleaks、改了工作流时跑 actionlint 和 zizmor、Markdown 检查。
  - commit-msg：commitlint 和步骤检查。
  - 推送前：类型检查、构建、受影响的单元测试。
- **开 PR 前**，代理在本机跑：架构规则、重复代码、迁移脚本检查；全部单元、组件、集成测试；经过改动页面或接口的端到端测试；改了迁移脚本时的迁移测试；再跑 `/simplify`、`/code-review`（medium）和 `/security-review`，每个问题都改掉，或者写明理由再关掉。CI 里不跑 AI 评审。
- **PR 的 CI**（`.github/workflows/`）把每项检查和测试全部再跑一遍，都是必过检查：`ci` 里的各项、`codeql`、`pr-title` 和 `risk-gate`。用路径过滤跳过的任务也报告成功。
- **风险和人的批准**：CI 任务 `risk` 按目标分支的 `risk-rules.yml` 给 PR 打上 `risk:low`、`risk:medium` 或 `risk:high`；中风险和高风险的 PR 要有人加上 `human-reviewed` 标签，`risk-gate` 才通过；推上新的提交时，这个标签会被自动去掉。发版 PR 一律是高风险。这几个任务按 `pull_request` 事件运行，用的是 PR 自己带的工作流文件（`.github/workflows/risk.yml`），PR 能把它们改掉，所以 `risk-gate` 通过不是最终的保证。
- **合并前**，代理不只看 `risk-gate`，自己核对下面两项。两项都成立、必过检查也都通过才合并；`risk-gate` 显示通过但核对不成立时不合并，把情况告诉用户。人自己在网页上合并时，要自己看风险标签和批准标签。

  1. **用目标分支的脚本和规则算出风险等级**，不用 PR 里的。先切到 PR 的分支，并确认本地 HEAD 就是 PR 在 GitHub 上的最新提交；不是时命令报错并以非零状态退出，不输出等级。再把 `origin/main` 上的 `tools/` 和 `risk-rules.yml` 取到临时目录里运行。`origin/main` 还没有规则时，一律算高风险。命令放在子 shell 里，贴到交互式 shell 里运行时，`exit` 只结束子 shell。

     ```bash
     n=<PR 编号>
     (
       git fetch origin main
       [ "$(git rev-parse HEAD)" = "$(gh pr view "$n" --json headRefOid --jq .headRefOid)" ] || { echo "本地 HEAD 不是 PR 的最新提交，先切到 PR 的分支并拉取最新提交" >&2; exit 1; }
       target="$(mktemp -d)"
       if git cat-file -e origin/main:risk-rules.yml 2>/dev/null && git cat-file -e origin/main:tools/bin/risk.ts 2>/dev/null; then
         git archive origin/main tools risk-rules.yml | tar -x -C "$target"
         node "$target/tools/bin/risk.ts" --base origin/main --rules "$target/risk-rules.yml" --branch "$(gh pr view "$n" --json headRefName --jq .headRefName)"
       else
         echo high
       fi
       rm -rf "$target"
     )
     ```

     算出的等级和 PR 上的 `risk:*` 标签不一样时，说明 PR 可能改了风险的工作流，不合并，告诉用户。

  2. **中风险和高风险的 PR 有 `human-reviewed` 标签，而且这个标签是在最后一次推送之后加上的。** 最后一次推送的时间取两者里较晚的一个：GitHub 第一次见到 PR 最新提交的时间（这个提交最早的 check suite），以及最后一次强推的时间。不用提交里的日期，因为提交日期可以随意填。两者都查不到时，推送时间无法确定，一律算未批准；查不到批准时间也算未批准。`gh api` 出错时会把错误信息输出到标准输出，所以只保留时间格式的行，查询出错就等于查不到。

     ```bash
     n=<PR 编号>
     timestamps() { grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' | sort; }
     head="$(gh pr view "$n" --json headRefOid --jq .headRefOid)"
     pushed="$({
       gh api "repos/{owner}/{repo}/commits/$head/check-suites" --paginate --jq '.check_suites[].created_at' | timestamps | head -n 1
       gh api "repos/{owner}/{repo}/issues/$n/timeline" --paginate --jq '.[] | select(.event == "head_ref_force_pushed") | .created_at'
     } | timestamps | tail -n 1)"
     approved="$(gh api "repos/{owner}/{repo}/issues/$n/timeline" --paginate --jq '.[] | select(.event == "labeled" and .label.name == "human-reviewed") | .created_at' | timestamps | tail -n 1)"
     labelled="$(gh pr view "$n" --json labels --jq '[.labels[].name] | index("human-reviewed") != null')"
     echo "最后一次推送：${pushed:-未知}；最后一次批准：${approved:-无}；现在有标签：$labelled"
     if [ -z "$pushed" ]; then
       echo "未批准：无法确定最后一次推送的时间"
     elif [ "$labelled" = true ] && [ -n "$approved" ] && [[ "$approved" > "$pushed" ]]; then
       echo 已批准
     else
       echo 未批准
     fi
     ```

- **合并到 `main` 后**：CI 再跑类型检查、构建和单元、组件、集成、端到端测试；CD 发布到测试环境 staging（迁移、发布后端和前端、冒烟测试）。发版 PR 合并后，CI 打上 `v<版本>` 标签并建 GitHub release。

## 分支和提交

- 分支模型是 GitHub Flow：`main` 是唯一的长期分支。PR 用 squash 合并，PR 标题就是 `main` 上的提交信息。代理合并任何 PR 前，都先做上面“合并前”的核对。
- **issue 分支**：`<issue 类型>/<编号>-<简短名称>`，例如 `feature/12-order-filter`。所有检查都适用。
- **发版分支**：`release/<版本>`，PR 标题固定是 `chore(release): <版本>`，不带 issue 编号。
- **依赖更新分支**：Renovate 开的 `renovate/*`，标题是 `fix(deps): ...`（产品运行时用到的）或 `chore(deps): ...`（其余），不带 issue 编号，也没有 `Step:`。
- **草稿分支**：`scratch/<编号>-<简短名称>`，放原型、spike 代码和一次性脚本，永远不合并，只检查提交信息的格式。
- 提交信息按 Conventional Commits：第一行最多 100 个字符，以 issue 编号结尾，例如 `feat(order): filter orders by date (#12)`；最后一行是 `Step: <步骤>`。
- 提交类型跟着 issue 类型：`feature` 用 `feat`，`fix` 用 `fix`，`refactor` 用 `refactor`，`maintenance` 用 `chore`。括号里的范围随意，说明改了哪一块；不兼容的改动在类型后加 `!`。
- 每个 issue 按顺序走五个步骤，每步只能改这些文件，提交最后一行的 `Step:` 写明是哪一步，步骤检查会核对：

  | 步骤                    | 能改的文件                                  |
  | ----------------------- | ------------------------------------------- |
  | `kickoff`               | `.docs/brief.md`、`.docs/reference/`        |
  | `architect`             | `.docs/architecture.md`、`.docs/decisions/` |
  | `design`                | `.docs/design/`                             |
  | `scaffold`、`implement` | `.docs/` 以外的一切                         |

- 更新分支时把最新的 `main` 合并进来，已推送的分支不变基。把 `main` 带进分支的合并提交不做步骤检查。
- 一次只做一个 issue，在它自己的分支上做。

## issue 引用

GitHub 的 issue 写成 `#<编号>`，例如 `#12`。提交信息和 PR 标题的第一行都以 `(#<编号>)` 结尾；PR 描述里写 `Closes #<编号>`，合并后 issue 自动关闭。
