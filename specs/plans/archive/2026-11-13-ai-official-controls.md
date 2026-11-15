# AI 官方模型设置与接话频率

Status: Completed

## 目标与范围

按当前用户要求，模型只显示官方名称，不附加调用 ID；思考等级和默认等级来自官方目录或官方文档，去掉统一七档和近似映射；自动接话提供可保存的概率，并排除可信机器人欢迎。保留现有平台、协议、授权、密钥和人格边界，不提交或打包。

## 当前行为与归属

- `public/js/admin/ai-model-picker.js` 将名称与 ID 拼接；`ai-assistant-config-view.js` 配合静态 HTML 显示统一等级。
- `src/ai/model-client.js`、`chatgpt-client.js` 获取目录，但丢弃推理能力；`model-protocol.js` 将不支持的档位近似映射。
- `src/ai/config.js` / `config-store.js` 拥有配置；`auto-reply-controller.js` 固定自动提交间隔 15 秒。
- 契约：`docs/reference/backend/ai.md`、`api.md`；用户指南：`docs/guides/third-party-api-support.md`、AI 使用指南片段。

## 决策与兼容

1. 模型目录保留 `models` / `modelNames`，增加可选 `modelReasoning`，按模型返回官方支持强度与默认强度；目录未提供时只使用有官方来源的模型规则，未知模型不展示猜测档位。
2. 原始调用 ID 继续用于保存和请求；UI 名称使用官方目录名称，无名称则显示原始 ID。
3. 保留旧 `reasoningEffort: auto` 的读取兼容；UI 将其定位到明确官方默认档，不提供独立“服务默认”；不支持的旧档使用官方默认，不再就近映射。
4. 用户后续明确“频率”是回复概率，新增 `autoReplyProbabilityPercent`，0–100、默认 100 保持现有已启用行为；每条合格新弹幕去重后只抽选一次。保留 15 秒发送底线，不影响点名回复。可信 `isWelcome` 在触发词解析前排除，当前发送账号通过动态 UID getter 排除自动接话，避免账号切换后仍读旧身份。其他无标记的外部机器人无法据此识别，不猜欢迎文案。沿用现有配置存储，不改 schema。
5. 保留用户修改 `package.json`、`docs/reference/engineering/build.md` 和任务期间出现的 `public/css/admin/toolbox/danmaku-tool.css`，不接触真实凭据或运行数据。

## 实施与验证

- [x] 频率：配置、控制器、表单和现有相关测试一起更新，验证保存、抽样概率、去重与欢迎/发送账号排除；改为 0 时取消未送达的自动任务，保留定向问答。
- [x] 官方能力：目录解析、已知官方模型规则、请求参数及选择器一起更新，验证模型切换、默认档、无猜测档和调用 ID。保留官方明确支持的 DeepSeek Responses / Gemini 2.5 Flash / Flash Lite 关闭思考语义。
- [x] 同步技术契约、当前规格和用户指南；直接相关 14 个 Node 测试文件 225/225 通过。隔离 Electron 使用生产 HTML、预加载和桌面请求认证核对：匿名 `/admin` 为 401，频率字段可编辑，名称无附加括号，DeepSeek 三档及默认标签正确，未知模型无猜测档。默认标签显示截断已扩大控件修正；Impeccable detector 返回空结果。

参考 sub2api 的目录能力保留与 CC Switch 的官方目录处理；不使用其第三方目录、未知模型能力克隆或猜测默认值。当前 SIWC 明确要求公开 `api.openai.com/v1`，保留该路径，不混用传统 Codex backend 授权流。首轮文档门禁仅因本计划缺少 Status 失败，收尾归档后复验；最终验证结果见归档索引。

## 完成与失败处理

上述行为及聚焦验证通过后记录结果；真实上游调用、安装包和用户当前运行版本若未验证需明确说明。失败只修正本任务差异，不重置工作树或修改真实用户数据。
