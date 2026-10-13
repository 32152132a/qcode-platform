# QCode 图标接入与验收记录

唯一源图为本目录 `logo-selected-02.png`。运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-branding-assets.ps1` 可重新生成资源；默认查找同级 `qcode-opencode` 仓库，也可传 `-OpenCodeRepository`。运行脚本需要 Windows System.Drawing。

资源：平台 `apps/server/public/branding`、安装器 `apps/client/branding`、客户端 `packages/app/public/branding`，PNG 尺寸为 16/24/32/48/64/96/128/192/256/512；ICO 包含 16/24/32/48/64/96/128/256。源图浅色底、图形与透明外缘均保留，当前未做裁切或重新设计。

## 已接入

- 平台首页导航、页脚、产品预览、管理登录弹窗、后台侧栏与 favicon。
- 客户端 app favicon、UI Mark/Splash/Logo；UI 图片使用模块导入，随构建打包。
- TUI 标识使用简洁字符。
- Electron production Windows 图标资源 `packages/desktop/icons/prod/icon.ico` 与 `icon.png`；现有 prebuild/copy-icons 流程会复制。其他渠道和操作系统图标未替换。

## 安装器任务需要合并的接入点

2026-10-14 更新：用户已授权修改共享安装文件，下列 1/2/3 接入点现已实施。打包允许 PNG/ICO，安装根目录保存 qcode.ico，桌面/开始菜单启动/卸载 LNK 设置 IconLocation，EXE 构建使用 scripts/set-exe-icon.ps1 调用 Windows 资源 API，在签名及哈希之前注入 ICO。卸载启动入口会移除；默认卸载保留图标供数据清理入口使用，完整清理移除图标。旧 ZIP 缺图标时使用当前安装脚本资源或保留已安装图标。

独立产物目录：artifacts/icon-review-20261014。已真实生成三个隔离 LNK，并读取确认 IconLocation 均为安装根目录 qcode.ico,0；它们位于 shortcut-check 内。此检查执行安装器实际创建代码，但没有改用户真实桌面/PATH，不能等同实际默认安装验证。

本任务执行期间 `apps/client/install.ps1`、`scripts/build-installer.ps1`、`scripts/installer-bootstrap.ps1` 和安装/卸载测试正在被另一任务修改，未改写这些文件。主控协调后需合并：

1. `apps/server/scripts/package-client.js` 的分发过滤目前仅允许 ps1/cmd/mjs/json/md。加入 ico/png，确保 `branding/qcode.ico` 入 ZIP。
2. `apps/client/install.ps1` 把 `branding/qcode.ico` 复制到安装根目录稳定路径；桌面、开始菜单启动与卸载快捷方式的 `IconLocation` 指向该路径，索引为 0。当前脚本新增卸载入口，因此该入口也需要接入。
3. IExpress 构建后的 EXE 必须先完成资源注入，再签名，再计算 manifest SHA256。资源修改需使用能保留 IExpress 自解压 CAB 的工具，并实测该 EXE 的离线安装，不能仅检查资源图标。
4. IExpress 提示窗/控制台安装流程没有现成自定义品牌图片 API。保留现有流程时只可设置支持的文件/快捷方式图标；若新增 GUI，需要另行确定范围。
5. 浏览器快捷方式图标可设置，但浏览器进程自身任务栏图标由浏览器控制。

## 当前验证

- 平台 UI smoke 已通过，生成 `.visual-tests/home-desktop.png`、`home-mobile.png`、`admin-desktop.png`、`admin-mobile.png`。手机首页已视觉检查。
- 客户端类型检查未通过：`packages/app/src/custom-elements.d.ts` 是 Git Windows 符号链接占位文本，触发 TS1128；未改写该文件。
- 客户端 `packages/app` 的 `bun run build` 已通过，产物为 `packages/app/dist`。现有构建包含大分块、重复 sourcemap 文件警告；客户端真实页面截图尚未生成。
- 安装 EXE、实际安装后的快捷方式、卸载入口图标尚未验证；本任务没有生成可声称验收通过的安装 EXE。
- 资源生成已成功；完整透明像素、小尺寸边缘与客户端页面截图仍需要验收。

没有提交、推送、部署或发布。
