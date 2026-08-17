# Feature: 模型供应商协议与能力界面

## Goal

AI 互动助手应允许用户显式选择模型服务使用的 wire protocol，并根据实际协议只展示可控制的联网与推理选项，使 DeepSeek 官方、OpenAI 兼容 Chat Completions 和第三方 Responses API 共用同一配置入口而不互相误导。

管理页还应提供显式供应商预设，使 DeepSeek、OpenAI、Claude、Gemini 和自定义兼容服务在同一入口中可辨认；官方预设复用供应商官方提供的 OpenAI 兼容入口，自定义服务才需要手动决定地址和协议。

## Context

当前实现仅通过 URL 形状自动选择 Responses API 或 Chat Completions。该规则可以兼容常见 `/v1` 服务，但无法表达类似 Codex 自定义 provider 的 `wire_api = "responses"`：同一个第三方根地址可能对应不同协议。当前页面也对所有服务显示相同的 Web Search 和“启用思考”复选框，掩盖了以下差异：

- Responses API 的 `web_search` 由模型服务执行。
- Chat Completions 的 Web Search 由 LIRA 转换为本地函数工具，要求模型返回 `tool_calls`。
- Responses API 可接受推理强度；DeepSeek 官方 Chat 使用自己的 `thinking` 控制；普通第三方 Chat 的推理由模型 ID 或供应商决定。

参考行为：SillyTavern 先选择 API 类型与来源，再配置自定义地址，并明确提示工具调用兼容性；CC Switch 将供应商作为显式配置对象管理；OpenAI 官方 Codex 配置把 `wire_api`、`model_reasoning_effort` 和联网能力作为独立维度。

## Constraints

- 保持 Node.js 24+、CommonJS 后端、Vanilla JavaScript ES modules 和现有无构建前端。
- 不增加依赖、进程、端口、数据表或数据库迁移。
- 保留现有 `deepseekResponsesUrl`、`reasoningEnabled`、`webSearchEnabled` 和密钥存储行为。
- 新配置继续存入现有 `ai_configuration` 键值表，密钥仍通过既有 secret codec 加密。
- 自动模式必须保留当前 URL 兼容行为。

## Non-goals

- 自动探测任意供应商是否实际支持工具调用、托管 Web Search 或推理。
- 为每家中转站维护域名或模型白名单。
- 向普通第三方 Chat Completions 发送非标准推理参数。
- 增加流式响应支持或供应商故障转移。

## Architecture

### Backend

- 新增 `modelProvider` 配置，允许 `auto`、`deepseek`、`openai`、`anthropic`、`gemini`、`custom`，默认 `auto` 以兼容旧设置。
- 官方供应商预设固定有效地址与推荐协议：DeepSeek Chat、OpenAI Responses、Claude 官方 OpenAI 兼容 Chat、Gemini 官方 OpenAI 兼容 Chat；不新增原生 Claude/Gemini 适配器。
- 新增 `modelApiProtocol` 配置，允许 `auto`、`responses`、`chat_completions`，默认 `auto`。
- 新增 `reasoningEffort` 配置，允许 `auto`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`，默认 `auto`。
- 将模型端点解析集中到 `src/ai/model-endpoint.js`，供模型客户端和公开配置投影共同使用。
- 显式 `responses` 将第三方服务根地址或 `/v1` 基础地址补全为 `/v1/responses`；DeepSeek 官方根地址补全为 `/responses`；完整 `/responses` 原样使用。
- 显式 `chat_completions` 将服务根地址或 `/v1` 基础地址补全为 `/v1/chat/completions`；DeepSeek 官方根地址继续使用 `/chat/completions`；完整 `/chat/completions` 原样使用。
- `auto` 保留当前规则：完整协议路径优先，根地址与 `/v1` 默认使用 Chat Completions，无法明确识别的完整自定义路径按 Responses API 使用。
- Responses 请求在 `reasoningEnabled = false` 时发送 `reasoning.effort = "none"`；启用且强度不是 `auto` 时发送所选强度；启用且为 `auto` 时沿用服务默认。
- DeepSeek 官方 Responses 将公共强度映射为 `reasoning.effort` 的 `low`、`high` 或 `max`。DeepSeek 官方 Chat 关闭时发送 `thinking: {type: "disabled"}`；启用时发送 `thinking: {type: "enabled"}`，并将强度映射为 `reasoning_effort`。普通第三方 Chat 不发送推理控制字段。

### Public config projection

`GET/PUT /api/ai/config` 在原有配置之外返回不含密钥的 `modelEndpoint`：

```json
{
  "protocol": "responses",
  "provider": "custom",
  "webSearchMode": "hosted",
  "reasoningMode": "effort"
}
```

取值语义：

- `provider`: `deepseek`、`openai`、`anthropic`、`gemini`、`custom`、`unconfigured`
- `webSearchMode`: `hosted`、`local_function`、`unconfigured`
- `reasoningMode`: `deepseek_effort`、`gemini_effort`、`effort`、`provider_managed`、`unconfigured`

### Frontend

- 模型服务区域首先显示供应商选择器；官方预设锁定地址和协议，自定义/自动模式允许编辑。
- 模型服务区域新增“接口协议”选择器。
- 回复规则区域新增“协议 / 联网 / 推理”能力轨道，使用文本和状态而不是仅靠颜色表达。
- Responses API 显示“启用模型推理”和推理强度选择器。
- DeepSeek 官方 Chat 显示“启用 DeepSeek 思考”和推理强度；非官方档位映射到最接近的 `low`、`high` 或 `max`。
- 普通第三方 Chat 隐藏不可用的思考开关，显示“由模型或供应商决定”。
- Web Search 始终保留用户开关，但文案随协议显示“服务端 Web Search”或“LIRA Web Search”，并说明相应兼容要求。
- 能力展示由服务端返回的 `modelEndpoint` 驱动；前端不复制协议判定规则。

## Security

- `modelProvider` 在服务端按固定枚举校验；供应商预设不接受前端覆盖官方地址。
- `modelApiProtocol` 与 `reasoningEffort` 在服务端按固定枚举校验；未知值返回现有 400 配置错误。
- 公开 `modelEndpoint` 只包含枚举，不含 URL、Header 或密钥。
- 管理页继续使用 DOM `textContent` 和固定文案，不插入供应商返回的 HTML。
- 模型请求日志继续通过现有 secret redactor；新增配置不属于秘密。
- 不改变管理 API 的现有同源、token 与请求保护。

## Compatibility

- 未保存 `modelProvider` 的现有配置使用 `auto`，继续按现有 URL/协议规则运行。
- 未保存新键的现有用户得到 `modelApiProtocol = "auto"` 和 `reasoningEffort = "auto"`，运行行为保持不变。
- 已保存的 `reasoningEnabled` 布尔值保持原义。
- 现有完整 `/responses`、完整 `/chat/completions`、DeepSeek 官方地址以及第三方 `/v1` 地址继续可用。
- HTTP 路径、响应包络和密钥遮罩保持不变；只向公开配置对象增加字段。

## Acceptance Criteria

1. 当协议为 `responses` 且地址为第三方根地址时，模型请求发送到 `/v1/responses` 并使用 Responses 请求/响应格式。
2. 当协议为 `chat_completions` 且地址为第三方根地址时，模型请求发送到 `/v1/chat/completions` 并使用 Chat 请求/响应格式。
3. 当协议为 `auto` 时，现有 DeepSeek、第三方 Chat 和完整 Responses 地址的测试继续通过。
4. Responses 推理启用且强度为 `high` 时，请求包含 `reasoning: {effort: "high"}`；`auto` 不覆盖服务默认。
5. 普通第三方 Chat 请求永远不包含 `reasoning` 或 `thinking`。
6. DeepSeek 官方 Chat 启用思考且强度为 `max` 时，请求包含 `thinking: {type: "enabled"}` 与 `reasoning_effort: "max"`。
7. DeepSeek 官方根地址显式选择 Responses 时使用 `/responses`，并发送映射后的 `reasoning.effort`。
8. 管理页根据公开 `modelEndpoint` 显示正确的协议、联网和推理控件及说明。
9. 新配置经过服务端枚举验证、持久化并从 GET/PUT 配置接口返回，密钥仍不回显。
10. 页面可键盘操作，隐藏控件不进入交互流程，窄屏布局不溢出。
11. 官方供应商预设忽略请求中的自定义地址覆盖；切回自定义后仍可编辑地址和协议。
12. OpenAI、Claude、Gemini 预设分别使用各自官方 OpenAI 兼容入口，普通自定义配置保持现有行为。

## Done When

- 后端、路由、配置存储、管理页和文档的聚焦测试通过。
- `npm run verify:docs`、`npm run check`、`npm run verify:quick` 和完整测试通过。
- 规格索引和架构 owner 文档与运行时一致。
- 最终差异不包含供应商 Key、生成文件或无关修改。
