# 重复工作并行审计

Status: Completed (2026-11-07)

## 目标与边界

继续审计 Live 客户端真实调用链上的大量重复计算、扫描和构造。以可重复的操作计数确认工作量放大，再在所属模块内修复并检查结果等价性。保留已有未提交修改，不提交、发布、操作真实账号或用户运行实例；本轮范围为 `D:/Work/Live`。

## 当前行为与约束

前期已修复设置投影、资料清理、礼物图片解析、样式索引、画猜复制与隐藏面板轮询，证据见 [前轮审计](2026-11-06-repeated-work-audit-round3.md)。这些记录只用于定位，不能计作本轮新发现。当前工作区还有歌词、弹幕和礼物相关并行工作；修改前保存相关文件副本，按负责人划分写入范围。

保持公共 HTTP/WS/IPC、持久化格式、授权与账号隔离、取消与错误语义、返回对象隔离。没有可复现量级证据的线索不实施，不添加推测性缓存、依赖或后台任务。

## 所有者与独立批次

| 分支 | 审计与写入范围 | 相关参考与验证入口 |
| --- | --- | --- |
| 音乐 | `src/music/` 与所属音乐后端测试 | `docs/reference/backend/music/services.md`、`test/songs/`、`test/playback/` |
| 事件与聚合 | `src/bilibili/`、`src/fans/`、`src/overtime/` 及非音乐所属存储 | `docs/reference/backend/bilibili/`、`docs/reference/backend/storage.md`、所属领域测试 |
| 前端 | `public/js/` 与所属前端测试 | `docs/reference/frontend/`、对应 Node/VM 测试 |
| 服务端编排与桌面 | `src/server/`、`src/electron/`，由主代理负责 | `docs/reference/backend/server-core.md`、`docs/reference/desktop/main.md`、`test/server/`、`test/desktop/` |

跨范围编辑先协调，计划和技术文档由主代理统一维护。每个候选先记录触发条件、消费者、原执行量、最小改动和验证方式，再实施。

## 确认项与实施证据

1. 随机点歌：`song-service.listRandomSongCandidates` 调用 `random-song-filter` 扫描歌库，原先每个标签匹配都重新归一化同一个观众查询词。`tag-aliases.js` 提供按次编译的标签匹配条件，保留按需访问标签和单向别名。5,000 首、每首 5 标签、3 条条件下，查询词归一化 40,009→12，全部归一化 100,009→60,012，标签归一化仍 40,000；纯歌手请求不触发标签处理，总归一化只增加一次条件编译。61 次前后完整结果对照一致，包括可变输入重新读取。
2. 全民 K 歌缓存：`hasWeSingCacheData` 原来为布尔存在判断调用完整的最新 QRC 扫描。目录有效性检查改为复用原有每批 100 并行文件校验，首个有效批次即停止；真正找最新歌词仍完整扫描并排序。1,000 个 QRC、20 次检查，stat 20,000→2,000，排序 20→0；readdir 仍 40 次、枚举仍 20,000 条。保留批量并行，避免无有效文件时串行 I/O 倒退。前两项修改 `src/music/random-song-filter.js`、`tag-aliases.js`、`wesing-cache.js` 和所属两个测试，52/52 通过。
3. 动态抽奖：`draw-service` 每核验一位候选前后都读取全轮次，`getResult` 也完整解析不可变随机顺序。`dynamic-lottery-draw-store.js` 仅按 order ID 与当次读库原文复用一份解析结果，公开完整读取仍复制数组；执行器一次启动/恢复持有顺序，每次核验取得窄进度。2,000 个候选、核验 100 人、进度读取 101 次，名单解析 304→1，解析 UID 608,000→2,000，中奖者和结果一致。SQLite 原文读取仍保留；事务内继续验证最新轮次、状态、索引和 UID。所属 28/28 回归通过，含暂停恢复、返回数组隔离、回滚、外连接改写后重读和拒绝过期 UID；测试复用 scratch helper 后所属 results 4/4 重跑通过。
4. 画猜形状预览：`games-drawing.js` 每个 pointermove 重放全部旧笔画；普通画笔已有增量路径。100 条、每条 50 点历史，拖动 100 次，直线 lineTo 495,000→5,000，矩形 495,300→5,300，椭圆 498,900→8,900。每次手势增加一次底图捕获和 100 次位图恢复；1280×720 底图 3,686,400 字节，101 次 drawImage 的源面积合计 93,081,600 像素，并非实际 GPU 传输量。底图仅由当前形状手势持有，远端操作、快照重绘和实际像素尺寸改变后失效。所属 17/17 测试通过；独立 Chromium、DPR 2 下三种工具在拖动、远端追加/撤销/清空、快照、960×540 resize、pointercancel、下一手势和禁用后的 27 个像素摘要前后相同，提交坐标一致。

前述产品行为与接口未改变，音乐、抽奖和画猜技术参考已同步；使用指南、应用内说明和引导不需要调整。自动化只补了条件重复规范化、文件检查早停、抽奖名单复用/隔离、手势历史复用/失效等真实回归风险，保留原有效行为断言。

## 排除项与覆盖限制

- WebSocket 已在同一 microtask 合并快照，并按 principal/scope 复用编码帧；场景歌曲和歌词已有版本/引用缓存，不叠加另一层。
- 资源完整性进度通知已限制为每 250ms，公开详情最多 20 条；评分已有累计总分和 Map，投票为按选项索引增量计数。相关既有传输、完整性和评分压力测试共 38/38 通过。
- `component-style-client.js` 已共享在途 list 请求，开播样式编辑只挂载当前选中项；未确认多面板重复请求，不改接口或增加缓存。
- 前端歌词已有二分查找、可见行增量和帧门控，歌单滚动已有有限 DOM 窗口，粉丝列表轮询已有可见性判断；本轮未改正在开发的高级歌词。
- 动态抽奖 ready 状态不会持续轮询，撤销“候选人数不断重算”的候选，不增加人数缓存。
- 前几轮的资料、关键词、礼物图片、盲盒缓存仍在；粉丝投影、加班机、云同步、礼物恢复和绘画广播未取得新的量级证据。未对这些路径声称全量吞吐验收。

## 实际验证命令

```powershell
node --test test/wesing/wesing-cache-discovery.test.js test/wesing/wesing-capture.test.js test/wesing/wesing-capture-refresh.test.js test/songs/tag-aliases.test.js test/songs/random-song-filter.test.js
node --test test/dynamic-lottery/dynamic-lottery-results.test.js test/dynamic-lottery/dynamic-lottery-service.test.js test/dynamic-lottery/dynamic-lottery-retention.test.js test/dynamic-lottery/dynamic-lottery-transaction.test.js test/dynamic-lottery/dynamic-lottery-store.test.js
node --experimental-vm-modules --test test/games/games-drawing.test.js test/games/games-overlay.test.js test/games/frontend-games.test.js
node --experimental-vm-modules --test test/transport/websocket-transport.test.js test/games/interaction-rating-pressure.test.js test/desktop/resource-integrity-manager.test.js
```

临时前后计数分别为 `music-probe.cjs before/after`、`wesing-probe.cjs before/after`、`measure-lottery-order.cjs before/after`，61 次结果对照为 `music-equivalence.cjs`，都在本轮 `tmp/` 下；before 加载保存的原源码，不回写工作区。

画猜探针为同目录 `measure-shape-background.cjs`，结果为 `shape-background-counts.json`；探针正常退出，独占 BrowserContext、浏览器及临时 HTTP 服务已关闭。它检查浏览器源 Canvas 输出，没有操作用户桌面应用或真实直播。

上述四组聚焦检查共 135 个不同用例全部通过，10 个修改的 JavaScript 文件语法检查、文档门禁 10/10、全工作区 `git diff --check` 通过。本轮产品/测试差异及所属技术参考差异已复核，最终状态已检查；探针、截图和合成数据仅在根 `tmp/`，未提交或发布。

`npm run verify:architecture` 为 29/30，唯一失败是本轮范围外的高级歌词并行改动：`src/storage/settings-defaults.js` 导入 `public/js/shared/advanced-lyric-appearance.js`，触发存储层不得依赖前端的门禁。已从该文件 diff 确认新增导入及所属视觉默认值；本轮未修改该文件或门禁，未宣称整个工作区通过架构验收。此项归现有高级歌词实施工作处理，不影响上述四处修复的聚焦结果；不以额外缓存或放宽依赖断言掩盖失败。

## 里程碑与验证

- [x] 并行追踪高频入口与大集合消费者，排除已有缓存和必要工作。
- [x] 对确认项保存修改前源码，并用隔离数据复现原执行量和输出。
- [x] 在 owner 层修复，运行直接相关测试及前后计数；新增断言只防护具体回归。
- [x] 复核技术参考和用户指南影响；接口、操作不变时保留用户说明。
- [x] 复查各分支 diff，运行修改 JS 的语法检查、`npm run verify:docs`、涉及多域的 `npm run verify:architecture`、`git diff --check` 并检查 `git status --short`；架构门禁的独立失败已在上文记录。

所有探针、基线和合成数据置于 `tmp/repeated-work-audit-2026-11-07/`。聚焦命令采用 `node --experimental-vm-modules --test <所属测试文件>`，具体文件随确证候选记录。计数证明工作量变化，不作为实机 CPU、帧率或延迟保证；不运行无关全量套件。

## 失败处理与完成条件

若优化改变必要行为或收益不能证实，只逆向撤销本任务对应修改，不恢复整份文件。确认项全部修复且聚焦验证、文档同步、最终审查完成后收束本轮，记录已查范围和未验证边界；不声称整个仓库再无效率隐患。
