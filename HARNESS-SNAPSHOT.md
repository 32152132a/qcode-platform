# Harness 保留方案（harness-latest）

保存日期：2026-10-12。本分支是可继续开发的 Harness 方案快照，不代表所有功能已验收。
`latest` 是保存时的 npm 渠道名，不自动跟踪以后发布的版本。

## 版本与仓库

| 内容 | 固定版本/提交 |
| --- | --- |
| TUI 官方 Harness 核心 | `@deepseek-ai/dsh@0.2.0-rc.2`（保存时 npm latest / next） |
| TUI 插件 | `@deepseek-harness-tui/dsh-tui@0.14.0` |
| Web 定制核心 | `0.2.1-alpha.2`，独立仓库 qcode-harness，提交 `1cd93ce384bda131084a067d26c7543cdc22547b` |
| 最近已发布客户端 | QCode `0.4.4`，平台提交 `6bc84249ac77352b1c3bd5f7df60ed871b9a21f7` |
| 私有 Node | `24.19.0`，Windows x64/arm64 哈希见构建脚本 |
| 平台仓库 | https://gitee.com/quyongqing/qcode-platform |
| Web 定制源码 | https://gitee.com/quyongqing/qcode-harness |

保存时的区别：线上 0.4.4 是既有 Web 安装包；本分支另外保存默认 TUI、版本隔离和双运行时打包的未发布改动。不要把本分支源码当作已发布 0.4.4 的原样副本。

## 已有验证证据

- 保存前回归：node apps/server/test/run.js 共 34 项通过；相关 PowerShell 脚本语法检查及 Git diff 空白检查通过。

- 0.4.4：内置 Node 的 Windows 安装、升级、损坏包拒绝及回滚测试在此前发布时通过。
- TUI 0.14.0 + 核心 0.2.0-rc.2：实际 Windows 伪终端启动，使用隔离用户目录和 QCode 登录凭据，经本地桥接与模拟网关收到模型回复；最新一次测试通过（2026-10-12）。
- 模拟测试检查供应商 Key 只在网关转发请求出现，并检查实际发送的后台模型名；不是生产模型效果验收。
- TUI 0.14.0 + 定制核心 0.2.1-alpha.2：被插件版本兼容性检查拒绝，没有修改上游源码或添加版本豁免。

## 仍未完成

- TUI 创建文件、执行命令、恢复会话及真实模型长任务的完整验证。
- 从干净环境按新锁文件构建 TUI 包，以及双运行时 ZIP/EXE 的完整安装、更新、回滚验证。之前的 TUI 构建目录只有中间文件，不能作为成功产物。
- TUI 品牌定制、手机远程接入、定时任务交付、Mac 安装包。
- 员工端多授权模型选择（当前入口是单个“团队模型”）。

## 目录及使用方式

- `apps/server`：账号、Key、模型、配额、统计、审计、后台页面与网关。
- `apps/client`：Windows 命令、登录保存、本地模型桥接、更新、安装。
- `scripts/tui-runtime`：固定 TUI 依赖及 pnpm 锁文件；不自动安装 peer，核心所需 peer 显式列出。
- `scripts/build-tui-bundle.ps1`：独立 TUI 构建；`scripts/build-harness-bundle.ps1`：Web 定制核心构建。
- `scripts/release-client.ps1`：测试、构建、递增版本、生成安装包及上传发布；桌面入口为 `release-client.cmd`。
- 用户数据在 `%LOCALAPPDATA%/QCode/<网关标识>/users/<用户 ID>`；Web 使用 `harness` / `agents`，TUI 使用 `harness-tui` / `agents-tui`，项目目录可以共用。
- 安装完成后 `qcode` / `qcode tui` 进入终端，`qcode web` 或桌面快捷方式打开网页。此行为在本分支待发布安装包中生效；旧安装包行为不自动变化。

## 恢复开发与构建

建议在独立工作目录检出本分支，避免覆盖 OpenCode 开发中的改动：

```powershell
git clone --branch harness-latest https://gitee.com/quyongqing/qcode-platform.git qcode-platform-harness
git clone https://gitee.com/quyongqing/qcode-harness.git qcode-harness
# 在 qcode-harness 目录检出上表固定提交，并按照该仓库 QCODE.md 准备依赖。
```

准备 Node 24 和 pnpm。运行回归检查：

```powershell
node apps/server/test/run.js
```

只构建 TUI 组件（不发布、不改变版本号）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-tui-bundle.ps1 -OutputDirectory artifacts/tui-check
```

完整本地构建：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-client.ps1 -BuildOnly -HarnessRepository ../qcode-harness
```

`-BuildOnly` 不上传，但会递增 `apps/client/release.json`。必须完成上面待验证项后，才运行不带 `-BuildOnly` 的发布流程。SSH Key 在仓库外提供，不把账号密码、模型 Key 或生产环境文件提交到 Git。

## TUI 对话测试的复现条件

`apps/server/test/tui-runtime.test.js` 是单独启用的集成测试，不属于默认回归集合。
它目前依赖本地 `.stage1-dsh` 中的 `node-pty` 和已安装 TUI profile；这些测试依赖未入库，干净克隆不能直接执行。

```powershell
$env:QCODE_TEST_TUI_ENTRY='已安装核心的 lib/bin.js 绝对路径'
$env:QCODE_TEST_TUI_PROFILE='含 package.json 和 node_modules 的 TUI profile 绝对路径'
node --test --test-name-pattern='TUI default' apps/server/test/tui-runtime.test.js
```

不得复制原测试 home 的凭据。测试会自行建立模拟用户、模拟模型服务和隔离配置目录。

## 以后重新采用 Harness

先在本分支更新兼容的核心/TUI 配套版本和依赖锁，按 `docs/tui-upgrades.md` 逐项验证。
将 OpenCode 主线的后台修复按提交选择性同步，保留数据库迁移，不回退生产数据。
再重新构建并发布新的客户端版本；不是只切 Git 分支就能更换已安装客户端。
Harness 与 OpenCode 会话格式不能默认互通，应保留原数据并另行评估迁移。
