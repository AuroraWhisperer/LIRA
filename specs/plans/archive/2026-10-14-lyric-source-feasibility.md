# 歌词来源方案：缺陷修复与可行性验证

Status: Completed

开始及完成日期：2026-10-14。已按用户后续要求完成外部 QQ 源码接入；外部网易云由用户另行调查，不纳入本次生产接入范围。

范围更新：用户在完成两个客户端实测后明确要求先接入外部 QQ 音乐；外部网易云由用户继续调查。本计划增加正式 QQ 集成与验收，网易云不接入生产。

## Goal

逐项处理歌词来源交互稿审查的五点：修复可复现的现有缺陷，验证新增外部采集与来源切换的实现条件，修正交互稿，并明确实际需要用户配合的验证操作。QQ 音乐和网易云音乐分别进行真实客户端测试。

## Scope And Current Behavior

| 审查项 | 当前证据 | 本次交付 |
| --- | --- | --- |
| 外部 QQ / 网易云采集 | 交互稿使用静态场景；正式运行时没有这两个客户端的采集器 | 使用只读 Windows 媒体会话探针验证歌曲、状态、进度、暂停、跳转；记录实际支持范围与缺口 |
| 来源仲裁 | 内置歌词 HTTP 与全民 K 歌回调都能发布到同一运行时 | 最小复现现有切换竞态；确认缺陷后修复 owning layer 并加聚焦回归；新多来源规则在原型中验证 |
| 暂停隐藏 | 原型无条件隐藏；正式渲染器受 `desktopLyricHideOnPause` 控制，默认 false | 修正原型，区分暂停与停止，保留设置语义 |
| 全民歌词来源 | 原型使用首选源作为实际来源；正式采集器已有 `lyricSource` | 原型按解析结果显示本地 / QQ / 网易云；修改偏好只影响下一次解析 |
| 同步状态 | 原型把播放中当作歌词就绪 | 区分加载、无歌词、采集不可用、暂停及就绪状态，并验证预览行为 |

## Ownership

- 原型：`tmp/lyric-ui-proposal/lyric-source-design.html` 与 `design-preview.html`；探针、结果、原型检查脚本均保存在该临时目录。
- 正式歌词发布：`src/server/music-runtime.js`、`src/server/routes/playback-routes.js`；生产者为 `public/js/playback/services/lyric-service.js` 与 `src/music/wesing-capture-engine.js`。
- 正式显示：`public/js/lyrics/desktop-lyric-renderer.js`、`desktop-lyric-settings.js`；本次不改变暂停开关的既有默认值。
- 合同：`docs/reference/backend/music/services.md`、`wesing.md`、`docs/reference/frontend/playback.md`、`docs/reference/backend/ws.md`。
- 测试：现有 `test/lyrics/`、`test/wesing/`、`test/playback/playback-wesing.test.js`，按最终变更选择聚焦覆盖。
- 用户指引：正式 QQ 接入更新应用内「直播歌词」及「歌词获取与同步」；现有引导步骤仍指向内置播放器登录，内容不受影响。README 与组件指南不维护音乐来源操作，无需重复添加。

## Compatibility And Non-goals

- 保留现有未提交修改；不提交、创建分支、发布或改变真实播放设置。
- 实机探针只读，不启停或遥控用户播放器，不读取凭据、Cookie 或真实歌词缓存。
- 不将模拟成功等同于外部客户端采集验收，不为未知能力承诺精准逐字同步。
- 保留 Electron 隔离、鉴权、现有页面 URL、设置键及歌词协议；如复现缺陷的正确修复需要合同变化，先在此记录必要边界及兼容方式。
- 只将已实证的 QQ 媒体会话接入正式链路；网易云保留不可用的验证结论，暂不提供可用入口。

## QQ Implementation Decision

- `src/music/qq-client-monitor.js`：沿用现有 PowerShell 子进程集成方式读取 Windows 媒体会话，500 ms 采样，隐藏窗口、只读、停用即关闭；不新增服务、运行时依赖、账号权限或安装步骤。
- `src/music/qq-client-capture.js`：拥有采样有效性、曲目切换、歌词解析代际及暂停/seek 状态。新歌名到达后等待新进度，禁止沿用旧曲时钟；迟到歌词结果不能覆盖新曲或停用状态。复用现有 QQ Provider、匹配与歌词解析。
- `src/server/music-runtime.js`：统一持有 `internal / qq-client / wesing` 发布来源，同一时间只有一个来源能发布完整歌词与状态。现有 WeSing active API 经同一仲裁入口，保留旧请求/响应格式。
- 为本机管理接口增加 `GET/POST /api/playback/lyric-source` 与对应管理 WS 状态；沿用既有授权链。选择仅在当前运行期有效，不新增持久化设置。Overlay 继续消费既有 `lyric-state / lyric-timeline`。
- 直播歌词页提供来源选择、QQ 采集状态与重试；内置播放器响应来源事件暂停并取消旧请求，恢复内置来源不自动播放。已有 WeSing 选项保持可用。
- 同步 API、WS、音乐与前端参考、使用指南及引导的受影响说明。测试覆盖采集生命周期、非原子切歌、seek/暂停、来源竞争、路由及 UI 桥接；正式入口须在隔离 Electron 中验证，不能以原型浏览器代替。

## Milestones And Verification

- [x] M1：QQ、网易云分别实测 Windows 媒体会话；保留版本及样本，覆盖播放、暂停/继续、拖动、切歌。采集不可用时记录明确失败证据和替代路线。
- [x] M2：复现来源切换竞态并归因；若为现有 bug，先得到失败测试，再修复与复跑所属套件。
- [x] M3：修正原型第 3～5 点和必要的切换规则；临时聚焦检查与浏览器两轮验证通过，包括网易云不可用场景。
- [x] M4：同步 API、WS、音乐服务、播放前端与参考索引；应用内两处使用说明更新，其他指引影响见上文。
- [x] M5：正式接入外部 QQ；完成采集、来源仲裁、页面入口、回归与真实客户端歌词链路验证。网易云按用户决定留待后续。

验证命令按实际受影响文件记录。基本回归：`node --experimental-vm-modules --test test/wesing/wesing-online-lyrics.test.js test/playback/playback-wesing.test.js`。若变更正式歌词发布，补跑 `test/lyrics/` 的发布、代际与请求生命周期套件。Markdown 变更执行 `npm run verify:docs`。最终检查 `git diff --check`、任务 diff 和 `git status --short`。

## Failure Handling

### QQ Desktop QA Inventory

| 用户可见行为 | 检查与证据 |
| --- | --- |
| 直播歌词选择外部 QQ | 隔离 Electron 中通过真实 radio 选择，管理接口鉴权保留，显示等待/当前曲目 |
| QQ 真实歌词输出 | 实机歌曲/时钟 → QQ 匹配 → WS → 正式预览，记录状态、时间轴行数与截图 |
| 暂停、继续、seek、切歌 | 用户操作真实 QQ；记录正式链路变化，暂停不丢歌词，切歌不沿用旧时间轴 |
| 内置、QQ、全民切换 | 页面操作与自动回归验证暂停内置、返回仍暂停、拒绝旧来源与异步结果 |
| 未播放、无歌词、错误、重试 | 原生未检测场景 + 单元测试的空结果/错误；页面重试可重新启动采集 |
| 重复初始化和迟到响应 | 控件与来源桥聚焦测试；不重复绑定，不让 HTTP 旧响应盖过 WS 新来源 |
| 生命周期和隔离 | 数据路径、随机端口与匿名 /admin 401 先验证；退出后本次采集子进程停止 |

真实歌曲内容不进入提交；只记录必要的匹配/时序摘要，不将平台版权歌词复制进维护文档。

探针退出即停止采样；仅清理本次创建的测试进程、浏览器页和临时数据。正式代码只修改复现缺陷的 owner；必要回退逐行撤销任务修改，不覆盖用户原有内容。任何实机缺证据项保持未完成状态。

## Done When

五点都有明确分类和实测/测试证据；已确认 bug 修复且回归通过；更新原型能展示真实状态语义；两个客户端的实际能力与限制明确；剩余用户配合项准确；相关文档一致且最终 diff 审查通过。

## Evidence

- 起始工作区有 8 个现有修改文件；其中直播歌词主片段只增加来源入口，保留原修改。执行过程中另有队列优先级并行修改，共用文档采用局部编辑保留。
- 用户已打开 QQ 音乐，要求两个客户端逐一测试。
- QQ 22.41：第一轮 677 个有效样本包含暂停、继续、同曲 seek 回跳 106612 ms 和切歌；新歌名出现时旧进度曾短暂保留。第一轮仅证明歌曲/时钟采集，正式歌词证据见下文。
- 网易云 3.1.4.203507：用户确认操作完成，983 个采样无匹配媒体会话；另一次带进程版本的 3 个采样仍无会话。用户未找到媒体集成选项，后续决定先接 QQ、网易云自行调查。
- 现有来源竞态的两项服务端复现先失败，修复后相关 65 项测试、1523 文件语法检查与 27 项架构检查通过。该证据是新增 QQ 前的基线，不能代替新增功能的验收。
- 原型首轮浏览器检查覆盖 16 个场景、暂停隐藏与实际歌词来源；第二轮确认网易云不可用场景；一次 impeccable 检测结果为空。

## Final Acceptance

- 实际 QQ → 正式采集 → QQ Provider 搜索匹配 → 完整时间轴 → 管理预览已验证两首歌，分别 58 / 59 行。用户操作记录包含暂停、继续、seek 从约 36 秒到 72 秒以及切歌，完整歌词已实际渲染；不将本次仅有逐行歌词的结果宣传成逐字准确度验收。
- 新歌名曾带上一首最后一次更新的时钟（87 秒、120 秒总长），然后才变为新曲目的 1 秒、181 秒总长。修正切换边界为已知旧时间戳和新标题首样本时间戳的较大值，等待后续有效时钟才开始解析；回归覆盖新时间戳仍属旧曲及重复空时间轴广播。
- 隔离 Electron 使用生产 preload、桌面鉴权与真实后端；匿名 `/admin` 401。完成来源单选、重试、返回内置保持暂停、WeSing 互斥、页面刷新保持当前 QQ 来源、播放页 QQ 标签返回内置及暂停隐藏开关的两种状态。最后重启时 QQ 进程已退出，状态正确回到等待播放；无页面异常。本次 Electron 与 PowerShell 采集子进程均已退出。
- 最终聚焦命令：`node --experimental-vm-modules --test`，覆盖 `test/lyrics/`、`test/wesing/`、播放音质与 WeSing、Admin state/order、使用指南，共 **217 项通过**。新增测试保护真实切歌边界、无效/过期时钟、解析竞态、采集重启/退出、路由鉴权与来源竞争、UI HTTP/WS 乱序及重复初始化；既有其他行为测试保留。
- `npm run check`：1531 个 JavaScript 文件通过；`npm run verify:architecture`：27 项通过。未运行全库功能套件，本次覆盖受影响领域与跨层契约。`npm run verify:docs` 首轮 API 路由和链接通过，活动计划中文状态行格式未被门禁识别；改为标准状态并归档后执行最终复核。
- 证据位于 `tmp/lyric-ui-proposal/`：`qq-formal-ui-events.json`、`qq-ui-qa.json`、`qq-real-lyric-preview.png`、`qq-final-focused.log`、`qq-final-syntax.log`、`qq-final-architecture.log`。真实歌词与运行数据均留在忽略目录，不进入源码差异。
- 未提交、打包或替换已安装客户端。QQ 集成限 Windows 且依赖客户端媒体会话及在线歌词匹配；网易云不宣称已支持。
- 归档后文档门禁 10 项通过，最终 `git diff --check` 通过。已核实隔离 Electron 与采集进程退出；删除 `tmp/qq-client-desktop-6vwTLA` 时自动审批返回 `blocked by policy`，未改用其他方式删除，测试数据目录保留。
