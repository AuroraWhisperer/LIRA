# 分时段欢迎

Status: Completed

范围：客户端与相邻 `lira-server` 源码；上线另行处理。

## 目标与决策

欢迎词库可开关时段模式：关闭展示原欢迎词库，开启展示北京时间全天 5 段的独立词库，各预置 20 条原创文案。按用户精炼要求，未发布的十段初版收为早晨 05:00–09:00、上午 09:00–12:00、下午 12:00–18:00、晚上 18:00–23:00、深夜 23:00–05:00；饭点、傍晚和睡前不再独立分段，默认文案适合其整个时段。普通首次欢迎按进场时的服务端北京时间随机选一句，不混入普通词库。个人、久别重逢、高荣耀、PK 和二次问候的现有优先级与发送条件保持。

## 当前实现与所有权

客户端 `danmaku-welcome.js`、`danmaku-welcome-library.js` 管理独立草稿，受限 V2 IPC 由 `src/shared/welcome-settings-contract.js` 校验。Server `src/lib/welcome-options.js`、`src/storage/welcome-settings.js`、`src/modules/danmaku/welcome-service.js` 负责校验、租户配置持久化、选词与取消任务。沿用现有 V2 路由、授权主体、配置存储及发送器。

## 契约与兼容

增加 `timeWelcomeEnabled`（默认 false）和 `timeWelcomeMessages`（固定 5 个时段键，各 1–30 条、每条 1–80 字）。V2 完整读回两个字段；旧 V2 同时缺失时禁用新能力，半缺失或非法数据拒绝。保存某时段仅提交该时段的子集，服务端在事务内合并最新存储，保留其他设备修改的时段；其他草稿不随保存提交。普通词库和时段词库分别保留；模式开关不提交参数或文案草稿。主欢迎关闭时可预设模式，原主开关仍决定是否发送。所有输入经过受限 IPC 和服务端校验，文案只以纯文本渲染；不增加凭据、同步通道或本地发送器。十段方案未提交或部署，不增加其临时格式的迁移和兼容分支。

## 实施与验证

1. 扩展配置与服务端选词 → 验证时区、跨日边界、优先级、普通词库保留、非法写入原子拒绝。
2. 在现有词库编辑区加入开关与时段选择 → 验证两套显示切换、各时段草稿、失败和迟到响应、旧服务兼容。
3. 同步 Desktop main/preload 参考、应用指南和 Server viewer-welcome/OpenAPI/fixture、需求与验收 → 运行双方文档门禁。

聚焦测试：Server welcome-settings / welcome-stages / welcome-service / welcome-settings-http / welcome-lifecycle；Live frontend-welcome / welcome-settings-ipc / welcome-editor-electron。复用隔离桌面 fixture，验证真实 preload、IPC 保存与重载；视觉检查普通与时段两种状态。失败草稿与旧能力缺失作为异常场景。所有测试使用内存库或根目录 tmp，保持用户运行实例和数据隔离。

## 完成条件与回退

5 段覆盖全天、100 条文案可编辑保存；真实发送按模式选择；旧配置默认保持普通模式。聚焦测试、文档检查、最终差异和 `git diff --check` 通过。只撤销本任务差异；保留两仓库既有修改，不执行整体回滚。无需迁移数据库表；旧选项读回通过缺省值兼容。记录实际验证及限制后关闭计划。

## 初版验证记录

已完成默认关闭的时段欢迎、北京时间全天 10 段及 120 条原创文案；普通词库和各时段草稿独立保留，模式与词库分别保存。首次欢迎固定使用进场时刻选词，保留个人／久别／高荣耀优先级及其他欢迎阶段。

只读审查发现全量保存十段会覆盖其他设备的新修改，已改为当前时段子集更新，并在服务端现有事务内合并最新值；再次审查与回归通过。V2 请求和完整响应使用独立 OpenAPI schema，旧端能力缺失及非法响应保护同步。

- Live：`npm test -- --file=test/settings/frontend-welcome.test.js --file=test/settings/welcome-settings-ipc.test.js --file=test/desktop/welcome-editor-electron.test.js`，3 文件 32/32 通过；结果位于本地 `tmp/test-results/run-kj6weF/results.json`。
- Server：`node scripts/run-with-node.cjs --require ./test/support/test-mode.cjs --test test/welcome-stages.test.js test/welcome-settings.test.js test/welcome-settings-http.test.js test/welcome-service.test.js test/welcome-lifecycle.test.js`，46/46 通过。
- 真实隔离 Electron 覆盖授权 `/admin`、preload／IPC、普通与时段切换、修改保存和重载；补查生产下拉样式与不同词库显示，已更新使用指南截图。隔离实例已关闭、临时用户数据已清理。
- Server `npm run docs:check` 59/59 通过；Live `npm run verify:docs` 9/10，唯一失败是另一并行任务 `2026-11-12-interaction-thanks.md` 的状态格式，本任务不修改其内容。
- 15 个相关脚本语法检查通过；两端时段契约文件哈希一致。已审查本任务实现、测试和文档差异，保留所有既有及并行修改。

技术参考、OpenAPI／fixture、需求／验收与用户操作说明同步；沿用现有存储、发送器和授权边界，无需新 ADR。完成范围为配套双端源码，未提交、打包、部署或进行真实 B 站发送；线上启用需更新相应版本。

## 五时段精炼与验证

已将未发布初版精炼为五个时段、每段 20 条文案。仅更新共享时段定义和默认文案，以及直接消费这些键的测试、OpenAPI／fixture、需求验收、技术参考与指南截图。沿用现有选择器、服务端选词及保存代码，未改存储或授权。

上述三个客户端完整文件重跑 32/32 通过（`tmp/test-results/run-caMZUt/results.json`）；五个服务端完整文件重跑 46/46 通过，覆盖边界、跨段延迟选词、模式切换、独立保存和普通词库保留。Server 文档 59/59、Live 文档 10/10 通过，初版记录中的并行文档阻断已消失。真实隔离 Electron 已核对生产下拉的五项、下午／深夜词库切换，更新 900×800 指南截图；测试实例和临时用户数据已清理。

只读复核确认双端定义一致、全天每分钟恰好落入一段、每段 20 条且无重复、文案最长 29 字，五键请求／响应及使用说明一致。没有新增兼容分支或测试基础设施；仍为双端源码交付，未提交、打包或部署。
