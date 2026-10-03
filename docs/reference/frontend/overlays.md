# 直播画面悬浮层(overlays/)

直播平台为 B 站；OBS 与哔哩哔哩直播姬均通过浏览器源 / 网页来源使用这些画面。文中的 overlay 指通用直播展示页。本机画面使用 `127.0.0.1`，要求与 LIRA 同机并保持客户端运行；既可用直播场景的一个来源，也可直接导入独立组件。在线弹幕姬使用服务器返回的完整 HTTPS 地址，关闭客户端后仍可展示。本机 `/danmaku?source=component` 是独立组件来源，`/danmaku?preview=1` 是示例预览；完整操作见 [组件与浏览器源指南](../../guides/component-sources.md)。

> 涉及文件:[pages/overlays/queue.html](../../../public/pages/overlays/queue.html)、[pages/overlays/songs.html](../../../public/pages/overlays/songs.html)、[pages/overlays/blindbox.html](../../../public/pages/overlays/blindbox.html)、[pages/overlays/overtime.html](../../../public/pages/overlays/overtime.html)、[pages/overlays/lyric-window.html](../../../public/pages/overlays/lyric-window.html)、[pages/overlays/opening.html](../../../public/pages/overlays/opening.html)、[js/overlays/](../../../public/js/overlays)、[css/overlays/](../../../public/css/overlays)

本文档描述各个叠加层页面的框架、数据消费与各自 UI。快照字段与消息类型见 [ws.md](../backend/ws.md),客户端通信行为见 [comms.md](comms.md),页面入口 URL 见 [pages.md](pages.md) §2,加班机领域状态见 [backend/overtime.md](../backend/overtime.md)。

### Overlay 模块边界

| 门面/入口         | 内部模块                                                                       | 所有权边界                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `queue-render.js` | `queue-theme.js`                                                               | render 拥有队列 DOM；theme 只映射设置到 CSS 变量并由 render 兼容再导出                                          |
| `gift-effects.js` | `gift-effects-frame.js`                                                        | 入口拥有 WebSocket、去重、队列和装饰粒子；frame controller 只拥有边框 DOM/WAAPI 时间线                          |
| `games.js`        | `games-drawing.js` / `games-drawing-geometry.js` / `games-drawing-controls.js` | 入口拥有游戏会话和通用结果，games-session.js 负责增量与快照排序；drawing 拥有画板同步，geometry 是纯形状/颜色计算，controls 只适配画板启停与撤销状态 |

这些模块均由页面以 ES Module 加载；内部模块不得自行创建第二条 WebSocket 连接或重复持有会话状态。

## 1. 悬浮层框架

### 1.0 本地页面权限与数据投影

本地展示页面各有独立的 `overlay` 身份，不能调用其他页面或管理端的接口。固定页面地址仍可作为 浏览器源打开；服务端只在该页 HTML 中注入本次运行的页面凭据，管理凭据不进入 HTML。`songlist` 对应 `songs.html`，`lyrics` 对应 `lyric-window.html`，其余 scope 与同名 HTML 对应。`/pages/overlays/<文件名>` 原始地址和 `/<scope>` 使用相同权限与响应头；`/songs` 仍是管理入口。

签发及精确路径/方法白名单由 [access-policy.js](../../../src/server/access-policy.js) 拥有，受限操作由 [overlay-http.js](../../../src/server/overlay-http.js) 适配。REST、初始快照、合并快照及所有 WS JSON 出口统一经过 [overlay-projection.js](../../../src/server/overlay-projection.js)。投影逐层选取已列出的标量、对象及数组字段；新增 owner 字段和新增设置不会自动对展示页开放，不能直接展开整个 `state` 或 `settings`。管理请求保留原 DTO。

所有页面允许 `GET /api/state` 作为凭据恢复探测，但只返回下表中的本页投影；无快照消费者的页面得到空对象，不据此向全局快照加入游戏或转盘。表中 GET/POST 路径均省略 `/api` 前缀，头像代理仅开放给实际展示头像的四页。

| Scope | 专用 HTTP 读取与允许操作 | 快照字段与专用 WS 消息 |
|---|---|---|
| `queue` | 无 | `queue.current/waiting` 的歌名、请求者显示名、置顶与大航海/灯牌展示字段；`superChats.message/price`；本页主题设置 |
| `songlist` | GET `/songs`，服务端固定 `enabledOnly: true`，保留分类筛选 | 本页歌单主题设置；歌曲仅 `id/name/artist/category_name/language/name_initial` |
| `blindbox` | GET `/gifts/blind-box-stats`，保留 `boxName` 筛选 | 本页主题设置；统计仅盒数、总成本、总盈亏及榜单显示名/盒数/盈亏 |
| `overtime` | 无 | `overtime` 的 revision、状态、服务端时间、有效余时、背景与展示规则；`overtime:update` 的同一状态及结算动画字段 |
| `gift-effects` | 无 | `giftEffectDanmakuEnabled`；`gift:frame` 的礼物铭牌/特效身份字段，`gift:effect` 的播放 URL 与 RGB/alpha 布局，`gift:guard-thanks` 的等级/昵称/月数/头像/文字模式 |
| `gift-feed` | GET `/gifts/display-settings`、`/gifts/history`、`/gifts/card-profiles`、`/overtime/gifts/catalog`、`/bilibili/avatar` | `gifts.viewRevision` 与刷新 reason；`gift-catalog:update` 仅为失效通知，不附完整目录 |
| `gift-sprint` | 无 | `giftSprint.targetRmb/remainingCrystalBalls`；月底冲刺文字版直接使用既有服务端折算数量，未设目标或断线时清空文字，重连恢复；页面 `/gift-sprint`，`preview=1` 显示底色与提示 |
| `gift-export` | GET `/bilibili/avatar` | 无业务快照或专用消息；导出行、配置和目录由 Electron main 的冻结输入提供，不授予流水选择或导出 IPC 权限 |
| `lyrics` | 无 | 本页歌词设置、`lyricState/lyricTimeline`；`lyric-state/lyric-timeline` 仅含曲名/艺人、行词文本与时间、播放/排序状态 |
| `games` | GET `/games/session`、`/games/winner-profile`、`/bilibili/avatar`；POST `/games/session` 仅 `stop/restart`，`/games/session/move` 仅数字/坐标字符串，`/games/session/draw` 仅 `append/undo/clear` | `game:update` 的完整公开游戏态、`game:patch` 的聊天/状态增量、`game:draw` 的画笔操作；兼容已存在的 `state.games`，不新增全局字段 |
| `danmaku` | GET `/bilibili/avatar` | `danmakuFeed`、`liveStatus.enabled/roomId/connected/message`、`danmakuOverlayStyle/danmakuFullscreenDurationSeconds`；`danmaku:message` 仅展示消息、身份、头像与表情字段 |
| `wheel` | GET `/wheel`；POST `/wheel/spin` | `wheel:update`；仅候选标签/权重、抽取时序/索引及上次结果索引 |
| `opening` | GET `/opening/config` | 无；配置仅启用、文案、画质/轨道/音符/均衡器、音频开关/音量及当前音频/人物图 URL |
| `clock` | GET `/clock/config` | 无；仅 `style/showDate/showSeconds/hourFormat/label/flipFrameColor/flipFaceColor/flipTextColor` |

本日礼物的服务端读取固定北京时间今天、每页 100 条、按创建时间升序；页面只能传分页 cursor 和 viewRevision，不能扩大日期、来源或筛选范围。返回仅保留 `viewRevision/nextCursor/partial`，以及横幅需要的 `eventId/artworkPath` 和礼物显示名、礼物 ID/变体、币种、单价、数量、头像、大航海等级。目录仅保留礼物 ID/名称/变体和本地图片路径，不暴露来源配置、同步状态或完整流水元数据。

游戏投影按游戏类型逐字段选择。数字炸弹的隐藏数字、你画我猜的未揭晓词条/别名和管理态不对展示页开放；只有领域状态已经 `answerRevealed: true` 才传递 `revealedAnswer`。公开弹幕保留观众实际发送的文本。落子不能携带对象形式的主持控制指令，开始/配置游戏和转盘、提前揭晓/切换题目仍属于管理端。

设置字段表以投影模块中的显式键为准，并覆盖共享消费者：队列保留通用主题、序号/置顶/六条规则及各风格字体和滚动键；`storybookQueue`、`neonVinylQueue`、`cherryRibbonQueue`、`goldenLilyQueue` 仅允许 `FontSize/FontFamily/FontWeight/UseCustomTextColor/TextColor/ScrollMode/ScrollSpeed` 七个已消费后缀，旧 `illustratedQueue*` 仅保留现有兼容回退键。歌单保留独立 `songBoard` 设置及共享主题回退键，盲盒保留自身标题与通用主题，歌词保留 `DESKTOP_LYRIC_DEFAULTS` 对应的 51 个展示键。不得将任意同前缀的新键视为已授权。

每个 overlay HTML 响应都使用 `Content-Security-Policy: sandbox allow-scripts`，不允许 `allow-same-origin`；直接打开和嵌入管理预览都处于 opaque origin，不能访问父 frame 的 DOM、fetch 或凭据。预览父页通过 `postMessage(..., '*')` 发送展示配置，子页核对 `event.source === parent` 及管理页服务 origin；当前 overlay 与共享渲染器不依赖 localStorage、sessionStorage 或 IndexedDB。

静态脚本、样式、字体和图片可跨 opaque origin 加载，HTML 不开放 CORS 读取。API 只为允许的页面路径/方法接受 `Origin: null`，实际请求仍验证页面凭据；预检不授予身份或管理权限。引导脚本只给同一服务的 `/api/` 和 `/ws` 附加本页凭据，401 或 WS 关闭后最多合并一次 `/api/state` 探测，确认旧凭据失效才重新加载页面。`topic=danmaku` 只缩小订阅，不能扩展 scope；overlay 的 WS 文本/二进制业务入站帧关闭为 1008，正常 ping/pong/close 保留。`shutdown` 对所有 scope 仅包含类型和原因。

### 1.1 通用模式

所有叠加层:

- **透明背景**:`html,body` 透明(`overlays/base.css`),只渲染卡片面板,供 浏览器源叠加;加班机层独立样式(整屏倒计时)。
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
**特效 1 · 林间花信**（`themeId: woodland-bloom`）播放本地 `woodland-bloom-v4.webm`，
1920×1080、30fps、4 秒，具有真实 VP9 Alpha。四边 0–0.6 秒同步入场，0.6–3.6 秒完整动态展示，
3.6–4 秒同步退场；母版植物与挂饰动作已包含在视频内。`gift-effects-frame.js` 使用原生 video 播放，
不再逐帧重绘植物。视频与文字共享 1920×1080 舞台，按视口短边等比缩放并居中，不拉伸。
中央 (130,104)–(1790,944) 保持透明。铭牌在 (574,946)，文字区域在 (676,959)，大小 568×81；
两行依次为“感谢 {昵称}”“送出 {礼物名} ×{数量}”，由 `textContent` 写入；不显示金额。
文字跟随视频时间淡入/淡出，完整展示阶段固定；长文字先适量减小字号，再省略尾部，数量独立保留。
公开 WebM 由 `static-video.js` 支持 Range/HEAD，以保证 Chromium 能从首帧重复播放。

`gift-frame-queue.js` 负责自定义边框的 FIFO 队列：1 条播放、最多 50 条等待；当前播放不被插队或打断，
满队列忽略新事件，已排队项不因等待时长失效，也不按金额排序。实时与预览均按 eventId 去重，
预览接口每次生成独立 ID。只接收目前支持的特效身份；后续特效的参数与播放器由其各自模块拥有。
加载允许 10 秒，媒体进度停滞 5 秒触发清理；加载耗时不扣减正常的 4 秒动画。
正常结束、解码错误、播放拒绝、超时和 pagehide 都释放回调/计时器并清空画面；错误后后续事件重新加载媒体并推进队列。
旧静态图、挂饰、Canvas 粒子和 frame motion 模式已移除；URL motion 仍只影响大航海感谢。
`gift:effect` 官方特效的独立播放器和队列保持既有行为。

**大航海感谢**：同一页面在 `#guardThanksRoot` 消费 `gift:guard-thanks`，由 `overlays/gift-effects-guard.js` 按 eventId 去重（预览不去重）、逐条播放，最多 12 条等待、等待超过 90 秒丢弃，队列满时舍弃最早的最低等级；有等待时缩短停留。渲染器 `shared/guard-thanks-card.js`（徽记 `guard-thanks-emblems.js`、粒子 `guard-thanks-particles.js`、样式 `css/shared/guard-thanks.css`）同时供管理页预览使用：1280×1080 设计舞台按 `min(宽/1280, 高/1080)` 居中缩放，舰长/提督/总督分别为蓝色船锚、紫色罗盘、红金船舵，依次播放冲击波与闪光、徽记入场、头像徽章描边、丝带标题逐字弹出与扫光、标语和感谢铭牌，并有对应的气泡/星芒/彩纸余烬粒子。入场 1.5 秒，停留 3.3/4.0/5.0 秒，退场 0.7 秒；所有 WAAPI 动画、计时器和画布帧都有限且在会话结束时清理。头像只直连 HTTPS hdslb 地址（`no-referrer`），失败或缺失时显示昵称首字，预览使用内置样例头像；文字支持中英双语、中文、英文。`?motion=reduced` 或系统减少动态效果时只淡入淡出；`?preview=1&guardPreview=<tier>` 可在页面内单独预览。

### 1.5 开播动画(`/opening`)

开播页使用本页凭据从只读接口 `GET /api/opening/config` 读取已保存设置，独立浏览器源在每次读取结束
1 秒后再次读取，关闭画面时也继续同步以支持重新开启。请求不重叠，5 秒超时，失败保留最后有效配置，
pagehide 取消请求与定时器。页面不新增 WebSocket 订阅。Admin 预览 URL 可用
查询参数临时覆盖设置。`trackMotion` 仅接受 `heart`、`barber`、`progress`，查询参数优先于
保存值，非法值回退 `heart`。三种模式复用同一条 SVG waveform：心形的位移和显隐使用同一条
SVG 时间轴，启用画面时统一归零并从首轮立即移动；
灯带用金色短划线连续偏移，流光用单段粉色 dash 沿整条路径循环；任何时刻只显示一种前景
动效，不创建任意 CSS/SVG 输入面。页面隐藏、低画质或 `prefers-reduced-motion` 时暂停或停用
连续轨道动画，隐藏后恢复仍检查低画质和减少动态效果，固定 `/opening` 地址本身不携带配置。人物图和音乐默认均为空；Admin 可上传
PNG/JPEG/WebP 和受支持的音频，Overlay 只接受受限的 `/opening-character/`、`/opening-media/`
当前文件 URL。未上传或清除后隐藏人物图并移除 src，不加载或播放空音频地址。

Admin 预览使用与管理页同 origin 的 sandbox iframe，固定 浏览器源地址仍规范化为 `127.0.0.1`。
首次加载及 iframe load 后发送最新 `lira:opening-preview-config`，只接受同 origin 的直接父窗口消息；
收到预览配置后由父窗口负责更新，不再重复轮询。晚到的初始读取不得覆盖正在编辑的值。
文本、音量、轨道和画质变化就地应用；只有更换音乐、关闭或重新开启画面才重新加载相应音频。
相同配置不重建节点或重置轨道，粒子节点仅随画质变化重建，不再运行未使用的粒子变量定时器。
素材上传/清除同样增量更新预览，关闭总开关仍卸载预览 iframe；设置保存合并并串行执行，重复值不再写入。

没有人物图时使用居中文案构图；人物存在时保持左文右图。主标题最低 `3.4cqw`，允许长标题换为两行，
无人物时最低 `4cqw`；页脚为 `1.25cqw`。文字与无人物构图由 `opening-layout.css` 拥有。
“氛围律动”为固定节奏装饰，不表示实时音频频谱；保存键仍为 `openingShowEq`。

### 1.6 本日礼物 `/gift-feed`

`shared/gift-card-model.js` 同时供滚动展示和导出运行时派生卡片：仅对北京时间今天的记录，按送礼人 UID、相同礼物 ID 和礼物名合并，累加数量及各条历史单价乘数量的整数分金额，颜色按合计金额计算。身份来自 `/api/gifts/card-profiles`，对同人今日全部卡片使用最新已知昵称、头像及大航海等级；null 不覆盖已知等级，0 明确移除头像框，同等级续费保留未变化的卡片节点。未知 UID 不按昵称合并，旧日期和原始流水保持独立。导出只合并所选记录，资料更新可使用今日未选记录的证据。滚动阈值按合并后的卡片数计算，稳定分组键保留滚动锚点；资料暂不可用时预览说明未完成身份合并。

礼物助手的滚动礼物面板生成当前本地端口的 `127.0.0.1/gift-feed` 地址，`?preview=1` 只增加预览底色和状态。页面独立于管理面板生命周期，按北京时间遍历今天全部分页，包含未参与冲刺的有效付费历史。“最小礼物金额（元）”支持整数或一位小数，默认 0 不限制；正数在完整分页、合并卡片后按 `cardTotalCents` 严格大于门槛过滤，未知 UID 独立记录按历史单价乘数量计价，比较使用整数分。该过滤只作用于滚动集合，不改变历史记录、分色金额或图片导出；配置契约见 [API 设置端点](../backend/api.md)。`gift-feed-state.js` 用 eventId 去重并保留轮播锚点；默认 3 行、速率 12（每行 3.9 秒），速率 1–50 线性对应每行 `5000 - (scrollSpeed - 1) * 4900 / 49` 毫秒。过滤后的条目超过显示行数时连续匀速向上滚动，最后一条紧接第一条；不足或刚好填满时静态显示，不复制填满。动画按帧时间累计位移，换行保留余量，无间隔等待，DOM 只保留可见行及最多一条动画缓冲，并复用未变化的节点。页面隐藏时释放动画帧，恢复后接着当前位置移动。暂停和低功耗选项已移除。

WebSocket 通知合并后重读，并每 30 秒对账；刷新保留滚动进度，新集合在换行边界应用，静态或隐藏时立即更新。礼物通知只重读礼物与身份资料，设置、素材分别在对应失效通知时读取，首次加载、重连及定时对账补读两者；请求期间收到的失效通知合并到下一批。横幅按稳定卡片键插入或复用，`updateGiftBanner` 就地更新数量、颜色、名字、头像与舰队框，只在文字改变时重新测量字体，成功图片不随连击重建。滚动换行先移除离开的行，再插入新的缓冲行，避免搬动仍可见的节点；重复通知且展示资料未变时没有 DOM 写入，失败头像仍可单独重试。午夜、来源切换或投影代次变化清空旧集合，迟到请求不得恢复旧来源。保存配置即更新静态行颜色。`shared/gift-banner.js` 和 `css/shared/gift-banner.css` 同时拥有管理预览、PNG 和 直播画面的横幅：基础尺寸 560×96，包含头像占位、可空大航海边框、昵称、黄色礼物名、本地 WebP 和数量。颜色条的圆弧左端与头像同心，头像四周留 10 像素内距；昵称区、颜色条和 WebP 位置固定，数量保持字号并只向右扩展画布。PNG 按实际画布的 2 倍尺寸导出，基础宽度 1120 像素，合并时取本页最宽横幅；浏览器源建议宽度 900，以容纳多位数量。金额/时间/备注不进入横幅。

## 2. 队列叠加层(/queue)

[overlays/queue.js](../../../public/js/overlays/queue.js) 渲染 `state.queue`(current + waiting)与 `state.superChats`:

HTTP 初始/重连请求带本页读取代次，较新的完整 WS 状态使旧请求失效。HTTP 与 WS 共用内容指纹；延迟补数和重连取得相同内容时保留节点及滚动进度。

- **六种风格**:`classic`(默认,经典卡片列表)、`identity`(身份版,观众名突出,含 SC 置顶区)、`storybook`(奶油蓝插画画框)、`neon-vinyl`(甜粉麦克风舞台)、`cherry-ribbon`(紫金星月梦境)与 `golden-lily`(奶油金唱片铃兰);由设置 `overlayQueueStyle` 决定,遗留 `festival` 归一为 `identity`,未知值回退 `classic`。样式由 `overlays/base.css` 导入的 `.queue-*` 主题类承载。
- **风格 3**:框体与词条素材位于 `public/img/overlays/song-board-style-3/`;原始框体保留 alpha,`.queue-storybook::before` 在框内开口后叠加不透明白层,框外仍透明。词条黄色端点恒显示队列序号,浅蓝固定宽度区域复用身份版的歌名、点歌人、大航海/灯牌名与灯牌等级格式;没有大航海或灯牌时省略对应字段。内容实际宽度溢出时由 `scheduleIdentityContentScroll` 在该区域内左右往返,不会扩张词条素材。纵向超出画框时复用身份版的循环/往返滚动测量。
- **风格 4 / 5**:各自的框体与词条素材位于 `public/img/overlays/song-board-style-4/` 和 `song-board-style-5/`;框体和词条素材自带粉色或紫金渐变底色。两种风格隐藏通用顶部标题和点歌顺序数字,省略四组字段的说明标签并将短内容居中。每条记录输出歌名、点歌人,并在有数据时输出大航海等级、灯牌名与等级;没有大航海或灯牌时省略对应字段。大航海身份按总督红、提督紫、舰长蓝区分,同一条记录后接的灯牌名与等级徽章沿用该身份色;无大航海时才使用灯牌自身等级色。整组内容实际宽度溢出时复用 `scheduleIdentityContentScroll` 左右往返,纵向超出画框时复用插画风格滚动测量。风格 4 的列表下边界与前景底边内沿对齐,保证滚动终点的最后一条完整露出;风格 5 的列表窗口顶部与首条词条上边缘对齐、底部收进 30px。`prefers-reduced-motion` 下停用横纵动画。
- **风格 6**:奶油金唱片铃兰框体与横向词条素材位于 `public/img/overlays/song-board-style-6/`;词条以内容窗宽度的 72% 居中,完整收进画框的左右前景边框之间,列表上边界位于画框高度的 16.5% 以完整露出首条顶部装饰,相邻卡片以 `4px` 间距清晰分开,左侧花形圆圈显示从 1 开始的队列序号,右侧固定信息窗省略说明标签并输出歌名、点歌人,在有数据时输出大航海等级、灯牌名与等级;没有大航海或灯牌时省略对应字段。大航海与后接灯牌徽章使用和风格 4/5 相同的总督红、提督紫、舰长蓝身份色,无大航海时保留灯牌等级色。信息窗内容实际宽度溢出时复用 `scheduleIdentityContentScroll` 左右往返,纵向超出画框时复用插画风格滚动测量,列表下边界停在第 4 个序号附近;`prefers-reduced-motion` 下停用横纵动画。
- **风格 4–6 的画框层级**:完整框图作为底层保留中间色块,卡片与文字位于中层,同一框图去掉中心填充后以 `border-image` 作为顶层装饰。卡片滚动时会从丝带、花朵、唱片等边框装饰下方经过,但始终显示在框内中间色块上方。
- **六种风格的浏览器源缩放**:六款点歌板都在固定设计坐标中完成排版(`classic` 宽 405px、`identity` 宽 430px、插画风格宽 560px),内部背景、框体、词条、文字、徽章、间距和裁切窗口不随浏览器源单独重排。`queue-viewport.js` 在面板完成渲染后按浏览器源可用宽度与高度分别计算比例并取较小值;风格 1、3–6 可随浏览器源整体放大或缩小,风格 2 将最大倍率限制为 `1`,在较大的 浏览器源画布中保持默认 430px 宽度,仅在画布不足时等比缩小。源比例与点歌板不一致时在未占满的一轴保留透明空白,不拉伸图片或文字。风格 3 的列表窗口仍在设计画布内整体上移 10px,为最底部可见词条保留安全距离。
- **风格 3–6 的词条缩放**:词条盒、位图、文字窗口和序号共用同一坐标系,不通过裁剪去掉上下装饰。风格 3 在 CSS 背景坐标中排除原 PNG 顶部和右侧的大块透明留白,不改写原始素材;风格 4/5 的完整 PNG 占内容窗宽度的 94%,风格 4 使用 `2172:517.5` 显示比例(高度为此前的 115%),风格 5 的显示高度为素材原比例的 80%;风格 6 使用完整 PNG 比例占 72%,三款列表起点都避开画框顶部前景装饰。
- **滚动**:classic 走 CSS 动画滚动(`classic-scroll` 循环 + `scrolling-bounce` 有节奏往返模式,loop clone 双份列表实现无缝循环),读取 `queueScrollMode`/`queueScrollSpeed`;identity 读取 `identityQueueScrollMode`/`identityQueueScrollSpeed`;风格 3–6 分别读取 `storybookQueue*`、`neonVinylQueue*`、`cherryRibbonQueue*`、`goldenLilyQueue*` 的滚动模式和速度。六种风格都在固定设计高度的列表窗内测量真实内容溢出,浏览器源 resize 后 `relayoutQueue` 重新配置并再次同步整板比例;重渲染时 `captureScrollAnimation/restoreScrollAnimation` 在 rAF 帧内恢复 CSS 动画进度,不跳帧不闪动([queue.js:174-202](../../../public/js/overlays/queue.js#L174-L202))。
- **低功耗**:`overlayLowPowerMode` 或 `?quality=low` 时停用毛玻璃/辉光等重特效(`.overlay-panel.low-power` 面板级降级,classic/identity 共用,[foundation-and-classic.css](../../../public/css/overlays/base/foundation-and-classic.css))。
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

- 背景层 `#overtimeBackground`(+ 半透明遮罩 `.overtime-background-shade`):按 `background.path`/`background.fit`(cover/contain/fill)设置图片,内置背景见 ADR [0005](../../architecture/adr/0005-built-in-overtime-backgrounds.md)。
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

- 时钟字号:**8.5em × 2cqmin = 17cqmin** 等比缩放(`font: 700 8.5em/0.9 Bahnschrift SemiCondensed,…` + `tabular-nums`,[overtime.css:94-100](../../../public/css/overlays/overtime.css#L94-L100));管理页预览时钟为 `clamp(42px, 5vw, 70px)`([console.css](../../../public/css/admin/overtime/console.css))。
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

- 使用方:管理页「复制桌面歌词」复制规范地址 `/lyrics`,供浏览器或 浏览器源使用;页面背景透明,实际输出不包含管理页预览使用的网格/纯色辅助背景。
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

桌面工具和直播画面地址使用服务器认证响应提供的完整 `/overlay/<token>` 链接。`server-overlay-url.js` 处理账号与授权状态；`danmaku-overlay-settings.js` 通过原受限IPC读取/保存展示配置，编辑仅为草稿，迟到回包不覆盖新编辑或新账号。

“预览与调整”由 `admin/danmaku-canvas-dialog.js` 提供组件描述，经 `component-preview-dialog.js` 打开系统浏览器中的场景编辑器。其 `/danmaku?preview=1&componentPreview=1` 子 frame 保留 `sandbox allow-scripts`、opaque origin，不能访问父页凭据/preload；网页修改经临时组件会话返回客户端原控制器，保存仍经主进程 IPC。关闭销毁 frame 和消息监听但保留共享草稿；账号切换使旧会话及迟到保存响应失效。旧服务器缺 layout 字段时提示更新。独立导入可选本机组件源或原在线源；在线源在关闭客户端后仍可接收。

独立弹幕的布局契约由 `shared/danmaku-layout.js` 定义为 `{canvas,contentScale,regions}`，与 main 和服务器镜像保持一致；公共分辨率预设由 `shared/canvas-presets.js` 提供1280×720、1920×1080默认、2560×1440、3840×2160、1080×1920及自定义（320～7680整数）。九种样式各自记忆 `{x,y,width,height}`；六种固定默认距左/下40，尺寸依次为bubble380×560、signal560×600、minimal380×540、ranked640×640、transparent520×540、identity640×560；outline/cream/glow默认铺满，称“区域随机”。独立弹幕区域至少64×64且不能超出其画布；统一编辑器的三栏布局及公共图层操作见下方组件系统说明。

固定样式按当前区域宽度相对该样式默认宽度的比例，统一缩放文字、头像、卡片、装饰和间距；区域高度通常决定可见条数，移动区域不改变外观；特别矮的区域限制整体倍率，确保内边距后仍有内容空间。礼物与SC卡片在设计空间内先适配扣除两侧各12px后的可用宽度，再随区域一起缩放，避免窄区域裁掉数量或图片。随机样式以contentScale为倍率上限，窄区域同时缩小内容，保证头像和装饰仍有排版空间。固定与随机样式都会将超出可用宽高的单条消息整体缩小，尺寸恢复后重新按自然大小排版；长昵称、礼物名、数量和金额允许换行，不以省略号代替内容。区域越小，文字也越小；消息过多时仍按原规则整条移除最旧消息。同比改分辨率会同比改变区域和contentScale；换宽高比保留contentScale，未调整的默认区域继续靠左下，自定义区域收敛到新边界，原铺满区域继续铺满。styleOptions保存逻辑字号，独立编辑器的画布字号使用当前实际内容倍率换算。`overlays/danmaku-canvas.js` 与服务器使用同一CSS变量/坐标规则，正式页等比居中、透明且不含选框。网页来源尺寸与画布一致即可精确还原位置。旧配置layout:null继续使用原来源窗口布局，旧PUT省略layout不清除已保存画布，首次显式应用编辑器才启用新画布。

### 本地页面 /danmaku 与示例

`overlays/danmaku.js` 与 `danmaku-preview.js` 复用既有九种样式和feed。预览随机混播内置弹幕（总督、提督、舰长、粉丝、普通观众和主播表情）、送礼通知及当前样式支持的 SC；首条立即出现，后续每隔 0.8～2.2 秒随机追加一条。每轮不重复抽取，全部样例播放完再开始新一轮，每条生成新消息ID和时间戳。复用正式feed的滚动、区域裁剪、随机排布和停留时间过期；可手动“重新播放”，切换样式或参数重新演示。页面隐藏时暂停，恢复时继续播放而不补发积压消息；关闭页面清理播放计时器、可见性监听、待渲染帧和feed。不连接WebSocket。素材本地，不发外部图片请求。单独打开时兼容初始style/styleOptions/时长query并通过可用的history保存草稿；嵌入时由受信父页保留草稿。经典样式、头像横卡在画布模式共用区域内容倍率，避免再次缩放；旧非画布模式保留原600px基准缩放。

小表情 `kind:inline` 无论夹在文字里、重复发送或单独发送，图片高度均为正文的 `1em`；整张表情包 `kind:sticker` 使用原尺寸的 1.4 倍，即普通样式 `4.48em`、经典样式与头像横卡 `5.74em`，宽度按原比例并受现有画布限制。缺少 kind 的旧载荷仍沿用整条匹配时放大的兼容分类。预览文字示例显式标记 inline，纯图片示例标记 sticker。

保留的非预览本地入口以 `topic=danmaku` 连接 WebSocket，按 snapshot 的 `settings.danmakuOverlayStyle` / `danmakuFullscreenDurationSeconds` 切换样式和停留时间，从 `danmakuFeed` 恢复消息并消费 `danmaku:message`。按消息 `id` 去重，同一帧批量追加；连接中断时指数退避重连，连接状态仍以 `liveStatus` 为准。客户端复制和打开的正式 浏览器源地址由服务器提供，本地预览不改变服务器配置。

本地页面对去重、截取最近 50 条后的消息内容做完整比较。内容未变且 feed 无需初始化时，快照保留现有消息节点、到期计时器及尚未绘制的增量帧；仍更新直播连接状态。首次空快照、实际消息修正/清空/重连补数、样式或全屏期限变更导致的 feed 重建仍执行恢复。此优化不改变远端正式 overlay 的 SSE，也不承诺有变化的快照完全免于重建。真实页面模块和共享 feed 的节点/计时器回归见 `test/danmaku/danmaku-snapshot-stability.test.js`。

弹幕工具的显示顺序为直播链接、黑名单与屏蔽词、样式选择、参数调节、应用操作。`danmaku-style-options.js` 定义各样式字体、正文字号范围、背景不透明度及礼物插画选项；无底色样式不显示底色参数，蝴蝶结与流光气泡没有独立礼物图位。`styleOptions` 由服务端按样式保存，Electron 仅通过既有认证通道校验和投影；旧服务器不支持时禁用新参数并提示更新。切换样式保留各自草稿，恢复默认只重置当前样式，仍需显式应用。六种固定样式另有“滚动方向”：up 为从下向上（默认），down 为从上向下；方向随当前样式草稿保存、传给本地预览并在应用后通过服务器推送更新。随机样式隐藏且不接受该参数；反向排列仍淘汰最旧消息。原有全屏停留时间位于参数区。

`shared/danmaku-appearance-draft.js` 为管理页和场景编辑器提供字段转换、当前样式草稿更新、重置及停留时间检查；两端保留各自 DOM、授权与保存状态，画布字号换算仍归预览控制器。样式名称、支持名单与随机布局能力由 `shared/danmaku-style-options.js` 的样式表统一提供。

预览参数传递与草稿保留方式如上，样式切换不清除其他样式的区域或参数。原图模式使用内置合成礼物图片，不请求直播或外部图片。正式服务器浏览器源从已有礼物目录取得精确已结算版本的 B 站图片地址，经可选 `giftImageUrl` 随原 `gift` 事件传递；浏览器直接加载，使用 `no-referrer`，失败保留样式插画。服务器不转发图片二进制；缺少新字段时行为兼容。正式协议和各样式边界见服务端 `public-overlay-api.md` / OpenAPI `OverlayStyleOptions`。

页面与 `/games` 的画猜消息共同复用 `danmaku-feed.js` DOM 组件。组件不读取 WebSocket 或领域状态，只接收显式消息数组和图片 URL resolver：

- 三种随机样式在本地预览和正式直播的停留时间最后 400ms 原地渐进淡出，曲线为 `cubic-bezier(0.4, 0, 1, 1)`，不延长总停留时间。减少动态效果或不支持原生动画时按期直接清理；移除、重绘和销毁时取消淡出动画及计时器。
- `measureDanmakuText(message)` 按中英文混合文本的视觉长度估算行数、宽度百分比和最小高度。
- 透明文字风格在头像下沿居中显示 `LV{medalLevel}`，复用消息渲染器从本条消息的独立 `medalLevel` 写入头像数据属性；缺少灯牌名称不影响已知等级。缺失、零或非法等级不显示，不从舰队身份推算，也不复用上一条消息的等级。该风格不再在正文下重复显示粉丝牌；其他风格沿用原徽章。
- `kind:'gift'` 使用专用 `is-gift` 节点，以 `textContent` 展示送礼人、“送出”、礼物名称和数量。登录账号发送的感谢按普通弹幕渲染，不转换成礼物卡，不额外生成感谢文案，也不提供单独的感谢示例。除保持原样的蝴蝶结外，礼物采用与普通聊天不同的排版和造型：聊天气泡为奶油色猫咪插画卡（昵称首字圆章、莓红数量胶囊），信号带为带 1px 青色切角描边的墨蓝通知牌，经典样式为带接缝线的礼章票券，透明文字的礼物使用带细金边的深蓝渐变星光卡，身份横卡为无头像的单栏双线框纪念卡，简洁白卡为带虚线分隔的玫瑰色礼物小票，奶油气泡为花束礼物卡，流光气泡为同色高光弧的紧凑通知卡。除蝴蝶结外，礼物卡入场时额外播放一次 ≤360ms 的光泽扫过（`::after` 只改变背景位置和透明度，不改变入场方向、时长或布局，减少动态效果时不播放）。选择“礼物原图”且图片加载成功时，插画节点加 `has-image`，清除样式插画的 mask 和背景，原图不会被裁成线框；加载失败恢复样式插画。除蝴蝶结外，送礼通知使用紧凑的两行结构：昵称在上，“送出＋礼物名”和数量在下一行，不显示“谢谢支持”。`gifts.css` 仅复用内容结构，各风格文件拥有配色、轮廓和装饰；插画仅用于适合的样式。素材全部内置于 `public/img/overlays/danmaku-gifts/`，各风格不复用同一礼物图。该展示能力不新增公开 SSE 事件或礼物业务处理链路。
- 本地预览使用场景编辑器，按可用视口等比缩放。消息在当前样式的区域内动态展示；固定样式按区域高度移除最旧的超限消息，随机样式沿用正式直播的随机布局和寿命。样式切换重新播放，地址不变。
- 透明文字和奶油气泡礼物卡通过 `showGiftTotal` 选项把数量放在礼物名旁边，原数量位置显示 `giftTotalPrice`（人民币元）的 `¥` 金额，最多两位小数。金额直接来自已结算总额；旧消息缺失金额时显示 `—`。奶油气泡沿用右侧粉色金额框，名称旁的数量不带底框。其他样式继续显示原数量布局。本地预览使用合成总额，正式 overlay 消费服务器同名展示字段。

- 旧非画布布局的固定礼物卡中，`bubble` / `signal` / `ranked` / `transparent` / `identity` 沿用原客户端 1.5 倍尺寸上限（460px 设计宽度 → 690px 显示宽度）。扣除两侧各 12px 后的空间不足时，卡片、昵称、礼物文字、数量或金额、头像、装饰和间距一起等比缩小；高度通常影响可见条数，单条过高时再整体缩小。经典样式和头像横卡抵消列表已有倍率，避免重复缩放。列表裁剪计入节点自身的 CSS zoom；蝴蝶结、普通弹幕及全屏随机礼物同样在单条超出可用区域时整体缩小。画布布局使用上面的区域整体缩放规则，本地预览与正式 overlay 同步。

- `createDanmakuFeed(root, options).render(items)` 使用 `DocumentFragment`、`textContent` 和受控 `<img>` 创建消息，`append(item)` 只追加新节点，不重建已有 DOM。游戏层继续按估算高度保留当前可见区及上方约 5 个视口并自动滚到底部；固定 `/danmaku` 配置 `offscreenViewports: 0`，按实际布局高度、行间距和容器内边距移除最旧的超限节点，保留完整可见消息。固定区域和全屏模式的 `ResizeObserver` 同时观察容器与消息，图片加载、昵称换行或窗口缩放后在动画帧内合并测量与调整，使用不受入场动画缩放影响的布局尺寸。节点移除或替换时取消观察，销毁时取消布局帧和到期计时器。表情按精确触发文本切分，加载失败回退原触发文本，不使用 `innerHTML`。页面数据和断线恢复快照仍分别硬限制为最近 50 条，共享组件默认上限仍为 120 条。
- 流光气泡（`glow`）将发送者昵称居中放在消息框上方，文字或表情在深色半透明圆角框内，边框带双层柔光，并在 2px 边框上叠一段静态白色高光弧（按 `data-tone` 取四个角度，不循环播放；不支持 mask 合成的内核省略高光弧），不显示头像/徽章。`ranked-palette.css` 为它和经典样式提供同一份身份色，普通观众/粉丝青蓝、舰长蓝、提督紫、总督红、主播绿色覆盖优先。本地预览与正式直播共用随机布局与时长，礼物采用同色紧凑双行通知卡。
- 经典样式（`ranked`）通过独立 `data-streamer` 标记将主播名字标签和正文气泡设为绿色，并隐藏主播船锚；普通观众保持青蓝色。可选 `isStreamer` 只由当前房间主播 UID 与本条发送 UID 比较产生，缺失按 false；本地 B 站消息入口、feed 投影和服务器 SSE 均保留该展示语义，不公开新增 UID，也不改变其他风格的 `data-identity`。本地纯表情示例同时展示主播身份。
- 共享组件按当前房间身份为每条消息输出 `data-identity=viewer|fan|captain|admiral|governor`；大航海身份优先，拥有大航海且佩戴当前房间灯牌时仍同时输出两枚徽标。五套固定弹幕姬只共享该语义，不共享身份视觉：`signal` 使用分级信号色、左侧强调色晕染、舰长/提督/总督实色标签和“名称｜等级”分段粉丝牌，`bubble` 使用 20/20/20/6 圆角的午夜玻璃气泡、头像双圈、粉丝牌胶囊和柔和分级光晕，`minimal` 不绘制左侧色条，普通观众省略身份签，粉丝与大航海身份保留单字身份签和低遮挡分级色；`ranked` 隐藏徽标，以普通/粉丝共用的石墨灰及舰长蓝、提督紫、总督金四档整卡底色表达身份，用户名和正文在左、头像在右；`transparent` 不绘制卡片底色、边框或大航海徽标，保留头像右侧的昵称、正文和下方粉丝牌等级，并用蓝、紫、红色昵称区分舰长、提督、总督。`outline` 虽保留同一 DOM 身份字段以兼容共享组件，但 CSS 统一隐藏头像、徽标和灯牌；卡片使用浅白半透明底、18px 圆角和分层柔和阴影，昵称前的身份色圆点与昵称颜色一致：普通观众灰色，大航海使用蓝紫红识别色；正文为深色，左对齐排版并轻微淡入。各样式昵称为 14–16px，徽章与等级不小于 12px；数量、金额和等级使用 `--danmaku-num-font` 等宽数字。旧版直播软件内核不支持 `color-mix` 时，各样式以 RGB 通道变量或 `@supports not` 回退保留文字背后的底色。
- `ranked` 使用 624×640 固定设计画布、最大 600px 卡片宽度和 10px 卡片间距，卡片随正文增高；`calculateRankedOverlayScale(width, height)` 取 `min(1, width / 624, height / 640)` 并投影到 `--ranked-scale`，让窗口 resize 时头像、文字和卡片统一等比缩放。浏览器源比例与设计画布不一致时在未占满的一轴保留透明空白，不拉伸或单独重排内部元素。
- `/danmaku` 的观众头像由浏览器直接读取弹幕中携带的 HTTPS B 站 CDN 地址，保留域名白名单且拒绝带账号密码的 URL；头像和模糊底图共享同一地址，使用 `no-referrer` 并异步解码头像，不逐条查询用户资料或让服务器转发头像。图片缺失或失败沿用各样式的默认展示。表情继续使用 `/api/bilibili/avatar` 本地代理；未通过 B 站域名白名单的图片不会进入服务端公开流。
- 固定区域样式的网格行占满可用高度，使消息容器的裁剪预算来自浏览器源视口，而不是当前消息堆叠高度；少量消息仍靠底部排列，追加消息不会在视口尚有空余时过早移除已有消息。
- 各样式的图片表情受正文宽度约束，行内图片不使用负纵向边距，昵称与粉丝牌必要时分行。聊天气泡保留 12px 消息间距，不绘制底部尾角；直播气泡设计画布内的消息间距为 10px。身份横卡(`identity`)的普通观众与粉丝将本条头像放大模糊后铺底，保留头像的深浅和色彩分布，白字加细暗描边；右侧清晰头像宽 180px，左侧 30% 渐隐，图片不撑高卡片。缺失或失败时两层均使用默认插画，舰长/提督/总督继续使用蓝/紫/红身份底色，礼物保持独立样式。背景复用成功加载且经过 URL resolver 的图片，不读取跨域像素；本地和服务器样式一致。卡片宽 600px、最小高度 92px、间距 6px，按可用宽度等比缩小，正文换行时向下增长。简洁白卡和奶油气泡的昵称放在卡片边框内，正文间隔 6px；消息距离视口边缘至少 16px，消息之间至少 10px，已放得下的消息保留位置，空间不足时先移除最旧消息。
- 信号带的粉丝牌等级跟随昵称信息行排版，不再绝对定位到卡片底边；粉丝牌名称在旧布局允许收缩并显示省略号，画布布局则换行完整显示，等级不会挤到正文或边框上。
- 蝴蝶结样式的昵称向下偏移 6px，居中占正文区域宽度的 70%，长昵称保持 16px 字号自动换行，连续英文也可在字符间折行。行内表情不使用负纵向边距，图片占用完整行高，避免最后一条消息的表情底部超出消息容器并被裁切。

### 固定样式的 SC 展示

正式直播软件网页源由 LIRA Server 的 `superchat` SSE 事件提供；本机 `/danmaku?preview=1` 用合成 SC 验证同一结构，保留的旧本地捕捉入口不新增 SC 展示链。六种固定样式分别为经典矩形、底部签名行气泡、墨蓝切角面板、居中对称细饰（金额使用 Georgia 旧式数字）、透明开口细框和头像伸出连续底板；DOM 使用独立 `is-superchat/sc-*`，CSS 由 `danmaku/superchat.css` 负责，不复用聊天或礼物正文。

原文与换行通过 textContent 完整显示，金额来自实际 price，不显示固定 SC 标签或感谢模板。六款均显示发送者昵称（`.sc-name`），经典、头像横卡和聊天气泡同时显示头像；金额拆为缩小的 `¥`（`.sc-currency`）和数值（`.sc-value`）；长文换行，单条高于可用区域时整体缩放。颜色优先采用 B 站随消息下发的有效十六进制值；缺失字段按 30/50/100/500/1000/2000 档位回退，2 元有自有色就使用自有色，否则共用 30 元蓝色。价格色不使用普通弹幕身份色或自定义正文色。精确色表与公开字段由 Server `public-overlay-api.md` / `SuperChatEvent` 维护。

本地固定预览每轮混播九条弹幕、三条不同数量的送礼通知，以及 ¥2、30、50、100、500、1000、2000 七档 SC，覆盖短句、换行和长文。SC 头像复用内置样例素材，不请求外部资源。随机三款仅混播弹幕和送礼通知，与正式输出不展示 SC 的行为一致。覆盖测试：`test/danmaku/danmaku-superchat-renderer.test.js`、`test/danmaku/danmaku-local-preview.test.js`；真实服务端造型及画布验收见 Server `e2e/overlay-superchat.spec.js`。

## 6.2 游戏叠加层(/games)的弹幕组件

[overlays/games.js](../../../public/js/overlays/games.js) 是游戏入口，只传入会话中的 `session.danmaku`。画我猜的 `#drawDanmakuFeed` 固定声明 `data-style="bubble"`，不读取或跟随弹幕姬的 `danmakuOverlayStyle` 设置；`games.css` 独立实现适合游戏窄栏的五身份气泡视觉，并自动受益于共享组件的安全表情渲染。

游戏和转盘共用 `socket-client.js` 的连接生命周期。每次连接成功分别从 `/api/games/session`、`/api/wheel` 补齐状态；游戏请求失败按最多 5 秒间隔重试；增量在 HTTP 恢复期间有界缓存并按版本衔接，完整更新使旧请求失效。转盘请求仍最多重试四次，收到更新后丢弃较旧的 HTTP 响应。转盘通过专用 REST 读取和 `wheel:update` 恢复，不假定普通 snapshot 包含转盘状态。现有互动端点保留，页面凭据仅允许 §1.0 列出的本页操作。

- `games.css` 将短消息显示为紧凑气泡，长消息按宽度增长并自然换行增高；交错对齐、实时标题栏和 reduced-motion 降级只属于视觉层，不改变弹幕字段或游戏协议。

## 6.3 萌时钟(/clock)

[overlays/clock.js](../../../public/js/overlays/clock.js) 驱动固定 `/clock`
浏览器源，默认首帧使用本页凭据从只读接口 `GET /api/clock/config` 读取已保存设置，并使用
设备本地时区显示当前时间、日期和星期。页面外层透明；横向样式使用 560×190
设计画布，竖向时间轴使用 220×380 设计画布，并在浏览器源不足时按可用空间缩小。

- 风格参数仅接受 `style=peach|starlight|soda|timeline-horizontal|timeline-vertical|digital|orbit|flip`，
  非法或缺失值回退桃桃便签(`peach`)；前三套分别使用奶油蜜桃兔耳、靛蓝月亮云朵
  与薄荷气泡小鸭。横向刻度和竖向刻度使用无卡片底的细线排版、年份与英文星期，
  其中竖向款适配 240×400 Browser Source（含页面边距）。白字数显(`digital`)
  使用透明背景、白色粗窄数字和细暗描边，上排为 `YYYY-MM-DD` 与英文星期，
  下排为同字号的 `HH:MM:SS`，沿用横向画布。星轨时钟(`orbit`) 使用白字暗描边、
  星形与环绕线，下排为 `YYYY.MM.DD` 和中文星期；翻牌时钟(`flip`) 使用日期/英文星期
  小牌和时/分/秒双数字牌，均沿用横向画布。
- 翻牌颜色为 `flipFrameColor` / `flipFaceColor` / `flipTextColor`，对应外框、牌面、数字，
  仅接受 `#RRGGBB`；默认 `#e4e4e4` / `#ffffff` / `#303030`。参数覆盖保存配置时独立合并，
  非法颜色回退默认值。设置面板提供经典白、石墨黑、香芋紫预设及三个自定义颜色选择器。
- `date=0|1`、`seconds=0|1`、`format=12|24` 控制日期、秒数和小时制；非法值
  回退默认显示日期/秒数与 24 小时制。`label` 合并空白并截到 16 个 Unicode
  字符，始终通过 `textContent` 输出；透明时间轴、白字数显、星轨和翻牌不显示角标文案。
- 时钟按下一秒边界使用一次性 timeout 更新；页面隐藏时停止调度，恢复可见后
  立即校时。冒号与星点动效在 `prefers-reduced-motion: reduce` 下停用。
  翻牌由 [clock-flip.js](../../../public/js/overlays/clock-flip.js) 持有上下半牌与 WAAPI 动画，
  仅数值变化时旋转；首次展示、隐藏字段/页面和减少动态效果时直接校准。
  重入动画和切换样式取消旧动画，复用同一个时钟调度器。
- Admin 百宝箱的「萌时钟」卡片只展示并复制固定地址；表单修改经受 token 保护的
  `POST /api/settings` 显式保存。小预览与公共窗口使用 `componentPreview=1` 及父页消息，
  不读取正式配置流；打开公共窗口时卸载小预览，关闭后恢复。样式切换使用 160ms 淡入，
  减少动态效果时停用，不重载页面或重启计时器。旧完整参数内嵌预览消息仍兼容。
- 正式来源使用 `createOverlaySocket()` 接收 clock scope 的八个展示设置键；重连回读配置，
  晚到 HTTP 不覆盖新快照。旧 URL 显式参数逐字段覆盖保存设置；配置更新复用同一个计时器。

### 6.4 组件系统的统一管理与独立导入

`admin/component-preview-session.js` 管理当前浏览器编辑会话；
`component-preview-surface.js` 共用 iframe 消息、数据来源、缩放与释放逻辑，参数面板由各组件提供。
`component-config-controller.js` 持有页面会话的已保存基线和草稿；两个入口共用显式保存、
放弃修改、错误及冲突状态。保存期间的后续编辑保留；外部快照只回填未修改字段。
`component-settings-sync.js` 将时钟和队列草稿投影给 Admin 表单，其他领域字段沿用原回填。

预览会话没有固定编辑时长：已认证的网页读取/编辑及客户端同步都续期。双方连续两分钟
没有有效请求时暂停网页操作，保留有界的会话状态；原客户端通过认证且配置代次一致的同步
可恢复连接，网页凭据本身不能续活已暂停的会话。客户端持续打开时，离开十分钟再刷新仍可编辑。
网页与客户端的同步请求每次最多等待五秒，网络错误、408/429/5xx 按 1–5 秒间隔自动重试；
网页保留待确认草稿，显示重连状态，恢复后按原顺序同步。保存/发布等待前序编辑确认。
刷新/离开网页只释放当前页面的请求、定时器和视图，原客户端继续持有未保存草稿。
新页面按已读取的页面标识接管会话；重复接管请求不重置状态，旧页面迟到的修改、关闭和
接管重试不能影响新页面。新页面先等待此前已接受操作完成，再恢复本地草稿。
网页变更请求串行发送，并携带当前页面标识及递增 `commandId`；中继按页面保留最近一次
编号及结果，响应丢失后重试返回原序号，避免重复编辑或发布。未接管的旧页面协议保持兼容。
客户端关闭、重新打开新的预览、账号/配置来源切换、显式关闭或授权撤销仍使旧会话失效；
永久失效时保留当前可见草稿并停止发送，不能自动恢复已撤销凭据。

编辑页将展示配置的草稿及已保存基线写入同一浏览器、同一本地 origin 的恢复快照；
不写入预览 token、直播源能力或实时事件。后端按已认证账号的稳定 scope 和场景标识生成
不具授权能力的 `draftKey`，随预览片段和已认证快照传递。新连接使用后端确认的 key 查找草稿，
恢复只调用原控制器的编辑入口，仍是未保存状态，不自动保存或发布。保存、放弃后的快照同步更新。
如果已保存基线或客户端草稿另有变化，暂停编辑并提供“恢复上次草稿”/“使用当前配置”选择，
避免自动覆盖。仅已撤销或所属客户端已结束的旧链接退回本地进度的只读展示，继续编辑须从
客户端取得新连接；普通刷新和可恢复的闲置连接不会因此退回只读。
各连接独立保留有效草稿，未就绪连接不覆盖已有快照；迟到的首次读取仍先检查恢复冲突。断开连接时保留尚未确认的编辑。只读恢复为所有组件装配无实时数据 provider，加班机保留外观并明确提示实际数据不可用，不订阅失效会话。
浏览器存储失败会提示先保存再关闭；清理浏览器数据、换浏览器或本地端口变化不保证恢复。

父页校验精确 iframe source 与 opaque origin；`overlays/component-preview-client.js`
校验直接父页和页面 URL origin。iframe 仅接收展示配置与受限数据，不接收完整管理快照。
关闭释放数据订阅、观察器、监听和 iframe；检查底色与适配缩放不进入保存参数。

「点歌 → 浏览器源 → 直播场景 → 编辑场景」通过 `component-preview-registry.js`
惰性加载四个 owner，并在系统浏览器打开 `/component-preview`。首次为空，之后恢复已保存布局；
已有场景不等待弹幕配置加载；仅首次创建时等待其画布尺寸。
单组件预览入口会添加或选中该组件。需要新增共享图层时，桌面通过现有尺寸接口读取保存值，
以链接 fragment 中的初始尺寸传给预览页；没有保存值才使用组件默认尺寸。
顶部「添加组件」通过小窗按类别
展示已有样式；新建图层默认独立外观，右侧调整选中实例。公共分辨率预设/自定义尺寸独立于组件，
图层默认以预定大小居中，窗口改变只影响查看比例。编辑页采用浅色控件与灰色工作区，画布自动适配且不滚动；
画布设置、预览底色、保存、放弃和复制集中在顶部紧凑工具栏，已有图层在画布下方横向排列。
直接入口默认收起参数，画布设置与图层按钮可展开右侧面板；折叠保留选择、参数和草稿，隐藏字段校验失败时重新展开。
在画布中选择或拖动不会自动展开面板，避免拖动中触发缩放。参数与图层列表按需独立滚动。

「保存并应用」只等待场景及其引用的共享外观 owner 的网页编辑得到客户端确认，批量保存并再次核对后发布组合画面；无关默认配置不保存，独立实例不依赖默认 owner 就绪。
「放弃修改」还原画布及本次编辑涉及的共享默认配置（含已移除的共享图层），保留无关组件草稿。
部分保存失败、冲突或未完成草稿会停止发布，保留之前的直播版本。客户端浏览器源中的
`canvas-overlay-source.js` 与网页按钮共用 `scene-source-url.js`，自动读取并显示首个已绑定场景的已发布地址，
点击地址区域即可复制；未发布时提示先编辑并应用。进入浏览器源页、返回客户端或账号/在线来源改变时重新读取，
来源改变立即清除旧地址；读取与复制不创建或发布场景。编辑会话能力与持久输出能力不同。

独立组件来源 `/clock`、`/queue`、`/overtime` 和 `/danmaku?source=component` 可直接复制使用，
无需打开场景编辑器、创建或发布场景。它们使用已保存的默认外观；场景内独立外观的修改不影响这些默认值。
本机弹幕的 `danmaku-component-source.js` 每次完成请求后间隔 750ms 读取 `/api/danmaku/display`，
复用已有云展示缓冲、样式渲染和 canvas 坐标逻辑；不建立本地旧弹幕 WS 或第二条上游 SSE。
首次/断线/换账号清空旧消息并按 epoch/cursor 继续，不生成示例。旧 `/danmaku` 本地 WS 行为兼容保留。

队列预设、默认值和样式切换只修改草稿；保存提交所有已编辑样式键和最终样式。
队列预览使用样例歌曲和同一渲染器，历史共享主题键仍影响跟随主题的歌单板。
加班机页面已移除内嵌 iframe，保留紧凑运行状态、初始时长/外观分栏及通栏规则。
其公共窗口默认实际只读状态，可切换运行/暂停/结束/未启用示例；示例加时与暂停不写业务接口。
来源切换清理动画并重置 revision 基线，外观草稿保持；保存只向原 config 接口提交 `{path, fit}`。

组件扩展由各环境的显式定义负责：`shared/scene-components.js` 持有前端稳定类型、顺序、
缩放轴、内容高度、子 renderer/默认来源 URL 和断线重置能力；
`admin/component-preview-definitions.js` 组装纯工厂及样式选择适配。被动 registry 只接收桌面
owner 注册，未知类型立即报错，不反向导入工厂或 owner。`clock-preview.js`、
`danmaku-preview.js`、`queue-preview.js`、`overtime-preview-factory.js` 不读取桌面状态；
桌面、浏览器会话和离线恢复分别注入数据 provider。舞台优先消费 `startLayerData`，否则使用
组件的 `startData`；加班机的多个实例共享一次 provider，最后一个图层释放时停止。

后端 `src/shared/scene-component-types.js` 定义渲染类型，`server/scene-components.js`
的 ports 复用领域配置校验、默认配置及显示投影；`server/component-preview-page.js` 保留
显式 HTML 片段 allowlist。中继与默认配置草稿缓存保留四个共享类型和 `canvas` 控制类型，不把 canvas 作为可渲染组件。
`shared/scene-extra-components.js` 定义展示板、歌词、三类小游戏、礼物滚动、盲盒榜、许愿的独立参数与选择项；
`admin/scene-extra-preview.js` 直接在画布中创建参数面板，其修改由场景 owner 保存。
这些类型不接受共享外观，不创建独立默认配置会话，也不扩展 `component_output_sizes` 的四类型约束。
`server/scene-extra-display.js` 复用现有领域读口和 overlay 投影；礼物慢读按账号代际、来源版本和日期共享五秒缓存。
输出异步完成后再次核验账号和场景能力；原展示页的组件模式只接收父页消息，不启动自身 HTTP/WS 数据请求。
礼物与小游戏头像按现有 HTTPS B 站图片白名单直接读取，不向子页下发访问凭据。
新增类型需通过前后端定义、独立参数、模板和保存/发布一致性测试；若将来扩展共享默认尺寸类型，
已有数据库必须追加迁移，不能改写已执行的 v9 建表函数。

场景 HTTP 访问由 `scene-api.js` 提供，`scene-item-controller.js` 只适配文档实例与默认外观。
`scene-editor-state.js` 保留旧编辑器会话；画布会话在自己的 controller 中持有 revision、
冲突与发布状态，保存复用 `component-save-batch.js`，两者不同的保存交互保持独立。
旧 `openComponentWorkspace` / `openSceneEditor` 已无产品入口调用，不随类型定义整理重新启用。

## 7. 数据消费一览

| 叠加层       | 首帧                                                                 | 实时                                        | 去重指纹                                | 触发重载的 reason                                              |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| queue        | `/api/state`                                                         | snapshot                                    | current+waiting+SC+全部主题键           | `queue:add`/`bilibili:danmaku`/`bilibili:superchat`(80ms 强刷) |
| songs        | `/api/state` + `/api/songs`                                          | snapshot                                    | orderKey/layoutKey/motionKey            | `songs:*`/`cloud:songs`/`database:clear`/`database:clear-all`(220ms 重载) |
| blindbox     | `/api/state` + `/api/gifts/blind-box-stats`                          | snapshot(即时设置)+ 轮询                     | 统计内容相同保留节点                    | `bilibili:gift`/`gift:sprint:reset`/`connect`                  |
| overtime     | `/api/state`(overtime 字段)                                          | snapshot + `overtime:update`                | `revision` 单调比较                     | `overtime:update` 的 adjustment → 动画入队                     |
| gift-effects | `/gift-effects` 页面播放特效 1 的 4 秒透明 WebM + 独立 DOM 感谢词条 | `gift:frame`                                | `eventId` 去重 + 50 条 FIFO 等待，无等待时效  | 每个合格 final 礼物一次播放                                    |
| opening      | `/api/opening/config`                                                | 无                                          | 无；首帧配置经枚举/文本清洗             | 页面加载一次；Admin 预览可由 URL 参数覆盖                      |
| clock        | `/api/clock/config` + 设备本地时间；URL 参数可覆盖 | clock scope settings snapshot + 秒边界定时器 | HTTP 修订保护；单一计时器 | 初始读取及重连；快照原位更新 |
| lyrics       | snapshot 中的设置、状态和时间轴                                      | `lyric-state` + `lyric-timeline` + snapshot | 当前行与时间轴内部去重                  | 播放页按状态变化推送                                           |
| danmaku（本机组件） | `/api/danmaku/display` 的 config 与 data | epoch/cursor 轮询 | 同一缓冲的 cursor、直播 session 和 reset | 保存默认外观后原位更新；断线/账号变化清空旧消息 |
| danmaku（旧 URL） | snapshot 中的 `danmakuFeed` | `danmaku:message` | 有 id 时按 id；兼容消息按 uid+时间+正文 | 无 reason 重载；断线重连后由 snapshot 恢复 |
| games        | `/api/games/session`                                                 | snapshot + `game:update` + `game:patch` + `game:draw`      | 游戏入口调度器按更新频率合并渲染        | `game:update` / `game:patch` / `game:draw`                                    |
| wheel        | `/api/wheel`，连接成功后补读并有限重试                               | `wheel:update`                            | 状态/抽取 ID 与读取代次                 | 每次 WebSocket 连接成功                                      |

消息类型与 reason 的全集定义以 [ws.md](../backend/ws.md) §3 为准;本表只描述各叠加层**消费**哪些。

歌词性能策略由 `shared/lyric-performance.js` 持有：连续四个长帧先从 WAAPI 降为手动，再连续四个长帧进入静态模式。`lyric-word-animator.js` 在模式实际改变时取消并清空旧动画，静态模式仍按当前时间更新进度。opening 使用 HTTP 配置接口，不订阅快照 WebSocket；clock 同时消费受限配置快照。


## 本地场景浏览器来源

输出以保存的 CSS 像素显示，`scene-renderer.js` 不再按宿主视口缩放整套场景。
选中独立组件后「复制单组件地址」使用 `/scene?id=…&item=…#token=…`，服务端直接投影
已发布实例到 (0,0)，宽高、样式与整套场景中的这一实例共用同一份配置。
共享默认图层的单组件按钮复制原 `/clock`、`/queue`、`/overtime` 或
`/danmaku?source=component` 地址；这些页面通过 `component-output-size.js` 单路读取
当前账号保存的输出尺寸，限制页面及内容布局，不受 OBS/直播姬视口分辨率影响。
该读取复用各自 overlay 身份，不在预览或场景子 frame 内运行；无保存尺寸时保留原行为。
请求不重叠，结束后间隔 750ms 重读，8 秒超时，页面释放时取消请求和定时器。
原点歌板/时钟缩放算法此时以保存的矩形为可用区域；加班机以保存宽度排版、使用已测量高度。

当前入口和操作见上方组件系统说明。直播场景使用既有 scene 文档、保存与发布 owner；模板导入导出、多选与撤销等旧场景编辑器能力保留在其模块中，不作为当前网页入口已提供的功能。

本地直播场景使用 `/scene?id=<UUID>#token=<secret>`。网页点击「保存并应用」才改变完整来源；默认配置之后的修改需要再次应用。OBS 与哔哩哔哩直播姬使用同一浏览器源，尺寸设为场景画布尺寸。输出背景透明，包含可见组件的实际数据，不含编辑控件、检查底色或示例消息。关闭编辑网页后仍能从本地运行时加载、刷新和接收更新。

`scene-renderer.js` 为可见实例创建无凭据的沙箱子 renderer，全体准备成功后替换整套；准备失败保留旧版，旧版仍接收数据。同版本不重载。父页把投影回执与已成功显示版本一起提交，准备失败时继续请求旧版所需类型；回执不传给子页面。首次没有弹幕消费者时保留最多 200 条待投递事件，空批次不覆盖增量，溢出设置 gap 并保留最新事件；连接 epoch、直播场次或 reset 变化清除旧批次。游标推进表示事件已交付 active 或进入有界待投递缓冲；已交给旧版的事件不在新版重复播放。断线同步更新随后提交版本使用的离线状态并清除待投递事件，撤销清空全部版本及回执。`scene.js` 只从 fragment 取凭据，子页面仅收外观和显示数据，真实弹幕模式不会生成示例；授权失效清空画面。主进程接收现有 public overlay SSE 并作账号/连接代际隔离，断线报告缺口，不向本地结算管线补消息。重启且端口不变时来源有效；端口冲突改用其他端口后需重新复制来源。完整 HTTP 契约见 [API 注册表](../backend/api.md#本地场景)。

## 服务器浏览器源地址

服务器弹幕姬地址按服务端 ADR-0056 使用 `/overlay/<16位base64url>`。`server-overlay-url.js` 在初次授权资料和授权状态变化后，通过既有主进程 `getOverlaySettings()` 读取完整 URL，验证与资料 `songPageUrl` 同源，再同时提供给点歌投屏地址及弹幕工具；不从域名拼接裸路径、不生成或上传密钥。账号切换先清空地址，迟到回复按代际丢弃。该只读 capability 仅用于用户明确要求的展示/复制/打开，DeviceBearer 保持在 main。失败不回退公开地址。网页、不同设备和重装后使用同一服务端持久密钥；本地 `/danmaku?preview=1` 预览不依赖它。

验收：首次加载两个观察者收到相同完整 URL；复制/打开保留随机串；错 origin、裸路径、带 query/hash 或非法长度拒绝；切换账号不显示旧 URL；本地预览与草稿行为不变。自动化见 `test/danmaku/server-danmaku-settings.test.js` 与 `test/danmaku/danmaku-overlay-ipc.test.js`。


## 投票与评分 `/interactions`

独立 interactions scope，仅展示当前类别 3 会话；空场透明。推荐浏览器源 800×600，投票支持 1–6 个选项。管理端预览、主持端结果和实际投屏共用紧凑结果行：轨道最小高度 56px，行间距 8px，长文字自然撑高。卡片和选项区随内容增减高度，全部选项同时展示，不设内部滚动或自动翻页；实时更新保留 DOM。

投票使用固定顺序与 0–100% 标尺，票数/百分比固定在完整轨道内，零票不隐藏；结束标最高/并列最高，零参与无胜者。评分使用最大宽度 460px 的整体边框卡片，规则文案可自定义，默认说明 1–10 分、只发整数及取最后一次评分。多行输入保留换行，长文本（含连续英文）按卡片宽度自动折行，卡片随内容增高，规则留空则隐藏，不固定行数。底部独立均分框在收集中显示占位「—」，不显示均分或人数，结束后显示两位小数及人数；无人评分显示「暂无评分」。接收曾中断时保留提示。页面 GET、刷新或开多个实例均不启动/延长收集。截止由本地服务控制，与页面可见性无关。

选项文字位于进度条内左侧，票数与比例右对齐。默认白底、深色文字、浅青色填充，不再展示完整规则说明。标题和提示默认空、留空隐藏，不回退到本场主题。管理端「直播画面」按内容、颜色、布局与显示分组，左侧编辑、右侧棋盘格背景预览；窄窗口将预览放到编辑区上方。可调整标题、提示、评分规则、文字/背景/进度条/轨道颜色、背景与整体不透明度、文字大小、卡片圆角、状态和人数显示。背景不透明度只影响底色，整体不透明度同时影响卡片全部内容；字号 16–24px，结果行随文字换行自然增高。隐藏人数不隐藏接收中断警告，也不提前公开评分汇总。标题与状态均隐藏时折叠标题区，底部无人数或警告时折叠底部。

草稿即时预览，可切换投票或评分，预览明确使用示例数据；进度条色也用于评分边框与最终均分框。预览与浮层共用外观样式，按卡片宽度调整选项内的排列。点击应用后通过既有 `/api/settings` 保存并广播，恢复默认也先进入草稿。设置键与默认值见 [storage.md](../backend/storage.md)；只有 interactions scope 接收这些展示设置。样式更新不改变会话或选项节点；评分浮层共用这套外观。
