# 数据

PostgreSQL 里的表，用 Drizzle 定义，由迁移脚本建立。时间都存成带时区的时间戳（`timestamptz`），编号都是 UUID，由数据库生成。

## parents：家长

| 字段              | 类型              | 说明                                                                   |
| ----------------- | ----------------- | ---------------------------------------------------------------------- |
| `id`              | uuid，主键        | 本站的家长编号，也是 JWT 里的家长编号                                  |
| `oidc_issuer`     | text，必填        | Authing 的 issuer                                                      |
| `oidc_subject`    | text，必填        | Authing 给的 `sub`                                                     |
| `name`            | text，必填        | 显示的名字，1–20 个字；建立记录时从 Authing 取，之后家长在个人设置里改 |
| `email`           | text，可空        | 邮箱，每次登录从 Authing 更新；Authing 没给时为空                      |
| `consent_version` | text，必填        | 最近一次登录时同意的协议版本                                           |
| `consented_at`    | timestamptz，必填 | 最近一次登录回到本站、同意协议的时间，也就是最后一次登录的时间         |
| `created_at`      | timestamptz，必填 | 建立的时间                                                             |
| `updated_at`      | timestamptz，必填 | 最后一次修改这一行的时间                                               |

- `(oidc_issuer, oidc_subject)` 唯一。
- 名字和邮箱是家长的个人信息，不写进日志，列进日志的遮挡列表。

## families：家庭

| 字段         | 类型              | 说明                                    |
| ------------ | ----------------- | --------------------------------------- |
| `id`         | uuid，主键        | 家庭编号，出现在地址和接口路径里        |
| `name`       | text，必填        | 1–20 个字（按字符数），去掉前后空格     |
| `timezone`   | text，必填        | IANA 时区名                             |
| `code`       | text，必填，唯一  | 家庭码，正好 6 个字符（数据库约束检查） |
| `created_at` | timestamptz，必填 |                                         |
| `updated_at` | timestamptz，必填 | 最后一次改名称、时区或家庭码的时间      |

- 家庭码拿到就能申请加入这个家庭，不写进日志：查家庭码的请求地址在日志里写成 `/api/family-codes/[redacted]`。

## family_members：家庭里的家长

| 字段        | 类型                            | 说明                   |
| ----------- | ------------------------------- | ---------------------- |
| `family_id` | uuid，必填，引用 `families`     |                        |
| `parent_id` | uuid，必填，引用 `parents`      |                        |
| `role`      | text，必填，`admin` 或 `member` | 管理员或普通家长       |
| `joined_at` | timestamptz，必填               | 加入的时间，用来排顺序 |

- 主键是 `(family_id, parent_id)`。
- 每个家庭最多一个 `admin`：在 `family_id` 上建只包括 `role = 'admin'` 的唯一索引。至少一个由业务保证：创建家庭时同时写入管理员；设为管理员在一个事务里把两人的角色对调；管理员不能离开，也不能被移出。
- 移出和离开就是删掉这一行，不另留记录。

## join_requests：加入申请

| 字段                        | 类型                        | 说明                                                      |
| --------------------------- | --------------------------- | --------------------------------------------------------- |
| `id`                        | uuid，主键                  |                                                           |
| `family_id`                 | uuid，必填，引用 `families` | 申请加入的家庭                                            |
| `parent_id`                 | uuid，必填，引用 `parents`  | 申请人                                                    |
| `code`                      | text，必填                  | 申请时用的家庭码，正好 6 个字符（数据库约束检查）         |
| `status`                    | text，必填                  | `pending`、`approved`、`rejected`、`withdrawn`、`expired` |
| `created_at`                | timestamptz，必填           | 发出的时间                                                |
| `closed_at`                 | timestamptz，可空           | 同意、拒绝、撤回或作废的时间                              |
| `closed_by`                 | uuid，可空，引用 `parents`  | 同意或拒绝的管理员                                        |
| `dismissed_by_applicant_at` | timestamptz，可空           | 申请人点「知道了」的时间                                  |
| `dismissed_by_admin_at`     | timestamptz，可空           | 管理员点「知道了」的时间                                  |

- 同一位家长对同一个家庭最多一个 `pending`：在 `(family_id, parent_id)` 上建只包括 `status = 'pending'` 的唯一索引。
- 更换家庭码时，在同一个事务里把这个家庭的 `pending` 申请改成 `expired`。
- 记录一直保存，不删除；「知道了」只填对应的时间。

## children：孩子

| 字段                   | 类型                        | 说明                                                                |
| ---------------------- | --------------------------- | ------------------------------------------------------------------- |
| `id`                   | uuid，主键                  | 孩子编号，也是孩子 JWT 里的编号                                     |
| `family_id`            | uuid，必填，引用 `families` | 孩子属于的家庭                                                      |
| `nickname`             | text，必填                  | 昵称的密文（AES-256-GCM，带密钥编号）；明文去掉前后空格后 1–10 个字 |
| `account`              | text，必填                  | 账号的密文；明文是 1–20 个小写字母和数字                            |
| `account_lookup`       | text，必填                  | 账号的查找值：家庭编号加账号的 HMAC-SHA256，写成十六进制            |
| `password_hash`        | text，可空                  | argon2id 的散列字符串，带着参数；为空表示还没设密码                 |
| `sessions_valid_after` | timestamptz，必填           | 在这之前签发的孩子 JWT 一律不认；添加孩子和重设密码时写入当时的时间 |
| `consent_parent_id`    | uuid，必填，引用 `parents`  | 添加时勾选监护人同意的家长                                          |
| `consent_version`      | text，必填                  | 同意文字的版本                                                      |
| `consented_at`         | timestamptz，必填           | 同意的时间                                                          |
| `created_at`           | timestamptz，必填           | 添加的时间，用来排顺序                                              |
| `updated_at`           | timestamptz，必填           | 最后一次修改这一行的时间                                            |

- `(family_id, account_lookup)` 唯一，保证账号在家庭内唯一；登录时也按它查找。
- 昵称、账号和设备名称是孩子的个人信息：加密保存，不写进日志，列进日志的遮挡列表。密码不写进日志，也不存明文。
- 重设密码：在一个事务里清空 `password_hash`、写入 `sessions_valid_after`、删掉这个孩子的全部 `child_devices`。
- 删除孩子就是删掉这一行，记住的设备和登录链接跟着删掉；同意记录在这一行里，一起删掉。

## child_login_links：扫码登录链接

| 字段         | 类型                                      | 说明                                     |
| ------------ | ----------------------------------------- | ---------------------------------------- |
| `id`         | uuid，主键                                | 家长查链接状态时用                       |
| `child_id`   | uuid，必填，引用 `children`，跟着孩子删除 |                                          |
| `token_hash` | text，必填，唯一                          | 令牌的 SHA-256，写成十六进制             |
| `created_by` | uuid，必填，引用 `parents`                | 生成链接的家长                           |
| `created_at` | timestamptz，必填                         | 生成的时间                               |
| `expires_at` | timestamptz，必填                         | 生成后 10 分钟                           |
| `used_at`    | timestamptz，可空                         | 登录成功、用掉链接的时间                 |
| `revoked_at` | timestamptz，可空                         | 同一个孩子生成了新链接、这一条作废的时间 |

- 状态：`used_at` 不为空是用过（`used`），`revoked_at` 不为空是作废（`revoked`），过了 `expires_at` 是过期（`expired`），其余是有效（`active`）。
- 生成新链接时，在同一个事务里给这个孩子还没用过、还没作废的链接写上 `revoked_at`。
- 令牌本身只在链接里，数据库不存。扫码登录的接口地址在日志里写成 `/api/child-login-links/[redacted]`；页面地址 `/child/qr/<令牌>` 不发给接口。

## child_devices：记住的设备

| 字段            | 类型                                      | 说明                                         |
| --------------- | ----------------------------------------- | -------------------------------------------- |
| `id`            | uuid，主键                                | 家长撤销一台设备时用                         |
| `child_id`      | uuid，必填，引用 `children`，跟着孩子删除 |                                              |
| `token_hash`    | text，必填                                | 这台浏览器的设备令牌的 SHA-256，写成十六进制 |
| `name`          | text，必填                                | 设备名称的密文，记住时从浏览器得出           |
| `remembered_at` | timestamptz，必填                         | 记住的时间                                   |
| `last_used_at`  | timestamptz，必填                         | 最近一次登录的时间                           |
| `expires_at`    | timestamptz，必填                         | `last_used_at` 加 30 天                      |

- `(child_id, token_hash)` 唯一：一台浏览器记住几个孩子时共用一个设备令牌，每个孩子一行。
- 撤销一台设备就删掉这一行；全部撤销和重设密码删掉这个孩子的全部行。
- 不勾「在这台设备上记住我」登录时，删掉这台浏览器上这个孩子的那一行。

## 浏览器里存的

| 存什么               | 放在哪里         | 内容                                                            | 多久                                        |
| -------------------- | ---------------- | --------------------------------------------------------------- | ------------------------------------------- |
| 家长的登录状态       | HttpOnly cookie  | 本站签发的 JWT，只有家长编号和身份种类 `parent`                 | 7 天，常用时续期                            |
| Authing 的 ID 令牌   | HttpOnly cookie  | 家长在 Authing 的编号、名字和邮箱，退出时用                     | 跟着家长的登录状态                          |
| 登录过程中的临时信息 | HttpOnly cookie  | state、nonce、PKCE 和登录后要回去的页面                         | 10 分钟，回调用完就清掉                     |
| 孩子的登录状态       | HttpOnly cookie  | 本站签发的 JWT，只有孩子编号和身份种类 `child`                  | 7 天，常用时续期                            |
| 记住的设备           | HttpOnly cookie  | 这台浏览器的设备令牌（32 字节随机数），这台浏览器记住的孩子共用 | 30 天，每次点头像登录时续期；孩子退出时留着 |
| 当前家庭             | 浏览器的本地存储 | 家庭编号，不是个人信息                                          | 一直保留，切换家庭时更新                    |

- 这些 cookie 页面上的脚本都读不到。家长退出时清掉家长的三个 cookie；孩子退出只清掉孩子的登录状态。

Last changed: #8 (2026-11-22)
