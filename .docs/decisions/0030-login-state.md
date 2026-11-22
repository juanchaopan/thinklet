# 0030 登录状态

## 背景

家长从 Authing 登录回来后，本站要记住这位家长已经登录。用户希望服务器无状态，不存会话，以后好扩展、好拆分服务。后端在测试环境里是 Vercel 函数，每个请求都可能落在不同的实例上。登录状态放在 cookie 里，就要防跨站请求伪造。

## 比较过的方案

- 登录状态：数据库里的会话表，cookie 里只放随机的会话号；后端签发的 JWT 整个放在 cookie 里，服务器不存。
- JWT 的签名：ES256 密钥对；HS256 共享密钥。
- 登录过程中的 state、nonce 和 PKCE：放在签名的短时 cookie 里；存数据库。
- 防跨站请求伪造：SameSite=Lax 加后端校验 `Origin`；Angular 自带的 XSRF 令牌。

## 决定

- 服务器不存会话。登录成功后，后端用 jose 签发一个 JWT，放在 HttpOnly、Secure、SameSite=Lax、`Path=/` 的 cookie 里。JWT 里只有家长编号、签发时间和过期时间，头里带密钥编号 `kid`。有效期和续期规则在设计文档里定。
- 签名用 ES256。私钥是密钥 `JWT_SIGNING_KEY`（JWK 格式），由代理随机生成，直接写进 GitHub；公钥由私钥算出，不单独保存。
- 回调时，Authing 返回的 ID 令牌和 JWT 一起放进另一个 cookie，属性和 JWT 的 cookie 一样（HttpOnly、Secure、SameSite=Lax、`Path=/`），有效期跟着登录状态：JWT 的 cookie 重新签发或续期时，它也一起续。它不用来认证请求，只在退出时读出来，作为 `id_token_hint` 交给 Authing 的退出地址（见决策 0029）。
- 跳到 Authing 前，把 state、nonce、PKCE 的 code verifier 和登录后要回到的页面放进一个用同一把私钥签名、几分钟就过期的 cookie；回调时核对，用完就清掉。
- 防跨站请求伪造：cookie 用 SameSite=Lax；后端用一个全局中间件检查每个非 GET、HEAD、OPTIONS 请求的 `Origin` 头，不是 `APP_ORIGIN` 或者没有就拒绝。GET 请求不改数据。
- 退出时清掉 JWT 和 ID 令牌这两个 cookie；每个请求只校验 JWT 的签名和有效期，不查会话。家庭成员关系和角色每次从数据库里查，不放进 JWT（见决策 0031）。

## 理由

- 不存会话，任何一个后端实例拿到请求都能自己校验，不用共享的会话存储，以后拆服务也不用迁会话。
- ES256 只有签发的一方拿私钥，以后别的服务拿公钥就能校验，不能伪造登录。带 `kid` 可以换密钥。
- ID 令牌也放 cookie，退出时就能带上 `id_token_hint`，服务器仍然不存会话。cookie 是 HttpOnly 的，页面上的脚本读不到里面家长的名字和邮箱。
- 登录过程中的临时信息也放 cookie，整个登录流程都不碰数据库。
- SameSite=Lax 让别的网站发来的改数据请求不带 cookie；再校验 `Origin`，较旧的浏览器和同站的子域名也挡得住。前端不用写代码。

## 代价

- 一个 JWT 签发出去后，过期前没法单独作废：设备丢了、cookie 被偷了，只能等它过期，或者换签名密钥让所有家长重新登录。
- 退出只能清掉这台浏览器的 cookie，不能“在所有设备上退出”。
- 换签名密钥时，用旧密钥签发的 JWT 全部失效。
- 非 GET 请求必须带 `Origin`，用命令行调接口时要自己带上。
- ID 令牌的 cookie 里有家长的名字和邮箱，每个请求多带大约 1 KB。
- Authing 的 ID 令牌在应用配置里 14 天过期，登录状态比它长时，退出时带的是过期的 `id_token_hint`；Authing 认不认，要在测试环境上查。

## 何时重新考虑

- 要能把某个家长从所有设备上踢下线，或者作废某一个登录。
- 有别的服务要校验登录，要发布公钥。
- 签名私钥可能泄漏。

Last changed: #7 (2026-11-21)
