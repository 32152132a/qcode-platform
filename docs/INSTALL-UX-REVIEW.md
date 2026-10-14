# Windows 安装与更新体验验收

日期：2026-10-14。仅本地修改、构建和测试，未提交、部署或发布。沿用当前客户端版本 0.4.8，没有递增版本或覆盖正式产物。

## 修改范围

- `scripts/qcode-setup.iss`、`scripts/languages/`：固定简体中文向导与卸载提示，翻译附 MIT 许可；安装过程中展示读取内置包、解压、校验、运行环境、版本切换及完成阶段，底层终端隐藏，详细输出留在日志。语言文件随源码固定，不需要联网下载。
- `scripts/installer-bootstrap.ps1`、`apps/client/install.ps1`：输出可供图形界面解析的阶段事件，保留离线 Node、架构与散列校验、网关优先级和版本指针机制。
- `apps/client/update.mjs`、`qcode.ps1`、`launcher.mjs`、`web-login.mjs`：更新详细输出不再继承用户终端，写入 `logs/update-*.log`；终端和本地网页登录页显示中文阶段信息。更新失败有日志位置，继续使用现有版本；网页登录页保留失败提示 5 秒再进入工作台。下载/安装期间延长启动等待，避免原 90 秒超时打断更新。
- `apps/client/uninstall.*`：原生系统卸载不再显示 PowerShell 窗口或终端菜单；默认删除每个网关的 `session.json` 和 `web-launch.json`，下次必须重新登录，保留配置、历史记录与项目。完整数据清理仍要求确认短语。独立 VBS 入口支持默认卸载后的无终端清理，CMD 仅保留兼容跳转。
- 打包脚本允许 VBS 入包，增加相应更新提示、网页登录、默认 Token 删除及真实 EXE 回归。更新测试加入统一测试入口。

管理后台页面未由本任务修改。工作期间其他任务修改的后台文件和已有改动均保留，未回退或覆盖。

## 测试与正式隔离

测试 AppId：`QCodeTest-d1d73679918b41909743022aa887eaa3`，测试默认目录独立；测试版强制禁用快捷方式和 PATH 修改，正式版行为保留。测试注册项随测试完成移除。

本地测试产物：`artifacts/install-ux-review-20261014`。仅供本地验收，不可发布为正式安装包。真实 EXE 测试夹具：`C:\Users\庆\AppData\Local\Temp\qcode-offline-t4db9U`。

```powershell
$env:QCODE_TEST_RELEASE_DIRECTORY='D:\works\trae\qcode-platform\artifacts\install-ux-review-20261014'
node --test apps/server/test/installer-offline.test.js apps/server/test/installer.test.js apps/server/test/uninstaller.test.js apps/server/test/installer-bootstrap.test.js apps/server/test/update-experience.test.js apps/server/test/web-login.test.js apps/server/test/client.test.js
```

最终 37 项通过，0 失败、0 跳过。覆盖真实 EXE 离线安装和进度事件、旧布局升级、校验失败、更新回滚、网关配置保留、系统卸载失败保护、默认 Token 删除、配置与项目保留、完整清理、中文更新阶段、失败日志、网页登录及更新失败提示。67 个 JavaScript 模块语法检查通过。

进度显示为整体阶段进度，不是下载字节百分比。真实 EXE 自动化使用静默模式，中文向导视觉布局、非静默交互和 ARM64 实机尚待主控人工验收。用户项目、配置和历史数据没有因本地测试被删除；测试使用临时夹具。
