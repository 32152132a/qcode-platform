# 管理后台与模型来源（2026-10-16）

后台源码位于 apps/admin，技术栈 Vue 3、TypeScript、Element Plus、Pinia、Axios、ECharts。
表单/表格组件来自同工作区 ollama-chat-app，路由、接口、权限和 Hooks 按 QCode 接口适配。
页面负责组合；EntityDialog 用 ref.open(data,onSuccess)；组件样式使用局部 SCSS。

## 本地运行
在 apps/admin 执行 npm ci、npm run dev。开发代理连接 127.0.0.1:3100 的 QCode 后端。
npm run build 会先类型检查。生产 Docker 多阶段构建前端，再由 Node 提供 /console/ 静态目录。
后台使用 Hash 路由，无需增加 Nginx history fallback。根地址进入下载首页，管理入口为 /console/#/login。
legacy.html 暂留作旧后台回退，不作为新入口；原 API 和旧客户端下载清单保持兼容。

## 模型来源
分为 local、official、relay 三类。服务来源集中持有地址、协议、Key 引用和开关；Key 仍在原凭据库加密。
现有模型在启动时按地址、Key、协议自动归组，保留模型 ID、公开名称、默认设置和历史记录。
生产 SQLite 首次迁移前在 data 目录生成 before-model-sources-*.qcode-backup，加密格式兼容现有恢复工具。
关闭来源立即拒绝其模型的新请求；客户端下次刷新目录时隐藏。已经开始的请求不强制中断。
可编辑名称/启用/默认，协议、上下文和计价信息放入高级设置。
来源地址/Key 修改会更新绑定模型并清除过期验证；同步不覆盖手动编辑或启用状态。
上游明确下架的模型保留记录但不可调用；空列表、网络失败时保留上一次有效目录。
创建来源和服务启动时可自动刷新候选目录，不导入新模型。来源和 Key 在请求中变化时丢弃旧结果。
管理员勾选后批量导入模型；新模型默认关闭，验证后启用。
不依赖某一家中转站的专有价格接口；未确认单价的自动模型成本记为未知。
所有启用模型对全员可用；用户和部门的模型设置仅为默认选择。

## 验收
后端：node apps/server/test/run.js
前端：npm --prefix apps/admin run build
浏览器：设置 QCODE_TEST_PLAYWRIGHT_MODULE 后，node apps/server/scripts/admin-ui-smoke.mjs
覆盖页面导航、用户创建、来源添加/关闭、设置保存、Skill 创建/编辑和 390px 手机布局。
测试使用临时内存数据库及模拟凭据，不使用真实员工账号。

## 中转站同步列表

点击“同步模型”读取完整候选目录，不再限制前 30 个或按品牌版本筛选。弹窗每页 12 张卡片，支持搜索、跨页保留勾选、选择本页与清空选择。已有模型标记为已导入，名称、参数、启用和默认状态不变，未勾选不会删除。新模型仅在提交后导入，默认关闭，验证后再启用。

不兼容对话接口、或图像/音频/向量类模型仍展示但不可勾选，并说明原因。目录最多支持 2000 个有效 ID，超过时明确报错，不静默截断。自动刷新只更新目录及已有模型可用状态，不自动导入新模型。失败时保留上次目录。

POST /admin/models/sources/:id/sync 读取目录；POST /admin/models/sources/:id/import 提交 modelIds、catalogRevision。提交校验目录版本、来源版本和 Key 状态，整批原子写入；重复提交不会产生重复模型，保留 models:write 权限和审计。

ModelSyncDialog 是局部组件，ref.open(source, models, onSuccess) 调用。搜索复用 QyqForm，弹窗/卡片/勾选/分页复用 Element Plus。QyqTable 专用于表格、EntityDialog 专用于编辑字段，不强行扩展公共组件。浏览器验收运行 apps/server/scripts/model-sync-ui-smoke.mjs，使用模拟上游及隔离数据库。

## 员工端名称与后台重名检查

员工模型目录只使用管理员配置的模型显示名称，不附加服务来源名称；模型内部 ID 和网关路由保持独立。后台新增或修改模型、服务来源名称时，统一按去首尾空格、NFKC Unicode 规范化和忽略大小写检查重名，冲突返回 409 和明确提示。

导入遇到跨来源同名模型时，为新记录添加 `(2)`、`(3)` 等序号，不覆盖既有模型；不自动修改历史名称或启用状态。已有历史重名记录保留，未改名的其他配置仍可保存，避免升级阻断维护。员工端更新模型目录后生效，无需重打安装包。

## 管理端组件复用约定（2026-10-17）

- 页面框架统一使用 PagePanel，集中展示标题、操作、加载和错误。参考项目 LayoutFormTable 依赖整页固定高度和自己的滚动容器，直接嵌入现有后台会叠加滚动及留白，因此保留当前框架适配，不改整体布局架构。
- 用户、Key、部门、Skill、知识库列表统一使用 DataTable，内部复用 QyqForm 搜索和 QyqTable 分页、固定表头、固定操作列。默认每页 10 条，搜索/切换页大小回第一页，数据缩减自动校正页码。
- 日志使用 LogPage + 局部 LogFilters，筛选复用 QyqForm；DataTable 的 serverPagination 接受 page/pageSize/total，并通过 page-change 通知父级。日志不再叠加前端切片和第二个分页器。
- 用户登录设备使用局部 UserSessionsDialog，以 ref.open(user,onSuccess) 调用，内部复用 DataTable。刷新、撤销和错误处理留在弹窗，不堆在页面。
- 普通编辑继续使用 EntityDialog + QyqForm。模型配置保留局部 ModelDialog（含高级配置），字段展示及校验使用 QyqForm；开关和有范围限制的数字输入使用该组件已有 custom 插槽，保留 Element Plus 控件，不扩大公共表单接口。
- 模型选择是卡片多选而非表格，保留局部 ModelSyncDialog。它复用 QyqForm 和 Element Plus；图表、平台介绍、下载页面使用专用展示组件。
- 管理员登录保留 Element Plus 原生表单，保留密码自动填充及浏览器密码管理器行为；通用动态表单暂未暴露 autocomplete 等登录属性，不为两个字段扩大公共组件。

验收：node apps/server/scripts/component-reuse-ui-smoke.mjs 覆盖搜索翻页、分页大小、页码缩减、固定表头、设备撤销、日志服务端分页、模型高级参数保存、知识库点击/回车检索和桌面/手机布局。新增局部组件未提升为全局组件。

## 账号并发等待

员工请求达到账号并发上限时按账号排队，默认最多等待 15 秒，每账号最多 4 个等待请求，全网关最多 64 个等待请求。轮到执行时重新鉴权，并继续使用原模型、额度和全局并发校验；等待不占用 Token 预留，不产生计费请求记录。断开连接移除等待项；等待超时、队列满分别返回 REQUEST_QUEUE_TIMEOUT、REQUEST_QUEUE_FULL 和 Retry-After。管理员模型验证仍采用原限制。
