# 数据

PostgreSQL 里的表，用 Drizzle 定义，由迁移脚本建立；Redis 里放到期就该消失的短时数据。时间都存成带时区的时间戳（`timestamptz`）。家长、家庭这些由本站建立的记录，编号都是 UUID，由数据库生成；孩子和记住的设备的编号由后端生成，因为加密时要用到（见“孩子个人信息的密文”）；年级、学科和书本的编号由平台团队在迁移脚本里写定。

表里只记数据现在的样子，不记是谁做的；谁在什么时候做了什么，记在审计表 `audit_events` 里。

## 长度

- “字”按看到的一个字符算，见 `rules.md` 的“家长账号”。
- 名字、家庭名称和孩子的昵称另有字节上限：UTF-8 的字节数不超过字数上限的 16 倍，名字和家庭名称 320 字节，昵称 160 字节。接口检查，数据库也用 `octet_length` 约束检查；超过时的提示和字数超过时一样。
- 孩子的密码最多 32 个字符，也不超过 128 字节。

## parents：家长

| 字段              | 类型              | 说明                                                                   |
| ----------------- | ----------------- | ---------------------------------------------------------------------- |
| `id`              | uuid，主键        | 本站的家长编号，也是 JWT 里的家长编号                                  |
| `oidc_issuer`     | text，必填        | Authing 的 issuer                                                      |
| `oidc_subject`    | text，必填        | Authing 给的 `sub`，也是调 Authing 管理 API 删除用户时的用户编号       |
| `name`            | text，必填        | 显示的名字，1–20 个字；建立记录时从 Authing 取，之后家长在个人设置里改 |
| `email`           | text，可空        | 邮箱，每次登录从 Authing 更新；Authing 没给时为空                      |
| `consent_version` | text，必填        | 最近一次登录时同意的协议版本                                           |
| `consented_at`    | timestamptz，必填 | 最近一次登录回到本站、同意协议的时间，也就是最后一次登录的时间         |
| `created_at`      | timestamptz，必填 | 建立的时间                                                             |
| `updated_at`      | timestamptz，必填 | 最后一次修改这一行的时间                                               |

- `(oidc_issuer, oidc_subject)` 唯一。
- 名字和邮箱是家长的个人信息，不写进日志，列进日志的遮挡列表。
- 删除家长就是删掉这一行，他在 `family_members` 和 `join_requests` 里的行跟着删掉；只有他不是任何家庭的管理员时才能删（见 `rules.md` 的“删除账号”）。

## families：家庭

| 字段         | 类型              | 说明                                    |
| ------------ | ----------------- | --------------------------------------- |
| `id`         | uuid，主键        | 家庭编号，出现在地址和接口路径里        |
| `name`       | text，必填        | 1–20 个字（按字符数），去掉前后空格     |
| `timezone`   | text，必填        | IANA 时区的标准名，别名先换成标准名再存 |
| `code`       | text，必填，唯一  | 家庭码，正好 6 个字符（数据库约束检查） |
| `created_at` | timestamptz，必填 |                                         |
| `updated_at` | timestamptz，必填 | 最后一次改名称、时区或家庭码的时间      |

- 家庭码拿到就能申请加入这个家庭，不写进日志：查家庭码的请求地址在日志里写成 `/api/family-codes/[redacted]`。
- 家庭名称是家长起的，可能带着家里人的名字，不写进日志，列进日志的遮挡列表。
- 删除家庭就是删掉这一行，`family_members`、`join_requests`、`children`（连同孩子的设备和分派的书）和 `family_books` 里这个家庭的行跟着删掉，Redis 里这个家庭的孩子的登录链接也删掉。

## family_members：家庭里的家长

| 字段        | 类型                                      | 说明                   |
| ----------- | ----------------------------------------- | ---------------------- |
| `family_id` | uuid，必填，引用 `families`，跟着家庭删除 |                        |
| `parent_id` | uuid，必填，引用 `parents`，跟着家长删除  |                        |
| `role`      | text，必填，`admin` 或 `member`           | 管理员或普通家长       |
| `joined_at` | timestamptz，必填                         | 加入的时间，用来排顺序 |

- 主键是 `(family_id, parent_id)`；另在 `parent_id` 上建索引，查一位家长的全部家庭时用。
- 每个家庭最多一个 `admin`：在 `family_id` 上建只包括 `role = 'admin'` 的唯一索引。至少一个由业务保证：创建家庭时同时写入管理员；设为管理员在一个事务里把两人的角色对调；管理员不能离开，也不能被移出，是任何家庭的管理员时也不能删除自己的账号；在 Authing 控制台里删掉的管理员，由同一个事务把管理员交给其余家长里 `joined_at` 最早的一位。
- 移出和离开就是删掉这一行，不另留记录。

## join_requests：加入申请

| 字段                        | 类型                                      | 说明                                                      |
| --------------------------- | ----------------------------------------- | --------------------------------------------------------- |
| `id`                        | uuid，主键                                |                                                           |
| `family_id`                 | uuid，必填，引用 `families`，跟着家庭删除 | 申请加入的家庭                                            |
| `parent_id`                 | uuid，必填，引用 `parents`，跟着家长删除  | 申请人                                                    |
| `code`                      | text，必填                                | 申请时用的家庭码，正好 6 个字符（数据库约束检查）         |
| `status`                    | text，必填                                | `pending`、`approved`、`rejected`、`withdrawn`、`expired` |
| `created_at`                | timestamptz，必填                         | 发出的时间                                                |
| `closed_at`                 | timestamptz，可空                         | 同意、拒绝、撤回或作废的时间                              |
| `dismissed_by_applicant_at` | timestamptz，可空                         | 申请人点「知道了」的时间                                  |

- 同一位家长对同一个家庭最多一个 `pending`：在 `(family_id, parent_id)` 上建只包括 `status = 'pending'` 的唯一索引。
- 更换家庭码时，在同一个事务里把这个家庭的 `pending` 申请改成 `expired`。
- 「知道了」只填对应的时间。管理员这边只显示等待中的申请，没有「知道了」。申请跟着家庭或申请人一起删掉，其余时候不删。

## children：孩子

| 字段                   | 类型                                      | 说明                                                                                                                                                                                                 |
| ---------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | uuid，主键                                | 孩子编号，也是孩子 JWT 里的编号；由后端生成                                                                                                                                                          |
| `family_id`            | uuid，必填，引用 `families`，跟着家庭删除 | 孩子属于的家庭                                                                                                                                                                                       |
| `nickname`             | text，必填                                | 昵称的密文；明文去掉前后空格后 1–10 个字，不超过 160 字节                                                                                                                                            |
| `account`              | text，必填                                | 账号的密文；明文是 1–20 个小写字母和数字                                                                                                                                                             |
| `account_lookup`       | text，必填                                | 账号的查找值：家庭编号加账号的 HMAC-SHA256，写成十六进制                                                                                                                                             |
| `password_hash`        | text，可空                                | argon2id 的散列字符串，带着参数；为空表示还没设密码                                                                                                                                                  |
| `password_setup_until` | timestamptz，可空                         | 还没设密码时，用家庭码和账号登录能设密码的期限：添加孩子和重设密码时写入当时的时间加 48 小时，设了密码后清空；迁移前就已经添加、还没设密码的孩子为空，只能扫码设或者等家长重设。扫码登录设密码不看它 |
| `sessions_valid_after` | timestamptz，必填                         | 在这之前签发的孩子 JWT 一律不认，按整秒比较；添加孩子时写入当时的时间，重设密码时写入当时的时间进到下一个整秒，所以同一秒里早一点签发的也不认                                                        |
| `created_at`           | timestamptz，必填                         | 添加的时间，用来排顺序                                                                                                                                                                               |
| `updated_at`           | timestamptz，必填                         | 最后一次修改这一行的时间                                                                                                                                                                             |

- `(family_id, account_lookup)` 唯一，保证账号在家庭内唯一；登录时也按它查找。
- `(id, family_id)` 唯一，给 `book_assignments` 引用，保证书只分派给本家庭的孩子。
- 昵称、账号和设备名称是孩子的个人信息：加密保存，不写进日志，列进日志的遮挡列表。密码不写进日志，也不存明文。
- `sessions_valid_after`、`password_setup_until` 和孩子 JWT 的签发时间都取数据库的当前时间，不取后端实例的时钟。
- 重设密码：在一个事务里清空 `password_hash`、写入 `password_setup_until` 和 `sessions_valid_after`、删掉这个孩子的全部 `child_devices`。
- 监护人同意记在审计表里（动作 `child.created`，细节带同意文字的版本），不随孩子删除。
- 删除孩子就是删掉这一行，记住的设备和分派给他的书跟着删掉，Redis 里他的登录链接也删掉。

## child_devices：记住的设备

| 字段            | 类型                                      | 说明                                         |
| --------------- | ----------------------------------------- | -------------------------------------------- |
| `id`            | uuid，主键                                | 家长撤销一台设备时用；由后端生成             |
| `child_id`      | uuid，必填，引用 `children`，跟着孩子删除 |                                              |
| `token_hash`    | text，必填                                | 这台浏览器的设备令牌的 SHA-256，写成十六进制 |
| `name`          | text，必填                                | 设备名称的密文，记住时从浏览器得出           |
| `remembered_at` | timestamptz，必填                         | 记住的时间                                   |
| `last_used_at`  | timestamptz，必填                         | 最近一次登录的时间                           |
| `expires_at`    | timestamptz，必填                         | `last_used_at` 加 30 天                      |

- `(child_id, token_hash)` 唯一：一台浏览器记住几个孩子时共用一个设备令牌，每个孩子一行。
- 孩子用密码或扫码登录并记住这台设备时，每次都签发新的设备令牌：浏览器旧令牌下、同一个家庭的孩子还没过期的行，在同一个事务里换成新令牌的散列；别的家庭的行不动，它们的令牌已经不在这台浏览器里，到期后当过期设备删掉。点头像登录不换令牌。
- 撤销一台设备就删掉这一行；全部撤销和重设密码删掉这个孩子的全部行。
- 不勾「在这台设备上记住我」登录时，删掉这台浏览器上这个孩子的那一行。
- 孩子每次登录时，在同一个事务里删掉这个孩子已经过期的行。

## 孩子个人信息的密文

- 昵称、账号和设备名称用 AES-256-GCM 加密，每次随机的初始向量；密文带密钥编号。
- 附加认证数据（AAD）是密钥编号、表名、列名和这一行的主键，比如 `children.nickname` 加孩子编号、`child_devices.name` 加设备编号。密文换到别的行或别的列就解不开，解不开时当作程序出错。
- 已有的密文由代码写的数据迁移 `0001-bind-child-ciphertexts` 全部重新加密，之后只认带位置的格式。

## grades：年级

| 字段       | 类型                | 说明                                                                                                                          |
| ---------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `id`       | text，主键          | 年级编号，小写字母、数字和连字符，1–30 个字符，比如 `preschool`、`grade-1`                                                    |
| `name`     | text，必填          | 显示的名字，1–10 个字，比如“一年级”                                                                                           |
| `level`    | integer，必填，唯一 | 年级的级别数字：学前是 0，一年级是 1，六年级是 6，初一是 7，高三是 12。年级的高低按它比；以后按它给不同年龄的孩子换老师和教法 |
| `position` | integer，必填，唯一 | 显示的顺序，小的在前                                                                                                          |

- `(id, level)` 唯一，给书本表连同级别一起引用。

## subjects：学科

| 字段       | 类型                | 说明                                                       |
| ---------- | ------------------- | ---------------------------------------------------------- |
| `id`       | text，主键          | 学科编号，小写字母、数字和连字符，1–30 个字符，比如 `math` |
| `name`     | text，必填          | 显示的名字，1–10 个字，比如“数学”                          |
| `position` | integer，必填，唯一 | 显示的顺序，小的在前                                       |

## books：书本

| 字段                   | 类型                        | 说明                                                                                          |
| ---------------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| `id`                   | text，主键                  | 书本编号，小写字母、数字和连字符，1–60 个字符；也是仓库里封面的文件夹名 `content/books/<id>/` |
| `title`                | text，必填                  | 书名，1–30 个字                                                                               |
| `intro`                | text，必填                  | 简介，1–200 个字，只是文字，可以换行                                                          |
| `min_grade_id`         | text，必填                  | 适用的最低年级                                                                                |
| `min_grade_level`      | integer，必填               | 最低年级的级别数字；和 `min_grade_id` 一起引用 `grades (id, level)`                           |
| `max_grade_id`         | text，必填                  | 适用的最高年级；只适用一个年级的书和最低年级相同                                              |
| `max_grade_level`      | integer，必填               | 最高年级的级别数字；和 `max_grade_id` 一起引用 `grades (id, level)`                           |
| `teaching_grade_id`    | text，必填                  | 教学年级，讲题和练习按它选用教法；家长和孩子的接口都不返回                                    |
| `teaching_grade_level` | integer，必填               | 教学年级的级别数字；和 `teaching_grade_id` 一起引用 `grades (id, level)`                      |
| `subject_id`           | text，必填，引用 `subjects` |                                                                                               |
| `status`               | text，必填                  | `active`（上架）或 `inactive`（下架）                                                         |
| `replacement_id`       | text，可空，引用 `books`    | 下架后替代它的书；不能是它自己                                                                |
| `cover_type`           | text，可空                  | 封面的格式，`webp` 或 `png`；封面导入写入                                                     |
| `cover_sha256`         | text，可空                  | 封面的 SHA-256，写成十六进制；封面导入写入，取封面的地址带着它                                |
| `created_at`           | timestamptz，必填           | 加进书本表的时间，书库按它从新到旧排，相同时按 `id` 排                                        |
| `updated_at`           | timestamptz，必填           | 最后一次修改这一行的时间                                                                      |

- 编号、长度和取值都有数据库约束检查，写错的迁移脚本执行失败。长度在数据库里按 `char_length` 检查。
- 三个年级都只存年级表的编号和级别，不存年级的名字。编号和级别一起引用年级表，年级的级别改了，书本表里的跟着改（`on update cascade`），所以级别总和年级表一致。
- 数据库约束检查 `min_grade_level <= max_grade_level`，以及 `teaching_grade_level` 在 `min_grade_level` 和 `max_grade_level` 之间（两头都算）：最低年级高于最高年级、教学年级不在范围里的书写不进去，写它的迁移脚本执行失败，数据库不变。
- `cover_type` 和 `cover_sha256` 同时为空或同时有值；为空时书库和书本页用默认封面。
- 加书、改书、下架、删书都写成迁移脚本；有家庭获取过的书，`family_books` 的外键不让删。
- 封面在对象存储里的位置是 `books/<id>/cover.<cover_type>`。封面导入换了格式时，记下新的散列后删掉另一种格式的文件。

## family_books：家里获取的书

| 字段          | 类型                                         | 说明       |
| ------------- | -------------------------------------------- | ---------- |
| `family_id`   | uuid，必填，引用 `families`，跟着家庭删除    |            |
| `book_id`     | text，必填，引用 `books`，有记录时书不能删除 |            |
| `acquired_at` | timestamptz，必填                            | 获取的时间 |

- 主键是 `(family_id, book_id)`：一个家庭一本书只获取一次，再获取不报错。
- 移除就是删掉这一行；这本书还有孩子在读时不能删（`book_assignments` 的外键）。

## book_assignments：分派给孩子的书

| 字段          | 类型              | 说明                                       |
| ------------- | ----------------- | ------------------------------------------ |
| `child_id`    | uuid，必填        |                                            |
| `family_id`   | uuid，必填        | 孩子的家庭                                 |
| `book_id`     | text，必填        |                                            |
| `assigned_at` | timestamptz，必填 | 分派的时间，孩子首页按它从新到旧排         |
| `opened_at`   | timestamptz，可空 | 孩子第一次打开这本书的时间；为空是“新”的书 |

- 主键是 `(child_id, book_id)`。
- `(child_id, family_id)` 引用 `children (id, family_id)`，跟着孩子删除：书只能分派给本家庭的孩子。
- `(family_id, book_id)` 引用 `family_books`，有记录时那一行不能删：只能分派家里获取了的书，有孩子在读时不能移除。删除家庭时，孩子和他们的分派先跟着删掉。
- 撤回就是删掉这一行；再分派是新的一行，`opened_at` 为空，又算新的书。
- 只能把上架的书分派给新的孩子，由业务检查。

## audit_events：审计记录

| 字段            | 类型                   | 说明                                                                                   |
| --------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| `id`            | uuid，主键             |                                                                                        |
| `occurred_at`   | timestamptz，必填      | 发生的时间，取数据库的当前时间                                                         |
| `actor_kind`    | text，必填             | 做事的是谁：`parent`（家长）、`child`（孩子）或 `system`（本站自己，比如 webhook）     |
| `actor_id`      | uuid，可空             | 家长或孩子的编号；`system` 时为空                                                      |
| `actor_issuer`  | text，可空             | 家长的 Authing issuer，只有家长有                                                      |
| `actor_subject` | text，可空             | 家长的 Authing `sub`，只有家长有                                                       |
| `action`        | text，必填             | 动作，见下表                                                                           |
| `target_kind`   | text，必填             | 对象的种类：`parent`、`family`、`member`、`join_request`、`child`、`device`、`book` 等 |
| `target_id`     | text，必填             | 对象的编号；书本是书本编号，家庭成员是家长编号                                         |
| `family_id`     | uuid，可空             | 动作所在的家庭；和家庭无关的动作为空                                                   |
| `details`       | jsonb，必填，默认 `{}` | 动作本身的少量细节，只放编号、版本和取值的种类，不放个人信息                           |

- 不引用任何表：家长、家庭、孩子删掉后，这里的编号对不上任何东西，记录照样留着。只增不改不删。
- 和业务数据写在同一个事务里，一起提交或一起回滚。
- 不存名字、邮箱、家庭名称、孩子的昵称和账号、设备名称这些内容；改了什么只记改了哪一项，不记改成了什么。
- 在 `(family_id, occurred_at)` 和 `(target_kind, target_id)` 上建索引。

| 动作                       | 谁              | 对象         | 细节                                    |
| -------------------------- | --------------- | ------------ | --------------------------------------- |
| `parent.created`           | 家长            | 家长         | —                                       |
| `parent.renamed`           | 家长            | 家长         | —                                       |
| `parent.deleted`           | 家长或 `system` | 家长         | `via`：`self` 或 `webhook`              |
| `family.created`           | 家长            | 家庭         | —                                       |
| `family.updated`           | 家长            | 家庭         | `fields`：`["name"]`、`["timezone"]`    |
| `family.code_changed`      | 家长            | 家庭         | —                                       |
| `family.deleted`           | 家长或 `system` | 家庭         | `children`、`members`：删掉的数量       |
| `member.admin_transferred` | 家长或 `system` | 新管理员     | `from`：原管理员的家长编号              |
| `member.removed`           | 家长            | 被移出的家长 | —                                       |
| `member.left`              | 家长            | 自己         | —                                       |
| `join_request.created`     | 家长            | 申请         | —                                       |
| `join_request.withdrawn`   | 家长            | 申请         | —                                       |
| `join_request.dismissed`   | 家长            | 申请         | —                                       |
| `join_request.approved`    | 家长            | 申请         | `parentId`：申请人                      |
| `join_request.rejected`    | 家长            | 申请         | `parentId`：申请人                      |
| `child.created`            | 家长            | 孩子         | `consentVersion`：同意文字的版本        |
| `child.updated`            | 家长或孩子      | 孩子         | `fields`：`["nickname"]`、`["account"]` |
| `child.deleted`            | 家长            | 孩子         | —                                       |
| `child.password_reset`     | 家长            | 孩子         | —                                       |
| `child.password_set`       | 孩子            | 孩子         | `via`：`account` 或 `qr`                |
| `child.login_link_created` | 家长            | 孩子         | —                                       |
| `child.devices_revoked`    | 家长            | 孩子         | `deviceId`：撤销一台时带                |
| `book.acquired`            | 家长            | 书本         | —                                       |
| `book.removed`             | 家长            | 书本         | —                                       |
| `book.readers_changed`     | 家长            | 书本         | `added`、`removed`：孩子编号            |

- 登录、退出、点头像续期、记住或去掉一台设备、孩子打开一本书这些随登录发生的变化，以及只读的操作，都不记。
- 已有的「是谁做的」由迁移脚本写进这张表：`children` 的监护人同意写成 `child.created`，`join_requests.closed_by` 写成 `join_request.approved` 或 `join_request.rejected`，`family_books.acquired_by` 写成 `book.acquired`，`book_assignments.assigned_by` 写成 `book.readers_changed`；时间用原来那一行的时间。

## data_migrations：执行过的代码写的数据迁移

| 字段       | 类型              | 说明                                                                                              |
| ---------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `name`     | text，主键        | 迁移的名字，和 `apps/api/src/data-migrations/` 里的文件名一样，比如 `0001-bind-child-ciphertexts` |
| `ran_at`   | timestamptz，必填 | 执行完的时间                                                                                      |
| `checksum` | text，必填        | 执行时迁移源文件（`.ts`）的 SHA-256，换行统一成 LF 再算                                           |

- 每个迁移在一个事务里执行，执行完在同一个事务里写一行；有这一行的不再执行。执行前先核对：执行过的迁移文件改过（散列对不上）、执行过的文件不见了、新加的迁移排在执行过的前面，都报错停下，一个也不执行。

## Redis 里的

都带过期时间，到期自动消失，不迁移；不放个人信息的明文。

| 键                               | 值                                         | 多久                        | 用途                                                                                                |
| -------------------------------- | ------------------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------- |
| `login-link:<令牌的 SHA-256>`    | `{ "linkId", "childId" }`                  | 10 分钟                     | 扫码登录链接；登录成功时用一条原子命令取出并删掉                                                    |
| `login-link-status:<链接编号>`   | `{ "childId", "status", "expiresAt" }`     | 到链接过期                  | 家长查链接状态：`active`、`used`、`revoked`；键不在了就是 `expired`                                 |
| `child-login-link:<孩子编号>`    | `{ "linkId", "tokenHash" }`                | 10 分钟                     | 这个孩子现在的链接，生成新链接时用它把旧的标成 `revoked` 并删掉旧的令牌键；删除孩子时用它找到令牌键 |
| `rate:child-login:<来源>:<孩子>` | 这个窗口里的失败次数，加上正在进行的检查   | 15 分钟（从第一次尝试算起） | 同一个来源对同一个孩子的登录失败                                                                    |
| `rate:child-login:<来源>`        | 这个窗口里的失败次数，加上正在进行的检查   | 15 分钟                     | 同一个来源的孩子登录失败合计                                                                        |
| `rate:family-code:<来源>`        | 这个窗口里查不到的次数，加上正在进行的检查 | 1 小时                      | 同一个来源查家庭码查不到的次数                                                                      |

- `<来源>` 是来源 IP 的 HMAC-SHA256，写成十六进制，不存 IP 原文。`<孩子>` 是孩子编号；家庭码和账号对不上任何孩子时，用输入的家庭码和账号的 HMAC-SHA256 代替。
- 删除孩子和删除家庭时，删掉这些孩子的 `child-login-link`、它指向的 `login-link` 和 `login-link-status`。Redis 连不上时，删除孩子和删除家庭照常完成，记下错误日志；留下的键用不了（每次使用都先查数据库里的孩子），10 分钟内自己过期。

## 浏览器里存的

| 存什么               | 名字                       | 放在哪里         | 内容                                                            | 多久                                        |
| -------------------- | -------------------------- | ---------------- | --------------------------------------------------------------- | ------------------------------------------- |
| 家长的登录状态       | `thinklet_session`         | HttpOnly cookie  | 本站签发的 JWT，只有家长编号和身份种类 `parent`                 | 7 天，常用时续期                            |
| Authing 的 ID 令牌   | `thinklet_id_token`        | HttpOnly cookie  | 家长在 Authing 的编号、名字和邮箱，退出时用                     | 跟着家长的登录状态                          |
| 登录过程中的临时信息 | `thinklet_login`           | HttpOnly cookie  | state、nonce、PKCE 和登录后要回去的页面                         | 10 分钟，回调用完就清掉                     |
| 孩子的登录状态       | `thinklet_child_session`   | HttpOnly cookie  | 本站签发的 JWT，只有孩子编号和身份种类 `child`                  | 7 天，常用时续期                            |
| 记住的设备           | `thinklet_device`          | HttpOnly cookie  | 这台浏览器的设备令牌（32 字节随机数），这台浏览器记住的孩子共用 | 30 天，每次点头像登录时续期；孩子退出时留着 |
| 当前家庭             | `thinklet.currentFamilyId` | 浏览器的本地存储 | 家庭编号，不是个人信息                                          | 一直保留，切换家庭时更新                    |
| 封面图               | —                          | 浏览器的缓存     | 取封面的响应，地址带封面的散列                                  | 长期，封面换了地址就变                      |

- 这些 cookie 页面上的脚本都读不到。家长退出时清掉家长的三个 cookie；家长删除账号时也清掉这三个；孩子退出只清掉孩子的登录状态。
- 书库的筛选记在页面地址里，不存在浏览器里。

## 示例数据

- 一个迁移脚本写入 13 个年级（学前、一年级到六年级、初一到初三、高一到高三）、5 个学科（语文、数学、英语、科学、编程）和 31 本示例书：30 本上架，分布在学前到初三；1 本下架，带替代的书。高中没有示例书。
- 每本示例书只适用一个年级，最低年级、最高年级和教学年级都是这个年级。
- 示例书的封面是一张纯色的 600×800 PNG，放在 `content/books/<id>/cover.png`。
- 测试和设计图里的示例孩子是小米、豆豆、阿乐。

Last changed: #21 (2026-11-25)
