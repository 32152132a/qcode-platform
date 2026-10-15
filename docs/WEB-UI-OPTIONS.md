# 员工 Web 界面选型

当前使用本地嵌入的 OpenCode 官方 Web（1.19.0-qcode.1），不是管理后台登录页，也不是终端模拟页面。

优先候选 OpenChamber：https://github.com/openchamber/openchamber 。它提供完整的 Web/桌面工作台、项目与会话管理、代码差异和终端等界面，MIT 许可。它是独立前端和配套服务，不是换主题的小插件。当前 main 的 Web 包为 2.3.2，依赖 @opencode/client / @opencode/schema 2.0.28，Node >=24.14.0；现有私有 Node 24.19.0 满足 Node 要求，但现有 1.19 内核的 API 兼容性尚未验证。需固定并验证兼容版本，或单独评估内核升级。

另一个轻量候选：https://github.com/jdormit/opencode-web ，侧重移动端，使用 TanStack Start。尚未进行 QCode API、身份与模型选择兼容测试。

若接入，保留现有账号、网关、Key、额度、审计和安装发布流程，只替换员工 Web 层；TUI 保留。先验证 Windows 离线安装、连到私有 OpenCode 进程、复用 QCode 登录、仅显示后台共享模型、空模型状态、会话和项目隔离，再做品牌替换。禁用/隐藏让员工自行连接模型服务的入口，不要求员工填写真实 Key。额外 UI 服务及前端资产需要纳入安装包和更新生命周期，不能声称原安装包字节完全不变。

本次仅完成模型规则改造与界面选型，未集成第三方 Web 界面。
