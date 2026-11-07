# 重复工作审计：第三轮并行放大核查

Status: Complete (2026-11-07)

## Goal

继续审计 Live 代码中随输入规模放大的重复计算、重复 I/O 和无效消费。每个候选必须沿真实调用链用隔离合成数据取得修前操作量，确认存在异常放大后在 owner 层做最小修改，并保留公共契约、数据完整性、授权、新鲜性和取消语义。

## Non-goals

不做全仓重构、微优化或基于静态形态的猜测；不修改用户运行实例、真实账号、发布配置，不提交、建分支或发布；不重复第二轮已经修复或排除的候选。

## Current Behavior

第二轮已修复 AI 历史重扫、粉丝备份/恢复 N+1、下拉全列表重写、素材库二次方查找等真实放大。第三轮先并行核查粉丝提醒/会员计算、存储和服务缓存、字体控件及其他未覆盖的高频路径；修前计数和语义对照写入 tmp/repeated-work-audit-round3-2026-11-07/。

## Ownership

三个代理分别审计粉丝计算、存储/服务缓存、前端字体/搜索；主代理审计礼物投影与命令去重，并复核代理的源码、测试和计数脚本。修复集中在七个 owner：

- `src/fans/reminders.js`、`src/fans/membership-milestones.js`，供 `profile-service` / `profile-projection` 的列表、详情、日历和提醒消费。
- `src/storage/dynamic-lottery-budget-store.js`，由抽奖 runtime 创建一个 store，供同一请求调度器预留/结算预算。
- `src/bilibili/gift/projection-service.js`，由远程礼物 controller / runtime 导入 progress/final。
- `src/bilibili/danmaku/message-deduplicator.js`，供实时消息 handler 与历史补偿 poller 去重。
- `public/js/shared/font-library.js`，供管理页固定字体控件及画布检查器注册/释放。
- `public/js/admin/usage-guide-search.js`，供使用指南输入查询。

技术 owner 同步到 [粉丝与字体参考](../../../docs/reference/frontend/app.md)、[页面参考](../../../docs/reference/frontend/pages.md)、[存储参考](../../../docs/reference/backend/storage.md)、[礼物参考](../../../docs/reference/backend/bilibili/gift.md) 和 [弹幕参考](../../../docs/reference/backend/bilibili/danmaku.md)。

## Compatibility Constraints

保持 HTTP/WebSocket/IPC、持久化格式、事务边界、权限隔离、错误/取消和用户可见结果不变；缓存不能扩大数据寿命或跳过完整性校验。临时脚本和合成数据只能放在根 `tmp/`。

## Milestones

- [x] 三个并行方向完成候选调用链、修前计数和排除项审计。
- [x] 对有真实异常放大的候选完成 owner 最小修复及行为测试；无证据候选仅记录排除理由。
- [x] 汇总测试、语法、架构/文档门禁和最终 diff/status 检查。

## Verification

各方向聚焦回归共 178 个不同用例通过，另有隔离规模/可达性探针。主代理运行 `npm run verify:docs`（10/10）、`npm run verify:architecture`（30/30）和本轮 12 个 JS 文件的 `node --check`，全部通过。已逐项复核源码/测试和文档相对本轮基线的差异，`git diff --check` 通过，`git status --short` 已检查；本轮未引入临时、运行数据或敏感内容，保留工作区原有未提交变更。

### 聚焦命令与结果

```powershell
# 礼物：39 个本地行为/事务/消费者用例通过。
node --test test/gifts/gift-projection-service.test.js test/gifts/processed-gift-import.test.js test/gifts/processed-gift-import-atomicity.test.js test/gifts/processed-gift-contract.test.js test/gifts/remote-gift-controller-commit.test.js test/gifts/gift-retention.test.js
# 首次契约文件因默认 Server 检出与锁不符未能加载；使用已核验的现有隔离检出补验 5/5。
node scripts/verify-server-contract.js D:/Work/Live/tmp/overtime-start-qa/server-contract
$env:LIRA_SERVER_ROOT='D:/Work/Live/tmp/overtime-start-qa/server-contract'
node --test test/gifts/processed-gift-contract.test.js

# 命令去重及上层调用：31/31。
node --test test/bilibili/message-deduplicator.test.js test/bilibili/bilibili-user-info-pollers.test.js test/bilibili/bilibili-diagnostics.test.js test/bilibili/bilibili-superchat.test.js test/danmaku/danmaku-client.test.js

# 会员/提醒/陪伴/投影：47/47。
node --test test/fan-profiles/fan-membership-milestones.test.js test/fan-profiles/fan-profiles-domain.test.js test/fan-profiles/fan-guard-accompany.test.js test/fan-profiles/fan-profile-projection.test.js

# 请求预算/调度/事务：14/14。
node --experimental-vm-modules --test test/dynamic-lottery/dynamic-lottery-store.test.js test/dynamic-lottery/dynamic-lottery-scheduler.test.js test/dynamic-lottery/dynamic-lottery-transaction.test.js

# 字体、歌词消费、loader、礼物许愿及使用指南浏览器交互：42/42。
node --experimental-vm-modules --test test/desktop/local-font-library.test.js test/lyrics/desktop-lyric-settings-runtime.test.js test/ui/font-library-loader.test.js test/gifts/frontend-gift-wishes.test.js test/admin/frontend-usage-guide-search-browser.test.js
```

Server 隔离检出为契约锁对应的 `67119e81a3f5f49470ed2b191f6552556d0a704e`，10 份 fixture 校验通过；未更改锁和用户 Server 检出。未运行全量套件，不宣称整个工作区全绿。

## 确认项、改动与证据

以下计数使用实际模块和调用链，以隔离合成数据或当前页面内容重放；它们衡量工作量，不代表生产 CPU、延迟或吞吐收益。

| 确认项 | 场景与修前工作量 | 修后工作量 | 最小修复与不变量 |
| --- | --- | --- | --- |
| 历史提醒平方级判重 | 1,000 / 5,000 条已处理历史，key 比对 499,500 / 12,497,500 次 | 1,000 / 5,000 次 | 结果同步登记 key Set，保持生成阶段的重复语义、历史去重和排序 |
| 连续会员基线全区间查找 | `buildReminders` 的 100×100 / 1,000×1,000 基线与区间，30,000 / 3,000,000 次查找检查 | 2,022 / 29,934 次 | 在既有有序、不重叠的合并区间上二分定位，保留半开边界 |
| 抽奖预算 SQL 重编译与重复写入 | 真实调度器执行 1,000 次请求，prepare 22,382；UPDATE 8,794 | prepare 3；UPDATE 6,794 | 实例复用固定语句，成功预留每 scope 保存一次；每次仍读取数据库 |
| 礼物 final 重复字段保存/读取 | 1,000 笔纯 final 字段 UPDATE 1,000；已有 progress 后 final 字段 UPDATE / 读取各 2,000 | 纯 final 字段 UPDATE 0；已有 progress 后各 1,000 | INSERT 已带字段时直接 finalize，否则更新一次；必要 markFinal、事务和消费者分发不变 |
| 命令去重反复扫描无关文本与年龄 | 预热 500 条后 1,000 对实时/历史命令，跨源比较 1,000,000，年龄遍历 1,001,000 | 比较 1,000，年龄遍历 0；必要容量淘汰 1,000 | 同文本候选索引、有序 Set 和最早时间下界；维持先匹配后清理及原容量/TTL |
| 字体注册刷新所有已有菜单 | 真实 CSS 89 个 FontFace、4 个永久控件和 20 次检查器挂载，族名读取 33,820、共享选项创建 1,900、组重建 100 | 1,780 / 380 / 20 | 每轮按 family 建一次索引；清单未变时只填新控件，加载完成或清单变化仍更新现有控件 |
| 指南搜索每次重复规范化静态内容 | 当前 300 项、连续 8 次查询（含首次索引），lowercase 3,151 次 / 876,918 字符 | 755 次 / 102,395 字符 | 索引保存规范化文本，过滤、标题评分和摘要复用；仍完成所有查询和渲染 |

### 可达性与行为核对

- 粉丝：正常 `save-record` 路径隔离保存 100 个不同日期基线和 100 个间隔区间，均保持 adopted；不是仅向底层函数传入无法产生的数据。完整 `buildReminders` 修前修后 deepStrictEqual；既有 300 组随机候选日与逐日 oracle 对照通过。新增两项操作量回归在保存的修前源码下均失败。
- 预算：请求 1,000、等待 1,397、虚拟耗时 5,588,000ms 和最终两行数据库内容一致。新增回归覆盖受阻时保存过期时间/冷却/批次清理、第二个 scope 写失败的完整回滚以及同 store 重试，利用临时 SQLite trigger 核对每 scope 一次 UPDATE。
- 礼物：两种 final 场景完整行与消费者事件 SHA-256 均为 `121b8032ea8eb3f46d866dcfd59788a354c8d17bb7109130c9c47ecd75516765`。不新增行为测试，现有 progress/final、原子提交/回滚、保留及契约覆盖加独立计数足以核对这两行删除。
- 去重：规模场景后追加 10,000 个随机输入，含同源、重复文本、匿名/遮罩名、同秒 key、时钟回退、过期和容量；12,000 个接受/拒绝结果及最终缓存摘要一致：`f754b159376fbc2190574bb1651cbc043ad189caf090161ae93c3ce73a908416`。新增回归覆盖无关文本不被扫描、容量索引淘汰和时钟倒退。存储代理独立只读复核配对顺序、时间下界和清理语义，未发现遗漏。
- 字体：计数仅统计完成永久控件初始化后 20 次挂载；每次仍有必要的 19 个共享选项，另外 20 个默认选项未计入共享选项数。原生字体查询仍只一次，新增控件不替换旧菜单的回归修前失败、修后通过；在途字体加载、失败、字体替换和 dispose 的既有检查通过。
- 搜索：序列为“服”至“服务器同步到一半”，包含首次建索引；八步匹配数量一致。既有浏览器交互验证标题结果、折叠内容展开、正文高亮、焦点与清理；未增加静态文案断言。

所有计数脚本与基线保存在根 `tmp/repeated-work-audit-round3-2026-11-07/`：`audit_music/measure.cjs`、`audit_music/record-reachability.cjs`、`audit_storage/measure-budget.js`、`audit_storage/measure-exclusions.js`、`audit_gifts/measure-projection.cjs`、`audit_dedup/measure-dedup.cjs`、`audit_frontend/font-work-counts.cjs` 和 `audit_frontend/search-work-counts.cjs`。临时探针不进入生产或持久测试基础设施。

## 排除项与同步评估

- `song-summary` 常规新增只处理 `[previous, record]`，大数组用于一次迁移/旧备份压缩，且排序承担备注顺序语义；未证明反复大规模处理，未改。
- 世界时钟同城 1,000 次读取仅一次上游 fetch；100 个同款场景组件只读一次 settings 和一次共享外观；系统字体枚举已有共享 Promise，均未改。
- 用户信息缓存已有到期清理节流；设置副本、历史排序中的时间戳解析和歌曲匹配规范化尚无真实规模证据，本轮不改。
- 五份 owning reference 已同步实现事实。HTTP/WebSocket/IPC、持久化格式、权限、限流与用户操作不变；README、用户指南、页面说明和交互引导无需修改。
- 行为回归仅扩展所属五个测试文件；搜索和礼物复用既有覆盖。未添加布局/文案快照或全仓静态实现断言。

## Rollback Or Failure Handling

只撤销本轮已确认的 task-owned 行，不整仓回退；若计数不能证明规模放大或语义对照失败，保留源码不改并记录排除理由。

## Done When

每个确认项都有调用链、before/after 操作量、直接测试和行为不变量记录；排除项有具体规模或调用证据；相关文档同步评估完成，最终门禁和差异审查通过。
