# AI 角色预设编辑与身份绑定

Status: Completed — 2026-10-10

## Goal

主页面只选择带风格简介的预设；独立编辑面板管理角色。恢复历史小猫指南，通用不附加人格；触发关键词同时作为身份名，空关键词不触发，仍需客户端启用。隐藏回复长度，所有角色共享底层字数、安全和工具规则。

## Current Behavior And Ownership

- `src/ai/personas.js` 当前小猫为简写且写死小米；`config-store.js` 已有创建、导入、删除；缺少原位更新。
- `ai-assistant-helpers.js` 已拥有公共提示及发送预算；`ai-assistant-service.js` 按身份内容隔离记忆。
- `public/js/admin/ai-assistant-personas.js` 编辑后改为 custom；设置页自动保存不应误保存编辑面板草稿。
- 历史小猫来源：`1f32b5cc^:src/ai/prompt.js`，沿用身份、性格与说话指南，移除特定主播事实及过期工具/字数要求。

## Changes And Compatibility

沿用 Electron、原有认证、JSON 角色格式和既有触发匹配，不改存储架构、模型或工具。新增 `builtinPersonaOverrides` 数组保存两项内置角色的用户修改；内置不可增删、可恢复。新增同权限 `POST /api/ai/personas/update` 原位更新/恢复，保留现有自定义文本和所有用户设置。模板 `{{name}}` 在生成时替换，编辑和导出保留模板，不写死用户名称。旧 `replyMaxChars` 键兼容保留，运行时不再使用该用户偏好，使用统一预算。不碰其他未提交工作。

## Milestones And Verification

- [x] 预设 owner、保存/恢复、动态身份与公共提示：扩展 `test/ai/ai-personas.test.js`、相关路由/生成测试；验证重开、不可删除、模板导出和记忆隔离。
- [x] 页面收起详情、独立编辑面板、显式保存/取消：扩展现有前端 fixture 和 AI 设置测试；复用隔离 Electron QA，验证真实 preload/授权及新建、修改、恢复和删除。
- [x] 同步 `docs/reference/backend/ai.md`、`api.md`、前端 owner、AI 使用指南文字/截图及规格。文档、语法、架构通过；跨仓库契约检查因现有服务端 revision 不匹配未进入断言，限制见下。

## Evidence And Limits

- AI 全部聚焦测试及使用指南测试共 201 项通过；包含名字为空、客户端关闭不调用模型，改名后生成使用新名字且缓存/记忆作用域变化。
- `npm run check`、`npm run verify:architecture`（27 项）、`npm run verify:docs`（10 项）通过。
- `npm run verify:contracts` 受外部工作区状态阻挡：期望服务端 `01fb2b47d5e081f5dd559933991ade4819eb3428`，本地为 `8995b126254fff13345307b564ace15b6be40615`。本任务只改本地 AI 配置/管理接口，不修改远程协议或服务端；未更动服务端工作区来消除此限制。
- 隔离 Electron 使用真实 preload、桌面会话授权、AI 路由与内存数据库；验证主页面、指南编辑、新建、原位更新、刷新恢复、内置恢复、取消、无效文件及删除。匿名 `/admin` 和新增更新接口均 401，桌面配置读取 200，`musicAPI` 桥存在；无页面异常或编辑面板横向溢出。测试实例已关闭。
- 模板解析和共享底层规则由 owner 测试覆盖；未调用用户真实模型账号，不宣称提示词能绝对保证模型输出。已保存的旧自定义文本通过 `hasCustomPersona` 保留回选入口。
- 设计检测无发现；最终截图用于更新使用指南。`tmp/ai-persona-editor-qa/` 仅保存本次临时 QA 资料。

## Failure Handling And Done When

验证错误输入不得改变原配置；编辑面板失败保留草稿。只撤回本任务行，不删除已有用户数据或其他工作。最终检查 diff、`git diff --check` 和 status，确认全部功能/文档一致；不使用真实账号测试模型效果。完成后归档验证证据。
