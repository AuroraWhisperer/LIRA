# 入场欢迎界面与用户定制欢迎词

Status: Completed.

## Goal / Current Behavior

整理入场欢迎参数、词库和样例预览的按钮、无对勾下拉、箭头、布局及说明；新增按 B 站 UID 定制首次欢迎文案。现有四个词库只区分阶段和荣耀等级，没有用户级文案。

## Ownership / Proposed Changes

- 界面：`public/pages/admin/toolbox/danmaku-welcome-library.html`、`danmaku-welcome-switch.html`、`public/css/admin/toolbox/danmaku-fixed-replies.css`。保留现有 token，说明复用问号组件，下拉复用共享组件并局部隐藏对勾。
- 编辑：`public/js/admin/danmaku-welcome.js`、`danmaku-welcome-model.js` 和用户规则编辑模块；现有词库视图增加 UID/文案列表，独立草稿与保存，复用串行写入和账号代际。
- 契约：沿用 `/api/device/welcome-settings/v2`、Live `src/shared/welcome-settings-contract.js` 与已有 IPC；增量字段 `userWelcomeMessages: [{uid, message}]`，允许 0–100 条，UID 为 1–20 位规范正十进制字符串且唯一，文案沿用 80 Unicode code point/非空/禁控制字符规则。
- Server：`src/lib/welcome-options.js` 校验，`src/storage/welcome-settings.js` 保存于租户 welcomeOptions，`src/modules/danmaku/welcome-service.js` 首次欢迎时精确匹配 UID，优先于荣耀/通用词库；二次问候仍用现有规则。

## Compatibility / Non-goals

不增加端点、数据库表、迁移、依赖或本地发送器。旧服务器响应缺少新字段时允许读取原设置，但用户定制区域明确不可保存；其他设置提交不得附带新字段。保留阶段门槛、延迟、冷却、发送队列、账号/租户隔离、旧文案与既有未提交修改。此次不提交、发布、部署，不触碰真实账号与数据。

## Milestones / Verification

- [x] UI 子代理优化原界面，功能子代理实现编辑，后台子代理实现契约与发送，各自运行直接受影响测试。
- [x] 主代理整合：UID 精确匹配、通用回退、空列表删除、重复 UID 拒绝、重读持久化、旧回包兼容、失败/并发保存保草稿和账号切换均有对应测试。
- [x] 复用现有隔离 Electron 主机模式，真实 preload/IPC/桌面请求授权配合合成服务验证参数、下拉无对勾、问号、添加/保存/刷新/删除及失败草稿；截图放 `tmp/`，不启动用户应用。
- [x] 同步 Live 桌面/页面引用、应用内指南及 Server 契约/OpenAPI/验收；交互引导无欢迎专属步骤，保持不变。
- [x] 运行直接相关 Node 测试、Live `npm run verify:docs` 与 Server `docs:check`、相应语法/架构门禁与差异审阅。

## Evidence

- Live `node --experimental-vm-modules --test test/settings/frontend-welcome.test.js test/settings/welcome-settings-ipc.test.js test/danmaku/admin-danmaku-markup.test.js test/admin/admin-page-composition.test.js test/admin/admin-style-ownership.test.js test/admin/frontend-usage-guide.test.js`：60 项通过。
- Server 使用仓库已有 Node v24.18.0，`--require ./test/support/test-mode.cjs --test test/welcome-settings.test.js test/welcome-stages.test.js test/welcome-settings-http.test.js test/welcome-service.test.js test/welcome-lifecycle.test.js`：28 项通过；文档/协议门禁 50 项通过。系统 Node v24.21 超出 Server 声明版本范围，未改版本保护。
- Live 文档门禁 10 项、架构门禁 27 项通过；`npm run check` 检查 1440 个 JS 文件通过；Impeccable 对本次 UI 的一次机械扫描无发现。
- 隔离 Electron 使用生产页面组成、preload、IPC、请求授权和合成配置；匿名 `/admin` 确认 401，桌面正常进入。确认 20 位 UID 原样保存、两位用户独立文案、刷新重读、删除空列表、失败保稿、刷新保稿、重复 UID 字段错误、旧 V2 禁用新区域而保留原设置。
- 视觉确认宽窗口及 700px 左右容器布局、无横向溢出、单一 SVG 折叠箭头、下拉无对勾且保留 aria-selected、问号在视口内。最终截图位于 `tmp/personal-welcome-desktop-BycBAL/welcome-parameters.png` 和 `welcome-custom.png`。未使用真实 B 站用户或发送弹幕。
- 未提交、部署或修改契约版本锁；部署新 Server 后新编辑能力才在真实环境可用。现有旧 V2 设置继续兼容。

## Failure Handling / Done When

失败保留草稿，不宣称保存成功；旧服务不自动降级重放新字段。只修订任务拥有的修改，保留其他工作，不用破坏式回滚。完成标准是功能/UI 可用，相关验证通过、文档一致且差异已审阅。实播和生产部署不属于隔离开发验证。
