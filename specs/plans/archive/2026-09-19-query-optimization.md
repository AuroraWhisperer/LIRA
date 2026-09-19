# 数据库查询优化第一批实施计划

Status: Complete（仅本计划列出的客户端查询批次，2026-09-19）。报告整体仍分批实施中。

## Goal

按用户批准开始实施的报告第 9.1 节，先交付客户端队列关联索引、礼物最近列表与双向历史分页/计数、粉丝候选批量读取。保留已有结果、排序及来源隔离。

## Non-goals

本批不更改历史恢复协议或启用部分在线状态；统计单次扫描/worker 与 Device 持续监控基准独立验收，随后才能进入出口保护批次。不发布、不操作真实用户数据库。

## Current Behavior / Ownership

- `src/storage/database-migrations.js`：song v6、gift v11；下一条迁移追加索引，`schema.js` 的旧路径不改。
- `src/storage/gift-query-store.js`：最近列表按 datetime 排序；时间游标使用 OR；每次历史页 COUNT。`src/bilibili/gift/query-service.js` 为消费者。
- `src/fans/profile-service.js`：先读每人的记录和提醒再文本筛选；已有未提交的灯牌排序须保留。存储归属 `fan-profile-store.js` / `fan-record-store.js`。
- 存储事实源 `docs/architecture/backend/storage.md`；直接用例 `gift-query-service`、`gift-display-query`、`fan-profiles-*`、`queue-service` 与数据库生命周期用例。

## Compatibility Constraints

保持 datetime 时间解释、历史原始 created_at 比较、升降序同时间均 id DESC、所有名称/金额/备注排序与统计口径。计数只能在同连接相同筛选/时间和数据库版本有效时复用；asOf 不视为不可变快照。数据变化重新计数。粉丝先筛选基础字段，会员过滤仍在计算后，完整全局灯牌排序不截页。

## Proposed Changes / Milestones

- [x] 保存临时磁盘库合成基准脚本、环境、30 次热态原始样本与查询计划；先运行旧实现再运行修改后实现。
- [x] song v7 创建 `idx_requests_queue_id ON requests(queue_id)`；gift v12 创建来源 + datetime 最近列表索引、来源 + created_at ASC/id DESC 索引。验证新建/升级/重复启动及查询计划、队列关联记录。
- [x] 时间游标分两次边界查询，位于同一短读事务，第二次仅取剩余额度。新增同时间跨页、两方向、空页、末页测试。
- [x] 历史页的 COUNT 和取页处于同一读事务；以连接 WeakMap 保存最多 64 个计数，键为完整 SQL 筛选与参数；total_changes/data_version/schema_version 变化失效，仅事务成功后发布缓存。验证回填、更新、删除、回滚、外部写入、来源与筛选隔离。
- [x] 粉丝文本/收藏/缺资料预筛选，记录和提醒每批最多 500 个 ID，以 scope 限定，按 ID 分组且保持原记录顺序；单次列表固定 now。验证候选范围、分批次数和现有会员/灯牌/提醒用例。
- [x] 更新存储事实源与报告进度，记录实测结果及尚未验证事项，检查任务差异。

## Findings / Verification Results

新增 5 项回归在旧实现均失败，修改后扩展到 8 项，包括外部连接在两段读取之间提交、缓存容量/失败发布和旧时间格式。最终受影响的 146 项用例通过；文档治理 5 项通过。修改前后原始结果保存到 `docs/reports/2026-09-19-client-queries-{before,after}.json`。

重复时间上界使降序 SQL 即使显示 SEARCH 也可能从较宽边界扫描；已收敛为单个严格上界并重新测量。历史热态页 P50 230.67→0.43 ms，降序深页 10.10→0.28 ms，粉丝搜索 2002→4 SELECT。数字只适用于本次 Node 合成测量，第一次计数、Electron 停顿和服务器持续负载门槛仍须独立处理。

迁移注册表原处于 668 行复核上限；逐行复核新增两个纯索引步骤，未改旧迁移、未新增职责。保留 15 行短 DDL 避免仅一次调用的模块，复核理由与 683 行上限登记到 `modularity-baseline.json`。模块门禁的剩余两项失败来自已有 UI 修改，不属于本批。

v3 升级 fixture 需要同时移除新索引后才能删掉 v4 列；已更新 fixture，保持真正迁移路径的验证。一次新增测试的清理顺序先关闭主库而外部句柄尚存导致 Temp 清理失败；已修正句柄释放顺序并通过回归，遗留目录的单独清理被自动审批策略阻止，未改仓库或用户数据。

## Verification

`node scripts/benchmark-client-queries.js <output.json>`：10 万礼物、1000 档案/5 万记录，固定合成输入、首次访问和 30 次热态样本，记录 SQLite/Node/OS/CPU/内存、PRAGMA、commit/工作区差异及查询计划。该基准不替代 Electron 停顿和服务器 10 分钟持续负载门槛。

运行 `node --test test/query-optimization.test.js test/gift-query-service.test.js test/gift-display-query.test.js test/queue-service.test.js` 和实际受影响粉丝/存储用例。新增回归测试先在修改前确认失败。最终运行 `git diff --check`、查看任务 diff 与 `git status --short`；如发现迁移/存储边界风险，再扩大检查。

## Rollback Or Failure Handling

停止任务不删除数据。追加索引可保留；只逆向本任务 diff，不覆盖已有粉丝/UI 改动，不回退 schema 版本或做整库 rollback。读事务出错回滚且不发布新计数缓存。

## Done When

上述三类客户端查询修改完成、直接回归测试通过、查询计划/次数有证据、升级数据保持、文档与差异审核完成。报告整体仍是分批实施中，不将本批结果算作同步/服务器上线验收。
