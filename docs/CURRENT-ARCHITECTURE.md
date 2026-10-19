# 当前架构与发布边界

## 实际调用链

员工桌面/终端 → 本机 OpenCode 引擎 → 本机账号桥接 → QCode 网关 → 模型供应商或内网模型服务。

qcode-platform 提供管理端和网关，部署在服务器；qcode-openwork 提供员工应用，安装在员工电脑。二者可以分别更新。

## OpenCode 如何进入安装包

qcode-openwork/constants.json 固定两代引擎版本。构建调用 prepare-sidecar.mjs 和 prepare-opencode-v2.mjs 获取相应平台的预编译引擎，V2 校验固定制品的完整性，再将可执行文件与桌面一起打包。不是复制整个 qcode-opencode 仓库，也不是默认从该仓库编译。

OpenCode 1 暂用于上游兼容 API，OpenCode 2 用于当前工作台/终端。保留两代与重复复制同一代不是一回事；QCode 打包只保留每代引擎的一份通用名称文件。升级版本必须验收，不能仅替换版本号。

## 唯一推荐的桌面发布入口

在相邻的 qcode-openwork 仓库运行 release-desktop.bat（构建、隔离验收并上传）；release-desktop.bat -BuildOnly 只生成本地产物。下载 /downloads/installer，更新 /downloads/desktop/latest.yml。

当前流程不会修改服务器管理端代码，也不会替员工自动完成真实安装验收。安装、卸载、升级链路需在测试机验证；自动发布门禁覆盖包内启动、模拟模型请求、资源展示和键盘输入。

## 旧代码的处理原则

- apps/client、旧版 ZIP/EXE 构建与旧 manifest 保留，以便已有旧客户端继续获得兼容维护。
- scripts/release-client.ps1 默认停止并指向 Desktop 入口；确需维护旧版时显式使用 -LegacyClient。
- 不将新版 Desktop 清单覆盖到旧 manifest，避免旧客户端执行不兼容升级。
- qcode-opencode 与 qcode-harness 保留历史分支和源码，不属于当前常规发布依赖。
- 删除旧链路之前，先确认没有员工仍在使用；本轮不删除数据库、不修改用户安装。
