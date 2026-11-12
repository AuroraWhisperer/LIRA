# AI 官方模型名称 Implementation Plan

**Status:** Complete
**Goal:** 模型选择使用当前 API／订阅目录的官方名称，保存与请求使用对应 ID，不自行拼写版本或名称。
**Architecture:** 延用模型客户端、订阅客户端与现有选择器；模型列表保留 `models: string[]`，仅附加可选 `modelNames: Record<string, string>`。显示名称不进入配置存储。
**Tech Stack:** Node.js CommonJS、Vanilla JavaScript ESM、现有 Node/VM 测试。

## 当前行为与依据

API 客户端只取 `data[].id`，订阅只取可见 `models[].slug`，选择器原样显示 ID。两条路径都丢弃上游显示名称；配置还无条件将 `ds-v4-flash` 改为过时的 `deepseek-v4-flash`，会误改自定义网关标识。

- [DeepSeek 模型目录](https://api-docs.deepseek.com/api/list-models/)：`id` 用于调用，`name` 用于选择器。
- [DeepSeek 当前模型](https://api-docs.deepseek.com/quick_start/pricing/)：Flash 的规范 ID 为 `deepseek-flash`，Pro 为 `deepseek-v4-pro`。
- [ChatGPT 订阅模型](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)：显示 `display_name`，调用 `slug`，保持官方可见性和顺序。

## 归属与约束

实现归属 `src/ai/config.js`、`model-client.js`、`chatgpt-client.js` 和 `public/js/admin/ai-model-picker.js`。服务和 `POST /api/ai/models` 路由继续原样传递结果。接口归属 `docs/reference/backend/api.md`，实现归属 `docs/reference/backend/ai.md`，操作指南为 `docs/guides/third-party-api-support.md` 与应用内 `usage-guide-ai.html`。

保留已有字符串模型列表、配置键、认证、凭据、订阅顺序和上游请求数量；不创建静态全平台模型表，不修改豆包账号模式，不更换用户模型，不调用真实账号，不提交或发布。工作区已有大量修改，仅编辑本任务行。

## 实施与验证

- [x] 扩展现有配置用例，证明官方 DeepSeek 旧 Flash 标识读入和保存后使用 `deepseek-flash`，第三方原始标识保留。只在有效地址属于官方 DeepSeek 时进行已知旧别名转换：

  ```js
  if (config.deepseekResponsesUrl && isOfficialDeepSeekUrl(config.deepseekResponsesUrl)
    && ['ds-v4-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes(config.model)) {
    config.model = 'deepseek-flash';
  }
  ```

- [x] 扩展已有 API／订阅目录测试，保留官方 ID 和显示名的关联；无名称时仍返回原始 ID。API 从 `name`／`display_name` 取名称，订阅从 `display_name` 取名称；不从 ID 推测名称。
- [x] 修改选择器，仅将显示文案改为官方名称与原始 ID 的对应关系，点击仍保存原始 ID：

  ```js
  const name = result.modelNames?.[model];
  item.textContent = typeof name === 'string' && name && name !== model ? `${name} (${model})` : model;
  ```

  扩展现有选中与自动保存用例，验证显示名来自响应，保存值保持官方 ID；沿用已有服务切换、失效请求和无元数据路径覆盖。
- [x] 同步上述接口、技术参考与两份指南；交互式引导无模型名称清单，无需改写。
- [x] 运行相关完整文件：`npm test -- --file=test/ai/ai-config-store.test.js --file=test/ai/ai-provider-contracts.test.js --file=test/ai/chatgpt-client.test.js --file=test/ai/frontend-admin-ai-settings.test.js --file=test/ai/ai-routes.test.js`。
- [x] 运行 `npm run verify:docs`、改动 JS 的语法检查、`git diff --check`；逐一比较 `tmp/ai-official-model-names/baseline/` 保存的任务前版本与最终文件，检查 `git status --short`。

## 失败处理与完成条件

若失败，聚焦相应目录解析、配置或选择器用例诊断；不改凭据或启动真实用户应用。回滚仅撤销本任务差异，基线用于区分原有修改，禁止覆盖其他工作。完成条件：官方名称来源保留、请求与保存 ID 一致、第三方不被误改、相关测试与文档门禁通过、差异复核完成。Node/VM 足以证明此次字段与选择行为；不增加 Electron 外观截图测试。

## 完成证据

2026-11-12：四项针对性回归先复现旧 Flash 标识、API／订阅显示名丢失与选择器只显示 ID，再通过；相关五个完整文件 92/92 通过（`tmp/test-results/run-gsH8En/`）。文档门禁 10/10、八个改动 JS 的语法检查和差异检查通过。技术参考、接口与用户指南同步；无新增上游请求、模型列表缓存或持久化字段。未使用真实账号或执行 Electron 界面验收，未提交、打包或发布。
