# 0020 静态检查

## 背景

每个检查对象都要选一个工具。技术栈是 TypeScript、Angular、NestJS、PostgreSQL 和 GitHub Actions。

## 比较过的方案

| 检查         | 选项                                                              |
| ------------ | ----------------------------------------------------------------- |
| 格式         | Prettier；Biome                                                   |
| 代码规范     | ESLint 加 typescript-eslint 和 angular-eslint；Oxlint             |
| 类型和构建   | 严格模式的 tsc 加各自的构建命令；只用构建命令                     |
| 架构规则     | dependency-cruiser；eslint-plugin-boundaries；Sheriff             |
| 重复代码     | jscpd；不检查                                                     |
| 代码安全扫描 | CodeQL；Semgrep CE；Opengrep                                      |
| 依赖漏洞     | OSV-Scanner；pnpm audit                                           |
| 密钥泄漏     | gitleaks 加 GitHub 推送保护；Betterleaks 加推送保护；只用推送保护 |
| 许可证       | license-checker-rseidelsohn；Trivy；不检查                        |
| 部署配置     | actionlint 加 zizmor；只用 actionlint                             |
| 提交信息     | commitlint 加项目自己的规则；只用项目自己的脚本                   |
| 文档格式     | markdownlint-cli2 加 Prettier；只用 Prettier                      |
| 迁移脚本     | Squawk；不检查                                                    |
| AI 简化      | 开 PR 前跑 `/simplify`；不做                                      |
| AI 安全评审  | 开 PR 前跑 `/security-review`；本机和 CI 都跑；不做               |

## 决定

每一项都用第一个选项。另外，步骤检查是仓库 `tools/` 目录里的一个 Node.js 脚本，由 commit-msg 钩子和 PR 的 CI 调用。

具体的工具和规则见 `architecture.md` 的“静态检查”一节。

## 理由

- 尽量选社区的标准工具，每一层只用一个工具。
- Angular 模板的规则只有 angular-eslint 有。
- CodeQL 对公开仓库免费，还能跨文件追踪数据流。
- 工作流里有部署用的密钥，zizmor 的安全检查很有必要。
- 平台处理儿童的个人信息，所以要做 AI 安全评审。

## 代价

- CodeQL 只能在 CI 里跑。仓库改成私有后要付费。
- 检查多，CI 要跑的时间长一些。

## 何时重新考虑

- 仓库改成私有。
- 某个工具停止维护或改了许可证。

Last changed: #1 (2026-11-20)
