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

- 脚本、图片、字体和接口请求都只能来自本站，页面不能被任何页面嵌入。
- 样式允许内联，因为 Angular 运行时会把组件样式插成页面里的 `<style>`。
- `Permissions-Policy` 关掉平台现在用不到的设备能力。以后有功能要用其中一项时，由那个 issue 打开。只列 Chrome 认得的名字，不认得的会在控制台报错。
- 跳到 Authing 和从 Authing 回来都是整页跳转，不受 CSP 限制；所以前端不用放开 Authing 的域名。

### 后端

`/api/*` 的每个响应：

| 响应头                         | 值                                           |
| ------------------------------ | -------------------------------------------- |
| `Content-Security-Policy`      | `default-src 'none'; frame-ancestors 'none'` |
| `X-Content-Type-Options`       | `nosniff`                                    |
| `Cross-Origin-Opener-Policy`   | `same-origin`                                |
| `Cross-Origin-Resource-Policy` | `same-origin`                                |
| `Permissions-Policy`           | 和前端一样                                   |

- 后端只返回 JSON 和登录用的跳转，不加载任何资源，CSP 什么都不允许。
- 经过前端转发的 `/api/*` 响应带后端自己的这一份，不带前端的。

## 通用约定

- **登录状态**：除了 `/api/health` 和 `/api/auth/*`，每个接口都要登录。没登录、JWT 过期或签名不对时返回 `401`，错误码 `unauthenticated`。
- **防跨站请求伪造**：非 GET、HEAD、OPTIONS 的请求，`Origin` 头不是本站地址或者没有时返回 `403`，错误码 `bad_origin`。
- **家庭内的接口**在 `/api/families/{familyId}/...` 下，先查当前家长是不是这个家庭的成员：不是成员或家庭不存在都返回 `404`，错误码 `family_not_found`。要管理员的接口，不是管理员时返回 `403`，错误码 `not_admin`。
- **找不到**：接口地址不存在，或者加入申请不存在（包括不是自己的申请）时返回 `404`，错误码 `not_found`。
- **出错的响应**：`{ "error": { "code": "<错误码>", "requestId": "<请求编号>" } }`。界面上的提示由前端按错误码显示；界面上的错误编号是 `requestId` 的前 8 位，写成“a1f3-92c0”的样子。
- **请求格式不对**：`400`，错误码 `invalid_request`，另带出错的字段 `fields: [{ "path": "name", "code": "too_long" }]`。字段出错的 `code` 有三种：`required`（没填）、`too_long`（太长）、`invalid`（格式不对）。
- **意外的错**：`500`，错误码 `internal`，只带请求编号，不带错误详情。

## GET /api/health

健康检查，不需要登录，只读，不改任何数据。冒烟测试经过前端的 `/api` 转发调用它。

### 检查项

| 检查项     | 怎么检查                  | 超时 |
| ---------- | ------------------------- | ---- |
| `database` | 在数据库上执行 `SELECT 1` | 5 秒 |
| `storage`  | 确认配置里的存储桶能访问  | 5 秒 |

两项同时检查。超过 5 秒没有结果的，算作失败；这段时间也够 Neon 数据库从暂停里唤醒。

### 响应

全部正常时返回 `200`：

```json
{
  "status": "ok",
  "checks": {
    "database": "ok",
    "storage": "ok"
  }
}
```

有任何一项失败就返回 `503`，失败的那一项标成 `"error"`：

```json
{
  "status": "error",
  "checks": {
    "database": "ok",
    "storage": "error"
  }
}
```

- 响应里不带错误详情，免得泄露内部信息。
- 失败的原因写进日志，包括超时和错误信息，但不写连接地址和凭据。

## 登录

| 接口                     | 做什么                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/auth/login`    | 参数 `returnTo`（可选，本站以 `/` 开头的路径）。生成 state、nonce 和 PKCE，放进 10 分钟的签名 cookie，`302` 跳到 Authing 的授权地址                                                                                                                                                                                           |
| `GET /api/auth/callback` | Authing 跳回来的地址。核对 state，用授权码换令牌，校验 ID 令牌和 nonce。第一次登录时建立家长，名字用 ID 令牌里的名字，没有就用邮箱 @ 前面的部分；以后只更新邮箱。每次都记下协议版本和时间。签发 JWT cookie，把 ID 令牌放进另一个 cookie，`302` 回到 `returnTo` 或 `/`。任何一步失败都 `302` 到 `/?login=failed`，原因写进日志 |
| `POST /api/auth/logout`  | 清掉 JWT 和 ID 令牌两个 cookie，返回 `200` 和 `{ "endSessionUrl": "<Authing 的退出地址>" }`，前端整页跳过去。退出地址带 `id_token_hint`（ID 令牌 cookie 里的令牌）、`client_id` 和退回产品主页的 `post_logout_redirect_uri`。不需要登录：没登录或没有 ID 令牌时也返回退出地址，只是不带 `id_token_hint`                       |

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
    { "id": "5d1e…", "name": "林悦的家", "role": "admin", "pendingRequests": 2 },
    { "id": "8a40…", "name": "外婆家", "role": "member" }
  ],
  "requestResults": 1
}
```

- `email` 没有时是 `null`。
- `families` 按加入时间排列；`pendingRequests` 只在当前家长是这个家庭的管理员时带，是等待中的申请数。
- `requestResults` 是自己发出的申请里已同意、被拒绝、已失效且还没点「知道了」的条数，用来显示「加入家庭」和头像上的红点。

### PATCH /api/me

改自己的名字。请求 `{ "name": "林悦" }`，成功返回 `200` 和同 `GET /api/me` 的内容；`name` 去掉前后空格后不是 1–20 个字时返回 `400`。

## 家庭

| 接口                                                 | 谁能用                       | 请求                       | 成功                   | 出错                                                          |
| ---------------------------------------------------- | ---------------------------- | -------------------------- | ---------------------- | ------------------------------------------------------------- |
| `POST /api/families`                                 | 登录的家长                   | `{ "name", "timezone" }`   | `201` 家庭详情         | `400`                                                         |
| `GET /api/families/{familyId}`                       | 成员                         | —                          | `200` 家庭详情         | `404 family_not_found`                                        |
| `PATCH /api/families/{familyId}`                     | 管理员                       | `{ "name"?, "timezone"? }` | `200` 家庭详情         | `400`、`403 not_admin`                                        |
| `POST /api/families/{familyId}/code`                 | 管理员                       | —                          | `200` 家庭详情（新码） | `403 not_admin`                                               |
| `PUT /api/families/{familyId}/admin`                 | 管理员                       | `{ "parentId" }`           | `200` 家庭详情         | `403 not_admin`、`409 not_a_member`                           |
| `DELETE /api/families/{familyId}/members/{parentId}` | 管理员移出别人；成员移出自己 | —                          | `204`                  | `403 not_admin`、`409 admin_cannot_leave`、`409 not_a_member` |

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
    { "parentId": "41f2…", "name": "周子航", "email": null, "role": "member", "you": false }
  ]
}
```

- `members` 按加入时间排列；`email` 没有时是 `null`。
- `name` 去掉前后空格后 1–20 个字；`timezone` 必须是 IANA 时区名。
- 更换家庭码时，这个家庭等待中的申请在同一个事务里变成已失效。
- 设为管理员时，原管理员和新管理员的角色在同一个事务里对调。

## 申请加入（申请人）

| 接口                                          | 请求         | 成功                                                                                   | 出错                                                              |
| --------------------------------------------- | ------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET /api/family-codes/{code}`                | —            | `200 { "familyName", "adminName" }`                                                    | `404 code_not_found`、`409 already_member`、`409 request_pending` |
| `POST /api/join-requests`                     | `{ "code" }` | `201` 申请                                                                             | `404 code_not_found`、`409 already_member`、`409 request_pending` |
| `GET /api/join-requests`                      | —            | `200` 申请列表：等待中、已同意、被拒绝和已失效、还没点「知道了」的，按发出时间从新到旧 | —                                                                 |
| `DELETE /api/join-requests/{requestId}`       | —            | `204`（撤回）                                                                          | `404 not_found`、`409 request_closed`                             |
| `POST /api/join-requests/{requestId}/dismiss` | —            | `204`（申请人的「知道了」，对已同意、被拒绝、已失效的申请）                            | `404 not_found`、`409 request_pending`                            |

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

## 新成员（管理员）

| 接口                                                              | 成功                                         | 出错                                                    |
| ----------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------- |
| `GET /api/families/{familyId}/join-requests`                      | `200 { "pending": [...], "handled": [...] }` | `403 not_admin`                                         |
| `POST /api/families/{familyId}/join-requests/{requestId}/approve` | `200` 处理后的申请                           | `403 not_admin`、`404 not_found`、`409 request_closed`  |
| `POST /api/families/{familyId}/join-requests/{requestId}/reject`  | `200` 处理后的申请                           | `403 not_admin`、`404 not_found`、`409 request_closed`  |
| `POST /api/families/{familyId}/join-requests/{requestId}/dismiss` | `204`（管理员的「知道了」）                  | `403 not_admin`、`404 not_found`、`409 request_pending` |

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
  ],
  "handled": [
    {
      "id": "77b0…",
      "parentId": "c3d9…",
      "name": "林建国",
      "email": "jianguo.lin@example.com",
      "status": "approved",
      "closedAt": "2026-11-18T10:03:00Z"
    }
  ]
}
```

- `pending` 按发出时间从新到旧；`handled` 是已同意、已拒绝、已失效且管理员还没点「知道了」的，按处理时间从新到旧。撤回的不列出。
- `parentId` 是申请人的家长编号，用来算头像颜色。
- 同意时，申请人在同一个事务里成为普通家长。

## 错误码和界面上的提示

| 错误码               | 界面上的提示                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `unauthenticated`    | 回到产品主页，重新登录后回到原来的页面                                                                                                   |
| `code_not_found`     | 没有这个家庭码                                                                                                                           |
| `already_member`     | 你已经是这个家庭的成员                                                                                                                   |
| `request_pending`    | 查码或发申请时：你已经申请过了，等管理员处理；点「知道了」时：出了点问题，请稍后再试（界面上等待中的申请没有「知道了」，正常用不会碰到） |
| `request_closed`     | 管理员处理时：这个申请已经失效了；申请人撤回时：这个申请已经处理过了                                                                     |
| `not_found`          | 这个申请已经不在了，刷新列表                                                                                                             |
| `admin_cannot_leave` | 先把管理员设给别人才能离开                                                                                                               |
| `not_admin`          | 你已不是管理员                                                                                                                           |
| `not_a_member`       | 这位家长已经不在家庭里了                                                                                                                 |
| `family_not_found`   | 找不到这个家庭（整页）                                                                                                                   |
| `bad_origin`         | 出了点问题，请稍后再试                                                                                                                   |
| `internal`、没有回应 | 出了点问题，请稍后再试                                                                                                                   |
| `invalid_request`    | 按出错的字段显示 `rules.md` 里那个字段的提示                                                                                             |

Last changed: #7 (2026-11-21)
