# 0025 依赖更新

## 背景

依赖、Node.js 版本、GitHub Actions 和 Docker 镜像出了新版本，都要自动开 PR。

## 比较过的方案

- 工具：Renovate（Mend 免费托管的 App）；Dependabot；Renovate 用 GitHub Actions 自己跑。
- 合并：不自动合并；补丁版和小版本自动合并。
- Dependabot：只开告警；告警和安全更新都开。

## 决定

- 用 Renovate，Mend 免费托管的 GitHub App。
- 用 `config:best-practices`；GitHub Actions 和 Docker 镜像都按摘要固定版本。
- 新版本发布满 3 天才开 PR。
- 一起发版的包合成一个 PR；每周一早上开 PR，安全更新随时开。
- 大版本升级要先在依赖面板里勾选才开。
- PR 标题：产品运行时用到的用 `fix(deps)`，其余用 `chore(deps)`。
- 不自动合并，由 `/issue next` 按风险规则合并。
- Dependabot 只开告警，它自己的版本更新和安全更新都关掉。

## 理由

- Dependabot 不会更新 Node.js 版本文件和 `engines`，升级 Docker 镜像的大版本时也不管是不是 LTS。
- 等 3 天能避开刚发布就被撤回或被投毒的版本。
- 自动合并会绕开风险规则里人的批准。

## 代价

- 要装一个第三方 App。
- 免费托管的 App 大约每 4 小时才检查一次。
- 每个更新 PR 都要有人批准后才能合并。

## 何时重新考虑

- Mend 的免费托管服务有变化。

Last changed: #1 (2026-11-19)
