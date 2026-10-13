# Database Audit Fixes Implementation Plan

**Status:** Completed — 四项代码修复及聚焦验证完成；独立环境限制和启用物理回收前的验证线索已移交未结项台账。

**Goal:** 修复 2026-10-13 数据库审查确认的四项问题，保护目录迁移一致性并使汇总、分页与级联删除的工作量可预测。

**Architecture:** 保留 Electron 与本地 SQLite 分库，以及服务端租户库和既有汇总维护生命周期。在现有 owner 内修复；客户端索引只通过追加迁移升级。

**Tech Stack:** Electron、Node.js SQLite、better-sqlite3、node:test。

## Constraints And Non-goals

- 用户明确要求并行子代理处理；不新增服务、依赖或公开协议，不提交、不部署。
- 保留两仓已有未提交修改；所有验证用独立合成数据，临时材料放各仓 tmp/。
- 不迁移、清理或改写真实数据库，不改变备份与礼物物理删除开关。
- 保持单实例、Electron 安全、scope 隔离、礼物迟到 final、保留快照可见性和分页排序语义。
- 本计划按 PLANS.md 管理；主代理统筹共享文件，子代理只改各自拥有的文件。

## Current Behavior And Evidence

审查报告位于 `tmp/database-audit-20261013/report.md`，四项合成复现均已确认：旧 AppData 活动 WAL 目录被复制后可丢已提交行；服务端汇总 LIMIT 500 仍可扫描 20 万旧行；客户端活动保留快照触发临时排序；粉丝外键缺少 profile_id 前导索引，在无统计信息时级联删除全扫子表。原相关测试共 243 项通过，未覆盖这些缺口。

## Ownership And Milestones

### M1 — 启动兼容迁移

Owner: `src/electron/desktop-user-data.js`、`src/electron/main.js`，必要时复用 `src/storage/data-directory-migration.js` 中已有停写检查。消费者为 Electron 启动与安装器；契约为 `docs/reference/desktop/main.md` 的目录/启动段落。

- [x] 在 `test/desktop/desktop-user-data.test.js` / `test/desktop/electron-startup-data.test.js` 复现活动来源、失败重试及 WAL 交错风险。
- [x] 来源实例锁覆盖检查、复制和发布，完成后释放再切换目标锁；失败保留原目录、不发布半成品。
- [x] 跑目录迁移和 Electron 启停相关测试，新增真实 Electron 锁与崩溃 WAL 夹具，同步启动契约。组合运行的既有目录重命名 EPERM 见下方限制。

### M2 — 服务端礼物汇总扫描

Owner: sibling repository `../lira-server/src/storage/gift-summary-store.js` 及其迁移（仅有必要时）；调用方为 `gift-retention-maintenance`。契约为该仓 `docs/protocol/gift-retention.md`，测试为 `test/gift-retention.test.js` 与维护相关套件。

- [x] 用长历史、稀疏新增和无贡献批次证明读取量也受 batchSize 限制；断言时间函数调用量与主键范围计划，不依赖墙钟耗时。
- [x] 复用 after_event_id 保存实际候选最大 ID；完整性检查限制到同一窗口，保留迟到 final、跨日、恢复、校验与发布语义。
- [x] 用该仓受支持 Node 执行保留与完整性消费者回归，更新协议内部构建说明。

### M3 — 客户端礼物快照分页

Owner: `src/storage/gift-retention-queries.js`、`src/storage/gift-query-store.js` 与 gift_db 追加迁移；测试 `test/storage/query-optimization.test.js`、`test/gifts/gift-retention.test.js`。

- [x] 覆盖未 ANALYZE 的升级库、active/retention-staged 混合、多个来源、双向与深分页，执行计划无整段临时排序。
- [x] gift_db v18 仅追加两个时间方向部分索引，原查询即可使用，成员可见性与同时间 ID 顺序不变。
- [x] 回归分页和保留流程，storage owner 文档同步。

### M4 — 粉丝级联删除

Owner: song_db 追加迁移；`fan_records` 与 `fan_reminder_states` 的 profile_id 外键访问路径。测试复用存储迁移或粉丝存储套件。

- [x] 无统计信息的 v14 升级库中两个子表均 SEARCH，跨 scope 数据及级联删除正确。
- [x] song_db v15 追加两个 profile_id 索引，保留现有 scope 查询索引。
- [x] 迁移幂等且保留数据，storage 文档同步两个库版本和索引事实，并校正业务表数量。

M3 与 M4 共享 `database-migrations.js`，顺序交接文件编辑权。主代理负责计划、storage 文档及最终整合；最多三个子代理并发。

## Verification

- Client: `node --test test/desktop/desktop-user-data.test.js test/desktop/electron-startup.test.js test/desktop/electron-shutdown.test.js test/storage/data-directory-migration.test.js`。
- Client: `node --test test/storage/*.test.js test/gifts/gift-retention.test.js test/fan-profiles/fan-roster-storage.test.js test/fan-profiles/fan-song-retention.test.js`。TEMP/TMP 指向仓库 tmp 内隔离目录。
- Server: `node scripts/run-with-node.cjs --require ./test/support/test-mode.cjs --test --test-concurrency=4 test/gift-retention.test.js test/gift-retention-maintenance.test.js test/gift-retention-delivery.test.js test/gift-ledger-index-migration.test.js test/gift-ledger-migration-errors.test.js`。
- 文档门禁：客户端 `npm run verify:docs`；服务端 `npm run docs:check`。发现具体影响时增加相应聚焦检查。
- 两仓最终检查本任务 diff、`git diff --check`、`git status --short`；不重复执行无新增依据的完整套件。

## Failure Handling

失败时保留测试证据，定位到对应 owner，再运行最小回归。只撤销本任务新增片段，不回滚用户修改；迁移失败不得删除来源或发布不完整目标。若启动契约或迟到 final 语义冲突，先记录具体冲突再调整方案。

## Done When

四项复现均有针对性回归通过；来源活动时不发布迁移目录；每个汇总扫描批次只读取有界行数且能恢复；保留快照分页与外键删除具有直接索引访问；旧库升级幂等且数据完好。技术文档同步，使用说明若操作没有变化则保持原样并说明。最终审查确认无真实运行数据或秘密进入 diff，再将计划归档并记录实际验证。

## Execution Record

- 2026-10-13：开始并行修复，现有工作区修改已识别并保留。
- 客户端追加 song_db v15 / gift_db v18；综合存储、礼物保留与粉丝恢复回归 105 项通过，架构门禁 27 项通过。
- 服务端保留 after_event_id 检查点格式，主键候选扫描与完整性校验同批限制；直接消费者回归 51 项、文档门禁 55 项通过。
- 客户端文档门禁初次发现本计划缺少正文 Status（索引已有状态）；已补充，收尾时重验。
- 独立后续线索：服务端物理回收路径 `gift-retention-store.js` 仍有全账本完整性及保护资格扫描；其删除开关默认关闭，本次四项修复没有启用或更改该路径。启用物理删除前仍需验证其批次读取成本。

### 实际验证与交付边界

- 客户端存储综合：`node --test --test-concurrency=4 --test-reporter=tap test/storage/*.test.js test/gifts/gift-retention.test.js test/fan-profiles/fan-roster-storage.test.js test/fan-profiles/fan-song-retention.test.js test/fan-profiles/fan-profiles-transfer.test.js`，105/105 通过。TEMP/TMP 为仓库 `tmp/database-fixes-20261013`；日志 `client-storage-tests.tap`。
- 桌面组合：`node --test test/desktop/desktop-user-data.test.js test/desktop/desktop-user-data-electron.test.js test/desktop/electron-startup-data.test.js test/desktop/electron-startup.test.js test/desktop/electron-shutdown.test.js test/storage/data-directory-migration.test.js`，77 项中 76 通过，唯一失败是旧 cache 目录的原生 rename EPERM；所有新增迁移测试均通过，不能把该次运行写为全绿。
- 真实 Electron 独立文件 `test/desktop/desktop-user-data-electron.test.js` 1/1 通过；验证来源锁冲突、复制时锁仍有效、已提交 WAL 保留、锁切换与已有目标优先。桌面证据位于 `tmp/database-audit-20261013/migration-fix-verification.md` 和 `legacy-native-verification.txt`。
- 对 EPERM 的独立原算法诊断在 100 次工作区目录迁移中复现 1 次，既有 journal 重试恢复且内容完整；同条件 HEAD 对照 100 次未复现。尚未识别占用者，后来的 105 项通过不消除此限制。未更改目录移动算法。
- 服务端：`node scripts/run-with-node.cjs --require ./test/support/test-mode.cjs --test --test-concurrency=4 --test-reporter=tap test/gift-retention.test.js test/gift-ledger-integrity.test.js test/gift-retention-delivery.test.js test/gift-retention-maintenance.test.js test/device-gift-epoch.test.js test/device-gift-history.test.js test/device-gift-history-clear.test.js test/device-gift-retention.test.js`，51/51 通过；该仓 `tmp/database-audit-fixes-20261013/server-summary-tests.tap` 保存日志，`npm run docs:check` 55/55 通过。
- 合成观察：客户端 2.5 万礼物活动快照分页约 31ms → 0.39ms；服务端 20 万历史单批约 158ms → 7.12ms，每批扫描 500 行、时间函数 1500 次。均不是生产容量承诺；服务端每轮仍按批次遍历事件水位内的候选。
- 客户端 `npm run verify:architecture` 27/27 通过；七个迁移相关 JS 文件语法检查通过。文档状态标签已修正；最终归档形态的 `npm run verify:docs` 输出保存于 `tmp/database-fixes-20261013/client-docs-final.log`。
- 两仓源码与技术参考同步；公开 API、用户操作、备份和删除开关未变，使用指南无需修改。未提交、部署、替换安装版或迁移真实数据库。
- 自动审批拒绝删除 `tmp/legacy-data-wal-4rrpWh` 与 `tmp/legacy-data-wal-AJwPbq`，理由仅为 `blocked by policy`，没有尝试绕过。两处来自早期测试夹具关闭/清理顺序错误（已修复并验证），保留在忽略的 tmp 下。
- 剩余独立线索归 [未结项 A3](../open-items.md#a3-数据库运行验证后续)，不将合成测试或默认关闭状态当作上线验收。
