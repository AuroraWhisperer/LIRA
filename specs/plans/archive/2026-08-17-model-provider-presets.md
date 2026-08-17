# Model Provider Presets Implementation Plan

## Goal

在现有双协议模型客户端上增加供应商选择器和官方预设，使电脑端用户先选择 DeepSeek、OpenAI、Claude、Gemini 或自定义兼容服务，再只处理该选择真正需要的配置。

## Non-goals

- 不新增 Claude Messages 或 Gemini 原生协议适配器。
- 不新增依赖、进程、端口、数据库迁移或密钥类型。
- 不删除现有自动 URL 兼容逻辑。

## Current Behavior

- 地址与 `modelApiProtocol` 已能区分 Responses / Chat Completions。
- 页面尚无供应商选择，用户需要从地址和协议推断服务类型。

## Ownership

- Owner: `src/ai/config.js`, `src/ai/model-endpoint.js`, `src/ai/deepseek-client.js`
- Contract: `docs/architecture/backend/ai.md`, `docs/architecture/backend/api.md`
- Consumer: `public/js/admin/ai-assistant-settings.js`
- Tests: `test/ai-config-store.test.js`, `test/ai-provider-adapters.test.js`, `test/ai-routes.test.js`, `test/frontend-admin-ai.test.js`

## Compatibility Constraints

- `modelProvider=auto` 保留所有旧配置行为。
- 继续使用 `deepseekResponsesUrl` 和 `deepseekApiKey` 作为兼容存储键。
- 官方预设必须由服务端固定地址和协议，不能只依赖前端禁用控件。
- API Key 继续加密且不回显。

## Milestones

- [x] 增加供应商枚举、预设归一化和公开能力投影；运行配置与路由测试。
- [x] 让现有模型客户端复用预设并覆盖 DeepSeek/OpenAI/Claude/Gemini 请求；运行 provider 测试。
- [x] 增加电脑端供应商选择器、官方字段锁定和能力文案；运行 Admin 测试并视觉检查。
- [x] 更新 owner 文档，运行 quick/full gates，审查差异和密钥。

## Verification

- `node --test test/ai-config-store.test.js test/ai-routes.test.js`
- `node --test test/ai-provider-adapters.test.js test/third-party-api-compatibility.test.js`
- `node --experimental-vm-modules --test test/frontend-admin-ai.test.js`
- `npm run verify:quick`
- `npm test`
- `git diff --check`, `git status --short`, credential scan

## Rollback Or Failure Handling

只反向修改本计划涉及的字段与预设映射，不回滚前一阶段双协议支持，也不使用破坏性 Git 命令。

## Done When

五类供应商选择在电脑端可见，官方预设请求落到正确官方兼容端点，自定义服务保留手动协议能力，全量测试通过且无密钥进入差异。

## Result

- `npm run verify:docs`：5/5 通过。
- `npm run check`：364 个 JavaScript 文件通过。
- `npm run verify:architecture`：9/9 通过。
- `npm test`：630 项，629 通过、1 跳过、0 失败。
- 电脑宽度视觉检查通过；官方字段锁定、自定义字段恢复和能力文案均符合规格。
