# 0028 安全响应头

## 背景

issue #1 的 ZAP 基线扫描报了两条中危：没有 Content-Security-Policy、没有防点击劫持的响应头；还有几条低危：没有 Cross-Origin-Opener-Policy、Cross-Origin-Resource-Policy、Permissions-Policy、X-Content-Type-Options 等。做登录和存孩子信息之前要补上。

前端是 Vercel 上的静态文件，响应头只能写进 CD 生成的 `vercel.json`；本机的端到端测试服务器和 `ng serve` 也要带同样的响应头，扫描和测试的结果才和测试环境一致。后端是 NestJS，测试环境里作为 Vercel 函数运行，本机和 CI 里作为常驻进程运行。Angular 运行时会把组件样式插成页面里的 `<style>`。

前端用 Zod 校验和推类型（见决策 0013）。Zod 4 在建 schema 时会试探 `new Function` 能不能用；CSP 没有 `'unsafe-eval'` 时，这个试探会被报成违规。

## 比较过的方案

- 后端怎么加：自己写一个全局中间件；用 helmet 库。
- CSP 对内联样式：允许内联样式；每次请求用一个随机数（nonce）放行。
- CSP 对 `eval`：不加 `'unsafe-eval'`，让 Zod 用 jitless 模式；加 `'unsafe-eval'`。
- ZAP 扫描的失败标准：中危及以上就失败；保持只在高危时失败。

## 决定

- 不用库，自己写。前端的响应头写成一份清单，生成的 `vercel.json`、本机端到端测试的服务器和 `ng serve` 都用这一份；后端由一个全局中间件给每个响应加上自己的一份，放在 `apps/api/src/infrastructure/`。
- 两边都加 Content-Security-Policy（含 `frame-ancestors`）、X-Content-Type-Options、Cross-Origin-Opener-Policy、Cross-Origin-Resource-Policy、Permissions-Policy、Referrer-Policy。值写在 `.docs/design/interfaces.md`。
- Referrer-Policy 用 `no-referrer`：任何请求都不带 Referer。
- 前端的 CSP 里脚本只允许本站文件，不加 `'unsafe-eval'`；样式允许内联（`'unsafe-inline'`）。
- Zod 因此用 jitless 模式：`packages/contracts` 里有一个模块调用 `z.config({ jitless: true })`，前后端两个应用都在任何 schema 之前导入它。
- 前端的生产构建不内联关键 CSS（`angular.json` 里 `inlineCritical: false`）：内联关键 CSS 时，构建会在页面里加一段内联脚本来加载完整的样式表，`script-src 'self'` 会挡住它，完整的样式就用不上。
- 暂不加 Cross-Origin-Embedder-Policy。
- ZAP 基线扫描有中危及以上的告警就失败；确实不用修的告警，在扫描的配置里逐条写明理由后忽略。

## 理由

- 响应头正好是要的那几个，写成清单一眼能看全；helmet 不带 Permissions-Policy，默认值和前端的清单也不一样，要逐个调，还多一个要跟着升级的依赖。
- 前端是静态文件，做不到每次请求都不同的随机数；要做就得加 Vercel 的边缘中间件，本机测试服务器和以后的国内云也都要做一遍。样式注入的危害远小于脚本注入。
- `'unsafe-eval'` 会放开把字符串当代码执行，等于削弱脚本注入的防线；Zod 的 jitless 模式只是不用即时编译的快速路径，校验结果一样。
- 中危就失败，以后哪个 PR 把响应头弄丢，CI 马上能发现；只在日志里列出的告警没人看。
- 地址里带着家庭码（`/join/<家庭码>`）和扫码登录的令牌（`/child/qr/<令牌>`），`no-referrer` 让它们不会随 Referer 传到任何地方，包括本站自己的接口和日志；本站和 Authing 都不靠 Referer。`same-origin` 对外一样不泄漏，但站内的请求仍带着完整地址；浏览器默认的 `strict-origin-when-cross-origin` 在站内也带完整地址。
- Cross-Origin-Embedder-Policy 会挡住没有声明允许跨源的外部图片和字体，等以后真的要引用外部资源时再定。

## 代价

- 以后要加或改响应头，要自己改清单和中间件。
- 内联样式不受 CSP 限制，页面上如果出现注入，样式能被改掉。
- 不内联关键 CSS，首屏要等样式表下载完才显示样式；页面内容多了以后，首屏会慢一点。
- 前端的清单要同时用在三个地方，其中 `ng serve` 读的是 `angular.json`，要靠测试保证它和清单一致。
- ZAP 以后新加的中危规则会让 CI 突然失败，要当场修好或写明理由忽略。
- 以后要按来源页面做统计或判断，就拿不到 Referer。
- Zod 用 jitless 模式，解析比即时编译慢一点；配置模块要在任何 schema 之前导入，漏了导入，Zod 会再去试探 `new Function`，CSP 又会报违规。

## 何时重新考虑

- 前端改成服务端渲染，或者换到能按请求生成随机数的托管方式。
- 要引用外部的图片、字体或脚本。
- 要加的安全响应头多到自己维护很麻烦。
- Angular 的构建能在不用内联脚本的情况下内联关键 CSS。
- Zod 不再试探 `new Function`，或者换了别的校验库。

Last changed: #14 (2026-11-24)
