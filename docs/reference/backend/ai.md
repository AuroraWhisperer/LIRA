# AI 互动助手集成

> 涉及文件：[src/ai/config.js](../../../src/ai/config.js)、[src/ai/config-store.js](../../../src/ai/config-store.js)、[src/storage/ai-state-store.js](../../../src/storage/ai-state-store.js)、[src/ai/model-endpoint.js](../../../src/ai/model-endpoint.js)、[src/ai/secret-codec.js](../../../src/ai/secret-codec.js)、[src/ai/model-client.js](../../../src/ai/model-client.js)、[src/ai/http-client.js](../../../src/ai/http-client.js)、[src/ai/prompt.js](../../../src/ai/prompt.js)、[src/ai/personas.js](../../../src/ai/personas.js)、[src/ai/safety.js](../../../src/ai/safety.js)、[src/ai/ai-assistant-service.js](../../../src/ai/ai-assistant-service.js)、[src/ai/ai-assistant-helpers.js](../../../src/ai/ai-assistant-helpers.js)、[src/ai/async-coordinator.js](../../../src/ai/async-coordinator.js)、[src/ai/danmaku-delivery-verifier.js](../../../src/ai/danmaku-delivery-verifier.js)、[src/ai/api-quota-store.js](../../../src/ai/api-quota-store.js)、[src/ai/request-logger.js](../../../src/ai/request-logger.js)、[src/ai/tools/qweather-tool.js](../../../src/ai/tools/qweather-tool.js)、[src/ai/tools/amap-tool.js](../../../src/ai/tools/amap-tool.js)、[src/ai/tools/web-search-tool.js](../../../src/ai/tools/web-search-tool.js)、[src/ai/tools/current-time-tool.js](../../../src/ai/tools/current-time-tool.js)

本文档描述“AI 弹幕姬”领域模块（`src/ai/`）的完整实现。HTTP 端点清单见 [api.md](api.md) §13，AI 相关表结构与设置见 [storage.md](storage.md) §3.1，弹幕触发链见 [bilibili/danmaku.md](bilibili/danmaku.md)，进程装配与关闭时序见 [server-core.md](server-core.md) §5–§6。

**内部模块边界：**

- `ai-assistant-service.js`：负责定向问答与自动接话两种入口的准入、排队、取消、回复投递，以及送达确认后的会话记忆写入。
- [ai-reply-generator.js](../../../src/ai/ai-reply-generator.js)：负责每轮的人格选择、上下文快照、会话 ID 与内容审核；定向问答额外负责缓存、工具调用及弹幕被吞后的同轮次重生成。它直接返回待写入的记忆数据，不修改 service 的任务对象。
- [auto-reply-controller.js](../../../src/ai/auto-reply-controller.js)：仅维护自动接话的公开消息窗口、候选队列、计时器与提交前时效检查。
- [auto-reply-prompt.js](../../../src/ai/auto-reply-prompt.js)：定义自动接话的任务提示、审核提示与动作解析，不自建模型客户端或发送器。
- `ai-assistant-helpers.js`：提供提示构造与回复归一化的纯函数，不读配置、不调模型或工具、不发弹幕。
- [conversation-context.js](../../../src/ai/conversation-context.js)：负责有界多轮对话历史的规范化与追加。

[model-protocol.js](../../../src/ai/model-protocol.js) 统一封装 Responses 与 Chat Completions 的请求组装、工具及厂商推理参数转换、响应归一化，仅由模型入口和 ChatGPT 客户端单向调用，自身无网络或缓存状态。`model-client.js` 负责账号路由、HTTP 请求、日志记录、连通性检查以及 Chat Completions 工具调用历史的生命周期管理。

## 1. 概览与触发链

AI 弹幕姬由模型服务驱动；新配置默认使用通用助手，小猫等角色包仅改变身份与语气。定向问答与默认关闭的自动接话共用当前模型、凭据、接入方式和人格；普通问答不依赖天气或地图服务。[server/bilibili-client.js](../../../src/server/bilibili-client.js) 的 `onMessage` 先发布弹幕并交给 `aiDanmakuDeliveryVerifier.observe(danmaku)`（投递验证，见 §9），再处理小游戏与本地命令。命令结果为 `cloud-owned` 时提前返回；其余消息调用 `aiAssistant.handleDanmaku`，除房间、消息、用户身份外，还传入 `source` / `messageTimestamp` / `sessionKey` / `isSessionCurrent` / `autoReplyExcluded` / `captureReplySession`。消息时间与来源用于自动接话准入判断；轻量会话标识用于检测换房、换账号或监听重建，不能替代发送鉴权。`server.js` 仅负责将 AI runtime 接入该消息入口。

| 事实 | 值 | 出处 |
| --- | --- | --- |
| 角色人格 | `personas.js` 提供 `general`（通用）、`cat`（温软好奇的小猫娘）、`whale`（童真温和的鲸鱼娘）；后两者针对 DeepSeek 调整与验证。`custom` 读取 `systemPrompt`，自建或导入包按 ID 选择；`{{name}}` 在生成时替换为 `trigger`，编辑/导出保留模板；角色语气不写入公共底层规则 | [personas.js](../../../src/ai/personas.js)、[prompt.js](../../../src/ai/prompt.js) |
| 模型后端 | 供应商可选自动识别、DeepSeek、Kimi、OpenAI、Claude、Gemini、豆包账号或自定义；OpenAI 支持 API 与 ChatGPT 订阅两种接入；Claude/Gemini 复用各自官方 OpenAI 兼容入口，不引入原生协议适配器 | [config.js](../../../src/ai/config.js)、[model-endpoint.js](../../../src/ai/model-endpoint.js) |
| 触发关键词 | 配置键 `trigger`，默认空字符串，1–12 字符；配置后消息中出现即触发 | [config.js](../../../src/ai/config.js)、[ai-assistant-service.js](../../../src/ai/ai-assistant-service.js) |
| 就绪条件 | `isAiReady`：`enabled` 为真且 `trigger` 非空；API 模式另要求 URL、API Key、`model` 非空，豆包准入另检查已登录且无需验证；ChatGPT 订阅另要求 `model`、可用桌面加密与已授权账号，无需 API Key | [config.js](../../../src/ai/config.js)、[model-client.js](../../../src/ai/model-client.js) |
| 回复发送 | `buildAiRuntime` 注入 `sendReply`，调用 `danmakuSender.send({…, waitForRateLimit: true})` 等待发送频率 | [ai-runtime.js](../../../src/server/ai-runtime.js) |
| 关闭时序 | 在 HTTP 排空后、数据库关闭前调用 `aiRuntime.shutdown()`，完整回收步骤见 §10 与 [server-core.md §6.2](server-core.md#62-关闭shutdownapplication) | [ai-runtime.js](../../../src/server/ai-runtime.js) |

## 2. 弹幕准入链（`handleDanmaku`）

`handleDanmaku`（[ai-assistant-service.js](../../../src/ai/ai-assistant-service.js)）先同步有效配置，在就绪检查后归一化 UID（无 UID 时使用 `name:<userName>`），排除近期自身回复，再进行分流。命中关键词的消息只走下表的定向问答，即使被黑名单、冷却或限额拒绝也不回退到自动接话；点名到达会中断尚未提交的自动候选。未命中且开启 `autoReplyEnabled` 时才进入 §3.4。现有关键词采用包含匹配，未实现基于平台提及目标 UID 的独立呼叫识别。

| 检查 | 语义 | 出处 |
| --- | --- | --- |
| 就绪检查 | `isAiReady` 不成立 → `disabled_or_unconfigured` | [ai-assistant-service.js:57-58](../../../src/ai/ai-assistant-service.js#L57-L58) |
| 自身回复回声 | 发送前按实际发送账号 UID 记录每个拆分片段，60 秒内同 UID 的完全相同文本（含平台可能添加的 `@` 前缀）返回 `self_reply`；同账号的其他提问和其他观众的同文仍可准入 | [ai-assistant-service.js](../../../src/ai/ai-assistant-service.js)、[sender-service.js](../../../src/bilibili/danmaku/sender-service.js) |
| 触发词匹配 | `extractTriggeredQuestion` 按简繁等价在消息中定位 `trigger`，按原文字边界移除触发词并拼回两侧问题（正文保留原文）；空问题回退为“和大家打个招呼”；未命中且自动接话关闭 → `not_triggered` | [ai-assistant-helpers.js](../../../src/ai/ai-assistant-helpers.js) |
| 黑名单 | `store.isBlacklisted(uid)` 命中 → `blacklisted`（表 `ai_blacklist`） | [ai-assistant-service.js:63](../../../src/ai/ai-assistant-service.js#L63)、[config-store.js](../../../src/ai/config-store.js) |
| 本地安全规则 | `checkLocalInput` 命中硬规则 → 以 `localRefusal` 直接入队（不调用模型），见 §6 | [ai-assistant-service.js:64-70](../../../src/ai/ai-assistant-service.js#L64-L70) |
| 用户冷却 | `userCooldownSeconds`（默认 0）内同一 UID 重复触发 → `user_rate_limited` | [ai-assistant-service.js:80-90](../../../src/ai/ai-assistant-service.js#L80-L90) |
| 全房间限速 | 60 秒滑动窗口内最多 `roomLimitPerMinute`（默认 20）条 → `room_rate_limited` | 同上 |
| 队列上限 | `coordinator.getStatus().queued >= queueLimit`（默认 30）→ `queue_full` | [ai-assistant-service.js:67](../../../src/ai/ai-assistant-service.js#L67) |
| 入队 | 通过 → `{accepted: true, reason: 'queued'}`（协调器已停止时为 `'stopped'`） | [ai-assistant-service.js:74-78](../../../src/ai/ai-assistant-service.js#L74-L78) |

## 3. 回复生成管线与协调器

配置存储在校验、事务提交和缓存更新成功后，同步通知 `subscribe` 订阅者（覆盖普通保存以及人格的创建、编辑、导入、删除和恢复）。弹幕准入阶段：API 模式复用最近一次已提交的配置快照，账号模式同时核对当前会话代次。当生效的总开关、触发词、供应商/接入方式、模型、地址/协议/密钥、思考参数或当前人格（ID/正文）发生变化，或账号会话代次变化时，系统会取消两类任务的当前轮次：清空待处理与已生成未投递队列，中止进行中的模型请求、工具调用和送达确认，并停止剩余分段发送与重试。修改未选中的角色或仅修改角色说明不会触发取消；保存失败时原配置与在途任务保持不变。

每个任务绑定所属轮次的 `AbortSignal`，关闭再重新开启后，上一轮迟到的结果不会继续投递，仅接收新弹幕；单独关闭自动接话只会清理其候选、计时器与进行中的自动任务。已发往上游的弹幕无法撤回。旧协调器在现有任务全部结束后即释放（停服等待语义见 §10）；关闭 AI 开关不会永久停服，也不影响连接测试、获取模型列表或手动发弹幕。已确认送达的对话历史按原作用域和 TTL 保留，不因切换模型而清空。

管理页总开关单独按操作顺序保存，其他字段草稿无效时仍可关闭；普通表单保存不携带 `enabled`，避免旧配置响应将其重新开启。总开关或自动接话开关保存失败时，界面保留错误与重试入口直至保存成功。相关测试见 [ai-assistant-lifecycle.test.js](../../../test/ai/ai-assistant-lifecycle.test.js)、[ai-routes.test.js](../../../test/ai/ai-routes.test.js)、[frontend-admin-ai-settings.test.js](../../../test/ai/frontend-admin-ai-settings.test.js)。

### 3.1 定向问答生成管线（`generateReply`）

[生成回合](../../../src/ai/ai-reply-generator.js) 按序执行：

1. **本地拒绝短路**：`item.localRefusal` 直接返回，`category: 'safety'`，不消耗模型配额。
2. **查询缓存**：固定本次人格，按可信房间、UID 和人格读取已送达历史；任一保留片段未通过本地安全检查则不使用历史。缓存键覆盖规则版本（`reply-v10`，远程审核策略更新后不读取旧策略缓存）、配置、账号代次、人格作用域、UID、昵称、问题、实际有界输入和不可用工具集合；store 仅保存 SHA-256 摘要。首次未交付的随机 `sessionId` 不进入内容缓存键，相同无历史首问仍可命中。聊天/工具/缓存回答均须确认送达后才追加历史；重试固定同一历史快照和 `sessionId` 并绕过缓存，失败或拒绝不写记忆、不续期。
3. **输入安全审核**：先用 `buildConversationInput` 生成本次问题与短期上下文的 JSON。`modelProvider` 为 `deepseek` 或 `doubao` 时保留本地检查、跳过远程输入审核（见 §6）；其余 API 与 ChatGPT 订阅模式经 `buildInputReviewPrompt` 审核（任务放在 `instructions`，待审 JSON 放在 `input`），未通过时返回固定 `SAFE_REFUSAL`。
4. **观众上下文**：输入 JSON 为 `{question, previousExchange}`；两轮及以上增加按时间排列的 `earlierExchanges`，裁剪后标记 `historyTruncated: true`。历史为同一观众当前会话的已交付问答，用于延续聊天、接龙、猜谜及省略，不具有覆盖公共规则的权限。执行远程输入审核时，审核与生成收到同一份历史（详见 §3.3）。
5. **主生成**：`deepseek.createResponse` 的 `instructions` 先放公共事实/安全规则，再以单行 `JSON.stringify({ persona })` 传入角色风格资料，避免角色中的换行或标签拼接为额外指令段；已保存角色文本不变。实际可用工具、北京时间与发送预算由程序提供，多轮上下文用于理解当前活动与问题（见 [buildReplyInstructions](../../../src/ai/ai-assistant-helpers.js)），不强制猫语、颜文字、固定推荐数量或非思考模式。
6. **工具循环**：`response.functionCalls` 非空时执行工具（§5），结果以 `function_call_output` 回填并带 `previousResponseId` 续问；累计调用超过 `maxToolCalls`（默认 6）→ `TOOL_LIMIT`。
7. **输出检查**：`modelProvider` 为 `deepseek` 或 `doubao` 时跳过远程输出审核（见 §6），对完整文字执行 `cleanModelText` 与本地检查；其余 API 与 ChatGPT 订阅模式经 `buildOutputReviewPrompt` 审核（分离审核指令与包含本次问题、同一会话历史及 `candidateAnswer` 的 JSON），未通过返回固定 `SAFE_REFUSAL`，通过则再次清理 `safeText` 或原答案。清理后为空抛 `AI_EMPTY_REPLY`，走失败提示且不缓存、不写记忆、不追加请求。所有模式本地检查失败均使用固定拒绝语；本地拒绝或固定拒绝语记 `category: 'safety'`，不写缓存或上下文，也不提前输出未检查的流式片段。
8. **截断与落库**：按长度预算 `truncateReply`（超出截断加 `…`）；写缓存、写 `ai_request_logs`（工具调用数 > 0 记 `category: 'tool'`，否则记 `chat`）；上下文仅在 FIFO 投递确认送达后提交最终答案。

长度预算由 [getReplyLengthBudget](../../../src/ai/ai-assistant-helpers.js) 统一计算：单条弹幕 `DANMAKU_MESSAGE_LIMIT = 40` 减去 `@用户名 ` 长度，允许 1–3 条。界面不提供长度偏好，旧 `replyMaxChars` 键仅兼容读写，不影响生成预算。所有内置、自建、导入角色均自动附加公共底层提示，发送时按预算截断。不同接入模式的审核与工具开销差异见 §6（DeepSeek 与豆包跳过远程输入/输出审核，其余 API 与 ChatGPT 订阅独立执行审核；豆包不支持工具调用）。

定向问答规则要求先给核心答案再补充说明；成语接龙轮到助手时须接观众最新有效词并给出符合约定的新成语，不能复述原词或仅报尾字。执行远程输出审核时同步检查衔接与当前回合，接收与生成相同的正文长度上限并在压缩时优先保留答案。送达重试改用单条预算（见 §9.2）。以上为生成与审核指令要求，非确定性成语库校验；自动接话采用 §3.4 的可静默策略。

API 模式主生成与工具后续请求的输出 token 上限按思考模式切换：`MODEL_OUTPUT_TOKENS = 3072` / `REASONING_OUTPUT_TOKENS = 4096`（[ai-assistant-helpers.js](../../../src/ai/ai-assistant-helpers.js)）。需要远程审核时仅生成短 JSON，固定 `REVIEW_OUTPUT_TOKENS = 384`，且审核请求单独设置 `reasoningEnabled: false`（不修改已保存设置，核心生成仍按用户配置执行，见 [runSafetyReview](../../../src/ai/ai-reply-generator.js)）。关闭思考的选项由各供应商适配器转换为对应请求参数；部分始终思考的模型只能降至最低推理档位，无法保证所有供应商彻底关闭思考（见 §4）。

### 3.2 顺序协调器（`createOrderedAsyncCoordinator`）

[async-coordinator.js:8-83](../../../src/ai/async-coordinator.js#L8-L83) 提供“生成有界并发、投递严格按序”的语义：

| 事实 | 值 | 出处 |
| --- | --- | --- |
| 生成并发 | 由 `generationConcurrency`（默认 3，范围 1–5）控制同时生成的回复数 | [async-coordinator.js:29-44](../../../src/ai/async-coordinator.js#L29-L44) |
| 投递顺序 | 按入队序号 `nextSequence` / `nextDelivery` 串行投递，前一条完成后再投下一条（同观众多段回复不插队） | [async-coordinator.js:46-64](../../../src/ai/async-coordinator.js#L46-L64) |
| 失败隔离 | 生成或投递抛错 → `onError`（记 `delivery` / `generation` 失败日志），不阻断后续序号 | [async-coordinator.js:53-58](../../../src/ai/async-coordinator.js#L53-L58) |
| 停止 | `stop()` 清空 `waiting`/`completed`，停止后 `enqueue` 返回 `false`，并返回等待活跃生成与当前投递结束的 drain Promise；进行中结果不再进入 `completed` | [async-coordinator.js](../../../src/ai/async-coordinator.js) |
| 状态 | `getStatus()`：`queued`/`waiting`/`generating`/`ready`/`delivering`，经 `GET /api/ai/status` 暴露 | [async-coordinator.js:66-74](../../../src/ai/async-coordinator.js#L66-L74) |

### 3.3 连续互动与空闲清理

[conversation-context.js](../../../src/ai/conversation-context.js) 规范化旧单轮载荷与新版 `{version: 2, sessionId, exchanges, truncated}`。历史最多保留 20 组（开场 + 最近 19 组，短会话不重复开场）；每段问题/答案最多 500 个 Unicode 字符，总文本最多 12,000 字符，超限时整组裁去最旧的非开场问答。历史仅保存已送达的正文，不存思考过程、审核结果或工具中间输出，也不额外调用模型做摘要。由于超长对话会按轮裁剪，中途约定可能被裁去；提示词要求模型仅依据可见历史衔接或简短确认，不要假装记得已裁掉的内容。

同一房间/UID 从生成到交付结束占用一个协调器分组；其他观众可并发生成，所有回复仍按入队顺序交付。等待同组的任务不占生成槽位，交付或错误处理的 `finally` 释放分组并重新调度，使下一问读取到上一问实际送达的历史；生成失败、发送失败或关闭不会阻塞后续任务。

`contextTtlSeconds` 默认 600 秒、范围 60–86400 秒，保留显式已保存值；设置页“空闲多久后结束对话（分钟）”换算读写同一字段并兼容非整分钟旧值。仅成功交付给明确观众的对话触发续期，普通观察、群聊自动回复、拒绝、失败和入队均不续期（单人自动回复归属见 §3.4）。任务开始读取时若已过期则新建；已读到有效历史的在途任务跨过期后仍可完成，成功后再续期。修改时长仅影响之后的成功交付，不追溯修改旧 `expires_at`。

带关键词的完整“结束对话”或“清空对话”（简繁等价，允许末尾标点）在同一队列中删除当前作用域，下一问新建 `sessionId`。确认文字不写历史，确认未送达也不恢复旧记忆，重试仅重发固定确认、不调模型。旧版仅按 UID/人格键保存的历史无法可靠确定房间，不迁入新作用域，按原 TTL 过期清理。

相关测试见 [连续互动](../../../test/ai/ai-conversation-continuity.test.js)、[历史预算](../../../test/ai/ai-conversation-context.test.js)、[空闲维护](../../../test/ai/ai-runtime-cleanup.test.js)。

### 3.4 自动接话

`autoReplyEnabled` 默认 `false`，开启后仍受总开关、触发词和模型就绪条件约束。仅带真实 UID、房间和 `source: 'danmaku'` 的普通消息进入候选；黑名单、本地安全拒绝及已被小游戏/命令/其他回复处理的事件在入口排除。可信 `isWelcome` 标记与当前已认证发送账号 UID 的弹幕不参与自动接话，不按昵称或欢迎文案判断机器人。由于普通弹幕不保证上游去重，控制器按 `[uid, text, 规范化平台时间戳]` 维护事件键，同一事件仅接纳一次（不因后续同文事件覆盖旧键）；无时间戳时抑制 2 秒内同 UID/文本。去重键最多 200 个、保留 30 秒；时间戳无效、早于窗口或超前本机 5 秒以上的消息同样不接纳。

`autoReplyProbabilityPercent` 范围 0–100、默认 100，表示每条合格新弹幕进入候选的概率。去重后抽样一次，改为 0 时取消未送达的自动接话；未抽中的消息仅保留为公开背景，不能成为回复目标。100 仍受话题判断、静默与节流约束，不保证每条必回；点名问答不参与抽样。原始 B 站消息缺少统一机器人来源标记，其他账号且无可信欢迎标记的消息无法据此识别。

`autoReplyMentionEnabled` 默认 `false`（旧配置缺省时同为关闭）。开启后仅单人自动接话携带原生 `@`；群聊始终不提及，定向问答沿用原规则。单条正文预算仅在开启时扣除目标昵称的 `@` 前缀；是否提及不影响模型选定的目标或送达后的个人记忆。切换该选项仅取消未发送的自动任务，不影响定向问答。

| 边界 | 固定行为 |
| --- | --- |
| 公开消息窗口 | 最近 30 秒、最多 40 条；每条正文最多 200 个 Unicode 码点、昵称最多 80 个；仅内存 |
| 候选触发 | 无冷却时首条收到后 600 ms 定时触发，不依赖下一条弹幕唤醒；每房间至多一个候选。冷却期仅缓存消息与到期计时器，不提前建立候选 |
| 候选有效期 | 固定 `firstAt + 12 秒`（普通候选以首条收到时间为 `firstAt`，冷却后新候选以确立时间为 `firstAt`），包含审核、生成、排队与发送前等待，不随新消息延长 |
| 等待补充 | `wait` 固定截止为候选 `firstAt + 2500 ms`，仅目标作者的新补充可唤醒；无关消息不延长期限，无补充则结束 |
| 评估预算 | 普通新候选核心评估间隔至少 5 秒；每候选最多两次评估，第二次仅用于有界补充或过时快照重评 |
| 发言预算 | 自动消息提交间隔至少 15 秒；观察、概率跳过与自动评估均不消耗定向问答的用户/房间额度 |
| 已说内容 | `botReplies` 仅保留确认送达的聊天回复，最近 30 秒、最多 8 条；附 `targetUid/targetUserName/question`（原话限 200 码点，全场回复目标为空），供模型理解反馈与避免重复 |

冷却到期后，仅在存在最近 12 秒内未处理消息时建立新候选，以最新消息向前 600 ms 选取当前批次并忽略更旧话题；无近期内容则结束等待，避免在提交冷却期耗尽 12 秒候选寿命或无限延长旧候选。

仅当定向队列与发送器均空闲时才将自动任务交给同一协调器。新点名请求会取消未提交的自动任务并结束当前旧候选；自动生成阶段取消可释放 FIFO 序号，迟到结果不得交付。若底层适配器忽略取消信号，真实模型请求仍会继续跟踪直至结束并占用并发槽位；因此并发为 1 时，定向请求仍需等待该请求完成。仅等待身份读取阶段不占用模型槽位，不阻塞定向请求。已进入共享发送器排队或限流等待的消息无法中途打断，只能等返回后在发送前校验阶段拦截提交。已提交的自动消息不因候选到期或新点名取消送达确认；同一目标观众的后续定向问答等待该确认结束后再读历史。关闭、配置变更或房间/账号失效按各自取消范围处理。

每次模型输入为 `snapshot {roomId, messages, contextMessages, botReplies, waitAllowed}` 的公开投影（消息带内部 ID、作者和接收时间）：`messages` 为待评估候选，`contextMessages` 为同一 30 秒/40 条窗口内更早的公开消息，两者合计不扩大窗口。`silent`、失败或最终放弃会标记本次已评估消息为已处理；旧消息可短暂留作背景，但后续新消息不能重新挑中旧目标。新相关补充使未提交快照失效（最多重评一次）；发送器实际 POST 前及限速等待后均复核目标、候选时效与会话一致性。当前未接入普通弹幕撤回事件，也无法保证准确识别跨观众的纠错或语义层面的“话题已结束”。

生成复用当前 `modelClient` 与人格，以单次 `auto_generation` 同时完成决策与起草，不使用缓存或工具。本地安全检查在入窗前逐条过滤，生成器亦复核背景与原话。远程审核跳过规则见 §6：执行远程审核的模式先审核候选、公开背景与已送达回复，仅 `reply` 进入自动专用输出审核；输入被拒时整体静默，并移除本次已审消息与回复背景（保留评估期间新到消息），避免旧批次持续污染后续对话。豆包采用本次任务的 JSON 约定与每轮独立 `auto` 会话，不使用问答的“只输出正文”策略，也不复用被丢弃草稿的远端会话。

普通短句与可理解的文字表情可视作完整情绪表达，`wait` 仅用于明确仍有补充的消息（指代不清或不认识梗不构成等待理由）。生成提示及适用的远程审核结合作者与已说内容识别普通负反馈，不将其误判为越权：首次接错可简短纠正，重复不满或请勿插话时保持静默，且对单个观众的反馈不自动禁止与其他观众聊天（仅基于当前公开窗口，非永久禁言或偏好设置）。角色语气由本轮人格指导，角色资料保持纯 JSON 数据，不能新增事实或越过发言资格；小猫与鲸鱼娘以温软、童真的语气接话，仅在求助时提供建议。

所有供应商统一采用提示约定与严格本地解析，未向 `model-protocol.js` 增加原生 JSON 参数。输出必须恰为 `{action, targetMessageId, reply}`：`action` 仅取 `reply`/`wait`/`silent`，目标为当前批次 ID 或 `null`；`wait` 要求有效目标与剩余等待许可，`silent` 目标为 `null`，两者正文必须为空。结构非法、目标非法、工具请求、拒绝或服务错误一律静默跳过，不向直播间发送 JSON、错误或固定拒绝语。

`reply` 仅允许一条完整正文（单人扣除提及昵称预算，面向全场不提及）。执行远程输出审核时必须获得非空 `safeText`，不得回退到未过审草稿；DeepSeek 与豆包直接检查生成正文。所有模式最终本地安全检查或字符预算失败均静默，不硬截断半句话；送达状态不明时不重生成或补发。单人自动回复确认送达后，仅将目标观众的原话与最终回复追加到该房间/UID/人格历史；面向全场的群聊回复不写入任何个人记忆。自动接话生成阶段不读取观众的私有对话历史。

相关测试见 [候选时序](../../../test/ai/auto-reply-controller.test.js)、[生成与审核](../../../test/ai/auto-reply-generation.test.js)、[服务集成](../../../test/ai/ai-auto-reply-service.test.js)（仅验证程序契约，不覆盖真实模型的事实判断效果）。

## 4. 模型客户端（API 与账号路由）

[model-client.js](../../../src/ai/model-client.js) 的 `createModelClient` 是统一模型出口，经 `modelClient` 注入助手服务，覆盖 API、豆包账号与 ChatGPT 订阅；`deepseekResponsesUrl` / `deepseekApiKey`、原有错误码及兼容路由保留历史命名。端点与能力判定由 [model-endpoint.js](../../../src/ai/model-endpoint.js) 统一负责。API 模式请求经 [http-client.js](../../../src/ai/http-client.js) 的 `fetchJson`（合并任务取消信号与超时信号、响应体 ≤ 2 MiB、错误码归一化）。联网搜索复用 [共享响应体读取器](../../../src/shared/response-body.js)，RSS 上限同为 2 MiB；流式读取在保留 chunk 前累计字节数，超限即取消上游且不将大正文记入诊断。读取器采用单缓冲区倍增扩容（不超过上限），避免小分块产生大量临时对象；非流式响应在读取完整正文后同样执行大小校验。关闭总开关保留 `AI_DISABLED`、应用关闭保留 `AI_SHUTDOWN` 取消原因，不误报为普通上游超时。

### 4.1 协议选择

| `modelProvider` | 服务端固定基础地址 | 固定协议 |
| --- | --- | --- |
| `deepseek` | `https://api.deepseek.com` | Chat Completions |
| `openai` | `https://api.openai.com/v1` | Responses API |
| `anthropic` | `https://api.anthropic.com/v1` | Chat Completions（Anthropic 官方 OpenAI 兼容层） |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai` | Chat Completions（Google 官方 OpenAI 兼容层） |

`auto` 保留旧配置的 URL 识别行为；`custom` 允许手工编辑地址与协议。官方预设在服务端强制覆盖请求中的 URL 与协议，前端解除禁用或直接调用配置 API 均无法改写官方目标。

| 协议 | 条件 | 请求体要点 | 出处 |
| --- | --- | --- | --- |
| **Responses API** | 完整 `/responses` 原样使用；显式选择时第三方根地址补 `/v1/responses`，DeepSeek 官方根地址补 `/responses`；`auto` 下无法安全判定为基础地址的完整自定义路径原样保留 | `{model, instructions, input, tools?, max_output_tokens(≥64), previous_response_id?}`；按 §4.2 官方模型能力发送 `reasoning.effort`（启用传合法所选档或官方默认，关闭传 `none` 或官方最低可用档） | [model-endpoint.js](../../../src/ai/model-endpoint.js)、[model-client.js](../../../src/ai/model-client.js) |
| **Chat Completions** | 完整 `/chat/completions` 原样使用；显式选择或 `auto` 识别根地址、`/v1` 后补全；第三方根地址补 `/v1/chat/completions`，DeepSeek 官方根地址补 `/chat/completions` | `{model, messages, max_tokens, stream: false}`；DeepSeek 官方发送 `thinking.enabled/disabled` 及支持的 `reasoning_effort`；第三方 OpenAI 兼容 Chat 对已确认模型发送标准 `reasoning_effort`，未知模型省略；工具转 `tools`（function） | [model-endpoint.js](../../../src/ai/model-endpoint.js)、[model-client.js](../../../src/ai/model-client.js) |

`modelApiProtocol` 默认 `auto`。完整 `/responses` 或 `/chat/completions` 路径优先于协议选择器，避免改写已明确的端点。无工具时两种协议均不发送 `tools` 字段。联网能力因协议而异：Responses 的 `web_search` 由上游托管，仅受联网开关控制；Chat Completions 转为 LIRA 本地函数工具，须同时开启联网与 `functionCallingEnabled` 且模型支持 `tool_calls`。协议可承载工具不代表具体模型支持。

Responses 使用上游的 `previous_response_id`。Chat Completions 只为包含函数调用的响应保留续轮历史，整个客户端最多保留 100 条。工具续轮按实际端点、模型、API Key 的 SHA-256 和 `previousResponseId` 找回原消息，再按 `tool_call_id` 接入工具结果。[模型客户端](../../../src/ai/model-client.js)

DeepSeek 官方 Chat 开启思考并携带 `tools` 时，工具循环内回放的每条 assistant 消息均须带齐上游返回的 `reasoning_content`（即便该条未调用工具），逐次原样保留推理文本与 `tool_calls`；续请求关闭思考或耗尽可用工具时仅发普通消息与工具结果。该规则按实际官方端点识别（含 `auto` 配置）；通用 Chat 网关发送标准消息字段，Kimi 见 §4.5。参见 [DeepSeek 思考模式与工具调用](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)。

官方思考工具链的历史 ID 仅用于一次续接：取出历史即移除旧记录，仅在模型再次请求工具时保存下一步，任务取消时释放待续接记录。最终回答结束该协议历史，后续观众追问使用 §3.3 已送达的可见问答。业务层仅暴露归一化字段，请求日志仅记录 §4.3 所述元数据与安全错误。

### 4.2 响应归一化与错误

两种协议均归一化为 `{id, text, functionCalls[], finishReason, usage: {inputTokens, outputTokens}}`：

- Responses：`normalizeResponse` 遍历 `output[]` 中的 `function_call` 与 `output_text`，兼容顶层 `output_text`（[model-protocol.js](../../../src/ai/model-protocol.js)）。
- Chat Completions：`normalizeChatResponse` 提取 `choices[0].message` 的 `tool_calls` 与 `content`（[model-protocol.js](../../../src/ai/model-protocol.js)）。
- 空响应与工具参数：`finishReason` 为 `length` / `max_output_tokens` → `DEEPSEEK_OUTPUT_TRUNCATED`，否则 `DEEPSEEK_INVALID_RESPONSE`（[model-client.js](../../../src/ai/model-client.js)）；工具参数 JSON 解析由 [model-protocol.js](../../../src/ai/model-protocol.js) 负责，解析失败且带上述截断标记返回 `DEEPSEEK_OUTPUT_TRUNCATED`，否则返回 `INVALID_TOOL_ARGUMENTS`。

辅助接口：`listModels` 根据配置地址推导同级 `/models`（第三方根地址默认 `/v1/models`，DeepSeek 官方根地址为 `/models`），结果去重排序；`testConnection` 发送“你好”取 200 字内回复，401/403/AUTH 类错误映射为 `DEEPSEEK_AUTH_FAILED`。API 连接测试响应的 `provider` 复用 `describeModelEndpoint`（显式供应商按预设，`auto` 下官方 DeepSeek 为 `deepseek`、其余为 `custom`；豆包与 ChatGPT 订阅分别返回 `doubao` 与 `openai`）。兼容路径 `/api/ai/test/deepseek` 继续测试当前模型配置。

模型列表保留 `models: string[]`，上游提供显示名时附带 `modelNames: Record<string, string>`（API 读取 `display_name` / `name`，订阅读取 `display_name`）；请求与保存始终使用模型 ID。配置读入/保存时，仅官方 DeepSeek 有效地址将旧 `ds-v4-flash`、`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 归一为 `deepseek-flash`（第三方地址原样保留）；Pro 使用目录返回的 `deepseek-v4-pro`（依据：[DeepSeek 模型目录](https://api-docs.deepseek.com/api/list-models/)、[当前 API 名称](https://api-docs.deepseek.com/quick_start/pricing/)）。

目录可选返回 `modelReasoning: Record<string, {efforts: string[], defaultEffort?: string}>`，归一化由 [model-reasoning.js](../../../src/ai/model-reasoning.js) 负责：优先读取 DeepSeek 的 `effort.supported_levels/default_level` 与订阅目录可选的 `supported_reasoning_levels/default_reasoning_level`；返回的等级列表（含空列表）优先于静态规则，缺省或不适用的默认值不猜测、不回填。仅在目录未提供等级时，才按官方文档依据匹配精确模型/快照 ID（第三方 `auto`/`custom` 复用精确同名 GPT 官方定义，不按域名或模糊前缀推测）。官方依据包括 [OpenAI 模型页](https://developers.openai.com/api/docs/models)、[Gemini 思考等级](https://ai.google.dev/gemini-api/docs/thinking)、[Gemini 兼容参数](https://aistudio.google.com/docs/openai#thinking) 与 [Kimi 推理强度](https://platform.kimi.com/docs/guide/use-reasoning-effort)。

公开配置的 `modelEndpoint` 可选附带 `reasoningEfforts` / `defaultReasoningEffort`；已配置 API 或订阅时附带 `reasoningState: {mode, effort?, canDisable?}`（`mode` 取 `enabled`/`disabled`/`unknown`，`effort` 为实际下发档位，仅确认支持开关时返回 `canDisable`）。该状态与真实请求共用 [model-protocol.js](../../../src/ai/model-protocol.js) 的参数构造逻辑，不回显密钥，仅反映 LIRA 发出的参数（中转服务是否按此执行由上游决定）。

组合根 [ai-runtime.js](../../../src/server/ai-runtime.js) 将 `modelClient.getModelReasoning(config)` 注入配置读取链路，确保读取配置、保存响应与实际请求使用同一套缓存能力且不触发额外上游请求。目录能力仅缓存在客户端内存中：API 模式按“平台 + 有效目录 URL + Key 的 SHA-256”隔离（最多 20 组），订阅模式按账号会话代次隔离。重新获取目录会替换缓存，前端随后补一次本地配置 GET 刷新已保存的思考模式（不覆盖未保存草稿）；切换平台、接入方式、账号或修改密钥时清空旧缓存。

各平台思考参数发送策略汇总：

- **通用规则**：启用思考时仅传合法所选档或已确认官方默认，未确认能力/默认且无合法选择时省略参数（OpenAI API/订阅均不透传遗留强度，也不强行发 `none`）；关闭思考时，支持 `none` 的模型发 `none`，始终思考的模型降至官方最低可用档。
- **ChatGPT 订阅**：思考能力仅读取当前账号目录，不回退到 API 模型页；未拉取目录或账号会话变化后省略推理参数并提示重新拉取。
- **DeepSeek / Kimi / Gemini / 第三方**：DeepSeek Chat 与 Kimi K2.5/K2.6 保留独立 `thinking` 开关；DeepSeek Responses 可通过 `none` 关闭思考（见 [官方 schema](https://api-docs.deepseek.com/api/create-response/)）；Gemini 2.5 列出兼容协议明确支持的等级（Flash / Flash Lite 含 `none`）；第三方 Responses 缺少能力资料时保留旧显式强度与关闭发 `none` 的兼容行为（明确空档位目录仍优先并省略字段）；第三方 Chat 仅对目录声明或精确同名 GPT 已知能力发送标准 `reasoning_effort`，未知模型省略。

### 4.3 模型调用诊断

`sendModelRequest` 成功时仅提交一条 `request_succeeded` 元数据（`provider`/`model`/`purpose`/`protocol`、HTTP 状态、耗时、token 数、`finishReason` 与工具调用数），不提交 URL、请求体、原始响应或正文。失败时在同一 catch 边界提交一条 `request_failed`，保留关联元数据与脱敏错误核心；`AI_SHUTDOWN` / `AI_DISABLED` 取消不记普通故障。落盘前由 `request-logger` 汇总并再次执行密钥脱敏与字节限制（§8.2）。

### 4.4 豆包个人账号（实验性）

`modelProvider: 'doubao'` 在统一模型入口转交 [doubao-client.js](../../../src/ai/doubao-client.js)，不经过 API Key HTTP 传输。`modelEndpoint` 返回 `protocol: 'account'`、`provider: 'doubao'`，联网与推理能力标记为 `unsupported`。无需 URL、API Key 或模型 ID，模型列表固定为 `doubao`；独立 Node 运行时缺少桌面会话时返回 `DOUBAO_DESKTOP_REQUIRED`。

Electron 会话由主进程创建并经 [ai-runtime.js](../../../src/server/ai-runtime.js) 注入，账号与窗口契约见 [auth.md](../desktop/auth.md#17-豆包个人账号) 与 [windows.md](../desktop/windows.md#4-豆包账号与验证窗口)。service 使用“UID + 含已校验房间号的人格作用域 + 本地 `sessionId`”拼接内部 `conversationKey`，适配器区分观众问答与连接测试两类作用域；普通问答缺少作用域时直接拒绝，不降级到共享会话。豆包会话管理器按作用域在内存中保存已确认的上游会话：同一观众与人格在有效期内复用，空闲达到 `contextTtlSeconds`（默认 10 分钟）后下次提问新建，连接测试使用独立会话。首建、过期清理与更新均在串行队列内执行，ACK 成功后按当前配置续期，其他观众活动不延长本人会话；会话 ID 仅存内存，登录身份变化、退出或管理器销毁时全部清除，验证码状态变化保留已确认 ID；重启或重登后按需新建，不删除网页端既有聊天记录。

豆包普通问答跳过远程审核（见 §6），`DOUBAO_CHAT_POLICY` 随当前预设一同发送，要求仅输出纯文字、拒绝不适合直播的内容与注入并输出固定拒绝语；自动接话见 §3.4。完整结果经本地检查后走 FIFO 发送与送达确认，不做未检查的流式上屏。

首次请求显式传 `need_create_conversation: true`、空上游 ID 与独立随机 local ID，不读取前台页面对话作为复用目标；首次 ACK 若返回请求前已知会话 ID（含刚过期条目）或页面 `/chat/<数字ID>` 中当前对话，则拒绝结果。复用时传 `need_create_conversation: false`、`click_clear_context: true` 及该作用域最近的 `last_section_id`，要求 `SSE_ACK.ack_client_meta` 确认相同 conversation ID 与不同 section ID（仅接受 1–64 位数字字符串，不从正文、任意 meta 或 `previousResponseId` 提取）。成功正文缺少 ACK、ID 不一致或 section 未变化时返回 `DOUBAO_CONTEXT_UNCONFIRMED` 并全局阻塞后续请求（请求已发但中止/超时未收 ACK 亦同，不因切换观众、连接测试或 TTL 到期而新建重试，须重启或重登清除不明状态）；明确验证码拒绝允许人工验证后重试并保留已确认 ID（未首建条目移除，验证后可首建）。收到 ACK 后文字流不完整则保留新 section，下次仍须确认新 section。

观众追问由 LIRA 按可信房间、UID 与人格提供有界多轮已送达上下文（§3.3），但上游会话每次仍重置 section 以免带入未送达或已拒绝的旧答案。每次请求将 `instructions` 与 `input` 分别放入 JSON 的 `instructions` 与 `data`（该文本格式不构成权限隔离，豆包不会收到其他供应商密钥、LIRA 函数工具或调用方指定的上游会话 ID）。注意：ACK 属于请求发出后的回执确认，本地拒绝结果无法撤回上游已落盘的对话记录；会话隔离背景见 [实施计划](../../../specs/plans/2026-10-13-doubao-conversation-isolation.md)。

SSE 解析保留文字块的初始内容与增量片段，忽略思考、语音等块，要求完整结束标记及非空回复；响应归一化为统一结构，`functionCalls` 为空，未提供的 token 用量记 0。请求串行执行，响应体上限 2 MiB、超时 3–60 秒。错误码 `710022004` 映射为 `DOUBAO_VERIFICATION_REQUIRED` 并置 `needsVerification` 暂停普通请求（仅表示接入收到验证拒绝，后台 SSE 错误不会自动弹出验证框；`openLogin` 仅打开同分区官网页面）。用户在官网窗口完成验证后，必须通过正常「测试 AI 连接」（测试文本为“请只回复：连接成功”）探测成功才能清除暂停；官网普通聊天成功不等同于适配器恢复，未验证通过时不自动清除标志、重试或更换会话。

首字耗时 `firstTextMs` 仅在收到首个非空正文 SSE 事件时记录（含初始块、`CHUNK_DELTA` 或 `STREAM_CHUNK`，不计 ACK、心跳、思考或未收完整帧），由页面单调时钟加上管理器内的队列与窗口准备耗时，记录从入队到首段正文可解析的时间（非直播间显示耗时）；无首字时不记为 0，完整成功后写入请求日志汇总（首字耗时以真实线上请求为准）。

准入同时检查桌面可用、已登录与无需验证；豆包生成并发固定为 1。任务与缓存键携带会话代次，登录变化、退出或验证状态变化后的旧结果不得投递，切换进出豆包时取消旧任务。`GET /api/ai/status` 附带公开 `doubao` 状态，详见 [api.md §13](api.md#13-ai-域ai)。日志仅记录元数据与脱敏错误，不写 Cookie、原始 SSE 或对话正文。切入/切出账号模式时的原 API Key origin 保护见 §7.2。

### 4.5 ChatGPT 订阅与 Kimi API

[chatgpt-oauth.js](../../../src/ai/chatgpt-oauth.js) 实现官方 OAuth/OIDC 授权流程：基于固定 issuer `https://auth.openai.com` 的 discovery 端点进行动态本地客户端注册，采用 S256 PKCE、`state`、`nonce` 与 `127.0.0.1` 临时端口回调（5 分钟超时）。首次收到 `client_id` 先保存注册记录再换取凭据，复登沿用注册并核对账号；经 `jose` 校验签名、`issuer`、`audience`、`exp`、`iat`、`sub`、`nonce`，不读取其他客户端登录文件，也不接受前端 URL 或 token。

[chatgpt-session.js](../../../src/ai/chatgpt-session.js) 负责多账号管理、授权范围校验、串行刷新、退出与会话代次。它复用 `ai_configuration` 表：`chatgptHostId` 存稳定本机标识，`chatgptAccounts` 存经 `safeStorage` codec 加密的账号/注册/令牌记录（`is_secret = 1`），两者均不在公开配置白名单内。缺少可用加密或桌面打开浏览器能力时拒绝登录，不支持明文降级。仅获得 `chatgpt.tokens.use.direct` 授权方可推理；过期前串行刷新并替换凭据。退出时先删除当前账号令牌、取消在途请求，再请求官方撤销（撤销未确认时提示用户，保留注册映射供复登，不影响其他账号与 API Key）；切换与退出均使旧请求失效，迟到刷新无法恢复已退出凭据（停服回收见 §10）。

[chatgpt-client.js](../../../src/ai/chatgpt-client.js) 仅向固定公开地址 `https://api.openai.com/v1` 发送订阅 token。模型目录读取 `models[]` 中 `visibility=list` 的 `slug` 与 `display_name` 并保持官方顺序（遵循 [官方订阅目录契约](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)）。推理使用 Responses 的 `store: false`、`stream: true` 与数组 `input`，不传订阅不支持的 `max_output_tokens` / `previous_response_id`；函数工具置于 `lira` namespace，工具续接在本地回放输入、函数调用与加密 reasoning，账号代次变化时清空。SSE 限 2 MiB，仅 `response.completed` 返回完整结果；失败、额度不足或中断不输出部分回答，不自动回退到 API 模式。人格、上下文、审核、工具、思考参数（§4.2）与最终投递均沿用统一管线。

浏览器登录入口由 Electron 主进程注入 `openAiLoginBrowser`，runtime 负责装配与清理，无新增渲染进程 IPC。账号接口沿用 AI 管理鉴权，公开状态见 [api.md §13](api.md#13-ai-域ai)。API 与订阅配置可并存，每次仅调用显式选中的模式，跨模式切换时的原 API Key origin 保护见 §7.2。

Kimi 官方预设为 `https://api.moonshot.cn/v1` + Chat Completions，模型来自 `/models`。适配器协议差异：使用 `max_completion_tokens`；K2.5 / K2.6 经 `thinking.type` 开关思考，K3 / K3.1 Pro 使用官方 `low`/`high`/`max`（默认 `max`，始终思考，关闭选项降至 `low` 且输出预算至少 4096）；工具历史保留 assistant `reasoning_content`。Kimi Code 订阅不用于弹幕产品调用，其他未提供该用途授权的厂商继续使用 API Key 接入。

官方依据：[本地授权](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[订阅限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)、[Kimi 产品集成说明](https://www.kimi.com/en/help/kimi-code/membership-guide)。相关测试见 `chatgpt-session.test.js`、`chatgpt-client.test.js`、`ai-provider-adapters.test.js`。

## 5. 工具集

`buildTools(config)`（[prompt.js](../../../src/ai/prompt.js)）默认返回空数组。`functionCallingEnabled` 作为兼容门控字段保留：保存时根据联网、天气、地点、路线开关计算，任一开启即为 `true`。天气须开启 `weatherEnabled` 并配置和风 Host/Key，地点与路线须分别开启 `placesEnabled` / `routesEnabled` 并配置高德 Host/Key，地理编码随地点或路线启用；联网规则见 §4.1。管理页读取旧配置时，若 `functionCallingEnabled` 为 `false`，将受其抑制的天气、地点、路线和 LIRA 联网搜索展示为关闭，防止后续保存意外开启（平台原生搜索状态与已保存凭据不受影响）。

| 工具名 | 提供者 | 上游接口/行为 | 出处 |
| --- | --- | --- | --- |
| `get_weather` | 和风天气 qweather | 地点先走 `/geo/v2/city/lookup`（取前 5，重名跨省返回 `ambiguous` 候选）；`date` 非 `today`/`now` 时走 `/v7/weather/3d` 预报，否则 `/v7/weather/now`；`air` / `warning` 分别走 `/v7/air/now`、`/v7/warning/now` | [qweather-tool.js:10-63](../../../src/ai/tools/qweather-tool.js#L10-L63) |
| `search_places` | 高德 amap | `/v3/place/text`（`city`/`district`/`location` 可选，`offset=5`，`extensions=base`），取前 5 POI | [amap-tool.js:37-49](../../../src/ai/tools/amap-tool.js#L37-L49) |
| `resolve_location` | 高德 amap | `/v3/geocode/geo` 解析地址 → `{formattedAddress, province, city, district, adcode, location}`；多结果标记 `ambiguous` | [amap-tool.js:27-35](../../../src/ai/tools/amap-tool.js#L27-L35) |
| `get_route` | 高德 amap | 起终点经 `ensureCoordinate` 统一为坐标；`transit` 走 `/v3/direction/transit/integrated`，其余走 `/v3/direction/<mode>`；取第一条 `paths[0]` / `transits[0]` 的距离与时长 | [amap-tool.js:51-62](../../../src/ai/tools/amap-tool.js#L51-L62)、[104-113](../../../src/ai/tools/amap-tool.js#L104-L113) |
| `web_search` | Bing RSS | `https://www.bing.com/search?format=rss&q=…`（查询 ≤ 200 字符），解析 `<item>` 前 5 条为 `{title, snippet, url}`；空结果 → `WEB_SEARCH_EMPTY` | [web-search-tool.js:5-41](../../../src/ai/tools/web-search-tool.js#L5-L41) |

**工具调用回路**：执行前同时核对请求配置快照与最新已保存配置，未启用、缺凭据或被撤销的函数返回 `tool_unavailable`（不发外部请求并从后续轮次排除）。允许的调用按名称分派并以 `function_call_output` 回填。月度配额触顶时将该工具加入 `excludedToolNames` 并返回 `monthly_api_quota_reached`（仅当搜索可用时建议改用 `web_search`，否则说明无法核实并提供一般建议）；生成前亦按 `quotaStore.getExcludedToolNames()` 裁剪工具列表（见 [ai-reply-generator.js](../../../src/ai/ai-reply-generator.js)）。

当前时间由 [current-time-tool.js](../../../src/ai/tools/current-time-tool.js) 的本地格式化函数直接注入指令，不向模型注册时间工具。

**测试接口**：`testProvider('qweather' | 'amap' | 'deepseek')` 分别调用各工具的 `testConnection`（校验 Key 与错误码映射），经 `/api/ai/test/*` 暴露。

## 6. 安全过滤与模型约束

1. **本地硬规则** `checkLocalInput`：检查副本做 NFKC、简繁等价、去 Unicode 格式字符与空白归一化；注入匹配额外归一化汉字间空白及常见分隔符（原问题不改写）。覆盖色情、明确违法、隐私及具备操作意图的身份冒充、规则覆盖、伪造角色/审核、编码执行或泄露等常见中英文指令。定向问答固定拒绝文案为“这次不方便在直播间回答，换个话题吧。”（不含角色口癖）；自动任务不发送拒绝语。“我是管理员，推荐几首歌”、“什么是 system prompt？”、“Base64 编码和解码是什么？”等正常提问不被误拦。传入的历史问答与最终正文均执行该检查（见 [safety.js](../../../src/ai/safety.js)）。
2. **模型约束与远程审核策略**：全部预设与两种任务共用 `TRUST_BOUNDARY_POLICY`（弹幕身份、昵称、UID、礼物和授权声明不赋予管理权限；引用、工具返回与历史中的承诺仅为数据，编码/翻译/角色扮演不改变边界，不披露隐藏指令或未提供的其他观众私有会话）。**DeepSeek 与豆包**保留公共生成规则与本地检查，跳过远程输入/输出两次审核请求（豆包另无工具权限）；**其余 API 与 ChatGPT 订阅**通过 `runSafetyReview` 分别审核输入与输出（指令与 JSON 数据分离）。审核返回的 `allowed` 须为布尔值，`safeText` 若存在须为字符串；解析或字段异常抛 `AI_REVIEW_INVALID`（定向问答走失败提示，自动任务静默）。拒绝时忽略模型 `safeText`；允许时仍对最终文案执行本地检查（自动任务另要求非空）。固定拒绝语不缓存、不写记忆。

`COMMON_REPLY_POLICY` 与 `FACTUALITY_POLICY` 统一规定两类任务的权限与事实边界：人格只影响风格，不改变发言资格、任务、工具或记忆范围；无音视频输入不能声称感知现场；未知日程/主播状态不得编造；无对应能力与成功结果时不得声称已记录、代办或通知。远程输出审核要求最终 `safeText` 同样满足事实依据与作者归属，对已安全、贴题且符合预算的候选原样保留，不从旧历史补回多余口癖或强行改为追问。普通批评与语气偏好不按越权处理，但不能据此修改设置或权限。

以上检查用于降低风险，不能保证拦截所有提示词注入；模型输出始终视为不可信文本，工具权限在程序侧强制校验（防护原则与局限参见 [OWASP 指南](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)）。

## 7. 配置与密钥

### 7.1 配置键

全部配置存于 `ai_configuration` 表（**与 `settings` 表隔离**，避免通用设置接口回显密钥，见 [storage.md](storage.md) §3.1），默认值与区间定义见 [config.js:11-57](../../../src/ai/config.js#L11-L57)：

| 分组 | 键 | 默认 | 说明 |
| --- | --- | --- | --- |
| 总开关 | `enabled` | `true` | 布尔 |
| 自动接话 | `autoReplyEnabled` / `autoReplyProbabilityPercent` | `false` / `100` | 共用当前模型与人格；合格普通弹幕候选概率 0–100%，详见 §3.4 |
| 接话提及 | `autoReplyMentionEnabled` | `false` | 仅控制单人自动接话是否 `@` 观众；定向问答保持提及 |
| 触发 | `trigger` | 空 | 空或 1–12 字符；为空时尚未就绪 |
| 供应商 | `modelProvider` | `auto` | 枚举：`auto, deepseek, kimi, openai, anthropic, gemini, custom, doubao`；五个官方 API 预设由服务端固定地址和推荐协议，忽略客户端 URL/协议覆盖 |
| 接入方式 | `modelAuthMode` | `api` | `api` / `subscription`；仅 OpenAI 接受 `subscription`，其他平台归一化为 `api`；旧配置默认 `api` |
| 模型服务 | `deepseekResponsesUrl` / `deepseekApiKey` / `model` | 全空 | URL 须为无账号信息的 HTTP(S)（支持根地址、`/v1` 或完整端点）；`model` 为空或 ≤ 80 字符 |
| 协议与推理强度 | `modelApiProtocol` / `reasoningEffort` | `auto` / `auto` | 协议枚举：`auto, responses, chat_completions`；存储兼容枚举：`auto, none, minimal, low, medium, high, xhigh, max`；实际可选档与默认值见 §4.2 |
| 行为开关 | `webSearchEnabled` / `functionCallingEnabled` / `reasoningEnabled` / `weatherEnabled` / `placesEnabled` / `routesEnabled` | 全为 `false` | 新配置默认普通问答；兼容字段 `functionCallingEnabled` 由单项开关计算，关闭查询保留凭据，见 §5 |
| 第三方凭证 | `qweatherApiHost` / `qweatherApiKey` / `amapApiHost` / `amapApiKey` | 全空 | Host 缺协议自动补 `https://` |
| 兼容数值 | `replyMaxChars` | 50 | 保留 10–50 校验供旧调用方读写，界面不展示，运行时不使用 |
| 数值 | `generationConcurrency` | 3 | 生成并发，1–5 |
| 数值 | `queueLimit` | 30 | 排队上限，1–100 |
| 数值 | `sendIntervalMs` | 3000 | **仅作默认值保留，运行时未使用**（实际节奏见 §9.1） |
| 数值 | `userCooldownSeconds` | 0 | 用户冷却，0–3600 |
| 数值 | `roomLimitPerMinute` | 20 | 全房间限速，1–120 |
| 数值 | `requestTimeoutMs` | 12000 | 上游超时，3000–60000 |
| 数值 | `maxToolCalls` | 6 | 单轮最多工具调用，1–8 |
| 数值 | `cacheTtlSeconds` / `contextTtlSeconds` | 60 / 600 | 查询缓存 / 观众上下文 TTL，0–3600 / 60–86400 |
| 角色 | `personaId` / `personaPacks` / `systemPrompt` | `general` / `[]` / 通用助手文本 | 当前角色、最多 20 个自建或导入包、自定义角色草稿（20–8000 字符），详见 §7.3 |

`normalizeAiConfig`（[config.js:59-92](../../../src/ai/config.js#L59-L92)）负责白名单过滤、布尔/数值归一化与越界抛错（400）。

### 7.2 密钥加密与访问控制

| 事实 | 值 | 出处 |
| --- | --- | --- |
| 密钥键集合 | `AI_SECRET_KEYS = {deepseekApiKey, qweatherApiKey, amapApiKey}` | [config.js:5-9](../../../src/ai/config.js#L5-L9) |
| 存储标记 | 密钥以 `is_secret=1` 存 `ai_configuration`，写入时调用 `secretCodec.encrypt` | [config-store.js](../../../src/ai/config-store.js) |
| 加密实现 | `createElectronSecretCodec` 包装 Electron `safeStorage`（`isEncryptionAvailable()` 为真才可加密），值经 `encryptString` 后 Base64 落库；**不支持明文降级存储**；非 Electron 独立模式下 `isAvailable()` 为 `false`，写入密钥时直接报错“当前系统无法安全加密 API Key” | [secret-codec.js:3-31](../../../src/ai/secret-codec.js#L3-L31) |
| 读取降级 | 解密失败时该键置空并 `console.warn`（日志脱敏），不阻断其他配置读取 | [config-store.js](../../../src/ai/config-store.js) |
| 公开视图边界 | `getPublicConfig` 过滤全部 `AI_SECRET_KEYS` 与原始 `personaPacks`，改为返回含内置与已保存角色的 `personas` 列表，并替换为 `hasDeepSeekApiKey`/`hasQWeatherApiKey`/`hasAmapApiKey`、`secretEncryptionAvailable` 与无密钥 `modelEndpoint {protocol, provider, webSearchMode, reasoningMode, reasoningEfforts?, defaultReasoningEffort?, reasoningState?}`；`updateConfig` 返回同一公开视图 | [config-store.js](../../../src/ai/config-store.js) |
| 前端遮罩 | 管理页密钥输入框为 `password`；公开配置的 `*ApiKeyPreview` 仅返回前 6 位加 `********`（长度 ≤ 12 全部遮罩，未配置返回空串）并仅放 `placeholder`，完整密钥不回填 `value`；保存成功后清空已提交密钥草稿、保留更新输入；空值跳过保留现值 | [config-store.js](../../../src/ai/config-store.js)、[ai-assistant-config-view.js](../../../public/js/admin/ai-assistant-config-view.js)、[ai-assistant-settings.js](../../../public/js/admin/ai-assistant-settings.js) |

管理端配置编辑经 `PUT /api/ai/config`（密钥传 `''` 跳过、传 `null` 置空，见 [api.md](api.md) §13）；状态、模型列表与连通性测试端点为 `/api/ai/status`、`/api/ai/models`、`/api/ai/test`、`/api/ai/test/{deepseek,qweather,amap}`。

**模型密钥跨 origin 复用校验**：模型密钥的隐式复用受有效 origin（协议、主机、端口）严格约束。`config-store.updateConfig` 在事务提交前核对将要持久化的有效配置，跨 origin 时要求显式提供或清空 `deepseekApiKey`，否则回滚整次修改（从官方预设切回先前自定义地址同样受检）。`ai-assistant-service.listModels` 在请求上游前执行同一检查，临时更换目标必须显式传入 Key。同 origin 下的路径或协议选择仍可调整；官方预设先确定真实目标，不以被忽略的旧地址判断。进入豆包或 ChatGPT 订阅等账号模式时保留原 API Key，并在 `ai_configuration` 的私有键 `doubaoPreviousKeyOrigin`（非密钥，不对配置 API 暴露，不接受客户端写入）暂存原密钥的有效 origin；跨账号模式切换不会覆盖该记录，退出账号模式切回 API 时据此校验不可跨 origin 复用，成功后清空该行。账号模式下临时拉取其他 API 模型列表须显式提供 Key 或先保存切回原供应商。该约束不影响和风与高德各自的凭据模型（测试见 `test/ai/ai-model-key-origin.test.js`）。

### 7.3 角色包与兼容读取

[personas.js](../../../src/ai/personas.js) 管理纯数据角色包，不加载代码或脚本。格式如下：

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

仅接受上述字段：`format` / `version` 必须匹配；ID 为小写字母开头的 1–64 个小写字母、数字或连字符；名称 1–40、说明 0–200（可省略）、人设 20–8000 个字符（均 trim 后校验）。库最多保存 20 个包，超限、格式错误或重复 ID 均不写入；名称可重复，ID 不可重复。导入保留包 ID，内置 `general`/`cat`/`whale` 与 `custom` 导出后再导入会以 `imported-` 前缀作为独立副本；创建接口生成 `role-UUID` 标识。删除当前自建或导入包恢复为 `general`；内置包不可删除。

配置公开视图的 `personas` 包含 `id`/`name`/`description`/`prompt`/`builtin`，自建或导入条目另含 `format`/`version`。角色包导出采用严格白名单，不含 API 配置、凭据、运行限制或聊天记录。管理路由见 [api.md](api.md) §13，均沿用管理端鉴权；界面导入文件上限 64 KiB。

`builtinPersonaOverrides` 默认为空数组，随 AI 配置一同持久化；仅接受 `general`/`cat`/`whale` 的完整条目，ID 不重复且内置名称固定。公开配置不单独暴露该数组，而是在 `personas` 中合并呈现。更新接口原位保存名称、简介与指南（内置角色仅改简介与指南，不可增删改名；恢复默认即删除对应覆盖条目）。新建或导入会选中新角色，更新或恢复默认不改变当前选择。

旧版自建包若已占用 `whale` ID，读取时自动映射为未占用的 `imported-whale`（冲突时递增数字后缀），保留名称、正文与各平台选择；读取本身不写库，下次正常配置保存时在同一事务内提交迁移结果，失败保留原记录。

已有配置未保存 `personaId` 时，存在 `systemPrompt` 则保留为 `custom`，否则保留为 `cat`；旧工具开关缺失时按旧版 `true` 默认读取（含 `functionCallingEnabled`），首次保存写入迁移值（新配置仍全部默认关闭）。仅更新 `systemPrompt` 的旧调用方自动选中 `custom`，切换角色不覆盖自定义草稿。

公开视图的 `hasCustomPersona` 在当前选中 `custom` 或 `systemPrompt` 不同于通用默认模板时为 `true`，确保切走后仍可重新选回原有自定义角色；已编辑的内置覆盖内容继续保留，恢复默认后采用新版指南。

各平台的人格选择由 `config-store.js` 在同一配置事务内记录到 `ai_configuration` 的 `providerPersonaIds` JSON 行（键为 `modelProvider`，值为人格 ID），经公开配置只读返回，不接受客户端直接覆盖。切回平台时优先恢复上次选择，无记录则沿用当前兼容人格（小猫/鲸鱼娘不适用于目标平台时改选 `general`）；删除角色时同步将引用该角色的平台记录改为 `general`。

上下文以“可信房间 + 观众 UID + 角色 ID / 替换触发词后的人设正文”作为作用域；换房间、换角色、编辑人设或修改触发词均不会串读另一身份的记忆。缺少房间或 UID 时不读写持久记忆，昵称仅用于提及和限流。存储方式见 [storage.md](storage.md) §3.1。

## 8. 月度配额与审计日志

### 8.1 第三方 API 月度配额（`api-quota-store`）

[ai-runtime.js](../../../src/server/ai-runtime.js) 创建 `createAiApiUsageStore(songDb)` 并注入 `createAiApiQuotaStore(usageStore)`。配额模块仅调用 `consume`/`release`/`read`/`pruneBefore` 存储端口，负责月份、类别上限、预留生命周期与工具错误规则；SQLite 语句与原子计数由 [ai-api-usage-store.js](../../../src/storage/ai-api-usage-store.js) 负责。

按**北京时间月份**计数的本机请求次数上限用于限制第三方调用（保守安全预算，非供应商账单统计），计数存于 `ai_api_usage` 表 `PK(category, month_key)`：

| category | 月度上限 | 覆盖工具 | 触顶错误码 |
| --- | --- | --- | --- |
| `qweather` | 40 000 | `get_weather` | `QWEATHER_MONTHLY_LIMIT` |
| `amap_search` | 4 000 | `search_places` | `AMAP_SEARCH_MONTHLY_LIMIT` |
| `amap_lbs` | 120 000 | `resolve_location`、`get_route` | `AMAP_LBS_MONTHLY_LIMIT` |

出处：[api-quota-store.js:3-19](../../../src/ai/api-quota-store.js#L3-L19)。

计数与判定原子化：`INSERT … ON CONFLICT(category, month_key) DO UPDATE … WHERE request_count < limit RETURNING request_count`，返回空行即触顶拒绝。月份键 `getBeijingMonthKey` 按 UTC+8 截取 `YYYY-MM`。天气与地图工具在本地配置校验及 `throwIfAborted` 通过后，经 `withApiQuota` 扣减一次额度并立即发起请求：成功、超时、网络错误、上游拒绝、发起后取消及结果解析失败均保留计数；连接测试亦计入，每个上游子请求分别计数；发送前已取消、缺配置或额度耗尽时不发请求、不扣额度。

配额模块在初始化及跨月读写时回收上上月及更早计数，仅保留北京当月与上月（供跨月未提交预留撤销）；系统时钟回拨时不删未来月份，避免重新放开已耗尽的预算。该清理属于配额自身生命周期，独立于请求审计保留天数。

该计费口径参考 [express-rate-limit 默认计入失败请求](https://express-rate-limit.mintlify.app/reference/configuration#skipfailedrequests) 的做法，仅作为本地调用预算上限，不代表供应商实际计费口径（例如 [和风天气](https://dev.qweather.com/help/) 声明非 2xx 不计费）。保留既有月度计数，历史已退回的失败请求不补记；`requireApiQuota` 与显式预留/撤销辅助保留兼容，天气/地图工具不会因请求失败调用撤销。模型调用本身不计入这三类配额。测试见 [ai-api-quota-store.test.js](../../../test/ai/ai-api-quota-store.test.js)、[ai-tools.test.js](../../../test/ai/ai-tools.test.js)。

### 8.2 请求诊断摘要（`request-logger`）

- **文件**：`buildAiRuntime` 以数据目录父级的 `logs/` 为根，正常摘要写 `logs/runtime/ai.jsonl`，错误核心写 `logs/errors/ai.jsonl`（仅在有真实记录时创建）。正常文件 1 MiB / 3 天、错误文件 3 MiB / 14 天，各保留活动文件及两份归档，先达容量或时间上限即淘汰旧记录。桌面维护从旧 `logs/ai.log` 提取仍有效的错误核心后清理旧记录；直接构造 logger 仅传 `filePath` 时保留单文件兼容模式。统一维护见 [桌面日志](../desktop/main.md#8-日志)。
- **正常摘要**：`request_succeeded` 按 `provider`/`model`/`purpose`/`protocol` 在 15 分钟活动窗口汇总（最多 128 组，超出归入 `other`），记录成功/失败数、token、工具调用数、最大耗时与固定耗时桶。有效数值 `firstTextMs` 另汇总为可选 `firstText: {count, maxMs, buckets}`（桶边界 ≤250、≤1000、≤5000、≤15000、>15000 ms；不接受非有限值或将缺失值记为 0）。退出时 `flush()` 保存未到期的非空窗口，不输出空摘要。
- **错误与准入**：`request_failed` 保存脱敏错误核心（已知密钥全文替换）；普通 JSONL 最终 UTF-8 ≤ 2 KiB，错误 ≤ 16 KiB。每分钟最多 120 条错误，相同 `provider`/`model`/`purpose`/错误核心最多 5 条；失败总数仍计入活动摘要，被抑制数量由 `getHealth().suppressedErrorEntries` 及下一窗口错误记录报告。待写队列上限 2,000 条 / 4 MiB 并为错误预留空间，串行写入复用共享轮转器；溢出或写入失败仅计数，不向业务抛错。

**数据库审计**：`ai_request_logs` 表由 `store.logRequest` 写入 `uid`/`user_name`/`category`/`status`/`latency_ms`/`input_tokens`/`output_tokens`/`tool_calls`/`error_code`（截断上限见 [config-store.js](../../../src/ai/config-store.js)）；`category` 取 `cache`/`safety`/`tool`/`chat`/`failure`（生成）与 `delivery`/`generation`（失败），`status` 取 `generated`/`failed`。默认保留 30 天（`aiRequestLogRetentionDays`，`0` 禁用），支持 dry-run 与删除计数，不影响 `ai_api_usage` 配额、配置或黑名单。全部清库范围见 [storage.md](storage.md) §5–§6。

## 9. 弹幕交付与送达验证

### 9.1 发送节奏

定向问答的 `deliverReply`（[ai-assistant-service.js](../../../src/ai/ai-assistant-service.js)）：

| 事实 | 值 | 出处 |
| --- | --- | --- |
| 回复间隔 | 距上次发送 500–2000 ms 随机（不足则等待） | [ai-assistant-service.js:18-19](../../../src/ai/ai-assistant-service.js#L18-L19)、[296-302](../../../src/ai/ai-assistant-service.js#L296-L302) |
| 分段间隔 | 每条分块 200–600 ms 随机（`intervalMs`） | [ai-assistant-service.js:20-21](../../../src/ai/ai-assistant-service.js#L20-L21)、[233-239](../../../src/ai/ai-assistant-service.js#L233-L239) |
| 发送参数 | `mentionEveryChunk: true`（每段带 `@用户名`）、`rateLimitIntervalMs: 0`（绕过发送器全局限速，由 AI 自行控速）、`waitForRateLimit: true` | [server.js:260](../../../src/server.js#L260)、[ai-assistant-service.js:233-239](../../../src/ai/ai-assistant-service.js#L233-L239) |

自动接话仅发一条，同样遵守最近 AI 回复间隔，但不传 `rateLimitIntervalMs: 0`，继续受共用 sender 默认 1500 ms 节流控制（自身评估与提交上限见 §3.4）。单人回复仅在 `autoReplyMentionEnabled === true` 时提及，否则与群聊一样传 `mentionTarget: null`，不伪造请求者。`onBeforeSend` 终检通过后标记已提交，送达确认前不写记忆或 `botReplies`。

### 9.2 送达验证（`danmaku-delivery-verifier`）

定向任务准入或自动候选确立时，由 [bilibili-runtime.js](../../../src/server/bilibili-runtime.js) 捕获当前房间、监听代次、认证 provider、账号操作代次与当前 UID；自动候选持有该捕获 Promise，不在生成时才绑定新账号。每条普通消息仅比对轻量 `getReplySessionKey`，不逐条读取凭据；捕获失败按会话失效处理。生成、排队、限流等待、分段发送、送达确认与定向重试均校验同一会话；切房、退出或账号变化会取消旧任务，不写对话上下文，也不记普通交付失败。新任务重新捕获当前身份，发送前刷新身份；已发出的上游请求无法撤回，但后续动作立即停止。手动发送保持原有行为。测试见 [ai-assistant-session.test.js](../../../test/ai/ai-assistant-session.test.js)、[danmaku-sender-session.test.js](../../../test/danmaku/danmaku-sender-session.test.js)。

发送器在每段 `onBeforeSend` 登记发送账号、正文与提及名。`observe(danmaku)` 在空闲时直接返回，有发送或等待任务时才检查对应账号的弹幕。若回显先于发送接口返回，验证器将其保存在对应发送记录上。`waitForDelivery` 先匹配已到的回显，再等待后续分段，直到本次发送的全部消息都得到确认。[接入入口](../../../src/server/bilibili-client.js) · [送达验证器](../../../src/ai/danmaku-delivery-verifier.js)

- 登记时先归一化账号、正文和提及名。房间回显可以带 `@用户名 ` 前缀，也可以只含正文。等待者只消费发送起点以来、同账号且提及目标相符的已登记回显，每次确认一个尚缺的分段。未指定提及名的分段也支持裸正文匹配。多出的同文回显留给下一次匹配。[送达验证器](../../../src/ai/danmaku-delivery-verifier.js)
- 确认等待上限为 10 秒。尚未进入等待的发送记录及其早到回显按 60 秒有效期回收。
- **定向问答重试**：未确认送达时最多尝试 3 次（含首次，即最多重试 2 次，`MAX_DELIVERY_ATTEMPTS` / `deliverReply`）。重试前按**原问题与同一份历史重新生成单条精简回复**（`bypassCache: true, singleMessage: true`），主生成、工具后续、适用的输出审核与截断统一按扣除 `@` 昵称后的单条预算执行，保留核心答案、不推进额外游戏回合。未完整送达的版本不写入历史，仅最终确认送达的答案入库。三次均未确认送达抛 `DANMAKU_SWALLOWED` 并记 `delivery` 失败日志；发送本身抛错直接进协调器失败处理，不进入该重试循环。自动任务送达不明时直接结束本候选，不重写或补发。测试见 [ai-assistant-delivery.test.js](../../../test/ai/ai-assistant-delivery.test.js)。
- **取消与释放**：`waitForDelivery` 监听本轮任务与关闭合并后的 `AbortSignal`；总开关关闭立即以 `false` 释放该轮 waiter（不销毁共用验证器），`dispose()` 幂等清理全部定时器并以 `false` 释放 waiter；两类取消均不触发重生成或普通交付失败审计（停服完整流程见 §10）。

### 9.3 失败回复文案

定向问答的 `failureReply`（[ai-assistant-helpers.js](../../../src/ai/ai-assistant-helpers.js)）按错误码前缀（`UPSTREAM_TIMEOUT` / `WEB_SEARCH_` / `QWEATHER_` / `AMAP_` / `AI_NOT_CONFIGURED` 等）映射为面向观众的友好提示文案；未识别错误统一回复“这次查询没完成，换个问法或稍后再试～”。自动任务失败静默，生成诊断以 `category: 'auto'` 记录动作、跳过原因或安全错误码。`getStatus` 暴露 `lastError`（截断 160 字符）供管理页诊断。

## 10. 持久化与故障行为

`ai-runtime.js` 创建 `createAiStateStore(songDb)` 并注入 `createAiConfigStore(persistence, secretCodec, options)`。存储适配器负责 SQL 执行、表结构映射与配置事务，仅向领域层返回普通数据对象；领域层负责配置与角色规则、密钥加解密、origin 校验、公开脱敏、TTL、作用域哈希和内存缓存。`updateConfiguration` 在事务内写入配置及平台人格映射，再以候选配置行执行领域校验；仅在 COMMIT 成功后才发布新缓存，任何写入、校验或提交失败均保留原配置。

| 表 | 用途 | 出处（DDL 见 [storage.md](storage.md) §3.1） |
| --- | --- | --- |
| `ai_configuration` | 配置 + 密钥（`is_secret`） | [ai-state-store.js](../../../src/storage/ai-state-store.js) |
| `ai_request_logs` | 请求审计 | [ai-state-store.js](../../../src/storage/ai-state-store.js) |
| `ai_api_usage` | 月度配额计数 | [ai-api-usage-store.js](../../../src/storage/ai-api-usage-store.js)、[api-quota-store.js](../../../src/ai/api-quota-store.js) |
| `ai_viewer_context` | 观众/角色上下文（`uid` 列存作用域摘要，`expires_at`） | [ai-state-store.js](../../../src/storage/ai-state-store.js) |
| `ai_query_cache` | 查询缓存（`cache_key = sha256`） | [ai-state-store.js](../../../src/storage/ai-state-store.js) |
| `ai_blacklist` | 黑名单（`uid` 主键、`reason`） | [ai-state-store.js](../../../src/storage/ai-state-store.js) |

上下文与查询缓存由 [config-store.js](../../../src/ai/config-store.js) 在初始化、命中过期读取及写入时按需调用存储适配器删除 `expires_at <= now()` 的行（写入清理间隔至少 60 秒，检测到时钟回拨则立即检查）。[ai-runtime.js](../../../src/server/ai-runtime.js) 另每 60 秒定时触发同一清理（定时器 `unref`，关闭开始时同步取消），确保无人发言时也能回收过期记录。逻辑过期立即生效，物理清理最多延迟一个周期；配置、黑名单、月度配额、审计及豆包网页记录不在此清理范围内。

以下失败文案与重试规则适用于定向问答；自动任务的静默与停止语义见 §3.4。

| 故障 | 行为 |
| --- | --- |
| 上游超时/不可用 | `fetchJson` 归一化为 `UPSTREAM_TIMEOUT` / `UPSTREAM_UNAVAILABLE`，回复文案见 §9.3，失败入日志 |
| 第三方配额触顶 | 工具调用失败 → 该工具当次会话停用，按实际可用能力建议搜索或说明无法核实（§5）；配额按月自动重置 |
| 模型空回复/截断 | `DEEPSEEK_OUTPUT_TRUNCATED` / `DEEPSEEK_INVALID_RESPONSE` 按失败文案回复 |
| 弹幕未完整送达 | 送达验证 10 秒超时 → 按原问题生成单条精简回复后重发，最多 3 次（含首次）；仍失败记 `delivery` 失败 |
| 密钥缺失/不可加密 | 独立模式写入密钥抛错（§7.2）；未配置时 `handleDanmaku` 直接返回 `disabled_or_unconfigured` |
| 服务关闭 | `aiRuntime.shutdown()` 请求合并（并发复用）：同步清理上下文定时清理器，停止准入并触发 `AI_SHUTDOWN`，丢弃未开始任务；并行等待助手活跃生成/当前投递/直连 provider 操作与 ChatGPT 会话及 OAuth 回调关闭（取消后不再发送、重试或写上下文/缓存/审计）；最后释放 `danmakuDeliveryVerifier` 并 `flush()` 请求日志（目录见 §8.2）。已发出的上游弹幕仅等待完成、无法撤回。见 [server-core.md](server-core.md) §6.2 |
