# 投票与评分实施计划

**Goal:** 按 `specs/games-poll-rating_design.md` 新增类别 3、投票/评分独立会话和只读 `/interactions` 浏览器源。

**Architecture:** 本地 Node 服务负责计数、截止和冻结结果，复用 Bilibili 实时连接。在组合根绑定接入生命周期与跨类别门禁，HTTP/WS 仅发布公开投影。

**Tech Stack:** Node.js 24+、CommonJS 后端、Vanilla ESM / CSS、Electron；不新增依赖。

**Status:** 执行中，2026-09-20。功能代码与隔离界面验证已完成；C0 真实直播间验收待补。用户明确要求“直接执行修改，测试不行之后再修改”，因此 C0 不再阻塞实现，不将合成测试计为真实接入通过。

## 范围与兼容性

- 按报告执行：投票每 UID 首次有效，评分每 UID 结束前末次有效；主题 60 字素，选项 1–10 字素，时长 1–3600 秒，配置 16 KiB、最坏公开快照 64 KiB。
- 保留 `/games`、`/wheel`、三款游戏和转盘行为；仅增加进行中的跨类别互斥。
- 不新增持久化、远端服务、自动发送弹幕、历史补票或评分分布。
- UID、Cookie、未揭晓总分不得进入公开快照或验证记录。测试仅用虚拟身份和隔离状态。
- 工作区已有礼物许愿等大量未提交修改，包括权限/投影和合同文件；必须增量编辑，保留原有内容。不提交、不建分支、不发布。

## 当前行为与责任归属

| 责任 | 拥有者 / 消费者 | 合同 / 检查 |
| --- | --- | --- |
| 连接、鉴权、帧入口 | `src/bilibili/danmaku/websocket-connection.js` | `docs/architecture/backend/bilibili/protocol.md`、`test/websocket-connection.test.js` |
| 实时解析与命令过滤 | `src/bilibili/danmaku/message-handlers.js`、`src/bilibili/parsers/danmaku-parser.js` | `docs/architecture/backend/bilibili/danmaku.md`、`test/bilibili-danmaku-parser.test.js` |
| 房间/账号及连接代次 | `src/bilibili/danmaku-client.js`、`src/server/bilibili-runtime.js`、`src/server/bilibili-client.js` | `test/danmaku-client.test.js`、`test/bilibili-runtime.test.js` |
| 游戏会话与组合 | `src/games/game-session-service.js`、`src/server.js` | `test/games.test.js`、`test/game-routes.test.js` |
| API 与展示权限 | `src/server/api-context.js`、`src/server/api-routes.js`、`src/server/access-policy.js`、`src/server/overlay-http.js`、`src/server/overlay-projection.js` | `docs/architecture/backend/api.md`、`docs/architecture/backend/ws.md` |
| 主持界面与推送 | `public/pages/admin/toolbox/games.html`、`public/js/admin/games.js`、`public/js/admin/state.js` | `docs/architecture/frontend/pages.md`；编辑前读取 admin 范围指令 |
| OBS 与翻页 | `public/js/overlays/games.js`、`public/js/overlays/auto-pages.js` 为既有模式参考 | `docs/architecture/frontend/overlays.md` |

代码核查发现：

1. `connected: true` 可能来自历史轮询；`waitForOpen` 不是鉴权成功。连接已有 `connectionTrace.authStatus`，新就绪合同必须同时绑定当前账号、真实房间与有效连接。
2. `onMessage` 位于命令去重之后，不能直接用于新统计入口；否则选项恰好是命令时会丢事件。
3. WebSocket message 回调存在异步 `arrayBuffer()`，尚无读取前的时间与帧顺序。需要在传输拥有者串行处理，并检查失效连接。
4. 时间提取会回退 `Date.now()`，需显式区分平台时间和本地回退；不得冒充可信平台时间。

## M0：真实接入前置验证（C0）

- [x] 用户指定当前客户端登录账号与输入房间为受控验证环境。
- [x] 只读检查当前安装版客户端进程和既有诊断，不启动第二个共享用户数据的实例。
- [x] 当前运行日志在 2026-09-20 17:17:10（北京时间）记录鉴权 `accepted`、code 0，随后 17:17:28 收到首条实时弹幕、17:17:40 确认心跳。这是已发生的连接证据，不代表之后持续在线。
- [ ] 核实账号、真实房间与主播归属；记录布尔核验结论，不保存真实标识。
- [ ] 用两个已知观众账号受控发送普通文本；证明同账号多条 UID 一致、不同账号可区分、主播可排除。不能以 `hasUid: true` 或“收到首条弹幕”替代。
- [ ] 核实原始事件 ID 的稳定性及平台时间字段的来源/精度。缺失时记录报告 7.4 的降级限制，不凭字段形状推定可靠。
- [ ] 只保存去标识结构和结论，后续补齐真实接入验收证据；按用户指示先实施，字段可靠性仍不宣称已实测。

现有诊断只记录普通弹幕首条到达及数量，不能证明 UID 稳定性；当前已安装客户端也不等于本仓库修改后的测试实例。因此以上检查没有标记通过。下一步需要在可观察普通弹幕身份的授权桌面验证环境中完成受控消息核验。

## M1：规则、接入和会话

新增 `src/games/poll.js`、`rating.js`、`interaction-session-service.js`，配套 `test/interactions.test.js`。前后端共用规范化/字素与非法字符判定，按现有共享模块加载方式落地，避免两份规则漂移。

- [x] 覆盖 P1–P7、R1–R5：NFC/trim、合法 emoji 和组合字符、隐藏字符拒绝、超过十个选项、字节限制、首次计票/末次改分、空结果。
- [x] 在现有传输入口补不可变来源、帧接收时间/序号、包内序号、连接代次、可用平台时间及 eventId=null 降级；过滤历史、SC、礼物和模拟输入。
- [x] 会话仅在开始校验成功后订阅；finish 立即退订、冻结并保留结果；clear/dispose 清理订阅与任务。截止用服务端接收处理时刻，拒绝开始前帧和迟到解析。
- [x] 同房间重连可续收；账号/房间变化进入 interrupted，不恢复旧场；投票保留截止，评分等手动结算。结束不能由旧回调重新开启。
- [x] 在 `src/server.js` 组合根协调类别 1/3 开始与重开；409 保留旧结果，finished/interrupted 不占用跨类别收集资格。
- [x] 假时钟与可控消息源覆盖 L1–L3、C1–C6，包括同秒 `8→9→8`、较旧平台时间、事件重放、异步帧反序和迟到定时器。

验证：`node --test test/interactions.test.js test/games.test.js test/danmaku-client.test.js test/bilibili-danmaku-parser.test.js test/websocket-connection.test.js test/bilibili-runtime.test.js`。

## M2：接口、权限与同步

新增 `src/server/routes/interaction-routes.js`、`test/interaction-routes.test.js`；更新上表 API/权限拥有者和合同。

- [x] 实现报告 7.5 的 session GET/POST、host-state GET、finish/clear POST；变更请求要求匹配 sessionId，finish 幂等。
- [x] 公开响应统一 `{ runtimeId, revision, session }`，revision 跨场递增，clear 保留 envelope。评级 collecting 时 average 为 null，无总分和分布；内部 Map 不序列化。
- [x] interactions scope 只读本类公开 GET；拒绝 POST、host-state 与其他领域。games scope 不可读取本类。全局 state 不泄露领域数据。
- [x] 注册独立 `interaction:update`，投票合并推送，finish/clear 立即推送并取消旧任务。主持人数只经 host-state 查询。
- [x] 对应 R3、C2、C3、C7、C8 增加 HTTP/WS 白名单、过期请求、clear、scope 隔离用例。

验证：`node --test test/interaction-routes.test.js test/game-routes.test.js test/overlay-http-access.test.js test/overlay-projection.test.js`；运行 `npm run verify:contracts`。

## M3：主持控制与 OBS 展示

新增类别 3 主持模块、`public/pages/overlays/interactions.html`、`public/js/overlays/interactions.js` 及必要独立样式，复用现有 tokens。新增 `test/frontend-interactions.test.js`、`test/interactions-overlay.test.js`。

- [x] 配置表单显示逐项错误和字素数，IME 不截断；独立链接使用 `localOverlayOrigin()`。固定推荐 OBS 尺寸并按实际行高估算屏数，P 屏提示至少 P×8 秒，短时仍允许开始。
- [x] 实现开始、提前结束/停止评分、取消与关闭结果；展示就绪/跨类别冲突与接收中断原因。人数轮询只在主持面板活跃期间执行。
- [x] 投票保持选项 DOM/顺序、相同比例标尺，数字在完整轨道内固定；每场从首屏开始，只绑定一次翻页，切场和卸载清理。
- [x] 评分收集中均分区域留空，结束显示两位小数或暂无有效评分；新场立即移除旧结果。
- [x] 同 runtimeId 仅接收新 revision，并用连接/请求代次屏蔽旧实例响应；全局 snapshot 或 game:update 缺少本类字段不清空。
- [x] 验证 P8、C3、C7 和主持完整流程；浏览器只验证 OBS，主持流程在有 preload/IPC/授权的隔离 Electron 中检查。启动前确认用户数据、端口及单实例隔离。
- [ ] 完成真实直播间端到端复核，记录与 M0 能力一致的计数和冻结结果。

验证：`node --experimental-vm-modules --test test/frontend-interactions.test.js test/interactions-overlay.test.js test/frontend-games.test.js test/games-overlay.test.js`。

## 最终验证与完成条件

- 以上专用测试与直接受影响测试通过；按实际认证/连接生命周期改动运行 `npm run check`、`npm run verify:docs`、`npm run verify:architecture`、`npm run verify:modularity`、`npm run verify:contracts`，再执行全套 `npm test`。
- 更新 API、WS、页面、OBS 与接入合同，以及规格状态；不得在 C0/运行验证缺失时标记完成。
- 检查最终 diff、`git diff --check`、`git status --short`，确认只含任务改动，没有运行数据、秘密或真实 UID。
- 代码交付条件：规则、会话、接口、权限与界面验证通过，旧游戏和转盘兼容，实现与文档一致。完整验收另需 C0 和真实直播间端到端证据；该项按用户指示后置，计划暂不归档。

## 失败处理

若真实 UID/房间归属/就绪核验失败，按报告第 11 节先修订接入方案，保留未完成状态。实现或测试失败仅撤回本任务拥有的具体改动，不恢复整文件、不破坏用户现有修改。临时测试状态与进程由测试创建者清理，不停止用户运行中的客户端。

## 执行记录

- 2026-09-20：现有 `danmaku-client`、`bilibili-danmaku-parser`、`websocket-connection` 三组测试共 21 项通过。仅证明当前合成测试基线，不作为 C0 实测通过证据。

- 2026-09-20：已实现 M1–M3 的代码项。平台 eventId 暂无可靠实测来源，保留 null；同秒/缺失平台时间按本地顺序，不能识别所有重放。未收集真实 UID 或凭据。
- 隔离 Electron 使用仓库 preload、桌面请求授权和实际本地 HTTP/WS 路由，验证类别 3 表单与主持操作；这是模块验证环境，不是已安装客户端的完整启动验收。独立临时用户目录、随机端口、虚拟身份，无真实 Bilibili 网络输入。
- 界面结果：120 个合成账号产生 66/36/18 票与 55.0%/30.0%/15.0%；评分 A=3→8→10、B=6→文字、C=9，收集中不展示均分，结束与刷新均为 8.33；11 项提示 3 屏至少 24 秒，短时 5 秒仍正常截止，多页滚动保持结果。
- 专用规则/路由/同步/展示与接入测试通过；verify:quick（文档、语法、架构）及 verify:modularity 通过。verify:contracts 使用仓库锁定的 companion server 提交 5ea7b01c8fc7b1cec34a43b01f99c403fd9d1577 的临时 detached worktree，未修改用户服务端检出。
- 全套测试首次最终检查出现 websocket-access-policy 文件进程失败，无具体断言信息；独立复跑该文件 31 项通过，最终全套复跑 2604 项：2600 通过、4 跳过、0 失败。最终 verify:quick 与 verify:modularity 通过。
- 最终界面检查确认 60 字主题完整显示，新评分场次无旧均分；测试页面无脚本错误。本次创建的 Electron 与浏览器页已关闭。自动审批策略拒绝临时目录删除/worktree 移除命令，临时 companion worktree 与 QA 目录留在系统 Temp 下，不再尝试绕过。最终 diff / whitespace / status 审查完成，用户已有礼物、抽签等改动保留；未打包或发布。
