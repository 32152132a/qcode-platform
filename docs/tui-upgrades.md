# TUI 配套版本与升级

QCode 不修改第三方 TUI 或配套 Harness 的源码，也不添加版本豁免。
当前固定组合为 Harness 0.2.0-rc.2 + @deepseek-harness-tui/dsh-tui 0.14.0。
Web 继续使用 qcode-harness 的定制构建。打包代码计划将两套运行时随同一个安装包交付，共用内置 Node；双运行时完整安装包尚未验证完成。

- `qcode` / `qcode tui` 使用发行版内的 `harness-tui`。
- `qcode web` 使用 `harness-custom`。
- 每个员工的 Web 配置和会话保留在 `harness`，TUI 使用 `harness-tui`；Agent 数据也分别保存。
- 两种模式共用员工账号、网关和可选项目目录；会话不会自动跨模式迁移。
- 配置目录中的依赖链接指向当前发行版运行时；按依赖锁文件生成 profile 名称，升级不覆盖旧 profile。

## 升级方式

1. Web 更新只更新 qcode-harness，不修改 TUI 版本。
2. TUI 更新前先确认上游声明支持的 Harness 版本，修改 `scripts/tui-runtime/package.json` 中插件和配套核心版本（显式 dsh peer 依赖须同步）。
3. 在该目录使用 pnpm 更新 `pnpm-lock.yaml`，审查版本和完整性哈希。沿用 hoisted 与 autoInstallPeers:false；核心需要的 peer 在 manifest 中显式列出，避免自动混入另一版本。
4. 完成 TUI 启动、网关对话、工具调用、会话恢复、旧配置升级及回滚检查，再运行现有 `release-client.cmd`。

构建使用 frozen lockfile，不在员工电脑运行包管理器。TUI ZIP 和版本元数据均经过校验后再切换客户端版本。
代价是发行包包含两套核心、体积增大；以后上游 TUI 支持定制核心版本时再评估合并，不提前维护源码补丁。

当前修改尚未发布；完整功能及安装升级验证待完成。旧 TUI 试验目录不会自动迁移。
