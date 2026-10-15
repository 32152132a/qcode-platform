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
创建来源后和服务启动时自动同步，也可手动同步。来源和 Key 在请求中变化时丢弃旧结果。
自动推荐文本模型；显式声明不兼容接口的模型不自动推荐。新云模型待管理员验证后启用。
不依赖某一家中转站的专有价格接口；未确认单价的自动模型成本记为未知。
所有启用模型对全员可用；用户和部门的模型设置仅为默认选择。

## 验收
后端：node apps/server/test/run.js
前端：npm --prefix apps/admin run build
浏览器：设置 QCODE_TEST_PLAYWRIGHT_MODULE 后，node apps/server/scripts/admin-ui-smoke.mjs
覆盖页面导航、用户创建、来源添加/关闭、设置保存、Skill 创建/编辑和 390px 手机布局。
测试使用临时内存数据库及模拟凭据，不使用真实员工账号。
