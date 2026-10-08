# 已确认的客户端体验规则调整

Status: Completed

来源：用户明确批准讨论清单 1、2、3、5、6 按建议修改，并要求并行处理；4、7、8、9 仅解释和讨论。

## 目标与边界

让“下一首播放”真正排到当前曲目之后，重复导入按点歌请求去重，重启保留未完成点歌，礼物库保留组合筛选，小游戏的资源恢复与清档分开且失败优先可恢复。仅改变上述已批准规则；不实现全局退出保护、导航改版、工作台备份或密码说明改版。

## 修复前现状、所有权与兼容

- 播放器：`public/js/playback/features/pending-handler.js` 目前直接播放；`services/import-service.js` 每次取前 30 项，`features/import-handler.js` 直接追加。调整沿现有 queue manager、快照和请求匹配边界；不同请求点同一曲目仍保留。由播放工作包拥有相关源文件、测试与播放参考文档。
- 点歌队列：`src/server.js` 在启动调用 `domain-services` 暴露的 `clearOnStartup`；`src/music/queue-service.js` 与 `src/storage/queue-store.js` 实际将有效项标记删除。由主代理移除启动清理、核对已有快照恢复，保留显式完成和清空操作，并维护启动/歌曲服务参考文档。
- 礼物库：lira-server `public/gifts/` 拥有筛选状态；现行 REQ/AC 要求部分条件重置。用户已批准改变，礼物工作包同步实现、所属需求及定向浏览器测试。
- 小游戏：lira-server `public/games/game.js` 及 `public/games/v1/runtime/` 拥有进度和历史恢复；盲盒存储错误与损坏混用清档入口。游戏工作包核实恢复范围、分离临时失败和损坏、加入清档范围确认并验证取消无损。
- 服务端公共 `acceptance-criteria.md` 与 `system-rules.md` 由主代理合并各工作包建议，避免并行覆盖。
- 保留已有用户改动，不改变认证、租户、外部平台、数据库格式和接口，除非已批准功能确实需要且另行记录兼容方案；不提交、不发布，不操作用户运行中的应用。

## 实施与验证

- [x] 播放：按请求标识关联导入，过滤已导入项后再应用批次限制；验证当前音频不切换、下一首顺序、重复操作、不同请求同曲、失败后重试及快照恢复。运行现有 pending/import/queue 的完整相关测试文件。
- [x] 重启：隔离 SQLite 中创建 current/waiting 请求，经过启动和重复启动后保留 ID、状态、顺序；显式完成/清空照常。运行 `test/songs/queue-service.test.js` 及覆盖真实启动恢复的定向测试。
- [x] 筛选：切换背包、分类等条件不隐式清空可组合的价格条件；空结果有明确清除入口；验证双向操作顺序、清除与现行请求参数一致。
- [x] 游戏：确认前说明清理对象；取消保持进度及历史；临时存储异常不自动清理有效存档，重试不重复结算；验证恢复资源保留历史、显式清档及刷新恢复。
- [x] 汇总：各工作包先核对已有实现与相关规范、保存本轮前置快照、运行受影响的完整 Node/浏览器文件；新场景加入既有浏览器文件。实际命令、结果及必要限制见下文。
- [x] 解释：核实桌面 close/quit 与网页 beforeunload 的差别、现有导航归属、工作台保存及导出边界、密码问号交互，并整理具体而未实施的方案。

## 失败处理与完成条件

测试用隔离数据和独立端口；不读取、修改真实存档。失败时按拥有模块修复，只回退本轮差异，保留并行工作。涉及数据和排序的回归优先验证，不因多文件而自动运行全量测试。

完成条件：五项批准规则已实现且受影响检查通过或明确外部限制，所属规范一致，两仓执行差异与状态检查，4、7、8、9 的解释有当前代码依据。达到完成条件后归档计划。

## 实际验证与发现

### 行为与兼容

- “下一首播放”通过现有 queue manager 插入优先下一首，在普通队列、歌单和电台中不打断当前曲目；随机顺序重建仍保留明确的下一首优先级。当前无播放时等待用户播放。
- 导入以点歌队列的 `id` 与 `created_at` 组合标识请求，先排除已处理请求再取最多 30 项；不同请求点同一曲目仍保留，匹配失败可重试。重叠导入被阻止，待确认项和已处理标识随播放快照保存。旧快照兼容为空标识集合，不能追溯识别改动前已导入的曲目，不按歌名猜测去重。
- 启动使用已有 `ensureUnified()` 规范旧 `current` 状态，不再调用启动清空；保留有效队列的标识、排序及置顶。删除孤立的启动清理入口。显式完成与清空后重启不恢复已删除项。
- 礼物库搜索、特效、背包筛选保留价格条件；重复选择当前币种不重置。切换到免费/银瓜子只清掉不适用的人民币价格。零匹配仍展示选中价格与计数 0，并提供“清除搜索和筛选”；保留币种与语言。
- 五款普通小游戏清进度与盲盒清历史/清档明确说明范围并确认，默认取消；恢复电池、重置配方保持各自范围。临时读写失败优先重试；损坏或不兼容原档保留，不隐式覆盖。恢复旧档前若有未保存进度，先确认放弃当前内存进度。既有存储事务、键、schema 与账号边界不变。
- 小游戏新规则由 lira-server ADR-0095 局部替代旧自动覆写规则，相关公共 REQ/AC、玩法需求及两仓参考文档已同步。

### 定向自动化

播放初次完成后以下完整文件 92/92 通过；发现同曲不同请求的当前播放高亮仍按曲目 ID 比对，改用共享队列身份后，重跑四个受影响文件 38/38 通过。两轮合计 93 个不同测试具有通过证据：

```powershell
node --experimental-vm-modules --test test/playback/playback-queue-behavior.test.js test/playback/playback-persistence.test.js test/playback/frontend-playback.test.js test/playback/playback-state-actions.test.js test/playback/playback-snapshot-ordering.test.js test/playback/playback-snapshot-bootstrap.test.js test/admin/frontend-usage-guide.test.js test/engineering/esm-module-boundaries.test.js
node --experimental-vm-modules --test test/playback/frontend-playback.test.js test/playback/playback-state-actions.test.js test/playback/playback-queue-behavior.test.js test/engineering/esm-module-boundaries.test.js
```

点歌恢复先通过真实启动复现三条有效请求被清空；修复后以下三文件 18/18 通过。回归用隔离 SQLite 与认证 HTTP 连续启动四次，覆盖保留顺序、置顶与不复活已完成/清除项：

```powershell
node --test test/server/server-smoke.test.js test/server/server-lifecycle.test.js test/songs/queue-service.test.js
```

lira-server 礼物两文件 9/9 通过，五个完整浏览器文件（gift-variants、gift-price-picker、gift-search、gift-navigation、gift-layout）共 63 个不同场景具有通过证据。新用例最初点击隐藏 checkbox，改点实际可见标签；修正免费币种夹具后重跑完整 variants 21/21：

```powershell
node --test test/gift-url-state.test.js test/gift-cache.test.js
```

lira-server 小游戏最终以下六个完整 Node 文件 96/96 通过；十二个完整浏览器文件共 208 个不同场景具有通过证据。初轮新增取消操作导致历史读取计数基线过早，修正后重跑相关文件；严格恢复校验后旧 fame-inventory 断言仍要求自动覆写，与已批准规则不符，改为保留原文并重跑完整文件 12/12。未重跑全仓全量测试。

```powershell
node --require ./test/support/test-mode.cjs --test test/game-storage.test.js test/blind-box-storage.test.js test/game-offline-contract.test.js test/public-games-page.test.js test/fame-road.test.js test/treasure-house.test.js
```

小游戏完整浏览器文件为 game-v1-reset、blind-box-history、blind-box-simulator、blind-box-presentation、constellation-echo、spirit-pact、offline-games、treasure-synthesis、game-activity-records、fame-inventory、registration-footer、treasure-house-rules，均位于 lira-server `e2e/`。

### 运行时证据与收尾

- 使用既有 usage-guide-shots 的独立 Electron 夹具、合成数据与正常 preload/桌面授权。精确路由 `/license`、`/admin` 均返回 200。夹具显式清理自己的演示队列，避免新保留规则造成重复种子。
- 真实 HTML audio 播放期间点击“下一首播放”，标题与音源不变，时间从 10.217923 前进至 10.254181，播放未暂停；暂停状态也不被擅自启动。
- 导入及刷新后再次导入，匹配调用维持 14 次，队列 4 首、待确认 +5 不变；快照通过真实本地 HTTP 保存。音乐和匹配回复均为合成夹具，未接入账号或外部音乐服务。
- 实查礼物库 1280px/320px 中文及 320px 英文界面；小游戏 320×568 与 1440×900 确认窗口默认取消、内容可读且无横向溢出。独立 Electron、浏览器与测试服务已结束。
- lira-server `npm run docs:check` 47/47 通过。Live 初检的唯一失败是活动计划用了中文状态标签，既有 parser 只接受 `Status:`；本计划改成合法标签并归档后，`npm run verify:docs` 10/10 通过。两仓 `git -c core.safecrlf=false diff --check` 均通过，已检查最终状态并确认本轮临时证据和合成数据被忽略。
- 本轮前置快照、队列截图、Electron 证据和小游戏详细报告保留于仓库根 `tmp/ux-decisions-20261008-cDogB5/`；礼物浏览器证据位于 lira-server 根 `tmp/browser-tests/ux-gift-filters-20261008-cDogB5-final2/`。这些均为临时材料，不进入版本控制。
- 保留既有及并行任务改动，没有提交、部署，也没有操作真实用户进程、数据或 B 站/OBS/直播姬实播。

## 本轮仅讨论的四项

- 4：桌面 X / Alt+F4 会先触发已有的主进程 close 拦截；建议在真正关窗前对未保存修改提示“返回编辑 / 放弃修改并退出”。无草稿不打断，不能替任务管理器强杀、崩溃或断电显示提示。网页刷新/关标签用浏览器自身离开提示。未实施全局草稿协调。
- 7：建议保留点歌/播放/礼物/百宝箱四个主入口，新增各页可达的全局设置入口；将现有 B 站登录及房间号、客户端与账户、更新聚合为直播连接/客户端与账户/更新，不复制表单，也不移走各功能自己的业务参数。未实施导航调整。
- 8：工作台的待办、备忘、日程及直播计划当前保存在 `admin.streamerWorkbench.v3`，缺少完整导入/导出入口。建议导出备份文件，导入前显示类型与数量，默认合并并跳过相同稳定 ID；替换需单独确认且先备份当前内容。单份直播计划冲突保留当前并提示，不静默覆盖。范围不包括账号秘密、B 站 Cookie、歌曲缓存，也不承诺云同步。未实施备份。
- 9：桌面账号页已有 `lira-help` 密码规则问号，支持悬停、焦点和点击，不需重复常驻说明。先前提及的是 lira-server 网页“重置 LIRA 账号密码”页面，目前以 input title 提示规则；建议采用相同问号交互，不涉及 B 站或音乐账号密码。未改网页帮助交互。
