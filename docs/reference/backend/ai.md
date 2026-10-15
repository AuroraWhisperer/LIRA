# AI 互动助手集成

> 涉及文件:[src/ai/config.js](../../../src/ai/config.js)、[src/ai/config-store.js](../../../src/ai/config-store.js)、[src/ai/model-endpoint.js](../../../src/ai/model-endpoint.js)、[src/ai/secret-codec.js](../../../src/ai/secret-codec.js)、[src/ai/deepseek-client.js](../../../src/ai/deepseek-client.js)、[src/ai/http-client.js](../../../src/ai/http-client.js)、[src/ai/prompt.js](../../../src/ai/prompt.js)、[src/ai/personas.js](../../../src/ai/personas.js)、[src/ai/safety.js](../../../src/ai/safety.js)、[src/ai/ai-assistant-service.js](../../../src/ai/ai-assistant-service.js)、[src/ai/ai-assistant-helpers.js](../../../src/ai/ai-assistant-helpers.js)、[src/ai/async-coordinator.js](../../../src/ai/async-coordinator.js)、[src/ai/danmaku-delivery-verifier.js](../../../src/ai/danmaku-delivery-verifier.js)、[src/ai/api-quota-store.js](../../../src/ai/api-quota-store.js)、[src/ai/request-logger.js](../../../src/ai/request-logger.js)、[src/ai/tools/qweather-tool.js](../../../src/ai/tools/qweather-tool.js)、[src/ai/tools/amap-tool.js](../../../src/ai/tools/amap-tool.js)、[src/ai/tools/web-search-tool.js](../../../src/ai/tools/web-search-tool.js)、[src/ai/tools/current-time-tool.js](../../../src/ai/tools/current-time-tool.js)

本文档描述"AI 弹幕姬"领域模块:`src/ai/` 下的全部实现。HTTP 端点仅在此以文字提及并链接 [api.md](api.md) §13;AI 相关表 DDL 与设置见 [storage.md](storage.md) §3.1;弹幕触发链见 [bilibili/danmaku.md](bilibili/danmaku.md);进程装配与关闭时序见 [server-core.md](server-core.md) §5–§6。

**内部模块边界:** `ai-assistant-service.js` 拥有触发、排队、工具调用与回复发送生命周期；`ai-assistant-helpers.js` 提供提示与回复归一化纯函数，[conversation-context.js](../../../src/ai/conversation-context.js) 负责有界多轮历史的规范化与追加。helpers 不读取配置存储、不调用模型/工具，也不发送弹幕。

## 1. 概览与触发链

AI 弹幕姬是一个由模型服务驱动的通用互动助手；新配置默认使用通用助手；小猫是可切换的内置角色，角色包仅改变身份和语气。普通问答不依赖天气或地图服务。弹幕消息经 [server.js:611-631](../../../src/server.js#L611-L631) 的 `onMessage` 回调进入:`aiDanmakuDeliveryVerifier.observe(danmaku)`(投递验证,见 §9)→ 常规弹幕机器人链 → `aiAssistant.handleDanmaku({message, userName, uid, roomId})`。返回值被忽略(fire-and-forget),机器人异步排队生成并发送回复。

| 事实       | 值                                                                                                                              | 出处                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 角色人格 | `personas.js` 提供 `general`（无额外人格的通用）、`cat`（沿用结构化角色指南的橘猫）；`custom` 读取 `systemPrompt`，自建或导入包按 ID 选择；`{{name}}` 在生成时替换为 `trigger`，编辑/导出保留模板；小猫风格不写入公共底层规则 | [personas.js](../../../src/ai/personas.js)、[prompt.js](../../../src/ai/prompt.js) |
| 模型后端   | 供应商可选自动识别、DeepSeek、OpenAI、Claude、Gemini、豆包账号或自定义；Claude/Gemini 复用各自官方 OpenAI 兼容入口，不引入原生协议适配器 | [config.js](../../../src/ai/config.js)、[model-endpoint.js](../../../src/ai/model-endpoint.js)                              |
| 触发关键词 | 配置键 `trigger`,默认空字符串,1–12 字符;配置后消息中出现即触发                                                                  | [config.js](../../../src/ai/config.js)、[ai-assistant-service.js](../../../src/ai/ai-assistant-service.js)                  |
| 就绪条件 | `isAiReady`：enabled 为真且 trigger 非空；API 模式另要求 URL、API Key、model 非空，豆包准入另检查已登录且无需验证 | [config.js](../../../src/ai/config.js)、[deepseek-client.js](../../../src/ai/deepseek-client.js) |
| 回复发送   | `sendReply` = `danmakuSender.send({…, waitForRateLimit: true})`,等待发送频率而非抛错                                            | [server.js:260](../../../src/server.js#L260)                                                                                |
| 关闭时序   | 服务关闭第一步 `aiAssistant.shutdown()` → 协调器 stop,丢弃排队任务                                                              | [ai-assistant-service.js:289-291](../../../src/ai/ai-assistant-service.js#L289-L291)、[server-core.md](server-core.md) §6.2 |

## 2. 弹幕准入链(handleDanmaku)

`handleDanmaku`([ai-assistant-service.js](../../../src/ai/ai-assistant-service.js))在就绪检查后归一化 UID（无 UID 时使用 `name:<userName>`），然后先排除近期自身回复，再执行触发词及其他准入检查。任一失败即返回 `{accepted: false, reason}`:

| 检查         | 语义                                                                                                                         | 出处                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 就绪检查     | `isAiReady` 不成立 → `disabled_or_unconfigured`                                                                              | [ai-assistant-service.js:57-58](../../../src/ai/ai-assistant-service.js#L57-L58)                                                               |
| 自身回复回声 | 发送前按实际发送账号 UID 记录每个拆分片段，60 秒内同 UID 的完全相同文本（含平台可能添加的 @ 前缀）返回 `self_reply`；同账号的其他提问和其他观众的同文仍可准入 | [ai-assistant-service.js](../../../src/ai/ai-assistant-service.js)、[sender-service.js](../../../src/bilibili/danmaku/sender-service.js) |
| 触发词匹配   | `extractTriggeredQuestion` 在消息中定位 `trigger`,两侧文本拼回作为问题;空问题回退为"和大家打个招呼";未命中 → `not_triggered` | [ai-assistant-service.js:60-61](../../../src/ai/ai-assistant-service.js#L60-L61)、[308-316](../../../src/ai/ai-assistant-service.js#L308-L316) |
| 黑名单       | `store.isBlacklisted(uid)` 命中 → `blacklisted`(表 `ai_blacklist`)                                                           | [ai-assistant-service.js:63](../../../src/ai/ai-assistant-service.js#L63)、[config-store.js:95-98](../../../src/ai/config-store.js#L95-L98)    |
| 本地安全规则 | `checkLocalInput` 命中硬规则 → 以 `localRefusal` 直接入队(不再调用模型),见 §6                                                | [ai-assistant-service.js:64-70](../../../src/ai/ai-assistant-service.js#L64-L70)                                                               |
| 用户冷却     | `userCooldownSeconds`(默认 0)内同一 uid 重复触发 → `user_rate_limited`                                                       | [ai-assistant-service.js:80-90](../../../src/ai/ai-assistant-service.js#L80-L90)                                                               |
| 全房间限速   | 60 秒滑动窗口内最多 `roomLimitPerMinute`(默认 20)条 → `room_rate_limited`                                                    | 同上                                                                                                                                           |
| 队列上限     | `coordinator.getStatus().queued >= queueLimit`(默认 30)→ `queue_full`                                                        | [ai-assistant-service.js:67](../../../src/ai/ai-assistant-service.js#L67)                                                                      |
| 入队         | 通过 → `{accepted: true, reason: 'queued'}`(协调器已停止时为 `'stopped'`)                                                    | [ai-assistant-service.js:74-78](../../../src/ai/ai-assistant-service.js#L74-L78)                                                               |

## 3. 回复生成管线与协调器

总开关关闭由 `PUT /api/ai/config` 经 [api-context.js](../../../src/server/api-context.js) 调用 `service.updateConfig()`，先完成配置验证和持久化，再同步取消当前任务轮次：清空等待/已生成未投递队列、中止模型/工具/送达确认，并停止剩余分段和重试。每个任务保留所属轮次的 signal，关开后迟到结果也不能复活；重开只接收新触发。已提交上游的弹幕发送无法撤回，后续发送前沿用 sender 的逐段检查。旧协调器 drain 结束即从跟踪集合删除，应用 shutdown 仍等待未完成的 drain；关闭 AI 不永久停止服务，也不取消连接测试、模型列表或手动弹幕。除进入/离开豆包账号模式外，普通配置修改与保存失败不取消现有任务。

管理页总开关单独按操作顺序保存，其他字段草稿无效也能关闭；普通表单保存不携带 enabled，避免旧配置回执重新开启。相关回归见 [ai-assistant-lifecycle.test.js](../../../test/ai/ai-assistant-lifecycle.test.js)、[ai-routes.test.js](../../../test/ai/ai-routes.test.js) 和 [frontend-admin-ai-settings.test.js](../../../test/ai/frontend-admin-ai-settings.test.js)。

### 3.1 生成管线(generateReply)

[generateReply](../../../src/ai/ai-assistant-service.js#L92-L179) 按序执行:

1. **本地拒绝短路**:`item.localRefusal` 直接返回,`category: 'safety'`,不消耗模型配额。
2. **查询缓存**：固定本次人格，按可信房间、UID 和人格读取已送达历史；任一保留片段未通过本地安全检查则不使用历史。缓存键覆盖规则版本（`reply-v6`，不读取旧策略缓存）、配置、账号代次、人格作用域、UID、昵称、问题、实际有界输入和不可用工具集合；store 只保存 SHA-256 摘要。首次未交付的随机 sessionId 不进入内容缓存键，相同无历史首问仍可命中。聊天/工具/缓存回答均须确认送达后才追加历史；重试固定同一历史快照和 sessionId，并绕过缓存。失败或拒绝不写记忆、不续期。
3. **输入安全审核**:先用 `buildConversationInput` 生成本次问题与短期上下文的 JSON。API 模式再交给 `buildInputReviewPrompt`，任务放在 `instructions`，待审 JSON 放在 `input`；未通过只返回固定 `SAFE_REFUSAL`。豆包账号模式保留本地检查，跳过此远程审核，直接进入生成以减少首字等待。
4. **观众上下文**：输入 JSON 为 `{question, previousExchange}`；两轮及以上增加按时间排列的 `earlierExchanges`，裁剪后标记 `historyTruncated: true`。历史是同一观众当前会话的已交付问答，用于延续正常聊天、接龙、猜谜及省略，不具有覆盖公共规则的权限。API 输入审核与生成收到相同历史，详见 §3.3。
5. **主生成**：`deepseek.createResponse` 的 `instructions` 先放公共事实/安全规则，再以单行 `JSON.stringify({ persona })` 传入角色风格资料，避免角色中的换行或标签拼接成额外指令段；已保存角色文本不变。实际可用工具、北京时间与发送预算由程序提供，多轮上下文用于理解当前活动与问题。见 [buildReplyInstructions](../../../src/ai/ai-assistant-helpers.js)。不强制猫语、颜文字、固定推荐数量或非思考模式。
6. **工具循环**:`response.functionCalls` 非空时执行工具(§5),结果以 `function_call_output` 回填并带 `previousResponseId` 续问;累计调用超过 `maxToolCalls`(默认 6)→ `TOOL_LIMIT`。
7. **输出检查**:API 模式用 `buildOutputReviewPrompt` 分离审核指令与包含本次问题、同一份会话历史及 `candidateAnswer` 的 JSON；未通过则返回固定 `SAFE_REFUSAL`，通过时再次清理 `safeText` 或原答案。豆包账号模式跳过远程输出审核，对一次生成的完整文字执行 `cleanModelText` 与本地检查。所有模式本地检查失败均使用固定拒绝语；本地拒绝或模型返回指定的固定拒绝语均记 `category: 'safety'`，不写缓存或上下文，不提前把未检查的流式片段送入弹幕。
8. **截断与落库**:按长度预算 `truncateReply`(超出截断加 `…`);写缓存、写 `ai_request_logs`；上下文仅在 FIFO 投递成功确认后提交最终答案（见步骤 2）(`category` 为 `tool`/`chat`,工具调用数 > 0 记 `tool`)。

长度预算由 [getReplyLengthBudget](../../../src/ai/ai-assistant-helpers.js) 统一计算：单条弹幕 `DANMAKU_MESSAGE_LIMIT = 40` 减去 `@用户名 ` 长度，允许 1–3 条。界面不提供长度偏好，旧 `replyMaxChars` 键仅兼容读写，不影响生成预算。所有内置、自建、导入角色都自动附加公共底层提示，角色资料仅用于名字、语气及普通互动偏好；发送时仍截断到预算。API 模式继续独立执行输入/输出审核；豆包用固定安全指令、本地输入/输出检查和无工具权限的单次生成。

输出 token 上限按是否开启思考模式切换:`MODEL_OUTPUT_TOKENS = 3072` / `REASONING_OUTPUT_TOKENS = 4096`,审核请求固定 `REVIEW_OUTPUT_TOKENS = 384`([ai-assistant-service.js:22-24](../../../src/ai/ai-assistant-service.js#L22-L24)、[371-373](../../../src/ai/ai-assistant-service.js#L371-L373))。

### 3.2 顺序协调器(createOrderedAsyncCoordinator)

[async-coordinator.js:8-83](../../../src/ai/async-coordinator.js#L8-L83) 提供"生成有界并发、投递严格按序"的语义:

| 事实     | 值                                                                                                                                                                | 出处                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 生成并发 | 由 `generationConcurrency`(默认 3,1–5)控制同时生成的回复数                                                                                                        | [async-coordinator.js:29-44](../../../src/ai/async-coordinator.js#L29-L44) |
| 投递顺序 | 按入队序号 `nextSequence/nextDelivery` 串行投递,前一条完成后才投下一条(同观众多段回复不会插队)                                                                    | [async-coordinator.js:46-64](../../../src/ai/async-coordinator.js#L46-L64) |
| 失败隔离 | 生成或投递抛错 → `onError`(记 `delivery`/`generation` 失败日志),不阻断后续序号                                                                                    | [async-coordinator.js:53-58](../../../src/ai/async-coordinator.js#L53-L58) |
| 停止     | `stop()` 清空 waiting/completed,已停止后 `enqueue` 返回 false，并返回等待 active generation/当前 delivery 结束的 drain Promise；active 结果不会重新进入 completed | [async-coordinator.js](../../../src/ai/async-coordinator.js)               |
| 状态     | `getStatus()`:`queued/waiting/generating/ready/delivering`,经 `GET /api/ai/status` 暴露                                                                           | [async-coordinator.js:66-74](../../../src/ai/async-coordinator.js#L66-L74) |

### 3.3 连续互动与空闲清理

[conversation-context.js](../../../src/ai/conversation-context.js) 规范化旧单轮 payload 和新版 `{version: 2, sessionId, exchanges, truncated}`。历史最多 20 组：保留开场及最近 19 组，短会话不重复开场；每段问题/答案最多 500 个 Unicode 字符，总文本最多 12,000 字符，超出时整组裁去最旧的非开场问答。只存已交付文本，不存思考、审核和工具中间结果；没有额外模型摘要请求。中途活动约定也可能被裁剪，模型应按可见最近进度继续或简短确认，不声称记得完整记录。

同一房间/UID 从生成到交付结束占用一个协调器分组；其他观众可并发生成，所有回复仍按入队顺序交付。等待同组的任务不占生成槽，交付/错误处理 finally 释放分组并重新调度；下一问因此能读取上一问实际送达的历史。生成失败、发送失败和关闭不能卡住后续任务。

`contextTtlSeconds` 默认 600 秒、范围 60–86400 秒；显式已保存值保留。设置页“空闲多久后结束对话（分钟）”换算读写同一字段，支持非整分钟旧值。只有成功交付续期，无关键词弹幕、拒绝、失败和入队均不续期。任务开始读取时已过期则新建；已读到有效历史的在途任务跨过期后仍可完成，成功才重新续期。修改时长影响之后的成功交付，不追溯调整旧 expires_at。

带关键词的完整“结束对话”或“清空对话”（允许末尾标点）在同一队列中删除当前作用域，下一问新建 sessionId。确认文字不写历史，确认未送达也不恢复旧记忆，重试仅重发固定确认、不调用模型。原来的仅 UID/人格键不能可靠确定房间，不迁入新作用域，按原 TTL 清理。

回归见 [连续互动](../../../test/ai/ai-conversation-continuity.test.js)、[历史预算](../../../test/ai/ai-conversation-context.test.js)、[空闲维护](../../../test/ai/ai-runtime-cleanup.test.js)。

## 4. 模型客户端(API 与账号路由)

[deepseek-client.js](../../../src/ai/deepseek-client.js) 的 `createDeepSeekClient` 是唯一模型出口；端点与能力判定由 [model-endpoint.js](../../../src/ai/model-endpoint.js) 统一负责。API 模式请求经 [http-client.js](../../../src/ai/http-client.js) 的 `fetchJson`(任务取消 signal 与请求 timeout signal 合并、响应体 ≤ 2 MiB、错误码归一化)。联网搜索复用[共享响应体读取器](../../../src/shared/response-body.js)，RSS 也限制为 2 MiB；流式读取在保留 chunk 前累计字节数，超限取消上游且不把大正文放入诊断。读取器按倍数扩容单个缓冲区，容量不超过预算，避免微小分块保留大量对象；非流式测试替身在完整正文后作同样检查。关闭总开关保留 `AI_DISABLED`、应用关闭保留 `AI_SHUTDOWN` 取消原因，不误报普通上游超时。

### 4.1 协议选择

| `modelProvider` | 服务端固定基础地址                                        | 固定协议                                         |
| --------------- | --------------------------------------------------------- | ------------------------------------------------ |
| `deepseek`      | `https://api.deepseek.com`                                | Chat Completions                                 |
| `openai`        | `https://api.openai.com/v1`                               | Responses API                                    |
| `anthropic`     | `https://api.anthropic.com/v1`                            | Chat Completions（Anthropic 官方 OpenAI 兼容层） |
| `gemini`        | `https://generativelanguage.googleapis.com/v1beta/openai` | Chat Completions（Google 官方 OpenAI 兼容层）    |

`auto` 保留旧设置的地址识别；`custom` 允许手工编辑地址和协议。官方预设在服务端覆盖请求中的 URL/协议，因此前端解除禁用或直接调用配置 API 都不能改写官方目标。

| 协议                 | 条件                                                                                                                                                                | 请求体要点                                                                                                                                                                                                           | 出处                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Responses API**    | 完整 `/responses` 原样使用；显式选择时第三方根地址补 `/v1/responses`，DeepSeek 官方根地址补 `/responses`；`auto` 下无法安全判定为基础地址的完整自定义路径仍原样使用 | `{model, instructions, input, tools?, max_output_tokens(≥64), previous_response_id?}`；关闭推理附 `reasoning: {effort: 'none'}`，启用且强度非 `auto` 时附所选强度；DeepSeek 官方映射为 `low/high/max`                 | [model-endpoint.js](../../../src/ai/model-endpoint.js)、[deepseek-client.js:13-48](../../../src/ai/deepseek-client.js#L13-L48) |
| **Chat Completions** | 完整 `/chat/completions` 原样使用；显式选择或 `auto` 识别根地址、`/v1` 后补全；第三方根地址用 `/v1/chat/completions`，DeepSeek 官方根地址用 `/chat/completions`     | `{model, messages, max_tokens, stream: false}`；DeepSeek 官方发送 `thinking.enabled/disabled`，启用时把公共强度映射为 `reasoning_effort: low/high/max`；普通第三方 Chat 不发送这些专用字段；工具转 `tools`(function) | [model-endpoint.js](../../../src/ai/model-endpoint.js)、[deepseek-client.js:31-76](../../../src/ai/deepseek-client.js#L31-L76) |

`modelApiProtocol` 默认 `auto`，用于保持旧配置的 URL 自动识别行为。完整 `/responses` 或 `/chat/completions` 路径优先于选择器，避免把已明确的端点改写成另一种协议。无工具时，两种协议都不发送 `tools` 字段。联网能力也分协议：Responses 的 `web_search` 由上游托管，只受联网开关控制；Chat Completions 转为 LIRA 本地函数工具，须同时开启联网和 `functionCallingEnabled`，并要求模型支持 `tool_calls`。接口协议可承载工具不代表具体模型支持。

双协议的**回退行为**:Chat Completions 路径用内存 `chatHistory` Map(上限 100 条)以 `previousResponseId` 为键保存历史,续问时拼接 `messages` 并删除旧键([deepseek-client.js:130-134](../../../src/ai/deepseek-client.js#L130-L134)、[249-261](../../../src/ai/deepseek-client.js#L249-L261));Responses 路径用官方 `previous_response_id`。

### 4.2 响应归一化与错误

两个协议都归一为同一形状 `{id, text, functionCalls[], finishReason, usage{inputTokens, outputTokens}}`:

- Responses:`normalizeResponse` 遍历 `output[]` 的 `function_call` 与 `output_text` 内容,兼容顶层 `output_text`([deepseek-client.js:304-333](../../../src/ai/deepseek-client.js#L304-L333))。
- Chat Completions:`normalizeChatResponse` 取 `choices[0].message` 的 `tool_calls` 与 `content`([deepseek-client.js:205-232](../../../src/ai/deepseek-client.js#L205-L232))。
- 空响应:finishReason 为 `length`/`max_output_tokens` → `DEEPSEEK_OUTPUT_TRUNCATED`,否则 `DEEPSEEK_INVALID_RESPONSE`;工具参数 JSON 解析失败同样按截断处理([deepseek-client.js:99-104](../../../src/ai/deepseek-client.js#L99-L104)、[347-355](../../../src/ai/deepseek-client.js#L347-L355))。

辅助接口:`listModels` 根据配置地址推导同级 `/models`；第三方服务根地址默认使用 `/v1/models`，DeepSeek 官方根地址保持 `/models`，结果去重排序([146-163](../../../src/ai/deepseek-client.js#L146-L163));`testConnection`(发"你好"取 200 字回复,401/403/AUTH 类错误码 → `DEEPSEEK_AUTH_FAILED`,[165-203](../../../src/ai/deepseek-client.js#L165-L203))。

### 4.3 模型调用诊断

`sendModelRequest` 在成功时只提交一条 `request_succeeded` 元数据，包含 provider/model/purpose/protocol、HTTP 状态、耗时、token 数、finish reason 和工具调用数；不提交 URL、请求体、原始响应或标准化正文。失败在同一拥有上下文的 catch 边界提交一条 `request_failed`，保留相同关联元数据和安全错误核心；`AI_SHUTDOWN` / `AI_DISABLED` 取消不记普通故障。持久化前由 request-logger 汇总成功事件并再次做密钥替换与最终字节准入(§8)。

### 4.4 豆包个人账号（实验性）

`modelProvider: 'doubao'` 在统一模型入口转交 [doubao-client.js](../../../src/ai/doubao-client.js)，不经过 API Key HTTP 传输。`modelEndpoint` 返回 `protocol: 'account'`、`provider: 'doubao'`，联网与推理能力标为 `unsupported`。不要求 URL、API Key 或模型 ID，模型列表固定为 `doubao`；普通 Node 运行时没有桌面会话时返回 `DOUBAO_DESKTOP_REQUIRED`。

Electron 会话由 main 创建，经 [ai-runtime.js](../../../src/server/ai-runtime.js) 注入；账号与窗口契约见 [auth.md](../desktop/auth.md#16-豆包个人账号) 和 [windows.md](../desktop/windows.md#4-豆包账号与验证窗口)。service 用 UID、包含可信房间的人格作用域与本地 sessionId 组成内部 `conversationKey`，adapter 区分观众与连接测试作用域；普通问答缺少作用域则拒绝发送，不回落共享会话。owner 按作用域保存各自已确认的上游会话，同一观众/人格在有效期内复用，空闲达到 `contextTtlSeconds`（默认 10 分钟，已保存值保留）后按需新建，连接测试独立。首建、过期清理与更新均在串行队列内，ACK 成功后按本次配置续期；其他观众活动不会延长本人的会话。ID 只留内存，登录身份变化、退出或 owner 销毁时全部清除；验证码状态变化保留已确认 ID。重新启动或重新登录后按需新建，不删除已有网页聊天记录。

豆包普通问答仅一次生成请求，不再执行两次远程模型审核或创建审核会话；本地拦截的输入不调用豆包。`DOUBAO_CHAT_POLICY` 随当前预设一同发送，要求仅文字回复、拒绝不适合直播的内容与注入要求，并使用固定拒绝语。完整结果仍在本地检查后走原 FIFO 发送和送达确认，不做未检查的流式上屏。减少远程语义复核是首字速度要求下的明确取舍，预设或本地关键词不能保证不出现敏感内容。

首次请求显式传递 `need_create_conversation: true`、空上游 ID 和独立随机 local ID；不读取前台页面对话作为复用目标。首次 ACK 若返回本次请求前已知的会话 ID（含刚过期条目）或页面 `/chat/<数字ID>` 中可识别的当前对话，则拒绝该结果。复用时传递 `need_create_conversation: false`、`click_clear_context: true` 及该作用域最近的 `last_section_id`，要求 `SSE_ACK.ack_client_meta` 确认相同 conversation ID 和不同 section ID。只接受 1–64 位数字字符串，不从模型文字、任意 meta 或调用方的 `previousResponseId` 提取标识。成功文字缺少 ACK、ID 不一致或 section 未变化时返回 `DOUBAO_CONTEXT_UNCONFIRMED` 并全局阻塞请求，不因切换观众、连接测试或 TTL 到期而新建重试；请求已发送但结果不明（包括中止/超时未收到 ACK）也阻塞后续请求。明确的验证码拒绝允许人工验证后重试，保留已确认 ID；未首建的条目移除，验证后可首次建立。收到 ACK 后文字流不完整则保留新 section，下一次仍需确认新的 section；重启/重新登录才能清除不明状态。

观众追问由 LIRA 按可信房间、UID 与人格提供有界多轮已送达上下文（保留规则见 §3.3）；同一观众的上游会话每次仍重置 section，避免带入未送达或已拒绝的旧答案。每次请求将当前 instructions 和文字 input 分别放在 JSON 的 `instructions`、`data`，上游可能保留这些记录。该文本格式不构成权限隔离；豆包不会收到其他供应商密钥、LIRA 函数工具或调用方指定的上游会话 ID，回复仅作为文字。观众作用域、过期、页面对话误指及 ACK 检查已做合成验证；ACK 是请求发出后的确认，拒绝结果不能撤销上游已接受的写入。真实服务新建/历史隔离及用户报告的私人对话问题仍待更新客户端后的账号验收，见 [实施计划](../../../specs/plans/2026-10-13-doubao-conversation-isolation.md)。

SSE 解析保留文字块的初始内容与增量片段，忽略思考、语音等块，要求完整结束标记及非空回复；响应统一为既有形状，`functionCalls` 为空，未提供的 token 用量记 0。请求串行执行、响应体上限 2 MiB、超时 3–60 秒。`710022004` 映射为 `DOUBAO_VERIFICATION_REQUIRED` 并暂停普通请求；用户在官网窗口验证后，显式点击「测试 AI 连接」探测成功才清除暂停，测试文本为「请只回复：连接成功」。不自动重试验证码，不保证无人值守。

`needsVerification` 表示接入收到验证拒绝，不保证官方页面正在显示验证码。`openLogin` 仅显示同一分区的官方页面；后台 SSE 错误不自动生成官网验证对话框。官网普通聊天成功与 LIRA adapter 恢复是两个结果，只有正常连接测试成功才能清除暂停；未显示验证码或仍被拒绝时不自动清标志、重试或更换会话。

首字耗时 `firstTextMs` 只在收到首个非空正文 SSE 事件时记录（包括初始块、CHUNK_DELTA 或 STREAM_CHUNK，不计 ACK、心跳、思考或未收完整的帧）。页面使用单调时钟，owner 加上本次请求的队列/窗口准备耗时；记录范围从会话请求入队到首段正文可解析，不是直播间显示耗时。无首字时不记为 0；完整成功后写入现有请求日志汇总。约 1 秒首字仍是待实测目标，不能用合成流的时间当作豆包性能证明。

准入同时检查桌面可用、已登录和无需验证；豆包生成并发固定为 1。任务和缓存键保留会话代次，登录变化、退出或验证状态变化后的旧结果不得投递；切换进入/离开豆包取消旧供应商任务。`GET /api/ai/status` 附带公开 `doubao` 状态，端点合同见 [api.md](api.md#13-ai-域ai)。日志只写供应商、用途、耗时及安全错误等元数据，不写 Cookie、原始 SSE 或对话正文。

配置保留原 API 设置。进入账号模式时，`ai_configuration` 的私有 `doubaoPreviousKeyOrigin` 行暂存原密钥的有效 origin（非秘密），既不通过配置 API 暴露也不接受客户端写入；退出账号模式仍校验原密钥不可跨 origin 复用，成功后清空该行。账号模式下临时获取其他 API 的模型列表必须显式提供 Key，或先保存切回原供应商；不能将隐藏的旧自定义地址视为现有密钥的来源。此行为不修改表结构。

## 5. 工具集

`buildTools(config)`（[prompt.js](../../../src/ai/prompt.js)）默认返回空数组。`functionCallingEnabled` 是 LIRA 函数工具的总开关；天气须再开启 `weatherEnabled` 并有和风 Host/Key，地点和路线须分别开启 `placesEnabled/routesEnabled` 并有高德 Host/Key。地理编码随地点或路线启用。联网规则见 §4.1；`FUNCTION_TOOLS` 包含以下四个天气/地图函数。

| 工具名             | 提供者            | 上游接口/行为                                                                                                                                                                                    | 出处                                                                                                                      |
| ------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `get_weather`      | 和风天气 qweather | 地点先走 `/geo/v2/city/lookup`(取前 5,重名跨省返回 `ambiguous` 候选);`date` 非 today/now 时 `/v7/weather/3d` 预报,否则 `/v7/weather/now`;`air`/`warning` 分别走 `/v7/air/now`、`/v7/warning/now` | [qweather-tool.js:10-63](../../../src/ai/tools/qweather-tool.js#L10-L63)                                                  |
| `search_places`    | 高德 amap         | `/v3/place/text`(city/district/location 可选,offset 5,extensions=base),取前 5 POI                                                                                                                | [amap-tool.js:37-49](../../../src/ai/tools/amap-tool.js#L37-L49)                                                          |
| `resolve_location` | 高德 amap         | `/v3/geocode/geo` 解析地址 → `{formattedAddress, province, city, district, adcode, location}`;多结果标记 `ambiguous`                                                                             | [amap-tool.js:27-35](../../../src/ai/tools/amap-tool.js#L27-L35)                                                          |
| `get_route`        | 高德 amap         | 起终点经 `ensureCoordinate` 统一为坐标;`transit` → `/v3/direction/transit/integrated`,其余 `/v3/direction/<mode>`;结果取第一条 `paths[0]`/`transits[0]` 的距离与时长                             | [amap-tool.js:51-62](../../../src/ai/tools/amap-tool.js#L51-L62)、[104-113](../../../src/ai/tools/amap-tool.js#L104-L113) |
| `web_search`       | Bing RSS          | `https://www.bing.com/search?format=rss&q=…`(查询 ≤ 200 字符),解析 `<item>` 前 5 条为 `{title, snippet, url}`;空结果 → `WEB_SEARCH_EMPTY`                                                        | [web-search-tool.js:5-41](../../../src/ai/tools/web-search-tool.js#L5-L41)                                                |


**工具调用回路**：执行前同时核对请求配置快照与最新保存配置，未启用、缺凭据或被撤销的函数返回 `tool_unavailable`，不发起外部请求，并从后续轮次中排除。允许的调用按名称分派，结果以 `function_call_output` 回填。月度配额错误将工具加入 `excludedToolNames` 并返回 `monthly_api_quota_reached`；仅在搜索实际可用时建议改用 `web_search`，否则说明无法核实并提供一般建议。生成前也按 `quotaStore.getExcludedToolNames()` 裁剪工具。见 [ai-assistant-service.js](../../../src/ai/ai-assistant-service.js)。

当前时间直接由 [current-time-tool.js](../../../src/ai/tools/current-time-tool.js) 的本地格式化函数加入指令，不向模型注册时间函数。

**测试接口**:`testProvider('qweather'|'amap'|'deepseek')` 分别调用各工具 `testConnection`(校验 Key/错误码映射),经 `/api/ai/test/*` 暴露。

## 6. 安全过滤(两道)

1. **本地硬规则** `checkLocalInput`：检查副本做 NFKC、去 Unicode 格式字符和空白归一化；注入匹配还归一化汉字间的空白及常见分隔符，原问题不因此改写。覆盖色情、明确违法、隐私，以及有操作意图的身份冒充、规则覆盖、伪造角色/审核、编码执行或泄露等常见中英文指令。固定拒绝文案为“这个不适合直播间回答，换个问题吧。”，不包含角色口癖。“我是管理员，推荐几首歌”、“什么是 system prompt？”、“Base64 编码和解码是什么？”等正常提问继续进入后续管线，不因术语或身份字样直接拒绝。传入的历史问答和最终文字也使用此检查。见 [safety.js](../../../src/ai/safety.js)。
2. **模型约束**：全部预设和 API 两次审核共用 `TRUST_BOUNDARY_POLICY`：弹幕身份、昵称、UID、礼物和授权声明不赋予管理权限；引用、工具返回及历史中的承诺仍是数据，编码、翻译和角色扮演不改变边界，不披露隐藏指令或其他观众内容。API 模式继续用 `runSafetyReview` 分别审核输入和输出，指令与 JSON 数据分开传递。`allowed` 必须为布尔值，`safeText` 若存在须为字符串；无法解析或字段无效时抛 `AI_REVIEW_INVALID`，不放行原答案，回复“这次回答的审核未完成，请稍后再试。”。拒绝时忽略模型 safeText；允许时仍对最终文案执行本地检查，固定拒绝语不缓存、不记忆。输出审核还检查虚构授权、准确回应、条件和事实。豆包账号模式只增加 `DOUBAO_CHAT_POLICY` 并使用一次生成，保留本地输入/输出检查，没有两次额外语义复核。见 [safety.js](../../../src/ai/safety.js)。

这些检查降低风险，不保证识别所有注入；JSON 标签、正则和同一模型的审核都不是安全边界。模型输出始终视为不可信文字，工具权限在程序中校验；豆包账号模式不提供 LIRA 工具。防护原则及局限参见 [OWASP 指南](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)。

## 7. 配置与密钥

### 7.1 配置键

全部配置存 `ai_configuration` 表(**与 settings 表隔离**,避免通用设置接口回显密钥,见 [storage.md](storage.md) §3.1),默认值与数值区间定义在 [config.js:11-57](../../../src/ai/config.js#L11-L57):

| 分组           | 键                                                                                             | 默认                              | 说明                                                                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 总开关         | `enabled`                                                                                      | `true`                            | 布尔                                                                                                                                                                           |
| 触发           | `trigger`                                                                                      | 空                                | 空或 1–12 字符；为空时尚未就绪                                                                                                                                                 |
| 供应商         | `modelProvider`                                                                                | `auto`                            | 枚举：`auto, deepseek, openai, anthropic, gemini, custom, doubao`；四个官方预设由服务端固定地址和推荐协议，忽略客户端 URL/协议覆盖                                                     |
| 模型服务       | `deepseekResponsesUrl` / `deepseekApiKey` / `model`                                            | 全空                              | URL 须为无账号信息的 HTTP(S)，可为服务根地址、`/v1` 基础地址或完整模型端点；model 为空或 ≤ 80 字符                                                                             |
| 协议与推理强度 | `modelApiProtocol` / `reasoningEffort`                                                         | `auto` / `auto`                   | 协议枚举:`auto, responses, chat_completions`；强度枚举:`auto, minimal, low, medium, high, xhigh, max`；DeepSeek 官方把 `minimal→low`、`medium/high/xhigh→high`，保留 `low/max` |
| 行为开关 | `webSearchEnabled` / `functionCallingEnabled` / `reasoningEnabled` / `weatherEnabled` / `placesEnabled` / `routesEnabled` | 全为 `false` | 新配置默认普通问答；工具和联网按 §5 显式启用，关闭总开关保留各工具配置 |
| 第三方凭证     | `qweatherApiHost` / `qweatherApiKey` / `amapApiHost` / `amapApiKey`                            | 全空                              | Host 缺协议自动补 `https://`                                                                                                                                                   |
| 兼容数值       | `replyMaxChars` | 50 | 保留 10–50 校验供旧调用方读写，界面不展示，运行时不采用此偏好 |
| 数值           | `generationConcurrency`                                                                        | 3                                 | 生成并发,1–5                                                                                                                                                                   |
| 数值           | `queueLimit`                                                                                   | 30                                | 排队上限,1–100                                                                                                                                                                 |
| 数值           | `sendIntervalMs`                                                                               | 3000                              | **仅作默认值存在,运行时未使用**(实际节奏见 §9 随机间隔)                                                                                                                        |
| 数值           | `userCooldownSeconds`                                                                          | 0                                 | 用户冷却,0–3600                                                                                                                                                                |
| 数值           | `roomLimitPerMinute`                                                                           | 20                                | 全房间限速,1–120                                                                                                                                                               |
| 数值           | `requestTimeoutMs`                                                                             | 12000                             | 上游超时,3000–60000                                                                                                                                                            |
| 数值           | `maxToolCalls`                                                                                 | 6                                 | 单轮最多工具调用,1–8                                                                                                                                                           |
| 数值           | `cacheTtlSeconds` / `contextTtlSeconds`                                                        | 60 / 600                         | 查询缓存 / 观众上下文 TTL,0–3600 / 60–86400                                                                                                                                    |
| 角色 | `personaId` / `personaPacks` / `systemPrompt` | `general` / `[]` / 通用助手文本 | 当前角色、最多 20 个自建或导入包、自定义角色草稿（20–8000 字符）；完整格式与兼容规则见 §7.3 |

`normalizeAiConfig`([config.js:59-92](../../../src/ai/config.js#L59-L92))负责白名单过滤、布尔/数值归一化与越界抛错(400)。

### 7.2 密钥加密与访问控制

| 事实         | 值                                                                                                                                                                                                                                                                            | 出处                                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 密钥键集合   | `AI_SECRET_KEYS = {deepseekApiKey, qweatherApiKey, amapApiKey}`                                                                                                                                                                                                               | [config.js:5-9](../../../src/ai/config.js#L5-L9)                                                                                                                        |
| 存储标记     | 密钥以 `is_secret=1` 存 `ai_configuration`,写入时 `secretCodec.encrypt`                                                                                                                                                                                                       | [config-store.js:49-78](../../../src/ai/config-store.js#L49-L78)                                                                                                        |
| 加密实现     | `createElectronSecretCodec` 包装 Electron `safeStorage`(`isEncryptionAvailable()` 为真才可加密),值经 `encryptString` 后 Base64 落库;**刻意不提供明文回退**;非 Electron 独立模式 `isAvailable()` 为 false,写入密钥直接抛错"当前系统无法安全加密 API Key"                       | [secret-codec.js:3-31](../../../src/ai/secret-codec.js#L3-L31)                                                                                                          |
| 读取降级     | 解密失败时该键置空并 `console.warn`(日志脱敏),不阻断其他配置读取                                                                                                                                                                                                              | [config-store.js:20-25](../../../src/ai/config-store.js#L20-L25)                                                                                                        |
| 公开视图边界 | `getPublicConfig` 过滤 `AI_SECRET_KEYS` 全部密钥字段及原始 `personaPacks`，改为返回含内置和已保存角色的 `personas` 列表,替换为 `hasDeepSeekApiKey/hasQWeatherApiKey/hasAmapApiKey`、`secretEncryptionAvailable` 与无密钥 `modelEndpoint {protocol, provider, webSearchMode, reasoningMode}`；`updateConfig` 返回相同公开视图 | [config-store.js](../../../src/ai/config-store.js)                                                                                                                      |
| 前端遮罩     | 管理页密钥输入框类型为 `password`;已保存密钥不回填到真实 `value`（输入框保持为空，避免把掩码误当成新密钥提交）;提交时空值跳过该字段(保留现值);提示文案:"已加密保存；清空或输入新值以更新"                                                                                     | [ai-assistant-settings.js:266-286](../../../public/js/admin/ai-assistant-settings.js#L266-L286)、[256-264](../../../public/js/admin/ai-assistant-settings.js#L256-L264) |

管理端编辑经 `/api/ai/config`(`PUT`,密钥传 `''` 跳过、传 `null` 置空,见 [api.md](api.md) §13);连接测试/模型列表端点:`/api/ai/status`、`/api/ai/models`、`/api/ai/test`、`/api/ai/test/{deepseek,qweather,amap}`。

模型密钥的隐式复用受有效 origin（协议、主机、端口）约束。`config-store.updateConfig` 在事务提交前读取将要持久化的有效配置，跨 origin 时要求显式提供或清空 `deepseekApiKey`，否则回滚整次修改；从官方预设切回先前自定义地址也经过此校验。`ai-assistant-service.listModels` 在上游请求前执行同一检查，临时更换目标只能使用明确提供的 Key。同 origin 的路径或协议选择仍可调整；官方预设先确定真实目标，不用被忽略的地址判断。连接测试和正常生成继续读取受校验的配置。此约束不改变和风、高德各自的凭据模型。回归：`test/ai/ai-model-key-origin.test.js`。

### 7.3 角色包与兼容读取

[personas.js](../../../src/ai/personas.js) 拥有纯数据角色包；不加载代码或脚本。格式如下：

```json
{
  "format": "lira-ai-persona",
  "version": 1,
  "id": "quiet-friend",
  "name": "安静的朋友",
  "description": "自然简洁地交流",
  "prompt": "你是友善的直播间朋友，认真回答问题，先给出结论，不使用固定的口头禅。"
}
```

只接受上述字段；format/version 必须匹配；ID 为小写字母开头的 1–64 个小写字母、数字或连字符；名称 1–40、说明 0–200（可省略）、人设 20–8000 个字符，文本 trim 后校验。库最多保存 20 个包，超过上限、格式错误或重复 ID 均不写入。名称可重复，ID 不可重复。导入保留包 ID；内置 general/cat 和 custom 导出后再导入会以 imported- 前缀作为独立副本。创建接口生成 role-UUID 标识。删除当前自建或导入包恢复 general；内置包不可删除。

配置公开视图的 personas 包含 id/name/description/prompt/builtin，自建或导入条目另含 format/version。角色包导出严格白名单，不含 API 配置、凭据、运行限制或聊天记录。管理路由见 [api.md](api.md) §13，均沿用管理端授权。界面导入文件最多 64 KiB。

`builtinPersonaOverrides` 默认为空数组，与其他 AI 配置一同持久化；仅接受 general/cat 的完整角色包条目，ID 不重复且内置名称固定。公开配置不单独暴露该数组，而在 personas 中合并修改（修改过的内置条目也可能含 format/version）。更新接口原位保存包的名称、简介和角色指南；内置只改简介与指南、不能增删改名，恢复默认删除对应覆盖条目。编辑面板草稿显式保存，取消不写入；删除预设与恢复默认先确认覆盖范围，取消确认保留编辑内容，普通取消/Esc 不追加确认。主页面只选择带风格简介的预设。新建/导入会选中新角色，更新/恢复不改变当前选择。

已有配置但未保存 personaId 时，有 systemPrompt 就完整保留为 custom，否则保留 cat；不再模糊识别并覆盖旧人设。旧工具开关显式值保持，缺失时按旧版 true 默认读取（包括函数总开关），首次更新会保存这些迁移值。新配置仍全部默认关闭。仅更新 systemPrompt 的旧调用者自动选择 custom；切换角色不会覆盖自定义草稿。

公开视图的 `hasCustomPersona` 在当前选中 custom 或 systemPrompt 不同于通用默认模板时为 true，确保切走之后仍可重新选回原有自定义角色；新配置只列出两个内置预设。

上下文以可信房间、观众 UID 和角色 ID/解析名字后的人设内容的组合作为作用域；换房间、角色、编辑人设或改变模板中的名字不会读到另一身份的记忆。缺少房间或 UID 时不读写持久记忆，昵称仅用于提及和限流。触发关键词兼作机器人名字，默认空；启用、关键词、模型及凭据就绪后才处理弹幕。存储方式见 [storage.md](storage.md) §3.1。

## 8. 月度配额与审计日志

### 8.1 第三方 API 月度配额(api-quota-store)

按**北京时间月份**计数的本机请求次数上限，用于限制第三方调用；它是保守的安全预算，不是供应商账单统计。计数落 `ai_api_usage` 表 `PK(category, month_key)`:

| category      | 月度上限 | 覆盖工具                        | 触顶错误码                  |
| ------------- | -------- | ------------------------------- | --------------------------- |
| `qweather`    | 40 000   | `get_weather`                   | `QWEATHER_MONTHLY_LIMIT`    |
| `amap_search` | 4 000    | `search_places`                 | `AMAP_SEARCH_MONTHLY_LIMIT` |
| `amap_lbs`    | 120 000  | `resolve_location`、`get_route` | `AMAP_LBS_MONTHLY_LIMIT`    |

[api-quota-store.js:3-19](../../../src/ai/api-quota-store.js#L3-L19)

计数与判定原子化:`INSERT … ON CONFLICT(category, month_key) DO UPDATE … WHERE request_count < limit RETURNING request_count`，返回空行即触顶拒绝。月份键 `getBeijingMonthKey` = UTC+8 后截取 `YYYY-MM`。天气和地图工具在本地配置检查及 `throwIfAborted` 通过后，经 [api-quota-store.js](../../../src/ai/api-quota-store.js) 的 `withApiQuota` 消费并提交一次额度，再立即发起请求。成功、超时、网络错误、上游拒绝、发起后取消和结果解析/归一化失败均保留计数；连接测试也计入，每个上游子请求分别计数。发送前已取消、缺少配置或额度耗尽的调用不发请求、不消费额度。

配额 store 在初始化及跨月读取/消费时回收上上月及更早的计数，仅保留北京当月和上月（供跨月未提交预留撤销）；系统时钟回退时不删未来月份，避免重新放开已经用完的预算。该清理属于配额自身的生命周期，与请求审计的保留天数无关。SQL 读写与原子额度占用由 [ai-api-usage-store.js](../../../src/storage/ai-api-usage-store.js) 拥有；AI 域保留月份、类别上限与工具错误规则。

该规则参考 [express-rate-limit 默认计入失败请求](https://express-rate-limit.mintlify.app/reference/configuration#skipfailedrequests) 的预算方式，于 2026-10-11 按用户授权实施；它不推断供应商是否收费。例如[和风天气](https://dev.qweather.com/help/)声明非 2xx 不统计请求，实际用量与费用仍以供应商为准。保留既有月度计数，历史已退回的失败请求不补记；`requireApiQuota` 和显式预留/撤销辅助保留兼容，天气/地图工具不会因请求失败调用撤销。模型调用本身不计入这三类配额。回归见 [ai-api-quota-store.test.js](../../../test/ai/ai-api-quota-store.test.js) 和 [ai-tools.test.js](../../../test/ai/ai-tools.test.js)。

### 8.2 请求诊断摘要(request-logger)

- **文件**:`buildAiRuntime` 将数据目录父级的 `logs/` 作为根，正常摘要写 `logs/runtime/ai.jsonl`，错误核心写 `logs/errors/ai.jsonl`；只在真实摘要或错误出现时写入。正常文件 1 MiB/3 天、错误文件 3 MiB/14 天，各保留活动文件及两份归档，先到达容量或时间限制即淘汰旧记录。桌面维护从旧 `logs/ai.log` 提取仍有效的错误核心后清理旧记录；直接构造 logger 并只传 `filePath` 时保留单文件兼容模式。统一维护机制见[桌面日志](../desktop/main.md#8-日志)。
- **正常摘要**:`request_succeeded` 按 provider/model/purpose/protocol 在 15 分钟活动窗口汇总，最多 128 个分组，超出归入 `other`；记录成功/失败数、token、工具调用数、最大耗时和固定耗时桶。有效的数值 `firstTextMs` 另外汇总为可选 `firstText: {count, maxMs, buckets}`，桶沿用 ≤250、≤1000、≤5000、≤15000、>15000 ms；不接受字符串、负数、非有限值，也不把缺失值当作 0。其他供应商未提供该值时摘要形状不变。退出 `flush()` 保存尚未到期的非空窗口，不输出空摘要。
- **错误与准入**:`request_failed` 保存安全错误核心，已知密钥全文替换；普通 JSONL 最终 UTF-8 最多 2 KiB，错误最多 16 KiB。每分钟最多 120 条错误，相同 provider/model/purpose/错误核心最多 5 条；失败总数仍计入活动摘要，抑制数量由 `getHealth().suppressedErrorEntries` 及下一窗口的错误记录报告。待写队列最多 2,000 条/4 MiB并给错误预留空间，串行写入复用共享轮转器；队列溢出、写入失败均计数，不抛入业务流程。

**数据库审计**:`ai_request_logs` 表由 `store.logRequest` 写入 `uid/user_name/category/status/latency_ms/input_tokens/output_tokens/tool_calls/error_code`(各字段截断上限见 [config-store.js:80-93](../../../src/ai/config-store.js#L80-L93));`category` 取 `cache/safety/tool/chat/failure`(生成)与 `delivery/generation`(失败),`status` 取 `generated/failed`。审计默认保留 30 天，由 `aiRequestLogRetentionDays` 配置（`0` 禁用），支持 dry-run 和实际删除计数；该保留策略不删除 `ai_api_usage` 配额、配置或黑名单。全部清库范围另见 [storage.md](storage.md) §5–§6。

## 9. 弹幕交付与送达验证

### 9.1 发送节奏

`deliverReply`([ai-assistant-service.js:220-254](../../../src/ai/ai-assistant-service.js#L220-L254)):

| 事实     | 值                                                                                                                                 | 出处                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 回复间隔 | 距上次发送 500–2000 ms 随机(不足则等待)                                                                                            | [ai-assistant-service.js:18-19](../../../src/ai/ai-assistant-service.js#L18-L19)、[296-302](../../../src/ai/ai-assistant-service.js#L296-L302) |
| 分段间隔 | 每条分块 200–600 ms 随机,`intervalMs`                                                                                              | [ai-assistant-service.js:20-21](../../../src/ai/ai-assistant-service.js#L20-L21)、[233-239](../../../src/ai/ai-assistant-service.js#L233-L239) |
| 发送参数 | `mentionEveryChunk: true`(每段都带 @用户名)、`rateLimitIntervalMs: 0`(绕过发送器全局限速,由 AI 自行控速)、`waitForRateLimit: true` | [server.js:260](../../../src/server.js#L260)、[ai-assistant-service.js:233-239](../../../src/ai/ai-assistant-service.js#L233-L239)             |

### 9.2 送达验证(danmaku-delivery-verifier)

AI 任务通过准入后，由 [bilibili-runtime.js](../../../src/server/bilibili-runtime.js) 捕获当前房间、监听代次、认证 provider、账号操作代次和当前 UID。身份读取只发生于已接受的 AI 任务；读取失败按会话失效处理。生成、排队、限流等待、分段发送、送达确认与重试均检查同一会话；切房、退出或账号操作使旧任务取消，不写入成功对话上下文，也不记普通交付失败。新任务重新捕获当前身份，账号切换后不依赖旧 authCache 的 UID。发送前刷新身份，已发出的请求无法撤回，但后续分段和重试会停止。手动发送保持原有行为。回归见 [ai-assistant-session.test.js](../../../test/ai/ai-assistant-session.test.js) 和 [danmaku-sender-session.test.js](../../../test/danmaku/danmaku-sender-session.test.js)。

直播间每条入站弹幕都经 `aiDanmakuDeliveryVerifier.observe(danmaku)` 缓冲([server.js:614](../../../src/server.js#L614))。`waitForDelivery`([danmaku-delivery-verifier.js:22-42](../../../src/ai/danmaku-delivery-verifier.js#L22-L42))等待本次发送的**全部消息**在房间弹幕流中出现:

- 匹配规则:同账号 uid、`observedAt >= sentAfter` 的弹幕,按内容逐条消费(去重已匹配项);带 `@用户名 ` 前缀时剥前缀后比对,兼容弹幕平台对 @ 的处理([danmaku-delivery-verifier.js:44-67](../../../src/ai/danmaku-delivery-verifier.js#L44-L67))。
- 超时:`DELIVERY_CONFIRM_TIMEOUT_MS = 10000`;事件缓冲 TTL 60 秒防泄漏([danmaku-delivery-verifier.js:5-6](../../../src/ai/danmaku-delivery-verifier.js#L5-L6))。
- **重试**:未确认送达时最多尝试 3 次，含首次发送，即最多重试 2 次（[ai-assistant-service.js](../../../src/ai/ai-assistant-service.js) 的 `MAX_DELIVERY_ATTEMPTS` / `deliverReply`）。重试前**重新生成**回复（`bypassCache: true`，避免原内容再次被吞）；三次均未确认送达则抛 `DANMAKU_SWALLOWED` 并记 `delivery` 失败日志。发送本身抛错时直接进入协调器失败处理，不属于此未确认送达的重试循环。
- **关闭**:`waitForDelivery` 接受本轮任务与 shutdown 合并的 signal；总开关关闭立即以 `false` 释放该轮 waiter，不销毁共用验证器。`dispose()` 幂等清除全部 pending timer 并以 `false` 释放 waiter。两类取消均不触发重新生成/重试或普通 delivery 失败审计。

### 9.3 失败回复文案

`failureReply`([ai-assistant-service.js:385-395](../../../src/ai/ai-assistant-service.js#L385-L395))按错误码前缀(UPSTREAM_TIMEOUT / WEB_SEARCH_ / QWEATHER_ / AMAP_ / AI_NOT_CONFIGURED 等)映射为人话弹幕;未识别错误统一"这次查询没完成，换个问法或稍后再试～"。`getStatus` 暴露 `lastError`(截断 160 字符)供管理页诊断。

## 10. 持久化与故障行为

| 表                  | 用途                          | 出处(DDL 见 storage.md §3.1)                                           |
| ------------------- | ----------------------------- | ---------------------------------------------------------------------- |
| `ai_configuration`  | 配置 + 密钥(is_secret)        | [config-store.js:49-78](../../../src/ai/config-store.js#L49-L78)       |
| `ai_request_logs`   | 请求审计                      | [config-store.js:80-93](../../../src/ai/config-store.js#L80-L93)       |
| `ai_api_usage`      | 月度配额计数                  | [ai-api-usage-store.js](../../../src/storage/ai-api-usage-store.js)、[api-quota-store.js](../../../src/ai/api-quota-store.js) |
| `ai_viewer_context` | 观众/角色上下文(uid 列保存作用域摘要,expires_at) | [config-store.js:114-129](../../../src/ai/config-store.js#L114-L129)   |
| `ai_query_cache`    | 查询缓存(cache_key = sha256)  | [config-store.js:131-148](../../../src/ai/config-store.js#L131-L148)   |
| `ai_blacklist`      | 黑名单(uid PK,reason)         | [config-store.js:100-112](../../../src/ai/config-store.js#L100-L112)   |

上下文和查询缓存由 [config-store.js](../../../src/ai/config-store.js) 在初始化、命中过期读取及写入时按需删除 `expires_at <= now()` 的行；写入清理间隔至少 60 秒，检测时钟回退则立即检查。[ai-runtime.js](../../../src/server/ai-runtime.js) 另每 60 秒调用同一清理方法，因此无人继续发言也会回收过期本机记录；定时器 unref，shutdown 开始时同步取消，再等待任务结束。逻辑过期立即生效，物理清理最多晚一个周期；配置、黑名单、月度配额、审计及豆包网页记录均不在此清理范围。

故障行为(全部按实现):

| 故障              | 行为                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 上游超时/不可用   | `fetchJson` 归一化为 `UPSTREAM_TIMEOUT` / `UPSTREAM_UNAVAILABLE`,回复文案见 §9.3;失败已入日志                                                                                                                                                                                                                                 |
| 第三方配额触顶    | 工具调用失败 → 该工具当次会话停用，按实际可用能力建议搜索或说明无法核实(§5);配额按月自动重置                                                                                                                                                                                                                                                  |
| 模型空回复/截断   | `DEEPSEEK_OUTPUT_TRUNCATED` / `DEEPSEEK_INVALID_RESPONSE` 按失败文案回复                                                                                                                                                                                                                                                      |
| 弹幕被吞(风控等)  | 送达验证 10 秒超时 → 重新生成后重发,最多 3 次;仍失败记 `delivery` 失败                                                                                                                                                                                                                                                        |
| 密钥缺失/不可加密 | 独立模式写入密钥抛错(§7.2);未配置时 `handleDanmaku` 直接 `disabled_or_unconfigured`                                                                                                                                                                                                                                           |
| 服务关闭          | `aiRuntime.shutdown()` 单飞:停止准入并触发 `AI_SHUTDOWN`，丢弃未开始任务，等待 active generation/current delivery/direct provider 操作；取消后不再发送/重试或写 context/cache/audit，最后 dispose delivery verifier 并 flush `ai.log`。已开始的外部弹幕发送只能等待完成，不能撤回。见 [server-core.md](server-core.md) §6.2。 |
