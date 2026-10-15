# 专项性能审查修复计划

Status: Completed

用户已要求修复专项审查确认的问题；本计划同时记录客户端和相邻 `lira-server` 仓库的验证。

## 目标与边界

消除固定弹幕移动结束后的重复适配、场景刷新读取无关状态及未变化歌库、服务器空闲汇总清理逐组扫描。保持有效事件、刷新频率、动效、当前协议、租户隔离和数据保留语义。不提交、发布、修改生产配置或操作正在使用的应用；所有验证使用隔离数据，临时材料放各仓库 `tmp/`。

## 当前证据与职责

- `public/js/overlays/danmaku-feed.js` 的移动完成回调再次全量布局。上轮隔离 Chromium 的 640×240 样本中，旧长 SC 在约一秒内重复适配两次；第二次字体与高度未变。动效契约及测试属于 `docs/reference/frontend/danmaku-motion.md`、`test/danmaku/danmaku-feed-motion.test.js`。
- `src/server/scene-components.js` / `scene-extra-display.js` 请求全量 `src/server.js#getState`。歌词刷新附带队列、SC、礼物、冲刺读取；混合场景还重新查询完整歌库。端口应选择所需字段，沿用现有 `songStore.getChangeToken` 验证歌库新鲜度。归属文档为 `docs/reference/frontend/overlays.md`；测试为 `test/scenes/` 及组合根相关测试。
- Server `src/storage/gift-summary-cleanup.js` 的 `LIMIT` 只限制结果；无过期组时仍扫描两张组表。已有纯内存证据：各 600 组、0 可删除行时扫描 1200 组。应由 `gift_summary_days` 日版本驱动现有主键访问。契约为 Server `docs/protocol/gift-retention.md`，测试为 `test/gift-retention.test.js`。

## 最小改法与兼容约束

1. 分离已有固定弹幕淘汰循环，移动完成仅用最近已测布局清理；有待执行布局时先让其更新几何。尺寸、效果和新内容变化仍完整适配，不改变动画参数或文字栅格。
2. 为内部状态读取提供可选字段选择，无参数仍返回原完整快照；场景端口声明所需字段，一次输出共享读取。歌库显示复用同一 owner/epoch 与数据库变更标记下的查询结果，真实写入及账号切换立即失效。公共 HTTP/SSE 返回结构与刷新节奏保持不变。
3. Server 仅调整选取可删组的查询顺序，保留 `keep`、24 小时快照、在建 base、两张组表先于日版本/总版本清理和全批最多 500 行。不改 schema、调度或配置。

## 里程碑及验证

- [x] 动效：在现有测试补充长 SC 完成移动后不再写字体、真实尺寸变化仍重新适配；运行 `node --experimental-vm-modules --test test/danmaku/danmaku-feed-motion.test.js test/danmaku/danmaku-overlay-renderer.test.js`。复用隔离预览检查上下滚动、密集打断和长文本稳定；不把 Chromium 证据写成真实直播验收。
- [x] 场景：覆盖按需字段、歌词实时更新、歌库复用/写入失效/owner 切换；运行 `node --experimental-vm-modules --test test/scenes/scene-display.test.js test/scenes/scene-extra-components.test.js test/scenes/scene-runtime-events.test.js test/scenes/scene-source.test.js test/server/domain-services-initialization.test.js test/server/server-modules.test.js test/songs/song-metadata.test.js`，另运行 `node --experimental-vm-modules --test test/scenes/shared-appearance.test.js`。
- [x] Server：扩展现有保留期测试，验证无过期版本时不扫描组表、分批删除、受保护旧快照及在建 base。先 `npm run verify -- --node test/gift-retention.test.js --plan` 再相同范围执行。
- [x] 同步受影响的技术说明，运行客户端 `npm run verify:docs`、Server `npm run docs:check`；后者有一项无关计划元数据失败，见下方限制。用户入口、操作和设置无变化，指南无需改写。
- [x] 检查两仓任务所涉 diff、`git diff --check`、`git status --short`。保留已有未提交修改，确认无运行数据或秘密进入本任务改动。

## 失败处理与完成条件

失败先定位本任务改动或已有环境/并行修改，不扩大到无关模块；必要时仅逆转本任务补丁，不使用 reset、整文件 checkout 或广泛删除。完成要求以上问题的最小修复及聚焦回归通过、实际动效检查和限制有记录、契约与说明一致。子代理仅提供只读核对，主代理统一实施与核实。

## 验证记录

2026-10-15 完成：

- 客户端场景/组合根/歌库 76 项、共享外观 8 项、弹幕 34 项通过；Server 保留期 14 项通过，合计 132 项聚焦回归。新增 Server 夹具曾误用不存在的 user_id 列，改为既有 uid/user_name 后重跑完整文件通过，没有修改业务保留判定。
- 客户端文档 10 项通过。Server 文档 55/56，通过的检查覆盖修改后的契约和链接；唯一失败为本任务未改动的 `docs/superpowers/plans/2026-10-15-gift-effects-category.md` 缺少生命周期说明。该并行计划不属于本次修复范围，未宣称 Server 文档门禁全绿。
- Chromium 151.0.7922.34 隔离预览实际播放长 SC、常速/密集追加、上下方向和 240→300px 高度变化；检查中间与稳定帧，无页面错误，未观察到交叠或文字尺寸跳动。月渡上下 × 1/0.63 缩放和清理后追加由现有浏览器回归覆盖。未操作真实 Electron 应用、OBS、哔哩哔哩直播姬或直播连接。
- 与审查相同的 640×240、102 字 SC、原有 1 条加 1 条短弹幕样本，60 帧约 999.6ms 内：旧卡片适配 2→1 次、字号写入 20→10 次、高度读取 22→11 次；字号仍为 21.6797px、高度 215px。真实高度变化仍将字号适配为 24.0234px。这是操作计数，不是生产 CPU 或帧率收益估计。
- 组合根回归确认歌词字段读取不调用队列、SC、礼物、冲刺或歌曲元数据 getter；无参数完整快照仍包含原字段。混合歌词场景在歌词进度变化时复用歌库查询，真实写入、禁用歌曲、owner/epoch 变化及显式失效会重读。
- Server 的 EXPLAIN 回归确认两张组表按 day/revision 主键 SEARCH，不再 SCAN 组表；24 小时边界、在建 base、未变日期旧版本、逐批统计一致性通过。未做生产压力测试。
- 两处只读子代理复核未发现新增缺陷。两仓 diff 检查通过；隔离数据库、预览服务、浏览器均已关闭。基线、计数和截图仅在各仓 `tmp/performance-fixes-20261015/`；不提交、打包、部署或更新安装版。
