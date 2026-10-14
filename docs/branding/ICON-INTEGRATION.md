# QCode 图标接入与验收记录

唯一源图为本目录 `logo-selected-02.png`。运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-branding-assets.ps1` 可重新生成资源；默认查找同级 `qcode-opencode` 仓库，也可传 `-OpenCodeRepository`。运行脚本需要 Windows System.Drawing。

资源：平台 `apps/server/public/branding`、安装器 `apps/client/branding`、客户端 `packages/app/public/branding`，PNG 尺寸为 16/24/32/48/64/96/128/192/256/512；ICO 包含 16/24/32/48/64/96/128/256。源图浅色底、图形与透明外缘均保留，当前未做裁切或重新设计。

## 已接入

- 平台首页导航、页脚、产品预览、管理登录弹窗、后台侧栏与 favicon。
- 客户端 app favicon、UI Mark/Splash/Logo；UI 图片使用模块导入，随构建打包。
- TUI 标识使用简洁字符。
- Electron production Windows 图标资源 `packages/desktop/icons/prod/icon.ico` 与 `icon.png`；现有 prebuild/copy-icons 流程会复制。其他渠道和操作系统图标未替换。

## Windows 安装器接入

2026-10-14：Windows 安装器迁移到 Inno Setup 6。`scripts/qcode-setup.iss` 使用同一 `apps/client/branding/qcode.ico` 编译安装器和系统卸载器资源；桌面、开始菜单启动与卸载快捷方式指向安装根目录 `qcode.ico`。签名和 manifest 哈希在编译后生成，不再事后修改 EXE 资源。ZIP 继续包含 ICO/PNG；旧 ZIP 缺图标时使用当前安装器资源或保留已安装图标。默认卸载保留小型数据清理入口及其图标，完整清理移除它们，用户项目始终保留。

独立产物目录：artifacts/icon-review-20261014。已真实生成三个隔离 LNK，并读取确认 IconLocation 均为安装根目录 qcode.ico,0；它们位于 shortcut-check 内。此检查执行安装器实际创建代码，但没有改用户真实桌面/PATH，不能等同实际默认安装验证。

新验收产物目录为 `artifacts/inno-review-20261014`。系统卸载注册项使用卸载 EXE 内置图标，不随客户端版本指针变化。浏览器进程自身任务栏图标仍由浏览器控制。

## 当前验证

- 平台 UI smoke 已通过，生成 `.visual-tests/home-desktop.png`、`home-mobile.png`、`admin-desktop.png`、`admin-mobile.png`。手机首页已视觉检查。
- 客户端类型检查未通过：`packages/app/src/custom-elements.d.ts` 是 Git Windows 符号链接占位文本，触发 TS1128；未改写该文件。
- 客户端 `packages/app` 的 `bun run build` 已通过，产物为 `packages/app/dist`。现有构建包含大分块、重复 sourcemap 文件警告；客户端真实页面截图尚未生成。
- 已编译 Inno 安装 EXE 并执行离线安装与系统卸载集成验证；员工电脑双击界面与实际快捷方式仍由主控验收。
- 资源生成已成功；完整透明像素、小尺寸边缘与客户端页面截图仍需要验收。

没有提交、推送、部署或发布。
