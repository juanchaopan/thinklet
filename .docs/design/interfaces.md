# 接口

后端接口都在 `/api` 下。请求和响应的格式定义在 `packages/contracts` 的 Zod schema 里。

## 安全响应头

前端和后端的每个响应都带安全响应头，包括错误响应。测试环境、本机开发服务器和端到端测试的服务器都带同样的值。

### 前端

前端的所有页面和静态文件：

| 响应头                         | 值                                                                                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`      | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` |
| `X-Content-Type-Options`       | `nosniff`                                                                                                                                                                                                      |
| `Cross-Origin-Opener-Policy`   | `same-origin`                                                                                                                                                                                                  |
| `Cross-Origin-Resource-Policy` | `same-origin`                                                                                                                                                                                                  |
| `Permissions-Policy`           | `accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()`                                                                                                |
| `Referrer-Policy`              | `no-referrer`                                                                                                                                                                                                  |

- 脚本、图片、字体和接口请求都只能来自本站，页面不能被任何页面嵌入。封面图经过前端的 `/api/*` 转发取，也算本站。
- 样式允许内联，因为 Angular 运行时会把组件样式插成页面里的 `<style>`。
- `Permissions-Policy` 关掉平台现在用不到的设备能力。以后有功能要用其中一项时，由那个 issue 打开。只列 Chrome 认得的名字，不认得的会在控制台报错。
- 跳到 Authing 和从 Authing 回来都是整页跳转，不受 CSP 限制；所以前端不用放开 Authing 的域名。
- `Referrer-Policy: no-referrer`：任何请求都不带 Referer，地址里的家庭码（`/join/<家庭码>`）和扫码登录的令牌（`/child/qr/<令牌>`）不会随它传出去。

### 后端

`/api/*` 的每个响应：

| 响应头                         | 值                                           |
| ------------------------------ | -------------------------------------------- |
| `Content-Security-Policy`      | `default-src 'none'; frame-ancestors 'none'` |
| `X-Content-Type-Options`       | `nosniff`                                    |
| `Cross-Origin-Opener-Policy`   | `same-origin`                                |
| `Cross-Origin-Resource-Policy` | `same-origin`                                |
| `Permissions-Policy`           | 和前端一样                                   |
| `Referrer-Policy`              | `no-referrer`                                |

- 后端返回 JSON、登录用的跳转和封面图，本身不加载任何资源，CSP 什么都不允许。封面图由前端页面里的 `<img>` 显示，不受后端这条 CSP 的限制。
- 经过前端转发的 `/api/*` 响应带后端自己的这一份，不带前端的。

## 通用约定

- **登录状态**：`/api/health`、`/api/auth/*`、`/api/child-auth/*`、`/api/child-login-links/{token}` 和 `/api/webhooks/authing` 下的接口不用登录。孩子的接口（`/api/child/*`）只认孩子 cookie 里身份种类是 `child` 的 JWT；取封面图（`/api/books/{bookId}/cover`）家长或孩子登录都行；其余接口只认家长 cookie 里身份种类是 `parent` 的 JWT。没登录、JWT 过期、签名不对或身份种类不对时返回 `401`，错误码 `unauthenticated`。
- **防跨站请求伪造**：非 GET、HEAD、OPTIONS 的请求，`Origin` 头不是本站地址或者没有时返回 `403`，错误码 `bad_origin`。不用登录的接口也一样，只有 Authing 的 webhook `POST /api/webhooks/authing` 不查 `Origin`，它由 webhook 密钥证明来源。
- **家庭内的接口**在 `/api/families/{familyId}/...` 下，先查当前家长是不是这个家庭的成员：不是成员或家庭不存在都返回 `404`，错误码 `family_not_found`。要管理员的接口，不是管理员时返回 `403`，错误码 `not_admin`。
- **找不到**：接口地址不存在，或者加入申请不存在（包括不是自己的申请），或者家长查的登录链接不存在（包括不是这个孩子的链接），或者封面不存在时返回 `404`，错误码 `not_found`。
- **出错的响应**：`{ "error": { "code": "<错误码>", "requestId": "<请求编号>" } }`。界面上的提示由前端按错误码显示；界面上的错误编号是 `requestId` 的前 8 位，写成“a1f3-92c0”的样子。
- **请求格式不对**：`400`，错误码 `invalid_request`，另带出错的字段 `fields: [{ "path": "name", "code": "too_long" }]`。字段出错的 `code` 有四种：`required`（没填）、`too_short`（太短）、`too_long`（太长）、`invalid`（格式不对）。
- **分批**：列表接口带 `cursor` 参数取下一批，响应里的 `nextCursor` 是下一批的游标，没有更多时是 `null`。游标是不透明的字符串，格式不对时返回 `400`，字段 `cursor` 的 `code` 是 `invalid`。
- **限流**：按来源限制失败次数的接口（见 `rules.md` 的“限流”），到了上限时返回 `429`，错误码 `rate_limited`，另带 `retryAfterSeconds`（窗口剩下的秒数），同时带 `Retry-After` 响应头。到了上限时不做检查。来源 IP 只认前端代理写的请求头。
- **意外的错**：`500`，错误码 `internal`，只带请求编号，不带错误详情。

## GET /api/health

健康检查，不需要登录，只读，不改任何数据。冒烟测试经过前端的 `/api` 转发调用它。

### 检查项

| 检查项     | 怎么检查                  | 超时 |
| ---------- | ------------------------- | ---- |
| `database` | 在数据库上执行 `SELECT 1` | 5 秒 |
| `storage`  | 确认配置里的存储桶能访问  | 5 秒 |
| `redis`    | 向 Redis 发 `PING`        | 5 秒 |

三项同时检查。超过 5 秒没有结果的，算作失败；这段时间也够 Neon 数据库从暂停里唤醒。

### 响应

全部正常时返回 `200`：

```json
{
  "status": "ok",
  "checks": {
    "database": "ok",
    "storage": "ok",
    "redis": "ok"
  }
}
```

有任何一项失败就返回 `503`，失败的那一项标成 `"error"`：

```json
{
  "status": "error",
  "checks": {
    "database": "ok",
    "storage": "error",
    "redis": "ok"
  }
}
```

- 响应里不带错误详情，免得泄露内部信息。
- 失败的原因写进日志，包括超时和错误信息，但不写连接地址和凭据。

## GET /api/client-ip（临时）

核对测试环境上来源 IP 在哪个请求头里。不用登录，只读。返回请求者自己的三个候选请求头，没有的是 `null`：`{ "x-real-ip": "…", "x-forwarded-for": "…", "x-vercel-forwarded-for": "…" }`，带 `Cache-Control: no-store`；这些值不写进日志。核对完由一个 fix issue 删掉这个接口。

## 登录

| 接口                     | 做什么                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/auth/login`    | 参数 `returnTo`（可选，本站以 `/` 开头的路径）。生成 state、nonce 和 PKCE，放进 10 分钟的签名 cookie，`302` 跳到 Authing 的授权地址                                                                                                                                                                                                                 |
| `GET /api/auth/callback` | Authing 跳回来的地址。核对 state，用授权码换令牌，校验 ID 令牌和 nonce。第一次登录时建立家长，名字用 ID 令牌里的名字，没有就用邮箱 @ 前面的部分；以后只更新邮箱。每次都记下协议版本和时间。签发身份种类是 `parent` 的 JWT cookie，把 ID 令牌放进另一个 cookie，`302` 回到 `returnTo` 或 `/`。任何一步失败都 `302` 到 `/?login=failed`，原因写进日志 |
| `POST /api/auth/logout`  | 清掉 JWT 和 ID 令牌两个 cookie，孩子的 cookie 不动；返回 `200` 和 `{ "endSessionUrl": "<Authing 的退出地址>" }`，前端整页跳过去。退出地址带 `id_token_hint`（ID 令牌 cookie 里的令牌）、`client_id` 和退回产品主页的 `post_logout_redirect_uri`。不需要登录：没登录或没有 ID 令牌时也返回退出地址，只是不带 `id_token_hint`                         |

- JWT cookie：`HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`，有效期 7 天；剩下不到 3.5 天时，任何登录过的请求的响应都换发一个新的。
- ID 令牌 cookie：属性和 JWT cookie 一样，和它一起换发、一起清掉；只在退出时读，不用来认证请求。
- 只带 `client_id` 时，Authing 退出后停在它自己的页面，不回本站，所以要带 `id_token_hint`。带了之后能不能回到本站，以及过期的 ID 令牌 Authing 认不认，在测试环境上用真的登录核对。

## 当前家长

### GET /api/me

```json
{
  "id": "0b7c…",
  "name": "林悦",
  "email": "linyue@example.com",
  "families": [
    {
      "id": "5d1e…",
      "name": "林悦的家",
      "role": "admin",
      "pendingRequests": 2
    },
    { "id": "8a40…", "name": "外婆家", "role": "member" }
  ],
  "requestResults": 1
}
```

- `email` 没有时是 `null`。
- `families` 按加入时间排列；`pendingRequests` 只在当前家长是这个家庭的管理员时带，是等待中的申请数。家庭切换按钮上的数是这些数的和，「家庭管理」上的数是当前家庭的。
- `requestResults` 是自己发出的申请里已同意、被拒绝、已失效且还没点「知道了」的条数，用来显示「加入家庭」和头像上的红点。

### PATCH /api/me

改自己的名字。请求 `{ "name": "林悦" }`，成功返回 `200` 和同 `GET /api/me` 的内容；`name` 去掉前后空格后不是 1–20 个字，或者超过 320 字节时返回 `400`。

### DELETE /api/me

删除自己的账号。

- 还是任何家庭的管理员时返回 `409`，错误码 `still_admin`，另带 `families: [{ "id", "name" }]`（他是管理员的家庭），什么都不删。
- 否则先调 Authing 的管理 API 删除这个用户（见“调用的外部接口”）。Authing 返回失败或者没有回应时返回 `502`，错误码 `identity_provider_failed`，什么都不删。
- Authing 删成功后，在一个事务里删掉这位家长、他在各个家庭的成员关系和他发的加入申请，写审计记录 `parent.deleted`（`via` 是 `self`），清掉家长的三个 cookie，返回 `204`。这个事务失败时返回 `500`，本站的数据由之后的 webhook 删除。

## 家庭

| 接口                                                 | 谁能用                       | 请求                       | 成功                   | 出错                                                          |
| ---------------------------------------------------- | ---------------------------- | -------------------------- | ---------------------- | ------------------------------------------------------------- |
| `POST /api/families`                                 | 登录的家长                   | `{ "name", "timezone" }`   | `201` 家庭详情         | `400`                                                         |
| `GET /api/families/{familyId}`                       | 成员                         | —                          | `200` 家庭详情         | `404 family_not_found`                                        |
| `PATCH /api/families/{familyId}`                     | 管理员                       | `{ "name"?, "timezone"? }` | `200` 家庭详情         | `400`、`403 not_admin`                                        |
| `POST /api/families/{familyId}/code`                 | 管理员                       | —                          | `200` 家庭详情（新码） | `403 not_admin`                                               |
| `PUT /api/families/{familyId}/admin`                 | 管理员                       | `{ "parentId" }`           | `200` 家庭详情         | `403 not_admin`、`409 not_a_member`、`409 already_admin`      |
| `DELETE /api/families/{familyId}/members/{parentId}` | 管理员移出别人；成员移出自己 | —                          | `204`                  | `403 not_admin`、`409 admin_cannot_leave`、`409 not_a_member` |
| `DELETE /api/families/{familyId}`                    | 管理员                       | —                          | `204`                  | `403 not_admin`                                               |

家庭详情：

```json
{
  "id": "5d1e…",
  "name": "林悦的家",
  "timezone": "Asia/Shanghai",
  "code": "7KQ4MZ",
  "role": "admin",
  "members": [
    {
      "parentId": "0b7c…",
      "name": "林悦",
      "email": "linyue@example.com",
      "role": "admin",
      "you": true
    },
    {
      "parentId": "41f2…",
      "name": "周子航",
      "email": null,
      "role": "member",
      "you": false
    }
  ]
}
```

- `members` 按加入时间排列；`email` 没有时是 `null`。
- `name` 去掉前后空格后 1–20 个字，不超过 320 字节；`timezone` 必须是 IANA 时区名，别名（比如 `Asia/Calcutta`）先换成标准名再保存和返回。
- 更换家庭码时，这个家庭等待中的申请在同一个事务里变成已失效。
- 设为管理员时，原管理员和新管理员的角色在同一个事务里对调。把自己设为管理员返回 `409 already_admin`，什么都不改。
- 删除家庭在一个事务里删掉家庭、孩子（连同设备和分派的书）、获取的书、加入申请和全部成员关系，写审计记录 `family.deleted`，再删掉 Redis 里这些孩子的登录链接。

## 申请加入（申请人）

| 接口                                          | 请求         | 成功                                                                                   | 出错                                                                                  |
| --------------------------------------------- | ------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/family-codes/{code}`                | —            | `200 { "familyName", "adminName", "adminId" }`                                         | `404 code_not_found`、`409 already_member`、`409 request_pending`、`429 rate_limited` |
| `POST /api/join-requests`                     | `{ "code" }` | `201` 申请                                                                             | `404 code_not_found`、`409 already_member`、`409 request_pending`                     |
| `GET /api/join-requests`                      | —            | `200` 申请列表：等待中、已同意、被拒绝和已失效、还没点「知道了」的，按发出时间从新到旧 | —                                                                                     |
| `DELETE /api/join-requests/{requestId}`       | —            | `204`（撤回）                                                                          | `404 not_found`、`409 request_closed`                                                 |
| `POST /api/join-requests/{requestId}/dismiss` | —            | `204`（申请人的「知道了」，对已同意、被拒绝、已失效的申请）                            | `404 not_found`、`409 request_pending`                                                |

- 查家庭码返回的 `adminId` 是管理员的家长编号，用来算头像颜色。查不到（`404 code_not_found`）算一次失败，按来源 1 小时里 30 次。

申请：

```json
{
  "id": "9c3a…",
  "familyName": "外婆家",
  "familyTimezone": "Asia/Shanghai",
  "adminName": "周秀英",
  "status": "pending",
  "createdAt": "2026-11-21T09:12:00Z"
}
```

- `status` 是 `pending`、`approved`、`rejected` 或 `expired`；撤回的不列出。
- `familyTimezone` 用来按那个家庭的时区显示申请的时间。
- `code` 不分大小写，后端转成大写再查。
- 申请人只能看到、撤回和清掉自己的申请；别人的申请当作不存在。

## 等你处理（管理员）

| 接口                                                              | 成功                       | 出错                                                   |
| ----------------------------------------------------------------- | -------------------------- | ------------------------------------------------------ |
| `GET /api/families/{familyId}/join-requests`                      | `200 { "pending": [...] }` | `403 not_admin`                                        |
| `POST /api/families/{familyId}/join-requests/{requestId}/approve` | `200` 处理后的申请         | `403 not_admin`、`404 not_found`、`409 request_closed` |
| `POST /api/families/{familyId}/join-requests/{requestId}/reject`  | `200` 处理后的申请         | `403 not_admin`、`404 not_found`、`409 request_closed` |

```json
{
  "pending": [
    {
      "id": "9c3a…",
      "parentId": "e8a1…",
      "name": "陈晓",
      "email": "chenxiao@example.com",
      "createdAt": "2026-11-21T09:12:00Z"
    }
  ]
}
```

- `pending` 是等待中的申请，按发出时间从新到旧。处理过的不列出。
- `parentId` 是申请人的家长编号，用来算头像颜色。
- 同意时，申请人在同一个事务里成为普通家长。

## 孩子（家长）

家庭的成员都能用，管理员和普通家长一样。

| 接口                                                                    | 请求                                         | 成功                                        | 出错                                              |
| ----------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| `GET /api/families/{familyId}/children`                                 | —                                            | `200` 孩子列表，按添加的时间排              | —                                                 |
| `POST /api/families/{familyId}/children`                                | `{ "nickname", "account", "consent": true }` | `201` 孩子                                  | `400`、`409 account_taken`                        |
| `PATCH /api/families/{familyId}/children/{childId}`                     | `{ "nickname"?, "account"? }`                | `200` 孩子                                  | `400`、`404 child_not_found`、`409 account_taken` |
| `DELETE /api/families/{familyId}/children/{childId}`                    | —                                            | `204`                                       | `404 child_not_found`                             |
| `POST /api/families/{familyId}/children/{childId}/password-reset`       | —                                            | `204`                                       | `404 child_not_found`                             |
| `POST /api/families/{familyId}/children/{childId}/login-links`          | —                                            | `201 { "id", "url", "expiresAt" }`          | `404 child_not_found`                             |
| `GET /api/families/{familyId}/children/{childId}/login-links/{linkId}`  | —                                            | `200 { "status", "expiresAt" }`             | `404 child_not_found`、`404 not_found`            |
| `GET /api/families/{familyId}/children/{childId}/devices`               | —                                            | `200` 设备列表，按最近登录从新到旧          | `404 child_not_found`                             |
| `DELETE /api/families/{familyId}/children/{childId}/devices/{deviceId}` | —                                            | `204`（撤销一台；设备已经不在时也是 `204`） | `404 child_not_found`                             |
| `DELETE /api/families/{familyId}/children/{childId}/devices`            | —                                            | `204`（全部撤销）                           | `404 child_not_found`                             |

孩子：

```json
{
  "id": "3f9b…",
  "nickname": "豆豆",
  "account": "doudou",
  "passwordSet": false,
  "passwordSetupUntil": "2026-11-25T01:12:00Z"
}
```

- `passwordSet` 是孩子有没有设密码；`passwordSetupUntil` 是还没设密码时用账号登录能设密码的期限，设了密码或者没有期限时是 `null`。

设备：

```json
{
  "id": "a07c…",
  "name": "iPad · Safari",
  "rememberedAt": "2026-11-18T08:30:00Z",
  "lastUsedAt": "2026-11-22T01:12:00Z"
}
```

- 孩子不在这个家庭里（包括别的家庭的孩子和已经删除的孩子）时返回 `404 child_not_found`。
- `nickname` 去掉前后空格后 1–10 个字，不超过 160 字节；`account` 去掉前后空格后 1–20 个字符，只能是小写字母和数字，不是时 `code` 是 `invalid`。`consent` 不是 `true` 时，字段 `consent` 的 `code` 是 `required`。
- 添加孩子时在同一个事务里写审计记录 `child.created`，带同意文字的版本；用账号登录能设密码的期限是添加后 48 小时。
- `url` 是 `<本站地址>/child/qr/<令牌>`，令牌只在这个响应里出现。链接存在 Redis 里，生成时这个孩子之前还没用过的链接作废；Redis 连不上时返回 `500 internal`。
- 链接的 `status` 是 `active`、`used`、`expired` 或 `revoked`，从 Redis 读；状态的键过期后是 `expired`。
- 重设密码在同一个事务里清掉密码、把用账号登录设密码的期限定为 48 小时后、删掉这个孩子全部记住的设备，并让之前签发的孩子 JWT 作废；还没用掉的登录链接照常有效。
- 删除孩子时，记住的设备和分派给他的书一起删掉，再删掉 Redis 里他的登录链接。

## 书库和书本（家长）

家庭的成员都能用，管理员和普通家长一样。

| 接口                                                         | 请求                               | 成功                            | 出错                                                                                             |
| ------------------------------------------------------------ | ---------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET /api/families/{familyId}/books`                         | 查询参数见下                       | `200 { "books", "nextCursor" }` | `400`、`404 child_not_found`                                                                     |
| `GET /api/families/{familyId}/book-filters`                  | 查询参数 `grade`、`scope`、`child` | `200 { "grades", "subjects" }`  | `400`、`404 child_not_found`                                                                     |
| `GET /api/families/{familyId}/books/{bookId}`                | —                                  | `200` 书本详情                  | `404 book_not_found`                                                                             |
| `PUT /api/families/{familyId}/books/{bookId}/acquisition`    | —                                  | `200` 书本详情（获取）          | `404 book_not_found`、`409 book_inactive`                                                        |
| `DELETE /api/families/{familyId}/books/{bookId}/acquisition` | —                                  | `204`（移除）                   | `404 book_not_found`、`409 book_in_use`                                                          |
| `PUT /api/families/{familyId}/books/{bookId}/readers`        | `{ "childIds": ["3f9b…"] }`        | `200` 书本详情                  | `400`、`404 book_not_found`、`404 child_not_found`、`409 book_not_acquired`、`409 book_inactive` |

`GET /api/families/{familyId}/books` 的查询参数：

| 参数      | 说明                                                                                      |
| --------- | ----------------------------------------------------------------------------------------- |
| `grade`   | 年级编号，可以重复，比如 `grade=grade-1&grade=grade-2`；不带就是全部年级                  |
| `subject` | 学科编号，可以重复；不带就是全部学科                                                      |
| `scope`   | `library`（默认，全部上架的书）、`family`（家里获取的书）或 `child`（分派给一个孩子的书） |
| `child`   | `scope` 是 `child` 时必填，孩子编号                                                       |
| `cursor`  | 下一批的游标                                                                              |

- 一批 12 本，按书加进书本表的时间从新到旧，相同时按书本编号。
- 不存在的年级和学科编号不报错，不算进筛选。`child` 不是这个家庭的孩子时返回 `404 child_not_found`，前端把范围换回书库。
- `book-filters` 的 `grades` 是全部年级，按表里定的顺序；`subjects` 是在给出的年级和范围下有书的学科，按表里的顺序。

书本（列表里的一本）：

```json
{
  "id": "carrot-counting-adventure",
  "title": "胡萝卜数数大冒险",
  "intro": "小兔要把 20 根胡萝卜分给朋友们……",
  "grade": { "id": "grade-1", "name": "一年级" },
  "subject": { "id": "math", "name": "数学" },
  "status": "active",
  "coverUrl": "/api/books/carrot-counting-adventure/cover?v=9f2c…",
  "acquired": true,
  "readers": [{ "childId": "3f9b…", "nickname": "小米" }]
}
```

- `coverUrl` 没有封面时是 `null`，前端用默认封面。
- `readers` 是在读这本书的孩子，按添加孩子的时间排；家里没获取时是 `[]`。

书本详情：上面的内容，再加 `replacement`：

```json
{
  "replacement": {
    "id": "carrot-counting-adventure",
    "title": "胡萝卜数数大冒险"
  }
}
```

- `replacement` 只在这本书已下架、有替代的书、替代的书是上架的时候带，其余时候是 `null`。
- 书本不存在，或者是这个家庭没获取的已下架的书，返回 `404 book_not_found`。
- 获取：家里已经获取了也返回 `200`。书已下架时返回 `409 book_inactive`。
- 移除：家里没获取时也返回 `204`。还有孩子在读时返回 `409 book_in_use`。
- `readers` 接口把在读的孩子设成 `childIds`：新加的分派，去掉的撤回，在一个事务里做；已经是这样的不报错。家里没获取时返回 `409 book_not_acquired`。书已下架时只能去掉，加了新孩子返回 `409 book_inactive`。`childIds` 里有不是这个家庭的孩子时返回 `404 child_not_found`，什么都不改。

## 封面

### GET /api/books/{bookId}/cover

- 家长或孩子登录后才能取。参数 `v` 是封面的 SHA-256，和书本表里的不一样，或者这本书没有封面时返回 `404 not_found`。
- 成功返回 `200` 和封面图本身，`Content-Type` 是 `image/webp` 或 `image/png`，`Cache-Control: private, max-age=31536000, immutable`。
- 后端从对象存储的 `books/<书本编号>/cover.<格式>` 读出原样返回。

## 孩子登录

这些接口不用登录。

| 接口                                              | 请求                                             | 成功                                                                      | 出错                                                                                 |
| ------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `POST /api/child-auth/login`                      | `{ "code", "account", "password"?, "remember" }` | `200 { "id", "nickname" }` 或 `200 { "needsPassword": true, "nickname" }` | `401 login_failed`、`429 rate_limited`                                               |
| `POST /api/child-auth/password`                   | `{ "code", "account", "password", "remember" }`  | `200 { "id", "nickname" }`                                                | `400`、`401 login_failed`、`429 rate_limited`                                        |
| `GET /api/child-auth/remembered`                  | —                                                | `200 [{ "childId", "nickname", "familyCode", "account" }]`                | —                                                                                    |
| `POST /api/child-auth/remembered/{childId}/login` | —                                                | `200 { "id", "nickname" }`                                                | `401 remember_invalid`                                                               |
| `POST /api/child-auth/logout`                     | —                                                | `204`                                                                     | —                                                                                    |
| `GET /api/child-login-links/{token}`              | —                                                | `200 { "childId", "nickname", "needsPassword" }`                          | `404 link_invalid`                                                                   |
| `POST /api/child-login-links/{token}/password`    | `{ "password", "remember" }`                     | `200 { "id", "nickname" }`                                                | `400`、`404 link_invalid`、`409 password_already_set`                                |
| `POST /api/child-login-links/{token}/login`       | `{ "password", "remember" }`                     | `200 { "id", "nickname" }`                                                | `401 wrong_password`、`404 link_invalid`、`409 password_not_set`、`429 rate_limited` |

- 登录成功（输入账号密码、用账号登录设密码、点头像、扫码设密码、扫码输密码）都签发孩子的登录 cookie，签发时间取数据库的当前时间，并删掉这个孩子已经过期的设备记录。`remember` 是 `true` 时，建立或续期这台浏览器上这个孩子的设备记录：浏览器带来的设备令牌在库里有记录才沿用，没有记录或者没有设备 cookie 时先签发一个新的令牌；是 `false` 时去掉这台浏览器上这个孩子的设备记录。
- `password` 都是 6–32 个字符、不超过 128 字节；登录时超过的不做散列，当作密码不对。
- `POST /api/child-auth/login`：`code` 不分大小写，后端转成大写再查。家庭码和账号对上了一个还没设密码、还在期限内的孩子时，不看 `password`，返回 `200 { "needsPassword": true, "nickname" }`，不登录，前端换成设密码的卡片。其余情况下，家庭码、账号、密码有一项不对，有密码的孩子没带 `password`，或者还没设密码的孩子已经过了期限，都返回 `401 login_failed`，不说是哪一项。
- `POST /api/child-auth/password`：给还没设密码、还在期限内的孩子设密码并登录，清掉期限。家庭码或账号不对、孩子已经有密码、过了期限，都返回 `401 login_failed`。
- 限流：`login` 和 `password` 的 `401 login_failed`、`child-login-links/{token}/login` 的 `401 wrong_password` 都算一次失败，按来源加孩子 15 分钟里 10 次、按来源合计 15 分钟里 200 次，见 `rules.md` 的“限流”。
- `GET /api/child-auth/remembered`：按设备 cookie 列出这台浏览器上还有效的设备记录；没有设备 cookie 时返回 `[]`。`familyCode` 是孩子家庭的家庭码，`account` 是孩子的账号，用来在点头像登录失败时填好表单。
- `POST /api/child-auth/remembered/{childId}/login`：续期 30 天，更新最近一次登录的时间。设备记录被撤销、过期或不存在时返回 `401 remember_invalid`，不多带内容；前端用读头像列表时拿到的家庭码和账号填好表单。
- `POST /api/child-auth/logout`：只清掉孩子的登录 cookie，设备 cookie 留着。
- `GET /api/child-login-links/{token}` 不会用掉链接。`needsPassword` 是 `true` 表示孩子还没有密码。链接过期、用过、作废、不存在，或者孩子已经删除，都返回 `404 link_invalid`。
- `POST /api/child-login-links/{token}/password`：给还没有密码的孩子设密码，用掉链接并登录，不看期限。孩子已经有密码时返回 `409 password_already_set`。
- 扫码登录的链接存在 Redis 里；Redis 连不上时这三个接口返回 `500 internal`。
- `POST /api/child-login-links/{token}/login`：给已经有密码的孩子输密码，对了就用掉链接并登录；密码不对返回 `401 wrong_password`，链接照常能用。孩子还没有密码时返回 `409 password_not_set`。
- 孩子的登录 cookie：属性和家长的 JWT cookie 一样（`HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`），有效期 7 天；剩下不到 3.5 天时，孩子的任何登录过的请求的响应都换发一个新的。
- 设备 cookie：`HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`，有效期 30 天；每次点头像登录时续期。

## 孩子（孩子登录后）

### GET /api/child/me

```json
{
  "id": "3f9b…",
  "nickname": "小米",
  "account": "xiaomi",
  "familyName": "林悦的家"
}
```

- 孩子的每个请求都查这个孩子还在不在、JWT 是不是在最后一次重设密码之后签发的；不是就返回 `401 unauthenticated`。

### PATCH /api/child/me

孩子改自己的昵称。请求 `{ "nickname": "米米" }`，成功返回 `200` 和同 `GET /api/child/me` 的内容；`nickname` 去掉前后空格后不是 1–10 个字，或者超过 160 字节时返回 `400`。写审计记录 `child.updated`，做事的是孩子。

### GET /api/child/books

分派给这个孩子的书，按分派的时间从新到旧，一次全部返回：

```json
{
  "books": [
    {
      "id": "carrot-counting-adventure",
      "title": "胡萝卜数数大冒险",
      "intro": "小兔要把 20 根胡萝卜分给朋友们……",
      "grade": { "id": "grade-1", "name": "一年级" },
      "subject": { "id": "math", "name": "数学" },
      "status": "active",
      "coverUrl": "/api/books/carrot-counting-adventure/cover?v=9f2c…",
      "isNew": true
    }
  ],
  "newCount": 1
}
```

- `isNew` 是孩子还没打开过这本书；`newCount` 是这些书的本数。

## Authing 的通知

### POST /api/webhooks/authing

Authing 在用户被删除后发来的 webhook。不用登录，不查 `Origin`。

- 请求头里的 webhook 密钥和 `AUTHING_WEBHOOK_SECRET` 用定长比较核对，不对或者没有时返回 `401`，错误码 `unauthenticated`，什么都不做。Authing 文档里请求头的名字有两种写法（`x-authing-webhook-secret`、`X-Authing-Token`），scaffold 步骤在测试环境上用真的通知核对后写在这里。
- 请求体是 JSON：`eventName` 和 `data`。只处理 `eventName` 是 `user:deleted` 的，被删的用户在 `data.users` 里，用每个用户的编号作为 `sub`、配置的 issuer 找家长；别的事件返回 `200`，什么都不做。
- 找到的家长在一个事务里删掉：他是管理员、家里还有别的家长的家庭，管理员交给其余家长里最早加入的一位（审计记录 `member.admin_transferred`，做事的是 `system`）；只剩他一位家长的家庭整个删掉（`family.deleted`）；再删掉他的成员关系、加入申请和他自己（`parent.deleted`，`via` 是 `webhook`）。之后删掉 Redis 里被删的孩子的登录链接。
- 找不到的家长（比如他自己删的、已经删过了）不处理。同一个通知来几次结果都一样，都返回 `200`。

## 调用的外部接口

### Authing 的管理 API

地址是 `AUTHING_MANAGEMENT_ORIGIN`，测试环境是 `https://api.authing.cn`；开发机和测试里是仓库里的替身服务。只在家长删除自己的账号时调用，用 Node 自带的 fetch，每次 10 秒超时。

| 调用       | 请求                                                                                                                            | 用到的返回           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 换管理令牌 | `POST /api/v3/get-management-token`，`{ "accessKeyId": <AUTHING_USER_POOL_ID>, "accessKeySecret": <AUTHING_USER_POOL_SECRET> }` | 管理令牌和它的有效期 |
| 删除用户   | `POST /api/v3/delete-users-batch`，请求头带管理令牌和 `x-authing-userpool-id`，`{ "userIds": [<家长的 sub>] }`                  | 是否成功             |

- 管理令牌每次删除时现换，不缓存。
- 路径和字段以 Authing 的文档为准，scaffold 步骤在测试环境上核对；替身服务按核对后的样子实现。
- 删除用户时 Authing 返回的错误和超时都当作失败，`DELETE /api/me` 返回 `502 identity_provider_failed`。日志里记 Authing 返回的错误码，不记令牌和密钥。

## 错误码和界面上的提示

| 错误码                                     | 界面上的提示                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `unauthenticated`                          | 家长的页面：回到 `/`，重新登录后回到原来的页面；孩子的页面：回到 `/child`                                                                |
| `code_not_found`                           | 没有这个家庭码                                                                                                                           |
| `already_member`                           | 你已经是这个家庭的成员                                                                                                                   |
| `request_pending`                          | 查码或发申请时：你已经申请过了，等管理员处理；点「知道了」时：出了点问题，请稍后再试（界面上等待中的申请没有「知道了」，正常用不会碰到） |
| `request_closed`                           | 管理员处理时：这个申请已经失效了；申请人撤回时：这个申请已经处理过了                                                                     |
| `not_found`                                | 这个申请已经不在了，刷新列表；查登录二维码的状态时：二维码显示已失效；取封面时：显示默认封面                                             |
| `admin_cannot_leave`                       | 先把管理员设给别人才能离开                                                                                                               |
| `already_admin`                            | 你已经是管理员了（界面上没有这个操作，正常用不会碰到）                                                                                   |
| `still_admin`                              | 你还是家庭的管理员，先把管理员设给别人（顶部提示条），刷新页面                                                                           |
| `identity_provider_failed`                 | 出了点问题，请稍后再试                                                                                                                   |
| `rate_limited`                             | 试得太多了，请 <分钟数> 分钟后再试（分钟数由 `retryAfterSeconds` 向上取整），显示在原来显示错误的地方                                    |
| `not_admin`                                | 你已不是管理员                                                                                                                           |
| `not_a_member`                             | 这位家长已经不在家庭里了                                                                                                                 |
| `family_not_found`                         | 找不到这个家庭（整页）                                                                                                                   |
| `account_taken`                            | 家里已经有孩子用这个账号了（账号框下面）                                                                                                 |
| `child_not_found`                          | 这个孩子已经被删除了，刷新列表或这本书；查登录二维码的状态时：二维码显示已失效；书库按孩子筛选时：范围换回书库，不提示                   |
| `book_not_found`                           | 书本页：找不到这本书（整页）；书库里操作时：刷新书库，不提示                                                                             |
| `book_in_use`                              | 还有孩子在读这本书，先在「谁能读」里取消                                                                                                 |
| `book_not_acquired`                        | 这本书已经不在我家的书里了                                                                                                               |
| `book_inactive`                            | 这本书已下架                                                                                                                             |
| `login_failed`                             | 家庭码、账号或密码不对                                                                                                                   |
| `remember_invalid`                         | 这台设备需要重新输入密码，打开填好家庭码和账号的表单                                                                                     |
| `link_invalid`                             | 这个二维码已经失效了（整页）                                                                                                             |
| `wrong_password`                           | 密码不对                                                                                                                                 |
| `password_already_set`、`password_not_set` | 不提示，重新读取二维码的状态，换成对应的表单                                                                                             |
| `bad_origin`                               | 出了点问题，请稍后再试                                                                                                                   |
| `internal`、没有回应                       | 出了点问题，请稍后再试                                                                                                                   |
| `invalid_request`                          | 按出错的字段显示 `rules.md` 里那个字段的提示                                                                                             |

- `book_in_use`、`book_not_acquired`、`book_inactive` 都显示在顶部提示条里，然后刷新这本书。

Last changed: #14 (2026-11-24)
