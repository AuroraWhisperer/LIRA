# AI 互动助手角色包与可选工具实施计划

Status: Completed — 2026-10-09。实现、调研后的改进和最终验证已完成，保留离线验证与真实模型效果的边界。

## Goal

落实 [规格](../../ai-assistant-persona-tools.md)，按用户要求依次完成第一版修改、查验、上网调研、第二版改进和最终验证。

## Ownership And Decisions

- `src/ai/personas.js`：只包含数据的角色包、内置角色、校验、导出；不执行插件代码。
- `config.js` / `config-store.js`：新配置及兼容读取；使用既有键值表，密钥仍由 secret codec 处理。
- `prompt.js` / `ai-assistant-helpers.js` / `ai-assistant-service.js` / `safety.js`：请求能力、角色提示、工具执行授权、审核和上下文。
- `src/server/routes/ai-routes.js` / `api-context.js`：授权后的角色操作装配。
- `public/js/admin/ai-assistant-*.js` / `public/pages/admin/toolbox/danmaku-ai.html`：角色选择和文件导入导出、工具开关，保留现有自动保存。
- 复用 `test/ai/` 与 `test/helpers/ai-*.js`；新角色包契约在独立聚焦测试中验证。

## Compatibility And Boundaries

不提交、发布或变更无关工作区修改。保留 API 密钥 origin 校验、审核、弹幕预算、队列、投递确认、关闭取消和观众隔离。新用户默认纯聊天；旧人设不覆盖。角色内容变化隔离上下文；导入包的元数据不进入模型密钥配置。

## Milestones

- [x] 第一版领域与持久化：`buildTools(config)` 只返回可用工具；`resolvePersona(config)` 选择角色；配置保存并投影可选角色。验证空凭据、恶意工具调用、旧配置及包导入导出。
- [x] 第一版界面：复用设置页控件，角色包可切换、导入、导出、删除；天气与地图开关可操作，未配置说明可见。验证自动保存、编辑保护和导入失败恢复；完整指导在第二版定稿时同步。
- [x] 第一版查验：全部 166 项 AI 聚焦测试通过后进入研究阶段；时间上下文移到 instructions，工具测试改为显式启用和配置替身凭据。
- [x] 网上调研：SillyTavern Function Calling / Characters / Character Design 与 Open WebUI Models；来源及采用理由见 [实施记录](../../../docs/reports/2026-10-09-ai-assistant-personas-and-tools.md#修改查验调研再修改)。
- [x] 第二版修改与最终验证：增加函数调用总开关和命名角色保存；完善重试缓存隔离、关闭工具的执行检查、隐藏字段验证和桌面下载；文档、语法、架构及桌面运行证据完成。

## Verification Commands

```powershell
node --experimental-vm-modules --test test/ai/*.test.js
npm run verify:docs
npm run check
npm run verify:architecture
git diff --check
git status --short
```

使用现有测试替身和隔离数据，桌面验收前核对独立数据目录与端口。全仓测试仅在发现跨域影响时扩大。本次不调用用户真实模型、不发送直播弹幕。

## Documentation

同步 `docs/reference/backend/ai.md`、`api.md`、`storage.md`、`docs/reference/frontend/app.md` 与 `pages.md`、`docs/guides/third-party-api-support.md`、应用内 `usage-guide-ai.html` 及相关百宝箱说明；检查交互引导是否描述旧控件。已被其他任务修改的文件只更新本次 AI 段落。

## Failure Handling

导入校验失败不写入或替换旧包，取消文件选择不修改配置。保存事务失败回滚本次修改；不通过关闭审核或削弱测试换取通过。回退只针对本任务差异，不重置工作区。

## Done When

规格的每项验收均有实现与检查证据；第一版、研究与第二版顺序被记录；最终差异不含凭据或运行数据；研究建议已落实或有明确不适用理由。

## Evidence

- 2026-10-09：已重新检查工作区，AI 运行代码未有用户预先修改；相关文档与手册已有无关修改，将按段落保留。
- 第一版通过 166 项 AI 测试后才进行上述一手资料调研。角色包保持纯数据，不接入脚本扩展或其他角色卡格式；不新增依赖、进程或数据表。
- 第二版最终 `node --experimental-vm-modules --test --test-reporter=dot test/ai/*.test.js`：180 项通过。新增覆盖函数总开关、空工具字段省略、误请求/撤销工具、命名保存、重复包原子拒绝、20 包上限、旧配置迁移、自动保存等待和角色切换期间的投递重试缓存。
- `test/admin/admin-page-composition.test.js` 与 `test/admin/frontend-usage-guide.test.js`：26 项通过；`npm run verify:docs`：10 项通过；`npm run check`：1395 个 JS 文件检查通过；`npm run verify:architecture`：26 项通过。
- Impeccable 静态检测覆盖三个设置模块和三个页面片段，返回空结果。新增界面沿用现有 CSS；实际 Electron 画面无重复 ID、横向溢出或 pageerror。
- 隔离 Electron 使用本仓库 preload、桌面授权、真实 AI 路由、配置存储与临时内存库，数据目录和随机端口位于 `tmp/ai-assistant-qa/`。验证小猫编辑另存、切换及刷新恢复、导出文件落盘、无效/重复导入、删除和重新导入；命名操作仅请求一次创建接口。匿名 `/admin`、角色导出和创建均为 401。未控制用户正在运行的应用。
- 实际关闭工具后，隐藏的非法地图地址不会阻止保存；后端读取总开关为 false。桌面下载的测试目标采用 Windows 规范化绝对路径。截图更新为 `public/img/usage-guide/E/ai-assistant-config.webp`（1100×1660），示例无凭据且注明尚未配置真实模型。隔离 Electron 已关闭。
- 技术参考、API、存储、前端模块图、第三方模型指南及应用内指导同步。交互引导仅指向未变的「百宝箱 → 弹幕互动」入口，不需修改；供应商选择菜单未变，原菜单截图继续适用。
- 最终检查任务差异并执行 `git diff --check`、`git status --short`；除有意更新的手册截图外，未把运行数据、凭据或临时文件加入源码差异。不提交、发布或修改其他任务的变更。

## Requirement Audit

1. 普通问答：新配置通用角色、所有可选能力关闭；两种模型协议均省略空工具字段，纯问答生成路径仍可返回答案。
2. 工具独立：凭据、总开关、各工具开关与配额共同决定声明和执行；仅实际可用搜索能作为配额替代。
3. 回答规则：移除全局猫语、颜文字、18–22 字模板、固定推荐数量和强制非思考；保留每条含提及 40 字符、至多三条、输入输出审核及限流。
4. 角色包：内置角色、多个自建/导入包、创建/切换/删除/文件交换和重开存储覆盖；角色内容与模型配置、工具权限分离。
5. 数据兼容：保留旧自定义人设和工具选择，导出不含配置凭据，观众/角色上下文及重试缓存隔离。
6. 验证顺序：修改 → 第一版查验 → 网上调研 → 第二版改进 → 最终聚焦、桌面、文档与架构检查完成。

未调用用户真实模型或发送真实直播弹幕，因此不把替身输出测试当成回答质量或所有外部模型兼容性的保证。豆包消费客户端接入不在本轮范围内。
