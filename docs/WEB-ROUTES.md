# 网站页面路由

Vue 管理端使用 History 路由，资源从 `/assets/` 加载：

- `/`：产品与客户端下载首页。
- `/login`：管理员登录。
- `/manage/overview`：后台概览；其他后台页面使用 `/manage/<页面>`。
- `/download`：兼容入口，跳转至 `/`。

旧 `/console/#/login`、`/console/#/manage/...` 等链接在加载后迁移为新路径，保留页面查询参数。旧书签不需要手动修改。

Node 网关通过 `src/web-pages.js` 为页面路由提供前端入口，支持直接访问和刷新。接口 `/admin`、`/auth`、`/client`、`/v1`、`/downloads` 不参与页面回退，缺失资源仍返回 404。Docker 中前端文件仍存放于 `public/console`，这个内部目录不再体现在访问地址中。

当前 Nginx 将域名请求整体转发至网关，因此无需新增 Nginx 路由规则。部署时需要同时构建前端和更新后端，沿用现有 Docker 构建流程即可。客户端安装包无需重做。

验证：`node --test apps/server/test/web-pages.test.js`；前端 `npm --prefix apps/admin run build`。另需浏览器检查深层地址刷新、未登录跳转和旧书签兼容。
