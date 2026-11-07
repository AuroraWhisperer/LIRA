# 重复工作审计：调用放大与无效消费

Status: Completed (2026-11-07)

## 目标与范围

按用户要求换角度继续并行审计：从事件扇出、部分结果的全量处理、后台消费者、集合连接和重复 I/O 找出真实的大量重复工作，在 owner 层修复并以隔离操作计数和行为对照验证。范围为 Live 客户端；[前一轮](2026-11-07-repeated-work-audit.md) 的四项修复只作为基线，不重复计入发现。

## 当前状态与边界

当前工作区有歌词、弹幕、礼物等其他任务修改。保留这些修改，候选确认前不改代码；写入前保存 owner 当前源码。公共 HTTP/WS/IPC、持久化格式、事务一致性、授权隔离、数据新鲜性、错误与取消语义保持。不得通过跳过完整性验证、缩小必需结果或扩大缓存寿命获得数字上的收益。不提交、创建分支、发布、操作真实账号或用户运行实例。

## 所有者与验证路径

| 审计视角 | 写入范围 | 消费者及参考 |
| --- | --- | --- |
| 资源/分页/只取部分结果 | 代理确认后的独立资源或业务 owner | 所属 reference、直接调用者及既有测试 |
| 后台计算/重复 UI 更新/集合连接 | 独立 `public/js/` owner | Admin/overlay 参考、所属前端行为测试 |
| N+1 查询/批处理重复派生 | 独立 `src/storage/` owner 与必要调用者 | storage 参考、所属存储/业务测试 |
| 事件扇出/序列化/消费范围 | 主代理的 `src/server/`、`src/scenes/` | server-core、ws、overlay 参考及传输/场景测试 |

跨分支文件先协调；计划和技术文档统一由主代理维护。确认项逐条记录真实触发入口、基线操作量、拟改文件、行为不变量和直接验证命令。没有量级证据或现有实现已处理的候选记录排除原因。

## 里程碑

- [x] 四个视角追踪真实调用链并记录确认项与排除项。
- [x] 确认项使用 `tmp/repeated-work-audit-round2-2026-11-07/` 的源码快照和合成数据取得修前计数；在 owner 最小修复。
- [x] 复用所属测试验证输出、错误、新鲜性及取消等实际受影响契约；记录修后计数和具体命令。
- [x] 同步所属技术参考，核对用户指南与引导影响；无行为变化时保留并说明。
- [x] 运行修改 JS 的语法检查、`npm run verify:docs`，按实际跨域风险运行 `npm run verify:architecture`；最终审查任务 diff、`git diff --check` 和 `git status --short`。

## 确认项与证据

1. **AI 送达确认的历史重扫**：`bilibili-client.onMessage → deliveryVerifier.observe` 在一个 waiter 等待期间对每条新弹幕重新扫描全部 60 秒缓冲。5,000 条历史、1,000 条后来普通弹幕加 1 条回复，事件遍历 5,511,501→6,001；其中注册时历史匹配仍为 5,000，后续匹配由 5,506,501→1,001。`src/ai/danmaku-delivery-verifier.js` 只将新事件交给已有 waiter，注册仍查全部历史。原本不能匹配的旧事件不会因 matched 增长或 consumed 变 true 而重新成为匹配，逐事件消费顺序、账号、发送时间、前缀、超时与取消不变。新增所属复杂度回归修前失败（1,506,506 次访问），修后通过；五个所属 AI 文件共 49 项通过。独立只读复核未发现语义回归。
2. **完整粉丝备份 N+1**：`fan-profile-store.exportScope` 经备份、恢复预览摘要、恢复/合并前快照调用，为每份档案分别查询记录和提醒。复用现有每批 500 ID 的 reader；1,000 档案各 2 记录和 2 提醒，SELECT/prepare 2,003→7，仍返回 5,000 行，完整 JSON SHA-256 一致。`test/fan-profiles/fan-profile-list-queries.test.js` 扩展现有用例，修前记录查询断言 504≠3，修后通过。
3. **完整本机恢复点的重复模板清理**：`profile-transfer.restoreSnapshot` 原循环逐个 remove，已存在的 `removeAll(scope)` 可在同一事务中一次清除全部当前 scope 档案并回收模板。1,000 档案/1,000 模板，档案 DELETE 1,000→1、模板回收 1,000→1、SELECT 1,018→17；删除数量相同，其他 scope 档案/模板保留，恢复点仍为 2 份。与备份修复合计 42 个不同测试通过；最后此行变更后重跑其中 41 项，覆盖失败回滚、黑名单、scope、紧凑模板和恢复点。独立只读复核确认批 reader 完整性、排序与外层事务保留。
4. **增强下拉的全列表重写**：`select-menu` 一次选择经过 selectedIndex setter、显式同步和 change listener，原来三次扫描并重写所有选项。字体列表来源为本机全部可用字体。500 选项的点击中，扫描节点 1,500→0，aria-selected 与选中 class 写入各 1,500→2。选择只更新旧/新节点，动态 options 重建时重建索引。7 项 lifecycle 和 2 项既有 Chromium 检查通过，包含重复 value 的原生 index、程序设置、清空、重建和过滤；展开、过滤及首次构建仍处理所需集合。
5. **素材库盘点/清理二次方查找**：`component-library-maintenance` 每个目录都以 packages.some 查归属，批量选中又逐项 entries.find。改为当次请求的 Set/Map。上限内 1,000 个合成安装包：目录匹配 500,500 次比较→1,000 次集合查找，清理选中匹配 500,500 次比较→1,000 次 Map 查找，另有各一次线性索引构建。真实隔离目录和索引下，三份完整 inventory 摘要、释放字节数、失败 ID 顺序、剩余目录和授权次数前后一致；有额外 4 个目录时盘点为 503,501→1,004。所属维护/恢复/传输 22 项通过。盘点、引用、授权、备份和实际文件检查全部保留，未注册/暂存目录不被批量选择清理。

计数、修前源码与探针保存在根 `tmp/repeated-work-audit-round2-2026-11-07/{ai,storage,frontend,events}/`，使用合成数据，不是用户当前规模或实机 CPU/帧率收益。所用真实 SQLite 与文件目录均隔离；测试浏览器由既有 teardown 关闭。

## 排除项与同步

- WebSocket 已合并同一 microtask 的状态广播，并按 principal/scope 复用帧；场景按消费类型取数和复用共享外观，未加第二层缓存。云端显示缓冲限 200 事件，没有将其有限扫描计作大量重复计算。
- 工具箱仅初始化当前页面/功能，复用在途 loader；资源下载页面隐藏时在详情计算前返回、订阅有幂等守卫；歌库只有 SONG_UPDATED 重画并复用同查询在途请求；计划日历已有日期/月 WeakMap 索引；六处组件库 list 共享 pendingList。未发现可复现的新后台轮询或重复注册放大。
- CDN 初始化、ZIP 成员与下载已有 Map、单次任务和合并；完整哈希承担真实性校验，保留。素材依赖闭包的多轮扫描尚无常规规模放大证据，没有为构造的极端链改写。
- 粉丝普通列表已有批 reader，歌库导入已有批内复用，队列使用 JOIN，AI 配额为原子计数；必要线性读取不列为缺陷。粉丝冲突界面的 records.find 也没有高频/高冲突规模证据，未修改。
- 技术参考同步 `docs/reference/backend/ai.md`、`storage.md`、`frontend/pages.md`。公开接口、字段、功能入口、操作和用户可见限制不变，指南、应用内说明和交互引导无需修改；既有行为断言保持，仅补实际复杂度或数据完整性缺口。

## 实际聚焦验证命令

```powershell
node --test test/ai/ai-danmaku-delivery-verifier.test.js test/ai/ai-assistant-delivery.test.js test/ai/ai-assistant-session.test.js test/ai/ai-assistant-lifecycle.test.js test/ai/ai-conversation-continuity.test.js
node --test test/fan-profiles/fan-profile-list-queries.test.js test/fan-profiles/fan-profiles-transfer.test.js test/fan-profiles/fan-profiles-merge.test.js test/fan-profiles/fan-blacklist.test.js test/fan-profiles/fan-roster-storage.test.js
node --experimental-vm-modules --test test/ui/frontend-select-menu-lifecycle.test.js
node --test test/ui/frontend-select-menu-browser.test.js
node --test test/scenes/component-library-maintenance.test.js test/scenes/component-style-recovery.test.js test/scenes/component-library-transfer.test.js
```

上述共 122 个不同用例通过。before/after 探针分别为 `ai/measure-delivery.cjs`、`storage/fan-export-probe.cjs`、`storage/fan-restore-probe.cjs`、`events/measure-maintenance.cjs`；最后一个位置参数选择 before 或 after，before 只加载保存源码，不回写工作区。下拉计数与实际命令另见 `frontend/select-menu-counts.json`。

九个修改的 JavaScript 文件语法检查通过；跨域架构门禁 30/30 通过。当前结果证明本轮检查时架构门禁已通过，不沿用前一轮其他并行任务造成的失败状态，也不代表已做全仓发布测试。

文档门禁 10/10、全工作区 `git diff --check` 通过，源码/测试差异与三份技术参考相对本轮基线的差异已复核。已检查最终 `git status --short`；新增运行数据与计数探针均在根 `tmp/`，保留其他任务修改，未提交、发布或修改真实用户数据。本轮已确认项均完成并有直接验证；不声称真实直播压测或全仓已无其他性能隐患。

## 失败处理与完成条件

不能复现的假设不实施；必要行为受损时仅撤销任务自身修改，不整文件回退。此轮完成须有新视角下的调查证据、所有已确认项的修复与聚焦验证、文档同步及最终差异审查。操作计数不等于实机 CPU/FPS/网络吞吐收益，不宣称全仓已不存在效率问题。
