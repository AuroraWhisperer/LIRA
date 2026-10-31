# Kimi 与 AI 订阅接入实施计划

Status: Awaiting Verification — 实现与本地验证完成，真实账号授权和推理待账号持有人验收。日期：2026-10-25。

## 目标与决策

AI 互动助手增加 Kimi 官方 API，以及官方支持的 ChatGPT 订阅授权；API 和订阅凭据共存，用户明确选择调用方式，不自动切换计费来源。复用现有角色、审核、工具、上下文和弹幕交付链。

官方证据：
- [ChatGPT 本地项目授权](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)：动态客户端注册、系统浏览器、loopback、PKCE、OIDC、订阅权限。
- [订阅请求限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)：Responses SSE、store=false、自带历史、函数命名空间，不能直接复用所有 API 参数。
- [Kimi 产品集成](https://www.kimi.com/en/help/kimi-code/membership-guide)：开放平台用于产品调用，Coding 订阅用于编程场景。
- [Claude 凭据范围](https://code.claude.com/docs/en/legal-and-compliance)：不提供第三方应用内 Claude.ai 订阅登录。
- [Gemini API 计费](https://ai.google.dev/gemini-api/docs/billing)：现有 API 使用项目与 Cloud Billing。

不实现网页 Cookie 抓取、冒用其他客户端、Coding 订阅转发、自动付费降级、远端共享登录或部署。官方授权是否准入以登录结果为准；真实账号验收需要账号持有人交互，不读取本机其他应用的登录凭据。

## 当前行为与所有权

- `src/ai/config.js` / `config-store.js` 拥有平台预设、设置与 API 密钥来源保护。
- `src/ai/model-client.js` 是统一模型出口，现有豆包独立账号模式；`ai-assistant-service.js` 拥有审核、工具、排队与交付。
- `src/server/ai-runtime.js` 装配，`api-context.js` / `routes/ai-routes.js` 提供已鉴权管理接口。
- `public/js/admin/ai-assistant-{settings,config-view}.js` 与 `danmaku-ai.html` 拥有配置交互。
- 技术契约：`docs/reference/backend/{ai,api,storage}.md`；用户指导：`docs/guides/third-party-api-support.md`、`usage-guide-ai.html`。

## 兼容与安全

- 保留工作区已有修改、旧设置默认值、豆包行为、服务地址来源校验。
- 新增 `modelAuthMode` 设置；只有 OpenAI 支持 subscription，其他平台使用 api。旧设置仍为 api。
- 订阅 host ID 与加密账号记录使用现有 `ai_configuration` 存储接口的独立内部键，不经公共配置读写；不改数据库 schema。
- 订阅凭据仅在主进程/后端可见，通过现有 safeStorage codec 加密，不做明文回退。前端只获得账号标签、状态和错误码。
- 新增维护中的 JOSE 库用于 OIDC 签名验证，理由是认证正确性；不引入框架、独立服务或前端构建。
- loopback 回调单次 state/nonce/PKCE、有限生命周期；刷新串行，退出与账号切换中止旧请求；错误、日志与响应不泄露 token。

## 实施与验证

- [x] Kimi：增加官方预设、模型列表、Chat Completions 参数与思考工具历史；扩展现有 provider/key-origin 回归。
- [x] ChatGPT：独立 OAuth、会话与 SSE 适配模块，接入模型出口与既有管理授权；合成 JWKS/OAuth/SSE 验证 state、签名、加密恢复、刷新、注销、取消、限额和工具续接。
- [x] UI：平台后显示接入方式、登录/取消/退出/账号选择/用量入口；API 密钥草稿与订阅独立，未支持平台显示准确说明与官方链接；扩展 settings 测试。
- [x] 同步技术文档与操作指南；旧截图标明未包含新增项。交互导览仅定位原有入口，未改变导航，保持不变。
- [x] AI、桌面授权、管理页与 HTTP 相关 359 项通过；语法检查 1666 文件、架构 28 项和文档 10 项通过。补充账号路由测试找出并修复 runtime-api-context 漏传订阅会话；初次文档状态格式与空 catch 检查失败均已修正。
- [x] 隔离 Electron fixture 已检查 Kimi 面板、API/订阅切换、登录等待/取消、账号选择、获取模型、连接结果、额度错误、退出及保留 API Key。使用合成账号/响应，实际 preload/桌面鉴权，匿名 /admin 返回 401；页面无异常，测试进程已关闭。截图与记录仅在根 tmp/。
- [x] 已核对本次源代码、测试、依赖与文档差异；原有修改保留，生成物和合成账号测试数据仅在 tmp/。最终执行 `git diff --check` 与 `git status --short`。

## 验证限制

- 官方 discovery 已通过实际 HTTPS 读取，issuer、授权/令牌/撤销/JWKS 地址及 RS256 与实现一致；没有读取用户现有凭据，也没有真实付费模型请求。
- 真实 ChatGPT 登录、账号准入、订阅额度与 Kimi 模型回复尚需使用者在更新后的桌面客户端验收。浏览器登录与 SSE 的成功/失败流程目前由签名合成凭据和响应验证，不能据此宣称真实账号已经连接。
- 未构建或发布安装包。API/订阅仅改变模型调用入口，角色、审核、可选工具及弹幕投递沿用原有 owner；技术与用户说明已同步，不改导览入口。

## 完成条件与失败处理

Kimi 和订阅调用共用助手功能，未授权/过期/取消/限额明确失败且不转用 API；凭据不会进入 renderer/日志；聚焦与安全检查通过，文档一致。若真实官方账号无法验证，记录为待账号验收，不宣称已真实登录成功。回退仅移除本次局部改动，不覆盖原工作区内容。
