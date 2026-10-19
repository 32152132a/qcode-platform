> 历史方案 / 兼容维护文档。当前 Desktop 入口见 [当前架构](CURRENT-ARCHITECTURE.md)。不要按本页发布当前桌面应用。

# QCode 定制客户端构建与发布

服务器管理账号、模型 Key、额度和审计；员工安装包内置 QCode 定制 Harness Web。源码放 Gitee，安装包放服务器独立发行卷。重新部署网关不会覆盖已发布安装包。

## 双击发布（Windows）

只需双击仓库根目录的 `release-client.cmd`：自动增加补丁版本号、构建、测试、上传并清理旧包，无需手动修改版本号。窗口会保留成功或失败结果。

版本号取本地与服务器中较新的版本，再将最后一位加一，例如 `0.4.1 → 0.4.2`。服务器检查或核心构建失败不会占用新版本；开始客户端打包后若失败，本地保留已分配的版本号，下次再递增，允许跳号，避免同号对应不同文件。版本更新写入 `apps/client/release.json`，不会自动提交 Git。

入口自动寻找 Node 24，仅修改当前进程 PATH，不修改系统配置。依赖、SSH 密钥和服务器前提与下文一致。已删除单独的 `publish-client.cmd`；必要时仍可通过下方命令复用已生成的包，不递增版本。

## 一条命令发布

在 Windows 使用 Node.js 24 或更新版本及 Harness 要求的 pnpm。首次准备好两个项目的依赖：平台的 `apps/server` 下执行 `npm ci`，相邻 `qcode-harness` 仓库执行 `pnpm install --frozen-lockfile`。

服务器需要先部署包含 `publish-client.js` 的网关，并挂载可写的 `/app/apps/server/releases` 独立卷；发布命令会检查，缺少时直接停止，不修改部署配置或重启服务。SSH 主机指纹应已通过可信方式确认并保存在 known_hosts。

在平台仓库根目录运行：

```powershell
./scripts/release-client.ps1
```

默认使用相邻 `qcode-harness`、相邻 `login.pem`、`root@81.69.61.183` 和容器 `qyq_qcode`。可通过 `-HarnessRepository`、`-SshKey`、`-Target`、`-Container` 覆盖。密钥不写入仓库。签名证书可通过 `-CertificateThumbprint` 指定；否则生成未签名 EXE。

命令依次检查服务器、运行平台测试、构建 Harness、导出并验证运行包、生成客户端 ZIP 和 EXE、测试升级与回滚、上传三个发行文件、在容器内再次校验散列并最后切换发行清单。不会拉取服务器代码、修改 Nginx 或重启服务。失败即停止，不自动重试。

输出目录为 `artifacts/release-时间-随机值/`，不纳入 Git。新构建会自动递增版本（`-BuildOnly` 同样递增）；同一版本不允许发布不同内容。保留已生成的安装包，不用同一版本重复构建替换线上文件。

```powershell
# 仅构建和验证，不连接服务器
./scripts/release-client.ps1 -BuildOnly

# 核心未变时，可复用已经验证过的 Harness ZIP（旁边必须有 .zip.json）
./scripts/release-client.ps1 -BuildOnly -HarnessBundle D:/qcode-artifacts/qcode-harness.zip

# 上传中断后复用已生成的成品，不用重新构建
./scripts/release-client.ps1 -PublishDirectory D:/works/trae/qcode-platform/artifacts/实际输出目录
```

上传使用独立临时目录；全部文件校验通过后才切换清单。失败可能留下临时文件，排查后可清理对应 `/tmp/qcode-release-*` 目录。成功时只删除本次上传的三个临时文件。服务器只保留最新 Windows EXE 和升级 ZIP：清单切换成功后删除旧的 Windows 发行文件，失败时不清理当前版本。`macos/` 预留给后续 Mac 包和独立清单，Windows 清理不会遍历它；本次尚未提供 Mac 安装包。新版本发布后旧下载链接失效，刷新页面或重新执行更新即可。员工本机的上一个版本仍保留，可使用 `qcode rollback`。发布过程中需要暂存新旧文件，磁盘空间不足会停止发布；清理失败会显示警告。

旧的服务启动、演示启动和 Docker 构建自动打包入口已移除；打包脚本必须提供定制 Harness 包，不再生成官方版基础启动器。底层构建脚本仍由统一命令复用，原来的 TUI 验证脚本保留。

## 员工安装、更新和回滚

Windows EXE 使用 Inno Setup 6，安装到当前用户目录，统一使用 `apps/client/branding/qcode.ico` 作为安装器、快捷方式和系统卸载入口图标。构建机需要 `ISCC.exe`，`scripts/build-installer.ps1 -InnoCompiler 路径` 可指定编译器；构建日志保存在产物的 `exe-build/compiler*.log`。无需重新注入 EXE 资源。

系统“已安装的应用”、开始菜单“卸载 QCode”和安装目录 `uninstall.cmd` 使用同一安全卸载链路，不显示终端。默认删除各网关的登录 Token 与本地登录链接，下次使用需重新登录；保留配置、历史会话、workspace 和未知文件。完整清理仍须提供“删除全部 QCode 本地数据”确认短语。默认卸载后保留小型清理入口供稍后删除个人数据。静默卸载同样删除登录 Token。失败日志位于 `%LOCALAPPDATA%\QCode-uninstall-logs`，清理失败时保留系统卸载注册项。

向导固定为简体中文，离线安装展示读取内置包、解压、校验、运行环境安装和版本切换阶段。更新下载与安装的详细输出写入 `logs/update-*.log`；终端和网页登录页仅展示中文阶段提示。自动更新失败会显示日志位置并继续使用当前版本。进度是整体安装阶段进度，不代表单文件下载字节百分比。

本地测试使用 `build-installer.ps1 -TestAppId QCodeTest-<32位十六进制>`：独立系统注册项、独立默认目录，强制禁用快捷方式和 PATH 修改。测试产物不可通过正式发布脚本发布。

旧版升级选择原安装目录（自定义旧目录可用 `/DIR="原目录"`），继续沿用 `current.json`、版本目录、内置 Node 和原网关设置；Inno 注册项不依赖客户端版本指针，因此 ZIP 更新与回滚不会移除系统卸载入口。安装包默认路径是 `%LOCALAPPDATA%\QCode`，后续 Inno 安装沿用已登记路径。

员工打开 `http://code.quyongqing.cn`，点击“下载 Windows 客户端”，或访问 `http://code.quyongqing.cn/downloads/installer`。只需下载一个 EXE；ZIP 留在服务器供自动更新，无需员工克隆 Gitee 仓库。

安装器检查运行包散列、版本、架构和启动入口后切换版本；完整安装包内置对应架构的 Node 24.19.0，安装时校验后解压到 QCode 私有目录，不访问 nodejs.org，不改变全局 Node。安装可离线完成；登录、AI 使用与升级需要网关。也可解压完整 ZIP 执行 `install.ps1 -Gateway http://code.quyongqing.cn`。许可证和第三方声明随包保留。

**从 0.3.0 首次升级使用新的完整 EXE/ZIP**，旧更新器不认识定制运行包。0.4.0 及之后使用 `qcode update` 获取发行清单和更新，`qcode rollback` 回到上一个客户端版本。登录信息、会话和工作目录独立保存；跨 Harness 版本的会话格式兼容仍需验收。

当前使用 HTTP，SHA-256 检查文件与清单一致性，不提供发行者身份认证或传输加密。

新安装包交付定制 Web。`qcode tui` 需要对应用户安装兼容的 `qcode-tui` profile；没有时会提示。早期 stage2/stage3 本机验证脚本已移至 `harness-latest` 历史分支；当前主线不再依赖 Codex 私有运行环境。

## 验证范围

发布命令执行平台测试和安装升级、校验失败、回滚测试。新构建 Harness 时还测试独立 Web、员工登录和假模型网关调用；复用包时依赖该包已有验证和散列元数据。

安装测试通过 `-NoPath` 避免改动用户 PATH 和桌面。真实员工电脑首次安装、快捷方式、浏览器自动打开、真实模型工具执行及真实服务器上传仍需要集中验收。本地构建成功不代表线上已发布。
