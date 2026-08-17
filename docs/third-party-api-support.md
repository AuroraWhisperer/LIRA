# 第三方 OpenAI 兼容 API 使用说明

LIRA 的模型客户端同时支持 Responses API 和 OpenAI Chat Completions。API Key
仍通过现有 AI 配置存储加密保存；不要把真实 Key 写入文档、源码或测试。

## 先选择供应商

- DeepSeek、OpenAI、Claude、Gemini：选择对应官方预设，LIRA 会固定官方兼容地址和推荐协议，页面无需手填地址。
- 自定义 / 第三方 OpenAI 兼容：适用于酒馆中转、聚合服务、私有网关以及其他提供 OpenAI 兼容接口的平台；地址和协议均可编辑。
- 自动识别：只为兼容已有设置保留，新配置建议明确选择供应商。

Claude 和 Gemini 预设使用供应商官方提供的 OpenAI 兼容入口。Claude 的兼容层只覆盖部分 OpenAI 功能；需要 Claude 原生完整能力时不应把此入口视为原生 Messages API 的替代品。

## 自定义服务的协议与地址

管理页的“接口协议”对应供应商文档中的 `wire_api`。第三方服务不按域名猜供应商；如果文档明确写 `responses` 或 `chat/completions`，请选择对应协议。不确定时保持“自动识别”，继续使用旧版兼容规则。

| 接口协议 | 填写形式 | 实际模型请求地址 |
|---|---|---|
| 自动识别 | `https://provider.example/` 或 `/v1` | `/v1/chat/completions` |
| Responses API | `https://provider.example/` 或 `/v1` | `/v1/responses` |
| Chat Completions | `https://provider.example/` 或 `/v1` | `/v1/chat/completions` |
| 任意 | 完整 `/responses` 或 `/chat/completions` | 原样使用，并以完整路径确定协议 |

DeepSeek 官方根地址继续按其官方路径适配：Chat 使用 `/chat/completions`，Responses 使用 `/responses`，不受第三方 `/v1` 根地址规则影响。无法明确
识别为基础地址的自定义完整路径会原样作为 Responses API 地址使用，避免擅自改写
现有配置。

## 配置示例

- 模型供应商：`自定义 / 第三方 OpenAI 兼容`
- API 请求地址：供应商给出的服务根地址、`/v1` 基础地址或完整端点
- 接口协议：按供应商文档选择；Codex 配置中的 `wire_api = "responses"` 对应“Responses API”
- API Key：`YOUR_API_KEY`
- 模型：通过“获取模型”选择服务实际返回的模型 ID

点击“测试模型服务”前，管理页会先保存待处理的配置。测试请求固定使用
非流式 JSON；Responses 与 Chat Completions 使用各自的标准响应结构。

## 联网与思考

- Responses API：联网由上游的 `web_search` 执行；推理可启停，并可选 `minimal` 到 `max`，具体档位仍需上游支持。
- DeepSeek 官方 Chat：联网由 LIRA 的函数工具执行；可启停思考并选择强度。官方原生档位为 `low/high/max`，其他档位映射到最接近的官方强度。
- Gemini 官方兼容：使用 Chat Completions；可选择 `minimal` 到 `high`，更高档位映射为 `high`，关闭思考是否生效取决于具体 Gemini 模型。
- Claude 官方兼容：使用 Chat Completions；当前界面不发送 Claude 原生思考字段，推理由模型和 Anthropic 兼容层管理。
- 普通第三方 Chat：联网要求模型支持 `tool_calls`；LIRA 不发送非标准思考参数，思考能力由模型 ID 或供应商配置决定。

## 排查

- `HTTP_401`/`HTTP_403`：检查 Key 和账户权限。
- `HTTP_404`/`HTTP_405`：检查填写的是服务根地址、`/v1`，还是正确的完整端点。
- `UPSTREAM_INVALID_RESPONSE`：服务没有返回 JSON；检查是否强制流式输出或经过了错误的代理页面。
- `DEEPSEEK_INVALID_RESPONSE`：JSON 中没有可识别的文本或工具调用。
