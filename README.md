# QCode 私有 AI 编码平台 · 0.3.0

员工电脑运行 DeepSeek Harness，企业网关统一管理账号、模型凭据、部门、配额、共享 Skill 和用量。真实模型 Key 在服务器加密保存；员工端通过本地转发桥接续期会话，不把供应商 Key 写入 Harness。

当前定位：可进行团队试用的单实例版本。已完成本地自动化与模拟模型验证；真实供应商、企业网络、Docker 和员工电脑需要统一验收，不能以模拟模型测试代替生产验收。

## 快速体验

安装 Node.js 24，在仓库根目录运行：

```powershell
cd apps/server
npm ci
cd ../..
./Start-QCode.ps1 demo
```

打开 http://127.0.0.1:3310，演示凭据保存在本机 `apps/server/.demo-access.txt`。模拟模型不需要真实 Key。演示数据与原网关配置隔离。

## 已实现

- 用户创建、批量导入、编辑、启停、改密、删除、会话撤销和并发限制。
- 管理员、运营、审计、员工角色；部门模型和 Key 分配；个人及部门配额。
- Key 加密、导入、检查、替换与回收；多模型和 OpenAI Compatible 请求转发。
- 流式输出、用量结算、每日统计、排行、分币种成本、CSV 导出和管理审计。
- Windows `qcode web/tui/login/logout/switch/doctor/update/rollback`；加密保存登录、自动续期、独立配置和工作目录。
- 共享 Skill 按部门分发；客户端版本检查、更新和回滚。
- Windows 安装脚本和 EXE 构建；固定版本运行环境与依赖；SQLite、加密备份恢复、Docker/HTTPS 配置。

## 文档与发布

- [服务器运行说明](apps/server/README.md)
- [交付边界、部署及统一验收清单](docs/product-handoff.md)
- [客户端源码与安装脚本](apps/client)

运行 `node apps/server/scripts/package-client.js` 构建 ZIP，再在 Windows 运行 `./scripts/build-installer.ps1` 构建 EXE。产物在 `apps/server/releases/`，不纳入源码 Git；网关提供下载接口。EXE 默认未签名，签名需提供企业证书。

```powershell
./Start-QCode.ps1 test
./Start-QCode.ps1 check
```

真实 `.env`、数据库、日志、备份、登录凭据和生成的安装包均不提交。原有验证脚本保留在仓库，当前入口为 `Start-QCode.ps1`。
