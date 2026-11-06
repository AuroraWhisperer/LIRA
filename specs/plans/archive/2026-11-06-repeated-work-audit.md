# 重复计算与高频路径效率审计

Status: Completed (2026-11-06)

## 目标与边界

沿真实调用链寻找工作量随用户数、记录数、刷新频率放大的重复扫描、重复构造和无变化重算；用合成数据计数确认，再做所属模块内的最小修复。保持输出、过期规则、排序、取消、授权、持久化和公共协议。保留已有未提交修改，不提交或发布，不连接真实账号或操作用户运行实例。

## 当前证据与所有者

- 用户资料：`src/bilibili/users/user-info-service.js` 的 `peek/ensure` 每次全量清理 records 和身份索引；已有 ingest 间隔门控可复用。消费者包括消息身份读取和 `src/server/gift-card-runtime.js` 的头像补全。契约为 `docs/reference/backend/bilibili/danmaku.md`；已有 `test/bilibili/bilibili-user-info-service.test.js`、身份缓存及卡片测试。
- 礼物导出：`src/electron/gift-export-controller.js` 的保存循环每张图片重新创建完整布局，只为取得总数。保存中禁止配置变更，可用单次保存的局部布局。已有 `test/gifts/gift-export-controller.test.js` 覆盖输出、取消和失败。
- 导出预览：`public/js/admin/gifts/export-preview.js` 每次翻页对全部卡片分页；直接使用已有 `task.files` 的 start/count，只切出当前页。扩展 `test/gifts/frontend-gift-export-settings.test.js` 的既有设置场景验证翻页内容；不改桌面 IPC。
- 画猜增量：`src/games/draw-guess.js` 的 `applyDrawOperation` 每次追加最多 32 点，却复制全部历史笔画的点数组；内部状态由 `game-session-service` 拥有，公开投影另行深复制。只复制本次修改笔画，其他笔画共享不可变状态。验证旧状态不被改变、公开快照不能反向改内部、撤销/清空和顺序；契约 `docs/reference/backend/api.md`，测试 `test/games/games.test.js`、绘画与传输套件。
- 盲盒统计：管理页查询全部盒型，心动盲盒展示查询特定盒型，`src/bilibili/gift/blind-box-analysis.js` 原来只存一个结果，交替访问会逐次驱逐。按同一来源/数据库版本/本机日界保留最多两个最近使用盒名结果；其他失效条件及独立结果复制不变。沿用 `test/gifts/blind-box-analysis-dates.test.js` 的读取计数、回滚/外连接/来源/跨日覆盖，合同为 `docs/reference/backend/bilibili/gift.md`。
- 后续候选先查 owner、调用频率、消费者和既有去重；只有确认冗余且有收益证据时修改。优先实时广播、批量列表和播放进度，不把上次报告直接当作现行缺陷。

## 实施与验收

- [x] 用户资料：2,000 个不同 UID 的 peek/ensure 各自从 12,000,000 条全表遍历降为本次暖读取 0 条；逐 UID TTL 保留，精确边界回归通过。
- [x] 图片导出：2,000 张分图保存布局条目从 4,004,000 降为 2,000，拼图从 2,808 降为 52；用户资料、卡片与导出控制器共 45 项测试通过。
- [x] 导出预览：2,000 条记录连续渲染 21 页，分图切片条目 42,000→21，拼图 42,000→819；复用主进程分页并移除因此无调用者的前端分页函数。已有浏览器设置场景验证实际卡片翻页内容。
- [x] 画猜：1,000 次追加的旧坐标引用复制 2,497,500→22,500，最终公开状态摘要一致；与预览、绘画、撤销和传输共 50 项聚焦测试通过。
- [x] 盲盒统计：20 轮双消费者读取在修复前复现 40 次查询，修复后 2 次；1,000 条记录、100 次交替读取的独立计数为查库 100→2、返回并汇总行数 100,000→2,000。写入后两类结果分别更新；回滚、外连接、来源、跨日覆盖通过。
- [x] 检查其他高频路径，记录现有去重与缓存证据，见下节。
- [x] 更新资料缓存、礼物统计、画猜和导出所属技术参考；功能、设置、入口、输出尺寸和操作步骤未变，用户指南及应用内引导无需修改。
- [x] 检查本任务产品、测试和参考文档差异；11 个 JavaScript 文件语法、28 项架构门禁及 `git diff --check` 通过。
- [x] 文档门禁 10/10 通过，计划归档；差异和工作区状态已复核，临时计数与数据仅留在根 `tmp/`。

## 其他路径的检查结论

- `public/js/playback/operations/state-persistence.js` 已在发送前捕获队列，进度事件仅调度，没有每次进度都复制全队列。
- `public/js/playback/services/lyric-service.js` 与 `src/server/music-runtime.js` 已复用时间线引用，并以二分查找歌词。
- `src/server/scene-extra-display.js` 已有歌单版本缓存、歌词时间线版本缓存和礼物 feed 条件读取。
- `src/server/ws.js` 已合并同一 microtask 的快照，并按 principal/scope 复用编码帧。
- 礼物 feed 已限制可见行与缓冲区，图片解析已有索引。本轮未为这些路径增加另一套缓存或去重。
- `remote-gift-controller` 仅完成静态查看，未做吞吐验证；自定义盒型目录扫描尚无真实热点证据。两者不列为已确认缺陷，也不宣称已通过性能验收。

## 验证记录与证据限制

三组直接相关测试分批通过，去掉重复运行的三个预览场景后，共 114 个不同用例：

```powershell
node --experimental-vm-modules --test test/bilibili/bilibili-user-info-service.test.js test/bilibili/bilibili-identity-cache.test.js test/bilibili/bilibili-user-info-pollers.test.js test/gifts/gift-card-runtime.test.js test/gifts/gift-export-controller.test.js
node --experimental-vm-modules --test test/games/games.test.js test/games/games-drawing.test.js test/games/game-transport.test.js test/games/game-routes.test.js test/gifts/frontend-gift-export-settings.test.js
node --experimental-vm-modules --test test/gifts/blind-box-analysis-dates.test.js test/gifts/gift-banner-feed.test.js test/gifts/frontend-gift-export-settings.test.js
```

分别为 45/45、50/50 和 22/22。沿用所属测试并扩展过期边界、公开画布隔离、翻页内容和双消费者缓存；删除前端分页函数后，其重复分页断言一并移除，主进程分页覆盖保留。六个产品文件和五个测试文件的 `node --check`、`npm run verify:architecture`（28/28）、`npm run verify:docs`（10/10）通过。文档门禁初次发现本计划使用中文状态标签，改为仓库要求的 `Status:` 后通过；最终记录按完成计划归档。

计数脚本与修改前源码快照位于 `tmp/repeated-work-audit-2026-11-06/`，仅用于本地诊断，不进入产品或测试套件：

```powershell
node --experimental-vm-modules tmp/repeated-work-audit-2026-11-06/measure.cjs before
node --experimental-vm-modules tmp/repeated-work-audit-2026-11-06/measure.cjs after
node tmp/repeated-work-audit-2026-11-06/measure-blindbox.cjs before
node tmp/repeated-work-audit-2026-11-06/measure-blindbox.cjs after
```

资料计数使用已预热的 500/1,000/2,000 个不同 UID，修复前后均未发起资料请求；“0 条全表遍历”只描述清理间隔内的该批读取，逐 UID TTL 检查与周期回收仍存在。导出窗口和文件系统为替身，前后渲染与写入数量一致。预览逐页比对 eventId；已有浏览器测试使用隔离页面与桌面桥夹具，并非真实 Electron 保存 PNG 验收。

画猜输入为 100 条笔画、每笔 50 点、1,000 次追加操作，最终公开状态 SHA-256 两版均为 `f2c1d434fcc2dbc1a9011ce5343febf5129ecca5ae3cece338a2519a2937bf3b`。盲盒计数使用隔离 SQLite 与合成数据。以上是调用量、遍历量和复制量证据，不等于实机 CPU、帧率或端到端延迟收益；本轮没有进行真实账号或直播验收，也不据此声称全仓不存在其他效率问题。

## 验证与失败处理

临时计数、基线和诊断放在 `tmp/repeated-work-audit-2026-11-06/`，不将机器耗时当成跨机器性能承诺。先执行直接相关的 `node --experimental-vm-modules --test` 套件和修改文件语法检查；现行 Markdown 改动运行 `npm run verify:docs`，跨域改动增加架构门禁。只在具体失败或影响范围需要时扩大检查。若优化改变结果或不能证明收益，只逆向撤销本任务对应小段，不恢复整个文件。所有确认项完成修复、聚焦验证及文档同步后收束；未检查路径和实机限制明确记录。
