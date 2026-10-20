# QCode 团队 AI 工作平台

当前主线是 **QCode 管理网关 + QCode Desktop**。管理员统一管理账号、模型、Key、配额、共享 Skill 和知识库；员工安装桌面客户端后登录使用。供应商 Key 只在网关加密保存。

## 仓库职责

| 仓库 | 内容 | 如何发布 |
| --- | --- | --- |
| qcode-platform（本仓库） | Vue 3 管理端、Node.js 网关、SQLite、模型代理与下载服务 | 通过 deploy-qyq 的既有部署流程更新服务器 |
| qcode-openwork | Electron 桌面客户端、OpenCode 本机引擎、终端入口、安装与更新 | 在该仓库运行 release-desktop.bat |
| qcode-opencode | 早期 OpenCode 定制源码，保留备用 | 当前桌面打包不自动编译此仓库 |
| qcode-harness | 早期 Harness 方案，保留备用 | 非当前员工安装入口 |
| deploy-qyq | Docker、Nginx 和部署脚本 | 管理端/网关部署入口 |

## 两种发布不要混用

- **更新管理端或网关**：提交并推送本仓库，再执行现有服务器部署脚本。不需要重新打包员工客户端。
- **更新桌面或终端**：在 qcode-openwork 双击 release-desktop.bat，构建、验收后上传安装包；仅构建使用 -BuildOnly。
- 当前桌面更新地址为 /downloads/desktop/latest.yml；首页安装包入口为 /downloads/installer。
- apps/client、scripts/release-client.ps1 和 /downloads/manifest.json 属于旧客户端兼容链路，不是当前 Desktop 发布入口。旧发布脚本必须显式提供 -LegacyClient 才会执行。

详见 [当前架构和发布入口](docs/CURRENT-ARCHITECTURE.md)。桌面构建、真实安装和更新仍需员工环境验收，模拟模型通过不等于所有供应商均兼容。

## 本地运行服务端

需要 Node.js 24。进入 apps/admin 执行 npm ci、npm run build；进入 apps/server 执行 npm ci，按其 README 配置私有 .env 后启动。也可使用仓库中的 Docker Compose。

隔离演示与服务端检查仍可运行 Start-QCode.ps1 demo、Start-QCode.ps1 test、Start-QCode.ps1 check；它们不是桌面安装包发布命令。

## 数据与安全边界

SQLite 的 .db/.sqlite 文件是一个数据库，可含多张表。生产数据、.env、模型 Key、会话、备份与安装包不得提交到 Git；数据库和加密主密钥需要分开妥善备份。

这是面向单实例、小团队试用的版本。知识库当前支持 TXT/Markdown，作为参考文档同步并由 AI 按需读取，不是向量数据库 RAG。当前不调整数据库和知识库实现。

- [服务端运行与维护](apps/server/README.md)
- [旧客户端发布说明（仅兼容维护）](docs/CUSTOM-CLIENT.md)


### 业务接口与演示入口

自有业务接口统一使用 POST，查询参数通过 JSON 请求体传递；接口和演示权限由 apps/client/api-contract.mjs 配置数组统一维护。旧业务接口已移除，服务端与员工客户端必须配套升级。模型兼容协议、健康检查、静态资源、安装包和 CSV 下载保留原协议。

演示入口默认关闭。在服务器私有环境配置 DEMO_ENABLED=true 后启用；DEMO_USERNAME 默认 demo，DEMO_PASSWORD 默认 qcode-demo-2026。这是公开的独立演示账号，登录页面可自动填入，不得复用管理员密码。演示账号可查看现有数据，暂不脱敏；修改、模型验证和模型调用由服务端拒绝，不消耗模型额度。关闭入口后，已有演示会话也无法继续访问。
