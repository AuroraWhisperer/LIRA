# OBS 悬浮层(overlays/)

> 涉及文件:[pages/overlays/queue.html](../../../public/pages/overlays/queue.html)、[pages/overlays/songs.html](../../../public/pages/overlays/songs.html)、[pages/overlays/blindbox.html](../../../public/pages/overlays/blindbox.html)、[pages/overlays/overtime.html](../../../public/pages/overlays/overtime.html)、[pages/overlays/lyric-window.html](../../../public/pages/overlays/lyric-window.html)、[pages/overlays/opening.html](../../../public/pages/overlays/opening.html)、[js/overlays/](../../../public/js/overlays/)、[css/overlays/](../../../public/css/overlays/)

本文档描述各个叠加层页面的框架、数据消费与各自 UI。快照字段与消息类型见 [ws.md](../backend/ws.md),客户端通信行为见 [comms.md](comms.md),页面入口 URL 见 [pages.md](pages.md) §2,加班机领域状态见 [backend/overtime.md](../backend/overtime.md)。

### Overlay 模块边界

| 门面/入口         | 内部模块                                                                       | 所有权边界                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `queue-render.js` | `queue-theme.js`                                                               | render 拥有队列 DOM；theme 只映射设置到 CSS 变量并由 render 兼容再导出                                          |
| `gift-effects.js` | `gift-effects-frame.js`                                                        | 入口拥有 WebSocket、去重、队列和装饰粒子；frame controller 只拥有边框 DOM/WAAPI 时间线                          |
| `games.js`        | `games-drawing.js` / `games-drawing-geometry.js` / `games-drawing-controls.js` | 入口拥有游戏会话和通用结果；drawing 拥有画板同步，geometry 是纯形状/颜色计算，controls 只适配画板启停与撤销状态 |

这些模块均由页面以 ES Module 加载；内部模块不得自行创建第二条 WebSocket 连接或重复持有会话状态。

## 1. 悬浮层框架

### 1.0 本地页面权限与数据投影

本地展示页面各有独立的 `overlay` 身份，不能调用其他页面或管理端的接口。固定页面地址仍可作为 OBS 浏览器源打开；服务端只在该页 HTML 中注入本次运行的页面凭据，管理凭据不进入 HTML。`songlist` 对应 `songs.html`，`lyrics` 对应 `lyric-window.html`，其余 scope 与同名 HTML 对应。`/pages/overlays/<文件名>` 原始地址和 `/<scope>` 使用相同权限与响应头；`/songs` 仍是管理入口。

签发及精确路径/方法白名单由 [access-policy.js](../../../src/server/access-policy.js) 拥有，受限操作由 [overlay-http.js](../../../src/server/overlay-http.js) 适配。REST、初始快照、合并快照及所有 WS JSON 出口统一经过 [overlay-projection.js](../../../src/server/overlay-projection.js)。投影逐层选取已列出的标量、对象及数组字段；新增 owner 字段和新增设置不会自动对展示页开放，不能直接展开整个 `state` 或 `settings`。管理请求保留原 DTO。

所有页面允许 `GET /api/state` 作为凭据恢复探测，但只返回下表中的本页投影；无快照消费者的页面得到空对象，不据此向全局快照加入游戏或转盘。表中 GET/POST 路径均省略 `/api` 前缀，头像代理仅开放给实际展示头像的四页。

| Scope | 专用 HTTP 读取与允许操作 | 快照字段与专用 WS 消息 |
|---|---|---|
| `queue` | 无 | `queue.current/waiting` 的歌名、请求者显示名、置顶与大航海/灯牌展示字段；`superChats.message/price`；本页主题设置 |
| `songlist` | GET `/songs`，服务端固定 `enabledOnly: true`，保留分类筛选 | 本页歌单主题设置；歌曲仅 `id/name/artist/category_name/language/name_initial` |
| `blindbox` | GET `/gifts/blind-box-stats`，保留 `boxName` 筛选 | 本页主题设置；统计仅盒数、总成本、总盈亏及榜单显示名/盒数/盈亏 |
| `overtime` | 无 | `overtime` 的 revision、状态、服务端时间、有效余时、背景与展示规则；`overtime:update` 的同一状态及结算动画字段 |
| `gift-effects` | 无 | `giftEffectDanmakuEnabled/giftFrameMotionMode`；`gift:frame` 的礼物铭牌/主题/动效字段，`gift:effect` 的播放 URL 与 RGB/alpha 布局 |
| `gift-feed` | GET `/gifts/display-settings`、`/gifts/history`、`/gifts/card-profiles`、`/overtime/gifts/catalog`、`/bilibili/avatar` | `gifts.viewRevision` 与刷新 reason；`gift-catalog:update` 仅为失效通知，不附完整目录 |
| `gift-export` | GET `/bilibili/avatar` | 无业务快照或专用消息；导出行、配置和目录由 Electron main 的冻结输入提供，不授予流水选择或导出 IPC 权限 |
| `lyrics` | 无 | 本页歌词设置、`lyricState/lyricTimeline`；`lyric-state/lyric-timeline` 仅含曲名/艺人、行词文本与时间、播放/排序状态 |
| `games` | GET `/games/session`、`/games/winner-profile`、`/bilibili/avatar`；POST `/games/session` 仅 `stop/restart`，`/games/session/move` 仅数字/坐标字符串，`/games/session/draw` 仅 `append/undo/clear` | `game:update` 的公开游戏态、`game:draw` 的画笔操作；兼容已存在的 `state.games`，不新增全局字段 |
| `danmaku` | GET `/bilibili/avatar` | `danmakuFeed`、`liveStatus.enabled/roomId/connected/message`、`danmakuOverlayStyle/danmakuFullscreenDurationSeconds`；`danmaku:message` 仅展示消息、身份、头像与表情字段 |
| `wheel` | GET `/wheel`；POST `/wheel/spin` | `wheel:update`；仅候选标签/权重、抽取时序/索引及上次结果索引 |
| `opening` | GET `/opening/config` | 无；配置仅启用、文案、画质/轨道/音符/均衡器、音频开关/音量及当前音频/人物图 URL |
| `clock` | GET `/clock/config` | 无；仅 `style/showDate/showSeconds/hourFormat/label` |

本日礼物的服务端读取固定北京时间今天、每页 100 条、按创建时间升序；页面只能传分页 cursor 和 viewRevision，不能扩大日期、来源或筛选范围。返回仅保留 `viewRevision/nextCursor/partial`，以及横幅需要的 `eventId/artworkPath` 和礼物显示名、礼物 ID/变体、币种、单价、数量、头像、大航海等级。目录仅保留礼物 ID/名称/变体和本地图片路径，不暴露来源配置、同步状态或完整流水元数据。

游戏投影按游戏类型逐字段选择。数字炸弹的隐藏数字、你画我猜的未揭晓词条/别名和管理态不对展示页开放；只有领域状态已经 `answerRevealed: true` 才传递 `revealedAnswer`。公开弹幕保留观众实际发送的文本。落子不能携带对象形式的主持控制指令，开始/配置游戏和转盘、提前揭晓/切换题目仍属于管理端。

设置字段表以投影模块中的显式键为准，并覆盖共享消费者：队列保留通用主题、序号/置顶/六条规则及各风格字体和滚动键；`storybookQueue`、`neonVinylQueue`、`cherryRibbonQueue`、`goldenLilyQueue` 仅允许 `FontSize/FontFamily/FontWeight/UseCustomTextColor/TextColor/ScrollMode/ScrollSpeed` 七个已消费后缀，旧 `illustratedQueue*` 仅保留现有兼容回退键。歌单保留独立 `songBoard` 设置及共享主题回退键，盲盒保留自身标题与通用主题，歌词保留 `DESKTOP_LYRIC_DEFAULTS` 对应的 51 个展示键。不得将任意同前缀的新键视为已授权。

每个 overlay HTML 响应都使用 `Content-Security-Policy: sandbox allow-scripts`，不允许 `allow-same-origin`；直接打开和嵌入管理预览都处于 opaque origin，不能访问父 frame 的 DOM、fetch 或凭据。预览父页通过 `postMessage(..., '*')` 发送展示配置，子页核对 `event.source === parent` 及管理页服务 origin；当前 overlay 与共享渲染器不依赖 localStorage、sessionStorage 或 IndexedDB。

静态脚本、样式、字体和图片可跨 opaque origin 加载，HTML 不开放 CORS 读取。API 只为允许的页面路径/方法接受 `Origin: null`，实际请求仍验证页面凭据；预检不授予身份或管理权限。引导脚本只给同一服务的 `/api/` 和 `/ws` 附加本页凭据，401 或 WS 关闭后最多合并一次 `/api/state` 探测，确认旧凭据失效才重新加载页面。`topic=danmaku` 只缩小订阅，不能扩展 scope；overlay 的 WS 文本/二进制业务入站帧关闭为 1008，正常 ping/pong/close 保留。`shutdown` 对所有 scope 仅包含类型和原因。

### 1.1 通用模式

所有叠加层:

- **透明背景**:`html,body` 透明(`overlays/base.css`),只渲染卡片面板,供 OBS 浏览器源叠加;加班机层独立样式(整屏倒计时)。
- **状态获取**:队列、歌单、盲盒、加班机等快照消费者先 `fetch('/api/state')` 拿首帧快照,再连 `/ws` 收后续快照;WS 断开时按指数退避重连,重连前再次 `loadState()` 兜底(见 [comms.md](comms.md) §3)。
- **字体**:中文字体栈 `Microsoft YaHei / PingFang SC` + 多语言回退(`overlay-utils.js` 的 `multilingualFontFallback`);队列/歌单板经 CSS 变量 `--overlay-font-family` 由管理页设置注入,加班机数字与 LIVE 徽标用 Bahnschrift / Bahnschrift SemiCondensed(见 §4)。
- **指纹去重**:内容未变不重渲染(队列层 `computeStateKey`、歌单层三段指纹、加班机 revision 比较,详见 [comms.md](comms.md) §3.2)。
- **低功耗模式**:`overlay-utils.js` 的 `overlayLowPowerEnabled(settings)`——URL 参数 `?quality=low` 强制开启、`?quality=pretty|smooth` 强制关闭、否则读设置 `overlayLowPowerMode`([overlay-utils.js:48-53](../../../public/js/overlays/overlay-utils.js#L48-L53))。低功耗下加班机走 `low-motion` 类(动画 180ms、关闭 transform/filter,[overtime.css:307-310](../../../public/css/overlays/overtime.css#L307-L310))。

### 1.2 CSS 变量注入表(唯一成文处)

队列/歌单/盲盒叠加层在每次快照到达时调用 `applyTheme(settings)` 把 settings 值写入 `:root` CSS 变量；以下是**全部 28 个** `--overlay-*` 变量的注入来源与默认值：

| CSS 变量                      | 来自 settings 键                               | 默认值            | 说明                                                   |
| ----------------------------- | ---------------------------------------------- | ----------------- | ------------------------------------------------------ |
| `--overlay-primary`           | `themePrimary`                                 | `#ff6f91`         | 主色（当前歌高亮/徽标）                                |
| `--overlay-primary-r/g/b`     | `themePrimary` 分量                            | —                 | 主色 RGB 分量（用于 rgba() 构造）                      |
| `--overlay-accent`            | `themeAccent`                                  | `#21b6a8`         | 强调色（徽章背景）                                     |
| `--overlay-accent-r/g/b`      | `themeAccent` 分量                             | —                 | 强调色 RGB 分量                                        |
| `--overlay-text`              | `themeText`                                    | `#fff7fb`         | 通用文字色                                             |
| `--overlay-opacity`           | `themeOpacity`                                 | `0.76`            | 面板背景不透明度（0–1）                                |
| `--overlay-bg-r/g/b`          | `themeBackground` 分量                         | —                 | 背景色 RGB 分量（面板/渐变底色）                       |
| `--overlay-gradient-r/g/b`    | `gradientEnd` 分量                             | —                 | 渐变终止色 RGB 分量（仅 `enableGradient=true` 时有效） |
| `--overlay-radius`            | `themeRadius`                                  | `8px`             | 面板圆角（px）                                         |
| `--overlay-blur`              | `backdropBlur`                                 | `0px`             | 毛玻璃模糊半径（px）；须配合 `.has-backdrop-blur` 类   |
| `--overlay-glow-size`         | `glowIntensity`                                | `0px`             | 辉光扩散半径（px）                                     |
| `--overlay-glow-color`        | `themePrimary` × `glowIntensity`               | `transparent`     | 辉光颜色（rgba，透明度由 glowIntensity 换算）          |
| `--overlay-font-family`       | `overlayFontFamily`                            | `Microsoft YaHei` | 字体栈（经 `withMultilingualFallback` 追加多语言回退） |
| `--overlay-font-weight`       | `overlayFontWeight`                            | `800`             | 字重                                                   |
| `--overlay-font-scale`        | `themeFontScale`                               | `1`               | 内容区整体缩放（em 单位乘数）                          |
| `--overlay-song-color`        | `overlaySongColor` → 回退 `themeText`          | `#fff7fb`         | 歌名文字色                                             |
| `--overlay-requester-color`   | `overlayRequesterColor`                        | `''`（继承）      | 请求者名字色                                           |
| `--overlay-index-color`       | `overlayIndexColor`                            | `''`（继承）      | 序号色                                                 |
| `--overlay-song-font-size`    | `queueSongFontSize`（px）→ `overlayFontScale`  | 计算值            | 歌名字号（px）                                         |
| `--overlay-waiting-font-size` | `song-font-size × 0.65`，最小 10px             | 计算值            | 等待曲目字号（px）                                     |
| `--overlay-title-font-size`   | `queueTitleFontSize`（px）→ `overlayFontScale` | 计算值            | 标题字号（px）                                         |
| `--overlay-edge`              | 固定值 `clamp(0px, 2vmin, 16px)`               | —                 | 面板外边距（在 CSS 中声明，不经 JS 注入）              |

注：`--overlay-bg-r/g/b` 用于面板背景渐变构造，`gradient-bg` 类叠加渐变时还使用 `--overlay-gradient-r/g/b`。`--overlay-glow-color` 的透明度 = `glowIntensity / 50`（最大 1）；加班机层不使用此变量集，有独立样式（见 §4）。

### 1.3 overlay-utils.js(共享工具)

挂 `window.OverlayUtils`:`escapeHtml`、`hexToRgb/hexToRgba`(主题色转 rgba)、`withMultilingualFallback`(字体栈回退)、`scrollTravelSeconds`(滚动时长换算)、`overlayLowPowerEnabled`(见上)。

### 1.3 song-virtual-scroller.js(歌单虚拟滚动)

歌单板专用:可变行高记录的**环形 DOM 窗口**虚拟滚动([song-virtual-scroller.js:28-58](../../../public/js/overlays/song-virtual-scroller.js#L28-L58))。

- **工作原理**:以 anchor 记录(当前视口首行 key/index/offset)为起点,向两侧按 `beforeViewports=1 / afterViewports=1.5` 个视口高度增量构建 DOM 节点(`probeOverflow` 先探测内容是否超出一屏,不超出则整表渲染),`wrapIndex` 取模实现环形复用;滚动时 `tick` 按 `pixelsPerSecond(viewportHeight / secondsPerViewport)` 推进 `scrollTop`,超出前缓冲区的顶部节点被回收并追加到尾部(`recycleTopRecords`),始终保持窗口内只有可见 + 缓冲节点。
- **联动**:`setRecords`/`relayout` 以 anchor 保持视口稳定(歌单刷新/字体加载完成/视口 resize 时不跳位);`secondsPerViewport` 由歌单滚动速度设置换算;页面隐藏时 `pause()` 停止 rAF([songs.js:102-108](../../../public/js/overlays/songs.js#L102-L108))。
- 浏览器无 `requestAnimationFrame`/`ResizeObserver` 时自动降级(整表渲染 + window resize 监听)。

### 1.4 礼物四方边框(`/gift-effects`)

`gift-effects.html` 保留透明全屏浏览器源地址，消费 `gift:frame`，并将 `gift:effect`
交给独立的 `gift-effect-player.js`。官方特效按已验证 RGB/alpha 坐标用 WebGL 合成，
单条播放、最多 3 条等待、等待超过 12 秒丢弃；错误、30 秒超时和停用统一清理。
弹幕开关关闭或 WS 断开时停止指令特效并清空其队列；手动预览不受开关限制。
服务器代码解析、桌面共用测试播放解析器和兼容规则见 [弹幕礼物特效规格](../../../specs/gift-effect-danmaku.md)。内置
`woodland-bloom` 主题当前使用一张完整合成 WebP 作为边框；上、右、下、左四张分片 WebP
也保留在资源目录中，但当前页面不直接加载它们，不加载远程美术。礼物名称、观众、
数量与最终金额由 DOM `textContent` 写入边框底部铭牌区域；中间安全区保持透明。
结构图之上另有 `branch`、`crystal`、`floral` 三张本地透明装饰 WebP；它们不参与四边拼接，
由 `FrameController` 独立进入、退场，并在 Holding 阶段分别完成一次花藤轻摆、水晶钟摆和花结
落位动作。三段动作不循环、位移不超过 8px、旋转不超过 3°；`reduced` 只显示静态装饰。

播放由 Overlay 内部 `GiftFrameController` 管理：单个 `PlaybackSession` 按 `900ms` 进入、
`2600ms` 保持、`650ms` 退场的冻结时序运行，完整边框、独立装饰与信息座
在进入阶段并行重叠；
队列最多 3 条 pending，事件等待超过 12 秒丢弃，实时事件按稳定 `gift-frame:<id>` 去重，
金额更高的新事件可替换 pending 中最低且最晚入队的一条。每个会话拥有 `AbortController`、
WAAPI 句柄、timer 与 watchdog，正常、异常、超时和主动取消都从同一 `finally` 清理出口恢复透明。

粒子 Canvas 最多创建 6 个错峰萤火光点，每个只沿框体周边完成一次短距离漂移和明暗变化，
不进入中央直播安全区；粒子失败不影响 WebP/DOM 生命周期。
动效解析优先级为 URL `?motion=` > `gift:frame.motionMode`/快照 settings > 系统
`prefers-reduced-motion`；`reduced` 关闭粒子和大幅位移但保留边框结构与礼物信息。
`gift:effect` MP4 查询和测试播放接口保留；弹幕代码与测试播放共用官方特效解析器及播放器。

### 1.5 开播动画(`/opening`)

开播页使用本页凭据从只读接口 `GET /api/opening/config` 读取已保存设置；Admin 预览 URL 可用
查询参数临时覆盖设置。`trackMotion` 仅接受 `heart`、`barber`、`progress`，查询参数优先于
保存值，非法值回退 `heart`。三种模式复用同一条 SVG waveform：心形的位移和显隐使用同一条
SVG 时间轴，启用画面时统一归零并从首轮立即移动；
灯带用金色短划线连续偏移，流光用单段粉色 dash 沿整条路径循环；任何时刻只显示一种前景
动效，不创建任意 CSS/SVG 输入面。页面隐藏、低画质或 `prefers-reduced-motion` 时暂停或停用
连续轨道动画，固定 `/opening` 地址本身不携带配置。人物图和音乐默认均为空；Admin 可上传
PNG/JPEG/WebP 和受支持的音频，Overlay 只接受受限的 `/opening-character/`、`/opening-media/`
当前文件 URL。未上传或清除后隐藏人物图并移除 src，不加载或播放空音频地址。

### 1.6 本日礼物 `/gift-feed`

`shared/gift-card-model.js` 同时供滚动展示和导出运行时派生卡片：仅对北京时间今天的记录，按送礼人 UID、相同礼物 ID 和礼物名合并，累加数量及各条历史单价乘数量的整数分金额，颜色按合计金额计算。身份来自 `/api/gifts/card-profiles`，对同人今日全部卡片使用最新已知昵称、头像及大航海等级；null 不覆盖已知等级，0 明确移除头像框，同等级续费保留未变化的卡片节点。未知 UID 不按昵称合并，旧日期和原始流水保持独立。导出只合并所选记录，资料更新可使用今日未选记录的证据。滚动阈值按合并后的卡片数计算，稳定分组键保留滚动锚点；资料暂不可用时预览说明未完成身份合并。

礼物助手的滚动礼物面板生成当前本地端口的 `127.0.0.1/gift-feed` 地址，`?preview=1` 只增加预览底色和状态。页面独立于管理面板生命周期，按北京时间遍历今天全部分页，包含未参与冲刺的有效付费历史。`gift-feed-state.js` 用 eventId 去重并保留轮播锚点；默认 3 行、速率 25，速率 1–50 线性对应每行 `5000 - (scrollSpeed - 1) * 4900 / 49` 毫秒。条目超过显示行数时连续匀速向上滚动，最后一条紧接第一条；不足或刚好填满时静态显示，不复制填满。动画按帧时间累计位移，换行保留余量，无间隔等待，DOM 只保留可见行及最多一条动画缓冲，并复用未变化的节点。页面隐藏时释放动画帧，恢复后接着当前位置移动。暂停和低功耗选项已移除。

WebSocket 通知合并后重读，并每 30 秒对账；刷新保留滚动进度，新集合在换行边界应用，静态或隐藏时立即更新。礼物通知只重读礼物与身份资料，设置、素材分别在对应失效通知时读取，首次加载、重连及定时对账补读两者；请求期间收到的失效通知合并到下一批。横幅按稳定卡片键插入或复用，`updateGiftBanner` 就地更新数量、颜色、名字、头像与舰队框，只在文字改变时重新测量字体，成功图片不随连击重建。滚动换行先移除离开的行，再插入新的缓冲行，避免搬动仍可见的节点；重复通知且展示资料未变时没有 DOM 写入，失败头像仍可单独重试。午夜、来源切换或投影代次变化清空旧集合，迟到请求不得恢复旧来源。保存配置即更新静态行颜色。`shared/gift-banner.js` 和 `css/shared/gift-banner.css` 同时拥有管理预览、PNG 和 OBS 的横幅：基础尺寸 560×96，包含头像占位、可空大航海边框、昵称、黄色礼物名、本地 WebP 和数量。颜色条的圆弧左端与头像同心，头像四周留 10 像素内距；昵称区、颜色条和 WebP 位置固定，数量保持字号并只向右扩展画布。PNG 按实际画布的 2 倍尺寸导出，基础宽度 1120 像素，合并时取本页最宽横幅；OBS 浏览器源建议宽度 900，以容纳多位数量。金额/时间/备注不进入横幅。

## 2. 队列叠加层(/queue)

[overlays/queue.js](../../../public/js/overlays/queue.js) 渲染 `state.queue`(current + waiting)与 `state.superChats`:

HTTP 初始/重连请求带本页读取代次，较新的完整 WS 状态使旧请求失效。HTTP 与 WS 共用内容指纹；延迟补数和重连取得相同内容时保留节点及滚动进度。

- **六种风格**:`classic`(默认,经典卡片列表)、`identity`(身份版,观众名突出,含 SC 置顶区)、`storybook`(奶油蓝插画画框)、`neon-vinyl`(甜粉麦克风舞台)、`cherry-ribbon`(紫金星月梦境)与 `golden-lily`(奶油金唱片铃兰);由设置 `overlayQueueStyle` 决定,遗留 `festival` 归一为 `identity`,未知值回退 `classic`。样式由 `overlays/base.css` 导入的 `.queue-*` 主题类承载。
- **风格 3**:框体与词条素材位于 `public/img/overlays/song-board-style-3/`;原始框体保留 alpha,`.queue-storybook::before` 在框内开口后叠加不透明白层,框外仍透明。词条黄色端点恒显示队列序号,浅蓝固定宽度区域复用身份版的歌名、点歌人、大航海/灯牌名与灯牌等级格式;没有大航海或灯牌时省略对应字段。内容实际宽度溢出时由 `scheduleIdentityContentScroll` 在该区域内左右往返,不会扩张词条素材。纵向超出画框时复用身份版的循环/往返滚动测量。
- **风格 4 / 5**:各自的框体与词条素材位于 `public/img/overlays/song-board-style-4/` 和 `song-board-style-5/`;框体和词条素材自带粉色或紫金渐变底色。两种风格隐藏通用顶部标题和点歌顺序数字,省略四组字段的说明标签并将短内容居中。每条记录输出歌名、点歌人,并在有数据时输出大航海等级、灯牌名与等级;没有大航海或灯牌时省略对应字段。大航海身份按总督红、提督紫、舰长蓝区分,同一条记录后接的灯牌名与等级徽章沿用该身份色;无大航海时才使用灯牌自身等级色。整组内容实际宽度溢出时复用 `scheduleIdentityContentScroll` 左右往返,纵向超出画框时复用插画风格滚动测量。风格 4 的列表下边界与前景底边内沿对齐,保证滚动终点的最后一条完整露出;风格 5 的列表窗口顶部与首条词条上边缘对齐、底部收进 30px。`prefers-reduced-motion` 下停用横纵动画。
- **风格 6**:奶油金唱片铃兰框体与横向词条素材位于 `public/img/overlays/song-board-style-6/`;词条以内容窗宽度的 72% 居中,完整收进画框的左右前景边框之间,列表上边界位于画框高度的 16.5% 以完整露出首条顶部装饰,相邻卡片以 `4px` 间距清晰分开,左侧花形圆圈显示从 1 开始的队列序号,右侧固定信息窗省略说明标签并输出歌名、点歌人,在有数据时输出大航海等级、灯牌名与等级;没有大航海或灯牌时省略对应字段。大航海与后接灯牌徽章使用和风格 4/5 相同的总督红、提督紫、舰长蓝身份色,无大航海时保留灯牌等级色。信息窗内容实际宽度溢出时复用 `scheduleIdentityContentScroll` 左右往返,纵向超出画框时复用插画风格滚动测量,列表下边界停在第 4 个序号附近;`prefers-reduced-motion` 下停用横纵动画。
- **风格 4–6 的画框层级**:完整框图作为底层保留中间色块,卡片与文字位于中层,同一框图去掉中心填充后以 `border-image` 作为顶层装饰。卡片滚动时会从丝带、花朵、唱片等边框装饰下方经过,但始终显示在框内中间色块上方。
- **六种风格的浏览器源缩放**:六款点歌板都在固定设计坐标中完成排版(`classic` 宽 405px、`identity` 宽 430px、插画风格宽 560px),内部背景、框体、词条、文字、徽章、间距和裁切窗口不随浏览器源单独重排。`queue-viewport.js` 在面板完成渲染后按浏览器源可用宽度与高度分别计算比例并取较小值;风格 1、3–6 可随浏览器源整体放大或缩小,风格 2 将最大倍率限制为 `1`,在较大的 OBS 画布中保持默认 430px 宽度,仅在画布不足时等比缩小。源比例与点歌板不一致时在未占满的一轴保留透明空白,不拉伸图片或文字。风格 3 的列表窗口仍在设计画布内整体上移 10px,为最底部可见词条保留安全距离。
- **风格 3–6 的词条缩放**:词条盒、位图、文字窗口和序号共用同一坐标系,不通过裁剪去掉上下装饰。风格 3 在 CSS 背景坐标中排除原 PNG 顶部和右侧的大块透明留白,不改写原始素材;风格 4/5 的完整 PNG 占内容窗宽度的 94%,风格 4 使用 `2172:517.5` 显示比例(高度为此前的 115%),风格 5 的显示高度为素材原比例的 80%;风格 6 使用完整 PNG 比例占 72%,三款列表起点都避开画框顶部前景装饰。
- **滚动**:classic 走 CSS 动画滚动(`classic-scroll` 循环 + `scrolling-bounce` 有节奏往返模式,loop clone 双份列表实现无缝循环),读取 `queueScrollMode`/`queueScrollSpeed`;identity 读取 `identityQueueScrollMode`/`identityQueueScrollSpeed`;风格 3–6 分别读取 `storybookQueue*`、`neonVinylQueue*`、`cherryRibbonQueue*`、`goldenLilyQueue*` 的滚动模式和速度。六种风格都在固定设计高度的列表窗内测量真实内容溢出,浏览器源 resize 后 `relayoutQueue` 重新配置并再次同步整板比例;重渲染时 `captureScrollAnimation/restoreScrollAnimation` 在 rAF 帧内恢复 CSS 动画进度,不跳帧不闪动([queue.js:174-202](../../../public/js/overlays/queue.js#L174-L202))。
- **低功耗**:`overlayLowPowerMode` 或 `?quality=low` 时停用毛玻璃/辉光等重特效(`.overlay-panel.low-power` 面板级降级,classic/identity 共用,[base.css:38-47](../../../public/css/overlays/base.css#L38-L47))。
- **快照消费**:指纹 = 当前歌/等待队列/SC/全部主题与滚动键;`queue:add`/`bilibili:danmaku`/`bilibili:superchat` 等 reason 走 80ms 延迟 `loadState()` 强刷(确保请求者元数据落库后再取,见 [queue.js:96-110](../../../public/js/overlays/queue.js#L96-L110));`live:status` 只更新直播状态不重渲染。
- 主题:经典/身份版色板、字体、字号、置顶 3 条、规则 6 条均来自快照 `settings`(管理页「点歌板/展示板」配置);`public/js/shared/queue-style-settings.js` 在渲染和滚动测量前把当前 `overlayQueueStyle` 的独立设置投影到现有渲染字段。风格 2 保留 `identityQueueFontSize` 并新增独立滚动模式;风格 3–6 各自持久化内容字号、字体、字重、自定义文字颜色、纵向滚动模式和速度,旧共享 `illustratedQueue*`/`queueScrollMode` 值仅作为旧快照兼容回退。

## 3. 歌单叠加层(/songlist)

[overlays/songs.js](../../../public/js/overlays/songs.js)(ES Module):

- 数据:`GET /api/state` + `GET /api/songs?enabledOnly=true[&category=]`(支持 URL `?category=` 单分类过滤)。
- 排序:`songBoardSortMode`(默认拼音/字母,`length` 按时长分组),`buildSongRecords` 生成记录,分组模式下加分组头。
- 指纹:`orderKey(songsRevision:sortMode)`、`layoutKey(字体族/字号组)`、`motionKey(滚动速度)`;歌曲变更(`songs:*`、`cloud:songs`、`database:clear` 或 `database:clear-all`)220ms 防抖重载。过期请求不能回填旧列表或设置；重连内容相同时保留节点和当前滚动锚点，`live:status` 不触发重渲染。
- 虚拟滚动与 §1.3 一致;字体 `loadingdone` 与 ResizeObserver 触发 `relayout`(等待 `document.fonts.ready`)。

## 4. 加班机叠加层(/overtime)

[overlays/overtime.js](../../../public/js/overlays/overtime.js) + [css/overlays/overtime.css](../../../public/css/overlays/overtime.css)。领域状态(enable/status/remaining/rules/background/revision)见 [backend/overtime.md](../backend/overtime.md);渲染所需规则与背景由管理页加班机控制台配置([app.md](app.md) §6)。

### 4.1 DOM 结构(两层)

- 背景层 `#overtimeBackground`(+ 半透明遮罩 `.overtime-background-shade`):按 `background.path`/`background.fit`(cover/contain/fill)设置图片,内置背景见 ADR [0005](../adr/0005-built-in-overtime-backgrounds.md)。
- 前景层 `.overtime-foreground`:时钟面板(状态行 `LIVE` 徽标 + 状态文字 + `#overtimeClock`)+ 送礼加班表(`#overtimeGiftGuide`,按规则生成门票卡片)+ 结算动画层 `#overtimeAdjustmentStage`。

### 4.2 响应式(容器查询)

`.overtime-machine` 设 `container-type: size`,**根字号 `font-size: 2cqmin`**,全部尺寸用 em/cq 单位等比缩放:

| 断点                                  | 行为                                                                                                                                                                                        | 出处                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `@container (max-width: 719px)`       | 门票网格切窄列(≤2 列)                                                                                                                                                                       | [overtime.css:261-269](../../../public/css/overlays/overtime.css#L261-L269) |
| `@container (max-width: 419px)`       | 时钟面板收窄、标题小字限宽                                                                                                                                                                  | [overtime.css:270-273](../../../public/css/overlays/overtime.css#L270-L273) |
| `@container (max-aspect-ratio: 1.45)` | 竖屏(高 > 宽/1.45)收紧纵向间距                                                                                                                                                              | [overtime.css:274-276](../../../public/css/overlays/overtime.css#L274-L276) |
| `@container (max-height: 239px)`      | 超矮场景隐藏送礼表头、压缩间距                                                                                                                                                              | [overtime.css:277-281](../../../public/css/overlays/overtime.css#L277-L281) |
| `@supports not (font-size: 1cqmin)`   | 无 cq 支持时回退 `2vmin`                                                                                                                                                                    | [overtime.css:297-299](../../../public/css/overlays/overtime.css#L297-L299) |
| `height: 100vh` → `100dvh`            | 先声明 `100vh` 兜底：内核支持 `container-type: size`（Chrome 105+）但不认 `100dvh`（Chrome 108+）时，高度声明失效会被尺寸包含（size containment）塌成 0，整个画面不可见（如直播姬浏览器源） | [overtime.css:17-18](../../../public/css/overlays/overtime.css#L17-L18)     |

### 4.3 时钟与数字呈现

- 时钟字号:**8.5em × 2cqmin = 17cqmin** 等比缩放(`font: 700 8.5em/0.9 Bahnschrift SemiCondensed,…` + `tabular-nums`,[overtime.css:94-100](../../../public/css/overlays/overtime.css#L94-L100));管理页预览时钟为 `clamp(38px, 5vw, 66px)`([admin/overtime.css:67](../../../public/css/admin/overtime.css#L67))。
- 时间格式:`formatClockSeconds` 恒补零到两位 → `02:05:09`,超过 99 小时自然增长为 `120:00:00`([overtime.js:267-273](../../../public/js/overlays/overtime.js#L267-L273))。
- 时钟调度:运行中按当前显示层级的下一秒/分钟/小时边界使用一次性 timeout 更新，值未变化不写 DOM；暂停、结束或页面隐藏时清除时钟 timer，恢复可见或收到新 revision 时重新锚定。
- 数量封顶:结算卡片数量 `> 99999` 显示 `99999+`([overtime.js:275-278](../../../public/js/overlays/overtime.js#L275-L278))。
- 结算动画:每次 `overtime:update` 携带 `adjustment` 时入队(队列上限 5,满则合并为"连续礼物 · 净变化"聚合卡片)依序播放盖章动画 + 门票高亮 + 时钟变色闪动([overtime.js:167-230](../../../public/js/overlays/overtime.js#L167-L230))。
- **动画降级**:`prefers-reduced-motion: reduce` 媒体查询与 `low-motion` 类都把动画压缩到 180ms;低功耗 `?quality=low` 时动画时长同步缩短。
- 设计令牌:夜色 `#181823`、粉 `#ff6f91`、青 `#21b6a8`、珊瑚 `#f0677d`、金 `#f5b72f`、文字 `#fff7fb`([overtime.css:1-8](../../../public/css/overlays/overtime.css#L1-L8));门票按效果取色:加时=青、减时=珊瑚、盲盒=金、文字展板=粉、不变=灰。文字展板规则的自定义文字通过 `textContent` 写入效果区域，收到对应礼物不改变数字倒计时。

## 5. 盲盒叠加层(/blindbox)

[overlays/blindbox.js](../../../public/js/overlays/blindbox.js):

- 数据:汇总 + 排行榜来自 `GET /api/gifts/blind-box-stats`(可选 `?boxName=心动盲盒` 只看心动盒);快照 reason 以 `bilibili:gift`/`gift:sprint:reset`/`connect` 触发重取统计。所有带 state 的快照立即应用主题及标题；统计与设置独立判断新旧，相同统计内容保留榜单节点和翻页进度。
- URL 参数(短别名 + 长键):`top/t`(榜单位数,0=仅汇总,-1=全部)、`winners/w`(只看盈利)、`heartBox/hb`、`title/tt`(自定义标题,优先于设置 `blindboxOverlayTitle`)、`compact/c`、`hideLoss/hl`、`refresh/r`(轮询秒数)、`noScroll/ns`;管理页「盲盒投屏」生成器输出该链接(见 [app.md](app.md) §4.3)。
- 盲盒默认隐藏滚动条；`noScroll=1` / `ns=1` 保持隐藏，显式 `0` 恢复细滚动条和手动浏览。隐藏模式超高内容复用 `auto-pages.js` 每 8 秒翻页，保留 32px 阅读重叠并在尾页停留后回到顶部。该模块也服务画猜积分、正确答案、窄布局和游戏结果卡；不使用连续动画，低功耗或减少动效时仍可阅读全部已选内容。滚轮、指针、触摸或键盘操作暂停 16 秒，焦点留在区域内时持续暂停；页面隐藏不翻页，卸载时清理。
- 呈现:汇总卡(盒子数/总成本/总盈亏,涨绿跌红)+ 排行榜(冠亚季军👑🥈🥉徽章 + 行内进度条)+ 可选的底部冲刺条;`compact/winners-only/summary-only/no-scroll` 类切换形态;主题从快照 settings 经 `applyTheme` 应用(与队列层同套令牌)。
- 数据刷新:WS reason `bilibili:gift`/`gift:sprint:reset`/`connect` 重取统计,`refresh/r` 参数支持定时轮询(≥10s)兜底,适用于 WS 不稳的投屏环境。

## 6. 桌面歌词页(/lyrics)

[overlays/lyric-window.js](../../../public/js/overlays/lyric-window.js):

- 使用方:管理页「复制桌面歌词」复制规范地址 `/lyrics`,供浏览器或 OBS 浏览器源使用;页面背景透明,实际输出不包含管理页预览使用的网格/纯色辅助背景。
- 数据:首次连接和重连均从 `/ws` 的 snapshot 取得 `desktopLyric*` 设置、`lyricState` 和 `lyricTimeline`，并消费增量 `lyric-state`、`lyric-timeline`。页面不再请求不存在的 `GET /api/settings`。
- 渲染:直接复用 `admin/desktop-lyric-preview.js` 的完整时间轴渲染器,显示整首歌词、翻译、罗马音、当前行逐字进度、长间奏三秒倒计时和播放进度;逐字高亮支持连续填充与按时间点亮两种模式,隐藏 `desktopLyricPreviewPlayback` 只提供 aria-live 文本,当前行 `LyricWordAnimator` 是唯一视觉逐字更新源。样式设置通过同一组 `--preview-*` CSS 变量应用,因此浏览器源与管理页实时预览一致。
- 显示行数:设置 `desktopLyricVisibleLines` 为 `0` 时保持整首可见;正整数仍创建整首时间轴,只将当前行窗口外的行标记为不可见。`1` 仅显示当前行;偶数向下扩展,奇数向上下扩展,整首数据继续保留以保证同步和自动跟随。
- 性能默认值:新配置默认关闭弹性滚动、非当前行模糊和行缩放,优先保证歌词清晰与浏览器源稳定;用户已保存的显式设置继续生效。对齐方式支持左对齐、居中、右对齐和两端对齐。
- **滚动与跟随**:歌词视口拥有独立纵向滚动;当前行切换时使用弹簧动画居中跟随。用户滚轮、触摸、指针或键盘滚动后暂停自动跟随 6 秒,再恢复到当前行。
- **状态防回灌**:客户端只接受更大的 `generation`,或同一 generation 下严格递增的 `sequence`;旧客户端缺字段时保持兼容。`content-visibility:auto` 与 `contain-intrinsic-size` 跳过视口外绘制,不改变完整歌词的滚动结构。

## 6.1 弹幕姬

桌面设置区将直播画面链接放在样式选择之前，原链接位置增加用户黑名单和敏感词屏蔽，
由 `admin/danmaku-overlay-filters.js` 通过独立受限 IPC 管理服务器私有配置。UID 可直接输入，
也可读取当前绑定直播间的 B 站在线榜后搜索、勾选；榜单只包含接口返回的部分观众。
词语按正文包含匹配（英文不区分大小写），支持单个移除和一键清空。列表操作即时提交，
确认成功才更新展示，失败保留输入；账号切换清空输入与列表、忽略旧回包。
过滤只影响保存后新收到的普通弹幕，不改变现有卡片、礼物、系统提示或其他弹幕消费者，
服务器配置在客户端关闭后仍生效。样式预览与显式应用流程保持独立。

桌面工具与直播画面地址中的弹幕姬链接均由当前已认证资料的公开歌单 origin 生成服务器
`/overlay`，不回退本机。`server-overlay-url.js` 处理账号与授权状态；
`danmaku-overlay-settings.js` 通过窄 IPC 读取服务器配置，编辑仅保留在草稿。
“网页预览”打开同一服务器页面的 `preview=1` 和草稿样式/时长参数，使用示例弹幕且不连接
直播 SSE；“应用到服务器”才提交，失败保留草稿，迟到回包不能覆盖后续编辑或新账号。
服务器保存并向 OBS 推送配置，关闭客户端不影响其监听。IPC 契约见
[preload](../desktop/preload.md)。

### 兼容本地页面 /danmaku

[overlays/danmaku.js](../../../public/js/overlays/danmaku.js) 驱动本地 `/danmaku`。预览入口为 `/danmaku?preview=1`，由 [danmaku-preview.js](../../../public/js/overlays/danmaku-preview.js) 在同一页面切换聊天气泡(`bubble`)、深色面板(`signal`)、蝴蝶结(`minimal`)、经典样式(`ranked`)、透明文字(`transparent`)、头像横卡(`identity`)、简洁白卡(`outline`)、奶油气泡(`cream`)和流光气泡(`glow`)。前六种固定排列，后三种全屏随机；非法样式回退 `signal`。旧 `style` / `fullscreenDurationSeconds` query 仍可初始化草稿，随后地址统一为 `/danmaku?preview=1`，当前风格保存在该 history entry，刷新保留选择。每种风格一次性渲染 6 条示例：总督、提督、舰长和非大航海观众的文字与行内表情、纯表情、“星河来客送出小花花 × 10”送礼通知。预览不连接 WebSocket、不循环或自动追加、不自动过期，允许滚动查看全部；`打call` 图片内置于 `public/img/overlays/danmaku-previews/dacall.png`，没有外部素材请求。九种风格正文与礼物名称、数量统一为 30px；预览沿用实际卡片宽度及表情比例。六种固定位置样式共用跟随浏览器源宽高的外层画布，四周统一留 12px，消息靠左并从底部排列；各样式保留消息宽度、间距和装饰比例。经典样式与头像横卡只按扣除左右边距后的可用宽度等比缩小，600px 内容宽度时为原始大小，最大为 1 倍；高度只决定完整可见条数，不限制为 640px，也不缩小字号。本地预览沿用相同宽度规则，高度随内容展开并由外层视口滚动。

小表情 `kind:inline` 无论夹在文字里、重复发送或单独发送，图片高度均为正文的 `1em`；整张表情包 `kind:sticker` 使用原尺寸的 1.4 倍，即普通样式 `4.48em`、经典样式与头像横卡 `5.74em`，宽度按原比例并受现有画布限制。缺少 kind 的旧载荷仍沿用整条匹配时放大的兼容分类。预览文字示例显式标记 inline，纯图片示例标记 sticker。

保留的非预览本地入口以 `topic=danmaku` 连接 WebSocket，按 snapshot 的 `settings.danmakuOverlayStyle` / `danmakuFullscreenDurationSeconds` 切换样式和停留时间，从 `danmakuFeed` 恢复消息并消费 `danmaku:message`。按消息 `id` 去重，同一帧批量追加；连接中断时指数退避重连，连接状态仍以 `liveStatus` 为准。客户端复制和打开的正式 OBS 地址由服务器提供，本地预览不改变服务器配置。

本地页面对去重、截取最近 50 条后的消息内容做完整比较。内容未变且 feed 无需初始化时，快照保留现有消息节点、到期计时器及尚未绘制的增量帧；仍更新直播连接状态。首次空快照、实际消息修正/清空/重连补数、样式或全屏期限变更导致的 feed 重建仍执行恢复。此优化不改变远端正式 OBS 的 SSE，也不承诺有变化的快照完全免于重建。真实页面模块和共享 feed 的节点/计时器回归见 `test/danmaku-snapshot-stability.test.js`。

弹幕工具的显示顺序为直播链接、黑名单与屏蔽词、样式选择、参数调节、应用操作。`danmaku-style-options.js` 定义各样式字体、正文字号范围、背景不透明度及礼物插画选项；无底色样式不显示底色参数，蝴蝶结与流光气泡没有独立礼物图位。`styleOptions` 由服务端按样式保存，Electron 仅通过既有认证通道校验和投影；旧服务器不支持时禁用新参数并提示更新。切换样式保留各自草稿，恢复默认只重置当前样式，仍需显式应用。原有全屏停留时间位于参数区。

预览通过 query 接收序列化参数，之后将样式、时长及参数保存在当前 history state，显示地址仍为 `/danmaku?preview=1`；刷新、切换样式均保留配置。原图模式使用内置合成礼物图片，不请求直播或外部图片。正式服务器浏览器源从已有礼物目录取得精确已结算版本的 B 站图片地址，经可选 `giftImageUrl` 随原 `gift` 事件传递；浏览器直接加载，使用 `no-referrer`，失败保留样式插画。服务器不转发图片二进制；缺少新字段时行为兼容。正式协议和各样式边界见服务端 `public-overlay-api.md` / OpenAPI `OverlayStyleOptions`。

页面与 `/games` 的画猜消息共同复用 `danmaku-feed.js` DOM 组件。组件不读取 WebSocket 或领域状态，只接收显式消息数组和图片 URL resolver：

- `measureDanmakuText(message)` 按中英文混合文本的视觉长度估算行数、宽度百分比和最小高度。
- 透明文字风格在头像下沿居中显示 `LV{medalLevel}`，复用消息渲染器从本条消息的独立 `medalLevel` 写入头像数据属性；缺少灯牌名称不影响已知等级。缺失、零或非法等级不显示，不从舰队身份推算，也不复用上一条消息的等级。该风格不再在正文下重复显示粉丝牌；其他风格沿用原徽章。
- `kind:'gift'` 使用专用 `is-gift` 节点，以 `textContent` 展示送礼人、“送出”、礼物名称和数量。登录账号发送的感谢按普通弹幕渲染，不转换成礼物卡，不额外生成感谢文案，也不提供单独的感谢示例。除保持原样的蝴蝶结外，礼物采用与普通聊天不同的排版和造型：聊天气泡为猫咪插画卡，信号带为切角通知牌，经典样式为礼章飘带，透明文字的礼物使用带细金边的实色圆角星光卡，身份横卡为纪念卡，简洁白卡为礼物小票，奶油气泡为花束礼物卡。除蝴蝶结外，送礼通知使用紧凑的两行结构：昵称在上，“送出＋礼物名”和数量在下一行，不显示“谢谢支持”。`gifts.css` 仅复用内容结构，各风格文件拥有配色、轮廓和装饰；插画仅用于适合的样式。素材全部内置于 `public/img/overlays/danmaku-gifts/`，各风格不复用同一礼物图。该展示能力不新增公开 SSE 事件或礼物业务处理链路。
- 本地预览统一深灰背景，由外层视口单独滚动；消息列表按内容自然增高，不裁剪底部。固定设计画布只按可用宽度缩小；随机样式在预览中静态错位排布，正式直播仍使用原随机布局和寿命。预览明确使用无限视口保留范围，避免初始空列表高度导致示例被裁掉；窄窗口把样式选择放到顶部。样式切换回到顶部，地址不变。
- 透明文字和奶油气泡礼物卡通过 `showGiftTotal` 选项把数量放在礼物名旁边，原数量位置显示 `giftTotalPrice`（人民币元）的 `¥` 金额，最多两位小数。金额直接来自已结算总额；旧消息缺失金额时显示 `—`。奶油气泡沿用右侧粉色金额框，名称旁的数量不带底框。其他样式继续显示原数量布局。本地预览使用合成总额，正式 OBS 消费服务器同名展示字段。

- 固定礼物卡中，`bubble` / `signal` / `ranked` / `transparent` / `identity` 沿用原客户端 1.5 倍尺寸上限（460px 设计宽度 → 690px 显示宽度）。扣除两侧各 12px 后的空间不足时，卡片、昵称、礼物文字、数量或金额、头像、装饰和间距一起等比缩小；高度只影响可见条数。经典样式和头像横卡抵消列表已有倍率，避免重复缩放。列表裁剪计入节点自身的 CSS zoom；蝴蝶结、普通弹幕及全屏随机礼物保持现状。本地预览与正式 OBS 同步。

- `createDanmakuFeed(root, options).render(items)` 使用 `DocumentFragment`、`textContent` 和受控 `<img>` 创建消息，`append(item)` 只追加新节点，不重建已有 DOM。游戏层继续按估算高度保留当前可见区及上方约 5 个视口并自动滚到底部；固定 `/danmaku` 配置 `offscreenViewports: 0`，按实际布局高度、行间距和容器内边距移除最旧的超限节点，保留完整可见消息。固定区域和全屏模式的 `ResizeObserver` 同时观察容器与消息，图片加载、昵称换行或窗口缩放后在动画帧内合并测量与调整，使用不受入场动画缩放影响的布局尺寸。节点移除或替换时取消观察，销毁时取消布局帧和到期计时器。表情按精确触发文本切分，加载失败回退原触发文本，不使用 `innerHTML`。页面数据和断线恢复快照仍分别硬限制为最近 50 条，共享组件默认上限仍为 120 条。
- 流光气泡（`glow`）将发送者昵称居中放在消息框上方，文字或表情在深色半透明圆角框内，边框带柔光，不显示头像/徽章。`ranked-palette.css` 为它和经典样式提供同一份身份色，普通观众/粉丝青蓝、舰长蓝、提督紫、总督红、主播绿色覆盖优先。复用现有随机布局与时长；本地预览静态错位排列，礼物采用同色紧凑双行通知卡。
- 经典样式（`ranked`）通过独立 `data-streamer` 标记将主播名字标签和正文气泡设为绿色，并隐藏主播船锚；普通观众保持青蓝色。可选 `isStreamer` 只由当前房间主播 UID 与本条发送 UID 比较产生，缺失按 false；本地 B 站消息入口、feed 投影和服务器 SSE 均保留该展示语义，不公开新增 UID，也不改变其他风格的 `data-identity`。本地纯表情示例同时展示主播身份。
- 共享组件按当前房间身份为每条消息输出 `data-identity=viewer|fan|captain|admiral|governor`；大航海身份优先，拥有大航海且佩戴当前房间灯牌时仍同时输出两枚徽标。五套固定弹幕姬只共享该语义，不共享身份视觉：`signal` 使用军衔刻度与分级信号色，`bubble` 使用会员胶囊、身份符号和柔和分级光晕，`minimal` 不绘制左侧色条，普通观众省略身份签，粉丝与大航海身份保留单字身份签和低遮挡分级色；`ranked` 隐藏徽标，以普通/粉丝共用的石墨灰及舰长蓝、提督紫、总督金四档整卡底色表达身份，用户名和正文在左、头像在右；`transparent` 不绘制卡片底色、边框或大航海徽标，保留头像右侧的昵称、正文和下方粉丝牌等级，并用蓝、紫、红色昵称区分舰长、提督、总督。`outline` 虽保留同一 DOM 身份字段以兼容共享组件，但 CSS 统一隐藏头像、徽标和灯牌；卡片使用浅白半透明底、柔和阴影、普通观众使用灰色昵称、大航海使用蓝紫红识别色，正文为深色，左对齐排版并轻微淡入。
- `ranked` 使用 624×640 固定设计画布、最大 600px 卡片宽度和 10px 卡片间距，卡片随正文增高；`calculateRankedOverlayScale(width, height)` 取 `min(1, width / 624, height / 640)` 并投影到 `--ranked-scale`，让窗口 resize 时头像、文字和卡片统一等比缩放。浏览器源比例与设计画布不一致时在未占满的一轴保留透明空白，不拉伸或单独重排内部元素。
- `/danmaku` 的观众头像由浏览器直接读取弹幕中携带的 HTTPS B 站 CDN 地址，保留域名白名单且拒绝带账号密码的 URL；头像和模糊底图共享同一地址，使用 `no-referrer` 并异步解码头像，不逐条查询用户资料或让服务器转发头像。图片缺失或失败沿用各样式的默认展示。表情继续使用 `/api/bilibili/avatar` 本地代理；未通过 B 站域名白名单的图片不会进入服务端公开流。
- 固定区域样式的网格行占满可用高度，使消息容器的裁剪预算来自浏览器源视口，而不是当前消息堆叠高度；少量消息仍靠底部排列，追加消息不会在视口尚有空余时过早移除已有消息。
- 各样式的图片表情受正文宽度约束，行内图片不使用负纵向边距，昵称与粉丝牌必要时分行。聊天气泡保留 12px 消息间距及 6px 尾角空间；直播气泡设计画布内的消息间距为 10px。身份横卡(`identity`)的普通观众与粉丝将本条头像放大模糊后铺底，保留头像的深浅和色彩分布，白字加细暗描边；右侧清晰头像宽 180px，左侧 30% 渐隐，图片不撑高卡片。缺失或失败时两层均使用默认插画，舰长/提督/总督继续使用蓝/紫/红身份底色，礼物保持独立样式。背景复用成功加载且经过 URL resolver 的图片，不读取跨域像素；本地和服务器样式一致。卡片宽 600px、最小高度 92px、间距 6px，按可用宽度等比缩小，正文换行时向下增长。简洁白卡和奶油气泡的昵称放在卡片边框内，正文间隔 6px；消息距离视口边缘至少 16px，消息之间至少 10px，已放得下的消息保留位置，空间不足时先移除最旧消息。
- 信号带的粉丝牌等级跟随昵称信息行排版，不再绝对定位到卡片底边；粉丝牌名称允许收缩并显示省略号，等级不会挤到正文或边框上。
- 蝴蝶结样式的昵称向下偏移 6px，居中占正文区域宽度的 70%，长昵称保持 14px 字号自动换行，连续英文也可在字符间折行。行内表情不使用负纵向边距，图片占用完整行高，避免最后一条消息的表情底部超出消息容器并被裁切。

## 6.2 游戏叠加层(/games)的弹幕组件

[overlays/games.js](../../../public/js/overlays/games.js) 是游戏入口，只传入会话中的 `session.danmaku`。画我猜的 `#drawDanmakuFeed` 固定声明 `data-style="bubble"`，不读取或跟随弹幕姬的 `danmakuOverlayStyle` 设置；`games.css` 独立实现适合游戏窄栏的五身份气泡视觉，并自动受益于共享组件的安全表情渲染。

游戏和转盘共用 `socket-client.js` 的连接生命周期。每次连接成功分别从 `/api/games/session`、`/api/wheel` 补齐状态；请求失败最多重试四次，收到更新后丢弃较旧的 HTTP 读取/操作响应。转盘通过专用 REST 读取和 `wheel:update` 恢复，不假定普通 snapshot 包含转盘状态。现有互动端点保留，页面凭据仅允许 §1.0 列出的本页操作。

- `games.css` 将短消息显示为紧凑气泡，长消息按宽度增长并自然换行增高；交错对齐、实时标题栏和 reduced-motion 降级只属于视觉层，不改变弹幕字段或游戏协议。

## 6.3 萌时钟(/clock)

[overlays/clock.js](../../../public/js/overlays/clock.js) 驱动固定 `/clock`
浏览器源，默认首帧使用本页凭据从只读接口 `GET /api/clock/config` 读取已保存设置，并使用
设备本地时区显示当前时间、日期和星期。页面外层透明；横向样式使用 560×190
设计画布，竖向时间轴使用 220×380 设计画布，并在浏览器源不足时按可用空间缩小。

- 风格参数仅接受 `style=peach|starlight|soda|timeline-horizontal|timeline-vertical|digital`，
  非法或缺失值回退桃桃便签(`peach`)；前三套分别使用奶油蜜桃兔耳、靛蓝月亮云朵
  与薄荷气泡小鸭。横向刻度和竖向刻度使用无卡片底的细线排版、年份与英文星期，
  其中竖向款适配 240×400 Browser Source（含页面边距）。白字数显(`digital`)
  使用透明背景、白色粗窄数字和细暗描边，上排为 `YYYY-MM-DD` 与英文星期，
  下排为同字号的 `HH:MM:SS`，沿用横向画布。
- `date=0|1`、`seconds=0|1`、`format=12|24` 控制日期、秒数和小时制；非法值
  回退默认显示日期/秒数与 24 小时制。`label` 合并空白并截到 16 个 Unicode
  字符，始终通过 `textContent` 输出；透明时间轴和白字数显不显示角标文案。
- 时钟按下一秒边界使用一次性 timeout 更新；页面隐藏时停止调度，恢复可见后
  立即校时。冒号与星点动效在 `prefers-reduced-motion: reduce` 下停用。
- Admin 百宝箱的「萌时钟」卡片只展示并复制固定地址；表单修改经受 token 保护的
  `POST /api/settings` 保存。预览 iframe 使用独立 opaque origin，首次用完整参数加载，后续
  通过校验父窗口来源及服务 origin 的 `lira:clock-preview-config` 消息原位更新；样式切换使用
  160ms 淡入衔接，减少动态效果时停用，不重载页面或重启计时器。完整参数无需重复
  读取配置，首帧在配置和当前时间就绪后显示。旧带参数地址保持兼容，显式参数逐字段
  覆盖保存配置；已打开的 OBS 页面在 Browser Source 刷新后读取新设置。

## 7. 数据消费一览

| 叠加层       | 首帧                                                                 | 实时                                        | 去重指纹                                | 触发重载的 reason                                              |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| queue        | `/api/state`                                                         | snapshot                                    | current+waiting+SC+全部主题键           | `queue:add`/`bilibili:danmaku`/`bilibili:superchat`(80ms 强刷) |
| songs        | `/api/state` + `/api/songs`                                          | snapshot                                    | orderKey/layoutKey/motionKey            | `songs:*`/`cloud:songs`/`database:clear`/`database:clear-all`(220ms 重载) |
| blindbox     | `/api/state` + `/api/gifts/blind-box-stats`                          | snapshot(即时设置)+ 轮询                     | 统计内容相同保留节点                    | `bilibili:gift`/`gift:sprint:reset`/`connect`                  |
| overtime     | `/api/state`(overtime 字段)                                          | snapshot + `overtime:update`                | `revision` 单调比较                     | `overtime:update` 的 adjustment → 动画入队                     |
| gift-effects | `/gift-effects` 页面加载完整合成 WebP + 三张独立装饰 WebP；保留四方分片资源 | `gift:frame`                                | `eventId` 稳定去重 + 3 条 pending 队列  | 每个合格 final 礼物一次播放                                    |
| opening      | `/api/opening/config`                                                | 无                                          | 无；首帧配置经枚举/文本清洗             | 页面加载一次；Admin 预览可由 URL 参数覆盖                      |
| clock        | `/api/clock/config` + 设备本地时间；URL 参数可覆盖                   | 本地秒边界定时器                            | 无；页面恢复可见时立即校时              | 页面加载一次；不消费 WebSocket reason                          |
| lyrics       | snapshot 中的设置、状态和时间轴                                      | `lyric-state` + `lyric-timeline` + snapshot | 当前行与时间轴内部去重                  | 播放页按状态变化推送                                           |
| danmaku      | snapshot 中的 `danmakuFeed`                                          | `danmaku:message`                           | 有 id 时按 id；兼容消息按 uid+时间+正文 | 无 reason 重载；断线重连后由 snapshot 恢复                     |
| games        | `/api/games/session`                                                 | snapshot + `game:update` + `game:draw`      | 游戏入口调度器按更新频率合并渲染        | `game:update` / `game:draw`                                    |
| wheel        | `/api/wheel`，连接成功后补读并有限重试                               | `wheel:update`                            | 状态/抽取 ID 与读取代次                 | 每次 WebSocket 连接成功                                      |

消息类型与 reason 的全集定义以 [ws.md](../backend/ws.md) §3 为准;本表只描述各叠加层**消费**哪些。

歌词性能策略由 `shared/lyric-performance.js` 持有：连续四个长帧先从 WAAPI 降为手动，再连续四个长帧进入静态模式。`lyric-word-animator.js` 在模式实际改变时取消并清空旧动画，静态模式仍按当前时间更新进度。clock/opening 使用各自的 HTTP 配置接口，不订阅快照 WebSocket。


## 服务器 OBS 地址

服务器弹幕姬地址按服务端 ADR-0056 使用 `/overlay/<16位base64url>`。`server-overlay-url.js` 在初次授权资料和授权状态变化后，通过既有主进程 `getOverlaySettings()` 读取完整 URL，验证与资料 `songPageUrl` 同源，再同时提供给点歌投屏地址及弹幕工具；不从域名拼接裸路径、不生成或上传密钥。账号切换先清空地址，迟到回复按代际丢弃。该只读 capability 仅用于用户明确要求的展示/复制/打开，DeviceBearer 保持在 main。失败不回退公开地址。网页、不同设备和重装后使用同一服务端持久密钥；本地 `/danmaku?preview=1` 预览不依赖它。

验收：首次加载两个观察者收到相同完整 URL；复制/打开保留随机串；错 origin、裸路径、带 query/hash 或非法长度拒绝；切换账号不显示旧 URL；本地预览与草稿行为不变。自动化见 `test/server-danmaku-settings.test.js` 与 `test/danmaku-overlay-ipc.test.js`。


## 投票与评分 `/interactions`

独立 interactions scope，仅展示当前类别 3 会话；空场透明。推荐浏览器源 800×600，卡片随内容收紧，选项区最高 352px，选项行 88px，翻页步长 320px，每页 8 秒。主持端按同一布局估算 P 屏至少 P×8 秒；更短时长仅提示，不延长截止。每场从第一屏开始，实时更新保留 DOM 与滚动位置，调用 `startOverlayPages` 一次并在切场/卸载清理。用户交互或页面隐藏会暂停翻页。

投票使用固定顺序与 0–100% 标尺，票数/百分比固定在完整轨道内，零票不隐藏；结束标最高/并列最高，零参与无胜者。评分使用最大宽度 460px 的整体边框卡片，规则文案可自定义，默认说明 1–10 分、只发整数及取最后一次评分。多行输入保留换行，长文本（含连续英文）按卡片宽度自动折行，卡片随内容增高，规则留空则隐藏，不固定行数。底部独立均分框在收集中显示占位「—」，不显示均分或人数，结束后显示两位小数及人数；无人评分显示「暂无评分」。接收曾中断时保留提示。页面 GET、刷新或开多个实例均不启动/延长收集。截止由本地服务控制，与页面可见性无关。

选项文字位于进度条内左侧，票数与比例右对齐。默认白底、深色文字、浅青色填充，不再展示完整规则说明。标题和提示默认空、留空隐藏，不回退到本场主题。管理端「直播画面」按内容、颜色、布局与显示分组，左侧编辑、右侧棋盘格背景预览；窄窗口将预览放到编辑区上方。可调整标题、提示、评分规则、文字/背景/进度条/轨道颜色、背景与整体不透明度、文字大小、卡片圆角、状态和人数显示。背景不透明度只影响底色，整体不透明度同时影响卡片全部内容；字号 16–24px，仍保留 88px 行高。隐藏人数不隐藏接收中断警告，也不提前公开评分汇总。标题与状态均隐藏时折叠标题区，底部无人数或警告时折叠底部。

草稿即时预览，可切换投票或评分，预览明确使用示例数据；进度条色也用于评分边框与最终均分框。预览与浮层共用外观样式，按卡片宽度调整选项内的排列。点击应用后通过既有 `/api/settings` 保存并广播，恢复默认也先进入草稿。设置键与默认值见 [storage.md](../backend/storage.md)；只有 interactions scope 接收这些展示设置。样式更新不改变会话、选项节点、翻页计时器或滚动位置；评分浮层共用这套外观。
