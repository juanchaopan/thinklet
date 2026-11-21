# 数据

PostgreSQL 里的表，用 Drizzle 定义，由迁移脚本建立。时间都存成带时区的时间戳（`timestamptz`），编号都是 UUID。

## parents：家长

| 字段              | 类型              | 说明                                   |
| ----------------- | ----------------- | -------------------------------------- |
| `id`              | uuid，主键        | 本站的家长编号，也是 JWT 里的家长编号  |
| `oidc_issuer`     | text，必填        | Authing 的 issuer                      |
| `oidc_subject`    | text，必填        | Authing 给的 `sub`                     |
| `name`            | text，必填        | 显示的名字，每次登录更新               |
| `email`           | text，可空        | 邮箱，每次登录更新；Authing 没给时为空 |
| `consent_version` | text，必填        | 同意的协议版本                         |
| `consented_at`    | timestamptz，必填 | 同意的时间：第一次登录回到本站的时间   |
| `created_at`      | timestamptz，必填 | 建立的时间                             |
| `updated_at`      | timestamptz，必填 | 最后一次更新名字和邮箱的时间           |

- `(oidc_issuer, oidc_subject)` 唯一。
- 名字和邮箱是家长的个人信息，不写进日志，列进日志的遮挡列表。

## families：家庭

| 字段         | 类型                | 说明                                |
| ------------ | ------------------- | ----------------------------------- |
| `id`         | uuid，主键          | 家庭编号，出现在地址和接口路径里    |
| `name`       | text，必填          | 1–20 个字（按字符数），去掉前后空格 |
| `timezone`   | text，必填          | IANA 时区名                         |
| `code`       | char(6)，必填，唯一 | 家庭码                              |
| `created_at` | timestamptz，必填   |                                     |
| `updated_at` | timestamptz，必填   | 最后一次改名称、时区或家庭码的时间  |

## family_members：家庭里的家长

| 字段        | 类型                            | 说明                   |
| ----------- | ------------------------------- | ---------------------- |
| `family_id` | uuid，必填，引用 `families`     |                        |
| `parent_id` | uuid，必填，引用 `parents`      |                        |
| `role`      | text，必填，`admin` 或 `member` | 管理员或普通家长       |
| `joined_at` | timestamptz，必填               | 加入的时间，用来排顺序 |

- 主键是 `(family_id, parent_id)`。
- 每个家庭最多一个 `admin`：在 `family_id` 上建只包括 `role = 'admin'` 的唯一索引。至少一个由业务保证：创建家庭时同时写入管理员；设为管理员在一个事务里把两人的角色对调；管理员不能离开，也不能被移出。
- 移出和离开就是删掉这一行。

## join_requests：加入申请

| 字段                        | 类型                        | 说明                                                      |
| --------------------------- | --------------------------- | --------------------------------------------------------- |
| `id`                        | uuid，主键                  |                                                           |
| `family_id`                 | uuid，必填，引用 `families` | 申请加入的家庭                                            |
| `parent_id`                 | uuid，必填，引用 `parents`  | 申请人                                                    |
| `code`                      | char(6)，必填               | 申请时用的家庭码                                          |
| `status`                    | text，必填                  | `pending`、`approved`、`rejected`、`withdrawn`、`expired` |
| `created_at`                | timestamptz，必填           | 发出的时间                                                |
| `closed_at`                 | timestamptz，可空           | 同意、拒绝、撤回或作废的时间                              |
| `closed_by`                 | uuid，可空，引用 `parents`  | 同意或拒绝的管理员                                        |
| `dismissed_by_applicant_at` | timestamptz，可空           | 申请人点「知道了」的时间                                  |
| `dismissed_by_admin_at`     | timestamptz，可空           | 管理员点「知道了」的时间                                  |

- 同一位家长对同一个家庭最多一个 `pending`：在 `(family_id, parent_id)` 上建只包括 `status = 'pending'` 的唯一索引。
- 更换家庭码时，在同一个事务里把这个家庭的 `pending` 申请改成 `expired`。
- 记录不删除，「知道了」只填对应的时间。

## 浏览器里存的

- 当前家庭的编号，用来下次进入同一个家庭；不是个人信息。

Last changed: #7 (2026-11-21)
