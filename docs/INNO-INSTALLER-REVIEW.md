# Windows Inno Setup 安装器验收

日期：2026-10-14。仅本地构建，未提交、推送或发布；保持客户端版本 0.4.6。开始时工作树干净，保留此前卸载和品牌图标实现。

## 实现

- `scripts/build-installer.ps1` 调用 Inno Setup 6 ISCC，支持 `-InnoCompiler`。源码模板为 `scripts/qcode-setup.iss`；无需 IExpress SED/CMD 包装或事后 EXE 图标注入，已删除无调用的 `set-exe-icon.ps1`。
- 单一当前用户 AppId，系统卸载器存放 `{app}\.setup`。编译时使用 QCode ICO，桌面、开始菜单及系统卸载入口统一图标。
- Inno 在安装前调用现有离线 bootstrap/install：校验并安装私有 Node、运行时、版本指针，沿用网关配置。EXE 负责快捷方式，ZIP 更新仍使用原有安装脚本；检测到系统卸载器后，更新脚本保留该入口。
- 系统卸载在用户确认之后、移除 Inno 文件及注册项之前调用安全清理脚本；失败时终止卸载并保留注册项。脚本/CMD 入口转交系统卸载器，避免残留注册项。
- 默认保留配置、会话及小型后续清理入口。全量清理要求准确确认短语，支持数字和 32 位十六进制用户 ID，清理 Token 和运行时配置，保留 workspace、未知文件及外部项目。静默卸载默认保留数据。
- 旧安装没有 Inno 注册项时，选原目录升级；自定义原目录可传 `/DIR="原目录"`。后续 Inno 安装使用已登记目录。旧升级 ZIP 缺少卸载器时使用执行安装器的文件或保留根目录入口。

## 产物和验证

验收包：`artifacts/inno-review-20261014/QCodeSetup-0.4.6.exe`，ZIP 与 manifest 同目录；编译日志位于 `exe-build/compiler*.log`。本机编译器 Inno Setup 6.7.3 仅安装到忽略提交的 `artifacts/inno-tools/compiler`；官方下载签名为 Valid。

```powershell
$env:QCODE_TEST_RELEASE_DIRECTORY='D:\works\trae\qcode-platform\artifacts\inno-review-20261014'
node --test apps/server/test/installer-offline.test.js apps/server/test/installer.test.js apps/server/test/uninstaller.test.js apps/server/test/installer-bootstrap.test.js
```

最终结果：14 项通过，0 失败、0 跳过。包含真实 EXE 离线安装及 HKCU 系统卸载注册，旧目录布局升级、重装保留网关、校验失败不切换版本、更新和回滚、默认/自定义路径、重复卸载、32 位用户 ID 配置及 Token 清理、目录联接拒绝、失败日志和项目保留。真实系统卸载失败后注册项保留、成功后移除。测试禁用实际用户 PATH 和快捷方式，所有系统卸载测试项最终清除。

57 个 JavaScript 模块静态检查通过，`git diff --check` 无错误。

保留真实 EXE 测试夹具及日志：`C:\Users\庆\AppData\Local\Temp\qcode-offline-ZMOivV`。卸载日志位于 `%LOCALAPPDATA%\QCode-uninstall-logs`，默认配置与项目保留的夹具可供主控核验。

## 主控验收

员工电脑上的非静默向导、真实快捷方式、PATH 通知和图标显示需主控实机验收。默认/自定义路径自动测试不覆盖所有 Windows 版本；本次内置运行时为 x64，ARM64 实机尚未验证。安装包未企业签名；可传企业证书 `-CertificateThumbprint` 构建。不要把本次同版本验收产物直接替换已发布包。
