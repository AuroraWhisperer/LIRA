# 模块化与公共能力复用整改实施计划

Status: Completed

**Goal:** 完成用户明确授权的审计 M1–M5，使同一规则只有清晰的 owner，纯函数调用没有界面/兼容副作用，AI 与加班机持久化实现归入 storage，并移除确认失去消费者的旧感谢实现。

**Architecture:** 保留模块化单体、现有 Electron/HTTP/WS/IPC 边界及无前端构建的 ESM 模型。沿用现有时钟共享契约、store 工厂和组合根；五项分别完成和验证，不引入通用管理器或运行依赖。

**Tech Stack:** Node.js 24+、Electron 43、CommonJS 后端、浏览器原生 ESM、SQLite、node:test。

依据：[审计报告](../../../docs/reports/2026-10-22-modularity-reuse-audit.md)、[模块化标准](../../../docs/architecture/engineering/modularity-standard.md)、[规划规则](../../../PLANS.md)。用户已授权全部建议与可选项并行实施；不恢复报告中“暂不调整”或其他历史计划。完成证据见[整改记录](../../../docs/reports/2026-10-22-modularity-reuse-remediation.md)。

## 全局约束和当前基线

- 不改变 URL、HTTP/WS/IPC 形状、设置键、数据库 schema/迁移、历史结算和缓存键；不提交、分支或发布。
- 密钥 codec、公开脱敏、配置事务、persona scope、代次/取消和计时器 cleanup 保持原有语义。
- 任务开始已有世界时钟改动及前轮审计文档，保存基线并保留其内容；同文件的任务修改限于相关段落。
- 本轮属于依赖边界和存储高风险重构，需要定向覆盖、文档、静态/架构门禁和最终全量测试；全量期间冻结代码，先诊断所有失败再决定是否重跑。
- 调查和测试产物放在 `tmp/modularity-reuse-remediation/`。使用合成数据；不启动或控制用户正在运行的应用。
- 原审计基线：架构 27 项、相关定向测试 76 项通过；这只是现状证据，不能代替整改后的验证。

## M1：时钟公共元数据

Owner：`public/js/shared/clock-settings.js`。消费者：`src/server/clock-contract.js`、`src/server/scene-components.js`、`public/js/overlays/clock.js` 及已有预览。文档：`docs/reference/frontend/overlays.md`。

- [x] 从已有 `CLOCK_STYLE_LABELS`、`FLIP_PALETTES`、`CLOCK_APPEARANCE_KEYS` 派生同义集合/颜色/映射，保持现有导出和配置读取合同。
- [x] 后端校验、旧数据回退、overlay 几何/DOM 继续由各自 owner 管理；不把 browser import 加入 storage。
- [x] 扩展现有时钟/场景契约覆盖，验证共享定义、旧 URL 覆盖顺序与 styleOptions round trip。
- [x] 运行 `node --experimental-vm-modules --test test/overlays/clock-overlay.test.js test/scenes/component-style-parameters.test.js`，同步 owner 文档。

## M2：前端纯函数与兼容入口分离

Owner：新增按主题的纯 HTML 转义、格式化模块；`public/js/shared/utils.js` 保留兼容聚合。消费者包括 `public/js/playback/utils.js` 和当前使用这些纯函数的 Admin/播放视图。文档：`docs/reference/frontend/app.md`、`docs/architecture/engineering/legacy-boundaries.md`。

- [x] 核对所有被提取函数的真实消费者；把纯实现移入无 DOM、window、网络和加载副作用的主题模块，生产消费者直接引用它们。
- [x] `utils` 保留已有 named/aggregate 出口及旧全局发布；toast、确认框、JSON 请求使用已有 owner，不另造总入口。
- [x] 保持 `value || ''` 与 `value ?? ''` 的现有差异，不顺带改 classic overlay 合同；兼容出口仅在现有消费者仍需要时保留，结构测试保护不再新增纯调用依赖。
- [x] 用实际 ESM 导入验证纯入口和 playback 工具不发布 Admin 全局，并运行受影响 UI/播放/JSON 测试；同步文档，说明兼容出口退出条件。

## M3：AI 持久化边界

Owner：`src/ai/config-store.js` 保留配置/角色规则、codec、公开投影及配置缓存；新增 `src/storage/` AI 持久化适配器负责 SQL 和事务。装配：`src/server/ai-runtime.js`。消费者：`src/ai/ai-assistant-service.js`、`src/server/api-context.js`。文档：AI/storage 技术参考及 owner/遗留地图。

- [x] 盘点配置、provider 角色选择、请求日志、黑名单、会话、回复缓存的 SQL 及调用方，沿用行为端口而非暴露数据库/statement。
- [x] 在组合根创建 storage adapter 并注入领域 owner；迁移仓内调用与 fixtures，避免用默认数据库回退隐藏新边界。
- [x] 配置及 provider 角色选择保持单一事务，失败不更新领域缓存；ciphertext 留在持久化边界，codec 和脱敏仍由领域处理。
- [x] 保持 persona scope、散列键、TTL、时钟回退及清理生命周期；不按每张表增加服务，不改变 assistant 请求/取消所有权。
- [x] 运行 AI 配置、上下文、assistant 与 runtime 相关测试；验证失败原子性和无明文泄露；由主代理收紧架构门禁并同步文档。

## M4：加班机存储与生产装配归位

Owner：将 `src/overtime/overtime-store.js` 移入 `src/storage/overtime-store.js`，不改变 store 的行为合同。`src/overtime/overtime-service.js` 只消费已存在的 `store` 参数；`src/server/domain-services.js` 创建适配器。文档：`docs/reference/backend/overtime.md`、storage 与归属地图。

- [x] 查全部 `createOvertimeService`、`createOvertimeStore` 和旧路径消费者；迁移生产装配、仓内测试/fixtures，并明确是否仍需旧 facade 出口。
- [x] 保持同一 giftDb、所有 `BEGIN IMMEDIATE` 事务、结算幂等、恢复与定时器单 owner；不改 schema、不拆数据库。
- [x] 运行加班机服务/存储失败、数量边界、礼物导入结算和清库恢复测试；收紧 SQL 与依赖门禁。
- [x] 同步当前技术文档路径和导出说明；历史报告中的基线位置不改写成当前实现。

## M5：清理旧感谢实现

Owner：`src/bilibili/gift/guard-thanks-config.js` 是当前事件 owner；候选旧文件 `src/bilibili/gift/guard-thanks.js`。

- [x] 复核静态、动态加载、测试和打包清单引用；确认旧文件无兼容用途后删除。
- [x] 保留 `gift:guard-thanks` 事件、当前预览/投影与所有现有调用，不合并为带模式参数的生成器。
- [x] 运行感谢事件和场景事件相关测试，记录清理证据。

## 并行与整合

三个子代理分别负责 M1+M5、M2、M3；主代理负责 M4、共享架构测试文件、所有文档和计划状态。各代理只修改所属源码/定向测试，不写共享文档和 `test/engineering/module-boundaries.test.js`，完成时交付实际命令、结果及风险。共享测试需要的更改由主代理统一处理。

## 最终验证与完成条件

- [x] 五项均实现，逐项检查 owner、真实消费者、兼容出口和新增副作用；审查子代理实际 diff，不仅依赖总结。
- [x] 技术参考、遗留登记、归属地图同步；由于界面行为/操作不变，用户指南保持原样并说明原因。
- [x] `npm run verify:docs`、`npm run check`、`npm run verify:architecture` 通过。
- [x] 所有编辑完成后冻结文件，运行 `npm test`；收集全部失败，诊断及定向验证后才重跑。不得以隔离通过掩盖并发失败。
- [x] 最终 `git diff --check`、任务 diff 和 `git status --short` 检查通过，原有改动保留，无运行数据或秘密进入 diff。
- [x] 在审计报告添加准确的整改结果入口，完成计划转归档，保留验证记录和局限。

## 回滚与失败处理

每个批次独立审查。失败先保留证据，修复所属代码及对应测试；需要撤回时只逆向修改本任务 hunk 或本任务新增文件，不使用 reset、blanket checkout、整树删除，也不覆盖基线工作。高风险的事务、密钥、清理行为没有证据时不得宣布完成。

## 执行记录

- 2026-10-22：用户授权五项全部实施并行处理；计划建立，开始各批次。

- 2026-10-22：M1–M5 实施与定向验证完成；时钟/感谢45、前端207、AI188、加班机137及固定契约3项通过（批次间可能重叠）。独立复核 AI/加班机无发现。技术参考及当前 owner 路径同步，用户操作不变。
- 整合处理：默认服务器检出不满足契约锁，复用并校验既有 tmp/release-5.4.3/server-contract 后定向通过；时钟大写 import 别名触发现有文本扫描误报，改为直接导入和局部引用；规格索引旧路径更新。文档10、架构28项通过，未放宽门禁。
- 最终验证：语法第一轮因输入修改失效，冻结后 1,641 文件检查通过；全量 647 文件、5,224 项通过，零失败/跳过（5 项原生检查 + 5,219 项主批次）。测试结束后只修正文档中的 playback logout 直接读全局描述及完成记录，重新执行文档门禁和 diff 检查。
- 保留证据：原有世界时钟 8 个文件哈希一致，app.md 扣除本轮新增段落后内容一致；无提交、打包或发布。用户操作未变，无需指南修改；完成计划归档。
