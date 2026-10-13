# OpenCode 接入进度

迁移分支：`opencode-migration`。可恢复的旧方案：`harness-latest`。

## 当前实现

- 官方源码已克隆到相邻的 `qcode-opencode` 目录，固定 v1.19.0，提交 `733b2c627e5aec39cb33cc22373bdce33053ef2c`；目前未修改上游代码。
- 设置 `QCODE_OPENCODE_ENTRY` 指向本机官方可执行程序，再执行 `apps/client/qcode.ps1`，使用原有账号登录并启动 OpenCode TUI。
- 登录 Token 由 QCode 保存和刷新；OpenCode 仅获得本机临时桥接凭据，模型请求继续走服务器鉴权、额度和审计。
- 使用服务器当前分配的单个模型；后台多模型选择尚未接入。
- 每个网关、每个账号有独立 OpenCode 数据、配置、缓存和临时目录；不复用 Harness 会话。
- 共享 Skill 使用现有同步逻辑；禁止项目 OpenCode 配置覆盖托管设置。
- 预览入口暂停自动更新，显式 update/rollback 也会阻止安装旧 Harness 包。

## 尚未完成

- 生产模型验收、TUI 权限确认交互和共享 Skill 行为验证。
- 品牌替换、定制仓库分支维护，以及新安装包中的桌面快捷方式验收。
- OpenCode 安装包和更新发布；安装脚本已增加 OpenCode 分支，定制二进制和完整安装包仍待构建验收，不得发布。
- 真正的多模型选择与供应商协议适配。

官方 Windows 二进制已通过本地模拟模型的对话、TUI 输入输出、文件操作、命令执行、会话继续和用量验证；尚未验证生产模型效果。不要把本分支当作可发布安装包。

## 本轮验证记录

常规回归 35 项通过，PowerShell 语法与 git diff --check 通过。官方 Windows x64 程序包 SHA-512 校验通过，版本命令返回 1.19.0。

真实运行测试已通过，约 7 秒完成。确认服务端使用测试服务的上游凭据并改写模型名称，成功请求数与模拟服务一致，输入 3 / 输出 2 / 总计 5 Token 的用量被正确记录。

### 已解决：非交互测试等待输入结束

此前 60 秒超时且模型请求为 0，根因是测试通过 Node spawn 的默认管道启动 CLI 后，没有关闭标准输入。官方 `packages/opencode/src/cli/cmd/run.ts` 在非 TTY 模式调用 `await Bun.stdin.text()`，必须等到 EOF 才继续处理问题；初始化日志只是最后可见输出，并不表示初始化本身故障。

修复只涉及测试：启动后调用 `child.stdin.end()`。移除排查阶段增加的默认插件禁用和 PURE 开关后仍通过，无需修改 OpenCode 上游源码。另修正测试中文断言的编码，并使用 Unicode 转义防止编码转换再次损坏。

该结论仅覆盖此前非交互测试超时；后续独立 TUI 和工具操作验证结果见下文。

复现：设置 QCODE_TEST_OPENCODE_ENTRY 为官方 exe 路径，使用 Node 24 执行：

```powershell
node --test --test-name-pattern="official OpenCode" apps/server/test/opencode-runtime.test.js
```

该测试只使用本地模拟模型，不使用生产 Key。日志保存在临时目录 qcode-opencode-runtime-*。本轮代码未提交、未发布。

## TUI 和工具验证

- `opencode-tui.test.js`：Windows 伪终端运行 `qcode.ps1`，不传 tui 子命令；从 Windows 加密存储读取测试登录状态，进入输入框，发送问题，显示模拟模型回复。约 17 秒通过；不等同于验证手动输入密码的首次登录流程。
- `opencode-tools.test.js`：真实官方程序执行 write、edit 和 bash 工具，核验磁盘文件从 QCODE_BEFORE 改为 QCODE_AFTER，并确认命令生成 QCODE_EXECUTED 标记；重新启动程序用 --continue 继续，模拟服务确认收到历史工具结果。约 17 秒通过。
- 工具测试核对每个上游请求的鉴权和模型映射，并核对成功请求数、失败数和 Token 总量。
- 工具测试仅在独立临时目录、固定模拟响应下启用测试进程的权限跳过参数；员工启动入口没有放宽权限。真实 TUI 权限提示仍待验证。
- 本轮没有修改 OpenCode 源码，没有发布安装包或提交代码。

运行（Node 24；先设置 QCODE_TEST_OPENCODE_ENTRY）：

```powershell
node --test --test-name-pattern="OpenCode TUI" apps/server/test/opencode-tui.test.js
node --test --test-name-pattern="OpenCode creates" apps/server/test/opencode-tools.test.js
```

TUI 测试沿用本地 `.stage1-dsh` 中的 node-pty；全新开发环境需要先安装该测试依赖。测试日志保留在临时目录 qcode-opencode-tui-* 和 qcode-opencode-tools-*，不会提交到仓库。

## Web 和桌面入口

- 已接入 `qcode web`，新增 `qcodeweb.cmd` 等价入口；安装脚本增加 qcodeweb 命令，桌面图标沿用原先 qcode web 的启动方式。
- OpenCode serve 仅监听 127.0.0.1，使用随机本地密码；QCode 本地入口通过临时启动链接自动建立 HttpOnly、SameSite=Strict 浏览器会话。浏览器不接收员工登录 Token 或供应商 Key。
- 自动进入选定工作目录。`-NoOpen` 可只显示访问链接；自动打开浏览器失败时可复制链接。退出客户端会关闭 Web 入口和运行内核。
- Web 与 TUI 使用相同账号数据目录，验证 Web 新建会话后可在 CLI 中继续。当前仍使用单客户端运行锁，尚不支持同时开启两个 qcode 进程。
- 官方 Web API 和页面资源、模型请求、用量统计、CLI 会话继续已通过真实程序测试；使用隔离的无头 Edge 验证自动登录后渲染对话输入框。
- 真实 qcodeweb 命令（读取 Windows 加密登录状态、启动、NoOpen、访问保护和健康检查）验证通过。
- 本地入口测试覆盖未登录、错误令牌、跨站 Origin、伪造 Host、上游鉴权替换、WebSocket 转发和关闭服务。

复测：设置 QCODE_TEST_OPENCODE_ENTRY；浏览器实测额外设置 QCODE_TEST_BROWSER_ENTRY 为 Edge 路径。

```powershell
node --test apps/server/test/opencode-web.test.js
node --test --test-name-pattern="official Web" apps/server/test/opencode-web-runtime.test.js
node --test --test-name-pattern="qcodeweb command" apps/server/test/opencode-web-command.test.js
```

这里的桌面入口仅完成代码衔接，未在员工电脑安装并点击图标验收；安装器已增加 OpenCode 打包路径，需完成定制内核构建和完整安装验收后再发布。品牌源代码已修改，实际页面效果仍待定制构建验证。以上模型请求仍为本地模拟模型，未使用生产 Key。


## 定制与安装迁移进度（2026-10-12）

- 定制仓库本地 upstream 保存 v1.19.0 原版，master 保存定制；官方 remote 为 upstream，尚未添加自有 Gitee remote。未提交或推送。
- 品牌修改限于 TUI/Web Logo、页签标题和 SVG 图标；保留 LICENSE、内部包名和协议，部分帮助文字尚未替换。
- 让 TUI 手动更新入口遵守 OPENCODE_DISABLE_AUTOUPDATE；原版仅禁止自动检查，手动菜单仍能调用官方升级。员工更新由 QCode 管理，图形界面的 QCode 更新按钮尚未实现。
- build-opencode-bundle.ps1 构建内嵌 Web 的运行内核，生成带 SHA-256 元数据的运行包；构建期间处理 Windows Git 文本软链接，结束恢复。
- 发布脚本改用 OpenCode 单内核，保留私有 Node、ZIP 更新、EXE 安装与原上传流程。安装时校验压缩包及二进制，验证启动版本后才激活。
- 安装后的 qcode 自动选择定制内核；预览模式仍禁止在线更新。正式包拒绝 Harness 更新清单并核对包内运行时标记。
- 首次从老 Harness 迁移需使用新 EXE：旧安装器不支持新的运行包结构。后续版本沿用 QCode 更新命令。

此前构建阻塞（已绕过，见下文）：私有 Bun 1.3.14 使用官方 npm 源，仍在移动 Windows 二进制依赖到缓存时出现 NtSetInformationFile / EPERM；复制后端、单连接也未解决，已停止失败的安装进程。具体文件占用原因未确定，未关闭安全软件或更改系统权限。上游相似报告（不代表本机根因）：https://github.com/oven-sh/bun/issues/22017 。

当时新增更新保护测试通过，尚无新的定制 EXE；后续结果见下文。完整安装/升级和品牌视觉效果仍待验收。不要用旧官方二进制冒充定制构建发布。


## 定制构建通过（2026-10-12）

- 代码快照：平台 ef9173e，定制内核 689c7fc；均为本地提交，未推送或部署。
- 安装范围缩小为 `bun install --frozen-lockfile --registry https://registry.npmjs.org --filter ./packages/opencode --filter ./packages/app`，写入构建脚本。参考：https://bun.sh/docs/pm/filter 。
- 剩余失败项为 @sentry/cli-win32-x64@2.58.6。官方 tgz 的 SHA-512 与 bun.lock 一致，系统 tar 解压和 PowerShell 移动成功。将这份已验证的完整包放入项目私有 Bun 缓存中缺失的对应目录后，安装成功。这是本机构建环境的绕行处理，尚未证明 Bun 底层错误根因；没有修改安全软件、全局权限、依赖锁文件或供应商代码。
- 若新机器复现，不应盲目关闭安全软件或无校验复制缓存。先保存安装日志，再核对官方包与锁文件的完整性。缓存内部路径属于 Bun 实现细节，因此未把手工缓存修复硬编码进发布脚本。
- `build-opencode-bundle.ps1` 完整执行成功，Web 嵌入成功，版本为 1.19.0-qcode.1；运行包约 60 MiB，含 LICENSE 和运行时 SHA-256 元数据。
- 产物：`artifacts/opencode-build-6c335949f6704751b4fe54913eac160b/qcode-opencode-bundle.zip`，未加入 Git。
- 对新编译的定制程序运行 4 项集成测试全部通过：网关对话、默认 qcode TUI、write/edit/bash 与会话继续、Web API/页面及 CLI 会话继续。全部使用本地模拟模型；此次没有开启浏览器视觉检查。
- 上一轮平台 37 项回归已通过。后续仍须构建员工安装 EXE 并验收安装、升级、桌面入口、品牌视觉及真实模型，不把运行内核 ZIP 当成员工安装包。


## Windows 完整安装包 0.4.5（2026-10-12）

本地构建目录：`artifacts/release-20261012-205439-0e912ee1`。EXE 为 `QCodeSetup-0.4.5.exe`，98,435,072 字节（约 94 MiB）；ZIP 为自动更新包，99,892,071 字节。包含定制 OpenCode 1.19.0-qcode.1 和私有 Node 24.19.0，无需员工自行安装 Bun 或下载 Node。

- 首次本地安装不再强制访问 /health；登录和在线更新仍需要网关。安装时需按提示输入网关地址，当前为 `http://code.quyongqing.cn`。
- 37 项平台回归通过。
- `installer-offline.test.js` 从真实 EXE 用 /Q /C 解包，再执行其中的安装脚本；拦截并禁止安装脚本的 Invoke-WebRequest、Invoke-RestMethod，使用不可用的网关地址仍安装成功。校验私有 Node、内核、命令入口、配置和项目保留。没有关闭宿主机网卡或修改防火墙，因此这是安装脚本断网条件验证，不等同于整台虚拟机断网验收。
- 更新包校验失败时保留旧版，正常更新成功，回滚保留用户测试数据，两项安装测试均通过，并纳入发布脚本。
- 设置 QCODE_TEST_INSTALLED_ROOT 指向上述隔离安装结果，不指定 QCODE_NODE 或内核路径；实际 bin/qcode.cmd 的默认 TUI 对话和 bin/qcodeweb.cmd Web 服务两项测试通过（本地模拟网关）。
- 安装测试使用 -NoPath，不改开发电脑的全局/用户 PATH 和桌面；桌面快捷方式人工点击、首次交互登录、生产模型和完整断网虚拟机体验仍待员工验收。
- 本轮未推送、未上传服务器，安装包仅在本地。构建产物不加入 Git。

复测离线安装和更新：设置 QCODE_TEST_RELEASE_DIRECTORY 为构建目录，使用 Node 24 执行：

```powershell
node --test apps/server/test/installer.test.js apps/server/test/installer-offline.test.js
```

复测安装后入口：设置 QCODE_TEST_INSTALLED_ROOT 为测试安装目录（仅使用隔离测试目录），顺序运行以避免客户端锁冲突：

```powershell
node --test --test-concurrency=1 --test-name-pattern="OpenCode TUI|qcodeweb command" apps/server/test/opencode-tui.test.js apps/server/test/opencode-web-command.test.js
```


## 0.4.5 发布实测（2026-10-12）

使用现有发布入口的 `scripts/release-client.ps1 -PublishDirectory artifacts/release-20261012-205439-0e912ee1`，复用已通过验收的产物；实际 SSH/SCP 上传、校验、激活和清理全部成功。没有重启服务或修改服务器项目代码；服务器现有 publish-client.js 与本地 SHA-256 相同。

- 公网 `/downloads/manifest.json` 返回 0.4.5、runtime=opencode。
- `http://code.quyongqing.cn/downloads/installer` 返回 HTTP 200，文件名 QCodeSetup-0.4.5.exe，长度 98,435,072。
- 服务器 EXE 和 ZIP 的 SHA-256 与本地产物及发布清单一致。
- 发布目录仅保留 0.4.5 的 Windows EXE/ZIP、manifest 和 macos 目录；旧 Windows 包已清理。网关保持 healthy。
- 本轮验证的是既有产物的真实上传发布；双击 release-client.cmd 仍执行自动增版、重新构建、测试再上传。此前 Bun 缓存问题属于构建环境说明，不代表任意新机器都能无需准备直接构建。

分支状态：平台本地 master、harness-latest 和 opencode-migration 均保留，Gitee 已核对存在 master 与 harness-latest，opencode-migration 尚未推送。定制内核本地 upstream 为官方 v1.19.0，master 为 QCode 定制；尚未配置自有 Gitee remote，等待仓库地址后再备份。不要向名为 upstream 的官方远程推送定制代码。

升级流程：先备份当前可用版本，获取官方新版本并更新官方基线分支，再合入定制分支，处理品牌/更新入口冲突，运行平台回归、真实内核 TUI/Web/工具测试、安装与更新回滚测试，通过后生成并发布新版本。当前改动集中，品牌合并成本较低；配置、协议或启动方式发生变化仍可能需要适配，不能承诺每次升级都能直接发布。


## 0.4.6 修复与待提供项（2026-10-13）

- qcode-opencode 已补齐官方历史并推到 https://gitee.com/quyongqing/qcode-opencode ，master=689c7fc、upstream=733b2c6，远程哈希已核对。此前浅克隆被 Gitee 拒绝，后续中断的推送也未生效；本次实际推送成功。
- 登录页默认用户名 admin，增加密码显示/隐藏按钮，保留浏览器密码管理器 autocomplete。不把真实管理员密码写入公开 HTML、JS 或 Git。后台已有账号时 ADMIN_PASSWORD 只用于首次初始化，不能只改 env 就认为数据库密码已改变。
- 安装 EXE 的整个引导流程（包括解压）纳入异常处理，日志保存到安装目录 logs/setup-*.log；CMD 外层保留窗口并返回真实退出码，失败不会显示成安装成功。默认网关为 http://code.quyongqing.cn，无需首次安装手输地址。
- 新增缺失/损坏 ZIP 引导失败日志测试；离线 EXE 测试改为执行真实 bootstrap，而不是跳过引导直接调用 install.ps1。
- 已发现 HTTPS 子域名证书不匹配。当前 Nginx 仅为主域名配置 HTTPS，code 子域名仍是 HTTP，尚未擅自改 Nginx/证书。浏览器下载警告的具体原文仍需用户确认。
- 当前 EXE 未签名，本机未发现可用的个人代码签名证书。填写作者文字无法变成可信发布者；需要受信任 CA 代码签名证书或签名服务。现有 build-installer.ps1 支持 CertificateThumbprint，但本轮不伪造签名、不关闭系统防护。
- 管理员临时密码及是否配置子域名 HTTPS 需按用户确认执行；不公开管理员凭据。签名参考：https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation 。
