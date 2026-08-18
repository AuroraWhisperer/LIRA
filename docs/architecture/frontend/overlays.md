# OBS 悬浮层(overlays/)

> 涉及文件:[pages/overlays/queue.html](../../../public/pages/overlays/queue.html)、[pages/overlays/songs.html](../../../public/pages/overlays/songs.html)、[pages/overlays/blindbox.html](../../../public/pages/overlays/blindbox.html)、[pages/overlays/overtime.html](../../../public/pages/overlays/overtime.html)、[pages/overlays/lyric-window.html](../../../public/pages/overlays/lyric-window.html)、[js/overlays/](../../../public/js/overlays/)、[css/overlays/](../../../public/css/overlays/)

本文档描述五个叠加层页面的框架、数据消费与各自 UI。快照字段与消息类型见 [ws.md](../backend/ws.md),客户端通信行为见 [comms.md](comms.md),页面入口 URL 见 [pages.md](pages.md) §2,加班机领域状态见 [backend/overtime.md](../backend/overtime.md)。

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

| CSS 变量 | 来自 settings 键 | 默认值 | 说明 |
|---|---|---|---|
| `--overlay-primary` | `themePrimary` | `#ff6f91` | 主色（当前歌高亮/徽标） |
| `--overlay-primary-r/g/b` | `themePrimary` 分量 | — | 主色 RGB 分量（用于 rgba() 构造） |
| `--overlay-accent` | `themeAccent` | `#21b6a8` | 强调色（徽章背景） |
| `--overlay-accent-r/g/b` | `themeAccent` 分量 | — | 强调色 RGB 分量 |
| `--overlay-text` | `themeText` | `#fff7fb` | 通用文字色 |
| `--overlay-opacity` | `themeOpacity` | `0.76` | 面板背景不透明度（0–1） |
| `--overlay-bg-r/g/b` | `themeBackground` 分量 | — | 背景色 RGB 分量（面板/渐变底色） |
| `--overlay-gradient-r/g/b` | `gradientEnd` 分量 | — | 渐变终止色 RGB 分量（仅 `enableGradient=true` 时有效） |
| `--overlay-radius` | `themeRadius` | `8px` | 面板圆角（px） |
| `--overlay-blur` | `backdropBlur` | `0px` | 毛玻璃模糊半径（px）；须配合 `.has-backdrop-blur` 类 |
| `--overlay-glow-size` | `glowIntensity` | `0px` | 辉光扩散半径（px） |
| `--overlay-glow-color` | `themePrimary` × `glowIntensity` | `transparent` | 辉光颜色（rgba，透明度由 glowIntensity 换算） |
| `--overlay-font-family` | `overlayFontFamily` | `Microsoft YaHei` | 字体栈（经 `withMultilingualFallback` 追加多语言回退） |
| `--overlay-font-weight` | `overlayFontWeight` | `800` | 字重 |
| `--overlay-font-scale` | `themeFontScale` | `1` | 内容区整体缩放（em 单位乘数） |
| `--overlay-song-color` | `overlaySongColor` → 回退 `themeText` | `#fff7fb` | 歌名文字色 |
| `--overlay-requester-color` | `overlayRequesterColor` | `''`（继承） | 请求者名字色 |
| `--overlay-index-color` | `overlayIndexColor` | `''`（继承） | 序号色 |
| `--overlay-song-font-size` | `queueSongFontSize`（px）→ `overlayFontScale` | 计算值 | 歌名字号（px） |
| `--overlay-waiting-font-size` | `song-font-size × 0.65`，最小 10px | 计算值 | 等待曲目字号（px） |
| `--overlay-title-font-size` | `queueTitleFontSize`（px）→ `overlayFontScale` | 计算值 | 标题字号（px） |
| `--overlay-edge` | 固定值 `clamp(0px, 2vmin, 16px)` | — | 面板外边距（在 CSS 中声明，不经 JS 注入） |

注：`--overlay-bg-r/g/b` 用于面板背景渐变构造，`gradient-bg` 类叠加渐变时还使用 `--overlay-gradient-r/g/b`。`--overlay-glow-color` 的透明度 = `glowIntensity / 50`（最大 1）；加班机层不使用此变量集，有独立样式（见 §4）。

### 1.3 overlay-utils.js(共享工具)

挂 `window.OverlayUtils`:`escapeHtml`、`hexToRgb/hexToRgba`(主题色转 rgba)、`withMultilingualFallback`(字体栈回退)、`scrollTravelSeconds`(滚动时长换算)、`overlayLowPowerEnabled`(见上)。

### 1.3 song-virtual-scroller.js(歌单虚拟滚动)

歌单板专用:可变行高记录的**环形 DOM 窗口**虚拟滚动([song-virtual-scroller.js:28-58](../../../public/js/overlays/song-virtual-scroller.js#L28-L58))。

- **工作原理**:以 anchor 记录(当前视口首行 key/index/offset)为起点,向两侧按 `beforeViewports=1 / afterViewports=1.5` 个视口高度增量构建 DOM 节点(`probeOverflow` 先探测内容是否超出一屏,不超出则整表渲染),`wrapIndex` 取模实现环形复用;滚动时 `tick` 按 `pixelsPerSecond(viewportHeight / secondsPerViewport)` 推进 `scrollTop`,超出前缓冲区的顶部节点被回收并追加到尾部(`recycleTopRecords`),始终保持窗口内只有可见 + 缓冲节点。
- **联动**:`setRecords`/`relayout` 以 anchor 保持视口稳定(歌单刷新/字体加载完成/视口 resize 时不跳位);`secondsPerViewport` 由歌单滚动速度设置换算;页面隐藏时 `pause()` 停止 rAF([songs.js:102-108](../../../public/js/overlays/songs.js#L102-L108))。
- 浏览器无 `requestAnimationFrame`/`ResizeObserver` 时自动降级(整表渲染 + window resize 监听)。

## 2. 队列叠加层(/queue)

[overlays/queue.js](../../../public/js/overlays/queue.js) 渲染 `state.queue`(current + waiting)与 `state.superChats`:

- **两种风格**:`classic`(默认,经典卡片列表)与 `identity`(身份版,观众名突出,含 SC 置顶区),由设置 `overlayQueueStyle` 决定(identity/festival 归一为 identity);样式由 `overlays/base.css` 的 `.queue-classic` / `.queue-identity` 主题类承载,管理页「点歌板」所有主题键(色板/字体/字号/渐变/毛玻璃)经 CSS 变量 `--overlay-*` 注入。
- **滚动**:classic 走 CSS 动画滚动(`classic-scroll` 线性 42s 循环 + `scrolling-bounce` 有节奏往返模式,loop clone 双份列表实现无缝循环);identity 走 JS 定时滚动(按 `queueScrollSpeed` 配置);视口 resize 后 `relayoutQueue` 重新配置,重渲染时 `captureScrollAnimation/restoreScrollAnimation` 在 rAF 帧内恢复 CSS 动画进度,不跳帧不闪动([queue.js:186-208](../../../public/js/overlays/queue.js#L186-L208))。
- **低功耗**:`overlayLowPowerMode` 或 `?quality=low` 时停用毛玻璃/辉光等重特效(`.overlay-panel.low-power` 面板级降级,classic/identity 共用,[base.css:38-47](../../../public/css/overlays/base.css#L38-L47))。
- **快照消费**:指纹 = 当前歌/等待队列/SC/全部主题与滚动键;`queue:add`/`bilibili:danmaku`/`bilibili:superchat` 等 reason 走 80ms 延迟 `loadState()` 强刷(确保请求者元数据落库后再取,见 [queue.js:96-110](../../../public/js/overlays/queue.js#L96-L110));`live:status` 只更新直播状态不重渲染。
- 主题:经典/身份版色板、字体、字号、置顶 3 条、规则 6 条均来自快照 `settings`(管理页「点歌板/展示板」配置)。

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

| 断点 | 行为 | 出处 |
|---|---|---|
| `@container (max-width: 719px)` | 门票网格切窄列(≤2 列) | [overtime.css:261-269](../../../public/css/overlays/overtime.css#L261-L269) |
| `@container (max-width: 419px)` | 时钟面板收窄、标题小字限宽 | [overtime.css:270-273](../../../public/css/overlays/overtime.css#L270-L273) |
| `@container (max-aspect-ratio: 1.45)` | 竖屏(高 > 宽/1.45)收紧纵向间距 | [overtime.css:274-276](../../../public/css/overlays/overtime.css#L274-L276) |
| `@container (max-height: 239px)` | 超矮场景隐藏送礼表头、压缩间距 | [overtime.css:277-281](../../../public/css/overlays/overtime.css#L277-L281) |
| `@supports not (font-size: 1cqmin)` | 无 cq 支持时回退 `2vmin` | [overtime.css:297-299](../../../public/css/overlays/overtime.css#L297-L299) |

### 4.3 时钟与数字呈现

- 时钟字号:**8.5em × 2cqmin = 17cqmin** 等比缩放(`font: 700 8.5em/0.9 Bahnschrift SemiCondensed,…` + `tabular-nums`,[overtime.css:94-100](../../../public/css/overlays/overtime.css#L94-L100));管理页预览时钟为 `clamp(38px, 5vw, 66px)`([admin/overtime.css:67](../../../public/css/admin/overtime.css#L67))。
- 时间格式:`formatClockSeconds` 恒补零到两位 → `02:05:09`,超过 99 小时自然增长为 `120:00:00`([overtime.js:267-273](../../../public/js/overlays/overtime.js#L267-L273))。
- 数量封顶:结算卡片数量 `> 99999` 显示 `99999+`([overtime.js:275-278](../../../public/js/overlays/overtime.js#L275-L278))。
- 结算动画:每次 `overtime:update` 携带 `adjustment` 时入队(队列上限 5,满则合并为"连续礼物 · 净变化"聚合卡片)依序播放盖章动画 + 门票高亮 + 时钟变色闪动([overtime.js:167-230](../../../public/js/overlays/overtime.js#L167-L230))。
- **动画降级**:`prefers-reduced-motion: reduce` 媒体查询与 `low-motion` 类都把动画压缩到 180ms;低功耗 `?quality=low` 时动画时长同步缩短。
- 设计令牌:夜色 `#181823`、粉 `#ff6f91`、青 `#21b6a8`、珊瑚 `#f0677d`、金 `#f5b72f`、文字 `#fff7fb`([overtime.css:1-8](../../../public/css/overlays/overtime.css#L1-L8));门票按效果取色:加时=青、减时=珊瑚、盲盒=金、不变=灰。

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
- 渲染:直接复用 `admin/desktop-lyric-preview.js` 的完整时间轴渲染器,显示整首歌词、翻译、罗马音、当前行逐字进度、长间奏三秒倒计时和播放进度;样式设置通过同一组 `--preview-*` CSS 变量应用,因此浏览器源与管理页实时预览一致。
- 显示行数:设置 `desktopLyricVisibleLines` 为 `0` 时保持整首可见;正整数仍创建整首时间轴,只将当前行窗口外的行标记为不可见。`1` 仅显示当前行;偶数向下扩展,奇数向上下扩展,整首数据继续保留以保证同步和自动跟随。
- 性能默认值:新配置默认关闭弹性滚动、非当前行模糊和行缩放,优先保证歌词清晰与浏览器源稳定;用户已保存的显式设置继续生效。对齐方式支持左对齐、居中、右对齐和两端对齐。
- **滚动与跟随**:歌词视口拥有独立纵向滚动;当前行切换时使用弹簧动画居中跟随。用户滚轮、触摸、指针或键盘滚动后暂停自动跟随 6 秒,再恢复到当前行。

## 7. 数据消费一览

| 叠加层 | 首帧 | 实时 | 去重指纹 | 触发重载的 reason |
|---|---|---|---|---|
| queue | `/api/state` | snapshot | current+waiting+SC+全部主题键 | `queue:add`/`bilibili:danmaku`/`bilibili:superchat`(80ms 强刷) |
| songs | `/api/state` + `/api/songs` | snapshot | orderKey/layoutKey/motionKey | `songs:*`/`database:clear`(220ms 重载) |
| blindbox | `/api/state` + `/api/gifts/blind-box-stats` | snapshot(仅缓存)+ 轮询 | 统计接口每次重取 | `bilibili:gift`/`gift:sprint:reset`/`connect` |
| overtime | `/api/state`(overtime 字段) | snapshot + `overtime:update` | `revision` 单调比较 | `overtime:update` 的 adjustment → 动画入队 |
| lyrics | `/api/settings` | `lyric-state` + `lyric-timeline` + snapshot | 当前行与时间轴内部去重 | 播放页按状态变化推送 |

消息类型与 reason 的全集定义以 [ws.md](../backend/ws.md) §3 为准;本表只描述各叠加层**消费**哪些。
