# 第三方 OpenAI 兼容 API 使用说明

LIRA 的模型客户端同时支持 Responses API 和 OpenAI Chat Completions。API Key
仍通过现有 AI 配置存储加密保存；不要把真实 Key 写入文档、源码或测试。

## 地址填写方式

| 填写形式 | 实际模型请求地址 | 协议 |
|---|---|---|
| `https://provider.example/` | `https://provider.example/v1/chat/completions` | Chat Completions |
| `https://provider.example/v1` | `https://provider.example/v1/chat/completions` | Chat Completions |
| `https://provider.example/v1/chat/completions` | 原样使用 | Chat Completions |
| `https://provider.example/v1/responses` | 原样使用 | Responses API |

DeepSeek 官方根地址继续按其官方路径适配，不受第三方根地址规则影响。无法明确
识别为基础地址的自定义完整路径会原样作为 Responses API 地址使用，避免擅自改写
现有配置。

## 配置示例

- API 请求地址：`https://gcli.ggchan.dev/` 或 `https://gcli.ggchan.dev/v1`
- API Key：`YOUR_API_KEY`
- 模型：通过“获取模型”选择服务实际返回的模型 ID

点击“测试模型服务”前，管理页会先保存待处理的配置。测试请求固定使用
`stream: false`，因此目标服务应返回标准 JSON Chat Completions 响应。

## 排查

- `HTTP_401`/`HTTP_403`：检查 Key 和账户权限。
- `HTTP_404`/`HTTP_405`：检查填写的是服务根地址、`/v1`，还是正确的完整端点。
- `UPSTREAM_INVALID_RESPONSE`：服务没有返回 JSON；检查是否强制流式输出或经过了错误的代理页面。
- `DEEPSEEK_INVALID_RESPONSE`：JSON 中没有可识别的文本或工具调用。
