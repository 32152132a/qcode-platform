# QCode 团队 AI 工作平台

## 项目与作者：QCode 平台集成与定制

曲永庆（quyongqing）基于 OpenCode / OpenWork 开源底座开展 QCode 平台集成与定制开发。本仓库负责 Vue 3 管理端、Node.js 网关、账号权限、模型访问控制、用量配额及共享 Skill 与知识资料分发；Electron 桌面客户端定制与打包位于配套 qcode-openwork 仓库。

作者负责需求梳理、平台功能开发、集成和部署维护。OpenCode / OpenWork 原始能力及上游作者贡献独立归属，保留各项目许可与署名。本项目的知识资料分发不等同于向量数据库 RAG。

曲永庆有 7 年前端开发经验，目前主要从事 AI 应用与 AI Agent 平台开发，具备前端、Node.js 后端和部署交付实践。

- [在线项目](https://code.quyongqing.cn/)
- [作者介绍](https://quyongqing.cn/about.html)
- [组件与项目文档](https://docs.quyongqing.cn/)
- [Gitee 仓库](https://gitee.com/quyongqing/qcode-platform)

当前主线是 **QCode 管理网关 + QCode Desktop**。管理员统一管理账号、模型、Key、配额、共享 Skill 和知识库；员工安装桌面客户端后登录使用。供应商 Key 只在网关加密保存。

管理端“系统设置”中的产品名称最多32个字符，客户端登录后读取并在本次运行期间固定，改名在下次启动时生效。该设置联动应用内名称、窗口标题、托盘和终端文字，不改变 Logo、安装包、快捷方式、账号或工作区数据路径。

## 许可

本仓库自有代码采用 [MIT 许可证](LICENSE)，允许修改、分发和商用，须保留版权及许可声明。第三方代码、依赖和资源继续适用各自原许可；本协议不替代或覆盖它们的授权条款。相关桌面端与内核仓库也应保留 OpenWork、OpenCode 及其他原作者的许可声明。

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
- apps/client 仅保留当前桌面端共享的接口契约、桥接、模型目录及技能同步模块；旧安装器与旧更新链路已删除。

详见 [当前架构和发布入口](docs/CURRENT-ARCHITECTURE.md)。桌面构建、真实安装和更新仍需员工环境验收，模拟模型通过不等于所有供应商均兼容。

## 本地运行服务端

需要 Node.js 24。进入 apps/admin 执行 npm ci、npm run build；进入 apps/server 执行 npm ci，按其 README 配置私有 .env 后启动。也可使用仓库中的 Docker Compose。

服务端检查在 apps/server 运行 npm run check 和 npm test；隔离演示运行 npm run demo。

## 数据与安全边界

SQLite 的 .db/.sqlite 文件是一个数据库，可含多张表。生产数据、.env、模型 Key、会话、备份与安装包不得提交到 Git；数据库和加密主密钥需要分开妥善备份。

这是面向单实例、小团队试用的版本。知识库支持文字型 PDF、DOCX、XLSX、TXT 和 Markdown，采用服务端目录导航与原文按需读取；企业资料发布、个人资料和 Markdown 记忆共用账号权限，详见 [知识库说明](docs/KNOWLEDGE.md)。

现有 v4 数据库升级前必须先备份并离线执行一次迁移；保留业务数据，移除部门关联，详见 [账号管理与数据库升级](docs/ADMIN-ACCOUNTS.md)。新建数据库直接使用 v6；已有 v5 数据库需按 [套餐精简与数据库升级](docs/SIMPLIFY-PLANS.md) 离线迁移。

- [服务端运行与维护](apps/server/README.md)


### 业务接口与演示入口

自有业务接口统一使用 POST，查询参数通过 JSON 请求体传递；接口和演示权限由 apps/client/api-contract.mjs 配置数组统一维护。旧业务接口已移除，服务端与员工客户端必须配套升级。模型兼容协议、健康检查、静态资源、安装包和 CSV 下载保留原协议。

演示入口默认关闭。在服务器私有环境配置 DEMO_ENABLED=true 后启用；DEMO_USERNAME 默认 demo，DEMO_PASSWORD 默认 qcode-demo-2026。这是公开的独立演示账号，登录页面可自动填入，不得复用管理员密码。演示账号可查看现有数据，暂不脱敏；修改、模型验证和模型调用由服务端拒绝，不消耗模型额度。关闭入口后，已有演示会话也无法继续访问。
