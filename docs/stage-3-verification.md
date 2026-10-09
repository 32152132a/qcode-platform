# Stage 3 验证记录

> 以下为早期验证版的历史记录，不代表当前功能状态。0.3 试用版能力、迁移说明和未完成事项见 [交接清单](product-handoff.md) 与 [网关说明](../apps/server/README.md)。

## 已完成

- Express 模型网关位于 `apps/server`。
- `GET /health` 可用。
- `GET /v1/models` 要求企业 Token。
- `POST /v1/chat/completions` 转发 JSON、流式响应、tools 和 tool_choice。
- 上游模型名由服务端映射，客户端只看到 `qcode-model`。
- 上游错误不会把 Provider Key 或内部响应原文返回给客户端。
- 请求超时、无效 JSON、无效模型和无效 Token 有统一错误结构。
- 本地模拟上游测试 3/3 通过。
- 使用真实 DeepSeek 请求验证返回 `GATEWAY_OK`，响应统计 60 tokens。

## 本地运行

```powershell
Set-Location apps/server
npm install
npm test
npm start
```

## Harness 连接测试

在仓库根目录运行：

```powershell
.\start-stage3-web.ps1
```

浏览器访问终端输出的、带 `?token=...` 的本地地址。当前配置使用独立测试 Token，Harness 的模型路由是 `qcode/qcode-model`。

## 人工验收

在 Harness 中让它创建并运行一个小程序，并确认返回结果。之后关闭 Gateway，再发起一次请求，预期模型请求失败。

## 当前未实现

- 用户登录和用户 Token。
- 多用户 Key 池。
- 管理后台。
- 配额与数据库 Usage。
- Windows QCode 安装包。
