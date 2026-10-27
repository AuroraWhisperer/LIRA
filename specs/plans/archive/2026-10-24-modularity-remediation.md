# 模块化隐患整改实施计划

Status: Completed

用户于 2026-10-24 授权并行解决审计的六项主要问题与两项低成本复用。

## Goal 与当前行为

修复 Playback 队列关闭出口缺失和依赖注入不一致，收窄 Scene 的显示依赖，集中用户冷却和 clear-all 恢复流程的管理职责，明确 License 授权选项，并复用两处已存在的纯规则。队列问题已通过真实 Playback 入口与 FormsService 在模拟 DOM 中复现；其他项目以当前源码核查为依据，不宣称已有生产事故。

## 边界与兼容

- 保留当前所有用户在途修改；不提交、建分支、部署或改变独立 lira-server 仓库。
- HTTP / WS / IPC、设置、SQLite schema、持久化格式、脱敏、取消、代次隔离和租户隔离不变。
- Scene 显示只接收只读能力；共享外观写路径保留原上下文。
- 冷却由 domainServices 持有，重连不重建；成功接纳后才更新，持久化失败不阻断接纳。
- clear-all 保留同步暂停/清库/恢复顺序、五库事务和通知顺序。数据库阶段部分失败不清空冷却；数据库成功后发生 runtime-reset 或 resume 失败，不能仅凭最终 partial 推断冷却尚未清空。
- 不新增框架、运行依赖、通用管理器；不扩展 clear-gifts、其他 decoder 或远端服务器整改。

## Ownership 与并行划分

| 工作 | 源码与文档 owner | 消费者及验证 |
| --- | --- | --- |
| M1 Playback | public/js/playback/controller.js、index.js；public/js/admin/app.js；docs/reference/frontend/playback.md、app.md | Playback queue/home 与 frontend-admin-layout；真实入口注入 spy 和首次点击重开 |
| M2 Scene | src/server.js、src/server/scene-runtime.js、scene-extra-display.js；docs/reference/backend/server-core.md | Scene extra/runtime/events/output 与 shared-appearance；保留缓存、owner、条件版本和异步失效 |
| M3 用户冷却 | 新 src/music/user-request-cooldown.js；src/server/domain-services.js、src/bilibili/bilibili-message-handler.js；docs/reference/backend/bilibili/danmaku.md | 用户冷却 owner、song-cooldown、queue-service、random-song-filter、queue-random-request、真实 SQLite clear-all |
| M4 clear-all | 新 src/server/data-maintenance-runtime.js；src/server/routes/data-routes.js；docs/reference/backend/api.md、storage.md、overtime.md | 将顺序矩阵移到 runtime owner，路由保留确认/响应/通知；data-clear-all-runtime |
| M5 License | src/electron/license/license-manager.js、license-operations.js；scene-cloud-controller.js 复用 remote-url-policy | License operations/renewal/revalidation/session/event-stream/IPC、guard-expiry、scene-cloud-controller |
| M6 QRC | 新 src/music/qrc-xml-entities.js；qq-provider-utils.js、wesing-cache.js；QQ / WeSing 技术参考 | 实体顺序、数字实体及既有 QQ / WeSing 回归 |

M1、M2、M5 分派独立代理，父代理顺序完成 M3、M4；M5 完成后由同一代理接续独立 M6。各组只编辑自己的文件；跨组文件经协调。M3 完成并验证后才开始 M4，避免同时变更冷却与恢复语义。所有代理先检查当前差异，再编辑。

## 实施与验收

- [x] M1：公共 closeQueuePopup 委托已有 homeHandler；构造前解析固定依赖，init 不替换依赖，getWeSingState 每次 init 读取；移除无消费者参数及错误文档。
- [x] M2：在原组合根组装显式 displayPorts，移除 Scene 到完整 API context 的回链，保持现有输出语义。
- [x] M3：restore / getLastRequestAt / recordAccepted / reset 封装 Map，复用 cooldown-store；消费者不直接操作 Map。
- [x] M4：具名同步 runClearAll 拥有暂停、清理与恢复；HTTP 路由保留 confirm、结果映射、广播和 cloud sync。
- [x] M5：withAuthorizedToken(operation, { sanitize, acceptResult, signal }) 内部从 execute(0) 开始；Scene 地址检查复用 normalizeRemoteRootOrigin。
- [x] M6：只提取两个逐行一致的 XML 实体 decoder，不合并 QRC 提取逻辑。
- [x] 完成所有受影响测试、技术参考与用户指南影响评估，最终差异审查。

聚焦测试使用 `node --experimental-vm-modules --test <对应完整测试文件>`；每组记录实际文件和结果。全部源码编辑完成后运行 `npm run verify:architecture`、`npm run verify:docs`、`git diff --check` 与 `git status --short`。不默认运行全仓测试；若组合测试不足以证明焦点行为，再采用已有隔离 Electron 路径。

## 失败处理与完成条件

验证失败先诊断所属模块，不放宽正确断言，不覆盖用户内容。只撤回本任务拥有的最小改动，禁止整体 reset/checkout。每项完成须有聚焦证据，文档与源码一致；最终说明真实验证范围及未覆盖的实机行为。完成后归档本计划并更新索引。

## 验证记录

以下命令均使用 `node --experimental-vm-modules --test`，文件名均为完整文件并带 `.test.js` 后缀；未运行全仓测试，各组重复覆盖的文件不累加为不同用例。

| 范围 | 完整测试文件（目录下列出的文件名） | 结果 |
| --- | --- | --- |
| M1 | test/playback/ 下 playback-entry、playback-queue-behavior、playback-home-lifecycle、frontend-playback；test/admin/frontend-admin-layout | 四个 Playback 文件通过；Admin layout 一项既有滚动条断言失败，其余通过。总数未留存，不推算。 |
| M1 helper 消费者 | test/playback/ 下 playback-wesing、playback-stream-recovery、playback-quality、playback-persistence、playback-logout-recovery | 106/106；tmp/modularity-playback-helper-tests.log |
| M2 | test/scenes/ 下 scene-extra-components、scene-runtime-events、shared-appearance、scene-output-events、scene-service、scene-live-updates；test/server/domain-services-initialization；test/gifts/blind-box-analysis-dates | 137/137；tmp/modularity-scene-tests.log |
| M3 | test/songs/ 下 user-request-cooldown、song-cooldown、queue-service、random-song-filter、queue-random-request；test/storage/data-clear-all-runtime | 72/72；tmp/modularity-cooldown-tests.log |
| M4 | test/storage/ 下 data-maintenance-runtime、data-clear-all-recovery、data-clear-all-runtime、database-clear-all | 29/29；tmp/modularity-maintenance-tests.log |
| M5 | test/license/ 下 license-manager-operations、license-manager-renewal、license-manager-revalidation、license-session-boundaries、license-manager-identity、remote-license-event-stream、license-ipc；test/bilibili/guard-expiry-auth；test/scenes/scene-cloud-controller | 169/169；tmp/modularity-license-tests.log |
| M6 | test/music/ 下 qrc-xml-entities、qq-provider-streams；test/wesing/ 下 wesing-capture、wesing-capture-refresh | 36/36；tmp/modularity-qrc-tests.log |

M1 新增三项真实入口回归在修复前捕获两项失败，修复后 3/3 通过。Admin 既有失败为 `expanded toolbox navigation and planner lists retain visible scrolling affordances`：`public/css/admin/toolbox/streamer-planner/base.css:15` 的 `scrollbar-width: none` 与断言冲突；相关 CSS 和测试经换行归一后均与 HEAD 一致，本次没有修改。Playback 使用模拟 DOM，未做 Electron 实机焦点验收；Scene 使用既有测试中的浏览器检查，没有真实账号或生产上游操作。

实施过程中的失败均已定位：M2 的共享 canvas fixture 仍使用旧函数签名；M3 新 owner 测试误用迁移器签名，改为既有 SONG_TABLE_SCHEMA 初始化隔离内存库；M5 初轮误删其他 URL 校验所需的 isDnsHostname import，已保留。上述修正后对应完整文件均通过。

`npm run verify:architecture` 28/28、`npm run verify:docs` 10/10 通过。初轮门禁指出计划状态必须使用 `Status:`，以及迁移后的空 catch 基线仍指向路由；已修正状态格式，并将原有一处缓存 best-effort catch 的冻结记录迁到新 owner，数量不增加，断言不放宽。M3/M4 另经独立代理只读复核，无功能或契约发现。最终已检查各组任务差异，临时测试材料仅位于 tmp/。

技术参考已同步 Playback 注入与出口、Scene 显示端口、用户冷却 owner、clear-all 恢复 owner 和 QRC helper 归属。License 文档未记录位置签名，远端地址策略已有准确说明，保持不变。用户指南、应用内说明及交互引导的操作步骤、入口和限制均未改变，无需改写。保留全部在途修改，未提交、打包、部署或修改独立服务器仓库。
