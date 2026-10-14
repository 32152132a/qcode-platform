# 模型中转配置与验收

## 使用流程

1. 在 Key 管理添加官方或中转站 Key，加密保存在网关，员工端不获取真实 Key。
2. 添加模型：选择 GPT、Gemini、Claude、Grok、Mistral、DeepSeek 或自定义品牌，再选择服务来源。VectorEngine 地址参考同级 ollama-node，可修改，不复制该项目私有凭据。
3. 填写地址和默认 Key，读取模型列表、选择上游真实模型名。站点不支持列表时手动填写，不使用聊天项目的 vectorengine- 显示前缀。
4. 设置名称和员工公开模型名。高级配置里选择协议、Token 上限、上下文和单价；品牌仅用于显示，协议独立配置，不猜测模型协议和价格。
5. 保存后新模型默认不启用；验证模型会测试流式函数调用，再回传工具结果获取文本，不执行工具代码。
6. 验证通过后启用，再分配用户或部门。每用户当前仍分配一个模型，员工无需重装，现有会话可能需刷新或重启。

Key 优先级为用户专用、部门专用、模型默认。希望用模型 Key 时，应回收不适用的个人/部门 Key，避免将 DeepSeek Key 发给其他站点。

## 协议范围

- Chat Completions：沿用原始请求转发，保留工具、图片和 Gemini thought_signature 等 extra_content。
- Responses：独立转换文本、用户图片、函数定义、工具调用及结果回传、并行调用索引、流式参数和 Token 用量。store=false，不创建上游持久会话。
- Gemini 使用官方 https://generativelanguage.googleapis.com/v1beta/openai 或中转兼容入口。Claude、Grok、Mistral 使用中转站兼容入口。未新增原生 Gemini generateContent 或 Anthropic Messages。
- GPT 使用哪种协议以站点实际支持为准；参考项目 GPT 5.4 使用 Responses，但这里不锁死模型版本。
- Responses 对尚未适配的 stop、logprobs、response_format 等参数明确报错。原生 reasoning/encrypted reasoning 跨轮状态、内置搜索和电脑工具未适配；复杂推理模型仍需客户端真实项目验证。

参考：[OpenAI 工具调用](https://developers.openai.com/api/docs/guides/function-calling)、[Responses 流事件](https://developers.openai.com/api/reference/resources/responses/streaming-events)、[Gemini 兼容接口](https://ai.google.dev/gemini-api/docs/openai)。

## 测试与权限

探针最多两次生成，每次输出上限 256 Token，有超时、大小、并发和个人配额限制。测试前页面确认费用。请求记录 purpose=model_check，计入管理员用量/个人配额并记录审计；未知用量保守预留。只允许 models:write 权限，错误正文与真实 Key 不透传。配置或 Key 更换后清除旧验证；绑定模型的 Key 禁止直接删除。

providers.test.js 使用模拟服务覆盖五品牌、模型 Key、目录、JSON/流式、工具结果往返、签名元数据保留、权限、用量、错误脱敏、Key 替换和残缺流。浏览器通过隔离本地网关验证登录、草稿目录、保存和探针，1440/768/390px 布局无横向溢出。截图位于 artifacts/model-admin-desktop.png 与 artifacts/model-editor-mobile.png，仅使用模拟数据。

未调用真实中转站。最终需管理员提供站点 Key、真实可用模型名称，并使用员工 Web/TUI 验证真实项目；探针通过不代表余额、长上下文或客户端签名回传已全面验证。
