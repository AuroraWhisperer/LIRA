# AI 模型思考能力一致性

Status: Completed

## 目标与边界

按用户要求修复官方模型思考强度：名称保留官方目录来源，档位与默认值跟随所选模型及最新获取的目录；界面和实际请求共用能力。未知模型不猜测、不透传其他模型遗留强度。保留第三方 Responses 兼容、既有配置键、授权及密钥边界，不提交或打包。

## 初始问题与归属

- `src/ai/model-reasoning.js` 负责官方目录归一化和有文档依据的精确 ID 规则。目录无默认值会被忽略，可能回落到过时规则；OpenAI Pro 等已确认规则缺失。
- `src/ai/model-protocol.js` 对未知官方模型透传旧强度，API 关闭思考时还强行发送 `none`。已复现 `gpt-5.4-pro` 收到官方不支持的 `none/max`。
- `model-client.js`、`chatgpt-client.js` 分别缓存当前服务／凭据和订阅会话的目录；`config-store.js` 公开投影只读取文档规则，重开界面可与请求不一致。
- 管理页 `ai-assistant-config-view.js` / `ai-model-picker.js` 已按选中模型渲染，但需处理目录缺少默认值、能力刷新与连接失效。
- 契约归属：`docs/reference/backend/ai.md`、`api.md`、`specs/model-provider-capabilities_design.md`；用户说明：`docs/guides/third-party-api-support.md`、内置 `usage-guide-ai.html`。交互引导只介绍入口，无需更改。

## 决策

1. 保留 `modelReasoning: {efforts: string[], defaultEffort?: string}`；官方目录明确给出的等级优先，即使默认值缺失或等级为空也不回落旧规则。无已确认默认档时不伪造默认标记；未选择合法档则省略请求参数。
2. `resolveReasoningEffort(config)` 只处理已确认能力。第三方旧行为只保留在 Responses 协议兼容分支；DeepSeek 的独立关闭思考语义继续有效。
3. 两个模型客户端提供同步 `getModelReasoning(config)`，复用现有内存缓存及隔离键。组合根 `src/server/ai-runtime.js` 注入配置投影；读取配置不增加上游请求。
4. API 补入已核对的 OpenAI Pro、GPT-6.1 Terra、GPT-5.6 Sol 和精确快照 ID；Gemini 2.5 使用官方兼容档位，不猜命名默认档。未知后缀不通过前缀推测。订阅只采用当前账号目录，不套 API 文档默认值。
5. 前端刷新目录或切换模型即重建档位；失效的连接目录及旧配置能力不可继续冒充当前能力。仅当官方已确认默认档时标注默认。

官方依据：[DeepSeek 目录](https://api-docs.deepseek.com/api/list-models/)、[GPT-5.4 Pro](https://developers.openai.com/api/docs/models/gpt-5.4-pro)、[GPT-5.5 Pro](https://developers.openai.com/api/docs/models/gpt-5.5-pro)、[GPT-6.1 Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra)、[GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)。其余规则已在本次前序核查中逐项对照官方模型页。

## 实施与验证

- [x] 在现有 owner 测试复现：未知官方模型关闭／遗留强度不传参，Pro 使用合法档，目录缺默认／空等级不可回落，刷新目录更新请求，界面切换后保存合法值。
- [x] 修复能力解析、请求控制及配置投影接线；复用缓存，不新增轮询、存储格式或运行依赖。
- [x] 同步技术参考、规格、用户指南；运行相关 Node/VM 测试、文档门禁、涉及模块的架构检查和 `git diff --check`。
- [x] 审查本次增量与工作区状态，记录验证证据后归档。

不访问真实账号或用户数据；参数和保存规则用现有 Node/VM 路径验证，不重复启动 Electron 检查相同规则。失败只修本次差异，保留工作区已有和并行修改。

## 完成证据

- 首轮聚焦回归出现 7 项失败，覆盖未知模型透传、目录缺省值及前后端能力漂移；修复后扩大至 10 个直接相关测试文件，143/143 通过、0 跳过。包括目录刷新后请求同步改变、配置投影复用缓存、订阅会话隔离、密钥草稿清除旧能力及无默认档的保存行为。日志保留于 `tmp/ai-model-reasoning-checks/tests.log`。
- `npm run verify:architecture` 30/30、`npm run verify:docs` 10/10 通过，14 个改动源码／测试 JavaScript 文件语法检查通过，`git diff --check` 通过。
- 同步 AI 后端参考、API 契约、模型能力规格、接入指南和应用内 AI 使用说明。交互引导仅描述入口，不涉及档位细节，因此保持不变；沿用现有 Node/VM 验证，不新增重复 Electron 测试或截图。
- 官方模型显示名与调用 ID 已沿用上游目录，无需再造名称规则。目录不提供能力时仍依赖已核对文档的精确 ID 规则，未来官方变化需更新规则；不承诺这部分自动实时同步。
- 保留全部已有及并行修改；未调用真实模型、读取真实凭据、提交、打包或发布。
