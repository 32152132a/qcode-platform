# 服务器运行说明 · 0.3.0

需要 Node.js 24，进入本目录执行 `npm ci`。`npm run demo` 启动隔离演示，管理页面为 http://127.0.0.1:3310；演示密码在 `.demo-access.txt`，模型仅为本地模拟。

## 真实配置

1. 停止旧网关，备份原 `.env` 和数据库。不要并行打开同一数据库。
2. `npm run setup` 创建配置，已有配置只补齐必要项；不会替换已有模型、账号或加密密钥。
3. 检查 `.env`，新安装默认 `DB_PATH=./data/qcode.sqlite`，妥善单独备份 `KEY_ENCRYPTION_SECRET`。
4. `npm start`，登录后台后修改管理员密码，配置模型地址、Key、用户、部门及配额。
5. 仅支持当前 v4 SQLite 数据库；旧 JSON 或旧版本数据库不会自动迁移。重置测试数据必须先确认并备份，再重新初始化。

```powershell
node --env-file=.env scripts/maintenance.js backup
node --env-file=.env scripts/maintenance.js restore --input ./backups/FILE.qcode-backup --target ./data/restored.sqlite
node --env-file=.env scripts/maintenance.js archive-audits --days 180
```

维护命令要求服务停止。恢复只写新文件并撤销历史登录会话。备份经过加密，丢失加密密钥无法恢复 Key。审计归档不删除用量账本。未指定 --days 时使用后台保留期限设置，0 表示不归档；当前不自动运行清理任务。

## 权限与计费语义

管理员拥有全部管理权限；运营可管理普通员工、部门和 Skill，但不能读取/分配 Key 或授予管理员角色；审计员只读；员工仅能使用获准模型。

模型选择顺序为用户指定、部门指定、系统默认。Key 为用户指定或部门继承。用户额度可单独设置或继承部门成员模板，部门还可设置所有成员共享的总额度。

额度 0 表示不限。日/月边界由 QUOTA_TIMEZONE 指定，默认 Asia/Shanghai。请求发出前预留输入估计与最大输出 Token，返回 usage 后结算。缺少 usage 或中断且未返回用量时标识未知，不扣估算 Token，释放临时预留量；输入估计不是供应商 tokenizer，严格账单硬上限需供应商侧配合。已转发失败请求也计请求数；转发前拒绝不计。手动恢复额度保留历史账本。

默认每用户一个同时进行的模型请求，可由管理员修改；会话数量另行控制。禁用账号、重置密码或撤销会话会取消网关中的关联请求，但上游是否立即停止计算由服务商决定。价格为管理员配置的每百万 Token 单价，按请求快照；CNY/USD 分别统计，未知 usage 不伪造零成本。

## 员工安装与更新（当前主线）

下载 /downloads/installer 的 QCode Desktop EXE。Windows 安装包包含 Electron 和本机 OpenCode 引擎，可离线安装；登录、模型调用、资源同步及更新需要连接网关。

桌面快捷方式或 qcodeweb 打开工作台；qcode 打开终端；qcode models 查看模型，qcode doctor 检查本地服务，qcode update 更新，qcode logout 退出登录。账号凭据由桌面使用系统加密能力保存，上游 Key 不分发给员工。每个账号有独立配置与会话；目录分离不是操作系统沙箱。

当前客户端源码和发布脚本位于相邻的 qcode-openwork 仓库，运行 release-desktop.bat 构建、验收并上传，-BuildOnly 仅生成安装包。后台/网关代码由本仓库既有部署流程发布。

旧安装与更新链路已删除；apps/client 仅保留当前共享模块。Desktop 使用 /downloads/desktop/latest.yml，详见 ../../docs/CURRENT-ARCHITECTURE.md。

## 部署和检查

Docker 从仓库根目录 `docker compose up -d --build`。HTTPS 组合文件为 `compose.https.yaml`，使用内网 CA 的 Caddy，需要员工设备信任企业批准的证书。不要直接在公网开放默认 HTTP 管理入口。

TRUST_PROXY_CIDRS 仅填写受控反向代理来源；ADMIN_ALLOWED_IPS 限制后台来源。未配置代理信任时忽略客户端伪造的转发 IP。

`npm test` 执行隔离测试；`npm run check` 做语法检查。先构建 `apps/admin`，再运行 `node scripts/admin-ui-smoke.mjs`、`node scripts/model-sync-ui-smoke.mjs` 和 `node scripts/component-reuse-ui-smoke.mjs` 验证现用 Vue 管理端；需要 Playwright，Windows 使用 Edge，其他系统使用 Playwright Chromium。详细统一验收与尚待环境验证内容见仓库 `docs/product-handoff.md`。

登录设备名额满时，正确密码的新登录自动替换最旧会话，旧访问 Token 和刷新 Token 立即失效，旧会话请求被中止，并记录 session.replaced 审计。名额为 1 时为后登录顶掉前登录；多设备账号保留其余名额，名额为 0 仍拒绝新登录。

## 一次性上线前数据整理

仅针对已检查的 v3 测试数据库，非启动迁移。先停止网关，使用原加密密钥和挂载的数据/备份卷运行 scripts/prepare-launch.js（默认只检查），加 --apply 才执行。

脚本先保存加密的原始 v3 快照，再原子更新至 v4；设置基础版/test/plus/pro 等级 0/1/2/3、基础版为默认，清空开通申请、请求、审计、登录失败记录。保留账号、Key、模型、登录会话、技能、反馈及收款码。发现新增订阅、套餐价格变化或旧字段异常就停止。已执行过再次运行不清理新数据。

备份默认在 backups/before-launch-时间.qcode-backup，可用 QCODE_LAUNCH_BACKUP 指定独立路径。回滚需使用原加密密钥、上一版代码的恢复工具将 v3 备份恢复至新数据库文件，并切回旧镜像；不要用新版 v4 恢复工具读 v3 备份。整理完成后再部署新版。
