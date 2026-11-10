# 2026-11-10 审计缺陷修复计划

Status: Completed

用户已明确要求直接修复本轮审计确认的四项业务缺陷和测试漂移。

## 目标与现状

修复清空后的加班机周期复用、粉丝身份改绑污染、异步播放期间队列索引失效、跨房礼物目录请求混用，并同步 65% 歌词预览测试。复现和证据见仓库 `output/code-audit-2026-11-10.md` 与 `tmp/audit-2026-11-10/`。现有取消/清空、同周期跨来源结算、同房请求去重仍须成立。

## 边界与所有权

- 主代理：`public/js/playback/features/playback-controls.js`、`core/queue-coordinator.js`、`queue/manager.js` 的播放接受/条目定位，既有 playback suites；歌词字号断言；计划与最终汇总。
- 粉丝代理：`src/fans/profile-service.js`、`guard-roster-import.js` 及直接身份投影，`test/fan-profiles/`，粉丝 owning reference。
- 加班机代理：`src/storage/database-clear-operations.js` 及直接清空/结算调用链，`test/storage/`、`test/overtime/`，加班机和存储 owning reference。
- 礼物目录代理：`src/bilibili/gift/sale-catalog.js`、`hybrid-catalog.js`，既有目录 suites，目录 owning specification。

遵守根及 scoped AGENTS。保留其他工作现有改动；不改公开 HTTP/WS/IPC 格式、队列持久化格式或数据库 schema，不引入依赖，不提交。用户手写资料、历史原始证据、非当前来源礼物历史必须保留。修复不扩展为相邻功能重构。

## 实施与验证里程碑

- [x] 播放：新增同曲重复条目在音源等待期间插队的回归，修前游标 2≠3 失败；按所选对象当前位置接受播放后，queue/logout/quality/stream-recovery/persistence 共 121/121 通过；临时清空与替换场景也通过，原请求代次保护保持。
- [x] 粉丝：改绑时失效旧身份自动快照，名单/灯牌投影只接受相同 typed identity；旧备份仅在原始证据明确冲突时排除旧名单，保留合法旧快照、历史与手写信息。三项回归修前失败，八组受影响 suites 共 109/109 通过，粉丝规格已同步。
- [x] 加班机：修前原复现 epoch 1→1 且加 60000ms，新增/扩展用例 3 项失败；`restoreGiftDefaults` 在同一事务保留 enable_epoch 并忽略旧 pending。clear/runtime/recovery/settlement/状态排序 49/49 通过，非当前来源历史和同轮切换语义保持；overtime/storage 参考已同步。
- [x] 目录：local 按房间合并在途请求，hybrid 按当前请求身份失效过期结果，阻止跨房和图片等待阶段 A→B→A 的返回/磁盘错配。新增回归均已先失败后通过；owning suites 19/19、直接 consumers 25/25 通过，目录规格和 API 参考已同步；依赖服务端固定版本的消费者由最终全量覆盖。
- [x] 歌词：修前确认 24→15.6px 断言失败；仅将预览断言乘 0.65，正式输出保持原字号。`desktop-lyric-layout-browser.test.js` 7/7 通过。
- [x] 每项已检查测试/技术契约/使用指南影响；实现与 owning reference 同步，未改变操作步骤的使用指南保持不动。
- [x] 各定向 diff 已审阅；两轮 `npm run verify:quick` 通过。首次 full 的八项失败完成原因核查和定向收敛后，固定服务端契约环境下最终 `node scripts/run-tests.js all --require-full` 通过：675 文件、5431/5431、零失败/跳过。

## 失败处理与完成条件

只反向修改本任务差异，不使用 reset、整文件覆盖或真实用户数据。临时 fixture 在仓库 `tmp/`。服务端契约依赖采用本地已存在的固定提交隔离 checkout，不更改相邻仓库工作区。完整测试期间所有代理停止编辑。

完成要求：四个缺陷的正确行为回归通过，相邻业务约束保持，字号断言与接受需求一致；相关文档准确；最终 `git diff --check`、状态及任务 diff 审阅完成；明确报告未运行的外部服务/硬件验证。

## 实施发现

- 粉丝修复不能只保护未来 save：旧版本已错误改绑的备份可带旧 guardRoster，需要在证据可判定身份冲突时处理，并保留无原始记录的合法旧快照。
- 礼物 local 与 hybrid 的异步生命周期不同：local 完成后 hybrid 还可能等待图片。A→B→A 时只按房间复用外层 Promise 会让返回与磁盘不一致，因此外层还需按当前任务身份取消过期装饰结果。
- 原计划状态使用中文标签导致文档门禁 1 项失败；已按仓库解析规则改为 `Status: In Progress`，10/10 文档检查通过。
- 同一工作区存在其他会话持续进行的模块重构。最终 quick/full 验证使用仓库 tmp 下的独立固定快照（包括当时已有改动），记录文件哈希并在结束时对照本任务源文件，避免全量期间文件变更导致结果无法归属。原工作区修复保留，其他会话修改不回滚。
- 固定快照首次 quick 通过：文档 10/10、1826 文件语法、29 项架构。首次 full 完成 675 文件、5422/5430，8 失败集中于四个文件；3631 个快照文件状态前后一致，本任务 14 个源码/测试与原工作区一致。
- 全量失败集中处理：粉丝模拟表单漏传 UID 导致意外解绑，补真实表单字段且保留原断言，41/41 通过；另一会话 Admin 重构漏了 startup 的 initGiftPanel stub，已补齐，Toast 旧 helper 导入已由另一会话更新，两个文件 8/8 通过。剩弹幕动画初始位置失败正在诊断；定向收敛前不重复完整运行。
- 弹幕测量失败已有受控复现：250ms 间隔下 down 3/3 失败、up 3/3 通过；冻结时位置正确，但 ResizeObserver 在两次 evaluate 之间重建动画，读取时已运动 88–93px。只修测试采样边界，不降低断言精度或改变生产动画；完成相同延迟/并发验证后再完整复验。
- 动画测试最终只将冻结与采样放进同一次 evaluate。相同 250ms 延迟与八文件并发条件下修前 8/16、修后 16/16；原测试文件 50/50 通过。四个失败文件同步到固定快照后，第二轮 quick 的文档 10/10、语法 1826 文件、架构 29/29 通过；最终 full 已开始，源码与受测文件保持冻结。
- 最终 full 675 文件、5431/5431，193.71 秒，零失败/取消/跳过。3631 个快照文件状态前后一致，18 个本次修复/同步测试文件与原工作区哈希一致。其他会话后续的高级歌词/场景/导歌修改未纳入这次快照，不回滚、不据此声称这些后续修改已完成全量验证。
- 完成证据保留在仓库根 `output/code-audit-fixes-2026-11-10.md` 及 `tmp/audit-fixes-2026-11-10/` 的红绿日志、最终完整结果、patch 与哈希清单。技术参考已同步，用户操作不变；未提交、打包、部署或操作真实账号数据。
- 归档后的原工作区文档检查遇到另一新计划 `advanced-lyric-expressions` 的中文状态标签无法解析；仅将标签改为 `Status: In Progress`，保留原状态及正文，以解除本任务文档验证阻塞。
