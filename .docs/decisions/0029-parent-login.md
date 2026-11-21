# 0029 家长登录

## 背景

issue #7 让家长用 Authing 注册、登录和找回密码，测试环境要能用 Google 登录，以后生产环境再接微信和支付宝。前端是 Vercel 上的静态文件，CSP 只允许连本站（`connect-src 'self'`、`form-action 'self'`）。REVIEW.md 要求不依赖专有接口。

## 比较过的方案

- 登录界面：Authing 的托管登录页；在本站页面里放用户名和密码，调 Authing 的接口验证。
- 流程在哪边跑：后端跑授权码加 PKCE，用 client secret 换令牌；前端单页应用自己和 Authing 换令牌，再带着令牌调后端。
- 后端的库：openid-client；Authing 的 Node SDK；Passport 加 openid-client。
- 测试环境的用户池：国内版 authing.cn；国际版 authing.co。
- 退出：登录时留下 Authing 的 ID 令牌，退出时作为 `id_token_hint` 交给 `end_session_endpoint`；用 Authing 专有的退出地址 `/login/profile/logout?redirect_uri=…`；只清掉本站的登录状态。

## 决定

- 用 Authing 的托管登录页：邮箱和密码注册、密码登录、Google 登录和忘记密码都在托管页上完成，完成后回到本站。本站没有自己的登录页，产品主页上的「登录 / 注册」直接跳过去。
- OIDC 授权码加 PKCE（S256），流程在后端跑，用 openid-client。Authing 的地址都从 `OIDC_ISSUER` 的发现文档里读，代码里不写 Authing 专有的地址和接口。
- 回调地址和退出后的返回地址都在本站地址 `APP_ORIGIN` 下，经过前端的 `/api/*` 转发到后端。
- 跳到 Authing、从 Authing 跳回来、跳到 Authing 退出，都是整页跳转，不用表单提交。
- 后端从 ID 令牌里取家长的标识（`sub`）、邮箱和名字；本站用 issuer 加 `sub` 认出同一位家长。
- 测试环境用 authing.cn 的一个免费用户池和其中一个 OIDC 应用（Regular Web APP），连上 Google 登录；Google 登录要的 OAuth 客户端建在 Google Cloud 上，免费。都由用户在网站上建。
- 退出时清掉本站的登录状态，再跳到 Authing 的 `end_session_endpoint`，带上 ID 令牌作为 `id_token_hint`（登录时放在一个 HttpOnly 的 cookie 里，见决策 0030），同时退出 Authing，退完回到产品主页。
- 在测试环境上用真的 Authing 走注册、Google 登录和找回密码，不测。

## 理由

- 托管页由 Authing 维护：密码规则、找回密码的邮件、社交登录的对接都不用自己写，本站也不经手家长的密码。在本站放表单要调 Authing 的专有接口，Google 登录还是得跳出去。
- 流程在后端跑，令牌不进浏览器，浏览器只拿到 HttpOnly 的 cookie；前端 CSP 不用放开 Authing 的域名。
- openid-client 有 OpenID 的官方认证，一直在维护，只走标准协议，以后换身份服务只改配置；Passport 多一层概念，功能一样。
- 前端的 `form-action 'self'` 在浏览器里也管表单提交后的跳转，用表单提交跳到 Authing 会被挡住。
- 家里共用的设备上，只清本站的登录状态的话，孩子再点「登录 / 注册」，Authing 不问密码就直接登录进家长的账号。
- 退出时带 `id_token_hint` 是 OIDC 的标准做法，开发和测试用的 mock-oauth2-server 也支持，测试能覆盖。只带 `client_id` 和 `post_logout_redirect_uri` 时，Authing 退出后停在它自己的「登出成功，请关闭页面返回控制台」页面，不回本站。Authing 专有的退出地址能跳回登记过的地址，但替身里没有这个地址，测试覆盖不了，代码也绑在了 Authing 上。
- 测试环境用 authing.cn：在国际版控制台 console.authing.co 登录，进的也是 authing.cn 的控制台，没有单独的国际版用户池可选；生产环境本来就在中国大陆的云上。
- 真的 Authing 上的那几步由 Authing 负责，本站这边的每一步都由对着替身的测试覆盖。

## 代价

- 家长登录依赖 Authing 的可用性；Authing 出问题时家长登录不了。
- 托管页的样子只能在 Authing 允许的范围里调。
- 免费用户池每月最多 10 个活跃用户，只能连一个社交账号；每天最多发 50 封邮件，而且账号主人要先完成 Authing 的实名认证或企业认证才能发。
- 测试环境和生产环境是 authing.cn 上的两个用户池，微信和支付宝登录要在生产环境的用户池上再配一次。
- 家长的名字、邮箱和密码存在 Authing 北京的服务器上；测试环境新加坡的 Vercel 函数跨境访问 Authing，登录会慢一点。
- Google 登录要经过 Authing 北京的服务器连 Google，能不能稳定用要在测试环境上试。
- 退出后能不能回到本站，要在测试环境上用真的 Authing 登录一次来确认。
- 真的 Authing 上的流程没有自动化测试，Authing 改了托管页或配置出错，要靠人发现。
- 每次登录和退出都要离开本站一下。

## 何时重新考虑

- 建生产环境，接微信和支付宝登录。
- 免费用户池的活跃用户、邮件或社交账号数量不够用。
- Authing 的发现文档里没有 `end_session_endpoint`，或者不支持 S256 的 PKCE。
- 带了 `id_token_hint`，Authing 退出后还是不回本站，或者不认过期的 `id_token_hint`。
- 经过 authing.cn 的 Google 登录不能稳定用。
- 想换别的身份服务。

Last changed: #7 (2026-11-21)
