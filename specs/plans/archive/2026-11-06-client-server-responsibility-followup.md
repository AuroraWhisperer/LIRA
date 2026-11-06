# 客户端与服务器职责拆分复核

Status: Completed

2026-11-06 完成。保留本记录作为双端大文件拆留依据、模块归属和聚焦验收证据；当前实现以各仓库技术参考为准。

## Goal

并行复核客户端与服务器的大型生产源文件，按独立职责和状态归属拆分确有维护收益的模块。行数只用于定位；保留内聚的生命周期、事务、数据目录和页面渲染。用户已授权分析后直接并行实施。

## Current Behavior And Scope

- 客户端 `D:/Work/Live`：复核 `src/`、`public/js/`、`scripts/`、`tools/` 的生产 JavaScript，逐项查看超过 600 行及相关 500–600 行文件；补查 HTML 与其他源码类型。
- 服务器 `D:/Work/lira-server`：同样复核生产后端、网页和小游戏；测试/fixture 不因规模单独拆分。
- 两个工作区已有大量未提交修改，包括上一轮 CSS 与客户端职责整理；本任务基于当前工作区，不以 Git HEAD 作为可覆盖的基线。
- 各批编辑前复制实际输入到各仓库 `tmp/responsibility-refactor-20261106/`，先运行直接相关的现有测试，再改动。

## Ownership And Proposed Changes

| 批次 | 当前入口 | 收敛的独立职责 | 保留的入口职责 |
| --- | --- | --- | --- |
| 客户端游戏输出 | `public/js/overlays/games.js` | 结果窗显示、头像请求代次、位置和按钮状态 | 会话流、快照恢复、动作请求顺序 |
| 客户端游戏管理 | `public/js/admin/games.js` | 画猜主持区、词库/选词与倒计时 | 单会话状态、互动互斥和页面事件 |
| 客户端世界地图 | `public/js/admin/world-clock/index.js` | 添加城市对话框、目录搜索/分页和局部时钟显示 | 已选城市、地图、天气及唯一主计时器 |
| 服务器礼物同步 | `src/modules/gifts/gift-sync-orchestrator.js` | 特效身份绑定与证据合并的纯策略 | 刷新代次、失败处理、事务、发布及定时调度 |
| 服务器活动发现 | `src/modules/gifts/gift-activity-source.js` | 四类纯活动奖励匹配器 | 上游读取、发现、采样、缓存与重试 |
| 服务器礼物查询 | `src/modules/streamer/gift-query-executor.js` | worker 消息与结果 DTO 校验 | 租户队列、公平调度、worker 生命周期及维护租约 |
| 服务器主播管理 | `public/streamer/manage.js` | 歌单二维码、云歌单、标题、背景等独立资源 | session、页面初始化、重试聚合 |
| 服务器公开歌单 | `public/song/app.js` | 纯筛选与索引规则（以最终消费者复核为准） | 页面 DOM、请求和交互编排 |
| 服务器礼物分析 | `public/streamer/gift-workspace.js` | 自带清理的分析动效 | 共享工作区模板 |
| 服务器小游戏 | `public/games/game.js` | 当前版本状态存储、序列化与存储失败恢复 | 固定玩法注册、资源加载和页面壳 |
| 服务器礼物历史 | `public/streamer/gift-ledger.js` | 已加载历史行的渐进 DOM 显示与 observer | 查询代次、快照、分页和钻取 |
| 服务器小游戏交互 | `treasure-synthesis-view.js`、`blind-box-view.js`、`treasure-house-view.js` | 长按手势、两个消费者共用的结果条目、背包/记录弹窗 | 主游戏渲染、玩法规则与结算 |
| 服务器 Admin 管理 | `public/admin/app.js` | 创建主播对话框；授权码明文与表单的完整生命周期 | 认证代次、路由和跨页面刷新 |

并行代理只编辑各自分配的源文件与直接依赖的测试/资源登记；父任务统一更新文档与集成验收。后续审查发现更强候选时先记录依据，再纳入相应批次。

## Compatibility Constraints And Non-goals

- 不改变页面 URL、HTTP/WebSocket/IPC、鉴权、租户数据、存档键、数据库结构或公开错误语义。
- 保留现有异步求值顺序、取消与代次判断、并发去重、事件注册次数和资源清理；不把同一可变状态散布到多个模块。
- 使用现有 ESM/CommonJS/浏览器脚本方式；同步精确资源白名单与加载顺序，不增加框架、运行依赖或构建步骤。
- 不增加没有具体需求的校验、回退、兼容层、转发包装或通用 context 对象；不清理无关历史代码。
- 不提交、发布、运行用户数据或控制用户正在使用的桌面/服务器。

## Contracts And Documentation

- 客户端：`docs/reference/frontend/app.md`、`pages.md`、`overlays.md` 与 `docs/architecture/engineering/ai-workflow.md` 按实际 owner 更新。遵守 `public/js/admin/AGENTS.md` 的命名 ESM 与显式回调约束。
- 服务器：先核对 `docs/README.md` 指向的相关规范；在 `docs/architecture/overview.md`、`data-boundaries.md` 与 `docs/requirements/traceability.md` 更新实际归属。协议和需求行为未变时不重写 OpenAPI/fixtures。
- 使用步骤、页面外观与用户限制保持原样，因此指南和截图预计无需修改；若发现实际行为影响则重新评估。

## Milestones And Verification

1. **审计及基线**：完成每个提示文件的拆留判断，核对候选的调用点与测试；保存编辑前快照，运行各批聚焦基线。
2. **并行提取**：以窄接口搬移现有职责；重用现有测试，只有新模块加载或原先未覆盖的实际回归风险才补测试。
3. **集成和文档**：复核各批改动及新增依赖，更新唯一归属文档；验证必要资源能经真实页面装载。
4. **完成复核**：两个仓库的任务增量 diff、`git diff --check`、`git status --short`；记录既有失败和未覆盖边界。

客户端初选命令（按最终影响收敛）：

```powershell
node --experimental-vm-modules --test test/games/frontend-games.test.js test/games/frontend-draw-guess.test.js test/games/games-overlay.test.js test/admin/world-clock.test.js test/admin/world-clock-browser.test.js
npm run check
npm run verify:architecture
npm run verify:docs
```

服务器使用 `node scripts/run-with-node.cjs` 的兼容运行时。各批选择礼物同步/活动匹配/worker 查询、主播管理/歌单、小游戏存储的既有测试；选择 `npm run verify` 时先执行完全相同选择器的 `--plan`，再运行。源文件或相关测试运行中不编辑其输入。最终运行 `npm run docs:check`，不默认执行全量测试。

## Rollback Or Failure Handling

失败先定位直接原因，修复后只重跑受影响范围。对照任务开始快照逐项撤回本任务修改，不使用 reset/checkout、批量删除或覆盖已有用户工作。测试全部使用既有隔离夹具，清理本任务拥有的临时进程。

## Done When

- [x] 所有目标范围内的大文件均有拆留判断，确有收益的候选全部处理。
- [x] 抽出的职责具有明确输入/输出与状态 owner，无新增循环或无意义转发。
- [x] 相关既有行为回归、加载验证和必要架构/文档检查通过，或准确记录无法验证的限制。
- [x] 当前技术归属、测试及使用指引影响评估完成。
- [x] 仅本任务增量已复核，已有工作完整保留。

## Audit And Execution Record

### 审计覆盖与保留依据

以下为本轮实际源代码及消费者复核；范围是生产源码的职责，不是安全、性能或产品缺陷的全量审计。

| 范围 | 保留文件 | 依据 |
| --- | --- | --- |
| 客户端启动与同步 | `electron/main.js`、`server.js`、`remote-gift-controller.js`、`license/license-manager.js`、`cloud-sync-controller.js` | 窗口/关闭/协议/历史/领域同步已分别拥有模块，剩余统一管理装配、资源释放、身份 fence、代次和恢复顺序。 |
| 客户端采集与存储 | `music/wesing-capture-engine.js`、`bilibili/danmaku-client.js`、`storage/database-migrations.js`、`gift-query-store.js`、`overtime-store.js`、`bilibili/gift/query-service.js` | 采集与房间连接生命周期内聚；迁移顺序及快照/结算事务不拆散；仅一个查询门面消费的短游标 helper 不另建转发层。 |
| 客户端其他 UI | `admin/fans/index.js`、`overlays/danmaku-feed.js`、`lyrics/desktop-lyric-renderer.js`、`playback/controller.js`、`admin/interactive-tour.js` | 选择失效、动画资源、播放协调或导览退出各自共享同一状态；相关编辑器、renderer、provider 和配置已独立。 |
| 客户端数据定义 | `world-clock/city-catalog.js`、浏览器与 Node 的 `danmaku-style-options.js`、`storage/schema.js`、`scripts/usage-guide-shots/seed-data.cjs` | 城市目录、字段定义/生成镜像、DDL 与截图种子按用途保留，不按业务逻辑行数机械拆分；其他 HTML/C#/PowerShell 扫描未发现超出提示范围的生产文件。 |
| 服务器组合与连接 | `src/app.js`、`bilibili/room-monitor.js`、`routes/streamer.js`、`routes/admin.js`、`danmaku-send-scheduler.js` | Host/principal HTTP 装配、monitor 代次/取消、发送准入/时钟/关闭需要集中所有权。 |
| 服务器邻近后端 | `gift-snapshot-persistence.js`、Device routes、`activation.js`、`streamer-storage.js`、`identity-db.js`、`gift-catalog-queries.js`、`song-page-qr.js` | 事务/发布快照、租户资源、迁移或单一读模型完整；没有独立变化轴。脚本最高约 453 行，验证/发布脚本保持装配职责。 |
| 服务器大型页面 | `site/hero-mascot.js`、`overlay/app.js`、`gifts/gift-variant-validation.js`、`admin/index.html` | 单一绘制与动效生命周期、直播场次与 feed 清理、完整目录准入；HTML 为既有脚本拥有行为的完整静态页面，不新增模板框架。 |
| 服务器邻近前端 | `constellation-echo-view.js`、`overlay/danmaku-feed.js`、`treasure-house.js`、`gift-trend.js`、`admin/detail.js`、`fame-road-view.js`、`catalog-view.js`、`treasure-synthesis.js`、`gift-composition.js`、`spirit-pact-view.js` | 单一玩法/规则、图表、详情读取或目录代次与对应清理，按完整资源或状态归属保留。`blind-box-probability-data.js` 是纯数据导出。 |

已确认的 15 个入口按上表 Proposed Changes 实施；长文件的保留判断不表示其所有行为都经过完整产品验收。客户端约 1,056 个生产 JS 的初始规模清单用于定位；服务器规模初筛同时包含测试，报告没有把测试误算为生产整改项。

### 已完成的基线与阶段验证

- 客户端 UI：基线 25/25，提取后 27/27；新增两条真实边界行为分别覆盖游戏结果动作/迟到头像、城市搜索分页/复开/时钟。现有 `frontend-games.test.js` 与本轮基线逐字节一致。
- 服务器后端：同一批 15 个 Node 文件前后均 203/203；仅活动匹配测试改导入，不改变断言。
- 服务器页面：基线 171 个浏览器场景通过；提取后 16 个 Node 用例通过，171 个浏览器场景执行通过，但后者因同时发生其他游戏测试文件修改，验证器未登记该轮成功。该阶段结果不作为最终稳定版本证据；最终已冻结全部输入并纳入 389 个浏览器场景重跑。
- 小游戏：基线 89/89。提取后扩展到实际受影响的 14 个 Node 文件，110/111；唯一失败是原 `blind-box-view.js` 的 RAF 架构准入没有随已有函数移动。改为仅允许新 presentation owner 后，对应完整 11 例文件通过，其余 100 例有效结果保留。
- Admin：修改前 32 个完整浏览器场景及 71 个 Node 用例通过；提取后同一批 Node 用例 71/71，浏览器覆盖纳入最终冻结输入验证。
- 客户端架构检查 30/30；文档首次检查发现本轮 route-table owner 使用了缩写路径，改为完整路径加 `<br>` 后文档门禁 10/10。

所有日志及任务开始快照位于两个仓库各自 `tmp/responsibility-refactor-20261106/`。小游戏提取已由另一代理只读复核，未发现遗漏的调用方、资源、状态或事件顺序；选定的八个完整浏览器文件覆盖主要交互风险。

### 最终验证

完成 15 个原入口的职责提取，共新增 19 个生产 JavaScript 模块。以下均为本任务开始时的实际文件与完成后的行数，行数用于说明规模变化，不作为拆分目标。

| 入口 | 行数变化 | 新模块与职责 |
| --- | --- | --- |
| 客户端 `public/js/admin/games.js` | 500 → 250 | `games-draw-admin.js`：画猜主持区、选词与时钟 |
| 客户端 `public/js/overlays/games.js` | 517 → 429 | `games-result.js`：结果显示、头像与操作状态 |
| 客户端 `public/js/admin/world-clock/index.js` | 516 → 459 | `city-picker.js`：城市搜索、分页和对话框 |
| 服务器 `src/modules/gifts/gift-sync-orchestrator.js` | 690 → 572 | `gift-effect-bindings.js`：纯身份绑定与证据合并 |
| 服务器 `src/modules/gifts/gift-activity-source.js` | 593 → 370 | `gift-activity-matchers.js`：四类活动奖励匹配 |
| 服务器 `src/modules/streamer/gift-query-executor.js` | 519 → 385 | `gift-query-result.js`：查询结果 DTO 校验 |
| 服务器 `public/streamer/manage.js` | 616 → 149 | `song-page-sharing.js`、`song-page-title.js`、`song-library.js`、`song-background.js`：各自拥有页面资源与操作 |
| 服务器 `public/song/app.js` | 681 → 464 | `filter-model.js`：纯筛选、首字母与索引缓存 |
| 服务器 `public/streamer/gift-workspace.js` | 551 → 377 | `gift-analysis-motion.js`：分析动效及资源清理 |
| 服务器 `public/streamer/gift-ledger.js` | 782 → 683 | `gift-history-view.js`：历史行渐进显示及 observer |
| 服务器 `public/games/game.js` | 562 → 366 | `state-store.js`：存储、序列化与失败恢复 |
| 服务器 `public/games/v1/runtime/treasure-synthesis-view.js` | 687 → 604 | `treasure-synthesis-hold.js`：完整长按手势 |
| 服务器 `public/games/v1/runtime/treasure-house-view.js` | 745 → 660 | `treasure-house-records.js`：背包与记录弹窗 |
| 服务器 `public/games/v1/runtime/blind-box-view.js` | 705 → 553 | `blind-box-presentation.js`：主视图与历史共用的结果展示 |
| 服务器 `public/admin/app.js` | 737 → 551 | `activation-codes.js`、`streamer-create-dialog.js`：授权码生命周期、创建主播弹窗 |

| 验证范围 | 最终结果 |
| --- | --- |
| 客户端相关 UI 回归 | 27/27 |
| 客户端 JavaScript 语法 | 1,754 文件全部通过 |
| 客户端架构门禁 | 30/30 |
| 客户端文档门禁 | 10/10；归档后再次核对索引与链接 |
| 服务器后端相关回归 | 203/203 |
| 服务器小游戏相关 Node 回归 | 111 项通过：原 100 项有效结果，加受影响完整文件重跑 11/11 |
| 服务器 Admin 相关 Node 回归 | 71/71 |
| 服务器歌曲与管理页 Node 回归 | 16 项通过；最终验证器重跑 12 项，复用另一完整文件 4 项 |
| 服务器验证输入解析回归 | 18/18 |
| 服务器浏览器回归 | 22 个完整文件，389/389；跳过、失败和 flaky 均为 0 |
| 服务器文档门禁 | 59/59 |
| 两个仓库差异与状态 | `git diff --check` 通过，`git status --short` 与各批实际快照复核完成 |

服务器最终验证在源码、测试与验证配置全部冻结后执行。与执行相同的 `--plan` 先确认范围：2 个 Node 文件、22 个浏览器文件，预计约 99 秒；实际浏览器用时约 124 秒。验证器确认成功并登记结果，运行后测试端口 3217 无监听。未用反复全量重跑掩盖阶段失败。

本机证据位于 `tmp/responsibility-refactor-20261106/final-verify.log`；最终报告为服务器 `tmp/verification/runs/2026-11-06T13-00-48-342Z-6decd2c2/node.json` 与 `tmp/verification/runs/2026-11-06T13-00-50-139Z-8e75f85a/browser.json`。各批基线、定向日志、任务增量 diff 和行数清单保存在各仓库同名 tmp 目录。上述结果按范围分别列出，不将可能重叠的测试批次累加为独立用例总数。

实现参考、模块归属表、页面脚本加载、小游戏精确资源白名单及测试依赖登记已同步。HTTP/WebSocket/IPC、DTO、存档格式和用户操作未改变，因此协议文档、使用指南和截图不需要改写。新增覆盖仅针对结果操作/迟到头像和城市选择器的真实边界，其余沿用既有断言并适配模块加载。

最终复核以本任务快照为依据，保留已有未提交工作；新增生产文件均对应上表职责，临时证据留在 tmp，没有新增运行数据或敏感文件进入任务差异。本次完成的是本地职责重构及相关回归，不是全产品、真实账号或线上验收；未提交、打包或部署。
