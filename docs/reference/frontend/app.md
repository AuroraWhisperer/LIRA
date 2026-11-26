# Admin 应用与公共框架

> 涉及文件：[pages/admin/](../../../public/pages/admin)、[server/admin-page.js](../../../src/server/admin-page.js)、[admin-page-composition.test.js](../../../test/admin/admin-page-composition.test.js)、[js/admin/index.js](../../../public/js/admin/index.js)、[js/admin/app.js](../../../public/js/admin/app.js)、[js/admin/state.js](../../../public/js/admin/state.js)、[js/admin/forms.js](../../../public/js/admin/forms.js)、[js/shared/](../../../public/js/shared)、[js/desktop.js](../../../public/js/desktop.js)、[js/admin/gifts/](../../../public/js/admin/gifts)、[js/admin/overtime.js](../../../public/js/admin/overtime.js)、[pages/gift-audit.html](../../../public/pages/gift-audit.html)

本文档描述管理后台（`/admin`）的页面结构、公共框架与各业务模块。通信行为见 [comms.md](comms.md)，端点定义见 [api.md](../backend/api.md)，快照与消息类型见 [ws.md](../backend/ws.md)，IPC 通道见 [desktop/preload.md](../desktop/preload.md)。

### Admin 业务模块边界

**粉丝档案（`fans/`）**：

- **模块分工**：`fans/index.js` 管理选中项、请求上下文、页面生命周期及选择代次与过期结果校验；`editor.js` 负责表单弹窗、提交锁定与分步确认；`profile-actions.js` 组合档案与记录的编辑删除、会员纠正、特别关注、归档与屏蔽，通过回调通知入口更新选中项或移除列表项；`forms.js` 负责字段读取，`view.js` 仅做转义后的界面展示，`transfer-ui.js` 负责备份导出、恢复点、认领与合并的多步预览。保存失败时保留输入，请求/选择代次用于过滤晚到的响应；合并草稿预览复用编辑器的操作代次，关闭或重开表单后自动丢弃旧请求的成功或失败结果，不覆盖新草稿。返回档案列表与切换档案/归档范围同样推进选择代次，返回前发出的详情 IPC 晚到时不得重新打开详情。删除成功清空对应档案的选中及展开状态并使旧详情请求失效，不清除已切换到的其他档案。档案仅在百宝箱中查看和编辑，点歌队列不提供快捷入口；私人资料不写入 `StateService` 或旧版全局变量。
- **编辑器、头像与曾用名**：提交时先读取表单快照，再禁用字段区域；保存失败恢复原输入，旧步骤响应不能关闭或解锁新步骤。恢复点和屏蔽名单在异步读取前记录操作意图，返回后仅当前意图可打开弹窗。编辑弹窗头部仅显示紧凑分段标签（标题保留为无障碍名称），手动新建填写可选 B 站 UID 后失焦即经受限桌面桥只读预览昵称与头像（改动或清空 UID 立即清除预览，晚到或已关闭弹窗的结果不回填），已有 `open_id` 档案只读显示开放平台账号，不提供 UID/`open_id` 切换；清空或改绑 UID 后须填写可保留的常用称呼，领域层在清除旧身份资料后校验最终名称。生日历法注明公历（阳历）与农历（俗称阴历），农历提示手填今年对应阳历日期；详情区分公历、农历与农历闰月。档案详情头像直径跟随姓名与 UID 两行总高度（不含一句话印象），复用 `shared/bilibili-avatar.js` 与 `/api/bilibili/avatar` 代理（收藏集原图取 WebP 缩略图，缺失或失败时隐藏）。基本资料的曾用名以胶囊统一展示，不区分来源或日期，默认位置取服务端 `formerName`，其余经原生 `details` 展开并限高滚动；「替换」复用编辑器保存默认值，「补充」调用受限 IPC，新建表单查询结果仅留草稿，同 UID 的编辑器查询也遵守人工移除名单 `excludedFormerNames`；`fans/former-name-batch.js` 维护设置页批量调度、间隔计时器及停止/退出清理（规格见 [fan-profiles.md](../../../specs/fan-profiles.md)）。IPC 载荷与生命周期见 [preload.md](../desktop/preload.md#5-粉丝档案-action-与-dto)。
- **记录与依据展示**：纪念日卡片分别显示目标日期、每年重复标记与记录日期；提前天数的表单说明区分详情可处理时间与列表/日历展示窗口。未收起的话题、跟进与注意事项置顶优先，同组保持原日期顺序。跟进/复查提醒与日历保留各自正文作为依据。会员冲突中的精确区间以北京时间显示起止毫秒和「不含截止时刻」，日期区间仍说明包含末日；采用规则见[粉丝档案持久化契约](../../../specs/fan-profiles.md#持久化契约)。
- **轮询、提醒与通知**：粉丝面板同时观察子面板 `hidden` 与百宝箱主页面 `active` 状态，仅两者均可见时每 30 秒轮询。提醒子页继续更新提醒和页头状态，回到档案子页时补读当前详情。搜索、筛选与清空筛选先重取本机列表，复用已有的全局提醒和同源有效的到期结果。换源、过期或上次读取失败时，再补读到期状态。页面释放时清理观察器和定时器。「特别关注」保存绑定点击时的档案与选择代次，保存成功刷新列表星标与排序，仅在仍展示原档案时更新详情。档案提醒横幅点击「不再显示」仅写本机 `localStorage.liraFanReminderSummaryHidden=true`（不按账号保存、不改提醒状态接口或日历投影，存储不可用时当前页仍生效）。手动同步与自动更新通知共用 `fans/view.js` 的 `rosterUpdateNotices`（成功/跳过/失败分别对应 `success`/`info`/`warning` toast，无跳过或失败不生成对应条，单次最多 3 条且不显示「跳过 0 位」；自动整次失败仅发一条 `error` toast）；`fans/editor.js` 在关闭同步表单后读取 `notices`，最近一次手动结果保留在同步状态左侧的 `lira-help#fanRosterHelp`（`fanRosterResult` 在无结果或切换账号时隐藏并清空）。
- **点歌汇总、到期提示与投影缓存**：音乐页由 `fans/view.js` 直接展示领域返回的每首歌曲汇总（`data.count` 与 `data.recentDates` 最近三个不同北京时间日期，按最新点歌排序，日期以 ` · ` 分隔；近 30 天次数与曲风取自 `musicStats`），不再提供逐次展开、歌曲编辑或旧流水导入；「补记一次点歌」仅填歌名、歌手、曲风、北京时间与说明，规则见[点歌汇总展示](../../../specs/fan-profiles.md#点歌汇总展示2026-10-12)。`fans/index.js` 在本机列表显示后经 IPC `guard-expiry` 异步读取安全标记并拒绝过期响应，`fans/view.js` 将标记与身份图标置于行右侧居中（见[到期提示](../../../specs/fan-profiles.md#b-站到期提示2026-10-12)，不写入 `StateService`、备份或日历）。列表与提醒页的近期日期筛选由 `src/fans/profile-service.js` 负责（读取 `reminders.js` 日期分组，不再显示「之后」分组；列表、近期提醒和日历共用未来七天计算结果，日历再筛选未来三天，详情保留一年预测）。会员里程碑计算（`src/fans/membership-milestones.js`）与当前账号档案工作集投影缓存（`src/fans/profile-projection.js`）在本机领域层按需增量更新、随账号切换释放，并在北京时间跨日、会员区间变更、时钟倒退或派生输入变化时重新计算，返回副本防止污染缓存。投影输入包含跟进/注意事项的正文；日期里程碑使用 `membership.js` 的 `milestoneAt`，与当前在舰状态的精确时刻判断分开，达标历史与修订规则见[持久化契约](../../../specs/fan-profiles.md#持久化契约)。

**状态分发、顶栏与礼物面板边界**：

- `state-renderer.js` 读取 `StateService` 的 `changedKeys`，分别调度设置、队列、SC、直播状态、礼物和歌库元数据视图。设置刷新先交由各组件负责模块合并，再从每个控制器读取一次隔离快照，将同一轮草稿投影用于表单和队列样式，不缓存过期草稿。`StateService` 对 JSON 快照字段逐项结构比较，遇差异即退出，避免大型字段双重序列化并兼容既有调用方的原地修改。`queue.js` 以具名 ESM 导出点歌队列操作和渲染，SC 由 `superchat.js` 独立管理；礼物专属快照不会重建队列或覆盖表单。
- 「完成队首」捕获点击时已渲染的队首 ID，经既有 `done` 动作提交；请求期间禁止重复点击，空队列不发送请求。请求途中身份优先或置顶改变顺序时，不会误完成新队首；失败提示一次并恢复按钮供重试。
- `live-status-presentation.js` 统一识别长连失败、断开及两种重连失败的四条降级消息，供顶栏、新手引导、礼物统计状态和弹幕工具发送状态共用。降级时显示历史消息监听及可能延迟，不显示长连正常；弹幕工具读取发送状态接口已有的 `liveMessage`，降级时显示黄色「可发送，弹幕可能延迟」。
- `topbar-status.js` 负责顶栏的紧凑状态条与非模态详情浮层，由 `state-renderer.js` 转发直播字段和本机连接事件。点击浮层与状态按钮以外区域或窗口失焦时，详情自动收起。常态下显示昵称与「已开播 / 未开播」（昵称超长截断、窄窗口隐藏，完整信息保留在详情中）；未开播使用中性色，且不以 `connected` 推断已开播。本机断连或退出时优先覆盖顶栏短状态，详情中将直播状态标注为「上次状态」；仅在状态切换时通过既有 toast 栈提示断连或恢复（重复事件不重复提醒），恢复后重新同步最新直播快照。`settings-operations.js` 在手动刷新期间禁用按钮并更新可访问名称，图标匀速旋转，结束时顺当前方向在 240ms 内停至正位；成功结果复用 toast 栈紧凑勾选，开启「减弱动态效果」时不旋转或描画勾选。顶栏详情仅展示主播、直播间、简短弹幕状态与本机服务状态，与电音助手快捷面板共用 `--color-quick-panel-surface` 与浮层阴影，快捷面板参数文字使用 `--color-primary-text`。
- 礼物面板将 `changedKeys` 分发至检测状态、诊断、冲刺统计和最近礼物；仅诊断或直播状态变化不重建两个礼物列表。目录事件独立刷新图片和盲盒，配置输入与展开操作直接刷新盲盒列表，`blindBoxMapping` 独立更新映射状态文字。礼物统计状态同时读取监控礼物开关：关闭时显示黄色「已停收礼物」，长连降级时显示黄色「连接恢复中」，未开播的正常历史监听显示「待开播」。最近礼物图片目录的成功空结果可缓存，失败不写入空缓存且相邻重试间隔至少 5 秒、并发复用在途请求；冷启动时图片索引与官方盲盒奖池共用一次本地目录 GET，房间在售刷新与全量推送按到达顺序合并保留图片。今日盲盒盈亏与分析工作区的刷新/取消规则见 §5。

**自动保存与配置控制器协同**（竞争确认机制统一见 §7）：

- 日常设置由 [settings-autosave.js](../../../public/js/admin/settings-autosave.js) 合并停止输入后 600ms 的修改（输入法组词期间暂停），写入串行执行，保存期间的新编辑继续排队提交。完整匹配／关键词规则、签到／抽签词库、进场欢迎参数及词库名单、PK 欢迎参数、礼物／互动感谢词库、昵称黑名单均复用各自的校验与账号代次。冲刺目标和粉丝自动更新偏好同样自动保存，普通档案及记录提交不变。
- 时钟、弹幕、歌曲信息、点歌板主题、礼物显示／感谢、互动外观、资源样式参数和加班机背景通过 `bindComponentAutosave` 显式接入配置控制器；可选数字字段沿用各负责模块的留空定义，其他无效输入不提交。正常保存栏隐藏，失败或冲突保留草稿和重试／放弃入口；失败提示在草稿确认保存前保留。资源参数关闭或切换面板时提交有效的待保存草稿，外部样式核对保留保存错误。
- 桌面自动保存与画布显式提交共用控制器时，画布中继通过 `edit(change, { source: 'preview' })` 标识字段来源：桌面自动保存只提交本机编辑的字段（其余取已确认值），回执保留画布尚待「保存并应用」的草稿；同一字段以后一次编辑为准，来源仅保存在本机内存。
- `gift-frame.js` 按字段自动保存草稿并与 `preserveDirty` 协作；`gift-motion-parameters.js` 由客户端卡片与 `gift-motion-canvas-settings.js` 复用，`gift-motion-settings.js` 每卡 180ms 防抖自动保存（`change` 立即提交、只发修改字段、金额未通过原生校验时不提交）。`advanced-lyric-canvas-settings.js` 复用完整高级歌词编辑器并以独立 ID 前缀隔离控件，原生搭配库仅在编辑端读写。心动收集显隐与榜单展示方式通过 `shared-scene-settings-controller.js` 复用现有设置广播与确认。`gifts/display-settings.js`、`gift-guard-thanks.js` 与 `interaction-appearance.js` 共用同一配置控制器处理广播／回执竞争（滚动礼物走 `/api/gifts/display-settings`，大航海与互动外观走通用设置确认适配器）。

**动态抽奖与账号登录资料**：

- 百宝箱「动态抽奖」由 [dynamic-lottery.js](../../../public/js/admin/dynamic-lottery.js) 管理独立登录与授权失效，由 [dynamic-lottery-workflow.js](../../../public/js/admin/dynamic-lottery-workflow.js) 管理规则表单、最近 50 个活动、采集进度、暂停/继续与中奖结果（支持一键复制全部中奖名单；新建活动清理该账号的旧已结束活动，启动时仅保留每个账号最新活动的结果）。账号管理与本地抽奖记录使用展开入口；设置区在宽面板并排中奖人数与附加条件、窄面板单列；创建后保留内容链接、作者与截止时间摘要，采集明细在结果出现后默认收起。结果框每页展示 5 人（真实昵称、主页链接、关注核验、完整评论，均用 `textContent` 渲染）及核验/排除/缺额统计与开奖凭证。渲染进程不计算资格或随机顺序、不保存 Cookie；授权变化和页面卸载取消页面请求并丢弃过期响应，后台进度持久化后需手动继续。相关端点见 [api.md](../backend/api.md)。
- 中奖结果轮询期间，同一轮次、当前页中展示内容未变的中奖行保留原主页链接和键盘焦点。同页新增中奖者时追加，翻页、换轮次或清空结果时更新相应行。
- 点击暂停后，接口受理即提示一次。后台作业收尾时返回的主动暂停原因归入同一次提示。开奖或继续核验期间，页面等待本次作业产生结果后再通知。
- 账号登录页的 `settings-room-profile.js` 将房主头像与昵称置于输入区下方的紧凑资料栏（展示主播等级、粉丝、UID、粉丝牌、房间号、开播状态、分区与公告）；「刷新资料」仅重读已保存房间，编辑房间会隐藏旧资料并使在途响应失效。连接设置的 `settings-guard-expiry.js` 在复用上方 B 站账号时只显示复用状态，独立登录成功后复用相同样式展示头像、名字与 UID（仅当房主 UID 与独立账号 UID 一致时复用 `settings-room-profile.js` 头像，不新增资料请求）。

下表记录业务入口及其内部归属边界。模块使用显式 ESM import/export 和构造参数；Admin 组合根负责初始化与跨模块回调，旧全局注册表已退役。

| 业务门面 | 内部模块 | 职责边界 |
| --- | --- | --- |
| `settings.js` | `settings-auth.js` / `settings-form.js` / `settings-license.js` / `settings-blindbox.js` / `settings-operations.js` | 门面对接 DOM 与兼容 API；内部模块分别负责认证、表单、授权账号资料、盲盒 URL 和保存/导入导出操作 |
| `overtime.js` | `overtime-gift-picker.js` / `overtime-rule-editor.js` / `overtime-rule-model.js` / `overtime-rule-effect-editor.js` / `overtime-time-view.js` / `overtime-status-view.js` | 门面对接快照与事件；目录和礼物选择、规则编排、规则模型、效果编辑、时间格式/结算展示、状态时钟各自独立 |
| `ai-assistant-settings.js` | `ai-model-picker.js` / `ai-assistant-config-view.js` / `ai-assistant-personas.js` | 设置入口负责自动保存和编辑代次；模型选择器负责服务签名、查询代次与菜单生命周期；view 负责字段与能力渲染；personas 负责角色编辑、保存和导入导出 |
| `songs.js` | `song-editor.js` / `song-library-filters.js` | 列表负责渲染与行操作；编辑器负责草稿、保存、放弃确认和完整歌库对账；筛选器负责输入绑定、查询读取、候选更新和菜单 |
| `desktop.js` | `desktop-resource-integrity.js` | 桌面壳负责窗口控件和更新交互；完整性检查负责状态、订阅、检查动作与视图，页面卸载后忽略晚到结果 |
| `desktop-lyric-preview.js` | `desktop-lyric-settings.js` / `desktop-lyric-timeline.js` / `desktop-lyric-styles.js` / `desktop-lyric-controls.js` | 预览门面负责 DOM/动画生命周期；设置归一化、时间轴数学、样式映射和表单读取无交叉状态 |
| `games.js` / `streamer-planner.js` | `games-wheel.js` / `games-draw-admin.js` / `games-word-picker.js` / `streamer-planner-model.js` / `streamer-planner-storage.js` / `streamer-planner-reminders.js` | 入口负责公共会话与页面事件；`draw-admin` 负责画猜主持区、词库和倒计时；转盘、选词弹窗与待办各自维护局部状态 |
| `interactive-tour.js` | `interactive-tour-config.js` / `interactive-tour-position.js` | 门面负责引导生命周期；步骤配置和定位计算不访问全局状态 |
| `topbar-status.js` / `interactive-tour-config.js` / `gifts/detection.js` / `danmaku-tool.js` | `live-status-presentation.js` | 共用既有直播状态的降级判定；辅助模块只读取状态，不访问 DOM 或发起请求 |

加班机将开始时的规则、启用状态和用户修改的时长一次提交。提交期间到账的新礼物会推进修订，旧时长遇到冲突后重新读取余额供用户确认。同修订的迟到回执沿用当前倒计时起点。重连后重新读取待结算数与最近结算。

加班机礼物选择与图片索引的身份 key 由 `overtime-gift-picker.js` 内部维护，选择 key 与图片 key 保留不同语义，不单独导出选择器的行节点解析。

AI 平台选择等候首次配置和状态加载。失败后可重试加载两者并保留草稿，切换接入方式会清除上一方式的连接测试结果。AI 配置读取记录开始时的写入代次；表单、开关或角色成功保存后，早先读取的晚到结果和错误不再回填界面，后续刷新仍正常读取新配置。AI 预设删除和恢复默认前先临时关闭原生编辑对话框，确认结束后重新打开；取消或失败保留未保存草稿。豆包 / ChatGPT 账号状态仅在百宝箱主页面激活、弹幕互动面板可见且文档未隐藏时每 3 秒轮询，切走或隐藏时停止，恢复时立即刷新；若页面切换时已有在途的完整配置与状态请求，直接复用该次结果而不额外查询账号。登录、退出与切换平台的刷新不变，OAuth 与会话由独立后端模块处理；页面释放时清理定时器、可见性监听和观察器，已有在途读取完成后不重启轮询。

## 1. 页面结构

管理页 HTML 分片位于 [pages/admin/](../../../public/pages/admin)，由 [server/admin-page.js](../../../src/server/admin-page.js) 按固定顺序组合；完整性、顺序和唯一 ID 由 [admin-page-composition.test.js](../../../test/admin/admin-page-composition.test.js) 保护。

桌面顶栏高度由 `css/desktop/theme.css` 的 `--topbar-height` 控制，默认为 48px。`css/desktop/shell.css` 中主导航按钮最小高度为 30px，右侧工具按钮和直播状态高 26px。导航与状态区使用紧凑字号和图标，左侧软件标志与右侧窗口控制图标按 SVG 固有尺寸显示。各主页面的剩余高度、启动遮罩与盲盒分析工作区的顶部偏移共用该变量。非桌面顶栏默认高度为 58px。

```
topbar: 品牌 Logo + 主页面 Tab（点歌 / 播放 / 礼物 / 组件 / 百宝箱）
        + #audioAssistantTop（启用时显示） #liveStatus（简短直播 / 本机连接状态，点击查看详情）
                 #reconnectBtn（重新连接直播间） #songCount（歌库计数） #shutdownBtn（退出）
        + 窗口控件 #windowControls（最小化/最大化/关闭，仅桌面可见）
├── #songAssistantPage     点歌主页面（默认，无 #hash）
│     ├── SC 队列面板 + 点歌队列面板（切歌/清空，带滚轮冒泡控制）
│     └── 歌曲管理面板（song-management-panel）：内部七个 Tab
│           songsPage（歌库） / settingsPage（账号登录） / songRequestPage（点歌规则） / themePage（点歌板）
│           displayPage（展示板） / overlayPage（浏览器源） / importPage（歌单导入导出）
├── #playbackAssistantPage 播放助手（#playback）
├── #giftAssistantPage     礼物面板（#gifts）：礼物检测/提示/最近/今日盲盒盈亏/盲盒映射
├── #liveComponentsPage    组件（#components）：实时榜单/弹幕姬/礼物姬/音乐展示/文本框/加班机/时钟/开播动画/弹幕投票/观众评分
│     └── 音乐展示：desktopLyricPage（直播歌词） / nowPlayingPage（歌曲信息）
└── #otherAssistantPage    百宝箱（#other）：弹幕互动/PK 算分/动态抽奖/小游戏/礼物特效/电音助手/粉丝档案/主播工作台/世界地图/设置/性能/使用文档
```

七个内部 Tab 的内容由 [pages/admin/song/](../../../public/pages/admin/song) 下的分片组成：

| Tab | 主要内容 |
| --- | --- |
| 歌库 | 歌曲表格 + 搜索/曲风/语言/歌手/标签/启停筛选 + 编辑表单 |
| 账号登录 | B 站账号与直播间、可选的大航海到期同步账号（保留 `settingsPage` 标识与登录跳转） |
| 点歌规则 | 接收与排队、SC/取消点歌、重复与身份优先、队列上限和冷却（独立 `songRequestPage` 页签） |
| 点歌板 | 点歌板样式与预设、规则与置顶文案、主题色/字号/滚动/字体 |
| 展示板 | 歌单板独立主题（可同步主主题）、滚动秒数、字号、预设卡片 |
| 浏览器源 | 按点歌与音乐、直播互动、场景与氛围分类汇总固定 OBS / 直播姬浏览器源地址（含歌曲信息与礼物冲刺；文本框来源在其场景中复制）；「网页页面」仅保留「我的网页歌单」，其他外部站点入口位于对应百宝箱页面；参数化地址由对应功能页生成 |
| 歌单导入导出 | 文本/文件导入导出、结果统计、云端歌单同步与歌单页背景 |

主页面切换由 [app.js](../../../public/js/admin/app.js) 的 `setMainPage` 负责：维护 `VALID_MAIN_PAGES`、`MAIN_PAGE_HASH_MAP`、`MAIN_PAGE_BODY_MAP` 三张表，切换 `body.dataset.mainPage` 并同步 `location.hash`（`#playback`/`#gifts`/`#components`/`#other` 直达，[app.js:120-167](../../../public/js/admin/app.js#L120-L167)）。更新消息保留可点击通知，不强制切走当前页。

**桌面形态**：`/admin?desktop=1` 时由 [shell-start.html](../../../public/pages/admin/shell-start.html) 在 CSS 加载前给 `html` 加 `desktop-shell` 类，加载 `css/overlays/desktop.css` 的暖金主题，顶栏变为 `-webkit-app-region: drag` 拖拽区，`#windowControls` 与 `.desktop-only` 元素显示（[desktop.js:14-17](../../../public/js/desktop.js#L14-L17)）。

## 2. 公共框架(shared/)

| 模块 | 文件 | 说明 |
| --- | --- | --- |
| EventBus | [shared/event-bus.js](../../../public/js/shared/event-bus.js) | 应用内事件总线（`on`/`off`/`once`/`emit`/`clear`），通过具名 ESM 导入同一单例与 `Events` 常量；调试日志直接调用共享 logger |
| StateService | [admin/state.js](../../../public/js/admin/state.js) | 全局状态唯一入口：WS 客户端 + `/api/state` + `/api/songs` 加载，快照经 EventBus 派发 `STATE_LOADED`/`SONG_UPDATED`，同时以 `CustomEvent`（`app:wesing-state` 等）广播实时状态（详见 [comms.md](comms.md) §3） |
| FormsService | [admin/forms.js](../../../public/js/admin/forms.js) | 通用控件：`range` ↔ `number` 双向绑定、参数滑块刷新和选项卡；不读取业务设置 |
| StateRenderer | [admin/state-renderer.js](../../../public/js/admin/state-renderer.js) | 快照分发、普通设置回填和队列/SC 组合刷新；保留焦点与未保存修改字段，各独立表单由自己的控制器回填 |
| PlayerWorkspace | [admin/player-workspace.js](../../../public/js/admin/player-workspace.js) | 播放器工作区：`initWorkspaceControls` 绑定全屏开关、ESC/空格快捷键与 dock 展开/收起（手动状态保存在本机 `lira-player-dock-collapsed`，首次默认收起），管理全屏焦点及收起时依赖弹窗的联动关闭 |
| Logger | [shared/logger.js](../../../public/js/shared/logger.js) | 默认仅 `localhost`/`127.0.0.1` 启用 debug，可通过具名导入实例的 `enabled` 显式设置；不读取 Admin 状态 |
| Theme | [shared/theme.js](../../../public/js/shared/theme.js) | `loadThemeConfig()` 拉取 `/data/theme-presets.json`，具名导出经典/歌单板预设、色板、标签访问器 |
| Utils | [shared/utils.js](../../../public/js/shared/utils.js) | `api`/`readJsonResponse`/`toast`/`escapeHtml`/`formatBytes`/`dangerConfirm` 等（清单见 [comms.md](comms.md) §2） |
| Desktop | [desktop.js](../../../public/js/desktop.js)、[desktop-resource-integrity.js](../../../public/js/desktop-resource-integrity.js) | `createDesktopShell` 接收通知、请求、确认框与更新页导航能力；桌面壳负责更新状态和版本徽章，资源完整性模块负责独立检查生命周期 |

纯 HTML/属性转义由 [shared/html-escape.js](../../../public/js/shared/html-escape.js) 负责，日期、金额、数量等展示格式化由 [shared/display-format.js](../../../public/js/shared/display-format.js) 负责；Admin 和 playback 中只需纯函数的模块应直接导入这两个文件。`shared/utils.js` 仅保留界面、请求与退出登录相关的具名导出，已移除无人使用的聚合 `utils` 对象及全局挂载。仅导入纯函数入口或 `playback/utils.js` 不加载通知、确认框或请求模块；边界见 [遗留边界](../../architecture/engineering/legacy-boundaries.md#frontend-pure-helpers-and-compatibility)。

`EventBus.once()` 在调用回调前标记已触发并注销；回调抛错、回调再次触发同一事件，或嵌套分发仍持有旧监听器快照时，该订阅均只执行一次。异常仍由 `emit()` 记录，不中断其他订阅者。

`admin/component-preview-elements.js` 提供画布、参数面板和文本编辑共用的 DOM / SVG 构造；`component-preview-surface.js` 只负责 iframe 预览、通信、数据订阅及其销毁。基础控件调用方直接导入 `elements`，不经过预览运行时。

保存提示由 `shared/save-status.js` 统一呈现；组件控制器通过 `component-save-feedback.js` 映射原有状态，其他页面可直接传入状态与文案。保存调度、重试、并发和可见性仍由页面管理，样式与使用方见[共享控件](pages.md#5-css-清单)。电音助手完整页四个、快捷面板三个参数滑杆复用 `shared/parameter-range.js`；初始化绑定、状态回填刷新和卸载释放由 `audio-assistant-controls.js` 负责，参数请求与原有合并提交策略保持不变。

**模块组合惯例**：使用具名 import/export 和显式工厂参数；Admin 不再发布或读取 `window.AdminApp`，共享层不依赖管理页。`EventBus` 只承担一对多通知，不作为隐藏的请求/响应依赖。

**事件流约定**：

| 事件 | 发布方 → 订阅方 | 用途 |
| --- | --- | --- |
| `Events.STATE_LOADED` | `app.js`（接 `stateService`）→ `state-renderer` | 普通快照按 `changedKeys` 更新视图。连接基线通过 `isConnectionSnapshot` 单独标记，即使字段相同也交付给需要重新校时的消费者 |
| `Events.SONG_UPDATED` | `app.js`（接 `stateService`）→ `songs.renderSongs` | 歌库列表/筛选器重渲染；`complete` 表示本次请求为不带筛选的完整歌库 |
| `Events.GIFT_RECEIVED` | `stateService` → 盲盒摘要与分析 | 礼物、清空、`gift:source` 与 `connect` 快照使统计失效；订阅方按 `reason` 决定合并刷新或取消旧来源请求 |
| `Events.OVERTIME_UPDATED` | `stateService`（`overtime:update`）→ `overtime.js` | 机器状态按 `revision` 递增交付。同修订的 `quantity-limit` 只把有变化的计数合入共享状态，交付面板的 `state` 仅含 `revision`、`pendingCount` 和 `quantityLimitedCount` |
| `Events.GIFT_CATALOG_UPDATED` | `stateService`（`gift-catalog:update`）→ `overtime.js` / `gifts/artwork-catalog.js` / `gifts/blindbox.js` | 图片扫描完成后按精确 ID 刷新本地图片，去重包含图片路径和 `assetsUpdatedAt`；不得覆盖当前直播间成员，不触发歌库或礼物事件重载 |
| `CustomEvent` `app:lyric-state` / `app:lyric-timeline` / `app:lyric-source` / `app:wesing-state` / `app:settings-state` | `stateService` → 各页面 `window.addEventListener` | 歌词跟随与外部客户端状态、WeSing 面板、直播歌词预览、设置自动保存就绪信号 |

**组合调用与歌库/礼物目录**：

- `app.js` 将 `STATE_LOADED` 交给具名导入的 `createAdminStateRenderer`，并显式注入礼物渲染函数；协调器直接调用队列、歌曲和表单 ESM 接口。歌曲入口通过 `createSongs({state, utils})` 接收状态服务和工具，再向编辑器和筛选器传入具体能力。礼物入口通过具名 import 组装通知、检测、冲刺、最近礼物、盲盒和历史模块；盲盒直接导入最近礼物图标及分析能力，并独立订阅 `GIFT_CATALOG_UPDATED`。
- `song-library-filters.js` 负责筛选控件读取，`songs.readSongFilters()` 保留原入口，由 `app.js` 注入 `StateService`；`reloadSongs({ filters })` 可接收显式筛选，无参刷新、实时失效刷新及重连读取当前筛选。`StateService` 不读取或渲染 DOM，继续管理单一 WebSocket、请求代次和快照接纳。`state-renderer.js` 根据 `ws:connected`、`ws:disconnected`、`app:shutdown` 事件显示连接提示；启动先订阅后连接。
- `reloadSongs()` 默认只读取歌曲；显式 `reloadState: true` 或 `reloadAll()` 才补读管理快照。同一筛选、失效代次和刷新选项的在途请求并发复用；直接刷新消化此前等待的歌曲防抖通知，请求开始后收到的新通知仍产生后续刷新，过期结果不能覆盖新筛选或新代次。`songs.js` 完整显示歌库或筛选结果（不分页），隐藏歌库/工作区或文档不可见时只保留最新待渲染结果，恢复可见后更新一次；表格按行比对复用相同前后行，同值筛选选项复用原节点。`StateService` 仅对 `songs:*` 和 `cloud:songs` 快照原因防抖重载歌库；HTTP `reloadState()` 与 WS 共享歌词代次检查，重复或过期代次不重复派发 `app:lyric-state`。
- 加班机礼物选择器的 `GET /api/overtime/gifts` 与刷新按钮始终使用当前直播间礼物面板、`giftConfig` 和已配置在售盲盒展开（不读个人背包）。弹窗中的「搜索全部礼物」经 `GET /api/overtime/gifts/catalog` 加载本机完整快照，每批显示 80 项，可继续显示。输入名称或 ID 在全目录筛选，回车立即执行，清空搜索保留当前模式，「返回在售礼物」切回房间目录。最近礼物也通过该全局快照获取图片映射，两者均只显示 `/overtime-gift-images/<basename>`（按精确 ID 映射，缺失显示占位图）；`gift-catalog:update` 推送的新图片优先于未完成的首次 HTTP 读取，失败不清空已有映射。远程 HTTPS 域名入口见 [backend/overtime.md](../backend/overtime.md) §1.5。

**共享通知（`shared/toast.js`）**：

- **生命周期与去重**：由 `shared/toast.js` 直接维护，`shared/utils.js` 保持 `toast(message, options?)` 与 `showStackedToast(options)` 兼容导出。相同 key 默认去重；状态类调用显式传 `update: true` 原位替换内容并重置计时。返回句柄提供 `node`、`update(options)`、`close()`，`duration: 0` 表示进度持续显示。每个节点独立计时、退出幂等（默认 180ms），悬停及焦点位于卡片内时暂停计时。
- **交互与无障碍**：不显示关闭按钮，通过自动计时或业务句柄移除；操作项使用原生 `<button>` 且仅触发一次，CSS 排序避免移动 DOM 导致焦点丢失，移除时优先恢复焦点到其他可见操作或原触发元素。普通结果经独立状态区播报，礼物不逐条播报，`urgent: true` 才使用 assertive。需在原生浮层上方反馈时传 `topLayer: true`，由共享栈临时经 manual popover 提升层级并在最后一条退出或栈释放时撤除。
- **数量上限、时长与样式**：普通结果最多同时 3 条、礼物最多 6 条，按窗口实际剩余高度调度（错误/操作优先，超额瞬时礼物淘汰）。成功短提示默认 2600ms，警告/错误至少 6000ms，带操作至少 8000ms；系统开启「减弱动态效果」时关闭通知位移动画。背景、文字与操作样式由 `admin/toasts/system.css` 维护：卡片按内容自适应宽度（进度卡带 `<progress>` 时锁定紧凑宽度，带操作项时经 `.toast-has-action` 启用右侧竖线分隔操作区），带副文/进度/操作的卡片自动附带语义或业务图标，仅标题无副文/操作的提示走单行紧凑样式（单行纯文本省略末尾中文句号，多句/多行/富卡片保留原标点），进度类通知可通过 `meta` 在标题行右侧展示百分比；独立 `gift-audit` 页面复用控制器但保持独立 CSS。
- **业务通知规则**：最近礼物与盲盒映射共用 `gifts/blindbox-theme.js` 与 `css/admin/gifts/blindbox-themes.css` 的固定盒型配色（不随客户端主题切换，未匹配用紫色，波仔盲盒 `36062` 为草绿色）。礼物通知经 `gifts/artwork-catalog.js` 的 `getGiftToastArtwork` 按 `gift_variant_id` 复用本地 WebP（40×40px 异步解码，失败显示 `gift-toast-fallback.svg`）。`utils.api(url, body, { notifyError: false })` 允许业务 `catch` 独占错误反馈；字段就地错误由 `shared/field-feedback.js` 关联 `aria-describedby`/`aria-invalid`。各业务状态提示遵循「正常保存静默更新页面状态、失败/冲突/连续故障按需提醒、重试成功原位更新」原则（含播放快照连续两次保存失败、电台连续补歌失败、粉丝档案定时更新静默、动态抽奖仅提醒当前/运行中任务等）。公共字体与礼物图片下载进度见 §10。

**客户端设置与主题状态机**（视觉规范与二十四套色板定义见 [pages.md](pages.md#客户端设置与外观)）：

- 客户端配色目录由 [shared/client-theme.js](../../../public/js/shared/client-theme.js)（ESM 单一真源，[src/shared/client-theme.js](../../../src/shared/client-theme.js) 以 CJS 薄壳复导出）唯一维护 24 套主题的 ID、显示名称、明暗分组（`mode`）、六大色系分类（`category`）、表面材质（`surface`）、日夜配对族（`family`）、色温（`temperature`）、默认项和原生窗口底色；`src/server/admin-page.js` 基于共享 `<template data-client-theme-option-template>` 与分类模板安全转义展开设置页色系胶囊和浅色/深色选项，`admin/client-appearance.js` 读取生成的单选项并维护明暗×色系联动筛选、交叉计数、空结果恢复、已选主题隐藏定位以及色板区无滚动条柔和边缘渐隐。点选立即保存，保存期间禁用非当前选项且不接受第二次请求，主进程确认保存后通过 [shared/client-theme-runtime.js](../../../public/js/shared/client-theme-runtime.js) 原子更新 `data-client-theme` / `data-client-theme-mode` / `data-client-theme-surface` 并经 `BroadcastChannel('lira-client-theme')` 同步同会话内已打开的工具页，失败回滚原选择。
- `shared/client-font-theme.js` 定义可独立绘制中英数的客户端字体 ID。首次打开界面字体菜单时，`admin/client-font-settings.js` 启用共享字体预览，并用默认正文字体的 CSS 字宽检测逐项确认五个系统候选，以中文名显示可用项。`shared/client-font-runtime.js` 先加载共享字体的全部分片或确认所选系统字族可用，再将已保存的字族应用于正文、标题与控件，并通知同一会话内已打开的工具。工具页所在设备缺少该字体时使用默认排版。共享字体在冷启动后就绪时会自动恢复。
- 「百宝箱 → 设置」由 [client-settings.js](../../../public/js/admin/client-settings.js) 管理「外观主题」「声音与通知」「账号与连接」「系统与关于」四个页签的切换、方向键/Home/End 导航及旧更新页迁移；「系统与关于」中的更新和本地维护由 `desktop.js` 编排，资源检查由 `desktop-resource-integrity.js` 维护状态、订阅与视图，`settings-license.js` 让「用户协议」「隐私政策」共用原生 `dialog` 读取 `/pages/admin/toolbox/user-agreement.txt` 与 `privacy-policy.txt`（按文档缓存、过滤晚到读取，同意门槛见[构建参考](../engineering/build.md)）。
- [desktop-notification-settings.js](../../../public/js/admin/desktop-notification-settings.js) 管理「声音与通知」中的系统通知开关与大额礼物门槛（经受限 `desktopNotifications` 桥自动保存、保存中禁用、失败回滚，契约见 [preload](../desktop/preload.md#25-dailybotsfanprofiles-与-giftexport)）。
- 桌面色板由 `css/desktop/palettes.css` 维护（三层纯令牌架构：Tier 0 默认值与重置、Tier 1 暗色与渐变共享基类、Tier 2 单主题覆写，不含组件选择器；`css/desktop/theme.css` 引入色板并保留公共几何；`--client-select-*` 由 `components/select-menu.css` 消费，`--client-*` 变量适配礼物/盲盒/粉丝身份色与全屏背景，直播画面与客户端内直播预览区保持原有配色；页面布局按 `--player-dock-reserve` 预留底部空间）。

## 3. 启动时序

### 3.1 模块加载（[index.js](../../../public/js/admin/index.js)）

[document-end.html](../../../public/pages/admin/document-end.html) 以 `type="module"` 加载 [index.js](../../../public/js/admin/index.js)。`index.js` 导入上下文帮助、队列、歌库、礼物及 `app.js`，并初始化礼物目录提示、礼物互动和粉丝档案入口；桌面壳、播放助手和常驻表单由 `app.js` 显式 import，初始化统一由 `initializeApp()` 编排。ESM 依赖图决定求值次序，播放助手直接使用 `playback/index.js`。

`app.js` 通过具名模块和明确回调组合桌面壳、播放助手与管理页面；更新提示的导航由组合根提供，WeSing 切换时关闭全屏的动作从组合根传至播放控制器和事件处理器。`app.js` 将 `createAdminStateRenderer()` 注册为 `STATE_LOADED` 订阅方，后者按 `changedKeys` 分发各视图，队列模块不承担全局快照渲染。

### 3.2 初始化（[app.js](../../../public/js/admin/app.js) 的 `initializeApp`）

礼物姬、文本框、开播动画、时钟和加班机位于组件页，小游戏和 PK 算分位于百宝箱。两页管理界面由 [toolbox-lifecycle.js](../../../public/js/admin/toolbox-lifecycle.js) 在主页面与对应功能同时选中时动态加载。`toolbox-navigation.js` 经注入的 `onFeatureSelected` 通知选择，主导航经 `setPage` 通知可见性；同一轮程序导航只激活最终选择。记忆选择也走此路径，重复进入复用已初始化模块，切换面板后旧加载结果必须重新确认当前选择才可初始化。`app.js` 为两页分别创建带 `ownerPageId` 的协调器，在确认页面离开的 `pagehide` 调用各自的 `dispose()`，阻止晚到初始化；可取消的 `beforeunload` 不销毁协调器、顶栏连接卡或相关监听；各模块仍自行负责订阅、计时器和请求的释放。需要服务端状态的模块在首次进入时通过现有 HTTP 读取当前配置/会话，加班机同时从 `StateService` 读取当前礼物检测与直播状态。

模块下载失败清除加载缓存，下次选择可原地重试；同步 `init()` 只有正常返回后才记为成功。若初始化中途失败，模块可能已注册部分监听器且无法彻底回滚，因此会按初始化函数引用记录失败状态（覆盖共享同一模块的多个入口），不再重复调用残留实例。`app.js` 复用确认对话框保留原始错误并提供「重新加载管理页」（提示未保存编辑会丢失，同时只显示一个确认框）；确认后仅调用当前页面的 `location.reload()`，通过整页重载隔离恢复（不重启 Electron 应用或服务、不清除持久化数据），而非原地重新初始化。覆盖见 [toolbox-lifecycle.test.js](../../../test/admin/toolbox-lifecycle.test.js) 与 [frontend-admin-startup.test.js](../../../test/admin/frontend-admin-startup.test.js)。

桌面入口在解析正文前同时设置 `html` 和 `body` 的桌面样式。初始化期间保留标题栏与窗口按钮，显示启动提示；工作区使用 `visibility` 暂时隐藏以保留导航测量尺寸，在初始状态和歌库读取、主题预设渲染完成后显示。初始化失败也会解除隐藏并显示错误提示。

1. 初始化桌面外壳与设置表单入口；窗口按钮、本地设置表单、点歌规则及监控操作在等待账号信息读取前完成绑定
2. `initMainPages()` 绑定主页面 Tab（按 hash 选中初始页）
3. `playerWorkspace.initWorkspaceControls()` + `formsService.initTabs()`（播放器默认收起、ESC/空格快捷键）
4. `await Theme.loadThemeConfig()` 预载主题配置，再直接调用 `initPlaybackAssistant(options)`；首次构造时注入 `toast`/`showError`/`readJsonResponse`、`getWeSingState` getter 和 `closeFullscreenPlayer` 回调。播放器收起通过 `closeQueuePopup` 交由队列 UI 同步关闭状态与焦点
5. 通过显式 ESM 入口初始化常驻表单、档案以外的业务面板及礼物历史抽屉；可选工具编辑器通过上述激活入口初始化，动态抽奖的 `dispose` 在卸载时调用
6. `stateService.connectSocket()` + `await stateService.reloadAll()`（先 WS 后 HTTP 兜底）
7. 渲染主题预设卡片

开播动画编辑器由 [start-animation.js](../../../public/js/admin/start-animation.js) 在激活后读取 `/api/opening/config`：成功读取前禁用编辑、整套特效开关和媒体修改，失败持续显示错误并提供「重新读取」（保持单个在途读取，成功恢复后才开放自动保存）。开播页由 `opening-style-picker.js` 将内置与导入样式置于同一选择区（经典舞台保留文案、轨道、人物、音乐；像素卡带展示画质、装饰、头像和音乐；导入资源样式经 `resource-style-settings.js` 复用原生参数面板）。画布 `opening-canvas-settings.js` 提供同步参数与图片/音乐上传清除，自动保存到同一样式的共享设置（经典 1 用完整人物图、像素卡带用大头贴，默认均无图且不互退；位置、尺寸与图层样式归场景草稿）。内置「预览」添加或选中 `opening` 图层，导入样式「在画布中使用」先保存公共参数再创建保留样式身份的场景实例。字段与播放归属见[开播配置合同](../backend/api.md#21-开播动画域opening)。

## 4. 点歌主页面模块

歌单背景由 [song-background.js](../../../public/js/admin/song-background.js) 编排既有授权 IPC，[song-background-image.js](../../../public/js/admin/song-background-image.js) 处理静态 WebP 与本地副本。原图上限仍为 5 MiB，GIF/动图取首帧；长边上限先取 2560px，必要时为 1920px，小图不放大。WebP quality 依次为 0.82、0.76，以 500 KiB 为目标、1 MiB 为硬上限；无法在该画质/尺寸范围内满足上限时拒绝本次上传，不继续降分辨率。

压缩候选先写入当前桌面 origin 的 Chromium Cache Storage `lira-song-background-v1`，上传成功后以服务端返回的完整公开版本 URL 保存已确认副本，并直接通过 Blob URL 预览，不回源下载自己刚上传的图片。上传失败只丢弃候选，保留原背景；恢复默认清空本地缓存。最多保留一个已确认版本和一个候选，页面离开时释放 Blob URL。缓存写入失败不改变云端上传成功结果，界面说明本地副本未保存。

页面初始化仍通过授权 IPC 查询当前版本元数据，缓存命中不请求图片；未命中才以不带凭据的低优先级 fetch 下载一次（15 秒超时、兼容旧图 5 MiB），失败提示重新打开，不自动重试。缓存属于可重建副本，可随桌面 origin 变化或浏览器清理而失效，不作为离线原图备份。旧背景不会自动压缩，重新上传才应用新尺寸/体积策略。此功能不新增轮询、运行依赖或直播事件连接。

### 4.1 `queue.js` 与 `superchat.js`（点歌队列与 SC）

- **渲染与空态**：`queue.js` 将点歌队列 `current + waiting` 拼表，显示置顶、序号、来源标签（`admin`/`danmaku`/`superchat`/`random:<scope>`/`history`）、长歌名字号和管理员队列字体预览；空点歌队列根据「暂停点歌」和「弹幕监控」显示真实接收状态，且仅在队列变化或暂停/监控设置变化时刷新，其他设置保存或仅点歌结果提示变化时复用现有行和按钮；「导入播放器」复用播放队列的匹配流程。`superchat.js` 按快照顺序显示 SC 价格、留言及已处理状态。两者由 `state-renderer.js` 分别调度，需要组合刷新时使用 `renderQueuePanels()`。
- **操作与 SC 撤销**：点歌队列经 `/api/queue/action` 提交 `done`/`clear`/`pin`/`unpin`/`live`/`unlive`/`delete`，成功后 `reloadState()` 刷新；清空走 `dangerConfirm`，未置顶首行不显示置顶按钮，仅首行显示 LIVE 切换（`aria-pressed`），标记后保留第 1 位，取消恢复规则排序。SC 标记处理走 `/api/superchats/action`，删除与撤销分别走 `/api/superchats/delete` 和 `/api/superchats/undo`。SC 行内删除后，会在「清空 SC 记录」左侧展示本批次删除数量与「撤销」按钮（沿用客户端配色令牌）：连续删除合并为同一批次，自最后一次删除起 10 秒失效，进退场各做 1 秒淡入淡出（开启「减弱动态效果」时跳过渐变），失效后立即禁用按钮并在淡出结束后隐藏；恢复请求串行执行，清空记录时直接调用该模块取消当前撤销提示（后端恢复条件见[醒目留言服务](../backend/bilibili/gift.md)）。撤销令牌、批次代次、过期与退场计时器由 `superchat.js` 统一管理，`app.js` 显式初始化并在退出页面时释放，释放后的排队操作与晚到响应不能修改下一轮视图。
- **状态条归属**：`queue.js` 更新队列计数 `#queueSize`；歌库计数 `#songCount` 与 `#liveStatus` 由 `state-renderer.js` 按对应字段变化更新。
- **滚轮处理**：SC 与点歌队列共用 [queue-list-view.js](../../../public/js/admin/queue-list-view.js) 的复制按钮绑定和 `bindQueueWheel`，按 `deltaMode` 换算后以 0.3 倍速度滚动列表。触底后拦截当前向下滚动，750 毫秒后放行外层页面；若相邻纵向滚轮事件间隔达到 180 毫秒，视为新手势并提前放行，后续连续输入保持放行。首次在已触底列表上滚动也进入缓冲；反向滚动或列表重新可向下滚动时重置缓冲。空列表、无需滚动的短列表及顶部向上滚动直接交给页面；两个队列分别维护缓冲状态，滚轮绑定返回释放函数。

点歌规则的 `guardPriorityEnabled` 默认关闭，通过现有表单统一保存并保留未保存草稿；排序说明放在问号中。冷却模式保留问号说明，不再渲染控件下方重复段落。LIVE 是点歌队列标记，与播放器运行状态独立；各点歌板样式显示 LIVE，并把它纳入渲染变更判断。

### 4.2 `songs.js`（歌库）

`songs.js` 负责列表渲染、菜单和行操作。[song-editor.js](../../../public/js/admin/song-editor.js) 独立负责编辑草稿、正在编辑的歌曲提示、价格输入、保存代次与放弃确认：同一编辑器只允许一个在途保存，保存及列表刷新完成前禁用提交，保存失败恢复提交并保留草稿；保存期间继续输入保留新草稿，切换歌曲后的旧保存结果不能重置当前表单。删除成功后，仅在表单仍编辑被删歌曲时重置（等待删除期间已切换歌曲则保留新草稿）；清空或替换歌库后，若不带筛选的完整歌库里已没有正在编辑的歌曲同样重置（刚保存、尚未出现在列表中的新歌不按删除处理，筛选结果缺项也不清空编辑器）。

没有保存请求在途时，同 ID 歌曲的列表刷新按字段与上一次已知歌库基线比较：未修改字段采用最新值，已修改字段保留草稿及输入选区，最新歌库值成为下一次比较的基线。因此只改备注再保存不会撤销已收到的导入价格或可点状态；同一字段也有本地修改时，保留本地草稿供用户保存或放弃。

- **渲染与列显隐**：`/api/songs` 列表包含首字母、歌名、歌手、曲风、标签、语言、可点状态、点歌价格和核对备注。歌手、曲风、标签和语言固定显示；仅点歌价格和核对备注在当前列表或筛选结果中整列为空（含纯空白）时隐藏列头和单元格，有内容时恢复（数值 `0` 不当作空值）。首字母、歌名、状态和操作始终保留，空列表提示跨八个固定列。歌名下可展开歌切纯文本。行操作包括编辑（载入表单）、入队（`/api/queue/add`，`source=admin`）和删除（`dangerConfirm` + `/api/songs/delete`）。
- **价格与歌切**：始终显示自由文本输入，编辑完整回填 `request_price`/`song_clip`，保存传 `requestPrice`/`songClip`；显式空值清空，表单重置清除 ID、价格、歌切和快捷状态。价格快捷填写为免费/舰长/提督/总督/可编辑 SC 文本，显示 UTF-16 码元长度，超过 1000 通过输入有效性阻止提交（历史超长回填不截断）。停用说明歌曲不出现在公开歌单；保存反馈仅确认本地成功，网页更新以云端同步结果为准。验收见 [点歌资料规范](../../../specs/song-request-metadata.md)。
- **筛选与曲风拆分**：由 [song-library-filters.js](../../../public/js/admin/song-library-filters.js) 负责，包括搜索框 180ms 防抖、曲风/标签多选（`details.lira-multiselect`，勾选框表示选中，点击外部收起）、语言/歌手下拉与 `enabledOnly` 开关，任意变化触发 `reloadSongs()` 并同步维护候选更新和已选项保留。曲风选项按中英文斜杠、分号、逗号及顿号拆成独立名称，修剪空白、去重并排除空项和「默认」（`R&B` 与含空格名称保持完整）；曲风与标签入口提示「匹配任一」，选择摘要用顿号分隔，不改写原始曲风或同步数据。过滤规则见 [歌库 API](../backend/api.md#7-歌库域songs)。

### 4.3 `settings.js`（设置）

- **页签分工与监控开关**：原设置页签改名「账号登录」（保留 `settingsPage` 标识与登录跳转），表单只收集 `roomId`；点歌规则独立为 `songRequestPage` 页签，点歌板页只展示外观设置。弹幕姬的 `danmakuMonitoringEnabled` 和礼物页的 `giftMonitoringEnabled` 为默认开启、独立即时保存的监控开关，帮助通过 `lira-help` 展示，服务端同步后不依赖桌面持续运行。
- **点歌规则布局与自动保存**：`request-rules.html` 按接收与排队、点歌间隔与每日上限、点歌资格、点歌结果提示、屏蔽词、用户黑名单分组（宽窗口左栏为接收与排队，右栏依次为点歌间隔与每日上限、点歌资格并与左栏底边对齐，提示配色与两类名单通栏；≤ 1000px 转单列，≤ 640px 标签与控件上下排列）。修改后 500ms 防抖串行提交 `POST /api/settings`（输入无效或中文组词期间暂缓，保存区显示等待/保存中/已保存/失败与「重试保存」，失败保留草稿，保存期间的新编辑不被旧回包覆盖并继续提交）。字段及默认值见 [设置契约](../backend/api.md#2-设置域settings)：
  - 接收与排队包含「接受 SC 点歌」（关闭明确为仅显示留言）；点歌间隔数值无效时在字段旁显示范围与未保存提示并设 `aria-invalid`，修正或切为不限制后清除。
  - 身份间隔与每日上限以大航海徽章标示身份，每行两列（左秒数、右首数，默认留空并提示「不填即不限」），按每位观众独立计算且各身份互不继承；普通间隔空串保存时归一为 0，八个输入框回填 0 时显示空白提示。
  - `song-cooldown-settings.js` 按冷却模式切换时长输入的显示与禁用（单位随模式显示小时或天），切回「不限制」时将无效时长恢复为默认值。
  - 点歌结果提示复用不透明取色器，分别设置点歌人与歌名颜色。点歌板主题在点歌板页独立自动保存，互不提交对方草稿。
- **屏蔽词与用户黑名单**：`song-request-blacklist.js` 管理可编辑词条列表（支持添加、删除和回车新增，原生单行输入框自动分列，通过隐藏字段保存换行分隔的 `songRequestBlacklist`）。`song-request-user-blacklist.js` 管理按 UID 的独立用户名单（通过隐藏字段 `songRequestUserBlacklist` 保存 JSON，昵称仅作备注；到期时间按本机时区编辑转为毫秒值，留空永久，定时/时钟回拨核对过期状态）。两类编辑均复用 `data-preserve-dirty`，行内输入保持焦点时不重建行，保存期间继续编辑与失败均保留草稿。删除一个 UID 后，可由另一行复用并提交该 UID。保存期间继续修改这行的备注或再次删除它，下一次自动保存采用最新编辑，并合并其他 UID 的快照更新。
- **即时开关与 B 站扫码登录**：礼物检测 `enableGiftSprint`、礼物提示 `enableGiftNotification` 为即时开关（失败回滚复选框）。B 站扫码登录仅桌面可用（`window.bilibiliAuth`，Web 模式禁用），登出走 `logoutConfirm`；登录或退出触发 `app:bilibili-auth-changed` 后，设置组合根调用 `reconnectBilibili({ silent: true })` 以当前账号重新握手。
- **盲盒映射与盲盒投屏**：盲盒映射支持表单添加（chip 展示）、高级 JSON 编辑与逐条删除，保存到 `giftBlindBoxCustomConfigV2`（官方项仅展示 `giftCategory=blindBox` 且具核验产物/权益奖池的记录，排除 ¥15 七夕盲盒 `35429`、保留 ¥25 七夕盲盒 `35141`，默认显示当前直播间可送盒型，其余按需展开；高级编辑空态保留草稿）。盲盒投屏位于「组件 → 礼物姬 → 盲盒盈亏榜」（与「月底冲刺」同级），由 [settings-blindbox.js](../../../public/js/admin/settings-blindbox.js) 的 `createBlindboxSettings` 保存标题、人数与筛选，固定地址 `/blindbox`；打开「仅显示心动盲盒」后展开今日倍数、剩余堡数与出堡后已开盒数；外观仅含紧凑布局与自动翻页，字体配色通过「前往点歌板调整」跳转至「点歌 → 点歌板」统一编辑；点击网址复制，右侧「在画布中调整」调用 `openComponentPreview({ id: 'blindbox' })`。
- **系统操作**：清歌库/清 SC/清全部走 `dangerConfirm` + `/api/database/*`；退出调用 `/api/system/shutdown`（被接受或收到服务端 `shutdown` 确认后整页替换为退出屏，桌面版带「重新启动」按钮，失败且未收到确认时保留页面并恢复按钮）；重新连接直播间调用 `/api/bilibili/reconnect`。

### 4.4 `theme.js`（点歌板）与 `display.js`（展示板）

- 点歌板由 `queue-theme-view.js` / `queue-theme-config.js` 管理主题控件和设置投影，字号与旧滚动速度换算只用于显示；视图在赋值前准备已保存字体选项，展示板与画布的背景不透明度均以百分比显示（包括 0，持久化值仍为 0～1）。主题草稿由控制器维护，`input`/`change` 只编辑本地状态，显式保存后才发布到展示端。歌单板由 `song-board-settings.js` 管理独立草稿、回填、range/number 配对和预设，保留 180ms 防抖自动保存（正常隐藏保存栏，失败时显示「重试保存」）。`display.js` 组合控制器、设置同步和保存接口，并管理展示地址。
- 两者复用 `component-config-controller.js` 的草稿合并与广播/回执竞争确认机制（统一规则见 §7）；`state-renderer.fillSettings()` 不再重复写入这两个表单。
- 歌单板歌名颜色及点歌板歌名／点歌人颜色提供「跟随文字色 / 自定义颜色」选择（继承仍保存空串，自定义黑色有效）；`songBoardSyncTheme` 仅控制展示端跟随点歌板主题，表单仍保留各自已保存的独立设置。
- 点歌板风格 3–6、直播歌词与大播放器共用 `shared/local-font-library.js` 的本机字体查询（详见 §10，`admin/local-font-library.js` 保留兼容再导出）。
- 预设卡片点击套用（`classicPresets`/`songBoardPresets`）；`quickBeautifyBtn` 一键美化；点歌板样式切换（`overlayQueueStyle`：`classic` / `identity` / `storybook` / `neon-vinyl` / `cherry-ribbon` / `golden-lily`，遗留 `festival` 归一为 `identity`）。风格 1、2 的选择卡片使用中性底色，风格 3–6 保留素材主题色。管理页通过 `queue-style-settings.js` 只填充并提交当前风格对应的内容字号与纵向滚动设置，风格 3–6 的字体、字重与自定义正文颜色分别持久化，风格 2 专属置顶与规则设置不向插画风格显示或提交。
- `display.initOverlayUrls()` 生成 `/queue`、`/songlist`、`/lyrics` 的浏览器源地址文本（以 `127.0.0.1` 规范化）。

### 4.5 歌单导入与云端歌单同步

[song-import.js](../../../public/js/admin/song-import.js) 提供文件读取、编码回退及云歌单面板初始化（文件导入与粘贴导入互斥）；[song-import-parser.js](../../../public/js/admin/song-import-parser.js) 解析 CSV/TSV/粘贴文本；[song-import-update.js](../../../public/js/admin/song-import-update.js) 统一管理预览与确认替换，不再提供模式或空值选项。

- 上传完整 XLSX、CSV、TSV 或粘贴完整表格，点击「下一步：检查歌单」。CSV 文件按逗号分列，TSV 文件按制表符分列，粘贴时自动识别。文本保留实际列和无效行，XLSX 原样提交 base64，两种输入均向 preview/apply 传 `replaceAll: true`。匹配与校验在领域层执行（见 [歌库 API](../backend/api.md#7-歌库域songs)），空表、冲突或无效行阻止整批应用。
- 检查完成后聚焦并滚动到结果，提示「尚未导入」并显示非零的新增/更新/删除/未改变/冲突/无效数量；明细默认收起（有冲突或无效行时自动展开，每页 25 行，全部以 `textContent` 展示）。文件或粘贴内容变化会废弃预览及异步旧响应；确认仅提交已预览输入和 token，禁止重复提交；成功刷新歌库、曲风和计数，网页以云端同步结果为准。
- 网页歌单同步仅在有记录时显示本机手动同步时间（不据此推断自动同步状态），同步说明使用 `lira-help`，账号与歌曲数量的标签和值各自同行。`cloud-song-sync.js` 通过受限桌面桥读写账号的「启用网页歌单」开关（默认关闭）：关闭时服务端停用网页歌单直达页及公开歌曲、资料、外观和社区接口，但不影响本地歌库与云端同步；读取失败开关保持禁用，保存失败回滚上次已确认值，仅在确认开启且账号链接有效时显示「查看网页歌单」（接口见 [preload](../desktop/preload.md)）。

### 4.6 `metrics.js`（性能检测）

- 手动触发：`/api/system/metrics?windowMs=5000`（系统 + 服务进程 CPU/GPU/内存），5 秒采样，阈值 70%/85% 分 warn/danger 色阶（[metrics.js:113-118](../../../public/js/admin/metrics.js#L113-L118)）。
- 页面仅保留一个检测按钮；旁侧圆环待机显示 5 秒采样时长，采样期间按秒倒计时并收拢进度环，按钮进入 busy 态；倒计时结束后若请求未返回则显示「正在等待显卡采样结果」。不可用指标（如 GPU 缺失）置灰显示「不可用」，真实零负载显示 `0.0%`。
- 「本机信息」在进入性能页时请求 `/api/system/hardware`，显示操作系统名称/版本与 CPU/物理 GPU/内存型号与容量（排除虚拟显示适配器，GPU 容量标注「专用/预留显存」，读取规则见 [系统指标](../backend/server-core.md#8-系统指标)）。GPU 温度只随 5 秒检测请求 `includeTemperatures=true`，不设置后台定时器。

## 5. 礼物主页面(gifts/)

`app.js` 在 DOM 就绪后显式调用 `gifts/index.js` 的 `initGiftPanel()`，统一初始化图片目录、盲盒映射与统计面板；`pagehide` 释放订阅、观察器、卡片计时器与待处理统计/图片读取，离开礼物页时关闭盲盒分析层。导入图片查询或视图模块本身不启动这些请求和订阅。

渲染入口 `gifts/index.js` 的 `renderGiftPanel(gifts, sprint, live, diagnostics, settings)`，由 `state-renderer.js` 在相关快照字段变化时经 `app.js` 注入的回调调用。

礼物检测的权威端是 LIRA Server。客户端原始礼物检测器已删除；Electron 主进程通过 DeviceBearer SSE 与终态游标拉取（final cursor pull）/ 历史接口接收已处理 DTO，由 [remote-gift-controller.js](../../../src/electron/remote-gift-controller.js) 调用 runtime 的投影提交入口和 `importProcessedGiftEvent`，供本地 snapshot、历史、统计及符合条件的实时订阅方使用（完整恢复与边界见 [gift.md](../backend/bilibili/gift.md)）。渲染进程不持有远端 token、不访问 LIRA Server 礼物接口，也不解析原始 B 站报文。弹幕、点歌、SC、用户信息和小游戏仍沿本地连接运行。

| 子模块 | 面板 | 数据源 |
| --- | --- | --- |
| `detection.js` | 礼物检测状态（开关 + 共享收礼核心状态） | snapshot `giftDetection`/`giftSprint`/`liveStatus` |
| `notification.js` | 礼物提示（桌面 toast，`gift-notify-toast`，最多 6 条） | snapshot `gifts.recent` 新增比对 |
| `sprint.js` | 月底冲刺统计、Admin 文字预览与浏览器源入口 | snapshot `giftSprint` |
| `artwork-catalog.js` | Admin 共用图片目录、身份索引、请求合并、版本防回退与订阅 | `/api/overtime/gifts/catalog` + `Events.GIFT_CATALOG_UPDATED` |
| `recent.js` | 保留最近礼物数据，按当前列数构建最多 6 行卡片，容器尺寸变化时调整数量 | snapshot `gifts.recent` + `artwork-catalog` 图片查询和刷新回调 |
| `blindbox.js` | 盲盒映射编辑、官方奖池与房间在售目录。映射面板首次可见时先读当前房间缓存，缺失或房间不符时刷新。切房、保存设置和授权变更会在面板可见时重新核对 | `/api/overtime/gifts/catalog`、`GET /api/overtime/gifts`、`POST /api/overtime/gifts/refresh`、settings 与目录事件 |
| `blindbox-stats.js` | 今日盲盒汇总/盈亏榜、折叠/可见性、分析入口及完整请求清理 | `GET /api/gifts/blind-box-stats?top=10`、`Events.GIFT_RECEIVED` |
| `blindbox-analysis.js` / `blindbox-analysis-dates.js` | 盲盒分析工作区（单日/日期区间日历，观众/盲盒共享原生下拉，观众排行/盲盒汇总/开盒记录三视图，25 条分页） | `GET /api/gifts/blind-box-analysis?...` |
| `history.js` | 礼物历史抽屉（时间范围/平台筛选） | `GET /api/gifts/history`；清最近/清礼物走 `/api/gifts/clear-recent`、`/api/database/clear-gifts` |
| [gift-frame.js](../../../public/js/admin/gift-frame.js) | 礼物姬中特效 1 · 林间花信的开关、金额阈值与画布模拟预览 | `/api/settings`、`app:settings-state` |
| [gift-guard-thanks.js](../../../public/js/admin/gift-guard-thanks.js) | 礼物姬「大航海感谢」开关、默认动画文字与画布预览入口 | `/api/settings`、`app:settings-state` |

- **礼物历史跨页框选与导出**：礼物历史按 `eventId` 跨页保留选择。普通框选替换本页选区，按住 Ctrl 从礼物行或勾选框起拖可追加；拖动时的新增条数以按下鼠标时的选区为准，缩小选框重新计算，松手确认、中断恢复原选择。「导出所选」将选中记录 ID 传给桌面导出预览（见[礼物历史框选](../../../public/js/admin/gifts/history-selection.js)）。预览右侧记忆输出方式、图片背景、排序、词条间距、合并同种礼物、卡片样式和保存文件夹。「卡片样式」默认跟随滚动礼物，也可就地选择导出专用的外形、纹理和金额分界。修改样式时直接更新当前页的卡片。卡片先按合并设置成卡，再按时间或总金额降序分页。当前长图有两张或更多卡片时，拖动间距会即时更新当前页的画面和尺寸，松手后保存设置并刷新导出预览。预览显示原始选择条数、卡片数和 PNG 数，导出期间禁用设置。见[桌面导出接口](../desktop/preload.md#6-礼物导出任务与取消)。
- **今日盲盒盈亏与分析工作区刷新**：今日盲盒盈亏仅在礼物主页可见、面板展开且未打开分析工作区时读取汇总与前 10 位观众；隐藏时取消在途读取并保留刷新标记，恢复可见后补读一次，旧响应不能覆盖恢复后的结果。盲盒分析仅在工作区打开时响应收礼事件，将持续事件合并为每轮最多一次的 500ms 延迟刷新（事件不反复推迟已排定任务，已有读取先完成、期间的新事件在完成后补刷新）；手动筛选与翻页取消旧请求，关闭工作区停止刷新。观众和盲盒下拉仅在选项值、名称或顺序改变时重建。礼物来源变化或连接恢复时，两处立即清除旧结果并使旧请求失效，分析同步清除观众、盒型、日期和分页筛选（可见摘要与已打开分析重新读取，隐藏摘要待可见后补读，关闭的分析不主动请求）。

## 6. 组件与百宝箱

**组件与百宝箱导航**：

- [组件页面](../../../public/pages/admin/live-components/page.html)通过既有组装器组合各项设置面板：`#components` 默认选中弹幕姬；弹幕画面片段独立于百宝箱的发送、AI 与机器人回复片段。`createFeatureNavigation` 为组件页与百宝箱建立独立实例，分别用 `admin.liveComponentsSelectedFeature` 与 `admin.toolboxSelectedFeature` 记住选中项（旧百宝箱缓存若指向已迁移组件则回落到首个可用工具）。
- `toolbox-navigation.js` 仅负责功能导航（侧栏折叠、分组与子导航折叠、方向键/WAI-ARIA tab 模式、localStorage 记忆），[toolbox-selection-motion.js](../../../public/js/admin/toolbox-selection-motion.js) 负责桌面百宝箱侧栏的选中卡片弹性滑移与图标方向性变色协同；[shell-start.html](../../../public/pages/admin/toolbox/shell-start.html) 按互动娱乐、主播工具（分组 ID `streamer-work`）、应用支持三组呈现。桌面百宝箱侧栏共用一个带图标底槽的选中卡片，切换时按物理阻尼弹簧滑向目标行并随滑移抵达触发新旧 SVG 图标的同向扫色与微回弹（连续改选保留速度平滑转向，用户点击或方向键切入且启动弹簧动效时将右侧面板显隐延后一帧以优先提交合成器滑移，程序化选择及系统开启「减弱动态效果」或处于交互引导时同步直接定位）。
- **实时榜单**：由 `app.js` 在首次切到组件标签时按需加载 `admin/live-rankings.js`。[live-rankings-client.js](../../../public/js/admin/live-rankings-client.js) 合并管理页与画布预览的订阅，每 500ms 拉取一次管理快照；所有订阅退出后停止轮询，画布订阅同时受编辑页连接状态和榜单图层可见性约束。呈现、滚动与配置契约见[实时榜单](overlays.md#实时榜单)。
- **弹幕投票与观众评分**：分别由 `livePollFeature`、`liveRatingFeature` 承载，片段位于 `public/pages/admin/live-components/interactions.html`，由 `public/js/admin/interactions.js` 按需初始化一次。切换入口复用同一编辑器、外观草稿与状态订阅，保留两类表单的未提交内容；另一种互动占用会话时提示返回对应组件结束或关闭结果。共同文本校验与布局估算由 `shared/interaction-rules.js` 负责，同步代次由 `interaction-client.js` 负责，安全文本结果行由 `interaction-view.js` 负责；后台人数轮询随面板可见性启停，投票与评分进行中与小游戏互斥（结果可同时保留展示），完整展示规则见 [overlays.md](overlays.md#投票与评分-interactions)。

**礼物姬六个子页**：

- 礼物姬在组件页左侧作为默认展开的可折叠导航组，包含「全屏礼物感谢」「滚动礼物」「礼物许愿」「月底冲刺」「盲盒盈亏榜」「大航海感谢」六个独立面板（以及紧随许愿的「心动盲盒」菜单，见下），分别由 `otherGiftFeature`、`giftDisplayFeature`、`giftWishesFeature`、`giftSprintFeature`、`giftBlindboxFeature`、`guardThanksFeature` 承载。组名仅控制子导航展开，折叠保留当前内容；业务初始化分别由 [gift-assistant.js](../../../public/js/admin/gift-assistant.js)（滚动礼物、许愿、冲刺、心动盲盒）、`initGiftFrame()`、`initGuardThanks()` 与 `blindboxSettings.init()` 负责，许愿与心动盲盒的订阅/轮询按主页面与面板实际可见性启停。
- **全屏礼物感谢**：`#giftFramePanel`（`toolbox/gift.html`）以自适应两列卡片依次展示礼物掉落、礼物摇摇乐（标注「内置」）、已导入的林间花信（`#giftFrameSettings`）、其他导入样式（`gift-frame-styles.js`）及末位「添加样式」（`#giftFrameAddStyle`）。两张内置卡片顶部提供启用开关、预览与可点击复制的完整网址，参数区按卡片宽度排为 3/2/1 列（仅触发金额保留 88px 原生校验输入框，其余使用带 `output` 的共享参数滑块；掉落默认 30 个/1–100，停留默认 20 秒/1–30，摇摇乐三项显示勾选映射至 `giftSwingTextMode`），修改自动保存；导入的图片/视频开关与金额写入 `giftFrameStyleTriggers`，林间花信写入 `giftFrameEnabled`/`giftFrameThresholdRmb`，样式库挂载在 `#giftFrameStyleLibrary`（缩略图隐藏，按钮嵌入对应卡片）。
- **滚动礼物**：提供显示行数、滚动速度（1–50，线性对应每行 5–0.1 秒，默认 12）、浏览器源地址、共用词条价格配色和卡片外观（见[礼物横幅](overlays.md#16-本日礼物-gift-feed)）；草稿在切换分区时保留，保存后生效。
- **礼物许愿**：管理片段 `toolbox/gift-wishes.html`，`admin/gifts/wishes.js` 管理长效/本日/本场三周期增改删，`wish-picker.js` 复用在售/全库目录，`shared/gift-wish-card.js` 与叠加层共用展示。每条许愿可选「礼物卡片」「文字版」「圆形徽章」（月渡花汀在导入套装后作为画布样式使用）：
  - **文字版模板块**：将 `{图片}`、`{礼物}`、`{已收}`、`{目标}` 显示为不可拆开的中文内容块（默认「许愿{礼物}（{已收}/{目标}）」），支持插入按钮、即时预览、原生撤销/重做、整块删除、复制/剪切及纯文本粘贴（粘贴已知标记自动恢复块）；保留 `textTemplate` 与可选 `textRuns` 分段格式。与文本框共用 `admin/rich-text-toolbar.js`（字体、字号、粗斜下划线、颜色、描边、阴影，默认不描边），`shared/text-format.js` 与 `shared/text-style.js` 校验并复用样式。旧 `textImagePosition`（`before`/`after`/`inline`）由共享读取函数自动迁移为 `{图片}` 标记并在保存时清为 `none`；含图片标记时可选动态原图或静态 PNG（经 `shared/gift-image.js` 的 `setGiftArtwork` 渲染）。颜色依据服务端 `todayCount` 默认未收到雾蓝 `#3b6ea8`、已收到翠绿 `#21815c`，可分别自定义 `textPendingColor`/`textReceivedColor` 与选区局部设色。
- **心动盲盒**：片段 `live-components/heart-box-collection.html`、控制器 `admin/gifts/heart-box-collection.js`。显示本期日期、累计进度、固定奖励节点及刷新/复制/打开画布入口；右侧「本期累计」支持填入实际总数并点击「校准进度」（来源或周期过期时自动刷新回填，保存失败保留输入）。「背景样式」与「显示倍率和限开数量」自动保存并与画布及未指定 URL 覆盖的独立来源同步（渲染规则见[心动盲盒收集组件](overlays.md#心动盲盒收集组件)）。
- **月底冲刺与盲盒盈亏榜**：分属 `live-components/gift-sprint.html` 与 `live-components/blindbox.html`。「月底冲刺」由 `admin/gifts/sprint.js` 渲染 `giftSprint` 快照与文字预览（与投屏共用 `shared/gift-sprint-text.js`），直接编辑目标；「盲盒盈亏榜」配置见 §4.3。
- **大航海感谢**：独立面板位于 `toolbox/gift.html`，辉光与经典分别保存 `guardThanksAuroraEnabled/TextMode` 与 `guardThanksClassicEnabled/TextMode`（旧 `guardThanksStyle` 仅用于兼容未独立保存配置），支持预览等级与月数（1–999，经典另有昵称），预览传给画布复用或添加对应风格图层；已导入的大航海配套与图片/视频样式紧随两套内置设置排列，末位提供「＋ 添加样式」。

**加班机**：

- **控制台与规则保存**：加班机控制台以小时/分钟输入和一个主按钮完成开始、暂停、继续。加班状态变化或连接基线到达时更新倒计时起点，礼物检测状态单独刷新。`overtime.js` 在开始时先保存未提交规则，仅在初始时长改变或剩余时间为零时调用 `/api/overtime/time`，随后按需 `enable` 并 `start`；覆盖非零剩余时间前确认，任一步失败停止后续步骤。`overtime-time-view.js` 保留时间草稿，未编辑的已保存值保留秒精度。画布加班机在「实际倒计时 · 与客户端同步」模式下支持设置时长及启停（经 `component-preview-dialog.js` 受限 `control` 命令，`display.operation` 回传结果），示例模式只展示不操作。回归见 [frontend-overtime.test.js](../../../test/overtime/frontend-overtime.test.js)。
- **修订号防护与边界调度**：状态视图拒绝较旧 `revision`（修订号）的 HTTP 回执，外观保存不能把旧背景提升为新权威状态（仅计时推进且背景一致时允许成功并保留较新时钟，背景已被他处改动则提示冲突）；重连快照经 `STATE_LOADED.isConnectionSnapshot` 允许修订号重置，外观模块降代时使重置前保存失效并保留草稿（见 [overtime-appearance-order.test.js](../../../test/overtime/overtime-appearance-order.test.js)）。管理页与直播画面共用 `shared/overtime-time-format.js` 的格式化与 `nextClockDelay` 显示边界计算（普通按秒、天级按分钟、年级按小时单次调度，最短 25ms，暂停/归零/隐藏时不保留定时器，见 [overtime-status-view.test.js](../../../test/overtime/overtime-status-view.test.js)）。

**电音助手**：

- **入口与布局**：由 [audio-assistant.js](../../../public/js/admin/audio-assistant.js) 在 `app.js` 初始化一次，退出页面释放监听与尺寸观察。工具页 `otherAudioAssistantFeature` 顶部将顶部/侧边快捷入口按钮与主开关并排；左侧为来源与设备（「自动识别当前音乐」「本地文件」「麦克风、线路或声卡回送」「播放设备里的声音」，常见播放器以中文归组、同名按序号区分），右侧为声音参数与「重置声音参数」（一次 `configure` 恢复原唱 `strength 0`、1×、原调、输出音量 60% 并关闭原声对比）。全局入口共用 `audioAssistantPanel` 原生 popover（拖动贴左右边缘收成窄标签，本机偏好保存在 `admin.audioAssistant:v1`：`{ enabled, placement, x, y, dock }`，不同步服务器）。
- **状态同步、反馈与设备模式**：[audio-assistant-controls.js](../../../public/js/admin/audio-assistant-controls.js) 读取桌面统一会话状态，通过带编辑代次的串行写入保持完整面板与快捷面板双向同步。[audio-assistant-feedback.js](../../../public/js/admin/audio-assistant-feedback.js) 将已知设备、歌曲、组件和恢复异常映射为中文建议（共用 `audio-assistant-feedback` toast 原位更新，默认 10 秒；`recoveryDeferred=true` 时表示通道已还原、守护等待播放器，不弹恢复警告）。下拉框展开时通过 `lira-select-open` 触发合并刷新，仅内容变化时更新 select；原声通道仅在播放器模式展示，设备模式使用「当前来源」「处理声音」，默认关闭「音乐处理」。启动处理前，播放器输出模块会暂时锁定新通道切换，等待在途输出切换完成；本地文件与主进程确认的本实例内置播放支持倍速（由[播放域](playback.md#2-播放主流程)作用于源音频），处理经[受限音频 IPC](../desktop/preload.md#电音助手)。
- **内置播放器输出入口**：「设置 → 声音与通知」中的内置播放器输出分区由 [playback-output-settings.js](../../../public/js/admin/playback-output-settings.js) 渲染并订阅状态，设备枚举、切换保存及与电音助手的锁定协作由[播放域](playback.md#83-内置播放器输出)统一负责。

| 功能 | 模块 | 核心定位与数据源 |
| --- | --- | --- |
| 弹幕姬 / 弹幕互动 | [danmaku-tool.js](../../../public/js/admin/danmaku-tool.js) | 「组件 → 弹幕姬」管理本机组件与场景地址（旧服务器 `/overlay` 已退役）、过滤、样式库（[danmaku-style-library.js](../../../public/js/admin/danmaku-style-library.js)）、`/danmaku?preview=1` 本地预览及 `/api/danmaku/appearance` 保存（规则见[弹幕姬参考](overlays.md#61-弹幕姬)）；「百宝箱 → 弹幕互动」四分类与云端回复见下方[固定回复与云端词库](#固定回复与云端词库)；Admin 弹幕发送走 `/api/bilibili/danmaku/send`（Ctrl+Enter 快捷发送，超长自动拆条），状态来自 `/api/bilibili/danmaku/state` |
| 弹幕库编辑器 | [danmaku-libraries.js](../../../public/js/admin/danmaku-libraries.js) | 自定义精确回复与 DIY 关键词回复共用规则列表（加载/增删/修改标记/保存），云端签到/抽签词库由 `danmaku-daily-library.js` 维护 |
| AI 互动助手 | [ai-assistant-settings.js](../../../public/js/admin/ai-assistant-settings.js)、[ai-assistant-personas.js](../../../public/js/admin/ai-assistant-personas.js) | 模型配置与连接测试走 `/api/ai/config`、`status`、`models`、`test`（官方预设锁地址/协议，已保存密钥仅展示前缀掩码，见 [AI 密钥契约](../backend/ai.md)）；人格按 `providerPersonaIds` 按平台记忆，内置「通用人格」「小猫人格」（DeepSeek），预设管理用原生 dialog 显式保存（`/api/ai/personas/*`，JSON ≤ 64 KiB），联网与思考、天气/地点/路线工具分别独立开关 |
| 礼物姬 · 全屏礼物感谢 | [gift-frame.js](../../../public/js/admin/gift-frame.js) + [gift-frame-styles.js](../../../public/js/admin/gift-frame-styles.js) + [gift-motion-settings.js](../../../public/js/admin/gift-motion-settings.js) | 效果卡片管理、触发金额自动保存与画布预览（见上方「礼物姬六个子页」） |
| 礼物姬 · 大航海感谢 | [gift-guard-thanks.js](../../../public/js/admin/gift-guard-thanks.js) + [shared/guard-thanks-card.js](../../../public/js/shared/guard-thanks-card.js) | 辉光/经典双风格与导入样式设置、画布预览（见上方「礼物姬六个子页」） |
| 加班机 | [overtime.js](../../../public/js/admin/overtime.js) + `overtime-rule-editor/model/effect-editor.js` | 控制台、初始时间、礼物规则（固定时间/时间盲盒/文字展板）、背景、结算流水与 `/overtime?quality=low` 预览。多笔礼物触发的概览读取按最近成功请求的发起顺序更新结算流水。**往返保真约定**：从 `GET /api/overtime` 的 `limits` 读取服务端上限并保留服务端接受的超控件范围原值，未编辑时保留秒精度（详见 [overtime.md](../backend/overtime.md) §4） |
| 小游戏直播台 | [games.js](../../../public/js/admin/games.js) | 固定 `/games`（数字炸弹/五子棋/你画我猜单会话互斥，独立 `/wheel` 不互斥）；画猜支持 1–12 局、15–300 秒与 9 类×100 词题库，`GET /api/games/host-state` 私下提供题词与选词窗，控制拆为结束作画/公布答案/下一题；自动刷新失败在 `#gamesSessionStatus` 静默提示并重试 |
| 主播工作台 | [streamer-planner.js](../../../public/js/admin/streamer-planner.js) | 本机工作台（`admin.streamerWorkbench.v3`，兼容 v1/v2 迁移）：月历日程、备忘与待办。切换编辑的备忘时，类型或正文有改动就先确认。日程系统通知由 Electron 主进程调度（受「设置 → 声音与通知」控制）。存储与提醒同步分别由 `streamer-planner-storage.js`、`streamer-planner-reminders.js` 负责。日程写入成功后才更新已保存列表和系统提醒，失败可在编辑器重试或取消。页头与月历使用同一次刷新的本机日期，跨午夜点「今天」会一同更新。切换日期复用同一快照及其日程索引，工作台记录或粉丝投影变化后更新。仅编辑待办或备忘时可复用提醒签名，提醒同步失败后的重试、时区变化与过期时间仍单独核对 |
| 时钟 | [clock-card.js](../../../public/js/admin/clock-card.js) | 展示并复制固定 `/clock` 浏览器源地址，持久化样式/日期/秒数/12/24 小时制/16 字角标文案并用同页 iframe 即时预览 |
| 性能检测 | `metrics.js` | 见 §4.6 |
| 使用文档 / 系统与关于 | `usage-guide*.js` / [desktop.js](../../../public/js/desktop.js) | 目录锚点定位、阅读位置与上下章、截图原生 `<dialog>` 大图查看；软件更新检查/下载/安装与重启确认 |
| 首次启动引导 | [interactive-tour.js](../../../public/js/admin/interactive-tour.js) | 聚光灯首次启动引导与手动重看入口，完整流程与旧弹窗退役规则见 [interactive-tour.md](interactive-tour.md) |

### 音乐展示（直播歌词与歌曲信息）

- **导航与模块分工**：「组件 → 音乐展示」为可展开导航组，包含「直播歌词」（保留 `desktopLyricPage` 标识与 `#desktopLyricPage`/`#desktop-lyric`/`#lyrics` 兼容入口）与「歌曲信息」（`#now-playing` 直达），两个子页独立选择与记忆。整套歌词或播放器外观恢复默认前需确认，单组设置不增加确认；删除云端背景时明确其范围。
- **直播歌词编辑与预览**：[desktop-lyric.js](../../../public/js/admin/desktop-lyric.js) 组织基础／高级编辑页签和共用音乐跟随（宽窗口左设置、右预览上限 396px，窄窗口预览置顶）。高级分类编辑与自存搭配由 [advanced-lyric-editor.js](../../../public/js/admin/advanced-lyric-editor.js) 负责，按「搭配 / 编排 / 外观 / 动效」吸顶组织。自动保存复用 `component-config-controller.js`（500ms 防抖、`change` 立即提交、串行写入、跳过通用 `state-renderer.fillSettings`，竞争确认见 §7；恢复默认保留全民 K 歌歌词源设置）。[desktop-lyric-preview.js](../../../public/js/admin/desktop-lyric-preview.js) 使用实时歌词驱动 `desktopLyricRenderer`（不提供示例试播），随页签切换 `/lyrics?layer=basic` 与 `/lyrics?layer=advanced` 预览和复制地址（基础在管理页按 65% 字号显示，高级支持拖动定位与水平/垂直居中/重置）。
- **音乐跟随控件**：[lyric-source-controls.js](../../../public/js/admin/lyric-source-controls.js) 独立管理一级来源（「内置播放器 / 外部播放器 / 全民 K 歌」）、外部子选项（「智能 / QQ 音乐 / 网易云音乐」）及客户端检测/重检，不触发外观自动保存；选中全民 K 歌时展开智能匹配与首选歌词源设置。播放上报与服务端仲裁见 [playback.md](playback.md#3-歌词链路) 与[音乐服务 §13](../backend/music/services.md#13-歌词状态与时间轴lyric-statejs--lyric-timelinejs)。
- **歌曲信息**：通过 `createSceneExtraPreview` 与 `createNowPlayingRenderer` 分别提供唱片、歌名／歌手的设置、预览、「在画布中调整」与复制入口（「调整音乐来源」跳转同组歌词来源控件）。外观保存于本机 `nowPlayingAppearance`，画布各图层保留各自的 `nowPlayingPart`、样式身份与几何状态；保存默认唱片样式不批量改写已有图层。`now-playing-canvas-data.js` 复用管理页 `app:now-playing` 订阅，无曲目时仅画布预览展示示例。输出与接口见[歌曲信息](overlays.md#歌曲信息now-playing)与 [API §2.6](../backend/api.md#26-正在播放配置now-playing)。

### 6.2 统一画布与本机样式库

**入口、场景操作与工具栏**：

- **打开画布与场景管理**：客户端「组件」侧栏底部「打开画布」与「点歌 → 浏览器源 → 直播场景 → 编辑场景」由 `canvas-overlay-source.js` 统一绑定，调用 `openComponentPreview()` 打开已有画布。`component-preview-canvas-view.js` 协调文档模型、选中状态、撤销历史（含撤销/重做按钮与 `Ctrl+Y` / `Ctrl+Shift+Z`）、参数面板与发布；`component-preview-definitions.js` 中的 `createInitialPreviewItem` 定义初始尺寸、对齐与外观归属；`component-preview-layers.js` 负责底部图层条、操作菜单、焦点与拖拽生命周期（`component-preview-layer-drag.js` 仅临时重排节点，栏内松手才提交一次编辑），本身不维护可变文档。
- **预设与输出切换**：`component-preview-canvas-controller.js` 维护独立草稿控制器，`component-preview-presets.js` 在「⋯ / 场景操作」菜单提供新建、复制、仅保存与确认删除。编辑与输出为同一场景时仅显示一个名称，不同时同时显示编辑场景与当前输出；下拉弹层标记「当前输出」（通过 `--select-marker-display: none` 关闭竖条）。「放弃修改」确认后丢弃当前画布及相关组件未保存草稿；删除当前输出前明确确认，服务端原子切至剩余 ID 首项（无剩余则输出透明空画面并显示「暂无场景」）。除确认删除当前输出外，正式布局均由「保存并应用」切换；复制场景来源使用已发布画布尺寸，固定组件使用所属模块尺寸。`component-preview-canvas-output.js` 的地址框支持点击外部、Esc 或再次点击收起。
- **文本框工具栏**：顶部同排依次排列新建、独立圆角矩形标签（最小高 30px，普通按钮/下拉触发器 32px）与保存操作；「复制链接」位于下方文本框名称旁，按选中项 ID 生成独立组件地址（新建或复制须先保存并应用，复制成功后提示已发布尺寸）。
- **画布 toast 与参数校验**：浏览器画布在右上角复用 `shared/toast.js`（默认距顶 70px、右 24px，通过 `--toast-anchor-bottom` 随工具栏换行下移）。原生校验与弹幕自有校验失败显示简短字段名与原因，保存时展开参数并聚焦无效字段；无效的名称或几何输入不被其他更新回填，底部状态保留持续提示，同一错误在轮询时不重复弹出。

**共享外观、参数分组与资源样式面板**：

- **共享外观协同**：`scene-item-controller.js` 整合场景配置与各组件共享外观模块，`canvas-shared-appearance.js` 按组件与样式缓存公共草稿、合并轮询并串行保存本地修改。内置时钟、点歌板、弹幕、加班机的画布参数进入桌面控制器草稿，随「保存并应用」生效；其余由 `sharedAppearance` 管理的公共字段通过受限画布入口自动保存（发布流程会等待共享自动保存完成）。共享外观按组件及样式键合并拉取（键变化立即刷新并在在途请求结束后补读，纯几何/名称/排序变化不重置 750ms 间隔，无外部共享模块时停止轮询）；重复快照仍推进权威代次，防止过期响应覆盖最新状态。
- **参数分组与精度兼容**：画布顶部「位置与尺寸」可独立折叠；`scene-extra-parameter-layout.js` 为歌词、展示板、礼物、互动和开播组织语义分组（歌词常用组默认展开，普通直播歌词新建尺寸 960×360）。共享表单兼容百分比精度、900 字重、歌词两端对齐及 50ms 时间偏移；弹幕参数保留未确认输入，确认后同步另一端共享草稿。
- **资源样式设置与导入呈现**：导入弹幕资源的欢迎消息开关写入该样式的 `styleParameters`。即使首次设置，使用同一资源的图层也会读取相同的开关值。LIRA 配套资源样式在时钟、弹幕、许愿和点歌板选中后由 `component-resource-settings-panel.js` 展示原生参数、自动保存与模拟预览（样式变更或面板重显时核对，连续聚焦合并，相同列表保留卡片节点）；通过 `restrictResourceStyle` 限制套装预设可选样式。导入样式按用途呈现：按礼物事件播放的效果页（全屏礼物感谢、大航海感谢）将导入样式与内置效果并列为完整设置卡片/条目；仅选择外观的页面（时钟、弹幕、点歌板、礼物许愿、开播动画）以缩略图选择，选中后展示参数。

**添加组件、本机样式库、套装与素材管理**：

- **添加组件与导入权限**：画布「添加组件」按用途合并内置、单独导入和套装成员（`component-preview-picker.js` 按客户端组件顺序组织左栏，弹幕姬复用 `bindDanmakuStyleFilters` 组合筛选，添加时确定样式、右侧不切换样式）。`component-style-library.js` 的 `canImportComponentStyle` 统一控制新增入口：滚动礼物、礼物许愿、心动盲盒、月底冲刺和盲盒盈亏榜不显示「添加样式」与「更换样式 / 添加素材」；已有导入样式保留兼容。
- **导入与编辑**：`component-style-client.js` 在时钟、弹幕、全屏礼物感谢、大航海感谢与点歌板提供「＋ 添加样式」，浏览器源页提供「样式与套装」；`component-source-import.js` 在桌面端用 `pick-web` 自动收集 HTML/CSS 配套资源，浏览器画布通过「选择文件」或「更多设置 → 选择整个素材文件夹」上传。`component-style-editor.js` 支持上传前预览与内容区拖拽缩放，`component-style-inspector.js` 编辑普通媒体/CSS 实例参数；更换样式仅替换外观，锁定图层不可替换；独立样式 × 确认后仅移出库列表，不影响已有场景。
- **套装导入与素材管理弹窗**：套装导入先检查 ZIP（服务端核对包分类）并确认安装到本机库（不编辑场景）；画布「添加组件 → 套装」按已安装包分组并提供「更新套装」「删除套装」（规则见[存储合同](../backend/storage.md#本地组件样式库)与[套装指南](../../guides/component-style-packages.md)）。`component-library-manager.js` 在客户端「组件」导航底部与画布顶部统一提供「素材管理」弹窗（已导入素材、存储空间、备份与恢复分区，处理中禁用并行操作；画布经 `preset refresh` 请求桌面刷新列表，不获得管理凭据）。

**中继通信、舞台性能与释放**：

- **长轮询聚合与局部回填**：`component-preview-dialog.js` 订阅控制器、实际显示数据与房间大航海状态，变化时立即 `exchange`（空闲最长等 20 秒）；同一窗口的空闲 `exchange` 与同一网页的空闲 `read` 由 `component-preview-poll-batch.js` 聚合为单条等待请求，避免占满 HTTP/1 连接槽（旧中继回退桌面 200ms、网页 250ms/40ms）。`component-preview-remote.js` 仅在权威状态变化或待确认命令移除时通知；`component-preview-panel.js` 在焦点离开整个增强下拉或颜色弹窗关闭（`lira-color-edit-end`）后的微任务中读取最新乐观状态回填。
- **舞台几何与实时榜单滚轮**：`scene-editor-stage.js` 仅写入变化的图层几何、名称与 ARIA 属性，拖拽同帧合并、松手提交一次历史；`scene-document-model.js` 几何手势复用冻结外观，仅在 JSON 长度可能增长时执行完整 256 KiB UTF-8 校验；空白区左键先聚焦工作区提交当前输入再取消选择。实时榜单图层的滚轮按画布缩放换算后经 `component-preview-surface.js` 发 `component-preview:scroll`（不写场景、不触发几何手势）；投屏活动榜单 iframe 接收原生滚轮。
- **冲突自动解除与快速关闭**：重开画布若初始旧快照触发恢复冲突，客户端草稿追上缓存改动后自动解除冲突，仍有差异则要求明确选择。关闭或刷新画布时网页通过 keepalive `detach` 通知中继释放页面并停止轮询（按 `attachment` 隔离，客户端保留会话与草稿），再次打开时直接复用短链接而无需等待 2 秒 focus 超时。

### 固定回复与云端词库

「互动回复」和「欢迎答谢」的功能行分两行显示标题和摘要。标题旁的问号始终提供功能说明。有待处理状态时，问号右侧另显示红色三角，悬停或键盘聚焦可单独查看状态提示。签到、抽签的账号与同步问题显示在各自的三角提示中。

- **四分类与侧栏分页**：「百宝箱 → 弹幕互动」顶部保留连接状态，下方由 `danmaku-tabs.js` 按「互动回复」「欢迎答谢」「弹幕发送」「AI 助手」切换分类（不重新初始化业务模块或触发保存）。「互动回复」含完整匹配回复、关键词回复、签到、抽签、点歌与查询；「欢迎答谢」含进场欢迎、PK 播报与欢迎、礼物答谢、点赞／分享／关注感谢和昵称管理；「弹幕发送」含手动发送、自动钓鱼／打劫（一次 15 条，同按钮可停止后续发送，已发或发送中不撤回）与定时／随机弹幕。进入页面仅在已配置房间且监控开启时静默恢复连接；百宝箱设置提供 B 站设置跳转。`danmaku-fixed-replies.js` 以 `#otherDanmakuFeature` 为事件根管理功能行与右侧 `#danmakuFixedEditorDialog` 原生 dialog（点击外部、Esc 或关闭图标收起且保留草稿），[danmaku-editor-pagination.js](../../../public/js/admin/danmaku-editor-pagination.js) 按可用高度统一分页（昵称按服务端每批 20 人读取，批内按高度分页，缩放不请求服务器）。
- **进场欢迎、互动感谢与礼物答谢**：欢迎词库页「时段欢迎」在普通词库与北京时间 5 段×20 条分时段词库间切换（`danmaku-welcome-library.js` 独立保存各时段草稿，见[进场欢迎设置](../desktop/main.md#服务器进场欢迎设置)）。`danmaku-interaction-thanks.js` 在「欢迎答谢」管理点赞、分享、关注三项开关与独立词库（每类上限 30 条、每条 120 字，独立防抖自动保存）。`danmaku-gift-thanks.js` 在「欢迎答谢 → 礼物答谢」管理开关与文案库（礼物页仅留跳转）：`gift-thanks-library.js` 负责礼物/舰长/提督/总督场景切换与普通／@ 选择，`gift-thanks-text-editor.js` 负责纯文本与原子中文参数块编辑，校验与分段共用 `shared/gift-thanks-templates.js`。
- **云端精确回复、定时弹幕与查询回复**：`danmaku-cloud-replies.js` 管理精确回复（首行只读展示内置「菜单」触发词与固定正文）与定时／随机弹幕的云端设置（见[桌面固定回复设置](../desktop/main.md#服务器固定回复设置)）；定时编辑器在停止修改 600ms 后自动保存间隔模式、秒数、选词与词库（未保存时读服务器内置 199 句 B 站文案，上限 300 条，旧客户端上限 100 条），`danmaku-scheduled-library.js` 提供跨页草稿与搜索分页。查询回复由 `danmaku-query-replies.js` 展示三类共 12 行只读指令（具体月份合并为 `x月` 与 `2026年x月` 示例），`gifts/interaction-controls.js` 在「互动回复 → 查询回复」管理 `giftStatsQueryEnabled` 开关。「刷新云端状态」同时读取签到/抽签、欢迎、PK、查询/答谢和两项新云配置；关键词和点歌回复要求客户端在线（开关代表本地设置，未登录仍可编辑；`canSend` 仅控制手动发送与自动钓鱼／打劫），签到/抽签/昵称/礼物答谢全天可用，其余直播回复与互动感谢仅直播中生效。`danmaku-libraries.js` 在无未保存修改或保存中时跳过相同原始输入，保留现有行节点。
- **云端签到与抽签**：由 `public/js/admin/danmaku-daily-bots.js` 独立初始化（不读取本地 `canSend`），`danmaku-daily-library.js` 为两项共用词库编辑器（`toolbox/danmaku-daily-library.html`），按实际行高自动分页。搜索与翻页在本地完成，编辑先更新草稿，通过校验后自动保存当前词库。主进程按当前授权上下文条件缓存；渲染进程保留会话草稿，关闭页面或切换账号时清空草稿并隔离晚到响应。授权快照为 `authorized` 且含账号名即读取云端设置（不要求 `songPageUrl`）。

### 周表生成器

正常退出桌面应用时，已打开的周表编辑器立即保存待写修改，跳过平时的 300ms 防抖。若同一版本已在写入，编辑器等待该 IndexedDB 事务提交。等待期间又有修改时，编辑器继续保存最新版本，再向播放器的退出处理器报告结果。见[桌面关闭时序](../desktop/main.md#7-关闭序列与播放状态冲刷)。

入口为「百宝箱 → 主播工具 → 周表生成器」，`otherWeeklyScheduleFeature` 由 toolbox 按需加载 [weekly-schedule.js](../../../public/js/admin/weekly-schedule.js)。[editor.js](../../../public/js/admin/weekly-schedule/editor.js) 负责编辑与保存状态、异步素材代次和预览；[model.js](../../../public/js/admin/weekly-schedule/model.js) 统一字段、日期和模板操作；[renderer.js](../../../public/js/admin/weekly-schedule/renderer.js) 与 [weekly-schedule-art.css](../../../public/css/admin/toolbox/weekly-schedule-art.css) 为编辑器和内部导出页提供同一 1920×1080 成品画布。

十种版式为活页手账、星夜来信、复古放送单、横向七日表、杂志封面、国风卷轴、留白刊物、花笺信札、午夜剧场、晴窗画廊，通过几何示意卡选择（不自动覆盖配色、字体或底纹）。编辑区分为外观、排期、素材、模块（页签支持方向键与 Home/End），共用七天主题/备注/双时段、休息/活动标记、周一日期、三种星期写法、标题/主播名、二十套配色与自定义实色、十一内置图标及自定义图标；日期框在编辑时保留正在输入的日号，离开后显示该周的周一。「将周一时间应用整周」确认后只复制两个时间字段。立绘、Q 版、Logo、背景、二维码、三张榜单头像和自定义图标上传后存于模板，点选画布或「正在调整」可按 1920×1080 像素坐标调整；[image-interaction.js](../../../public/js/admin/weekly-schedule/image-interaction.js) 负责画布点选、拖动、等比缩放、旋转与方向键微调（1px / Shift 10px）。「大屏编辑」将同一编辑器提升至 popover 层（需要共享确认框时暂退 popover 层，结束后恢复大屏与焦点）。

| 参数 | 范围 / 默认值 |
| --- | --- |
| 立绘、Logo、Q 版、二维码、头像、自定义图标 | 大小 10–400%（100%）、x ±1920 / y ±1080（0）、旋转 ±180°（0）、不透明度 0–100%（100%）；均可水平翻转，立绘另有贴纸白边 |
| 立绘贴纸白边 | 开启后显示描边厚度滑块与数值输入，1–30px（7px）；关闭保留厚度，预览和导出共用渲染 |
| 背景图 | 铺满裁切/完整显示（铺满）；水平/垂直焦点 0–100%（50%）；不透明度 0–100%（100%）；模糊 0–24px（0）；大小/旋转/翻转与其他图片相同，像素位移 `offsetX`/`offsetY` 为 ±1920/±1080（0） |
| 每张图片的光影与色彩 | 亮度/对比度/饱和度 0–200%（100%）；阴影/柔光 0–100%（0），各槽位独立；二维码调整后需实际扫码确认 |
| 相对字号 | 标题 50–150%、主题/备注/时间 70–160%；默认 100% 为各版式推荐大小，受空间适配限制 |
| 本机字体 | 模板保存、重新打开和 PNG 导出使用所选字体名，保留 `M+ 1p` 等名称中的加号 |
| 背景花纹 | 纯色、格纹、波点、方格、小爱心、斜纹、菱格、织纹、细条、扇弧、圆环、柔光；浓度 0–100%（100%）；上传背景图时替代花纹 |

留言、前三名（手动展示，不计算 B 站排名）、二维码、福利四模块支持独立开关与重排；预览和导出均不显示 LIRA 署名水印（旧 `showCredit` 保留兼容）。[storage.js](../../../public/js/admin/weekly-schedule/storage.js) 在本机 IndexedDB `lira.weeklySchedule`（v1，`state`/`current`）按顺序事务保存 `{version: 1, activeId, templates}`（编辑后 300ms 自动保存，独立于后端与月历工作台）。[assets.js](../../../public/js/admin/weekly-schedule/assets.js) 接受 PNG/JPEG/WebP（单张 ≤ 12 MiB、每模板 ≤ 48 MiB、最大边 8192、总像素 ≤ 33,554,432；静态 SVG 仅限自定义图标，检查后转 PNG）；周表站酷小薇为本地打包的[完整 OFL 字体](../../../public/fonts/weekly-schedule/README.md)，颜色控件用 `data-color-alpha="false"` 仅存 RGB。异步图片绑定模板与槽位代次防串图；PNG 导出在点击时冻结模板，桌面导出边界见 [preload](../desktop/preload.md) 与[主进程](../desktop/main.md#周表-png-导出)。

### 世界地图

扩展城市目录加载失败时，基础城市仍显示时间并整点更新天气。已保存的扩展城市 ID 和顺序会保留，目录恢复后用于还原城市和天气。在其他面板等待目录载入后，返回世界地图即补齐卡片与地球标记。城市时钟每秒只为可见卡片和打开的详情计算时间。键盘聚焦城市按钮时，读屏可读出定位操作、城市、当地时间、日期及天气。

- **模块与离线城市目录**：入口为「百宝箱 → 主播工具 → 世界地图」，[world-clock.html](../../../public/pages/admin/toolbox/world-clock.html) 由 Admin 组装器组合；[world-clock/index.js](../../../public/js/admin/world-clock/index.js) 在启动时初始化，负责已选城市、添加/移除、筛选、12/24 小时切换与唯一计时器；[city-picker.js](../../../public/js/admin/world-clock/city-picker.js) 负责添加城市弹窗的搜索、每批 100 项分页与分钟显示（弹窗高上限 480px，结果区上限 280px）。启动用 [base-cities.js](../../../public/js/admin/world-clock/base-cities.js) 的小城市表恢复天气任务。保存了扩展城市时启动读取完整目录，否则在面板首次显示时读取；地球也在首次显示时加载。默认 7 城为北京、新加坡、东京、伦敦、洛杉矶、达拉斯、纽约；[cities.js](../../../public/js/admin/world-clock/cities.js) 与 [city-catalog.js](../../../public/js/admin/world-clock/city-catalog.js) 提供 6,442 座离线城市（整合 Natural Earth `ca96624a56bd078437bca8184e78163e5039ad19` 与 GeoNames 2026-10-21 导出，校正布拉格 `Europe/Prague`、澳门 `Asia/Macau`、怀唐伊 `Pacific/Chatham`，中国大陆新增城市统一用北京时间；更新脚本为 `scripts/generate-world-clock-cities.js`）。
- **时区、右键菜单与拖拽排序**：[time.js](../../../public/js/admin/world-clock/time.js) 基于运行时 IANA 时区自动处理夏令时（达拉斯用 `America/Chicago`，日期差以北京时间为基准）。右键卡片或聚焦后按 `Shift+F10` 打开原生 Popover 菜单移除城市。本机偏好保存在 `localStorage.admin.worldClock`（`ids`、`format`、`selectedId`、`customOrder`）。未自定义顺序时按当前 UTC 偏移自动排序；[city-drag.js](../../../public/js/admin/world-clock/city-drag.js) 支持移动 5px 开始拖动（减弱动态效果时取消让位动画）及 `Alt+↑/↓` 键盘排序，首次调整后置 `customOrder: true`。
- **天气刷新**：[temperature.js](../../../public/js/admin/world-clock/temperature.js) 经[世界时钟温度](../backend/api.md#25-世界时钟温度world-clock)管理天气请求：软件启动立即刷新一次，此后按电脑本地时区的整点在后台刷新（例如在加尔各答 08:50 启动，下次为 09:00）。每批并发 2 个，在途批次不重叠，切页/筛选不触发，仅 `pagehide` 销毁时取消。后台结果写入城市缓存，显示时补齐，单城更新只刷新对应行。失败不弹 toast，保留旧值并标 `*`；无温度显示 `—°C`。
- **WebGL 地球与可见性节能**：[globe.js](../../../public/js/admin/world-clock/globe.js) 负责透明背景 WebGL 地球（缩放 0.75–3×，优先 8192×4096 日图，GPU 纹理边长不足或高清日图加载失败时使用随包的 2048×1024 日图，夜图单独加载一次，启用 mipmap 三线性与最高 8× 各向异性过滤，[影像来源](../../../public/img/admin/world-clock/README.md)）、城市标记防遮挡标注、CSS 锚点详情卡（点击右侧标记打开，Esc 或关闭收起）与本地 `stars.svg` 独立星空层。仅在功能面板、百宝箱主页面与文档均可见时每秒更新时间，连续尺寸变化（如侧栏收放）期间通过 CSS 像素比例映射保持球体与标记精准对齐并防抖重建 WebGL 帧缓冲，离屏/失焦/弹窗打开时暂停星空与地球重绘，`pagehide` 释放定时器与 GPU 资源；减弱动态效果时直接完成定位并保留静态星空。

### 6.1 PK 算分

入口为「百宝箱 → 互动娱乐 → PK 算分」，副文案为「按 PK 分或金额换算」。[pk-score-calculator.html](../../../public/pages/admin/toolbox/pk-score-calculator.html) 由 Admin 组装器组合，[pk-score-calculator.js](../../../public/js/admin/pk-score-calculator.js) 按需初始化，[pk-score-calculator.css](../../../public/css/admin/toolbox/pk-score-calculator.css) 负责局部样式。切换模式保留各自输入，试算仅存于本页并在关闭后清空。

- **按 PK 分**（默认）：输入非负整数目标，显示最低金额、所需整电池和实际可得加分；所需电池按 `目标加分 × 50 ÷ 首胜倍率 ÷ 活动倍率 ÷ 时段倍率` 向上取整。
- **按金额**：人民币预算支持到分，可原样粘贴计算器显示的 `2,500.00`。英文逗号按每三位一组校验。按 `1 元 = 10 电池` 向下取整到电池，显示可得主播加分、可用电池与 PK 条得分。

默认非首胜、双倍时段开启、「逐胜加冕」关闭。PK 条得分 = 电池数 × 时段倍率（普通 1，双倍 2）；主播加分按 `PK 条得分 ÷ 50 × 首胜倍率 × 活动倍率` 向下取整（首胜 2×、活动手动启用 1.10×，未启用取 1）。例如三项均开启时，100.00 元对应 1000 电池、2000 PK 条分和 88 主播加分，反推 88 分至少需要 100.00 元。未输入时，三项结果各自在数值位置显示对应图标。输入有效数值（含 0）后，数字在原位替换图标。数值无效或超出安全整数范围时，恢复占位图标并在输入框下提示修正。

## 7. 设置持久化流程

```
表单 input/change → 所属表单草稿 → 显式保存或表单约定的自动保存 → POST /api/settings
   ↑                                                       │
   │                        settings-store 写库（见 storage.md §7）
   └── WS snapshot（settings 字段）回推 → 所属控制器合并 → 表单呈现
```

- **通用设置与草稿保护**：服务端持久化设置键经 `/api/settings` 提交（定义见 [api.md](../backend/api.md)，默认键见 [storage.md](../backend/storage.md) §7）；AI 配置等含密钥设置走独立表（见 [storage.md](../backend/storage.md) §3.1 `ai_configuration`）。有草稿的表单由所属控制器区分已保存值与本地编辑，快照不直接覆盖未保存修改；房间号输入沿用 `data-preserve-dirty`，仅在当前值仍等于本次提交时解除保护。`state-renderer.fillSettings` 跳过有专属控制器的表单，并将 `.range-row`、`.lira-select` 视为逻辑编辑控件，焦点在其内时不回写整组。
- **`component-config-controller.js` 竞争确认机制**：组件设置统一按字段编辑代次保留保存期间的新修改（含改回原值），串行写入并合并快照中的未编辑字段。保存期间若收到与 HTTP 回执不一致的权威快照，控制器经 `confirm`（默认复用 `read`）补读确认，不按通道抵达顺序盲目覆盖；点歌板、歌单板与时钟的确认适配器共用 `StateService.reloadState()` 排序（被后继读取取代时等待后继结果）。正常保存和自身广播回声不增加确认请求；若提交字段已被后续写入覆盖，则保留最新配置、返回 `false` 并提示确认，不误报「已应用」。
- **各表单保存节奏**。歌单板和礼物动效卡片为 180ms，周表生成器为 300ms，点歌规则和直播歌词为 500ms，日常设置、点歌板主题和定时弹幕为 600ms。共享 `createAutosave` 的 `delay` 默认 600ms，点歌规则传入 500ms 并在输入法组词结束后调度。AI 互动助手为 700ms，仅在编辑代次仍匹配时解除草稿保护。账号登录页提交时保存。[settings-autosave.js](../../../public/js/admin/settings-autosave.js)
- **跨模块请求代次与清空恢复**：
  - `games.js` 将数字炸弹、五子棋与画猜的开始/结束统一纳入会话请求代次（不回退更高 `eventRevision`）；`games-draw-admin.js` 通过入口注入的 `startSession` 开局，私有题词读取按代次与会话/局次/阶段过滤，读取后仅在原会话仍处于该轮选词阶段时提示选词；`games-wheel.js` 在 WS 重连时补读独立转盘状态并按代次保护转动回执；[games-word-picker.js](../../../public/js/admin/games-word-picker.js) 仅负责选词 dialog 交互。
  - 数字炸弹和五子棋决出结果后，管理页显示胜方或和棋，主播仍可结束当前会话。进入新的画猜会话时展开主持卡片，同一会话内保留主播的展开或收起选择。添加转盘选项时保留已有输入，只给新行填写默认份数。
  - [ai-model-picker.js](../../../public/js/admin/ai-model-picker.js) 维护查询代次、服务签名与原生 Popover 模型菜单（复用 `select-menu-position.js`）；服务字段或账号变化时使旧请求失效。
  - `danmaku-tool.js` 发送成功只清除仍与本次提交一致的草稿，发送状态仅接受最新读取代次；输入框使用 `field-sizing: content` 自动增高，超过 40 字自动分段发送。
  - `settings-operations.js` 在清空全部发生部分提交时，按数据库提交、运行状态刷新和恢复写入三阶段列出结果：本机音乐缓存或播放副本清理失败时保留当前页并列出失败项，其余部分提交确认后重载；礼物导入和加班写入继续暂停，后端边界见[存储合同](../backend/storage.md#61-clear-all-matrix清空全部矩阵)。

## 8. 播放助手页(playbackAssistantPage)

见 [playback.md](playback.md)：播放器面板（默认收起 dock）、快捷入口、WeSing 歌词现场面板、在线搜索、点歌匹配诊断区由 `playback/*` 渲染，桥接方式见 §3.2 的 `initPlaybackAssistant` 注入。

## 9. 子页面:gift-audit.html

| 页面 | 用途 | 数据源 |
| --- | --- | --- |
| [gift-audit.html](../../../public/pages/gift-audit.html) | **气泡 × WebSocket 交叉对比审计**：粘贴直播间气泡 HTML，读取本地状态及 WS 快照中的近期礼物缓存，比较一致、缺失与多出的记录；支持捕获时间与事件详情，不重放或手动投递业务事件 | WS `/ws` + `GET /api/state`（基线） |

该页面是保留在源码中的旧诊断工具，HTML、CSS 与 ES Module 脚本均不分发到安装包；它未接入当前桌面管理窗口的授权导航、API/WS 凭据注入与正式入口。源码运行时未经授权访问 `/pages/gift-audit.html` 返回 401，即使取得页面，API/WS 仍需各自有效凭据，不能作为当前可用的主播排查操作（见 [pages.md](pages.md) §2）。在专用授权测试上下文中仍可用于历史诊断验证；页面隐藏时停止 WebSocket 重连与 5 秒兜底轮询并关闭连接。来源切换时旧缓存未按 `gifts.viewRevision` 隔离；诊断比较捕获提交时的 HTML、采集时间与操作代次，清空或再次比较后忽略过期响应。

## 10. 共享字体与资源下载

- **资源下载进度与设置页任务区**：
  - [gifts/catalog-update-toast.js](../../../public/js/admin/gifts/catalog-update-toast.js) 经 [resource-downloads.js](../../../public/js/admin/resource-downloads.js) 初始化，订阅授权目录进度桥，以单条 toast 原位显示后续礼物图片下载的开始、已处理数量、完成或失败（首次初始化、检查和零下载静默，完成后自动移除，进度字段见 [desktop/preload.md](../desktop/preload.md)）。
  - [font-library-toast.js](../../../public/js/admin/font-library-toast.js) 订阅公共资源状态，以独立 key `font-library-update` 原位更新字体与大图的字节进度，与礼物图片 toast 同时堆叠（失败提供「重试」）。
  - `resource-downloads.js` 在「百宝箱 → 设置 → 系统与关于」版本更新区下方展示「资源下载任务」：字体与公共图片合为一行（按已接收字节数算进度、按字体包或图片数统计完成数并保留当前文件名），礼物图片独立一行（按文件数算进度），仅当公共资源处于下载中（`downloading`）或礼物处于图片同步阶段（`running`/`updating` 且阶段为 `images`）时显示；总数未知时显示不定进度与「准备下载」，完成或失败后隐藏对应行。音频组件另列一行（可重试失败显示「重试」，无授权/不支持/已关闭时隐藏）。无可见任务时隐藏整个区域。首次准备页的 [license-resource-downloads.js](../../../public/js/license-resource-downloads.js) 通过 `showToast: false` 复用同一订阅在页内展示进度（主进度标为「直播数据」），不弹 toast 且不阻塞进入管理页。关闭页面清理订阅但不取消主进程下载。
- **共享字体加载与浏览器源等待**：
  - [font-library-loader.js](../../../public/js/shared/font-library-loader.js) 负责刷新共享字体样式（只发布已就绪字体，首次大图可等待后台下载，共享字库无需本机字体授权）。首次登录前打开的浏览器源会等待本机字体库开始初始化。下载期间按进度刷新，失败后等待桌面重试，就绪后停止查询。见[HTTP 共享字体资源](../backend/api.md#共享字体资源)。
  - [font-library.js](../../../public/js/shared/font-library.js) 只将已发布且通过 `document.fonts.load` 完成菜单预览字形解码的本地字体加入共享选项；已保存但未就绪的字体保留原值并显示「未就绪」禁用占位，就绪后原位恢复。已注册选择器共享 FontFace 加载结果，每次刷新仅遍历一次清单并按字体族分组；样式加载成功后直接调用 `refreshSharedFonts()` 刷新已注册菜单（保持预览模块独立于管理页事件总线，过期加载不覆盖较新状态）。loader 区分已应用与在途签名，状态读取与 CSS 暂时失败分别最多自动退避重试三次；调用 `dispose` 时取消待重试任务并忽略过期回执，菜单刷新不派发用户 `change` 事件。
  - `registerFontSelect(select)` 默认提供全部可用的软件字体和本机字体。单个菜单可以传 `{ allowedFonts: { shared: ['maiyuan', 'wenkai'], local: ['Microsoft YaHei'] } }`。`shared` 使用共享目录 ID，`local` 使用已安装的字体族名，忽略大小写。传入清单时，省略或留空的来源提供零项。只列软件字体的菜单会跳过本机字体查询。原生「默认」「继承」等模式由页面提供。超出清单的已保存字体仍显示在当前值上，菜单只提供清单内的字体供重新选择。
  - 周表通过 `{ keepProvidedFonts: true }` 在完整字体库旁保留页面提供的专用字体，例如站酷小薇。同时指定 `allowedFonts` 时，以清单为准。「默认」「继承」等页面模式始终保留。属于共享目录的选项统一按资源就绪状态生成。点歌板、展示板、歌词和画布按已保存的值解析旧字体栈与名称。
- **本机字体统一枚举**：[shared/local-font-library.js](../../../public/js/shared/local-font-library.js) 统一执行 `queryLocalFonts()`、净化、去重并分发本机字体族（当 Chromium 要求瞬时用户激活时，在用户正常点击或按键后重试，权限边界见 [desktop/main.md](../desktop/main.md#4-主窗口)）；点歌板风格 3–6、直播歌词与大播放器共用同一查询，`admin/local-font-library.js` 保留兼容再导出。资产目录见[静态资源](pages.md#6-静态资源)。
