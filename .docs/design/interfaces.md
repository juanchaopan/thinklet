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

### 后端

`/api/*` 的每个响应：

| 响应头                         | 值                                           |
| ------------------------------ | -------------------------------------------- |
| `Content-Security-Policy`      | `default-src 'none'; frame-ancestors 'none'` |
| `X-Content-Type-Options`       | `nosniff`                                    |
| `Cross-Origin-Opener-Policy`   | `same-origin`                                |
| `Cross-Origin-Resource-Policy` | `same-origin`                                |
| `Permissions-Policy`           | 和前端一样                                   |

- 后端只返回 JSON，不加载任何资源，CSP 什么都不允许。
- 经过前端转发的 `/api/*` 响应带后端自己的这一份，不带前端的。

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

Last changed: #2 (2026-11-20)
