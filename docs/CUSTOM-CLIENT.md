# QCode 定制客户端构建与验证

客户端 0.4.0 支持把 QCode Harness Web 构建随 Windows 客户端分发。服务器仍负责账号、模型 Key、额度和审计；员工端只持有自己的加密登录状态，本地转发服务为 Harness 提供短期的本机令牌。

## 构建 Windows x64 包

使用 Node 24 和 Harness 仓库要求的 pnpm。在 Harness 仓库完成 `pnpm run build:qcode` 后，在本平台仓库执行：

```powershell
./scripts/build-harness-bundle.ps1 -HarnessRepository D:/works/trae/qcode-harness -OutputDirectory D:/qcode-artifacts/build-001
node apps/server/scripts/package-client.js --harness-bundle D:/qcode-artifacts/build-001/实际生成的运行包.zip --output D:/qcode-artifacts/release-001
./scripts/build-installer.ps1 -ReleaseDirectory D:/qcode-artifacts/release-001
```

运行包旁的 `.zip.json` 包含源码提交、核心版本、平台、CPU 架构和 SHA-256。构建脚本沿用 Harness 上游的依赖导出工具，补齐其 workspace peer 和 vendor 依赖，验证独立 Web、员工登录和假模型网关调用后才生成压缩包。MIT 许可证和第三方声明随包保留。

没有传入 `--harness-bundle` 时，打包脚本仍只能生成安装官方 Harness 的基础启动器。不要把这个基础包当成 QCode 品牌版。服务器启动时，脚本会保留已存在且校验通过的 QCode 品牌包，避免被基础包覆盖。大体积发行文件应通过发行物渠道交付，不把 node_modules 或测试凭据提交到 Git。

## 安装、更新和回滚

### 服务器分发（员工无需访问 Gitee）

Gitee 只保存代码。管理员在 Windows 构建完整 EXE 与 ZIP，将这两个文件及 `manifest.json` 上传到服务器的临时发行目录；ZIP 是自动升级所需文件，员工页面只提供 EXE。

服务器拉取本次代码并部署后，在已挂载发行卷的网关容器中运行受 Git 管理的发布命令（把 `/tmp/qcode-release` 替换为上传目录）：

```sh
node /app/apps/server/scripts/publish-client.js /tmp/qcode-release /app/apps/server/releases
```

发布脚本先校验两份文件，再发布发行清单；失败不会切换到不完整版本，同一版本不允许替换不同内容。`compose.yaml` 为发行目录配置独立卷。使用外部部署仓库时，同样需要挂载 `/app/apps/server/releases`，否则重建容器会丢失安装包。

员工访问 `http://code.quyongqing.cn`，在登录页点击“下载 Windows 客户端”，或直接访问 `http://code.quyongqing.cn/downloads/installer`。无需管理后台账号、克隆仓库或合并分卷。安装包尚未发布时明确返回未发布提示，不把源码 ZIP 当作安装程序。

解压完整客户端 ZIP，运行其中的 `install.ps1 -Gateway http://code.quyongqing.cn`。也可使用生成的 EXE。安装器按需安装 Node，验证内置 Harness 的散列、版本、架构和启动入口，然后切换版本。EXE 没有提供签名证书时是未签名安装器。

**从 0.3.0 首次升级，请使用新的完整 ZIP/EXE 安装。** 旧版更新器不认识内置定制运行包；如果已通过旧更新器升级，重新运行新 ZIP 中的安装脚本可以补齐定制运行包。

0.4.0 之后的 `qcode update` 使用网关的发行清单下载并校验。`qcode rollback` 切换回上一个客户端目录，定制 Harness 随之切换；工作目录、加密登录信息和会话不放在版本目录中。回滚程序不代表能够降级读取新版会话格式，跨 Harness 版本仍需验证。

支持当前约定的 HTTP 网关。SHA-256 用于检查文件与清单是否一致，HTTP 不提供传输加密或发行者身份校验。

TUI 品牌和新版兼容不属于这一批：原来的 `start-stage2-tui.ps1` 保持原样。新安装包只交付已测试的定制 Web；`qcode tui` 需要对应用户安装兼容的 `qcode-tui` profile，没有时会明确提示，不会把 Web 核心冒充 TUI。

## 可重复验证

```powershell
node apps/server/test/run.js
$env:QCODE_TEST_HARNESS_ENTRY='D:/qcode-artifacts/展开后的运行目录/lib/bin.js'
node --test --test-name-pattern=packaged apps/server/test/harness-runtime.test.js
$env:QCODE_TEST_RELEASE_DIRECTORY='D:/qcode-artifacts/release-001'
node --test apps/server/test/installer.test.js
```

安装测试使用临时目录、测试账号和假模型，并通过 `-NoPath` 避免修改用户 PATH 或桌面。真实员工电脑的首次安装、快捷方式、浏览器自动打开、真实模型工具执行仍须集中验收；本地测试通过不代表已经发布到线上网关。
