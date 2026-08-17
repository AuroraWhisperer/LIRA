# AI 弹幕姬(小爱)集成

> 涉及文件:[src/ai/config.js](../../../src/ai/config.js)、[src/ai/config-store.js](../../../src/ai/config-store.js)、[src/ai/secret-codec.js](../../../src/ai/secret-codec.js)、[src/ai/deepseek-client.js](../../../src/ai/deepseek-client.js)、[src/ai/http-client.js](../../../src/ai/http-client.js)、[src/ai/prompt.js](../../../src/ai/prompt.js)、[src/ai/safety.js](../../../src/ai/safety.js)、[src/ai/xiaomi-ai-service.js](../../../src/ai/xiaomi-ai-service.js)、[src/ai/async-coordinator.js](../../../src/ai/async-coordinator.js)、[src/ai/danmaku-delivery-verifier.js](../../../src/ai/danmaku-delivery-verifier.js)、[src/ai/api-quota-store.js](../../../src/ai/api-quota-store.js)、[src/ai/request-logger.js](../../../src/ai/request-logger.js)、[src/ai/tools/qweather-tool.js](../../../src/ai/tools/qweather-tool.js)、[src/ai/tools/amap-tool.js](../../../src/ai/tools/amap-tool.js)、[src/ai/tools/web-search-tool.js](../../../src/ai/tools/web-search-tool.js)、[src/ai/tools/current-time-tool.js](../../../src/ai/tools/current-time-tool.js)

本文档描述"AI 弹幕姬"领域模块:`src/ai/` 下的全部实现。HTTP 端点仅在此以文字提及并链接 [api.md](api.md) §14;AI 相关表 DDL 与设置见 [storage.md](storage.md) §3.1;弹幕触发链见 [bilibili/danmaku.md](bilibili/danmaku.md);进程装配与关闭时序见 [server-core.md](server-core.md) §5–§6。

## 1. 概览与触发链

AI 弹幕姬是一个由 DeepSeek 驱动、以"小米"(直播间橘猫)人格回复弹幕的聊天机器人。弹幕消息经 [server.js:611-631](../../../src/server.js#L611-L631) 的 `onMessage` 回调进入:`aiDanmakuDeliveryVerifier.observe(danmaku)`(投递验证,见 §9)→ 常规弹幕机器人链 → `xiaomiAi.handleDanmaku({message, userName, uid})`。返回值被忽略(fire-and-forget),机器人异步排队生成并发送回复。

| 事实 | 值 | 出处 |
|---|---|---|
| 角色人格 | `SYSTEM_PROMPT`:直播间橘猫"小米",含 `<identity>/<priority>/<tool_policy>/<safety>` 等段落 | [prompt.js:7-62](../../../src/ai/prompt.js#L7-L62) |
| 模型后端 | DeepSeek;默认模型 `deepseek-v4-flash`(旧别名 `ds-v4-flash` 自动归一化) | [config.js:16](../../../src/ai/config.js#L16)、[config.js:79](../../../src/ai/config.js#L79) |
| 触发关键词 | 配置键 `trigger`,默认 `'小米'`,1–12 字符;消息中出现即触发 | [config.js:13](../../../src/ai/config.js#L13)、[xiaomi-ai-service.js:308-316](../../../src/ai/xiaomi-ai-service.js#L308-L316) |
| 就绪条件 | `isAiReady`:enabled + deepseekResponsesUrl + deepseekApiKey + model 全部非空 | [config.js:106-113](../../../src/ai/config.js#L106-L113) |
| 回复发送 | `sendReply` = `danmakuSender.send({…, waitForRateLimit: true})`,等待发送频率而非抛错 | [server.js:260](../../../src/server.js#L260) |
| 关闭时序 | 服务关闭第一步 `xiaomiAi.shutdown()` → 协调器 stop,丢弃排队任务 | [xiaomi-ai-service.js:289-291](../../../src/ai/xiaomi-ai-service.js#L289-L291)、[server-core.md](server-core.md) §6.2 |

## 2. 弹幕准入链(handleDanmaku)

`handleDanmaku`([xiaomi-ai-service.js:56-72](../../../src/ai/xiaomi-ai-service.js#L56-L72))按序检查,任一失败即返回 `{accepted: false, reason}`:

| 检查 | 语义 | 出处 |
|---|---|---|
| 就绪检查 | `isAiReady` 不成立 → `disabled_or_unconfigured` | [xiaomi-ai-service.js:57-58](../../../src/ai/xiaomi-ai-service.js#L57-L58) |
| 触发词匹配 | `extractTriggeredQuestion` 在消息中定位 `trigger`,两侧文本拼回作为问题;空问题回退为"和大家打个招呼";未命中 → `not_triggered` | [xiaomi-ai-service.js:60-61](../../../src/ai/xiaomi-ai-service.js#L60-L61)、[308-316](../../../src/ai/xiaomi-ai-service.js#L308-L316) |
| UID 归一化 | 无 uid 时用 `name:<userName>` 作为身份键 | [xiaomi-ai-service.js:62](../../../src/ai/xiaomi-ai-service.js#L62) |
| 黑名单 | `store.isBlacklisted(uid)` 命中 → `blacklisted`(表 `ai_blacklist`) | [xiaomi-ai-service.js:63](../../../src/ai/xiaomi-ai-service.js#L63)、[config-store.js:95-98](../../../src/ai/config-store.js#L95-L98) |
| 本地安全规则 | `checkLocalInput` 命中硬规则 → 以 `localRefusal` 直接入队(不再调用模型),见 §6 | [xiaomi-ai-service.js:64-70](../../../src/ai/xiaomi-ai-service.js#L64-L70) |
| 用户冷却 | `userCooldownSeconds`(默认 0)内同一 uid 重复触发 → `user_rate_limited` | [xiaomi-ai-service.js:80-90](../../../src/ai/xiaomi-ai-service.js#L80-L90) |
| 全房间限速 | 60 秒滑动窗口内最多 `roomLimitPerMinute`(默认 20)条 → `room_rate_limited` | 同上 |
| 队列上限 | `coordinator.getStatus().queued >= queueLimit`(默认 30)→ `queue_full` | [xiaomi-ai-service.js:67](../../../src/ai/xiaomi-ai-service.js#L67) |
| 入队 | 通过 → `{accepted: true, reason: 'queued'}`(协调器已停止时为 `'stopped'`) | [xiaomi-ai-service.js:74-78](../../../src/ai/xiaomi-ai-service.js#L74-L78) |

## 3. 回复生成管线与协调器

### 3.1 生成管线(generateReply)

[generateReply](../../../src/ai/xiaomi-ai-service.js#L92-L179) 按序执行:

1. **本地拒绝短路**:`item.localRefusal` 直接返回,`category: 'safety'`,不消耗模型配额。
2. **查询缓存**:缓存键 `"${model}\n${question}"`(sha256 落库),命中返回 `category: 'cache'`;投递重试时 `bypassCache` 强制绕过([xiaomi-ai-service.js:98-100](../../../src/ai/xiaomi-ai-service.js#L98-L100)、[250](../../../src/ai/xiaomi-ai-service.js#L250))。
3. **输入安全审核**:`runSafetyReview(buildInputReviewPrompt(question))` 未通过 → 直接返回拒答。
4. **观众上下文**:按 uid 读取 `ai_viewer_context` 中的上轮 `{question, answer}`,以"短期上下文"前缀拼入本次问题([buildConversationInput](../../../src/ai/xiaomi-ai-service.js#L322-L325))。
5. **主生成**:`deepseek.createResponse`(见 §4),`instructions` = 人格预设 + `<runtime_task_policy>` 长度合约([buildReplyInstructions](../../../src/ai/xiaomi-ai-service.js#L331-L342))。
6. **工具循环**:`response.functionCalls` 非空时执行工具(§5),结果以 `function_call_output` 回填并带 `previousResponseId` 续问;累计调用超过 `maxToolCalls`(默认 6)→ `TOOL_LIMIT`。
7. **输出安全与质量审核**:`runSafetyReview(buildOutputReviewPrompt(question, rawText))` 未通过 → 用模型给出的 `safeText` 或 `SAFE_REFUSAL` 替换。
8. **截断与落库**:按长度预算 `truncateReply`(超出截断加 `…`);写上下文、写缓存、写 `ai_request_logs`(`category` 为 `tool`/`chat`,工具调用数 > 0 记 `tool`)。

长度预算([getReplyLengthBudget](../../../src/ai/xiaomi-ai-service.js#L344-L354)):单条弹幕 `DANMAKU_MESSAGE_LIMIT = 40` 减去 `@用户名 ` 长度,允许 1–3 条;偏好长度 `replyMaxChars`(默认 50,10–50 区间)仅是偏好不是目标。运行时预算会覆盖人格预设中的"50 字符"旧表述。

输出 token 上限按是否开启思考模式切换:`MODEL_OUTPUT_TOKENS = 3072` / `REASONING_OUTPUT_TOKENS = 4096`,审核请求固定 `REVIEW_OUTPUT_TOKENS = 384`([xiaomi-ai-service.js:22-24](../../../src/ai/xiaomi-ai-service.js#L22-L24)、[371-373](../../../src/ai/xiaomi-ai-service.js#L371-L373))。

### 3.2 顺序协调器(createOrderedAsyncCoordinator)

[async-coordinator.js:8-83](../../../src/ai/async-coordinator.js#L8-L83) 提供"生成有界并发、投递严格按序"的语义:

| 事实 | 值 | 出处 |
|---|---|---|
| 生成并发 | 由 `generationConcurrency`(默认 3,1–5)控制同时生成的回复数 | [async-coordinator.js:29-44](../../../src/ai/async-coordinator.js#L29-L44) |
| 投递顺序 | 按入队序号 `nextSequence/nextDelivery` 串行投递,前一条完成后才投下一条(同观众多段回复不会插队) | [async-coordinator.js:46-64](../../../src/ai/async-coordinator.js#L46-L64) |
| 失败隔离 | 生成或投递抛错 → `onError`(记 `delivery`/`generation` 失败日志),不阻断后续序号 | [async-coordinator.js:53-58](../../../src/ai/async-coordinator.js#L53-L58) |
| 停止 | `stop()` 清空 waiting/completed,已停止后 `enqueue` 返回 false，并返回等待 active generation/当前 delivery 结束的 drain Promise；active 结果不会重新进入 completed | [async-coordinator.js](../../../src/ai/async-coordinator.js) |
| 状态 | `getStatus()`:`queued/waiting/generating/ready/delivering`,经 `GET /api/ai/status` 暴露 | [async-coordinator.js:66-74](../../../src/ai/async-coordinator.js#L66-L74) |

## 4. DeepSeek 客户端(双协议路由)

[deepseek-client.js](../../../src/ai/deepseek-client.js) 的 `createDeepSeekClient` 是唯一模型出口,所有请求经 [http-client.js](../../../src/ai/http-client.js) 的 `fetchJson`(外部 shutdown signal 与请求 timeout signal 合并、响应体 ≤ 2 MB、错误码归一化)。外部取消保留稳定 `AI_SHUTDOWN` 原因，不被误报为普通上游超时。

### 4.1 协议选择

| 协议 | 条件 | 请求体要点 | 出处 |
|---|---|---|---|
| **Responses API**(默认) | 配置的 `deepseekResponsesUrl` 不是官方端点时原样使用 | `{model, instructions, input, tools, max_output_tokens(≥64), previous_response_id?}`;`reasoningEnabled` 为 false 时附 `reasoning: {effort: 'none'}` | [deepseek-client.js:13-40](../../../src/ai/deepseek-client.js#L13-L40) |
| **Chat Completions**(自动适配) | URL 为 `api.deepseek.com` 且路径 ∈ `['', '/v1', '/chat/completions', '/v1/chat/completions']` 时(`resolveOfficialChatEndpoint`),自动改写为 `/chat/completions` 并切换协议 | `{model, messages, max_tokens, stream: false}`;`reasoningEnabled` 为 false 时附 `thinking: {type: 'disabled'}`;工具转 `tools`(function) | [deepseek-client.js:192-203](../../../src/ai/deepseek-client.js#L192-L203)、[42-72](../../../src/ai/deepseek-client.js#L42-L72)、[263-293](../../../src/ai/deepseek-client.js#L263-L293) |

双协议的**回退行为**:Chat Completions 路径用内存 `chatHistory` Map(上限 100 条)以 `previousResponseId` 为键保存历史,续问时拼接 `messages` 并删除旧键([deepseek-client.js:130-134](../../../src/ai/deepseek-client.js#L130-L134)、[249-261](../../../src/ai/deepseek-client.js#L249-L261));Responses 路径用官方 `previous_response_id`。

### 4.2 响应归一化与错误

两个协议都归一为同一形状 `{id, text, functionCalls[], finishReason, usage{inputTokens, outputTokens}}`:

- Responses:`normalizeResponse` 遍历 `output[]` 的 `function_call` 与 `output_text` 内容,兼容顶层 `output_text`([deepseek-client.js:304-333](../../../src/ai/deepseek-client.js#L304-L333))。
- Chat Completions:`normalizeChatResponse` 取 `choices[0].message` 的 `tool_calls` 与 `content`([deepseek-client.js:205-232](../../../src/ai/deepseek-client.js#L205-L232))。
- 空响应:finishReason 为 `length`/`max_output_tokens` → `DEEPSEEK_OUTPUT_TRUNCATED`,否则 `DEEPSEEK_INVALID_RESPONSE`;工具参数 JSON 解析失败同样按截断处理([deepseek-client.js:99-104](../../../src/ai/deepseek-client.js#L99-L104)、[347-355](../../../src/ai/deepseek-client.js#L347-L355))。

辅助接口:`listModels`(GET `https://api.deepseek.com/models` + Bearer Key,去重排序,[136-150](../../../src/ai/deepseek-client.js#L136-L150));`testConnection`(发"你好"取 200 字回复,401/403/AUTH 类错误码 → `DEEPSEEK_AUTH_FAILED`,[152-187](../../../src/ai/deepseek-client.js#L152-L187))。

### 4.3 请求日志脱敏

`sendModelRequest` 对每个请求写 `request/response/normalized_response/error` 四类事件([deepseek-client.js:74-123](../../../src/ai/deepseek-client.js#L74-L123));`sanitizeRequestBodyForLog` 删除 `instructions` 字段、Chat Completions 的 system 消息替换为 `[system prompt omitted]`([335-345](../../../src/ai/deepseek-client.js#L335-L345)),落盘前再由 request-logger 做密钥替换(§8)。

## 5. 工具集

`buildTools(config)`([prompt.js:141-152](../../../src/ai/prompt.js#L141-L152))按开关组装配:`webSearchEnabled` 时追加内建 `web_search` 工具,`weatherEnabled/placesEnabled/routesEnabled` 控制 `FUNCTION_TOOLS` 五个函数([prompt.js:64-139](../../../src/ai/prompt.js#L64-L139))。

| 工具名 | 提供者 | 上游接口/行为 | 出处 |
|---|---|---|---|
| `get_weather` | 和风天气 qweather | 地点先走 `/geo/v2/city/lookup`(取前 5,重名跨省返回 `ambiguous` 候选);`date` 非 today/now 时 `/v7/weather/3d` 预报,否则 `/v7/weather/now`;`air`/`warning` 分别走 `/v7/air/now`、`/v7/warning/now` | [qweather-tool.js:10-63](../../../src/ai/tools/qweather-tool.js#L10-L63) |
| `search_places` | 高德 amap | `/v3/place/text`(city/district/location 可选,offset 5,extensions=base),取前 5 POI | [amap-tool.js:37-49](../../../src/ai/tools/amap-tool.js#L37-L49) |
| `resolve_location` | 高德 amap | `/v3/geocode/geo` 解析地址 → `{formattedAddress, province, city, district, adcode, location}`;多结果标记 `ambiguous` | [amap-tool.js:27-35](../../../src/ai/tools/amap-tool.js#L27-L35) |
| `get_route` | 高德 amap | 起终点经 `ensureCoordinate` 统一为坐标;`transit` → `/v3/direction/transit/integrated`,其余 `/v3/direction/<mode>`;结果取第一条 `paths[0]`/`transits[0]` 的距离与时长 | [amap-tool.js:51-62](../../../src/ai/tools/amap-tool.js#L51-L62)、[104-113](../../../src/ai/tools/amap-tool.js#L104-L113) |
| `web_search` | Bing RSS | `https://www.bing.com/search?format=rss&q=…`(查询 ≤ 200 字符),解析 `<item>` 前 5 条为 `{title, snippet, url}`;空结果 → `WEB_SEARCH_EMPTY` | [web-search-tool.js:5-41](../../../src/ai/tools/web-search-tool.js#L5-L41) |
| `get_current_time` | 本地 | `Intl.DateTimeFormat('zh-CN', {timeZone})` 格式化,默认 `Asia/Shanghai`;返回 `{timeZone, formatted, isoUtc}`;无效时区抛错 | [current-time-tool.js:3-16](../../../src/ai/tools/current-time-tool.js#L3-L16) |

**工具调用回路**:`executeTool` 按 `call.name` 分派([xiaomi-ai-service.js:193-201](../../../src/ai/xiaomi-ai-service.js#L193-L201));结果 `JSON.stringify` 为 `function_call_output` 回喂模型(§3.1 第 6 步)。**配额降级**:工具抛月度配额错误(§8)时,`executeToolWithQuotaFallback` 把该工具名加入 `excludedToolNames`(本次会话内后续请求不再下发该工具)并返回 `{unavailable: true, reason: 'monthly_api_quota_reached', instruction}` 让模型改用 `web_search` 或如实说明([xiaomi-ai-service.js:203-218](../../../src/ai/xiaomi-ai-service.js#L203-L218));生成前也按 `quotaStore.getExcludedToolNames()` 预先裁剪工具列表([116-117](../../../src/ai/xiaomi-ai-service.js#L116-L117))。

**测试接口**:`testProvider('qweather'|'amap'|'deepseek')` 分别调用各工具 `testConnection`(校验 Key/错误码映射),经 `/api/ai/test/*` 暴露。

## 6. 安全过滤(两道)

1. **本地硬规则** `checkLocalInput`([safety.js:3-18](../../../src/ai/safety.js#L3-L18)):四类正则——`sexual`(色情)、`illegal`(违法)、`privacy`(隐私信息)、`prompt_injection`(提示词注入/越狱);命中返回固定 `SAFE_REFUSAL = '这个不适合直播间回答，换个轻松问题吧喵～'`。在入队前执行,不消耗模型配额。
2. **LLM 审核** `runSafetyReview`([xiaomi-ai-service.js:181-191](../../../src/ai/xiaomi-ai-service.js#L181-L191)):输入审核与输出审核各发起一次独立 DeepSeek 调用,要求只输出 JSON。`parseSafetyReview`([safety.js:28-40](../../../src/ai/safety.js#L28-L40))解析失败时**拒绝放行**并以 `SAFE_REFUSAL` 兜底。输出审核同时承担质量校验:要求直接回应原问题、逐项满足硬约束、删除凑数推荐、保留确定事实不得编造([safety.js:24-26](../../../src/ai/safety.js#L24-L26))。

## 7. 配置与密钥

### 7.1 配置键

全部配置存 `ai_configuration` 表(**与 settings 表隔离**,避免通用设置接口回显密钥,见 [storage.md](storage.md) §3.1),默认值与数值区间定义在 [config.js:11-57](../../../src/ai/config.js#L11-L57):

| 分组 | 键 | 默认 | 说明 |
|---|---|---|---|
| 总开关 | `enabled` | `false` | 布尔 |
| 触发 | `trigger` | `'小米'` | 1–12 字符 |
| DeepSeek | `deepseekResponsesUrl` / `deepseekApiKey` / `model` | 空 / 空 / `deepseek-v4-flash` | URL 须为无账号信息的 HTTP(S);model ≤ 80 字符 |
| 行为开关 | `webSearchEnabled` / `reasoningEnabled` / `weatherEnabled` / `placesEnabled` / `routesEnabled` | true / false / true / true / true | 布尔;`reasoningEnabled` 关闭时双方协议都禁推理 |
| 第三方凭证 | `qweatherApiHost` / `qweatherApiKey` / `amapApiHost` / `amapApiKey` | 全空 | Host 缺协议自动补 `https://` |
| 数值 | `replyMaxChars` | 50 | 偏好长度,10–50 |
| 数值 | `generationConcurrency` | 3 | 生成并发,1–5 |
| 数值 | `queueLimit` | 30 | 排队上限,1–100 |
| 数值 | `sendIntervalMs` | 3000 | **仅作默认值存在,运行时未使用**(实际节奏见 §9 随机间隔) |
| 数值 | `userCooldownSeconds` | 0 | 用户冷却,0–3600 |
| 数值 | `roomLimitPerMinute` | 20 | 全房间限速,1–120 |
| 数值 | `requestTimeoutMs` | 12000 | 上游超时,3000–60000 |
| 数值 | `maxToolCalls` | 6 | 单轮最多工具调用,1–8 |
| 数值 | `cacheTtlSeconds` / `contextTtlSeconds` | 60 / 1200 | 查询缓存 / 观众上下文 TTL,0–3600 / 60–86400 |
| 人格 | `systemPrompt` | `SYSTEM_PROMPT` | 20–8000 字符;旧版内建人格启动时自动迁移为当前版本([config-store.js:27-33](../../../src/ai/config-store.js#L27-L33)) |

`normalizeAiConfig`([config.js:59-92](../../../src/ai/config.js#L59-L92))负责白名单过滤、布尔/数值归一化与越界抛错(400)。

### 7.2 密钥加密与访问控制

| 事实 | 值 | 出处 |
|---|---|---|
| 密钥键集合 | `AI_SECRET_KEYS = {deepseekApiKey, qweatherApiKey, amapApiKey}` | [config.js:5-9](../../../src/ai/config.js#L5-L9) |
| 存储标记 | 密钥以 `is_secret=1` 存 `ai_configuration`,写入时 `secretCodec.encrypt` | [config-store.js:49-78](../../../src/ai/config-store.js#L49-L78) |
| 加密实现 | `createElectronSecretCodec` 包装 Electron `safeStorage`(`isEncryptionAvailable()` 为真才可加密),值经 `encryptString` 后 Base64 落库;**刻意不提供明文回退**;非 Electron 独立模式 `isAvailable()` 为 false,写入密钥直接抛错"当前系统无法安全加密 API Key" | [secret-codec.js:3-31](../../../src/ai/secret-codec.js#L3-L31) |
| 读取降级 | 解密失败时该键置空并 `console.warn`(日志脱敏),不阻断其他配置读取 | [config-store.js:20-25](../../../src/ai/config-store.js#L20-L25) |
| 公开视图边界 | `getPublicConfig` 过滤 `AI_SECRET_KEYS` 全部密钥字段(不出现在返回对象中),替换为 `hasDeepSeekApiKey/hasQWeatherApiKey/hasAmapApiKey` 布尔标志与 `secretEncryptionAvailable`;`updateConfig` 返回同样经 `getPublicConfig` 过滤的结果,GET/PUT 响应均不回显密钥明文 | [config-store.js:38-46](../../../src/ai/config-store.js#L38-L46) |
| 前端遮罩 | 管理页密钥输入框类型为 `password`;已保存密钥渲染为 `'********'` 遮罩(display only);提交时遇 `'********'` 值则跳过该字段(保留现值);提示文案:"已加密保存；清空或输入新值以更新" | [xiaomi-ai-settings.js:266-283](../../../public/js/admin/xiaomi-ai-settings.js#L266-L283)、[256-264](../../../public/js/admin/xiaomi-ai-settings.js#L256-L264) |

管理端编辑经 `/api/ai/config`(`PUT`,密钥传 `''` 跳过、传 `null` 置空,见 [api.md](api.md) §14);连接测试/模型列表端点:`/api/ai/status`、`/api/ai/models`、`/api/ai/test`、`/api/ai/test/{deepseek,qweather,amap}`。

## 8. 月度配额与审计日志

### 8.1 第三方 API 月度配额(api-quota-store)

按**北京时间月份**计数的安全用量上限(防第三方账单失控),计数落 `ai_api_usage` 表 `PK(category, month_key)`:

| category | 月度上限 | 覆盖工具 | 触顶错误码 |
|---|---|---|---|
| `qweather` | 40 000 | `get_weather` | `QWEATHER_MONTHLY_LIMIT` |
| `amap_search` | 4 000 | `search_places` | `AMAP_SEARCH_MONTHLY_LIMIT` |
| `amap_lbs` | 120 000 | `resolve_location`、`get_route` | `AMAP_LBS_MONTHLY_LIMIT` |

[api-quota-store.js:3-19](../../../src/ai/api-quota-store.js#L3-L19)

计数与判定原子化:`INSERT … ON CONFLICT(category, month_key) DO UPDATE … WHERE request_count < limit RETURNING request_count`,返回空行即触顶拒绝([api-quota-store.js:23-43](../../../src/ai/api-quota-store.js#L23-L43))。月份键 `getBeijingMonthKey` = UTC+8 后截取 `YYYY-MM`([82-84](../../../src/ai/api-quota-store.js#L82-L84));工具在每次上游调用前经 `requireApiQuota` 消费配额([68-76](../../../src/ai/api-quota-store.js#L68-L76))。DeepSeek 本身不计入配额(由账户余额管理)。

### 8.2 请求审计日志(request-logger)

- **文件**:`logs/ai.log`,位于数据目录**父目录**下的 `logs/`(启动时写入会话头 `===== AI 日志会话 <ts> =====`)([server.js:69](../../../src/server.js#L69)、[request-logger.js:9-18](../../../src/ai/request-logger.js#L9-L18));默认路径 `process.cwd()/logs/ai.log`。
- **脱敏**:敏感键名(含 `authorization/api_key/secret` 等)整值替换 `[redacted]`,已知密钥字符串全文替换;单值截断 4000 字符([request-logger.js:6-7](../../../src/ai/request-logger.js#L6-L7)、[46-71](../../../src/ai/request-logger.js#L46-L71))。
- **事件类别**:`request / response / normalized_response / error`(DeepSeek 协议层,§4.3)+ 生成/投递结果;落盘为"摘要行 + 缩进 JSON"追加写。

**数据库审计**:`ai_request_logs` 表由 `store.logRequest` 写入 `uid/user_name/category/status/latency_ms/input_tokens/output_tokens/tool_calls/error_code`(各字段截断上限见 [config-store.js:80-93](../../../src/ai/config-store.js#L80-L93));`category` 取 `cache/safety/tool/chat/failure`(生成)与 `delivery/generation`(失败),`status` 取 `generated/failed`。该表与 `ai_api_usage` 均可被保留期/清库策略覆盖(见 [storage.md](storage.md) §5–§6)。

## 9. 弹幕交付与送达验证

### 9.1 发送节奏

`deliverReply`([xiaomi-ai-service.js:220-254](../../../src/ai/xiaomi-ai-service.js#L220-L254)):

| 事实 | 值 | 出处 |
|---|---|---|
| 回复间隔 | 距上次发送 500–2000 ms 随机(不足则等待) | [xiaomi-ai-service.js:18-19](../../../src/ai/xiaomi-ai-service.js#L18-L19)、[296-302](../../../src/ai/xiaomi-ai-service.js#L296-L302) |
| 分段间隔 | 每条分块 200–600 ms 随机,`intervalMs` | [xiaomi-ai-service.js:20-21](../../../src/ai/xiaomi-ai-service.js#L20-L21)、[233-239](../../../src/ai/xiaomi-ai-service.js#L233-L239) |
| 发送参数 | `mentionEveryChunk: true`(每段都带 @用户名)、`rateLimitIntervalMs: 0`(绕过发送器全局限速,由 AI 自行控速)、`waitForRateLimit: true` | [server.js:260](../../../src/server.js#L260)、[xiaomi-ai-service.js:233-239](../../../src/ai/xiaomi-ai-service.js#L233-L239) |

### 9.2 送达验证(danmaku-delivery-verifier)

直播间每条入站弹幕都经 `aiDanmakuDeliveryVerifier.observe(danmaku)` 缓冲([server.js:614](../../../src/server.js#L614))。`waitForDelivery`([danmaku-delivery-verifier.js:22-42](../../../src/ai/danmaku-delivery-verifier.js#L22-L42))等待本次发送的**全部消息**在房间弹幕流中出现:

- 匹配规则:同账号 uid、`observedAt >= sentAfter` 的弹幕,按内容逐条消费(去重已匹配项);带 `@用户名 ` 前缀时剥前缀后比对,兼容弹幕平台对 @ 的处理([danmaku-delivery-verifier.js:44-67](../../../src/ai/danmaku-delivery-verifier.js#L44-L67))。
- 超时:`DELIVERY_CONFIRM_TIMEOUT_MS = 10000`;事件缓冲 TTL 60 秒防泄漏([danmaku-delivery-verifier.js:5-6](../../../src/ai/danmaku-delivery-verifier.js#L5-L6))。
- **重试**:未确认送达时最多重试 3 次(`MAX_DELIVERY_ATTEMPTS = 3`,[16](../../../src/ai/xiaomi-ai-service.js#L16)),每次**重新生成**回复(`bypassCache: true`,避免原内容再次被吞),3 次仍失败 → 抛 `DANMAKU_SWALLOWED` 并记 `delivery` 失败日志([xiaomi-ai-service.js:248-253](../../../src/ai/xiaomi-ai-service.js#L248-L253))。
- **关闭**:`waitForDelivery` 接受 shutdown signal;`dispose()` 幂等清除全部 pending timer 并以 `false` 释放 waiter。shutdown 取消不触发重新生成/重试或普通 delivery 失败审计。

### 9.3 失败回复文案

`failureReply`([xiaomi-ai-service.js:385-395](../../../src/ai/xiaomi-ai-service.js#L385-L395))按错误码前缀(UPSTREAM_TIMEOUT / WEB_SEARCH_ / QWEATHER_ / AMAP_ / AI_NOT_CONFIGURED 等)映射为人话弹幕;未识别错误统一"这次查询没完成，换个问法或稍后再试～"。`getStatus` 暴露 `lastError`(截断 160 字符)供管理页诊断。

## 10. 持久化与故障行为

| 表 | 用途 | 出处(DDL 见 storage.md §3.1) |
|---|---|---|
| `ai_configuration` | 配置 + 密钥(is_secret) | [config-store.js:49-78](../../../src/ai/config-store.js#L49-L78) |
| `ai_request_logs` | 请求审计 | [config-store.js:80-93](../../../src/ai/config-store.js#L80-L93) |
| `ai_api_usage` | 月度配额计数 | [api-quota-store.js:23-43](../../../src/ai/api-quota-store.js#L23-L43) |
| `ai_viewer_context` | 观众上下文(uid PK,expires_at) | [config-store.js:114-129](../../../src/ai/config-store.js#L114-L129) |
| `ai_query_cache` | 查询缓存(cache_key = sha256) | [config-store.js:131-148](../../../src/ai/config-store.js#L131-L148) |
| `ai_blacklist` | 黑名单(uid PK,reason) | [config-store.js:100-112](../../../src/ai/config-store.js#L100-L112) |

过期的上下文/缓存行在读取时**惰性删除**(`getContext`/`getCache` 命中过期即删);`pruneExpired` 提供批量清理入口,当前运行时未挂定时器([config-store.js:114-153](../../../src/ai/config-store.js#L114-L153))。

故障行为(全部按实现):

| 故障 | 行为 |
|---|---|
| 上游超时/不可用 | `fetchJson` 归一化为 `UPSTREAM_TIMEOUT` / `UPSTREAM_UNAVAILABLE`,回复文案见 §9.3;失败已入日志 |
| 第三方配额触顶 | 工具调用失败 → 该工具当次会话停用 + 指令改用 web_search(§5);配额按月自动重置 |
| 模型空回复/截断 | `DEEPSEEK_OUTPUT_TRUNCATED` / `DEEPSEEK_INVALID_RESPONSE` 按失败文案回复 |
| 弹幕被吞(风控等) | 送达验证 10 秒超时 → 重新生成后重发,最多 3 次;仍失败记 `delivery` 失败 |
| 密钥缺失/不可加密 | 独立模式写入密钥抛错(§7.2);未配置时 `handleDanmaku` 直接 `disabled_or_unconfigured` |
| 服务关闭 | `aiRuntime.shutdown()` 单飞:停止准入并触发 `AI_SHUTDOWN`，丢弃未开始任务，等待 active generation/current delivery/direct provider 操作；取消后不再发送/重试或写 context/cache/audit，最后 dispose delivery verifier 并 flush `ai.log`。已开始的外部弹幕发送只能等待完成，不能撤回。见 [server-core.md](server-core.md) §6.2。 |
