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

### 1.1 通用模式

所有叠加层:

- **透明背景**:`html,body` 透明(`overlays/base.css`),只渲染卡片面板,供 OBS 浏览器源叠加;加班机层独立样式(整屏倒计时)。
- **数据双通道**:先 `fetch('/api/state')` 拿首帧快照,再连 `/ws` 收后续快照;WS 断开时按指数退避重连,重连前再次 `loadState()` 兜底(见 [comms.md](comms.md) §3)。
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

`gift-effects.html` 保留透明全屏浏览器源地址，但运行路径只消费 `gift:frame`。内置
`woodland-bloom` 主题由一张完整合成 PNG 和上、右、下、左四张透明 PNG 组件组成；正常播放
分别控制四个组件，任一组件加载失败时切到本地完整合成图，不加载远程美术。礼物名称、观众、
数量与最终金额由 DOM `textContent` 写入下边组件自带的象牙色铭牌；中间安全区保持透明。
结构图之上另有 `branch`、`crystal`、`floral` 三张本地透明装饰 PNG；它们不参与四边拼接，
由 `FrameController` 独立进入、退场，并在 Holding 阶段分别完成一次花藤轻摆、水晶钟摆和花结
落位动作。三段动作不循环、位移不超过 8px、旋转不超过 3°；`reduced` 只显示静态装饰。

播放由 Overlay 内部 `GiftFrameController` 管理：单个 `PlaybackSession` 按 `900ms` 进入、
`2600ms` 保持、`650ms` 退场的冻结时序运行，四个组件以各自方向的位移和 clip reveal 与信息座
在进入阶段并行重叠；
队列最多 3 条 pending，事件等待超过 12 秒丢弃，实时事件按稳定 `gift-frame:<id>` 去重，
金额更高的新事件可替换 pending 中最低且最晚入队的一条。每个会话拥有 `AbortController`、
WAAPI 句柄、timer 与 watchdog，正常、异常、超时和主动取消都从同一 `finally` 清理出口恢复透明。

粒子 Canvas 最多创建 6 个错峰萤火光点，每个只沿框体周边完成一次短距离漂移和明暗变化，
不进入中央直播安全区；粒子失败不影响 PNG/DOM 生命周期。
动效解析优先级为 URL `?motion=` > `gift:frame.motionMode`/快照 settings > 系统
`prefers-reduced-motion`；`reduced` 关闭粒子和大幅位移但保留边框结构与礼物信息。旧
`gift:effect` MP4 查询接口仍作为兼容入口保留，但新 Overlay 不消费也不加载远程礼物媒体。

### 1.5 开播动画(`/opening`)

开播页从免认证只读接口 `GET /api/opening/config` 读取已保存设置；Admin 预览 URL 可用
查询参数临时覆盖设置。`trackMotion` 仅接受 `heart`、`barber`、`progress`，查询参数优先于
保存值，非法值回退 `heart`。三种模式复用同一条 SVG waveform：心形的位移和显隐使用同一条
SVG 时间轴，启用画面时统一归零并从首轮立即移动；
灯带用金色短划线连续偏移，流光用单段粉色 dash 沿整条路径循环；任何时刻只显示一种前景
动效，不创建任意 CSS/SVG 输入面。页面隐藏、低画质或 `prefers-reduced-motion` 时暂停或停用
连续轨道动画，固定 `/opening` 地址本身不携带配置。右侧人物图默认读取内置 WebP；Admin 可上传
PNG/JPEG/WebP，Overlay 只接受内置 URL 或受限的 `/opening-character/` 当前文件 URL。

## 2. 队列叠加层(/queue)

[overlays/queue.js](../../../public/js/overlays/queue.js) 渲染 `state.queue`(current + waiting)与 `state.superChats`:

- **六种风格**:`classic`(默认,经典卡片列表)、`identity`(身份版,观众名突出,含 SC 置顶区)、`storybook`(奶油蓝插画画框)、`neon-vinyl`(甜粉麦克风舞台)、`cherry-ribbon`(紫金星月梦境)与 `golden-lily`(奶油金唱片铃兰);由设置 `overlayQueueStyle` 决定,遗留 `festival` 归一为 `identity`,未知值回退 `classic`。样式由 `overlays/base.css` 导入的 `.queue-*` 主题类承载。
- **风格 3**:框体与词条素材位于 `public/img/overlays/song-board-style-3/`;原始框体保留 alpha,`.queue-storybook::before` 在框内开口后叠加不透明白层,框外仍透明。词条黄色端点恒显示队列序号,浅蓝固定宽度区域复用身份版的歌名、点歌人、大航海/灯牌名与灯牌等级格式;没有大航海或灯牌时省略对应字段。内容实际宽度溢出时由 `scheduleIdentityContentScroll` 在该区域内左右往返,不会扩张词条素材。纵向超出画框时复用身份版的循环/往返滚动测量。
- **风格 4 / 5**:各自的框体与词条素材位于 `public/img/overlays/song-board-style-4/` 和 `song-board-style-5/`;框体和词条素材自带粉色或紫金渐变底色。两种风格隐藏通用顶部标题和点歌顺序数字,省略四组字段的说明标签并将短内容居中。每条记录输出歌名、点歌人,并在有数据时输出大航海等级、灯牌名与等级;没有大航海或灯牌时省略对应字段。大航海身份按总督红、提督紫、舰长蓝区分,同一条记录后接的灯牌名与等级徽章沿用该身份色;无大航海时才使用灯牌自身等级色。整组内容实际宽度溢出时复用 `scheduleIdentityContentScroll` 左右往返,纵向超出画框时复用插画风格滚动测量。风格 4 的列表下边界与前景底边内沿对齐,保证滚动终点的最后一条完整露出;风格 5 的列表窗口顶部与首条词条上边缘对齐、底部收进 30px。`prefers-reduced-motion` 下停用横纵动画。
- **风格 6**:奶油金唱片铃兰框体与横向词条素材位于 `public/img/overlays/song-board-style-6/`;词条以内容窗宽度的 72% 居中,完整收进画框的左右前景边框之间,列表上边界上移至画框高度的 18% 以完整露出首条顶部装饰,相邻卡片以 `4px` 间距清晰分开,左侧花形圆圈显示从 1 开始的队列序号,右侧固定信息窗省略说明标签并输出歌名、点歌人,在有数据时输出大航海等级、灯牌名与等级;没有大航海或灯牌时省略对应字段。大航海与后接灯牌徽章使用和风格 4/5 相同的总督红、提督紫、舰长蓝身份色,无大航海时保留灯牌等级色。信息窗内容实际宽度溢出时复用 `scheduleIdentityContentScroll` 左右往返,纵向超出画框时复用插画风格滚动测量,列表下边界停在第 4 个序号附近;`prefers-reduced-motion` 下停用横纵动画。
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
- 指纹:`orderKey(songsRevision:sortMode)`、`layoutKey(字体族/字号组)`、`motionKey(滚动速度)`;歌曲变更(`songs:*` reason 或 database:clear)220ms 防抖重载;`live:status` 不触发重渲染。
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

- 数据:汇总 + 排行榜来自 `GET /api/gifts/blind-box-stats`(可选 `?boxName=心动盲盒` 只看心动盒);快照 reason 以 `bilibili:gift`/`gift:sprint:reset`/`connect` 触发重取统计,其余只缓存 state(主题)。
- URL 参数(短别名 + 长键):`top/t`(榜单位数,0=仅汇总,-1=全部)、`winners/w`(只看盈利)、`heartBox/hb`、`title/tt`(自定义标题,优先于设置 `blindboxOverlayTitle`)、`compact/c`、`hideLoss/hl`、`refresh/r`(轮询秒数)、`noScroll/ns`;管理页「盲盒投屏」生成器输出该链接(见 [app.md](app.md) §4.3)。
- 呈现:汇总卡(盒子数/总成本/总盈亏,涨绿跌红)+ 排行榜(冠亚季军👑🥈🥉徽章 + 行内进度条)+ 可选的底部冲刺条;`compact/winners-only/summary-only/no-scroll` 类切换形态;主题从快照 settings 经 `applyTheme` 应用(与队列层同套令牌)。
- 数据刷新:WS reason `bilibili:gift`/`gift:sprint:reset`/`connect` 重取统计,`refresh/r` 参数支持定时轮询(≥10s)兜底,适用于 WS 不稳的投屏环境。

## 6. 桌面歌词页(/lyrics)

[overlays/lyric-window.js](../../../public/js/overlays/lyric-window.js):

- 使用方:管理页「复制桌面歌词」复制规范地址 `/lyrics`,供浏览器或 OBS 浏览器源使用;页面背景透明,实际输出不包含管理页预览使用的网格/纯色辅助背景。
- 数据:首帧设置来自 `GET /api/settings` 的 `desktopLyric*` 12 键;实时连接 `/ws`,消费 `lyric-state`、`lyric-timeline` 与 snapshot 中的 `lyricState`/`lyricTimeline`/`settings`。
- 渲染:直接复用 `admin/desktop-lyric-preview.js` 的完整时间轴渲染器,显示整首歌词、翻译、罗马音、当前行逐字进度、长间奏三秒倒计时和播放进度;逐字高亮支持连续填充与按时间点亮两种模式,隐藏 `desktopLyricPreviewPlayback` 只提供 aria-live 文本,当前行 `LyricWordAnimator` 是唯一视觉逐字更新源。样式设置通过同一组 `--preview-*` CSS 变量应用,因此浏览器源与管理页实时预览一致。
- 显示行数:设置 `desktopLyricVisibleLines` 为 `0` 时保持整首可见;正整数仍创建整首时间轴,只将当前行窗口外的行标记为不可见。`1` 仅显示当前行;偶数向下扩展,奇数向上下扩展,整首数据继续保留以保证同步和自动跟随。
- 性能默认值:新配置默认关闭弹性滚动、非当前行模糊和行缩放,优先保证歌词清晰与浏览器源稳定;用户已保存的显式设置继续生效。对齐方式支持左对齐、居中、右对齐和两端对齐。
- **滚动与跟随**:歌词视口拥有独立纵向滚动;当前行切换时使用弹簧动画居中跟随。用户滚轮、触摸、指针或键盘滚动后暂停自动跟随 6 秒,再恢复到当前行。
- **状态防回灌**:客户端只接受更大的 `generation`,或同一 generation 下严格递增的 `sequence`;旧客户端缺字段时保持兼容。`content-visibility:auto` 与 `contain-intrinsic-size` 跳过视口外绘制,不改变完整歌词的滚动结构。

## 6.1 弹幕姬(/danmaku)

[overlays/danmaku.js](../../../public/js/overlays/danmaku.js) 驱动唯一固定 `/danmaku` 浏览器源，并按 snapshot 的 `settings.danmakuOverlayStyle` 在固定区域的聊天气泡(`bubble`)、直播信号带(`signal`)、极简字幕(`minimal`)、身份横卡(`ranked`)、透明简约(`transparent`)和全屏随机(`outline`)之间切换；非法或缺失值回退默认 `signal`。页面以 `topic=danmaku` 连接 WebSocket，从 snapshot 的 `danmakuFeed` 恢复最近消息，并直接消费 `danmaku:message`；按消息 `id` 去重，同一动画帧内的消息批量追加，连接中断时指数退避重连。全屏随机使用 snapshot 中的 `danmakuFullscreenDurationSeconds`，只渲染发送者和正文，在视口边界内定位并按时间移除；固定区域样式继续按顺序排列，其中透明简约统一身份视觉并在正文下方显示粉丝牌名称与等级。状态栏在本地 socket 可用后继续以 snapshot `liveStatus` 为准，不再把本地连接成功等同于 B 站弹幕已连接。Admin 通过 `/danmaku?preview=1&style=bubble|signal|minimal|ranked|transparent|outline` iframe 复用同一页面展示确定性样本，预览模式不连接 WebSocket。

页面与 `/games` 的画猜消息共同复用 `danmaku-feed.js` DOM 组件。组件不读取 WebSocket 或领域状态，只接收显式消息数组和图片 URL resolver：

- `measureDanmakuText(message)` 按中英文混合文本的视觉长度估算行数、宽度百分比和最小高度。
- `createDanmakuFeed(root, options).render(items)` 使用 `DocumentFragment`、`textContent` 和受控 `<img>` 创建头像、昵称、徽标、文字与 B 站表情，最多保留最近 120 条；`append(item)` 只追加新节点并按条数上限、缓存的容器高度和消息估算高度移除最旧的超限节点，不重建已有 DOM，也不逐消息读取布局。`ResizeObserver` 仅在容器尺寸变化时刷新高度并再次裁剪。表情按精确触发文本切分，加载失败回退原触发文本，不使用 `innerHTML`。游戏层按容器高度保留当前可见区及上方约 5 个视口的缓冲并自动滚到底部；固定 `/danmaku` 配置 `offscreenViewports: 0`，DOM 只保留约一个可见视口，同时关闭强制滚动。页面数据和服务端断线恢复快照仍分别硬限制为最近 50 条，不会无限缓存。
- 共享组件按当前房间身份为每条消息输出 `data-identity=viewer|fan|captain|admiral|governor`；大航海身份优先，拥有大航海且佩戴当前房间灯牌时仍同时输出两枚徽标。五套固定弹幕姬只共享该语义，不共享身份视觉：`signal` 使用军衔刻度与分级信号色，`bubble` 使用会员胶囊、身份符号和柔和分级光晕，`minimal` 不绘制左侧色条，普通观众省略身份签，粉丝与大航海身份保留单字身份签和低遮挡分级色；`ranked` 隐藏徽标，以普通/粉丝共用的石墨灰及舰长蓝、提督紫、总督金四档整卡底色表达身份，用户名和正文在左、头像在右；`transparent` 不绘制卡片底色、边框或大航海徽标，所有身份统一为头像右侧的昵称、正文和下方粉丝牌等级。`outline` 虽保留同一 DOM 身份字段以兼容共享组件，但 CSS 统一隐藏头像、徽标和灯牌，仅以白色昵称、正文和中性描边呈现，不使用身份颜色。
- `ranked` 使用 384×640 固定设计画布、360×64 卡片和 6px 卡片间距；`calculateRankedOverlayScale(width, height)` 取 `min(width / 384, height / 640)` 并投影到 `--ranked-scale`，让窗口 resize 时头像、文字和卡片统一等比缩放。浏览器源比例与设计画布不一致时在未占满的一轴保留透明空白，不拉伸或单独重排内部元素。
- `/danmaku` 把头像与表情 CDN 地址交给 `/api/bilibili/avatar` 本地代理；未通过 B 站域名白名单的图片不会进入服务端公开流。

## 6.2 游戏叠加层(/games)的弹幕组件

[overlays/games.js](../../../public/js/overlays/games.js) 是游戏入口，只传入会话中的 `session.danmaku`。画我猜的 `#drawDanmakuFeed` 固定声明 `data-style="bubble"`，不读取或跟随弹幕姬的 `danmakuOverlayStyle` 设置；`games.css` 独立实现适合游戏窄栏的五身份气泡视觉，并自动受益于共享组件的安全表情渲染。

- `games.css` 将短消息显示为紧凑气泡，长消息按宽度增长并自然换行增高；交错对齐、实时标题栏和 reduced-motion 降级只属于视觉层，不改变弹幕字段或游戏协议。

## 6.3 萌时钟(/clock)

[overlays/clock.js](../../../public/js/overlays/clock.js) 驱动固定 `/clock`
浏览器源，首帧从免认证只读接口 `GET /api/clock/config` 读取已保存设置，并使用
设备本地时区显示当前时间、日期和星期。页面外层透明；横向样式使用 560×190
设计画布，竖向时间轴使用 220×380 设计画布，并在浏览器源不足时按可用空间缩小。

- 风格参数仅接受 `style=peach|starlight|soda|timeline-horizontal|timeline-vertical`，
  非法或缺失值回退桃桃便签(`peach`)；前三套分别使用奶油蜜桃兔耳、靛蓝月亮云朵
  与薄荷气泡小鸭。横向刻度和竖向刻度使用无卡片底的细线排版、年份与英文星期，
  其中竖向款适配 240×400 Browser Source（含页面边距）。
- `date=0|1`、`seconds=0|1`、`format=12|24` 控制日期、秒数和小时制；非法值
  回退默认显示日期/秒数与 24 小时制。`label` 合并空白并截到 16 个 Unicode
  字符，始终通过 `textContent` 输出；透明时间轴不显示角标文案。
- 时钟按下一秒边界使用一次性 timeout 更新；页面隐藏时停止调度，恢复可见后
  立即校时。冒号与星点动效在 `prefers-reduced-motion: reduce` 下停用。
- Admin 百宝箱的「萌时钟」卡片只展示并复制固定地址；表单修改经受 token 保护的
  `POST /api/settings` 保存，iframe 仍用参数即时预览。旧带参数地址保持兼容，显式
  参数逐字段覆盖保存配置；已打开的 OBS 页面在 Browser Source 刷新后读取新设置。

## 7. 数据消费一览

| 叠加层       | 首帧                                                                 | 实时                                        | 去重指纹                                | 触发重载的 reason                                              |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| queue        | `/api/state`                                                         | snapshot                                    | current+waiting+SC+全部主题键           | `queue:add`/`bilibili:danmaku`/`bilibili:superchat`(80ms 强刷) |
| songs        | `/api/state` + `/api/songs`                                          | snapshot                                    | orderKey/layoutKey/motionKey            | `songs:*`/`database:clear`(220ms 重载)                         |
| blindbox     | `/api/state` + `/api/gifts/blind-box-stats`                          | snapshot(仅缓存)+ 轮询                      | 统计接口每次重取                        | `bilibili:gift`/`gift:sprint:reset`/`connect`                  |
| overtime     | `/api/state`(overtime 字段)                                          | snapshot + `overtime:update`                | `revision` 单调比较                     | `overtime:update` 的 adjustment → 动画入队                     |
| gift-effects | `/gift-effects` 页面内置完整合成图 + 四方结构 PNG + 三张独立装饰 PNG | `gift:frame`                                | `eventId` 稳定去重 + 3 条 pending 队列  | 每个合格 final 礼物一次播放                                    |
| opening      | `/api/opening/config`                                                | 无                                          | 无；首帧配置经枚举/文本清洗             | 页面加载一次；Admin 预览可由 URL 参数覆盖                      |
| clock        | `/api/clock/config` + 设备本地时间；URL 参数可覆盖                   | 本地秒边界定时器                            | 无；页面恢复可见时立即校时              | 页面加载一次；不消费 WebSocket reason                          |
| lyrics       | `/api/settings`                                                      | `lyric-state` + `lyric-timeline` + snapshot | 当前行与时间轴内部去重                  | 播放页按状态变化推送                                           |
| danmaku      | snapshot 中的 `danmakuFeed`                                          | `danmaku:message`                           | 有 id 时按 id；兼容消息按 uid+时间+正文 | 无 reason 重载；断线重连后由 snapshot 恢复                     |
| games        | `/api/games/session`                                                 | snapshot + `game:update` + `game:draw`      | 游戏入口调度器按更新频率合并渲染        | `game:update` / `game:draw`                                    |

消息类型与 reason 的全集定义以 [ws.md](../backend/ws.md) §3 为准;本表只描述各叠加层**消费**哪些。
