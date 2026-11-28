# 直播画面悬浮层（`overlays/`）

直播平台为 B 站；OBS 与哔哩哔哩直播姬均通过浏览器源 / 网页来源使用这些画面。文中的 overlay 指通用直播展示页。本机画面使用 `127.0.0.1`，要求与 LIRA 同机并保持客户端运行；既可用直播场景的一个来源，也可直接导入独立组件。旧版服务器在线弹幕画面（`/overlay`）已按 ADR-0118 退役，当前所有直播画面均使用客户端本地地址并需保持客户端运行，详见[服务器订阅地址与旧画面退役](#服务器订阅地址与旧画面退役)。本机 `/danmaku?source=component` 是独立组件来源，`/danmaku?preview=1` 是示例预览；完整操作见[组件与浏览器源指南](../../guides/component-sources.md)。

> 涉及文件：[pages/overlays/queue.html](../../../public/pages/overlays/queue.html)、[pages/overlays/songs.html](../../../public/pages/overlays/songs.html)、[pages/overlays/blindbox.html](../../../public/pages/overlays/blindbox.html)、[pages/overlays/overtime.html](../../../public/pages/overlays/overtime.html)、[pages/overlays/lyric-window.html](../../../public/pages/overlays/lyric-window.html)、[pages/overlays/opening.html](../../../public/pages/overlays/opening.html)、[js/overlays/](../../../public/js/overlays)、[css/overlays/](../../../public/css/overlays)

本文档描述各个叠加层页面的框架、数据读取与各自 UI。快照字段与消息类型见 [ws.md](../backend/ws.md)，客户端通信行为见 [comms.md](comms.md)，页面入口 URL 见 [pages.md](pages.md) §2，加班机领域状态见 [backend/overtime.md](../backend/overtime.md)。

### 实时榜单

画布「添加组件」首项为「实时榜单」，分别选择「热门全站」「热门新人」「人气全站」「人气分区」添加独立图层，每层单独复制组件地址；使用本地静态缩略图，不为组件选择列表发起榜单请求。客户端各榜的「配置直播画面」会选中该榜已有的单榜图层，没有时新增，不复用原来的多榜图层。

`live-rankings` 是独立场景组件，新建单榜默认 540×800，通过 `/scene?id=…&item=…#token=…` 输出。原多榜配置、尺寸和已复制地址继续兼容；新建与切换榜单沿用原有四个开关字段，不新增持久化格式。`/live-rankings` 仅为沙箱渲染壳，匿名加载不返回榜单，数据由受保护父场景通过原组件协议交付。组件及客户端共用 [live-rankings-view.js](../../../public/js/shared/live-rankings-view.js)，字段和范围选择归 [live-rankings.js](../../../public/js/shared/live-rankings.js)；接口与调度事实见 [Bilibili API](../backend/api.md#实时四榜)。

| 配置 | 默认与范围 |
| --- | --- |
| `showHot/showNew/showPopular/showArea` | 保留四个榜单开关；默认仅热门全站开启，各单榜入口只开启对应项；参数页通过「榜单」单选切换 |
| `range` | 默认 `all`，从第 1 名开始完整加载已返回名次，手动滚动；`nearby` 跟随本房间名次（如第 15 名及附近）；画布与直播输出使用本地设置 `liveRankingsRange` |
| `nearby/pageSize/pageSeconds` | 保留旧配置字段及校验范围；附近模式按实际高度决定条数，完整榜不再使用分页参数；不提供手动人数或翻页间隔控件 |
| `columns/theme` | 新建单榜为 1 栏；原多榜布局保留 1/2/4 栏设置；浅色，可选深色或透明底 |
| `fontSize/showAvatar/accent` | 18px（12–32）、显示头像、本房间强调色 `#f25483` |

名次与原始热度值 / 助力值保持分离，不换算成礼物票数。当前房间按房间号高亮，完整榜额外固定显示自身排名和差距；附近模式在列表包含本房间时省略重复的固定行。未上榜、未获得参榜资格或接口未返回附近名次时如实提示，不补造相邻名次。客户端、画布预览与直播输出的完整榜均加载全部已返回名次，在各榜正文内手动滚动，不自动翻页，实时更新保留阅读位置（数据刷新改变列表高度时保持贴底视图贴底）。画布滚轮不修改图层几何或场景配置；投屏通过浏览器源交互界面操作，活动榜单 iframe 接收原生输入，暂存版本不接收输入。附近模式按榜单正文可用高度和实际行高取完整行数（字号不随高度缩放，靠近榜首／榜尾时用另一侧名次补足），销毁时解除尺寸观察。

行节点按房间复用，数值格式化器复用，文字/属性/显隐仅在值改变时写入，配色与排版变量仅在配置改变时更新。1 秒本地时钟更新倒计时和数据年龄，不调用 B 站。超过两秒未成功更新或请求失败时显示延迟和数据年龄。附近模式只有本房间的距上榜差值、相邻名次为空时，也按该榜的数据年龄和状态提示延迟。客户端、画布与本机场景输出遇临时读取失败（如 HTTP 503）时保留最后成功的房间和榜单并提示延迟，恢复读取后即使版本未变也解除错误状态，来源撤销时立即清空。管理标签隐藏时解除自身订阅；画布的展示方式自动保存至本地设置，其余外观随场景保存，实时榜单数据不落库。

### 本地媒体样式

[component-media-style.js](../../../public/js/shared/component-media-style.js) 定义独立组件配置中的可选 `mediaStyle`，服务端 `normalizeSceneConfig` 统一校验。支持 `background`、`opening`、`danmaku`、`clock`、`gift-wishes`、`gift-frame`、`guard-thanks`；新增字段不改变原业务配置与事件。字段如下：

| 字段 | 含义与范围 |
| --- | --- |
| `id/src/kind` | 样式 UUID、受限本机素材 URL、`image` 或 `video`；导入服务生成，清单不能覆盖 |
| `width/height` | 原图或设计画布像素，整数 1–7680 |
| `content` | `{x, y, width, height}` 百分比内容区，必须在 0–100 内，宽高至少 5 |
| `textColor/fontSize` | 六/八位十六进制颜色（可含 Alpha）；12–200 像素 |
| `showText/textTemplate` | 事件素材是否叠字；文案最多 160 字，支持 `{name}`/`{gift}`/`{count}`/`{tier}`/`{months}` |
| `durationMs/textDelayMs/volume` | 事件最长播放 250–120000 ms、叠字延迟 0–60000 ms、视频音量 0–1；默认静音 |

装饰由 [component-media.js](../../../public/js/overlays/component-media.js) 组合在原 `clock`/`danmaku`/`gift-wishes` 根节点外，图像填满组件、内容限制在配置区，背景隐藏内置画面；背景与装饰视频在页面可见时循环，页面隐藏时暂停，恢复显示后从原进度继续。时钟禁用内置自动缩放以使用设定内容区，弹幕和许愿数据仍由各自负责模块更新。

`gift-frame`/`guard-thanks` 使用同一媒体事件播放器接入既有去重与顺序队列：图片按时长显示（默认 6 秒），视频取实际结束或配置时长较早者（默认上限 120 秒）。开播素材在正式输出中随原开关从关变开播放一次，关停立即隐藏；编辑画布播完后间隔 1 秒循环，关闭总开关时静音。礼物预览循环按整段素材及事件数安排，结束、重置或销毁时清除定时器并暂停视频。

`component-preview-client` 等待装饰和事件素材就绪后才报告 `prepared`，失败报告外观准备失败、正式来源保留上一版本。所有动态文字用 `textContent`，图片/视频不执行包内代码。作者文件格式见[套装指南](../../guides/component-style-packages.md)。

### 第三方网页与 CSS

所有组件样式库复用 `component-source-import.js` 的统一「选择文件」和折叠「粘贴网址或代码」入口（操作步骤见[组件指南](../../guides/component-sources.md#添加组件样式与套装)）。网页/CSS 默认尺寸为弹幕 480×720、其他组件 800×600，媒体沿用编辑器读取结果，ZIP 沿用作者清单。导入时按 HTML 标签的加载属性（如 `src`、`srcset`）和 CSS 的 `url()`、`@import` 核对本地资源。`img[src="placeholder.png"]` 这样的属性选择器只匹配元素，`content: "url(example.png)"` 中的文字也无需配套文件。库中的 HTML 保留导入分类并以 `browser` 组件保存输出；删除库卡片仍保留正在使用的资源。

`component-css-style.js` 定义 `cssStyle: {id, src, engine, width, height}`，`src` 仅允许本机导入路径，宽高 32–7680，`engine` 为 `native`/`blivechat`/`blc`（后两者仅用于 `danmaku`）。CSS 与媒体/资源样式互斥，通过带 CORS 的 `link` 加载。点歌板画布预览和发布来源均通过 `cssStyle` 加载所选原生 CSS。加载失败或无有效规则时正式输出保留旧版。

`/imported-danmaku` 是无凭证、`sandbox allow-scripts` 的子渲染页；预览与 scene 共用相同 DOM，scene 只接收 LIRA 弹幕展示投影，不读取管理 API 或生成示例。每批消息按到达顺序处理追加、撤回和淘汰，有新增行时在批末贴底一次。它兼容常见 blivechat/YouTube 与 BLC 消息结构（LAPLACE 特征会提示使用原网页或配套 HTML）。第三方 HTML 在 `browser` 沙箱中执行，数据仍来自作者网页，不注入 LIRA 权限。文件与 API 限制见[组件样式库 API](../backend/api.md#组件样式库)。

### 背景外观参数

[background-appearance.js](../../../public/js/shared/background-appearance.js) 定义 `background` 配置顶层的通用字段，适用于普通图片/视频与资源型背景。服务端沿用场景字段白名单、数值范围与步长校验；其他组件不接受这些新增字段。

| 字段 | 范围、默认值与行为 |
| --- | --- |
| `opacity` | 0–1，步长 0.01，默认 1；整个背景及遮罩一起透明，不影响其他组件 |
| `blur` | 0–30 px，整数，默认 0；`cover`/`fill` 外扩三倍模糊半径避免容器边缘露白，`contain` 保留素材边缘 |
| `fit` | `cover` / `contain` / `fill`，新增样式默认 `cover`；旧 `mediaStyle` 场景未声明时保留 `fill` |
| `brightness/saturation/contrast` | 0–2，步长 0.01，默认 1；依次应用模糊、亮度、饱和度、对比度，原始效果不启用滤镜 |
| `overlayColor/overlayOpacity` | 六位十六进制颜色，默认 `#ffffff`；强度 0–1、步长 0.01、默认 0。无背景时不显示遮罩 |
| `colorProcessing` | `standard` / `legacy`；新中性配置默认 `standard`。未声明且 `temperature`、`tint` 或任一旧分区强度非零时自动补 `legacy` |
| `temperature/tint` | number，−100–100，整数，默认 0；色温负冷正暖，色调负绿正洋红。相对调色量，不是开尔文；`standard` 使用 CAT02，`legacy` 使用旧 RGB 增益 |
| `liftRed/liftGreen/liftBlue` | number，−1–1，步长 0.01，默认 0；标准模式逐通道提升（暗部）系数 |
| `gammaRed/gammaGreen/gammaBlue` | number，0.1–3，步长 0.01，默认 1；标准模式逐通道伽马（中灰）系数，大于 1 提亮中间调 |
| `gainRed/gainGreen/gainBlue` | number，0–3，步长 0.01，默认 1；标准模式逐通道增益（亮部）系数 |
| `preserveLuminance` | boolean，默认 `true`；仅 `legacy` 生效，在裁切到色域前保持 sRGB 加权亮度 |
| `shadowColor/midtoneColor/highlightColor` | 六位十六进制颜色，默认 `#ffffff`；仅 `legacy` 生效，暗部、中间调、亮部的乘色 |
| `shadowStrength/midtoneStrength/highlightStrength` | number，0–1，步长 0.01，默认 0；仅 `legacy` 生效，各区域染色强度 |
| `glowMode` | `normal` / `streak` / `star`，默认 `normal`；柔光 / 横向光条 / 十字星芒 |
| `glowStrength` | number，0–2，步长 0.01，默认 0（关闭）；亮部辉光以 `screen` 混合到背景 |
| `glowRadius` | number，0–60 px，整数，默认 12；柔光标准差为半径的一半；横向光条纵向标准差为横向的 1/8，星芒为两条正交光条的平均 |
| `glowThreshold/glowSoftness` | number，0–1，步长 0.01，默认 0.7 / 0.2；高于阈值的亮部产生辉光，柔和度决定渐变区间；阈值 1 时无亮部被选中 |
| `irisBlur` | number，0–30 px，整数，默认 0（关闭）；周边高斯模糊的标准差为此值的一半 |
| `irisRange/irisSoftness` | number，0–1，步长 0.01，默认 0.45 / 0.3；中心清晰区域半径及向外过渡宽度 |
| `irisCenterX/irisCenterY` | number，0–1，步长 0.01，默认 0.5；左上角为 (0, 0)，右下角为 (1, 1) |
| `vignetteColor` | 六位十六进制颜色，默认 `#000000`；边缘覆盖颜色 |
| `vignetteOpacity` | number，0–1，步长 0.01，默认 0（关闭） |
| `vignetteRange/vignetteSoftness/vignetteRoundness` | number，0–1，步长 0.01，默认 0.55 / 0.45 / 0；中心半径、过渡宽度、圆度（0 为椭圆、1 为圆形） |
| `vignetteCenterX/vignetteCenterY` | number，0–1，步长 0.01，默认 0.5 |
| `levelsChannel` | `rgb` / `r` / `g` / `b`，默认 `rgb` |
| `inputBlack/inputWhite` | number，整数，范围 0–254 / 1–255，默认 0 / 255；必须 `inputBlack < inputWhite` |
| `gamma` | number，0.1–3，步长 0.01，默认 1 |
| `outputBlack/outputWhite` | number，整数，范围 0–254 / 1–255，默认 0 / 255；必须 `outputBlack < outputWhite` |
| `grainStrength/grainSize` | number；强度 0–1（步长 0.01，默认 0）；大小 1–8 px（步长 0.5，默认 1）；固定种子单色颗粒 |
| `playbackRate` | 0.5–2，步长 0.05，默认 1，仅视频生效 |
| `volume` | 0–1，步长 0.01，默认 0；旧配置未声明时读取 `mediaStyle.volume` |
| `backgroundDefaults` | 可选的背景参数快照（不含 `style`、媒体路径或嵌套快照），用于恢复样式默认 |

字段平铺在 `config` 内（禁止嵌套子对象；打包清单见[背景样式包作者指南](../../guides/background-style-packages.md)）。固定处理顺序：全局模糊 → 亮度 → 饱和度 → 对比度 → 白平衡 → LGG（`standard`）或旧分区乘色（`legacy`）→ 色阶 → 辉光 → 周边模糊 → 暗角 → 颗粒 → 全画布颜色遮罩 → 整体不透明度。

`background-filters.js` 的标准白平衡与 LGG 使用 SVG `linearRGB`，其余步骤使用 sRGB。色彩计算由 [background-color-science.js](../../../public/js/overlays/background-color-science.js) 负责，移植 [Unity PostProcessing v1](https://github.com/Unity-Technologies/PostProcessing/tree/933df236f509ed64ae5763ed57af33f2342cd1c2)（MIT）的 `CalculateColorBalance`、`WhiteBalance` 和 `LiftGammaGain`。标准白平衡采用 `/55` 缩放与 D65 参考白点，合成为 `LMS_TO_LINEAR × diag(balance) × LINEAR_TO_LMS`；标准 LGG 每通道计算 `v = gain × (c + lift × (1−c))`，正值再做 `v^(1/gamma)`，负值裁切至 0，输出限制在 SDR 0–1（字段为 LIRA 实际 RGB 系数边界，独立于其他工具色轮参数）。

`legacy` 模式沿用 RGB 增益与亮度权重 `(0.2126, 0.7152, 0.0722)`，分区蒙版权重依次为 `(1-L)²`、`4L(1-L)`、`L²`。色阶使用 256 点 LUT：`outputBlack + (outputWhite - outputBlack) × clamp((v - inputBlack) / (inputWhite - inputBlack), 0, 1)^(1/gamma)`。辉光渐变为阈值到阈值加柔和度之间的 smoothstep。径向蒙版坐标按素材显示元素归一化，滤镜末步恢复输入 alpha（不将透明图片或 `contain` 留白涂实）。预览与正式输出共用 `background.js`、`background-filters.js` 与 `background.css`，调参不重建素材元素或重置视频进度；默认中性参数不建立 SVG 滤镜，销毁时清理节点和尺寸监听。

### 窗映四时背景

`windowlight-background` 是 `background` 的受信资源预设，固定 `style: 'windowlight'`，设计尺寸 1920×1080。外置包提供晴天、黄昏、雨天、夜晚四张样式卡片，共用全部八张 WebP（逻辑路径 `img/overlays/backgrounds/windowlight/`，含四种光照底图及 `dappled-light`、`prismatic-light`、`window-mask`、`lamp-light`）。

[scene-extra-components.js](../../../public/js/shared/scene-extra-components.js) 维护以下顶层字段（独立于 `BACKGROUND_FIELDS` 与 `backgroundDefaults`）：

| 字段 | 默认值 | 契约 |
| --- | --- | --- |
| `sceneMode` | `manual` | `manual` 手动选择；`auto` 定时轮播 |
| `windowScene` | `sunny` | `sunny` / `sunset` / `rainy` / `night`；手动显示场景，自动模式的起始场景 |
| `sceneIntervalSeconds` | `300` | 10～3600 秒的整数；自动模式按晴天 → 黄昏 → 雨天 → 夜晚循环 |

[background-windowlight.js](../../../public/js/overlays/background-windowlight.js) 负责素材解码、场景切换与生命周期；[background-windowlight-effects.js](../../../public/js/overlays/background-windowlight-effects.js) 负责局部光照与玻璃水滴；[background-windowlight.css](../../../public/css/overlays/background-windowlight.css) 负责画面合成、适配与过渡。光照约 30fps 更新（WebGL 不可用时显示静态光层），雨滴经 Canvas 折射雨天底图并由玻璃遮罩排除窗框与室内物件。页面隐藏时停止动画帧和轮播，恢复后继续；开启「减弱动态效果」时特效静止，自动轮播仍有效；销毁清理动画帧、图形资源、节点和计时器。操作与导出见[窗映四时分层背景](../../guides/background-style-packages.md#窗映四时分层背景)。

### 资源型样式

资源型样式是单个组件的外观实现，可单独交付或作为跨组件套装成员。`component-style-library.js` 以包内不同组件分类是否超过一种区分套装，新增样式入口由 `canImportComponentStyle(type)` 统一控制（`gift-feed`、`gift-wishes`、`heart-box-collection`、`gift-sprint`、`blindbox` 已撤销新增入口，已有导入样式保持兼容）。

- **`woodland-gift-frame`**（林间花信）：`gift-frame` 资源预设，默认 1920×1080，映射 `woodland-bloom-v4.webm` 到本机不可变资源。旧图层的兼容入口随当前安装版本切换，回退安装旧版本时也随之回退。由 `gift-effects-frame.js` 播放并沿用客户端全屏礼物感谢页的启用与阈值。
- **`nautical-guard-thanks`**（航海旗帜）：`guard-thanks` 资源预设，包含 `guard-nautical/{captain,admiral,governor}.webp` 与 `avatar.png`，由 `guard-nautical-player.js` / `guard-nautical.css` 播放（1920×1080 透明动画 5 秒，头像 1 秒入场、昵称 1.2 秒入场、4–5 秒淡出，不支持 `textMode` 翻译）。复用终态礼物投影与队列，同一笔入站事件生成 `guard-thanks:<购买ID>:nautical` 专属场景事件（内置及普通素材组件忽略）。`showAvatar`/`showUserName` 默认 `true`，`nameFontSize` 默认 45（24–96 整数），功能页与画布共用控件。
- **Schema 与加载**：独立配置中可选 `resourceStyle` 与 `mediaStyle` 互斥，形状为 `{id, preset, preview, width, height, resources}`，由 [component-resource-style.js](../../../public/js/shared/component-resource-style.js) 校验同包目录、白名单路径与扩展名（月渡花汀弹幕新增可选 `scroll-landscape.webp`）。[component-resources.js](../../../public/js/overlays/component-resources.js) 仅读取客户端已知 CSS，替换白名单素材 URL 并预解码图片/字体、检查视频可读性，按配置代次隔离晚到结果，切换样式与销毁时释放样式表。

### Overlay 模块边界

| 门面/入口 | 内部模块 | 职责边界 |
| --- | --- | --- |
| `queue-render.js` | `queue-theme.js` | `queue-render.js` 负责队列 DOM；`queue-theme.js` 将设置映射为 CSS 变量，`queue-render.js` 兼容导出 `applyTheme` |
| `queue.js` | `queue-request-notice.js` | `queue.js` 接线并交付快照；`queue-request-notice.js` 负责提示 DOM、结果顺序、阅读时间、进出场/文字动画与资源释放 |
| `gift-effects.js` | `gift-frame-queue.js` / `gift-frame-player.js` / `gift-motion-player.js` / `gift-effect-player.js` / `gift-effects-guard.js` / `gift-effects-component.js` | 固定来源入口管理单一 WebSocket 与消息分发；各队列/播放器负责自身去重、播放和清理；组件适配器只接收父页配置与事件，不另建连接。林间花信由 `gift-effects-frame.js` 播放，掉落物理由共享 `gift-drop-physics.js` 计算 |
| `danmaku.js` | `danmaku-style-application.js` | 入口负责配置接纳、feed 与数据连接；样式适配器将样式配置映射为 DOM dataset 与 CSS 变量，不维护消息或连接 |
| `games.js` | `games-result.js` / `games-drawing.js` / `games-drawing-geometry.js` | 入口负责游戏会话、结果操作请求和恢复，`games-session.js` 负责增量与快照排序；`result` 负责结果窗、头像请求代次、位置及按钮状态；`drawing` 负责画板同步、工具启停、撤销与笔画清理，`geometry` 为纯形状/颜色计算 |

这些模块均由页面以 ES Module 加载；内部模块不得自行创建第二条 WebSocket 连接或重复维护会话状态。

## 1. 悬浮层框架

### 1.0 本地页面权限与数据投影

本地展示页面各有独立的 `overlay` 身份，不能调用其他页面或管理端的接口。固定页面地址仍可作为浏览器源打开；服务端只在该页 HTML 中注入本次运行的访问凭证，管理员凭证不进入 HTML。`songlist` 对应 `songs.html`，`lyrics` 对应 `lyric-window.html`，其余 scope 与同名 HTML 对应。`/pages/overlays/<文件名>` 原始地址和 `/<scope>` 使用相同权限与响应头；`/songs` 仍是管理入口。

签发及精确路径/方法白名单由 [access-policy.js](../../../src/server/access-policy.js) 负责，受限操作由 [overlay-http.js](../../../src/server/overlay-http.js) 适配。REST、初始快照、合并快照及所有 WS JSON 出口统一经过 [overlay-projection.js](../../../src/server/overlay-projection.js)。投影逐层选取已列出的标量、对象及数组字段；新增归属字段和新增设置不会自动对展示页开放，不能直接展开整个 `state` 或 `settings`。管理请求保留原 DTO。

所有页面允许 `GET /api/state` 作为凭证恢复探测，但只返回下表中的本页投影；无需快照数据的页面得到空对象，不据此向全局快照加入游戏或转盘。表中 GET/POST 路径均省略 `/api` 前缀，头像代理仅开放给实际需要头像的页面。

| Scope | 专用 HTTP 读取与允许操作 | 快照字段与专用 WS 消息 |
|---|---|---|
| `queue` | 无 | `queue.current/waiting` 的歌名、请求者显示名、置顶、`is_live` 与大航海/灯牌展示字段；`superChats.message/price`；本页主题设置 |
| `songlist` | GET `/songs`，服务端固定 `enabledOnly: true`，保留曲风筛选 | 本页歌单主题设置；歌曲仅 `id/name/artist/category_name/language/name_initial` |
| `blindbox` | GET `/gifts/blind-box-stats`，保留 `boxName` 筛选 | 本页主题与心动盲盒展示设置；统计仅盒数、总成本、开出礼物总价值、总盈亏、榜单显示名/盒数/盈亏及 `heartBoxProgress.openedSinceCastle` |
| `overtime` | 无 | `overtime` 的 revision、状态、服务端时间、有效余时、背景与展示规则；`overtime:update` 的同一状态及结算动画字段 |
| `gift-effects` | GET `/bilibili/avatar` | `giftEffectDanmakuEnabled`；`gift:frame` 的礼物铭牌/特效身份字段，`gift:effect` 的播放 URL 与 RGB/alpha 布局，`gift:guard-thanks` 的等级/昵称/月数/头像/文字模式 |
| `gift-feed` | GET `/gifts/display-settings`、`/gifts/history`、`/gifts/card-profiles`、`/overtime/gifts/catalog`、`/bilibili/avatar` | `gifts.viewRevision` 与刷新 reason；`gift-catalog:update` 仅为失效通知，不附完整目录 |
| `gift-wishes` | GET `/gifts/wishes` | `gifts.viewRevision`；响应仅含当前来源的许愿定义、进度、直播窗口状态和分页信息 |
| `heart-box-collection` | GET `/gifts/heart-box-collection` | `gifts.viewRevision`；响应仅含本期时间、收集状态、累计、下一档差额、四档奖励及缓存图片，不附送礼人或原始记录 |
| `gift-sprint` | 无 | `giftSprint.targetRmb/remainingCrystalBalls`；月底冲刺文字版直接使用既有服务端折算数量，未设目标或断线时清空文字，重连恢复；页面 `/gift-sprint`，`preview=1` 显示底色与提示；画布模式通过父页接收同一投影，不启动子页 WebSocket |
| `gift-export` | GET `/bilibili/avatar` | 无业务快照或专用消息；导出行、配置和目录由 Electron 主进程的冻结输入提供，不授予流水选择或导出 IPC 权限 |
| `lyrics` | 无 | 本页歌词设置、`lyricState/lyricTimeline`；`lyric-state/lyric-timeline` 仅含曲名/艺人、行词文本与时间、播放/排序状态 |
| `now-playing` | GET `/now-playing/config` | `nowPlaying/nowPlayingConfig` 与 `now-playing` 增量；仅歌曲来源、歌名、歌手、封面地址、真实播放状态及外观参数 |
| `games` | GET `/games/session`、`/games/winner-profile`、`/bilibili/avatar`；POST `/games/session` 仅 `stop/restart`，`/games/session/move` 仅数字/坐标字符串，`/games/session/draw` 仅 `append/undo/clear` | `game:update` 的完整公开游戏态、`game:patch` 的聊天/状态增量、`game:draw` 的画笔操作；兼容已存在的 `state.games`，不新增全局字段 |
| `interactions` | GET `/interactions/session` | 互动标题、提示、评分规则与外观设置；`interaction:update` 仅含当前会话的公开状态和选项 |
| `danmaku` | GET `/bilibili/avatar`、`/bilibili/room/profile`、`/danmaku/display`、`/danmaku/events` | `danmakuFeed`、`liveStatus.enabled/roomId/connected/message`、`danmakuOverlayStyle/danmakuFullscreenDurationSeconds`；`danmaku:message` 仅展示消息、身份、头像与表情字段，`danmaku:superchat-delete` 仅含撤回 ID；房主资料响应仅含 `roomId/uid/name/avatarUrl` |
| `wheel` | GET `/wheel`；POST `/wheel/spin` | `wheel:update`；仅候选标签/权重、抽取时序/索引及上次结果索引 |
| `opening` | GET `/opening/config` | 无；配置仅启用、文案、画质/轨道/音符/均衡器、音频开关/音量及当前音频/人物图 URL |
| `clock` | GET `/clock/config` | 无；仅 `style/showDate/showSeconds/hourFormat/label/flipFrameColor/flipFaceColor/flipTextColor/moonMode/moonIntervalSeconds` |

本日礼物的服务端读取固定北京时间今天、每页 100 条、按创建时间升序；页面可传分页 `cursor/viewRevision` 与条件读取 `conditional/contentRevision/delta`，不能扩大日期、来源或筛选范围。返回仅保留 `viewRevision/nextCursor/partial/contentRevision/unchanged`、增量标记与 `removedEventIds`，以及横幅需要的 `eventId/artworkPath`、可选排序标识 `sortTime/sortId` 和礼物显示名、礼物 ID/变体、币种、单价、数量、头像、大航海等级、时间。目录仅保留礼物 ID/名称/变体和本地图片路径，不暴露来源配置、同步状态或完整流水元数据。

游戏投影按游戏类型逐字段选择。数字炸弹的隐藏数字、你画我猜的未揭晓词条/别名和管理态不对展示页开放；只有领域状态已经 `answerRevealed: true` 才传递 `revealedAnswer`。公开弹幕保留观众实际发送的文本。落子不能携带对象形式的主持控制指令，开始/配置游戏和转盘、提前揭晓/切换题目仍属于管理端。

设置字段表以投影模块中的显式键为准，并覆盖所有共享使用方：队列保留通用主题、序号/置顶/六条规则及各风格字体和滚动键；`storybookQueue`、`neonVinylQueue`、`cherryRibbonQueue`、`goldenLilyQueue` 仅允许 `FontSize/FontFamily/FontWeight/UseCustomTextColor/TextColor/ScrollMode/ScrollSpeed` 七个已启用后缀，旧 `illustratedQueue*` 仅保留现有兼容回退键。歌单保留独立 `songBoard` 设置及共享主题回退键，盲盒保留自身标题与通用主题。歌词由 [overlay-projection.js](../../../src/server/overlay-projection.js) 的 `SETTING_KEYS.lyrics` 基础展示键与 [advanced-lyric-appearance.js](../../../public/js/shared/advanced-lyric-appearance.js) 的 `LYRIC_VISUAL_DEFAULTS` 共同组成投影，包含基础/高级显示开关及高级外观；命名搭配库 `advancedLyricSavedPresets` 不下发到展示页。不得将任意同前缀的新键视为已授权。

每个叠加层 HTML 响应都使用 `Content-Security-Policy: sandbox allow-scripts`，不允许 `allow-same-origin`；直接打开和嵌入管理预览都处于不透明源（`Origin: null`），不能访问父级 frame 的 DOM、fetch 或凭证。预览父页通过 `postMessage(..., '*')` 发送展示配置，子页核对 `event.source === parent` 及管理页服务来源（origin）；当前叠加层与共享渲染器不依赖 localStorage、sessionStorage 或 IndexedDB。

静态脚本、样式、字体和图片可跨不透明源（`Origin: null`）加载，HTML 不开放 CORS 读取。API 只为允许的页面路径/方法接受 `Origin: null`，实际请求仍验证访问凭证；预检不授予身份或管理权限。引导脚本只给同一服务的 `/api/` 和 `/ws` 附加本页访问凭证，401 或 WS 关闭后最多合并一次 `/api/state` 探测，确认旧凭证失效才重新加载页面。`topic=danmaku` 只缩小订阅，不能扩展 scope；叠加层的 WS 文本/二进制业务入站帧以 1008 关闭，正常 ping/pong/close 保留。`shutdown` 对所有 scope 仅包含类型和原因。

区域随机位置参数：`outline`、`mist`、`comic`、`window`、`whiteframe`、`cream`、`glow`、`starveil`、`sea-breeze-random` 的 `styleOptions` 支持 `centerBias`（中心倾向）与 `dispersion`（离散程度），均为 1～50 整数，默认 1。中心倾向越高，越偏向区域中央、越少落在边角；离散程度越高，越偏向离上一条卡片中心欧氏距离更远的位置。两者共同调整概率权重，不保证每条消息间距固定；边界和防重叠优先，拥挤时沿用最旧消息淘汰。上一条过期后仍保留其中心作为下一条参考，清空/重建信息流时重置。参数在线更新只影响后续位置选择，已显示位置保持稳定。固定与 `floating`/`comet` 样式不接受这两个字段；旧参数缺失使用默认，空样式对象恢复默认，旧 PUT 省略 `styleOptions` 时保留已有值。

普通追加复用已定位卡片的占位，区域、字体或卡片尺寸变化时重新适配。算法由 `danmaku-random-position.js` 实现：48 个稳定伪随机均匀候选，通过 Gumbel-max 按指数权重选择（中心归一化距离惩罚与实际欧氏距离奖励）。仅在候选无法放置时尝试边角/相邻空隙。预览、独立弹幕与服务器使用同一算法；参数面板复用既有滑块与草稿应用流程。

### 随机与飘窗的动效参数归属

两类布局共用字段约定和参数编辑器，数值仍按 `styleOptions.<style>` 保存。沉笺采用下节的专属下沉参数，不使用横向飘窗参数。桌面、画布与独立预览在「消息与动效」中展示「随机弹幕通用参数」或「飘窗弹幕通用参数」；款式特有入场放在「高级参数」的本款分组，不能同时叠加普通随机入场。字段定义由 `DANMAKU_STYLE_OPTIONS` 声明，本机 Node 镜像由同一浏览器约定生成。

| 字段 | 适用范围 | 值、默认与作用 |
| --- | --- | --- |
| `durationSeconds` | 全部区域随机 | 2–30 秒；落星尘默认 12、玻璃气泡默认 5，两款不继承旧共用值；其余默认 6 并兼容旧值；包含入场和退场 |
| `exitAnimation` | 全部区域随机 | `fade`（默认）渐隐、`none` 直接消失；只作用于正常到期 |
| `exitDurationMs` | 全部区域随机 | 100–1000ms；落星尘默认 1000，其余默认 400；关闭渐隐时保留数值但停用控件 |
| `entranceAnimation` | 一纸素笺、青雾、杏花白、白描、流光溢彩、点点流萤、海风散影 | `fade`（默认）保留样式渐显、`rise` 上浮弹入、`none` 直接显示 |
| `entranceDurationMs` | 上述普通随机 | 100–1000ms；缺省渐显为海风散影 800、青雾 280、点点流萤 260、其余 200；旧 `rise` 缺少时长时保持 500ms |
| `floatingEdgeFade` | 横向飘窗（不含沉笺） | `both` 两端、`right` 入场端、`left` 离场端、`none` 直接切断；极光/星轨默认 `both`，其余 `none` |
| `floatingEdgeFadeSize` | 横向飘窗（不含沉笺） | 4–80 逻辑 px、默认 28；每端上限为区域宽度 4%，不改变移动速度或完整离场时机 |

随机信息流在新增或恢复每条消息时锁定其停留与退场参数，`setExpirationOptions` 只更新后续消息的配置；在原到期点移除，撤回、拥挤淘汰和销毁仍即时清理。`danmaku.js` 的样例预览、场景配置和独立组件输出均原地更新同款动效参数，保留已有节点、随机位置、动画和到期点。切换样式或影响消息结构的配置仍重建；显式重播仍重新播放示例。

两类信息流在新消息真正取得位置后设置 `data-live-entry`；恢复快照直接显示完整消息。普通随机由本机 `danmaku-random-entrance.js` 锁定入场选项与时长并复用安全正文，`random-entrance.css` 管理共用上浮和入场开关；漫画、小窗、极光、星轨只编排各自内部图层。飘窗边缘遮罩统一由 `floating-motion.css` 实现，横向移动、等待和完整拖尾清理由飘窗信息流模块负责。款式仅声明默认边缘和专属入场，不再重复实现相同遮罩。系统开启「减弱动态效果」时省略入场强调和随机渐隐，飘窗保留阅读所需横移；`ambientMotion` 仍只控制装饰循环。两类信息流在偏好切换为减弱动态效果时清除已有和等待消息的入场动画标记，恢复动态后旧消息不重播；飘窗的偏好监听随信息流销毁释放。

文字入场和公共到期渐隐沿用[绘制连续性约束](danmaku-motion.md#实现契约)，通过不继承的注册属性在实际画布缩放下绘制；小窗窗框与星轨光尾等重叠装饰同样避免间接改变文字栅格。横向飘窗以 `left` 插值推进，适配比例由独立 `scale` 保持，组件的旋转/倾斜仍归 `transform`；移动速度、等待避让、完整拖尾离场和用户特效不变。

### 海风倒影与海风散影弹幕

`sea-breeze`（海风倒影）与 `sea-breeze-random`（海风散影）参照[原作公开预览](https://www.bilibili.com/video/BV1vHY76oEEf/)的文字、彩色身份牌和渐隐镜像，由 `danmaku-sea-breeze.js` 重组公共安全文字与 B 站表情 DOM，`danmaku/sea-breeze.css` 负责排版和分层渐显。默认正文 32px（18–48px）、昵称 26px、标签 16px、金额 20px；调整正文字号不缩放昵称和标签。默认使用随客户端提供的[专用宋体](../../../public/fonts/sea-breeze/README.md)与系统 Times New Roman；不新增启动下载或服务器渲染器。字形和时序依据视频采样设定。

固定款默认区域 480×700，`styleOptions['sea-breeze'].seaBreezeAlign` 接受 `left/center/right`，默认 `center`；支持原有滚动方向和边缘处理，默认直接切断。随机款默认铺满画布，使用公共避让、停留与退场，渐显默认 800ms，可用通用入场控制调整。已有布局缺少两款时只补齐对应区域，不移动已保存区域。

两款均在「高级参数 → 海风倒影」提供以下字段，分别存入各自的 `styleOptions[style]`；默认保留原倒影。调整直接作用于现有文字层，倒影范围参与消息占位，原文字和身份牌保持清晰；强度或长度为 0 时关闭倒影并收回其占位。

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `seaBreezeReflectionOpacity` | 0–60%，默认 28 | 倒影强度，0 关闭 |
| `seaBreezeReflectionLength` | 0–200%，默认 130 | 倒影高度相对于正文字号的比例，0 关闭 |
| `seaBreezeReflectionGap` | -20–30px，默认 -9 | 原文字层与倒影间距；负值靠近，正值拉开 |

两版均不显示头像；昵称、正文和事件金额组成统一文字倒影。聊天的大航海与灯牌使用本房间 `roomGuardLevel` 与 `roomMedal`，不将其他房间身份升级为本房大航海；主播标记使用 `isStreamer`。游客、舰长、提督、总督分别使用紫蓝、浅蓝、紫、粉红标签，礼物与 SC 使用香槟金。普通礼物显示名称、数量和 `giftTotalPrice` 已结算总额，不重复乘数量；SC 显示实际 `price` 并保留完整原文与换行，昵称、正文和金额复用 `danmaku-superchat-renderer.js` 的 `getSuperChatColors(item).accentColor`：优先采用消息自带的有效配色，缺失或无效时按公共金额档位回退，倒影继承相同文字颜色。未知金额显示 `—`。购买大航海按 `giftGuardLevel` 显示对应身份与欢迎、续费或支持文案；缺少动作时统一显示支持文案，不额外标注开通或续费。现有事件约定不提供房管字段，因此不补造房管标记。

场景入口、示例和公共信息流通过能力标志 `fullscreenSuperchat` 接受本款随机 SC；撤回与到期沿用共享生命周期。稳定快照不重播入场；系统开启「减弱动态效果」时直接显示。桌面选择/保存、画布和本地场景使用同一实现，OBS 与哔哩哔哩直播姬均可通过本机场景浏览器源显示。

### 沉笺下沉飘窗

`sinking`（沉笺）位于本机样式库的「飘窗弹幕」，默认铺满画布；旧本机布局缺少本款时补齐区域。`danmaku-sinking.js` 重组公共安全消息 DOM，`danmaku/sinking.css` 使用九宫格贝壳玻璃底片，保留原生文字、行内表情、礼物名称与数量、上舰动作及 SC 完整原文。普通礼物通过共享 `gift-image.js` 显示礼物图片首帧的静态 WebP，上舰使用当前房间的大航海图标；图片位于礼物文案上方。礼物使用 `giftTotalPrice` 已结算总额，SC 使用实际 `price`。默认宋体、正文 30px（18–40px）；三张本地 WebP 与来源记录位于 `img/overlays/danmaku-sinking/`，随客户端交付，不增加启动下载或服务器渲染器。

`danmaku-sinking-geometry.js` 持有底图 alpha 边缘采样，按 CSS 相同的九宫格映射上凹边及左右边，再将出生点投影到薄片当时的转动、透视与用户变换，用户透视距离与卡片 CSS 共用 `transform.perspective`（缺省 1000px），脱离后独立上浮。三色共用相同 alpha；更换底片或九宫格参数时须同步采样与映射。

专属字段保存在 `styleOptions.sinking`，桌面和画布共用「沉笺 · 水下薄片」参数组：

| 字段 | 范围与默认 |
| --- | --- |
| `sinkingPalette` | `ivory` 珍珠白（默认）、`mint` 浅海绿、`blue` 冰蓝；默认正文色随色泽变化，显式自定义色保留 |
| `sinkingDurationSeconds` | 2–30 秒整数，默认 10；含入场、阅读和退场 |
| `sinkingTravel` | 区域高度的 10–40%，默认 24%；受可用空间约束 |
| `sinkingSway` | 0–36 逻辑 px，默认 18；按区域宽度缩放 |
| `sinkingBubbleDensity` | 1–100 整数，默认 50；低、中档沿用原曲线，50 以上平滑增加，100 为原成品预览最大密度的 3 倍（120 个/秒，每张最多 390 个粒子槽位） |

`danmaku-sinking-feed.js` 以单条 rAF 循环驱动入水、缓慢下沉、退入深处及气泡动画，复用现有随机落点算法并预留整段运动路径。入水与退场的景深模糊仅应用于玻璃底片，昵称、正文、表情和金额保持清晰。卡片最短入场间隔 180ms，拥挤时最多等待 2 秒；新消息取得位置后才开始计时，快照按原时间恢复，过期不重播。每条锁定停留、行程和摆幅，参数修改只影响后续消息；密度与材质原位更新，不重置当前卡片寿命。气泡出生位置按复用周期缓存，区域或相应卡片几何变化时失效。可见气泡由所有卡片共用的透明 Canvas 绘制，底片、轮廓阴影、原生文字与表情仍由各卡绘制。表面光泽与水深只在对应阶段参数变化时更新。撤回、清空和销毁释放节点与粒子；系统开启「减弱动态效果」时关闭下沉、摆动和气泡，仅保留淡入淡出。通用横移速度、分散和边缘参数不适用于本款。样式保存与本地场景输出共用既有账号外观存储和事件订阅，场景允许 SC 并转发撤回。

### 漫画分镜区域随机弹幕

`comic`（漫画分镜）为客户端内置区域随机样式，默认铺满画布；旧本机布局缺少该区域时补齐。`danmaku-comic.js` 重新组合公共安全渲染器的文字、头像和 B 站表情，`danmaku/comic.css` 绘制原创 SVG 对白框、旁白框、爆炸框及淡网点纸面。设计参考为 [Comicalize](https://booth.pm/ja/items/8139579) 的漫画语言，不交付原商品图片或模板。样式外观保存在授权账号的本机桌面存储，输出复用既有场景订阅；不新增消息连接、资源下载或服务器渲染器。

正文默认宋体、26px，范围 18–42px；昵称和头像保持独立尺寸。普通聊天可横排或从右向左竖排，长文沿用信息流的完整测量与整体适配。礼物及上舰用横排旁白框，SC 用横排爆炸框，保留完整原文与换行。身份只取 `roomGuardLevel`/`roomMedal`；上舰称谓取 `giftGuardLevel`，开通/续费取 `guardAction`，未知动作显示支持。礼物金额使用 `giftTotalPrice` 单条已结算总额，不再乘数量，未知金额显示 `—`。聊天、礼物、上舰与 SC 共用随机避让、2–30 秒停留和清理；场景消息层允许本款 SC，并沿用本场 SC 撤回。

以下字段仅由 `styleOptions.comic` 接受，客户端与画布共用参数编辑器：

| 字段 | 值/范围 | 默认 | 行为 |
| --- | --- | --- | --- |
| `comicWritingMode` | `horizontal` / `vertical` | `horizontal` | 普通聊天阅读方向；已有内容重新测量 |
| `comicShape` | `mixed` / `speech` / `box` / `burst` | `mixed` | 后续普通聊天造型；混排结果按消息内容稳定选择 |
| `comicStrokeWidth` | 整数 1–4 | 2 | 墨线宽度，px |
| `comicTexture` | 整数 0–30 | 8 | 纸面网点不透明度百分比，0 关闭 |
| `comicEntrance` | `pop` / `ink` / `fade` / `none` | `pop` | 漫画弹出/墨线勾勒/轻柔渐显/直接显示，创建消息时锁定 |
| `comicEntranceMs` | 整数 180–800 | 420 | 入场时长，ms，创建消息时锁定 |

入场图形层与正文层分离：弹出只短暂缩放、轻转纸面；正文最多下移 5px 后渐显，不旋转、抖动或持续变形。墨线方式勾勒 SVG 边线，纸面在前 18% 时长内达到设定的不透明度，再带出文字，避免暗背景下黑字先于纸面出现；渐显方式只调整整张对白的不透明度。系统开启「减弱动态效果」时省略这些入场动画。背景不透明度同时作用于纸面与网点，文字保持清晰；通用视觉效果以 `art` 作用于 `.comic-ink` 的透明轮廓，不开放矩形底板内阴影/内发光。测量、避让、拥挤淘汰、到期渐退和销毁继续由共享信息流模块负责。

参数面板的「漫画造型与入场」使用「入场方式/入场时长」，两个字段只控制出现。勾线由独立 SVG 遮罩按路径推进，显示用的墨线保持 `non-scaling-stroke`，避免拉伸后归一化虚线只绘出很短一段再突然补齐。正常到期使用上面的随机通用退场参数，默认最后约 400ms 整条渐隐；`durationSeconds` 包含入场和退场，默认 6 秒与 420ms 入场组合，完整稳定显示约 5.3 秒。拥挤淘汰、显式撤回和清空即时移除；开启「减弱动态效果」时到期直接清理。

### 散落小窗区域随机弹幕

`window`（散落小窗）为客户端内置区域随机样式，默认铺满画布；旧本机布局只补齐缺失区域。造型参考 [随机小窗弹幕](https://booth.pm/ja/items/9096557) 的圆角窗面、昵称胶囊与窗角图形，以原创 DOM/CSS 实现，不包含原商品素材。`danmaku-window.js` 复用公共安全文本、头像和表情渲染器，`danmaku/window.css` 负责窗面与分层入场；布局、避让、拥挤淘汰、到期与撤回清理由共享信息流模块负责。外观按授权账号保存在本机，客户端、画布和本机场景共用，不新增服务器渲染器、资源下载或消息连接。

正文默认 26px、范围 18–40px，头像保持 21px、昵称 20px、粉丝牌 14px，不随正文字号变化；聊天、礼物、上舰和 SC 的昵称使用相同行高与字距。昵称限制在 8em 内、最多两行，超出两行省略；昵称胶囊、大航海图标与粉丝牌垂直居中，空间不足时身份栏换行，身份栏为右侧窗角装饰预留空间。正文完整换行，超出区域的单条消息沿用整张等比适配。普通聊天保留 B 站表情。昵称右侧的大航海 WebP 替代原有文字身份，只读取 `roomGuardLevel`，复用 `setGuardIcon` 的普通/千舰切换；其右侧的圆角粉丝牌读取 `roomMedal` 的名称、正整数等级、颜色与点亮状态，不使用其他房间的佩戴身份。两项默认开启，缺少对应身份时独立隐藏。礼物和上舰显示真实名称、数量及 `giftTotalPrice` 已结算总额，不再次乘数量；上舰称谓取 `giftGuardLevel`，动作取 `guardAction`，未知动作显示「支持」。SC 保留完整字面原文、换行和实际 `price`；金额缺失显示 `—`。四类消息共用 2–30 秒停留、随机分布与本场 SC 撤回。

以下字段仅由 `styleOptions.window` 接受。客户端、画布和独立预览均在「配色与外观」中显示「大航海图标」和「粉丝牌」；其余字段在「高级参数 → 散落小窗」中编辑：

| 字段 | 值/范围 | 默认 | 行为 |
| --- | --- | --- | --- |
| `windowPalette` | `porcelain` / `sakura` / `night` | `porcelain` | 白瓷蓝/樱花粉/月夜蓝，联动窗面、边框、昵称牌及默认正文色 |
| `windowWidth` | 整数 220–560 | 380 | 单张窗面逻辑宽度，px；长文换行，现有消息重新测量 |
| `windowRadius` | 整数 10–36 | 22 | 窗面圆角，px |
| `windowControls` | `show` / `hide` | `show` | 显示/隐藏右上角最小化与关闭图形，仅作装饰 |
| `windowGuard` | `show` / `hide` | `show` | 显示/隐藏昵称右侧的本房间大航海图标，已有消息即时生效 |
| `windowMedal` | `show` / `hide` | `show` | 显示/隐藏大航海图标右侧的本房间粉丝牌名称与等级，沿用接口配色，已有消息即时生效 |
| `windowEntrance` | `mixed` / `pop` / `unfold` / `rise` / `none` | `mixed` | 随机混合/轻弹出现/小窗展开/轻盈上浮/直接显示 |
| `windowEntranceMs` | 整数 180–1000 | 460 | 入场时长，ms，直接显示时停用控件 |

入场方式与时长在创建消息时锁定，只作用于新消息；混合按消息种子稳定选择。窗框独立缩放、展开或上浮，正文只渐显并轻移 3px，不缩放、旋转或持续漂移；快照直接显示完整小窗。`ambientMotion` 仅控制内边线呼吸，关闭后保留新消息入场。系统开启「减弱动态效果」时关闭入场与呼吸。背景不透明度只作用于窗面及昵称底色，文字与边框保持清晰；显式正文色优先于配色默认值。字体、停留、退场、中心倾向与离散程度沿用本款通用参数，恢复默认只重置当前样式。

### 飘窗弹幕

掠影飘窗样式 `floating` 为固定/随机之外的独立布局，由 `danmaku-floating.js` 复用消息渲染器。灰底浅色描边圆角卡片从右向左匀速移动，大航海深色、其余浅色；仅显示昵称与正文/表情，SC 不显示。两款飘窗（`floating`、`comet`）的礼物通知共用普通弹幕的昵称栏与正文布局，正文为「用户名投喂了礼物名×数量」，不使用通用礼物卡片结构。`styleOptions.floating.speedPixelsPerSecond` 为 20～600 整数、默认 120 逻辑像素/秒，默认区域铺满画布；旧九/十区域配置补齐缺失区域。预览、桌面参数与服务端正式画面同步支持，动画、计时器及观察器由布局模块释放。

所有飘窗样式的基础参数共用「飘动速度」和「分散程度」滑块，均为 1～100、默认 50，设置按款保存。速度刻度以 `round(120 × 3^e)` 映射，`e=(s−50)/49`（s≤50）或 `(s−50)/50`（s>50）：1/50/100 对应 40/120/360 逻辑像素/秒；保存继续使用 `speedPixelsPerSecond`。旧 20～600 数值完整保留，调其他参数不会裁剪；超出新刻度范围时显示实际倍率及「旧值」，直到用户手动调整速度。

飘窗的 `styleOptions.<style>.floatingDispersion` 为 1～100 整数、缺失默认 50；固定及区域随机样式拒绝此字段。位置计算由 `danmaku-floating-position.js` 负责：以当前时刻的卡片/特效/拖尾边界计算到最近在途弹幕的欧氏边缘距离，在整个纵向范围内二分可用区间求最大间距。1 从基础间隙（最多 8 逻辑像素）开始随机选位，50 使用基础间隙至最大可用间距之间的中间门槛，100 选择全域最远位置（含上下边界及中间空隙），不限制为若干卡片高度。第一条均匀随机；更新分散度不挪动已有卡片，更新速度保留当前位置。同速平移保持入场时的相对距离。拥挤时缩小目标间距，完全无空位时隐藏等待、每 100ms 重试，最多等待 2 秒后淘汰；显示与等待合计沿用 50 条上限。清空/销毁释放等待计时器。

`comet`（鹤舞花枝间，原流光彗尾）沿用飘窗布局和速率，参数与区域仍按 `comet` 保存。各身份统一使用参考图的香槟金横框、左侧花枝、右侧白鹤及上方独立花纹昵称牌；暖金文字带柔和白色描边，昵称、正文和表情均为实时 DOM。花框和昵称牌为不含示例文字的透明 WebP，金框与昵称牌底板按九宫格伸展；重绘的花叶、白鹤、花簇与灯笼分别锚定四角，随框体增高沿对应上下边缘展开，保持原比例、不挤在中部；昵称牌小花保持固定尺寸，长昵称及多行正文分别扩展对应区域。卡片按内容在 459–700px 之间伸缩，默认 30px 字号下 30 字排 2 行、40 字排 3 行，昵称牌与正文、金色底板居中对齐；小区域整体等比缩小。全部装饰包含在卡片边界内，完整离场后清理；不再外伸丝带尾部或播放布料波纹，不增加动画计时器。背景透明度同时作用于花框和昵称牌，文字保持不透明。素材来源见 `public/img/overlays/danmaku-comet/provenance.json`。

### 极光薄笺飘窗弹幕

`aurora`（极光薄笺）为客户端内置飘窗，复用 `danmaku-floating.js` 的匀速横移、分散、拥挤等待和完整离场清理。默认铺满画布，旧本机布局缺少 `aurora` 时补齐默认区域；账号本机外观、画布共享参数与本地场景输出继续沿用既有存储与同步链路。普通消息保留真实昵称、完整文字与 B 站表情；礼物显示真实礼物名、数量和 `giftTotalPrice` 单条已结算人民币总额，不再次乘数量，缺失金额显示 `—`；上舰按真实 `guardAction` 显示开通/续费，未知动作显示支持。沿用飘窗约定不显示 SC。

造型由 `danmaku-aurora.js` 组合公共安全渲染器的内容，`danmaku/aurora.css` 绘制原创珠光纸面、切角、独立昵称签和吊饰；参考为 [jelly float 极光评论](https://booth.pm/ja/items/8000236) 的材料与构成，不携带原作商品素材。公共渲染核心的固定来源快照不变。卡片外层交给信息流模块移动，内层在 520ms 内完成轻推渐显，昵称 420ms、正文 300ms 分别延后 80ms、130ms 渐入；仅在信息流标记实际开始显示的 `[data-live-entry]` 上播放，等待位置与恢复快照不提前播放入场。持续流光周期 11 秒，吊饰轻摆 6.8 秒，文字不参与持续变形。关闭公共 `ambientMotion` 或系统开启「减弱动态效果」时，装饰循环停止；该模式下还会省略分层入场，保留横向阅读位移。

正文字号默认 26px、范围 18–40px，昵称为独立 21px 层级；卡片随长文增高，装饰留在测量边界内，小区域沿用信息流的整体适配。公共背景不透明度作用于纸面与昵称签底板，不淡化文字；通用效果按 `art` 作用于纸片、昵称签与吊饰的透明边缘，不开放矩形底板的内阴影/内发光。以下独立字段均位于 `styleOptions.aurora`，仅本款接受，客户端和画布使用同一控件约定：

| 字段 | 范围/选项 | 默认 | 作用 |
| --- | --- | --- | --- |
| `auroraPalette` | `lilac`、`glacier`、`rose`、`champagne` | `lilac` | 紫藤极光、冰川青蓝、玫瑰晨曦、香槟月白；不覆盖自定义正文颜色 |
| `auroraSheen` | 整数 0–100 | 55 | 珠光强度百分比，作用于纸面叠层与高光 |
| `auroraCharm` | `star`、`moon`、`none` | `star` | 四角星、月牙或隐藏；切换不改变已有卡片尺寸 |
| `auroraSway` | 整数 0–12 | 5 | 吊饰左右摆幅（度）；0 为静止，不移动正文 |
| `auroraEntrance` | `layered` / `none` | `layered` | 薄笺分层展开/直接显示；逐条锁定 |
| `auroraEntranceMs` | 整数 180–1200 | 520 | 入场时长 ms，按比例调整纸面、昵称与正文时序；逐条锁定 |

配色、珠光、吊饰与摆幅通过 dataset/CSS 变量更新已有卡片，不重播入场；恢复默认只清空本款参数。字体、文字颜色、速度、分散及通用效果继续复用公共约定，不增加独立连接或计时器。此新增款在客户端交付。

分层时序由本款 CSS 按 `auroraEntranceMs` 比例编排；`auroraEntrance=none` 时内部直接显示，横移不变。边缘显隐使用飘窗通用参数，清理仍等完整卡片移出。吊饰摆幅仅在吊饰可见且 `ambientMotion=on` 时产生可见动作，隐藏或关闭循环不会丢弃已保存摆幅。

### 星轨飞语飘窗

`startrail`（星轨飞语）为客户端本地内置飘窗，默认区域铺满画布，正文默认 28px、范围 18–44px。`danmaku-startrail.js` 在既有安全消息渲染器的昵称、正文、表情和礼物名/数量 DOM 外组合原创四角星、光尾与三枚星尘；移除通用礼物卡片标记，使礼物保持同款透明文字造型。礼物/大航海图片复用既有图片节点与加载逻辑，移到昵称前，按昵称字号显示为 1em 方框（默认 21px）、等比缩放并垂直居中，未加载或加载失败时隐藏；动作、礼物名与数量仍在第二行。昵称按消息 `guardLevel` 区分：普通/粉丝牌使用中性浅灰，大航海复用 `danmaku/base.css` 的共享配色变量 `--guard-captain`（舰长蓝）、`--guard-admiral`（提督紫）、`--guard-governor`（总督红），不维护本款专用身份色，与星芒颜色参数独立。既有服务器渲染器快照和远程仓库不变，SC 沿用飘窗不展示规则。

`styleOptions.startrail` 专属字段：`startrailColor` 为六/八位 HEX、默认 `#b9dfff`；`startrailStarSize` 为 12–40 整数 px、默认 24；`startrailTailLength` 为 0–360 整数 px、默认 180，0 隐藏尾迹；`startrailGlow` 为 0–100 整数、默认 45；`startrailDust` 为 `on|off`、默认 `on`；`startrailEntrance` 为 `spark|none`、默认 `spark`（星芒点亮/直接显示）；`startrailEntranceMs` 为 250–1200 整数 ms、默认 680。字段由共用约定生成控件并在本机 Node 镜像校验，仅本款可用。没有底板，不提供背景透明度；公共效果按文字型表面处理，速度、分散程度与 `ambientMotion` 复用既有字段。

`danmaku/startrail.css` 负责分层入场和装饰循环，正文不做缩放/位移动画。样式通过内部 `--danmaku-entry-inset` 声明星芒、间距与首字宽度的逻辑 px 内缩，飘窗信息流按实际组件缩放仅在新消息首次放置时读取，使低速时入场也在可视范围开始；其他款缺失时为 0，快照继续按原时间恢复，速度/尺寸更新不重新内缩。共用信息流在新增消息真正取得可用位置时标记 `data-live-entry`，等待期间不启动入场，快照恢复不标记；速度或外观更新不重播标记。入场方式和时长在创建消息时锁定，之后调节只影响新消息，避免已完成的正文渐显重新启动；直接显示或开启「减弱动态效果」时不使用入场内缩，从区域右边缘移入。`--danmaku-trail-width` 返回实际 px 尾长，供既有位置计算与完整离场清理逻辑读取。

左右边缘使用飘窗通用显隐参数，默认每端 28 逻辑 px 且不超过区域宽度 4%；中部保留完整透明度。进入和消失均随匀速移动经过柔边，完整光尾离场后才清理，不增加独立退场时长或停留参数。星芒中央亮点继承颜色 alpha，0% 不透明度不会残留白点；辉光字段在界面以百分比显示，值域及默认不变，入场建议 450–800ms。星尘依附光尾，尾长为 0 时一并隐藏。样式与循环无额外计时器或连接；开启「减弱动态效果」时关闭入场强调与装饰循环，保留横向阅读。

### 1.1 通用模式

所有叠加层遵循以下通用模式：

- **透明背景**：`html,body` 透明（`overlays/base.css`），只渲染卡片面板，供浏览器源叠加；加班机层使用独立样式（整屏倒计时）。
- **状态获取**：队列、歌单、盲盒和加班机通过 `/api/state` 获取首帧，通过 `/ws` 接收后续快照。断线后按指数退避重连。盲盒使用连接首帧刷新统计，其他三页在重连时补读状态。见 [comms.md §3](comms.md#33-断线重连与退避)。
- **字体**：中文字体栈 `Microsoft YaHei / PingFang SC` + 多语言回退（`overlay-utils.js` 的 `multilingualFontFallback`）；队列/歌单板经 CSS 变量 `--overlay-font-family` 由管理页设置注入，加班机数字与 LIVE 徽标用 Bahnschrift / Bahnschrift SemiCondensed（见 §4）。
- **指纹去重**：内容未变不重渲染（队列层 `computeStateKey`、歌单层三段指纹、加班机 revision 比较，详见 [comms.md](comms.md) §3.2）。
- **点歌 LIVE**：所有点歌板样式仅在单项 `is_live` 为 true 时显示深珊瑚红底、白色圆点与 LIVE 字样的紧凑徽标；预览与实际浏览器源复用同一徽标，预览示例通过 `is_live` 标记，不把状态文字写入歌名。使用后端队列顺序，不根据第 1 位猜测演唱状态。`is_live` 纳入队列指纹，单独切换标记也会刷新。
- **低功耗模式**：`overlay-utils.js` 的 `overlayLowPowerEnabled(settings)`——URL 参数 `?quality=low` 强制开启、`?quality=pretty|smooth` 强制关闭、否则读设置 `overlayLowPowerMode`（[overlay-utils.js:48-53](../../../public/js/overlays/overlay-utils.js#L48-L53)）。低功耗下加班机走 `low-motion` 类（动画 180ms、关闭 transform/filter，[overtime.css:307-310](../../../public/css/overlays/overtime.css#L307-L310)）。

### 1.2 CSS 变量注入表(唯一成文处)

队列、歌单和盲盒叠加层通过各自的 `applyTheme` 把设置写入 `:root` CSS 变量。歌单仅在主题字段变化时写入。以下是**全部 28 个** `--overlay-*` 变量的注入来源与默认值。写入由 [overlay-theme.js](../../../public/js/overlays/overlay-theme.js) 的 `applyOverlayTheme(root, panel, settings, options)` 统一完成：共享实现只负责变量与 `low-power`/`has-backdrop-blur`/`gradient-bg` 类，页面通过 `resolve`（键覆盖规则）、`defaults`（本页默认值）和 `fontScale` 三个接缝保留各自差异。歌单板用 `resolve` 实现「独立主题时优先 `songBoard*` 覆盖」，并覆盖 `themeOpacity`/`themeRadius`/`backdropBlur`/`glowIntensity`/`gradientEnd` 的默认值；下表的默认值列是共享默认，不是每个页面的实际取值。

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

[overlay-utils.js](../../../public/js/overlays/overlay-utils.js) 为 ESM，导出 `escapeHtml`、`hexToRgb/hexToRgba`（主题色兼容转换）、`withMultilingualFallback`（字体栈回退）、`scrollTravelSeconds`（滚动时长换算）、`overlayLowPowerEnabled`（见上）。转义和字体回退直接复用 shared；颜色函数保留既有非法输入和透明度约定。队列工具、盲盒、主题适配和歌单板均从 `./overlay-utils.js` 具名导入。

独立弹幕 `/danmaku?preview=1` 从 `shared/danmaku-style-options.js` 选取可独立展示的内置样式，从 `shared/canvas-presets.js` 读取画布尺寸，两个菜单只在独立预览中构建。旧预览链接或本页历史草稿选中了月渡花汀（`moonlit`）时，页面回到默认样式 `signal`。月渡花汀通过场景或组件预览读取已导入的素材。旧 `danmaku-editor:*` 消息及 Apply/Close 控件已移除，现行 `component-preview:*` 集成保留。`danmaku/motion.css` 定义公共 entry-clock/enter-opacity 关键帧，各样式继续控制各自的时长、延迟、曲线和减弱动态效果（`prefers-reduced-motion`）降级；信息流的运动职责见[弹幕运动约定](danmaku-motion.md)。

透明来源的 `.overlay-body` 基础规则由 `css/overlays/body.css` 提供，`gift-effects.html` 直接加载它及自身效果/字体样式，不再加载点歌和歌库主题。两种开播 Canvas 的公共显示规则由 `opening.css` 维护，像素渲染和背景差异保留；三种队列插画主题的共用大航海颜色在 `base.css` 主题导入之后定义。

### 歌单虚拟滚动（song-virtual-scroller.js）

歌单板专用：可变行高记录的**环形 DOM 窗口**虚拟滚动（[song-virtual-scroller.js:28-58](../../../public/js/overlays/song-virtual-scroller.js#L28-L58)）。

- **工作原理**：以 anchor 记录（当前视口首行 key/index/offset）为起点，向两侧按 `beforeViewports=1 / afterViewports=1.5` 个视口高度增量构建 DOM 节点（`probeOverflow` 先探测内容是否超出一屏，不超出则整表渲染），`wrapIndex` 取模实现环形复用；滚动时按 `pixelsPerSecond * elapsed / 1000` 推进 `scrollTop`，超出前缓冲区的顶部节点被回收并追加到尾部（`recycleTopRecords`），始终保持窗口内只有可见 + 缓冲节点。
- **联动**：`setRecords`/`relayout` 以 anchor 保持视口稳定（歌单刷新/字体加载完成/视口 resize 时不跳位）；`songs.js` 将 `scrollSeconds`（沿用设置键名）或 URL `speed` 的 1–100 档位通过 `scrollSpeedToPixelsPerSecond` 线性映射为 1–250 CSS 像素/秒，默认档位为 20（约 48.79 CSS 像素/秒），再调用 `setPixelsPerSecond`；高度仅影响可见内容和缓冲区，不参与速度计算。组件预览和实际展示共用此逻辑；页面隐藏时 `pause()` 停止 rAF（[songs.js:102-108](../../../public/js/overlays/songs.js#L102-L108)）。
- **速度精度**：保留浏览器写入 `scrollTop` 后的像素舍入余量，下一帧与回收顶部节点时继续累计；低速不会因高刷新率停住，各刷新率下保持相同的每秒位移。
- 浏览器无 `requestAnimationFrame`/`ResizeObserver` 时自动降级（整表渲染 + window resize 监听）。

### 1.4 礼物四方边框(`/gift-effects`)

「全屏礼物感谢」内置 `gift-drop`（礼物掉落）和 `gift-swing`（礼物摇摇乐）。两款可同时启用，在客户端分别保存最低结算金额、大小和存活时长；摇摇乐另有摆幅。画布 `gift-frame` 的两张内置卡使用可选 `style` 字段选择对应主题；旧 `{}` / `follow` 接受全部已启用主题，导入资源和媒体样式不播放这两款。导入的图片/视频图层只播放 `themeId: imported` 且 `styleIds` 含自身 `mediaStyle.id` 的事件，不再跟随林间花信；其他图层（内置、林间花信资源样式、CSS 外观）忽略 `imported` 事件。预览样例不受此限制。规则由共享 `gift-frame-style-triggers.js` 的 `isGiftFrameEventForLayer` 维护。场景和素材库备份只保存原生动效的样式选择。恢复后，启用、触发金额、大小和播放时长等参数取接收端的礼物设置。修改只影响后续结算，画布示例从同一已保存设置读取，参数页的预览可展示未保存草稿。

两张内置卡片的「复制浏览器源」分别生成 `/gift-effects?giftStyle=gift-drop` 和 `/gift-effects?giftStyle=gift-swing`，无需创建或发布画布。固定来源入口 `gift-effects.js` 在既有单一 WebSocket 上只分发与该 `giftStyle` 相同的 `gift:frame`，忽略另一款动效、林间花信、官方礼物特效及大航海感谢；不带该参数的组合来源保持原行为。来源使用本机已保存的启用、金额和动效设置，复制不保存草稿；推荐来源尺寸分别为 1920×1080 和 1920×420。

两款的参数直接展示在各自卡片中，画布也提供完整启用、金额和动效控件，自动保存至同款效果的本地设置并双向回填。均提供速度控制；摇摇乐的「运动速度」同时控制左右摇摆和上下起伏的快慢，「左右摆幅」设置最大倾斜角度。掉落另有掉落数量与弹跳力度，摇摇乐的送礼人、礼物名、数量可分别勾选，全部关闭仅保留图片与直杆。组合由共享 `gift-motion-settings.js` 的 `GIFT_SWING_TEXT_MODES` 定义，复用原 `textMode` 字段并保留 `full/gift/none` 含义。范围与默认值见[本机礼物动效设置](../backend/storage.md#71-关键设置的归属与约束)。两端复用 `gift-motion-parameters.js`，客户端保存只提交脏字段，未保存的草稿预览不改正式事件参数。金额使用窄输入框，其他数值使用带范围端点的 `parameter-range` 滑块，旁边只读显示当前值和单位。

`gift-motion-player.js` 和共享 `gift-drop-physics.js` 分别负责 DOM/动画生命周期与固定步长刚体计算：

- **事件载荷与生命周期**：事件沿现有 `gift:frame` 携带独立 `eventId`、`startedAt`（本机收到终态礼物事件的毫秒时间戳）、`artworkPath` 与 `motion.size/durationSeconds/speed`，掉落另含 `bounce/count`，摇摇乐另含 `angle/textMode`，不进入旧版先进先出队列。大小按 1920×1080 逻辑舞台计算；缺少参数时沿用字段默认值。整批掉落与摇摇乐都以 `startedAt + durationSeconds * 1000` 为截止时间；掉落数量、速度设置、图片加载、准备等待、页面隐藏都不重新计时。播放器记录图片是否已经显示，图片加载在截止后才完成也不得首次显示；已过截止时间的迟到事件不再加入。重复事件不重复生成；来源重置、关闭画面和销毁统一清理节点、帧循环、预览定时器与监听；普通连接短暂中断时已显示的掉落仍按原截止时间结束。正式来源不产生示例、不重播历史、不增加图片目录或 B 站请求。
- **掉落物理与容量上限**：掉落初速度按速度倍率缩放、重力按其平方缩放，碰撞取两件礼物较低的弹性；碰撞框宽高为图片的 80%（与图片中心对齐，对透明留白与不规则轮廓做简化近似），图片仍按设定原尺寸显示。每条最终结算记录按 `motion.count` 生成一批图片（默认 30 张，实际 `num` 不变；设置范围见[本机礼物动效设置](../backend/storage.md#71-关键设置的归属与约束)），实际送礼数量大于生成图片数时最后一张保留真实余量；旧事件只有 `quantityMultiplier` 时保留原算法（最多 60 份代表图乘倍率），同时存在 `count` 时优先使用数量。每张图片分配随机准备延迟（上限取 2000ms 与设定时长一半的较小值），到 `startedAt + delay` 后仅在顶部存在可容纳空位时放行，否则隐藏等待且不参与碰撞；到期仍未入场的图片立即移除，已入场的退出碰撞并继续受重力下落、在 600ms 内渐隐移除（系统开启「减弱动态效果」时仅渐隐并按时释放支撑）。同屏最多 400 张（含等待下落项），容量不足时减少本次生成数、不提前淘汰旧礼物，每次新增与每帧更新均回收已结束项。画布与独立预览每轮按同一设置生成单份礼物示例，在该批停留时间、600ms 退场及 1 秒间隔后再循环，不叠加随机准备窗口。
- **摇摇乐舞台与位置排布**：摇摇乐每次结算生成一张由 SVG 直杆支撑的礼物图（无底座），按该次结算的 `textMode` 显示文字，独立摇晃与到期，最后 600ms 淡出；每次接收新立牌时先回收已过截止时间的立牌，再按 80 张上限判断是否接纳。页面隐藏期间过期的立牌同样释放名额。同源留存历史激活或同账号清库重建时，独立摇摇乐的立牌按原截止时间退场，事件 ID 继续用于去重。`giftSourceEpoch` 改变时，清除旧立牌和去重记录，新来源可使用相同 ID。礼物图、文字与直杆共用旋转容器绕底端中心转动，杆体纵向伸缩（上限为原长 1.8 倍并受图层高度约束），杆顶伸入礼物图中心并被遮挡，礼物图与文字随杆顶平移不拉伸；伸缩周期略快于左右摆动，每张独立随机初相、周期偏差与摆幅系数，摆角不超过设定摆幅；开启「减弱动态效果」时保持直立和原始杆长。选位优先在已有礼物运动范围外预留 24 逻辑像素空隙，不足时从 32 个随机候选中取净间距最大者，不挪动已有礼物。摇摇乐使用独立底部舞台按 1920 逻辑宽度等比缩放，新图层默认 1920×420 并贴齐底边。掉落与摇摇乐均通过共享 `gift-image.js` 经 `gift-static-image.js` 转换并缓存首帧静态 WebP（失败回退占位图）；礼物许愿复用该转换并保持静态 PNG。

`gift-effects.html` 保留透明全屏浏览器源地址，接收 `gift:frame`，并将 `gift:effect`
交给独立的 `gift-effect-player.js`。官方特效按已验证 RGB/alpha 坐标用 WebGL 合成，
单条播放、最多 3 条等待、等待超过 12 秒丢弃；错误、30 秒超时和停用统一清理。
弹幕开关关闭或 WS 断开时停止指令特效并清空其队列；手动预览不受开关限制。
服务器代码解析、桌面共用测试播放解析器和兼容规则见[弹幕礼物特效规格](../../../specs/gift-effect-danmaku.md)。

桌面解析与手动测试播放共用 [effect-config.js](../../../src/bilibili/gift/effect-config.js) 的 `createGiftEffectResolver`：同一礼物关联多份有效配置时取数值最大的 `effectId`；配置在内存中缓存 12 小时，过期后按需刷新；刷新失败沿用旧缓存，60 秒内不重试。配置请求合并在途任务，坐标按 URL 缓存并合并在途请求，坐标拉取或校验失败时跳过本次播放，同 URL 60 秒内不重试。配置须同时提供 HTTPS 的 MP4 与坐标 JSON 地址，域名限 `hdslb.com`、`bilibili.com`、`bilivideo.com` 及其子域；`gift-effect-player.js` 再校验 MP4 地址和 RGB/alpha 布局有效性，不接受无布局的亮度抠黑回退。上游字段与历史坐标样例见[特效配置资料](../../bilibili-live-api/gift-effect-config.md)。

**特效 1 · 林间花信**（`themeId: woodland-bloom`）通过全屏礼物感谢页「添加样式」导入 1.0.0 ZIP 后播放本地 `woodland-bloom-v4.webm`，旧图层的视频入口优先使用当前安装的版本。只有没有可用安装版本时，才回退到素材目录仍在的软移除版本。视频由样式包提供。
原生 2560×1440、30fps、8 秒，具有真实 VP9 Alpha。四边各层在 0–1.2 秒依次入场，1.2–7.2 秒完整动态展示，
7.2–8 秒同步退场；植物与飘落装饰动作已包含在视频内。`gift-effects-frame.js` 使用原生 video 播放，
不再逐帧重绘植物。视频与文字共享 1920×1080 逻辑舞台，按视口短边等比缩放并居中，不拉伸。
四边使用重新绘制的 `edge-top/bottom/left/right.webp` 高清花叶素材；上、下各由两段缩小搭接，两侧缩小到
1440 像素高，铭牌独立重绘。素材不放大，固定花叶不再做局部网格变形，保留细节与自然轮廓。
`botanical-motion-atlas.webp` 的活动枝叶、花茎位于主花簇后方，花头单独放在前景并共享茎根旋转，
避免左侧茎穿过主玫瑰或花头被叶片切开；飘落花瓣与落叶最后合成。
密度以四角、左侧上半部主花与右侧下半部花簇为重心，上边中段、两侧中段及铭牌上方删减花叶；
活动枝叶/花头/飘落装饰分别为 14/6/4 组，避免沿边等距堆叠。
枝叶和花头围绕茎根错相摆动，花瓣/落叶沿边缘漂移，四边按一致的前后顺序合成后烘焙在同一视频内。
中央原生像素区 (414,347)–(2146,1133) 保持透明。以下仍为逻辑坐标：铭牌保留原位置，96×96 的送礼头像居中放在 (912,864)，
牌内文字区在 (676,966)，大小 568×56，整句随内容长度水平居中、字面垂直对齐铭牌中心，
单行显示「感谢 {礼物名}×{数量} ~」；动态文字由 `textContent` 写入，不显示金额。
头像读取事件 `avatarUrl`，经既有 B 站头像代理和 `gift-effects` scope 访问凭证加载；缺失或失败使用默认头像，预览无真实头像时使用本机示例。
文字在 0.65–1.1 秒跟随铭牌淡入，7.2 秒开始淡出，完整展示阶段固定；长文字先适量减小字号，再省略尾部，数量独立保留。
原生边框画布预览以共享的 8 秒时长乘示例事件数后留出 1.5 秒间隔，避免旧 8 秒循环截断退场。
导入的 WebM 通过 `/component-media/` 支持 Range/HEAD。旧图层及 `/gift-effects` 仍使用原静态视频 URL，由 `gift-frame-resource.js` 解析已安装的官方预设并返回不缓存的 307；未导入时返回 404，从库中移除卡片仍保留既有图层资源。HTML 不再预加载固定路径，由播放器在收到组件配置后选择资源，避免导入样式额外请求旧路径。

`gift-frame-queue.js` 负责自定义边框的 FIFO 队列：1 条播放、最多 50 条等待；当前播放不被插队或打断，
满队列忽略新事件，已排队项不因等待时长失效，也不按金额排序。实时与预览均按 eventId 去重，
预览接口每次生成独立 ID。队列接受 `woodland-bloom` 与 `imported`，缺省主题仍按特效 1 处理；导入媒体先由组件按 `styleIds` 筛选，再进入同一顺序队列，旧 `/gift-effects` 不接收导入事件。
`gift-frame-player.js` 交给 `gift-effects-frame.js` 播放。特效 1 由 `giftFrameEnabled` 和
`giftFrameThresholdRmb` 控制；终态礼物按整数分比较触发门槛。
缎带礼笺已撤销，其管理入口、播放器与素材已移除；历史设置不再参与触发，旧主题事件被队列忽略。
加载允许 10 秒，媒体进度停滞 5 秒触发清理；加载耗时不扣减特效 1 的 8 秒动画。
正常结束、解码错误、播放拒绝、超时和 pagehide 都释放回调/计时器并清空画面；错误后后续事件重新加载媒体并推进队列。
旧静态图、挂饰、Canvas 粒子和 frame motion 模式已移除；URL motion 仍只影响大航海感谢。
`gift:effect` 官方特效的独立播放器和队列保持既有行为。

**大航海感谢**：辉光和经典分别启用并设置文字，同一页面在 `#guardThanksRoot` 接收 `gift:guard-thanks`：

- **事件与队列**：两款同时启用时，每次合格上舰产生两个带风格后缀的事件，独立风格画布图层各自播放对应事件；通用旧图层及独立页面依次播放。画布组件文字默认 `follow`（跟随事件文字），已有显式 `bilingual/zh/en` 覆盖继续有效。`overlays/gift-effects-guard.js` 按 `eventId` 去重（预览不去重）、逐条播放，最多 12 条等待、超过 90 秒丢弃，队满时舍弃最早的最低等级，有等待时缩短停留。渲染由 `shared/guard-thanks-card.js` 分发到两套风格，时间与 DOM 工具共用 `guard-thanks-stage.js`，均同时供画布预览使用；1280×1080 设计舞台按 `min(宽/1280, 高/1080)` 居中缩放。
- **经典风格（`style=classic`）**：由 `guard-thanks-classic.js` + `css/shared/guard-thanks.css` 渲染，Canvas 粒子由 `guard-thanks-particles.js` 管理。舰长/提督/总督分别呈现蓝色船锚、紫色罗盘、红金船舵的金属徽章，依次播放冲击波与闪光、徽记入场、头像徽章描边、丝带标题逐字弹出与扫光、标语和感谢铭牌，搭配气泡/星芒/彩纸余烬粒子；入场 1.5 秒、停留 3.3/4.0/5.0 秒、退场 0.7 秒。头像仅直连 HTTPS `hdslb` 地址（`no-referrer`），缺失或失败时显示昵称首字，预览使用内置样例头像。
- **辉光风格（`style=aurora`）**：由 `guard-thanks-aurora.js` + `css/shared/guard-thanks-aurora.css` 渲染，光点随卡片统一管理与退场。采用珠贝质感：舰长冰蓝独立船锚、提督紫晶月弧罗盘（仅提督保留实体月弧）、总督红色珠贝与金属独立船舵，使用 1280×1280 的 `img/overlays/guard-thanks/*-pearl-v1.webp`（有损彩色、无损 alpha）透明纹章，适配 2560×1440 16:9 输出，各档统一主色（总督辅以金色）。入场按弧线勾勒、固定纹章淡入（纹章原位不动）、称谓与说明出现、星芒与光点每六枚一组错峰点亮展开；反光按原图 alpha 裁切掠过表面，外圈流光、细光环、柔光晕与光线缓慢流动，整卡统一淡出。称谓使用本地裁剪宋体 `fonts/guard-thanks-serif-400.woff2`，下方排列中英说明与月数，文字全程不虚化、以贴合字形细边保轮廓，**不出现送礼人头像与名字**。图片解码与字库最多等待 1.4 秒，失败或超时回退矢量纹章与系统衬线体（播放中不迟到替换）。各档光饰数量：舰长 1 条流光/18 光点/3 处星芒；提督 3 条流光/32 光点/6 处星芒 + 双弧与 8 枚星链节点；总督 5 条流光/50 光点/8 处星芒/12 枚星链节点 + 9 道冠冕状金色光线与双重扩散环。入场 2.8/3.0/3.2 秒、停留 3.0/3.4/4.0 秒、退场 1.0 秒（总计 6.8/7.4/8.2 秒；连播将停留压缩至 0.7 倍，总计 5.9/6.38/7.0 秒）。
- **降级与预览参数**：两套风格文字均支持中英双语、中文、英文。`?motion=reduced` 或系统开启「减弱动态效果」时只做整卡淡入淡出（辉光保留静态主色构图，隐藏闪光、流光、粒子与光饰）。可通过 `?preview=1&guardPreview=<tier>`（可选 `&guardStyle=aurora|classic`、`&guardText=`、`&guardMonths=`）在页面内单独预览。

### 1.5 开播动画(`/opening`)

`openingStyle` 在工具箱中选择 `classic`（经典舞台，默认）或 `pixel-cassette`（像素卡带），
通过配置字段与 URL 参数 `style` 传递；非法值回退经典舞台。`moonlit-fan`（月渡花汀）保留为兼容枚举，
需导入外置套装并在场景中选用，依赖[资源型样式](#资源型样式)的素材映射，不再是工具箱默认选项。
切换复用原有预览、轮询、总开关及音乐控制。
开播配置默认值由 [shared/opening-settings.js](../../../public/js/shared/opening-settings.js) 的 `OPENING_DEFAULTS` 统一维护；
文案、副标题、主播名、页脚、画质、轨道动效与装饰开关直接取外观定义的默认值，管理页表单回填与浏览器源渲染都读这一份，不各自保留字面量。
像素样式由 `opening-pixel.js` 在 480×270 Canvas 上绘制，按 16:9 最近邻放大。头像默认留空，
通过原人物图上传入口携带 `style=pixel-cassette` 单独保存，不与经典舞台共用图片；上传图保持比例、
居中适配原有 160×160 逻辑像素区域（1920×1080 输出时为 640×640），小图也放大至该区域。
首次选择像素样式时才创建绘图上下文，头像仅在该样式启用且已上传后请求；替换或清除不会重置动画时间。
Canvas 使用固定的 `role="img"`
与无障碍名称；阶梯进度是循环装饰，不逐秒播报。
进度从 0% 开始，每秒跳 20%，100% 保持 1 秒后清空，6 秒一轮；`loading...` 含句点逐字跳跃，
头像、卡带卷轴、装饰及不同路径的背景图案持续运动。低画质或开启「减弱动态效果」时静止装饰，保留阶梯进度；
隐藏、关闭、切回经典样式或 pagehide 时取消像素帧循环；隐藏后恢复沿用当前进度，关闭后重开或重新
切入像素样式从 0% 开始。像素样式下隐藏文案和轨道编辑项并保留保存值；
轨道动效仅用于经典舞台，音乐继续由同一个开播运行时管理。

月渡花汀由 `opening-moon-fan.js` 负责素材与帧循环，`opening-moon-fan-art.js` 负责画面与时间线。
首次启用时加载 `img/overlays/opening-moon-fan/` 中的独立 WebP；22 片共轴展开的山水折扇、
双翼白鹤、四组花枝、绢带、流苏、蝶、花瓣、雾和倒影各自运动。背景保留亭台桥廊、满月、
叠山与水面灯影，以近实远淡的对比区分主体；挂饰只保留左侧一组。
每轮 15 秒：0–3.7 秒展开及文案入场，约 3.7–9.2 秒停留；9.2–10.8 秒文案渐隐，
10.2–13.2 秒扇面共轴收拢，13–13.8 秒折扇下移淡出，绢带/花枝依次退场；
13.8–15 秒仅留山水背景及其环境动作，随后重新入场。背景仅首次淡入，周期边界不闪白。
白鹤每轮 1.6–6.5 秒飞过；扇子倒影随收拢姿态变化。标准/流畅画质画布为
1920×1080，目标分别为 30/60 fps；轻量为 1280×720、20 fps，实际帧率取决于设备。
隐藏时暂停并保留进度；关闭、切换样式后重新启用重播入场；pagehide 销毁帧循环。
开启「减弱动态效果」时显示完整静止构图。素材失败显示刷新提示，不不断重试或启动空帧循环。
该样式不使用人物图或轨道动效；保留文案，花瓣/蝴蝶开关沿用 `openingShowNotes`/`openingShowEq`。
选择此样式时仅将尚未编辑的经典默认标题/副标题替换为主题文案；已自定义的文字保持不变。
默认标题使用独立书法素材，自定义文字用本机楷体；长文案按预留区域缩放，清空后保持为空。

开播页使用本页访问凭证从只读接口 `GET /api/opening/config` 读取已保存设置，独立浏览器源在每次读取结束
1 秒后再次读取，关闭画面时也继续同步以支持重新开启。请求不重叠，5 秒超时，失败保留最后有效配置，
pagehide 取消请求与定时器。页面不新增 WebSocket 订阅。管理端预览 URL 可用
查询参数临时覆盖设置。`trackMotion` 仅接受 `heart`、`barber`、`progress`，查询参数优先于
保存值，非法值回退 `heart`。三种模式复用同一条 SVG waveform：心形的位移和显隐使用同一条
SVG 时间轴，启用画面时统一归零并从首轮立即移动；
灯带用金色短划线连续偏移，流光用单段粉色 dash 沿整条路径循环；任何时刻只显示一种前景
动效，不创建任意 CSS/SVG 输入面。页面隐藏、低画质或 `prefers-reduced-motion` 时暂停或停用
连续轨道动画，隐藏后恢复仍检查低画质和减弱动态效果，固定 `/opening` 地址本身不携带配置。人物图和音乐默认均为空；管理端可上传
PNG/JPEG/WebP 和受支持的音频，叠加层只接受受限的 `/opening-character/`、`/opening-media/`
当前文件 URL。未上传或清除后隐藏人物图并移除 src，不加载或播放空音频地址。

管理端预览通过「预览」打开并选中 `opening` 图层；固定浏览器源地址仍规范化为 `127.0.0.1`。
画布子 iframe 沿用 `sandbox allow-scripts` 与 component-preview 消息，只接受直接父窗口的受限显示数据，
不自行读取 API 或连接 WebSocket。画布连接激活且有可见开播图层时，客户端读取配置，随后在开播设置变化或管理端 WebSocket 重连时重新读取。
每次成功读取后，客户端在 30 秒后再次核对。读取失败时发送空数据，编辑器回退为默认动画预览，客户端在 1 秒后重试。关闭连接取消请求和定时器。正式场景由 `scene-extra-display.js` 读取并投影同一配置。
画布保存图层位置、尺寸及可选的 `style` 外观：`original`（旧空配置的兼容默认）跟随客户端，
`classic` / `pixel-cassette` 分别固定为经典舞台 / 像素卡带，`moonlit-fan` 固定为月渡花汀。
「添加组件」分别展示经典舞台和像素卡带，添加时固定为所选样式；两款各自的设置由开播设置管理。月渡花汀等资源样式按各自样式 ID 共享外观参数，画布只显示它支持的字段；修改经典舞台的文案不会影响配套样式。导入、保存与回退规则见[开播配置约定](../backend/api.md#21-开播动画域opening)。画布始终显示动画预览，未启用时静音；正式输出仍遵循总开关。预览不回写总开关，图层样式不回写客户端设置。
文本、音量、轨道和画质变化就地应用；只有更换音乐、关闭或重新开启画面才重新加载相应音频。
相同配置不重建节点或重置轨道，粒子节点仅随画质变化重建，不再运行未使用的粒子变量定时器。
素材上传/清除同样增量更新预览，关闭总开关隐藏正式画面并清空音频，画布保留静音动画预览；设置保存合并并串行执行，重复值不再写入。

经典舞台使用完整人物图，像素卡带使用独立大头贴；两者初始图片均为空，不互相借用，也不清除已有上传。经典舞台没有人物图时使用居中文案构图；人物存在时保持左文右图。主标题最低 `3.4cqw`，允许长标题换为两行，
无人物时最低 `4cqw`；页脚为 `1.25cqw`。文字与无人物构图由 `opening-layout.css` 维护。
经典舞台和像素卡带默认使用高画质，保留已保存的有效画质选择。漂浮音符和氛围律动固定开启，客户端与画布不再提供独立开关，旧设置及 URL 中的关闭值不再关闭这两项效果；低画质及开启「减弱动态效果」时仍按渲染器规则降级。月渡花汀的花瓣、蝴蝶参数不受影响。
「氛围律动」为固定节奏装饰，不表示实时音频频谱；旧保存键 `openingShowEq` 继续兼容接收。

### 1.6 本日礼物 `/gift-feed`

设置面板首次打开时仅读取显示设置。四色样式预览使用内置礼盒图，修改外形、纹理和扫光时直接更新原有卡片。

设置页的两列金额与循环参数下方为「卡片外观」，「条带外形」与「条带内部」可独立组合。外形提供经典斜切、双色燕尾、折叠飘带、圆角胶囊；燕尾保留经典斜切主体，仅在尾部下方 1/3 接出浅色反向小三角；飘带在主条带右端露出向下错位的浅色短尾，并以深色折面连接前后两层；胶囊以白色细边包住完整圆角条，背景随数量撑开的实际条宽延展。内部提供十种样式：原有纯色、丝缎流光、星屑幻彩、几何拼片、菱格织纹、糖纸波点，以及水波涟漪、蕾丝花边、花瓣浮纹、碎箔微光。非纯色材质带细微边缘光影，纹样在文字区域降低对比；丝缎为柔和连续曲面，星屑以疏密变化形成细小星光，几何保留柔和晶面，菱格为连续双线压纹，波点提高珠光点的辨识度；水波、蕾丝、花瓣与碎箔分别使用细弧波纹、花边纹样、轻盈花瓣和不规则箔片。纹理铺满条带并沿外形裁切，避免胶囊内出现矩形边缘；重复图案按固定密度平铺，数量较长时继续延展而不横向拉大图案。

默认外观与旧版一致；选项及默认值由 `shared/gift-banner-styles.js` 统一提供，字段约定见[API 设置端点](../backend/api.md)。画布共享相同参数，设置页沿用保存、取消与填入默认值流程。纹理使用静态内嵌 SVG 背景，无新增素材请求或纹理动画，所有样式沿用现有价格配色与卡片尺寸。设置刷新将外形、纹理及扫光纳入横幅缓存签名，就地更新静态或滚动卡片；导出继续读取同一份已保存配置与共享 CSS。

「白色扫光」独立于外形和纹理，开启后在设置预览、画布和滚动画面中以 115 度白色光带从左向右扫过，约 1.8 秒完成一次，含停顿每 5 秒一轮，文字和图片保持在光带上方。所有金额均可使用；播放容器隐藏或系统开启「减弱动态效果」时不播放。导出预览及 PNG 渲染入口显式关闭扫光，静态输出不截取白光，也不改变已保存的开关。

画布的示例数据携带 `preview: true`；金额门槛过滤全部示例时，在组件内说明原因及调整方法。正式来源不携带该标记，空集合保持透明，不输出预览提示。

滚动展示使用 `shared/gift-card-model.js` 对北京时间今天的记录按送礼人 UID、相同礼物 ID 和礼物名合并，累加数量及各条历史单价乘数量的整数分金额，颜色按合计金额计算。身份来自 `/api/gifts/card-profiles`，对同人今日全部卡片使用最新已知昵称、头像及大航海等级。null 不覆盖已知等级，0 明确移除头像框，同等级续费保留未变化的卡片节点。未知 UID 不按昵称合并，滚动展示的旧日期和原始流水保持独立。导出复用该模型的今日展示资料，默认逐笔出卡，开启合并时只累计所选记录。滚动阈值按合并后的卡片数计算，稳定分组键保留滚动锚点。导出开关见[礼物导出分组](../backend/bilibili/gift.md)。

礼物助手的滚动礼物面板生成当前本地端口的 `127.0.0.1/gift-feed` 地址，`?preview=1` 只增加预览底色和状态。页面独立于管理面板生命周期，按北京时间遍历今天全部分页，包含未参与冲刺的有效付费历史。「最小礼物金额（元）」支持整数或一位小数，默认 0 不限制；正数在完整分页、合并卡片后按 `cardTotalCents` 严格大于门槛过滤，未知 UID 独立记录按历史单价乘数量计价，比较使用整数分。该过滤只作用于滚动集合，不改变历史记录、分色金额或图片导出；配置约定见[API 设置端点](../backend/api.md)。`gift-feed-state.js` 用 `eventId` 去重并保留轮播锚点；默认 3 行、速率 12（每行 3.9 秒），速率 1–50 线性对应每行 `5000 - (scrollSpeed - 1) * 4900 / 49` 毫秒。过滤后的条目超过显示行数时连续匀速向上滚动，最后一条紧接第一条；不足或刚好填满时静态显示，不复制填满。动画按帧时间累计位移，换行保留余量，无间隔等待，DOM 只保留可见行及最多一条动画缓冲，并复用未变化的节点。页面隐藏时释放动画帧，恢复后接着当前位置移动。暂停和低功耗选项已移除。

独立来源合并 WebSocket 通知后重读。可见时按 30 秒或更早的北京时间午夜对账。隐藏时取消定时器及在途请求并保留失效标记，恢复可见后先核对日期，再读取设置、目录与当天记录。目录携带内容摘要，未变化时复用已有数组，不下载和双重序列化完整目录；同版本图片修复仍会更新。刷新保留滚动进度，新集合在换行边界应用，静态时立即更新。礼物通知只重读礼物与身份资料，设置、素材分别在对应失效通知时读取，首次加载、重连及定时对账补读两者；请求期间收到的失效通知合并到下一批。横幅按稳定卡片键插入或复用，`updateGiftBanner` 就地更新数量、颜色、名字、头像与舰队框，只在文字改变时重新测量字体，成功图片不随连击重建。滚动换行先移除离开的行，再插入新的缓冲行，避免搬动仍可见的节点；重复通知且展示资料未变时没有 DOM 写入，失败头像仍可单独重试。午夜、来源切换或投影代次变化清空旧集合，迟到请求不得恢复旧来源。保存配置即更新静态行颜色。`shared/gift-banner.js` 和 `css/shared/gift-banner.css` 统一渲染管理预览、PNG 和直播画面的横幅：基础尺寸 428×72，行间隔 8px，包含头像占位、可空大航海边框、昵称、黄色礼物名、本地 WebP 和数量。颜色条的圆弧左端与头像同心，56×56 头像置于 (8, 8)，与颜色条圆弧留 4 像素间隙；昵称区、颜色条和 WebP 位置固定，数量保持字号并只向右扩展画布。PNG 按实际画布的 2 倍尺寸导出，基础宽度 856 像素，每页最多 50 张卡片，排满一页并使用默认间距时高 7984 像素，最大间距时高 8768 像素，合并时取本页最宽横幅；浏览器源建议宽度 900，以容纳多位数量。金额/时间/备注不进入横幅。

礼物横幅的图片解析由 `shared/gift-banner.js` 负责。滚动展示、管理预览及 PNG 输出在接收目录快照时建立 variant ID 与「礼物 ID＋规范化名称」索引，同一快照的多张横幅共用；目录替换后重建。规范化继续使用 NFKC、空白合并及小写，重复匹配仍显示占位图，variant 优先且不回退到含糊名称，大航海图标与已指定 `artworkPath` 保持优先级。显式索引保存快照值；仍直接传入可变数组的一次性调用继续即时匹配，不隐式缓存旧数组。

滚动源与画布首次完整读完当天分页后，以同一个内容版本请求有界增量；少量新礼物或更正只传变化行。客户端按 `sortTime` 升序、同时间 `sortId` 降序合并，替换或移除变化身份，保留未变化对象和完整轮播集合。日期、来源、投影代次仍独立校验；跨页内容变动不确认版本。服务器不能证明增量完整时自动返回普通分页，旧服务没有排序标识时继续条件确认和全量读取，详见[礼物查询约定](../backend/bilibili/gift.md#5-礼物冲刺与查询)。

## 2. 队列叠加层(/queue)

[overlays/queue.js](../../../public/js/overlays/queue.js) 渲染 `state.queue`（current + waiting）与 `state.superChats`：

HTTP 初始/重连请求带本页读取代次，较新的完整 WS 状态使旧请求失效。HTTP 与 WS 共用内容指纹；延迟补数和重连取得相同内容时保留节点及滚动进度。

- **点歌结果提示**：六套内置风格和复用队列渲染器的资源风格共用面板顶部提示：
  - **配色与文案**：成功使用浅绿底、深绿结果字，失败使用浅红底、深红结果字；点歌人默认深蓝色、歌名默认深紫色并加粗（可在「点歌规则 → 点歌结果提示」自定义，为本机设置，所有内置及资源点歌风格与场景投影共用）；连接词及失败原因沿用结果色，提示内显式重置填色、描边和阴影以避免继承列表白字效果。成功显示「点歌人 点歌 歌名 成功」；失败在歌名后附用户可读原因（区分个人冷却、歌曲冷却、队列上限、资格、屏蔽或无匹配等，个人冷却带剩余秒数、歌曲冷却带剩余时长或北京时间恢复时间），右侧固定显示「失败」，所有动态内容按纯文本写入。
  - **排版与超宽横移**：字号为当前列表正文的 85%、行高 1.2、上下内边距 0.2em；经典版与身份版最小高度绑定各自歌曲行高，插画风格随字号撑高；短提示按内容宽度收紧，正文窗至少保留 4em 或整行可用宽度，极大字号无法同排时结果另起一行靠右。正文放得下时保持静止；超宽时保留原字号，开头停 0.6 秒后以约 2.5em/秒（极窄窗口限 0.65 可视窗宽/秒）单次横移，末尾至少停 0.9 秒。每条完整阅读期至少 3.6 秒，超长内容按实际滚动距离自动延长（四舍五入至 0.1 秒），读完后淡出。
  - **动画与减弱动态降级**：提示以 240ms 轻微下滑淡入、180ms 淡出退出，不模糊文字；系统开启「减弱动态效果」（`prefers-reduced-motion`）时仅保留短淡入淡出并取消垂直位移，必要横移降为约 1em/秒。
- **提示顺序与重排**：[queue-request-notice.js](../../../public/js/overlays/queue-request-notice.js) 读取[临时结果窗口](../backend/music/services.md#81-统一队列语义)，独立来源与场景使用同一投影；首次只建立基线，之后的新 ID 按顺序排队，不覆盖正在阅读的结果，重复快照不续时、不重复播放，旧快照兼容单条字段。接收后等待的结果有独立阅读期，不按接收期限提前取消。宽度、字号或字体实际变化时重新测量当前文字并给予完整阅读期；重复主题或相同尺寸不重启动画。提示浮在面板顶部，不改变歌曲行、队列尺寸或滚动位置；没有独立请求或订阅。卸载取消提示动画/计时并释放尺寸与字体监听。
- **六种风格**：`classic`（默认，经典卡片列表）、`identity`（身份版，观众名突出，含 SC 置顶区）、`storybook`（奶油蓝插画画框）、`neon-vinyl`（甜粉麦克风舞台）、`cherry-ribbon`（紫金星月梦境）与 `golden-lily`（奶油金唱片铃兰）；由设置 `overlayQueueStyle` 决定，遗留 `festival` 归一为 `identity`，未知值回退 `classic`。样式由 `overlays/base.css` 导入的 `.queue-*` 主题类承载。
- **风格 3**：框体与词条素材位于 `public/img/overlays/song-board-style-3/`；原始框体保留 alpha，`.queue-storybook::before` 在框内开口后叠加不透明白层，框外仍透明。词条黄色端点恒显示队列序号，浅蓝固定宽度区域复用身份版的歌名、点歌人、大航海/灯牌名与灯牌等级格式；没有大航海或灯牌时省略对应字段。内容实际宽度溢出时由 `scheduleIdentityContentScroll` 在该区域内左右往返，不会扩张词条素材。纵向超出画框时复用身份版的循环/往返滚动测量。
- **月渡花汀点歌板**：资源套装预设 `moonlit-queue` 使用 `overlayQueueStyle: identity`，复用风格 2 的内容、置顶、SC 与滚动；大航海身份使用应用内保存的 B 站舰长、提督、总督图片，保留粉丝牌名称与等级。`queue-moonlit.css` 根据已导入的资源选择边框，当前套装使用 v4 暖月山水。旧版边框的选择顺序见[套装指南](../../guides/component-style-packages.md#月渡花汀与多素材样式)。面板和列表横条完全透明；歌名使用深紫粗体，点歌人略小，序号为赭金色；文字配浅金描边与轻微阴影，徽章采用暖金细边及浅绿、藕紫、胭脂浅底，在山水背景上保持可读。预设显式携带内容字号（30px）、序号开关与阈值、滚动参数；画布中可编辑置顶、字号和序号显示。本样式不显示标题及底部规则，对应参数也不展示，旧配置中的标题和规则不影响输出；内置风格 2 保持原有行为。仅在导入并选用该资源样式时生效；切回内置风格会移除资源样式。当前套装清单声明 391×506，内部按 430px 设计宽度等比适配。
- **风格 4 / 5**：各自的框体与词条素材位于 `public/img/overlays/song-board-style-4/` 和 `song-board-style-5/`；框体和词条素材自带粉色或紫金渐变底色。两种风格隐藏通用顶部标题和点歌顺序数字，省略四组字段的说明标签并将短内容居中。每条记录输出歌名、点歌人，并在有数据时输出大航海等级、灯牌名与等级；没有大航海或灯牌时省略对应字段。大航海身份按总督红、提督紫、舰长蓝区分，同一条记录后接的灯牌名与等级徽章沿用该身份色；无大航海时才使用灯牌自身等级色。整组内容实际宽度溢出时复用 `scheduleIdentityContentScroll` 左右往返，纵向超出画框时复用插画风格滚动测量。风格 4 的列表下边界与前景底边内沿对齐，保证滚动终点的最后一条完整露出；风格 5 的列表窗口顶部与首条词条上边缘对齐、底部收进 30px。`prefers-reduced-motion` 下停用横纵动画。
- **风格 6**：奶油金唱片铃兰框体与横向词条素材位于 `public/img/overlays/song-board-style-6/`；词条以内容窗宽度的 72% 居中，完整收进画框的左右前景边框之间，列表上边界位于画框高度的 16.5% 以完整露出首条顶部装饰，相邻卡片以 `4px` 间距清晰分开，左侧花形圆圈显示从 1 开始的队列序号，右侧固定信息窗省略说明标签并输出歌名、点歌人，在有数据时输出大航海等级、灯牌名与等级；没有大航海或灯牌时省略对应字段。大航海与后接灯牌徽章使用和风格 4/5 相同的总督红、提督紫、舰长蓝身份色，无大航海时保留灯牌等级色。信息窗内容实际宽度溢出时复用 `scheduleIdentityContentScroll` 左右往返，纵向超出画框时复用插画风格滚动测量，列表下边界停在第 4 个序号附近；`prefers-reduced-motion` 下停用横纵动画。
- **风格 4–6 的画框层级**：完整框图作为底层保留中间色块，卡片与文字位于中层，同一框图去掉中心填充后以 `border-image` 作为顶层装饰。卡片滚动时会从丝带、花朵、唱片等边框装饰下方经过，但始终显示在框内中间色块上方。
- **六种风格的浏览器源缩放**：六款点歌板都在固定设计坐标中完成排版（`classic` 宽 405px、`identity` 宽 430px、插画风格宽 560px），内部背景、框体、词条、文字、徽章、间距和裁切窗口不随浏览器源单独重排。`queue-viewport.js` 在面板完成渲染后按浏览器源可用宽度与高度分别计算比例并取较小值；风格 1、3–6 可随浏览器源整体放大或缩小，风格 2 将最大倍率限制为 `1`，在较大的浏览器源画布中保持默认 430px 宽度，仅在画布不足时等比缩小。源比例与点歌板不一致时在未占满的一轴保留透明空白，不拉伸图片或文字。风格 3 的列表窗口仍在设计画布内整体上移 10px，为最底部可见词条保留安全距离。
- **风格 3–6 的词条缩放**：词条盒、位图、文字窗口和序号共用同一坐标系，不通过裁剪去掉上下装饰。风格 3 在 CSS 背景坐标中排除原 PNG 顶部和右侧的大块透明留白，不改写原始素材；风格 4/5 的完整 PNG 占内容窗宽度的 94%，风格 4 使用 `2172:517.5` 显示比例（高度为此前的 115%），风格 5 的显示高度为素材原比例的 80%；风格 6 使用完整 PNG 比例占 72%，三款列表起点都避开画框顶部前景装饰。
- **滚动**：`classic` 走 CSS 动画滚动（`classic-scroll` 循环 + `scrolling-bounce` 有节奏往返模式，loop clone 双份列表实现无缝循环），读取 `queueScrollMode`/`queueScrollSpeed`；`identity` 读取 `identityQueueScrollMode`/`identityQueueScrollSpeed`；风格 3–6 分别读取 `storybookQueue*`、`neonVinylQueue*`、`cherryRibbonQueue*`、`goldenLilyQueue*` 的滚动模式和速度。六种风格都在固定设计高度的列表窗内测量真实内容溢出，浏览器源 resize 后 `relayoutQueue` 重新配置并再次同步整板比例；重渲染时 `captureScrollAnimation/restoreScrollAnimation` 在 rAF 帧内恢复 CSS 动画进度，不跳帧不闪动（[queue.js:174-202](../../../public/js/overlays/queue.js#L174-L202)）。
- **低功耗**：`overlayLowPowerMode` 或 `?quality=low` 时停用毛玻璃/辉光等重特效（`.overlay-panel.low-power` 面板级降级，classic/identity 共用，[foundation-and-classic.css](../../../public/css/overlays/base/foundation-and-classic.css)）。
- **快照指纹与补读**：指纹包含当前歌/等待队列的请求 ID、歌名、昵称、置顶，以及当前样式实际使用的舰队等级/粉丝牌等级/名称，再加上 SC、完整 `resourceStyle` 与全部主题和滚动键；同预设切换素材包时仍更新资源对应的横竖布局，相同配置保留现有节点与滚动进度。`queue:add`/`bilibili:danmaku`/`bilibili:superchat` 等快照先显示队列，再延迟 80ms 补读请求者元数据，补读失败时保留已显示的队列；`live:status` 只更新直播状态不重渲染。
- **主题**：经典/身份版色板、字体、字号、置顶 3 条、规则 6 条均来自快照 `settings`（管理页「点歌板/展示板」配置）；`public/js/shared/queue-style-settings.js` 在渲染和滚动测量前把当前 `overlayQueueStyle` 的独立设置映射至现有渲染字段。风格 2 保留 `identityQueueFontSize` 并新增独立滚动模式；风格 3–6 各自持久化内容字号、字体、字重、自定义文字颜色、纵向滚动模式和速度，旧共享 `illustratedQueue*`/`queueScrollMode` 值仅作为旧快照兼容回退。

风格 1、2 的设置页、独立预览和画布参数使用「字体设置」选择器，分别读写 `overlayFontFamily` 与 `identityQueueFontFamily`，默认均为 `Microsoft YaHei`；选择器提供软件字体库和系统字体库，切换风格回填各自选择，编辑时只更新当前风格的字体键。风格 2 渲染时将独立值映射至既有 `--overlay-font-family`；旧快照缺键时兼容原 `overlayFontFamily`。首次升级与旧场景读入保留旧字体，后续独立保存；插画风格保留各自字体，月渡花汀资源样式保留包内专用字体。

## 3. 歌单叠加层(/songlist)

[overlays/songs.js](../../../public/js/overlays/songs.js)（ES Module）：

- **数据**：`GET /api/state` + `GET /api/songs?enabledOnly=true[&category=]`（支持 URL `?category=` 单曲风过滤）。
- **排序**：`songBoardSortMode`（默认拼音/字母，`length` 按时长分组），`buildSongRecords` 生成记录，分组模式下加分组头。
- **字号**：普通 `/songlist` 关闭主题同步时，歌曲按 `songBoardSongFontSize × songBoardFontSize / 16` 显示，保留整体字号倍率；同步主题时继续使用 16px 基准乘该倍率。画布组件沿用 `scene-components.css` 的绝对歌名字号覆盖。
- **指纹**：`orderKey(songsRevision:sortMode)`、`layoutKey(字体族/字号组)`、`motionKey(滚动速度)`；歌曲变更（`songs:*`、`cloud:songs`、`database:clear` 或 `database:clear-all`）220ms 防抖重载。过期请求不能回填旧列表或设置；重连内容相同时保留节点和当前滚动锚点，`live:status` 不触发重渲染。
- 虚拟滚动与 §1.3 一致；字体 `loadingdone` 与 ResizeObserver 触发 `relayout`（等待 `document.fonts.ready`）。

## 4. 加班机叠加层(/overtime)

[overlays/overtime.js](../../../public/js/overlays/overtime.js) + [css/overlays/overtime.css](../../../public/css/overlays/overtime.css)。领域状态（enable/status/remaining/rules/background/revision）见 [backend/overtime.md](../backend/overtime.md)；渲染所需规则与背景由管理页加班机控制台配置（[app.md](app.md) §6）。

### 4.1 DOM 结构(两层)

- 背景层 `#overtimeBackground`（+ 半透明遮罩 `.overtime-background-shade`）：按 `background.path`/`background.fit`（cover/contain/fill）设置图片，内置背景见 ADR [0005](../../architecture/adr/0005-built-in-overtime-backgrounds.md)。
- 前景层 `.overtime-foreground`：时钟面板（状态行 `LIVE` 徽标 + 状态文字 + `#overtimeClock`）+ 送礼加班表（`#overtimeGiftGuide`，按规则生成门票卡片）+ 结算动画层 `#overtimeAdjustmentStage`。

未配置自身背景时，时钟面板、规则区及门票卡片关闭 `backdrop-filter`，外阴影收窄至透明留白范围内，避免透明 iframe 中的矩形滤镜区域和边缘硬切；配置自身背景后的面板效果继续保留。画布的深色、浅色或透明网格检查底不属于直播来源背景。

### 4.2 响应式(容器查询)

`.overtime-machine` 设 `container-type: size`，**根字号 `font-size: 2cqmin`**，全部尺寸用 em/cq 单位等比缩放：

| 断点                                     | 行为                                                                                                                                                                                    | 出处                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `@container (max-width: 719px)`          | 门票网格切窄列（≤2 列）                                                                                                                                                                 | [overtime.css:261-269](../../../public/css/overlays/overtime.css#L261-L269) |
| `@container (max-width: 419px)`          | 时钟面板收窄、标题小字限宽                                                                                                                                                              | [overtime.css:270-273](../../../public/css/overlays/overtime.css#L270-L273) |
| `@container (max-aspect-ratio: 1.45)`    | 竖屏（高 > 宽/1.45）收紧纵向间距                                                                                                                                                        | [overtime.css:274-276](../../../public/css/overlays/overtime.css#L274-L276) |
| `@container (max-height: 239px)`         | 超矮场景隐藏送礼表头、压缩间距                                                                                                                                                          | [overtime.css:277-281](../../../public/css/overlays/overtime.css#L277-L281) |
| `@supports not (font-size: 1cqmin)`      | 无 cq 支持时回退 `2vmin`                                                                                                                                                                | [overtime.css:297-299](../../../public/css/overlays/overtime.css#L297-L299) |
| `height: var(--component-height, 100vh)` | `100dvh` 覆盖必须放在 `@supports (height: 100dvh)` 内。旧内核对 `var()` 内不支持的单位会在计算值阶段判为无效，连续写 `vh`、`dvh` 不能兜底；配合 size containment 会使高度变成 0。已在 Chromium 106 复现并验证修复。 | [overtime.css](../../../public/css/overlays/overtime.css) |

### 4.3 时钟与数字呈现

- **时钟字号**：**8.5em × 2cqmin = 17cqmin** 等比缩放（`font: 700 8.5em/0.9 Bahnschrift SemiCondensed,…` + `tabular-nums`，[overtime.css:94-100](../../../public/css/overlays/overtime.css#L94-L100)）；管理页预览时钟为 `clamp(42px, 5vw, 70px)`（[console.css](../../../public/css/admin/overtime/console.css)）。
- **时间格式**：由 [overtime-time-format.js](../../../public/js/shared/overtime-time-format.js) 的 `formatClockSeconds` 统一负责：不足一天为 `HH:MM:SS`，满一天为 `N天 HH:MM`，满 365 天为 `N年 N天 N小时`（按 365 天换算一年）。
- **时钟调度**：运行中按当前显示层级的下一秒/分钟/小时边界使用一次性 timeout 更新，值未变化不写 DOM；暂停、结束或页面隐藏时清除时钟 timer，恢复可见或收到新 revision 时重新锚定。
- **数量封顶**：结算卡片数量 `> 99999` 显示 `99999+`（[overtime.js:275-278](../../../public/js/overlays/overtime.js#L275-L278)）。
- **结算动画**：每次 `overtime:update` 携带 `adjustment` 时入队（队列上限 5，满则合并为「连续礼物 · 净变化」聚合卡片）依序播放盖章动画 + 门票高亮 + 时钟变色闪动（[overtime.js:167-230](../../../public/js/overlays/overtime.js#L167-L230)）。
- **动画降级**：`prefers-reduced-motion: reduce` 媒体查询与 `low-motion` 类都把动画压缩到 180ms；低功耗 `?quality=low` 时动画时长同步缩短。
- **设计令牌**：夜色 `#181823`、粉 `#ff6f91`、青 `#21b6a8`、珊瑚 `#f0677d`、金 `#f5b72f`、文字 `#fff7fb`（[overtime.css:1-8](../../../public/css/overlays/overtime.css#L1-L8)）；门票按效果取色：加时=青、减时=珊瑚、盲盒=金、文字展板=粉、不变=灰。文字展板规则的自定义文字通过 `textContent` 写入效果区域，收到对应礼物不改变数字倒计时。

## 5. 盲盒叠加层(/blindbox)

客户端「组件 → 礼物姬 → 盲盒盈亏榜」和画布共用卡片样式（`blindboxStyle`）、标题、榜单人数、盈利筛选、心动盲盒筛选、城堡展示、紧凑布局、自动翻页及字体配色设置。样式目录由 `shared/blindbox-styles.js` 定义，提供 5 套内置风格（`classic` 经典暗夜、`porcelain` 霜瓷双栏、`layers` 无界切片、`prism` 琉璃雅集、`podium` 浅金席卡），客户端与画布右侧参数栏均提供可视化按钮切换。`classic` 继续沿用点歌板通用字体与配色；其余 4 套面向亮色系直播间背景专门调校对比度、投影与紧凑结构，并沿用点歌板字体与字号比例。画布只显示一个盈利筛选，旧 `hideLoss` 字段仍作兼容别名。新复制的地址不带这些参数，保存后跟随 settings 更新；已有 URL 显式提供的同名参数继续优先。筛选变更会重新读取统计并使场景盲盒缓存失效。

面板最大高度以 `100vh` 减去上下边距为基线，仅在 `@supports (height: 100dvh)` 内改用 `dvh`，避免旧内核让带 `var()` 的 `calc()` 计算失效而丢失视口限制；超出高度的榜单仍可滚动。

[overlays/blindbox.js](../../../public/js/overlays/blindbox.js)：

- **数据**：汇总 + 排行榜来自 `GET /api/gifts/blind-box-stats`，携带 `top`/`hideLoss`（心动盒额外带 `boxName`）；服务端按先过滤再截取的规则裁剪 `perUser`，`top=0` 不返回用户榜。快照 reason 以 `bilibili:gift`/`gift:sprint:reset`/`connect` 触发重取统计；最多一个请求在途，其间多次变化合并为后续一次刷新。所有带 state 的快照立即应用主题及标题；统计与设置独立判断新旧，相同统计内容保留榜单节点和翻页进度，汇总模式不序列化用户榜。同源留存历史激活触发 `gift:source` 时，独立盲盒榜重读统计，保留现有榜单直到新结果返回。显式清空礼物或全部数据，或 `giftSourceEpoch` 改变时，立即清榜并重读，丢弃迟到的旧统计。合并通知也按这些条件处理。独立源与场景都只读取公开汇总和排行。礼物首页可见且「今日盲盒盈亏」展开时，按本机午夜换日，作废前一天的在途响应并读取新一天的汇总。
- **URL 参数**（短别名 + 长键）：`style/s`（卡片样式：`classic`/`porcelain`/`layers`/`prism`/`podium`，优先于 `blindboxStyle`）、`top/t`（榜单位数，0=仅汇总，-1=全部）、`winners/w`（只看盈利）、`heartBox/hb`、`title/tt`（自定义标题，优先于设置 `blindboxOverlayTitle`）、`compact/c`、`hideLoss/hl`、`refresh/r`（轮询秒数）、`noScroll/ns`；这些显式参数兼容旧链接。管理页「组件 → 礼物姬 → 盲盒盈亏榜」保存公共设置并复制不带参数的 `/blindbox` 地址（见 [app.md](app.md) §6）。
- **紧凑布局与自动翻页**：紧凑布局默认关闭，自动翻页默认开启，由共享设置 `blindboxCompact` / `blindboxAutoPages` 控制，旧 URL 的显式参数优先。盲盒默认隐藏滚动条；`noScroll=1` / `ns=1` 保持隐藏，显式 `0` 恢复细滚动条和手动浏览。隐藏模式超高内容复用 `auto-pages.js` 每 8 秒翻页，保留 32px 阅读重叠并在尾页停留后回到顶部。该模块也服务画猜积分、正确答案、窄布局和游戏结果卡；不使用连续动画，低功耗或开启「减弱动态效果」时仍可阅读全部已选内容。滚轮、指针、触摸或键盘操作暂停 16 秒，焦点留在区域内时持续暂停；页面隐藏不翻页，卸载时清理。
- **尺寸与字号**。`/blindbox` 与客户端预览共用 `public/css/shared/blindbox-card.css`。独立浏览器源中，经典暗夜初始宽 720px，霜瓷双栏初始宽 800px，无界切片、琉璃雅集和浅金席卡的卡片宽度上限为 600px。窄窗口会收窄卡片，客户端预览与画布按各自比例缩放。4 套亮色样式在标准字号下，昵称为 20–24px，盒数为 17.5–19px。长昵称在可用宽度内单行省略。画布中新建组件默认 720×640px，内容按实际高度收拢，超出 `maxHeight` 时翻页。组件尺寸由 `shared/scene-extra-components.js` 定义。
- **呈现**。`classic`（经典暗夜）使用 30–38px 基准字号、缎带奖牌与点歌板背景色。仅汇总时净盈亏靠右，与左侧统计末行基线对齐，空间不足时自动换行。`porcelain`（霜瓷双栏）在宽屏采用左总账右榜单。`layers`（无界切片）用独立浅色浮片搭配翠绿或绯红盈亏色块。`prism`（琉璃雅集）采用灰蓝磨砂单板与圆环序标。`podium`（浅金席卡）在 1–3 人时横排席位，4 人及以上切换双列网格，窄容器下折为单列。
- 没有开盒记录时省略汇总，只显示「等待开盒」。已有开盒但盈利筛选结果为空时显示「暂无盈利观众」。仅汇总模式隐藏标题和榜单，保留顶栏统计及零值。`compact/winners-only/summary-only/no-scroll` 类与 `data-blindbox-style` / `data-profit-tone` / `data-user-count` / `data-has-heart` 属性切换形态。
- **心动盲盒**：勾选后，可显示「今天 N 倍堡」「还有 N 个堡」「已开 X 个盲盒」（经典样式保持 30–36px，4 套紧凑样式按各自版式融为柔粉/玫瑰金铭牌条）。倍数留空隐藏，剩余数与开盒数各有独立开关，剩余数为手动值（0 也显示）；关闭心动筛选后整栏隐藏。自动进度沿用[后端统计规则](../backend/bilibili/gift.md#4-盲盒服务器结果与客户端展示)，只计算今日心动盲盒开出浪漫城堡后的数量。设置更新即刻应用，无需重建相同榜单；画布使用示例数据，正式浏览器源使用实际统计。字段默认值和范围见[存储设置](../backend/storage.md)。
- **画布缩放**：组件预览与场景输出使用 720px 设计宽度，按组件实际宽度整体等比缩放文字、序标和间距，并按卡片实际内容高度收拢（受 `maxHeight` 限制用于翻页）；独立 `/blindbox` 浏览器源保留自适应容器重排。
- **数据刷新**：WS reason `bilibili:gift`/`gift:sprint:reset`/`connect` 重取统计，跨本机午夜时更新当天榜单。`refresh/r` 为正数时另启周期刷新，最短 10 秒，省略或传 `0` 时由事件和跨日刷新驱动。

## 6. 直播歌词页(/lyrics)

歌词快照、`lyric-state` 增量和场景歌词使用同一 `playbackRate` 推算当前时间，缺省速率为 1。

管理入口「组件 → 音乐展示 → 直播歌词」分为基础与高级两个编辑界面，页签同步切换本地实时预览和右侧复制地址。`/lyrics?layer=basic` / `/lyrics?layer=advanced` 分别输出基础多行或高级构图，可在直播软件中独立摆放；显式选层不依赖历史显示开关，仍遵守对应的暂停隐藏设置。管理页不再编辑 `desktopLyricEnabled` / `advancedLyricEnabled`；旧合并地址 `/lyrics` 与 `lyricLayer=both` 保留这两个键的兼容行为，缺省只显示基础层，两层同时启用时基础占上部 55%、高级占下部 45%。场景仍使用 `lyrics` 类型，实例字段 `lyricLayer=both|basic|advanced` 只影响本实例，显式选层直接启用对应层，不被公共外观覆盖；组件整体位置和尺寸仍由场景管理。

高级视觉由 `lyrics/advanced-lyric-renderer.js`、`advanced-lyric-layouts.js`、`advanced-lyric-motion.js` 与 `css/lyrics/advanced-lyric.css` 负责。排版、材质、描边/投影/发光等叠加字效、入场/停留/退场/逐字动作及装饰相互组合；始终只显示当前句，可附当前句翻译，不生成上下句。`advancedLyricHideUnsung` 默认开启：字形及描边、投影、回声按时间显现，底板随该组首字出现；关闭后当前整句可见。退出仅使用演唱结束后的剩余时间，不提前淡出尾字。构图在换句、有关设置、字体载入或容器尺寸变化时测量并适配，显现过程中不重新排版或测量。有效源时间随字形映射，多字 token 在其区间内按字形均分；自由构图和翻译缺少独立时间时仍按句内估算，完整编排使用下述整组降级。组合字形保持完整，连写文字不拆散；自由构图中的连写文字与超长句合并单元用连续蒙版显现。排版与入场轮换按句索引确定，返回同一句时保持相同组合；开启「减弱动态效果」时保留时间显现并取消空间动作。前端配置与视觉目录来源为 `shared/advanced-lyric-appearance.js` / `advanced-lyric-catalog.js`，保存边界见[歌词视觉设置](../backend/storage.md#歌词视觉设置)。

完整编排包含 `focus-lens`（聚焦镜头）、`page-turn`（纵向翻页）、`phrase-flow`（逐段让位）、`corner-relay`（两翼接力）、`type-impact`（重音落版）、`depth-stack`（景深层叠）、`flow-drift`（流向推移）、`color-block`（色块切入）、`vertical-relay`（竖排诗卷），以及 `paper-fold`（纸片展开）、`ink-trace`（轮廓成字）、`echo-trail`（残影收束）、`block-handoff`（字块接力）、`ribbon-arc`（弧光流转）、`prism-scatter`（星屑聚字）。空间轨道由 [advanced-lyric-choreography.js](../../../public/js/lyrics/advanced-lyric-choreography.js) 负责，字面处理由 [advanced-lyric-treatments.js](../../../public/js/lyrics/advanced-lyric-treatments.js) 交给同一个动效模块调度；没有独立帧循环或外部动画依赖。轮廓成字表现的是字形轮廓与填色，不是汉字笔顺书写。

景深层叠让已唱词组沿斜线后退、缩小并按距离加深 `blur()` 虚化，新词组从放大虚焦状态对焦落位；虚化写在该组同一条空间轨道上，关闭隐藏未唱字或开启「减弱动态效果」时不虚化。流向推移让所有词组共用一条倾斜轴线，新词组从轴线下游进入并把前文推向上游。色块切入为每组加纯色字板（`data-plate="block"`），字板在该组开始时按方向用 `background-size` 铺开，不裁切描边和投影；关闭隐藏未唱字或开启「减弱动态效果」时直接显示。竖排诗卷以竖行逐列写出，前文向右收起并保持竖排填色方向。随句编排的中等句长候选也包含景深层叠与流向推移。

`adaptive`（随句编排）由 [advanced-lyric-variation.js](../../../public/js/lyrics/advanced-lyric-variation.js) 选择实际编排，仍保存为既有 `advancedLyricLayout` 字段的枚举值。规范化正文与曲名决定稳定的样式身份、方向和变体，句索引、绝对开始时间和跳转不会打乱重复歌词。句长影响适合的样式范围；密度与时长调整动作幅度和紧凑程度，快句缩短运动并减少装饰，节奏变化不重新随机选择重复句的样式。手动选择的完整编排也复用这些变化线索；既有按句顺序轮换继续使用句索引，不改为自动选择。

分组在 `advanced-lyric-layouts.js` 中按词边界和源 token 边界做动态规划，比较宽度均衡、标点/时间间隙、阅读停留及避免悬空虚词的启发式代价，同时比较不同组数。完整时间最多五组；普通 LRC 最多四组，英文少词、无逐字时间的日文和连写文本进一步收敛。新增六种编排在紧凑模式最多三组，普通模式最多四组，星屑聚字的完整时间可至五组。短句保持完整，快句合并词组；不将词典分词等同于语义理解。字块/弧线/环绕等自由构图保留原有分组策略。

字面动作有明确预算：残影通常每个正文单元两层，紧凑模式一层；星屑每个单元最多两片、全行最多 48 片，紧凑模式省略。装饰放在已有显现层内部，未唱字的副本也一起隐藏；开启「减弱动态效果」时不创建残影、星屑或字面空间动作，轮廓成字保留填色。它们与词组轨道一起受暂停、跳转、隐藏和销毁控制。

只有有效时间覆盖所有正文单元且起点有序时，完整编排才沿用逐字显现与所选逐字高亮；缺失、不完整或逆序时间统一采用句内估算的词组入口，整组渐显并取消估算的逐字高亮。标点跟随相邻有效时间，不占据虚假的句末位置。明显长于中位时长的正文单元可将所属组设为强调色；这只是源时长线索，不是音频重音、节拍或情绪识别，没有可靠时间时不猜测强调词。

每组使用一条空间/透明度时间轴，当前组保持主位；多数编排将前文缩小并随后续词组进入逐步淡化，强调组保留更高亮度，轮廓成字则保留各诗行的位置与可读亮度。已知演唱后停顿用于提前让位，普通歌词则在阅读停留后让位。`MotionDuration` 控制交接上限，动作时间按组间隔压缩并留出主要阅读时间；`MotionAmount` 控制距离与倾斜，快句及估算时间进一步降低幅度。适配包含整条运动的关键姿态边界，测量仍只在构建/尺寸/字体变化时发生。完整编排不使用自由构图的入场/停留/退场选择，编辑器隐藏对应控件；字效仍可独立选择，逐字动作只在有完整时间时生效。关闭隐藏未唱字或开启「减弱动态效果」时使用最终构图；无尾音后空隙时直接换句，有空隙时才退场。

逐字动作由 `advanced-lyric-motion.js` 根据源时间生成。`sustain`（长音舒展）仅对真实逐字单元轻抬并持有至音长结束；`pop`、`rise`、`tilt`、`glow` 对超过 650ms 的真实单元同样持有，尾音后最多使用 180ms 归位，且不越过当前句边界。`bounce`、`wave` 保持短促动作，估算时间不触发长音持有。`glow`（逐字发光）在亮度之外叠加强调色 `drop-shadow`，浅色文字也能看出光晕。`focus`（逐字对焦）让未唱字保持轻微虚焦和半透明，自身区间开始时在 160–600ms 内对焦。自由构图入场的 `focus`（虚焦对焦）和退场的 `defocus`（散焦离开）以缩放和 `blur()` 完成。「外观 → 显示内容」中的「字内进度」紧邻隐藏未唱字，二者独立：关闭时每个字形单元在自身时间区间开始时完整填色，开启后按横排从左到右、竖排从上到下推进；开启时 `soft-fill`（柔边填色）及 `sustain` 的高亮使用柔边蒙版。该开关不改变逐字动作、显现时间和填色浓度；字段与缺省行为见[歌词视觉设置](../backend/storage.md#歌词视觉设置)。

基础和高级共用 `desktop-lyric-renderer.js` 的一套歌词输入、当前行索引和 `LyricWordRenderer` 时钟/调度；高级渲染器仅接收外部传入的渲染帧数据，不创建网络连接、歌词解析或自己的帧循环。高级动画由同一播放位置校正 Web Animations 的时间，暂停/跳转同步更新；两层关闭、页面不可见或无歌词时停止持续帧任务，关闭基础层释放整首行 DOM。单文档共享不等于跨浏览器进程复用绘制：两个独立浏览器源仍各自绘制，场景数据依旧通过父窗口传入。目录缩略卡静态绘制，当前预览才播放动作。

高级编辑器按「搭配 / 编排 / 外观 / 动效」四类组织，分类栏随页面滚动固定在顶部；每类由可折叠的卡片组成，收起时在标题右侧显示当前值。「外观」依次为字体、配色、文字材质、描边、投影、光效与特效、装饰和显示内容；「编排」先列位置与尺寸，再列编排与构图；「动效」为节奏、入场/停留/退场（仅自由构图）和逐字动作。排版与入场的轮换开关和顺序位于对应卡片顶部，卡片上的「+ 轮换」可加入或移出，并显示其轮换序号。六种新增完整编排与随句编排均提供内置搭配；「镜头组曲」（`cinema-relay`）保留按句轮换聚焦镜头、逐段让位、纵向翻页、两翼接力和重音落版的顺序。「外观」提供六套独立的文字、强调、辅助三色搭配，只更改这三种颜色。应用内置搭配保留舞台宽度、缩放、位置与旋转；用户保存的命名搭配仍完整恢复其外观，包括这些位置字段。桌面高级预览可拖动定位，松开后沿已有设置通道保存 `advancedLyricPositionX/Y`；水平居中只改 X、垂直居中只改 Y，重置位置将两轴恢复为 50%，不改变材质、动效或场景图层的几何。宽窄窗口的编辑布局见[Admin 应用](app.md)。

字体组共用既有字体库，提供字重、正体/斜体、字号上限、字间距和同一词组的换行行距。字形、字距或行距改变时重建当前句并重新适配，沿用当前播放位置。颜色与纯字效调整复用现有字形节点，不重新测量或重置逐字进度；荧光手记材质改变字面内边距时仍需重新测量。`advancedLyricHighlightOpacity` 只控制演唱高亮层，调低后露出下层材质，设为 0 也不取消逐字动作。

「文字材质」「描边」「投影」「光效与特效」按实际作用显示细项：投影开启后提供独立颜色、距离、方向与柔和度；外发光开启或使用霓虹材质时提供发光范围和浓度，颜色沿用强调色。渐变、落日、极光、金属、透光、条纹、幻彩、水墨及胶片提供材质方向，条纹、网点、粉笔、幻彩及胶片提供纹理大小（幻彩为光泽跨度，胶片为扫描线间距）；空心字形隐藏这两项。关闭逐字动作时隐藏演唱填色浓度；投影、长投影、文字色差或发光至少一项生效时才显示字效强度。隐藏细项保留已存值。桌面、画布和歌词输出沿用同一字段与保存通道，范围和旧配置补齐规则见[歌词视觉设置](../backend/storage.md#歌词视觉设置)。

管理页左侧顶部的音乐跟随、播放器检测与当前曲目由基础/高级样式共用，位于样式切换页签上方；切换页签只更换下方样式设置及对应的预览和复制地址，不重新检测播放器或重置来源。编辑预览始终接收当前音乐来源的实时歌词事件，没有独立的示例时间轴或试播定时器；未播放时显示等待状态。预览背景仅用于检查透明内容，不进入输出。

普通歌词默认使用「荆南麦圆」（`Lira Maiyuan`），共享字体库目录（19 款软件字体与系统字体枚举）与按需补齐机制见 [pages.md §6](pages.md#6-静态资源) 与 [app.md §10](app.md#10-共享字体与资源下载)。歌词字体值仍允许最多 256 个字符（画布其他字体参数保留原 80 字符限制）；旧字体 ID、未加引号的字体名和已保存的系统组合值继续可读，不改写已有选择。独立预览中的系统字体枚举沿用浏览器许可，未获许可时保留当前设置；月渡花汀资源样式仍映射为包版本专用文楷。

字体补字自动处理，设置页和画布均不显示备用字体输入。`lyrics/desktop-lyric-styles.js` 在所选字体之后依次使用 `Lira Lyric Korean`（韩文）、`Lira Xiaolai`（中日及其他已收录文字）、`Lira Lyric Extended`（扩展字母），再保留旧 `desktopLyricFallbackFontFamily` 和系统字体作为最后备用；旧键继续可读，设置页自动保存不覆盖它。末尾的 `serif`、`sans-serif`、`monospace` 移到补字字体之后。阿拉伯文、希伯来文、泰文及南亚等连写或组合文字由链首的 `Lira Lyric Scripts` 按 `unicode-range` 提供完整字形，避免装饰字体只覆盖部分字符而拆散排版。补字资源由共享字体库统一登记，与其他组件共用本机 CDN 缓存，兼容字体族由目录元数据生成，按文字需要加载；纯中文歌词不加载额外语种字库；支持常见中、英、日、韩、欧洲、中东、南亚及东南亚歌词文字，但不涵盖全部 Unicode 字符。详细范围、上游版本及许可见[自动补字资源](../../../public/fonts/lyrics-fallback/README.md)。客户端预览、画布与直播输出共用此字体链。

歌词正文、翻译和罗马音均按内容自动判断文字方向。包含连写文字、组合附标或分解韩文的句子保留完整文本排版，以整行跟随播放，避免逐字高亮的独立块拆断字形；普通中文、英文、日文及预组韩文继续使用原有逐字效果。

字体大小 `desktopLyricFontSize` 为 24–72px，设置值直接决定正文的 CSS 字号；翻译按 `desktopLyricTranslationScale` 缩放，罗马音为翻译字号的 86%。客户端预览和直播输出共用字号规则，窄画面通过换行容纳内容，不再按视口或预览容器宽度另行缩小文字。

字间距 `desktopLyricLetterSpacing` 范围为 `-0.1–2em`，默认 `0`，步长 `0.01em`；设置页、画布参数与共享渲染器使用相同限制。设置页的字间距滑块通过 `data-range-scale="balanced"` 将负值侧分配为轨道的 25%、正值侧分配为 75%，两侧分别线性映射；拖动、零点标记和圆点位置共用 `shared/parameter-range.js` 的映射。原生输入值、键盘步长、数字输入与保存值仍使用实际 em 数值；未标记的滑块保留原有线性比例。

`desktopLyricCurrentLineEnhanced` 控制当前句的底板和光晕，界面名为「当前行底板」，普通歌词默认关闭；逐字高亮独立保留。更新不改写已保存的字体或底板开关，恢复默认才使用新默认值。月渡花汀资源样式显式启用该项以保留其诗笺效果。

画布资源样式 `moonlit-lyrics` 通过现有套装加载器按需装入 `css/lyrics/moonlit.css` 与 `moonlit-font.css`，复用银蓝花枝并加载套装内的霞鹜文楷 Light 分片字体；`style` 默认为 `default`，导入后可为 `moonlit`。它与普通直播歌词共用 `lyrics/desktop-lyric-renderer.js`、`desktopLyric*` 参数及 `--preview-*` 变量，不建立额外时间轴或轮询。诗笺和花枝属于当前句强调层，逐字高亮为暖金；字体、字号、颜色、行高、翻译、描边、透明度、显示行数及暂停隐藏仍由共享设置决定。默认主字 48px、行高 1.2、单句显示，诗笺最小高度 108px；内容增多时允许扩高。字体参数「月渡花汀文楷」在渲染时映射为当前资源版本专用字体名，自定义字体仍走共享参数。字体资源为可选项，旧套装继续有效；新套装携带完整字符覆盖的 23 个 WOFF2 分片和 OFL 许可证。退出资源样式时随套装样式表一起移除装饰与字体。逐字节点挂载前清空该行的静态文字，避免原句和逐字层重复显示。

[overlays/lyric-window.js](../../../public/js/overlays/lyric-window.js)：

- **画布预览**：画布使用静态示例歌词，预览投影关闭暂停隐藏；保存的 `desktopLyricHideOnPause` 不变，正式输出仍按实际播放状态决定是否隐藏。
- **使用方**：管理页右侧提供当前基础/高级样式的地址复制按钮，悬停可查看完整地址，供浏览器或浏览器源使用；页面背景透明，实际输出不包含管理页预览使用的网格/纯色辅助背景。
- **数据**：首次连接和重连均从 `/ws` 的 snapshot 取得两层视觉设置（排除自存搭配库）、`lyricState` 和 `lyricTimeline`，并接收增量 `lyric-state`、`lyric-timeline`。时间轴是受预算限制的预载数据；快照、增量及场景投影均保留可选截断边界，字段与预算见[音乐服务 §13.2](../backend/music/services.md#132-差异)。页面不再请求不存在的 `GET /api/settings`。
- **基础渲染**：与管理页 `admin/desktop-lyric-preview.js` 共用 `lyrics/desktop-lyric-renderer.js`，显示预载范围内的歌词、翻译、罗马音、当前行逐字进度和长间奏三秒倒计时。达到截断边界后使用实时当前句，跳回范围内恢复预载列表，基础和高级层沿用[播放参考 §3](playback.md#3-歌词链路)的同一规则。预览与直播输出均不显示歌曲总进度条。逐字高亮支持连续填充与按时间点亮两种模式，隐藏 `desktopLyricPreviewPlayback` 只提供 aria-live 文本，当前行 `LyricWordAnimator` 是基础层的唯一视觉逐字更新源。样式设置通过同一组 `--preview-*` CSS 变量应用，预览与浏览器源均按保存的逻辑字号排版，管理页再将整张虚拟画布等比缩小至面板内。
- **预览尺寸**：管理页预览画面下方的同一工具栏依次提供「暗幕 / 棋盘 / 浅幕」、宽、高像素输入与尺寸说明；不额外显示「预览尺寸」文字，输入组保留该无障碍名称。基础与高级共用右侧同一张预览卡与大圆角舞台，尺寸偏好按样式层分别记录（基础默认 720×960px 以便多行滚动展示，高级默认 960×640px 保证取景编排空间充裕），宽度接受 160–7680、高度接受 90–4320 的整数。`admin/desktop-lyric-preview.js` 按面板与虚拟画布宽高计算不超过 1 的等比缩放，调整面板宽度不会重新压窄歌词排版。尺寸以 JSON 对象 `{ basic: [w, h], advanced: [w, h] }` 保存至本机 `localStorage.desktopLyricPreviewSize`（兼容读取旧数组格式，并将旧默认 `[960, 360]` 平滑升级到分层默认），预览底色保存至 `localStorage.desktopLyricPreviewBackground`，均不写入后端 settings、云同步或画布图层几何。直播来源仍以自身实际视口决定排版宽高；如直播软件来源宽 1800px，应将预览宽度也设为 1800px 以模拟换行，预览输入不会修改来源尺寸。
- **基础间奏提示**：按上一句最后一个有效字词的结束时间计算空档，无逐字时间时使用有效的行结束时间；空档至少 6 秒，才在下一句前最后 3 秒显示三个点。只有开始时间或以下一句开始时间推算结束时间的普通歌词不猜测间奏；长前奏仍从歌曲起点计算。限定显示行数时，提示在已唱完的当前行内替换正文、翻译和罗马音，保留原占位，下一句不会被额外提示行推开；整首模式保留独立提示行。提示尺寸随字号调整，颜色跟随文字和显式已唱配色，跳转和模式切换会恢复歌词。
- 基础和高级样式共用**统一圆角预览舞台**，切换页签时预览卡与圆角舞台高度保持一致。基础样式按竖向比例充满圆角舞台展示多行歌词；高级样式及较扁的自定义比例在同色遮幅中以微圆角取景框和四角标线标示实际推流范围，高级模式悬停或拖动时浮现定位参考线与百分比坐标。底色支持暗幕、低对比细棋盘和浅幕三档，直播来源背景透明。两个页签都在取景框中央显示等待及载入提示（附透明背景与当前尺寸说明），有歌词后退场并在标题栏显示播放状态。基础层按配置显示的无歌词文案或歌名属于歌词内容，沿用歌词颜色。宽窗口预览占满面板可用高度，预览列最宽 436px。窄窗口将预览放在设置上方，两种模式使用相同高度。
- **文字描边**：新配置、恢复默认及新建画布歌词组件的 `desktopLyricStrokeEnabled` 默认 `false`；缺失设置时同样关闭。已有配置中显式保存的描边选择继续生效。
- **逐字配色**：「高亮与配色 → 逐字高亮方式」及画布参数集中提供「已唱颜色」「未唱颜色」，文字排版不重复展示文字颜色。未唱颜色复用原 `desktopLyricTextColor`，原保存值保持不变，同时用于普通整句、翻译、罗马音及关闭逐字时的歌词。新增 `desktopLyricSungColor` 默认空值，表示跟随样式（普通为 `#ffcf4a`，月渡花汀为 `#93682f`）；取消跟随后自定义当前句的已唱高亮色，两种高亮模式共用。两个颜色按钮各自支持透明度，不改写统一的 `desktopLyricOpacity`；同组保留歌词文字不透明度控制，统一影响两种颜色。恢复默认将未唱设为黑色、已唱恢复跟随。预览、直播来源和画布共用 `--preview-color` 与 `--preview-sung-color`。
- **基础设置分组**：客户端与画布共用 `admin/desktop-lyric-parameter-layout.js`，依次为文字排版、显示内容、高亮与配色、描边与阴影、位置与动效、背景与画面、播放与同步。前两组默认展开；「翻译 / 罗马音字号」「换行行距」「句间距」直接位于首组文字排版中。更多排版、当前行强调、阴影位置、位置微调、3D 倾斜和画面调色分别收在所属组内。描边、阴影、背景关闭时收起依赖参数，关闭逐字高亮时收起「逐字跳动」和「已唱颜色」，均保留原值。分组摘要展示当前状态，不统计参数数量。非当前行不透明度仍使用 `desktopLyricBaseOpacity`，同时作用于前后歌词；繁体字形仍由字体的 `font-variant-east-asian` 实现，不转换歌词文本。
- **基础文字排版**：时间轴使用实际视口的完整宽度，不再以 980px 为上限；水平内边距为 `clamp(24px, 6%, 82px)`，宽度变化会改变长句换行。`desktopLyricLineHeight` 通过 `--preview-line-height` 调整同一句换行后的行距；`desktopLyricLineGap` 通过 `--preview-line-gap` 设置相邻句的时间轴间距，歌词行不再额外叠加上下内边距。两项分别调整，字段默认值与范围见[歌词视觉设置](../backend/storage.md#歌词视觉设置)。
- **副行显示**：「显示内容」中的译文与罗马音开关分别控制 `translation` 和 `roma`，支持仅译文、仅罗马音、同时显示或都关闭，正文与歌词数据保持不变。旧设置缺少罗马音键时继续显示；字段默认值与保存规则见[歌词视觉设置](../backend/storage.md#歌词视觉设置)。客户端预览、独立歌词来源和画布复用相同显示规则；任一副行开启时，可在「文字排版 → 翻译 / 罗马音字号」调整共用字号比例，两者都关闭才收起，译文不透明度仍仅随译文开关展开。缺少相应歌词数据时不生成替代内容。
- **显示行数**：管理页和画布「显示内容 → 显示行数」提供整首、当前句、当前句和下一句、自定义行数；选择自定义可继续输入原范围内的行数，切换预设后可回到本次编辑的自定义值。界面选项不新增持久化字段，仍由 `desktopLyricVisibleLines` 同步控制预览与浏览器源。设置 `desktopLyricVisibleLines` 为 `0` 时显示全部预载行；正整数仍创建预载列表，只将当前行窗口外的行标记为不可见。`1` 仅显示当前行；偶数向下扩展，奇数向上下扩展，预载数据继续保留以保证同步和自动跟随。
- **播放换句**：基础歌词跟随[播放参考 §3 的显示时刻](playback.md#3-歌词链路)，长间奏的最后一拍让位给即将开唱的正文。`lyrics/desktop-lyric-line-transition.js` 在换句前后按行位置二分定位视口，测量邻近行和仍在移动的行。已经可见的行从原位置连续移动，新进入的行最多用 360ms 轻移、淡入。退出显示窗口的句子保留切换瞬间的逐字高亮，以不参与布局及辅助阅读的短暂快照在最多 180ms 内淡出。过渡与弹簧跟随都受开唱前剩余时间限制，极短空档直接切换。结束、切歌、跳转、手动浏览及样式变更时清理快照。连续换句从当前动画位置续接，系统开启「减弱动态效果」时只保留最多 140ms 的淡入淡出。高级歌词关闭「隐藏未唱字」时可提前读到整句，开启时按原演唱时间显字。
- **逐字跳动**位于基础样式的「高亮与配色」，默认开启。「连续填充」和「逐字点亮」都按收到的字词时间让当前字词轻轻上浮、放大，长音保持后落回。关闭开关立即取消位移和缩放，正在进行的高亮继续。默认样式、月渡花汀等基础歌词共用此逻辑，高级歌词使用自己的「动效 → 逐字动作」。暂停和跳转会对齐播放位置，性能降级或系统开启「减弱动态效果」时仅保留高亮。没有字词时间时整行显示。
- **增量渲染**：只为当前正在填充的词创建高亮动画；未开始的词保持未亮，唱完的词写入全亮状态后释放动画，跳回词内时按当前进度重建。暂停保留当前词的填充位置，不逐帧重写相同时间或反复调用 play/pause；手动及静态高亮只写变化值。换行仅更新旧、新活动行涉及的状态与可见窗口差集；跳转同步跨越区间，显示行数变化同步新窗口，替换时间轴时重建初始状态。倒计时只在目标句或显示秒数变化时更新。共享渲染器按规范化后的设置和完整时间轴去重，相同快照不重建歌词、取消换行动画或重置手动浏览；真实内容和设置变化仍即时生效。
- **隐藏预览**：共享 `LyricWordRenderer` 同时检查文档可见性与调用方指定显示区域的 IntersectionObserver；桌面歌词观察实际舞台，避免把隐藏的 aria-live 节点当成显示区域，全民 K 歌观察包含歌词、进度条和时间的完整面板，避免单独滚出歌词行时停更仍可见的进度。隐藏时停止刷新调度，桌面歌词同时暂停逐字动效并清理滚动/换行过渡；状态接收及播放时钟仍正常更新，重新可见时立即按当前时钟重绘和跟随，不补播隐藏期间动画。观察器在 renderer dispose 时释放。可见时的帧率、画质及既有性能自适应规则保持不变。
- **性能默认值**：新配置默认关闭弹性滚动、非当前行模糊和行缩放，优先保证歌词清晰与浏览器源稳定；用户已保存的显式设置继续生效。左对齐、居中、右对齐和两端对齐统一作用于当前句与普通歌词；两端对齐时逐字节点按行分布，英文词间空格保留。居中的正文、翻译和罗马音使用均衡换行，行缩放以所选对齐边缘或中轴为原点，切换高亮不会改变对齐方向。
- **滚动与跟随**：歌词视口使用独立纵向滚动；上下留白按视口高度及所选对齐位置计算，首句、末句和限定行数也可落在指定锚点。当前行及相邻行使用实际高度，视口或时间轴尺寸改变后重新跟随，避免长句、翻译或字体加载后的定位偏移。弹性动画开启时，自动跟随使用逐帧弹簧；关闭时直接更新滚动锚点，由上述播放换句过渡衔接视觉位置。用户滚轮、触摸、指针或键盘滚动后暂停自动跟随 6 秒，再恢复到当前行。
- **状态防回灌**：客户端只接受更大的 `generation`，或同一 `generation` 下严格递增的 `sequence`；尚未接收版本时兼容缺字段的旧客户端。场景断线通过 renderer 的本地 `suspend()` 停止计时与动画，不修改来源版本校验；重连允许恢复与最后接收版本相同的完整快照，恢复后继续拒绝重复、旧版本和无版本状态。`content-visibility:auto` 与 `contain-intrinsic-size` 跳过视口外绘制，不改变预载歌词列表的滚动结构。
- **时钟与逐字连续性**：共享 `LyricWordRenderer` 的普通状态更新使用 `LyricClock` 已有的 350 ms 漂移容差，在容差内保持本地连续时钟，不逐包强制校准。连续播放且速率不变时，与上次原始采样相同的 `currentMs` 不作为新锚点，避免重复读数把同一个字的填充反复拉回；本地时钟仍按播放速率推进，并受歌曲时长约束。首次状态、`generation`/曲目变化、显式时间跳变（discontinuity）、暂停/继续、速率变化及新位置的超阈值漂移才重锚；因此内置 seek 和来源切换允许小幅向后跳转，外置读数变化后的大幅跳转也能立即跟随。时间轴在逐字预算内预载各行 `words`，具有预载逐字时间的行由 `desktop-lyric-renderer` 按本地时钟直接开始下一句首字，不等待新句状态包；晚到的当前句状态复用已创建的动画。旧时间轴或预算不足的行没有逐字时间时回退 `lyricState.words`，下一行采样提前到达时保留显示中当前行的动画，实际换行再释放。`generation`/曲目变化同步重锚当前逐字动画。此策略统一覆盖内置及各外置播放器的管理页预览和歌词浏览器源；WeSing 播放页仍复用同一时钟。

### 歌曲信息(/now-playing)

独立透明页面 [now-playing.html](../../../public/pages/overlays/now-playing.html) 由 [now-playing.js](../../../public/js/overlays/now-playing.js) 接收 `nowPlaying/nowPlayingConfig` 快照及 `now-playing` 消息；画布内通过 `mountSceneExtraClient('now-playing')` 使用父页提供的配置和 `{nowPlaying}`，不另开歌曲订阅。

[now-playing-renderer.js](../../../public/js/shared/now-playing-renderer.js) 与客户端预览共享。`nowPlayingPart` 区分 `record`（唱片）和 `text`（歌名/歌手）；旧配置缺省为 `all`，继续使用原横向/纵向组合布局。独立浏览器源分别使用 `/now-playing?part=record` 和 `/now-playing?part=text`，查询参数固定该来源的内容；原 `/now-playing` 仍可用。唱片提供黑胶、圆形封面、带唱臂唱片机，并按自身图层宽高等比适配；文字使用独立区域排版，不加载封面。仅唱片旋转，文字保持稳定；暂停保留当前角度，缺失封面使用默认唱片，旧图片加载结果不能覆盖新歌。显示唱片/歌名/歌手、暂停隐藏与空曲目隐藏分别可调，系统开启「减弱动态效果」时停止旋转。歌名和歌手通过文本节点输出。

当前曲目信息来自与歌词相同的来源仲裁，曲目没有歌词仍可展示。客户端入口为「组件 → 音乐展示 → 歌曲信息」，同页分别设置、预览和添加唱片与文字，当前/示例预览选择及共同显示规则共用；独立页面只接收本组件的外观与歌曲展示字段，允许只读配置请求，不获得音乐控制或管理权限。画布目录提供三种独立唱片及「歌名 / 歌手」，两者分别摆放、调整宽高、隐藏和发布，`nowPlayingPart` 与唱片样式一样属于场景身份，不受公共外观回填覆盖。原生字段统一见 [now-playing-appearance.js](../../../public/js/shared/now-playing-appearance.js)。

## 6.1 弹幕姬

桌面设置区通过已有场景地址输出画面；样式选择与弹幕过滤各有独立边框，弹幕过滤位于弹幕外观上方，包含用户黑名单和敏感词屏蔽，由 `admin/danmaku-overlay-filters.js` 通过独立受限 IPC 管理服务器私有配置。UID 可直接输入，也可读取当前绑定直播间的 B 站在线榜后搜索、勾选（榜单只包含接口返回的部分观众）；词语按正文包含匹配（英文不区分大小写），支持单个移除和一键清空。列表操作即时提交，确认成功才更新展示，失败保留输入；账号切换清空输入与列表、忽略旧回包。过滤只影响保存后新收到的普通弹幕，不改变现有卡片、礼物、系统提示或其他弹幕使用方，服务器配置在客户端关闭后仍生效。样式预览与显式应用流程保持独立。

桌面弹幕外观由 `danmaku-appearance.js` 与 `danmaku-appearance-store.js` 按授权 Server origin + `streamerId` 保存在本机。`danmaku-overlay-settings.js` 复用配置控制器，通过本机管理 API 读取和保存，编辑仅为草稿；迟到回包不覆盖新编辑或新账号。首次成功读取承接旧远端配置，后续云端外观不再覆盖本地参数。具体接口见[本机弹幕外观管理](../backend/api.md#本机弹幕外观管理)，持久格式见[本地场景持久化](../backend/storage.md#本地场景持久化)。

「预览与调整」由 `admin/danmaku-overlay-settings.js` 使用 `danmaku-preview.js` 创建组件描述，再经 `component-preview-dialog.js` 打开系统浏览器中的场景编辑器。其 `/danmaku?preview=1&componentPreview=1` 子 frame 保留 `sandbox allow-scripts` 与不透明源（`Origin: null`），不能访问父页凭证/preload；网页修改经临时组件会话返回客户端原控制器，再写本机外观 API。关闭销毁 frame 和消息监听但保留共享草稿；账号切换使旧会话及迟到保存失效。新流程使用既有本机场景来源，要求桌面持续运行。服务器已按 ADR-0118 退役 `/overlay` 画面、预览及静态资源；事件订阅与兼容设置接口继续保留，边界见[服务器订阅地址与旧画面退役](#服务器订阅地址与旧画面退役)。

**内置弹幕通用约束（以下各款内置样式均遵循，后文仅列出各款例外与专属设计）**：

1. **本机存储与交付边界**：外观参数按授权账号保存在本机桌面存储，客户端预览、画布编辑与本机场景浏览器源共用同一渲染实现；新增样式与参数不要求服务器新增渲染器、额外启动下载或独立消息连接。
2. **布局补齐与恢复默认**：旧本机布局缺少某款样式时，仅按该款默认规则补齐缺失区域，不移动或改写已保存区域；「恢复默认」仅重置当前选中样式，不影响其他样式。
3. **本房间身份与上舰语义**：聊天的大航海身份、粉丝牌与主播标记仅取本房间显式字段 `roomGuardLevel`、`roomMedal`、`isStreamer`，不将其他房间佩戴身份或旧 `guardLevel` 推断为本房大航海；购买大航海由 `giftGuardLevel` 决定等级、由明确 `guardAction` 决定开通/续费，未知动作统一显示「支持」或「感谢支持」，不编造陪伴天数或动作。
4. **金额、SC 原文与安全渲染**：所有动态文字经公共安全渲染器以纯文本写入（不解析 HTML）；礼物金额直接使用单条已结算总额 `giftTotalPrice`（不再乘数量），SC 使用实际 `price` 并完整保留字面原文与换行，缺失或非法金额显示 `—`（0 元保留为已知金额）；SC 撤回沿用本场 `messageId` 定点移除。
5. **快照与减弱动态效果**：稳定快照恢复直接呈现终态，不重播入场动画；普通外观调整不重播已有消息入场；系统开启「减弱动态效果」（`prefers-reduced-motion`）时关闭入场强调与装饰循环，直接显示完整内容。

独立弹幕的 `{canvas,contentScale,regions}` 由 `public/js/shared/danmaku-layout.js` 定义。浏览器编辑器直接导入这个模块，主进程 IPC 和本机场景通过 `src/shared/danmaku-layout.js` 的 CommonJS 入口调用同一个 `normalizeLayout`。弹幕编辑器与场景画布设置共用 `public/js/shared/canvas-presets.js` 的五种分辨率预设，分别为 1280×720、1920×1080（默认）、2560×1440、3840×2160、1080×1920。自定义宽高各为 320～7680 的整数。各样式各自记忆 `{x,y,width,height}`；固定样式默认距左/下 40，其中七款尺寸依次为 `bubble` 570×560、`signal` 560×600、`minimal` 588×576、`ranked` 640×640、`transparent` 520×540、`identity` 640×616、`moonlit` 480×700，`twitter` 为 480×700；`outline`/`cream`/`glow` 默认铺满，称「区域随机」。新默认尺寸不覆盖已保存的区域位置和尺寸。独立弹幕区域至少 64×64 且不能超出其画布；统一编辑器的三栏布局及公共图层操作见下方组件系统说明。

从旧布局向场景添加新增弹幕样式时，`admin/danmaku-preview.js` 对缺失的样式区域使用 `defaultRegion(style, canvas, contentScale)`，不回退到整张画布尺寸；已保存的样式区域继续沿用原位置和尺寸。固定、区域随机、飘窗和横向样式分别遵循既有默认区域规则。

新增的 19 款固定列表样式统一使用宽 480、高 700 的竖向默认区域。`overlays/danmaku-canvas.js` 的 `FIXED_DESIGN_WIDTHS` 保留这些样式原有的绘制宽度，区域相对绘制宽度缩放文字与卡片，避免新默认宽度放大已保存图层里的文字。旧六款、区域随机、飘窗与横向样式的默认区域不变；恢复区域默认会使用新尺寸，已保存区域不自动调整。

固定样式按当前区域宽度相对该样式绘制基准宽度的比例，统一缩放文字、头像、卡片、装饰和间距；区域高度通常决定可见条数，移动区域不改变外观；特别矮的区域限制整体倍率，确保内边距后仍有内容空间。礼物与 SC 卡片在设计空间内先适配扣除两侧各 12px 后的可用宽度，再随区域一起缩放，避免窄区域裁掉数量或图片。随机样式以 `contentScale` 为倍率上限，窄区域同时缩小内容，保证头像和装饰仍有排版空间。固定与随机样式都会将超出可用宽高的单条消息整体缩小，尺寸恢复后重新按自然大小排版；长昵称、礼物名、数量和金额允许换行，不以省略号代替内容。区域越小，文字也越小；消息过多时仍按原规则整条移除最旧消息。同比改分辨率会同比改变区域和 `contentScale`；换宽高比保留 `contentScale`，未调整的默认区域继续靠左下，自定义区域收敛到新边界，原铺满区域继续铺满。`styleOptions` 保存逻辑字号，独立编辑器的画布字号使用当前实际内容倍率换算。`overlays/danmaku-canvas.js` 使用同一 CSS 变量/坐标规则渲染本机预览和正式页，正式页等比居中、透明且不含选框。网页来源尺寸与画布一致即可精确还原位置。旧配置 `layout:null` 继续使用原来源窗口布局，保留的服务器设置 PUT 省略 `layout` 不清除其已保存画布，首次显式应用编辑器才启用新画布。

### 浏览器源兼容

内置弹幕在 OBS、哔哩哔哩直播姬的网页来源中使用相同样式。需要动态混色的参数由 `shared/color-value.js` 的 `setColorProperties` 在现有外观应用或消息渲染阶段同步原始颜色、RGB 通道、alpha 和预乘 alpha 的 sRGB 混色结果；固定主题及角色混色由各款 CSS 保存计算后的颜色。底色不透明度继续乘入颜色自身的 alpha，恢复默认时清除对应派生值，以重新使用该款主题或身份色。不能在依赖 `color-mix()` 的声明后再放一个旧内核无法计算的透明度覆盖；万圣节保留既有的能力检测与配色回退。

渐变、图片遮罩同时提供 `-webkit-mask-*` 和标准声明，并在切换效果及关键帧中同步清除或更新两套属性。复合遮罩按旧 WebKit 的图层合成语义设置，不能直接照抄标准运算值。先锋票根的 SC 标题在独立 SVG 的 `foreignObject` 内保持 HTML 文字，遮罩与裁切作用于该 SVG 子元素，避免旧内核不能对 HTML 应用 SVG 片段遮罩而显示成完整色块或整层消失。入场动画使用旧内核支持的数值、长度和角度变量，具体文字栅格及变换顺序约束见[固定弹幕动效](danmaku-motion.md)。玻璃气泡的轮廓 `shape()` 沿用既有圆角卡片回退。

### 月渡花汀

固定样式 `moonlit`：灰色普通弹幕、霁蓝舰长、藕紫提督、胭脂红总督，矩形中放头像、昵称及文字/表情，头像旁使用现有 B 站三档大航海徽章。新消息先显示头像、昵称、正文及对应身份深色的小矩形底框（比昵称底色更深、更接近黑色）；停留约 333ms 后，以 900ms 从左向右覆盖墨迹和花饰，前缘为约占元素宽度 20% 的柔边遮罩而非硬裁切，底框始终保留，不淡出或删除。固定列表以相对位置动画移动，时长为 420ms 加本轮最大位移像素（普通单行约 520ms，卷轴与上任更长，上限 760ms），同一轮各行共用时长与曲线，从静止起步时先短暂加速而非瞬间达到峰值速度；避免整卡 transform 图层切换改变文字栅格化效果；连续追加从当前可见位置与当前速度衔接，新消息跟随队尾保持间距，支持向上与向下滚动及缩放。移动完成时按已测尺寸清理旧消息；连续追加也在既有位置测量批次中淘汰当前与目标都完全越过退出边界的旧行，保留部分可见内容和装饰留白，消息数量上限仍立即生效。由 `danmaku-moonlit.js` 只负责装饰组合，主题 CSS 和透明山水/花鸟素材独立维护，消息仍复用安全渲染器与现有信息流。

购买大航海采用中央头像、左侧斜向错落的两字称谓、右侧斜向错落的「上任」及下方姓名带。三档沿用对应身份色；山水、月轮、背景与头像先用 1450ms 从上到下显现，1500ms 时开始以 1550ms 从左到右显现题字、姓名与恰好三只鸟。正式 `gift` 新增可选 `avatarUrl` 和购买等级 `giftGuardLevel`，经 Electron 云端事件白名单验证后传入组件；发送者当前身份不能触发上任。普通礼物与 SC 共用固定大小的银蓝花枝、滚轴、双边线与月白纸面组成的紧凑卷轴，含头像、昵称和已结算总额；普通礼物显示礼物名与数量，SC 在相同位置显示完整原文，不设正文固定高度。卷轴采用约 150px 高的紧凑单行布局，头像在左、昵称与金额同排、正文及数量在下；长文自然增高。卷轴先以 1400ms 从右向左展开纸面、山水底纹、头像和文字，滚轴中心始终贴合纸面裁切边界，展开后停在左侧；展开完成后，再以 1200ms 从左向右显现双边线、笔刷边缘和花枝，第一阶段不显示外围装饰。除纸面展开保持与滚轴对齐的硬裁切外，墨迹、花饰、外围装饰、上任场景与题字的显现都使用移动的柔边遮罩。纸面内部的山水底纹向左延伸，透明度从左端 0 平滑过渡到右端 55%，与纸面共用从右向左的展开裁切；头像和文字在纸面内垂直居中。外围装饰完成后，绢面微光以 52% 峰值强度从左向右扫过一次，持续 1800ms 后消失；开启「减弱动态效果」时不播放微光。银蓝月白色明确替代本主题的 SC 价格色。旧字段缺失时使用普通礼物卷轴/头像回退。

合成预览打开或刷新时先显示普通礼物，再显示舰长感谢，其余样例随机无放回播放，包含三档上任，复用原播放和清理机制。云端事件 `avatarUrl`、`giftGuardLevel` 等字段的白名单与拒绝由 `test/scenes/scene-cloud-controller.test.js` 覆盖，渲染文本安全由 `test/danmaku/danmaku-message-renderer.test.js` 覆盖；预览开场顺序、上任场景与动效以实际播放验收。

### 本地页面 /danmaku 与示例

`mist`（青雾）为全屏/区域随机样式：普通用户使用透明直角白框，当前直播间大航海用户（`roomGuardLevel` 为 1/2/3）使用浅青渐白卡片，外置昵称与爪印、内置圆头像；普通弹幕、礼物、上舰和 SC 的头像统一为 `1.4375em`（30px 正文下为 43.125px），头像列随之加宽并保持原间距。礼物显示赠送内容、数量、结算总额和白色昵称胶囊；购买大航海显示带对应舰长/提督/总督图标的感谢卡；SC 使用青绿标题与浅青正文（使用主题色而非价格档位色）。四类消息共用随机避让、2～30 秒停留时间与过期清理。支持字体、18～40 字号、正文颜色、背景透明度、中心倾向与离散程度；不提供滚动方向或礼物原图参数。

`whiteframe`（白描）复用区域随机布局：透明底、细白色圆角框，昵称居中在框上方；框内显示弹幕或礼物名 × 数量，礼物已结算总额居中放在框下（如 `138¥`，缺失为 `—`）。不显示头像、徽章与送出前缀，所有身份默认白色。支持字体、字号、文字颜色、停留时长、随机位置及通用入场动画参数，不提供背景或礼物图片选项。

`overlays/danmaku.js` 与 `danmaku-preview.js` 复用内置样式与信息流模块：

- **预览混播与原地更新**：随机混播内置弹幕（总督、提督、舰长、粉丝、普通观众和主播表情）、送礼通知及当前样式支持的 SC；首条立即出现，后续每隔 1231～3385 毫秒随机追加一条，每轮无放回抽取并生成新消息 ID 与时间戳。字体、颜色、背景透明度与外观效果原位更新，保留现有消息和下一条播放计时器；随机位置、停留与退场、飘窗分散及入场动画参数仅影响后续新消息，飘动速度由现有信息流更新。切换样式、礼物图片或金额门槛、滚动方向、机器人欢迎显示开关，以及手动「重新播放」或重置区域时重新演示。
- **交互、生命周期与草稿**：参数与共享外观效果控件在 `input` 阶段只更新读数，在 `change` 阶段提交草稿。页面隐藏时暂停，恢复时继续播放而不补发积压消息；关闭页面清理播放计时器、可见性监听、待渲染帧和信息流。不连接 WebSocket，素材本地且不发外部图片请求。单独打开时兼容初始 `style`/`styleOptions`/时长查询参数并通过可用的 `history` 保存草稿；嵌入时由受信父页保留草稿。经典气泡、融影名片在画布模式共用区域内容倍率，旧非画布模式保留原 600px 基准缩放。

小表情 `kind:inline` 无论夹在文字里、重复发送或单独发送，图片默认高度为正文的 `1em`；对白使用 `1.15em` 补偿素材透明边，使可见图形与正文相当，不改变独立贴纸尺寸；整张表情包 `kind:sticker` 使用原尺寸的 1.4 倍，即普通样式 `4.48em`、经典气泡与融影名片 `5.74em`，宽度按原比例并受现有画布限制。缺少 `kind` 的旧载荷仍沿用整条匹配时放大的兼容分类。预览文字示例显式标记 `inline`，纯图片示例标记 `sticker`。

保留的非预览本地入口以 `topic=danmaku` 连接 WebSocket，按 snapshot 的 `settings.danmakuOverlayStyle` / `danmakuFullscreenDurationSeconds` 切换样式和停留时间，从 `danmakuFeed` 恢复消息并接收 `danmaku:message` 与 `danmaku:superchat-delete`。按消息 `id` 去重，同一帧批量追加；浮动信息流在整批节点加入后统一测量，单条追加仍同步布局，保留空间等待与退出时序。SC 撤回按 `messageId` 同时移除已渲染及待追加卡片，不重建相邻消息。连接中断时指数退避重连，连接状态仍以 `liveStatus` 为准。该 WS 入口只保留兼容；新场景和 `/danmaku?source=component` 使用本地外观与统一接收的服务器事件，本地预览不写正式配置。

本地页面对去重、截取最近 50 条后的消息内容做完整比较。内容未变且信息流无需初始化时，快照保留现有消息节点、到期计时器及尚未绘制的增量帧；仍更新直播连接状态。旧版 WS 中已有内容完整匹配前缀的纯尾部追加复用正常追加，后续同 ID 单项继续去重；相同规范化外观不重复写入样式。首次空快照、前缀不符的消息修正/清空/补数、样式或影响消息结构的配置变更导致的信息流重建仍执行权威恢复；随机停留与退场参数只更新后续消息，已有消息的到期点保持不变，详见[随机与飘窗的动效参数归属](#随机与飘窗的动效参数归属)。此优化不改变场景/component 的配置确认或远端事件流。真实页面模块和共享信息流的节点/计时器回归见 `test/danmaku/danmaku-snapshot-stability.test.js`。

弹幕组件上方展示监控和弹幕过滤，下方「弹幕外观」将标题、保存状态与右侧预览按钮放在同行；最近使用和参数共用外框，以横线分区。输出地址沿用公共场景入口。主页「最近使用」最多显示 4 款内置样式，四种显示方式混排。从最近列表或样式库点选另一款时，该款立即移到首位，其余款式保持相对顺序。只有加入第 5 款才移除末项。最近卡片靠左排列，左侧为缩略图，右侧为名称及英文标识。列宽按内容收紧，最大 208px，容器不超过 960px 时分为两列。悬停显示完整名称与显示方式。右侧「全部样式」打开样式库，客户端和画布的库内卡片仍在同一行显示左侧名称与右侧英文标识。内置样式按显示方式、样式动效、节日限定和外观特征取交集筛选；顶部排列筛选条件与「清除筛选」，底部紧凑栏固定显示结果数量与「添加样式」导入入口。样式动效按默认外观中的分层入场、独立图层变化或装饰动画标注，整卡淡入/平移、列表滚动或飘窗平移本身不计入；标签不随个人参数变化。选择内置卡片更新原草稿并关闭弹窗，桌面有效修改自动保存；导入样式在库内独立展示，沿用原参数流程，不参与这些标签筛选和最近使用记录。

外观特征按默认外观的可见元素标注：「文字」以文字、头像或细线框为主，没有明显的独立卡片底色；「卡片」使用对话气泡、色块卡片或界面窗格；「纸笺」具有便笺、手账、信纸、票据或纸页拼贴外观；「插画」具有花草、动物或节庆物件等独立装饰，不按观众头像或礼物图片归类；「光效」具有辉光、星光、流光或明显的渐变、虹彩材质。同一款可同时命中多个标签，例如流霞属于卡片与光效，花与信笺属于纸笺与插画。客户端与画布共用这些标签和筛选逻辑。

`public/js/admin/danmaku-style-library.js` 负责选择器与最近使用记录，`danmaku-style-catalog.js` 只维护筛选标签，`visual` 数组保存同一样式的多个外观特征。历史使用 `localStorage` 键 `lira.danmaku-recent-styles.v1.<encodeURIComponent(account)>`。切换授权账号或重开页面时，从该账号的历史恢复列表，读到外观配置后将当前样式置顶。只有同一控制器代次内保存成功才更新持久记录，返回的 `saved.style` 和此前已应用的样式依次排在前面。待应用的选择只影响本次排列，较早的保存回执保留最新点选顺序。原始 `data-danmaku-style` 卡片仅在库中保留一份供画布读取，主页副本使用 `data-recent-danmaku-style` 并转发原选择入口。

内置样式库的「已选」位于缩略图左上角，右上角空心/实心星分别表示未收藏/已收藏。`danmaku-style-favorites.js` 负责当前授权账号的本机收藏及共用卡片绑定；桌面 `localStorage` 键为 `lira.danmaku-favorite-styles.v1.<encodeURIComponent(account)>`，值为样式 ID 数组，后收藏的在前，幂等重复收藏不调整顺序。打开列表时按收藏队列、其余样式原始目录顺序排列；本次打开期间收藏立即移到最前，取消只更新星标并保持当前位置，到下次打开才按持久化收藏和原始目录重排。筛选继续取原有交集，隐藏整张卡片，不改变收藏。星标按钮与选择按钮同级，收藏不选择样式、不关闭列表、不修改或保存外观；写入失败保留原状态并提示重试。最近使用仍遵循自己的原有顺序。

画布通过现有 canvas 预览会话的 `display.previewData.danmakuStyleFavorites` 接收 `{available,styles}`，`favorite` 命令交回桌面收藏模块写入；桌面订阅变化复用现有交换唤醒网页，同时更新两边已打开的星标与新增收藏的位置，不新增轮询，也不使用外部浏览器的 `localStorage` 保存另一份收藏。账号切换沿用控制器代次与会话撤销，收藏 UI 标识不作为授权凭证。

`danmaku-style-options.js` 定义各样式字体、正文字号范围、背景不透明度、礼物插画及入场动画选项；无底色样式不显示底色参数，蝶恋花与流光溢彩没有独立礼物图位。`styleOptions` 由本机账号配置按样式保存，不受远端支持哪些样式限制。切换样式保留各自草稿，恢复默认只重置当前样式，仍需显式应用。固定样式另有「滚动方向」：`up` 为从下向上（多数款默认），`down` 为从上向下（磨砂通知默认）；方向随当前样式草稿保存、传给本地预览并在保存后通过本地场景通知更新。随机样式隐藏且不接受该参数；反向排列仍淘汰最旧消息。区域随机的停留时间位于参数区，按当前样式保存。

固定弹幕常规参数另有「边缘处理」，保存为当前样式的 `styleOptions.<style>.edgeFade`：`both` 上下两端渐隐、`top` 仅上边渐隐、`bottom` 仅下边渐隐、`none` 直接切断。明确选择的上/下边不随滚动方向改变；旧值 `single` 仍兼容，按滚动方向解析为移出端的 `top` 或 `bottom`，界面显示具体边缘。各款缺省由能力表定义，例如流霞为 `both`、推文动态和磨砂通知为 `none`；其余款沿用自身默认；渐隐范围沿用 32px，星语保留 24px，随内容一起缩放。公共 `motion.css` 负责遮罩，样式只指定自身范围；不改消息淘汰、动画或计时。管理页、画布参数与独立预览共用草稿，恢复默认只重置当前样式；随机和飘窗隐藏且拒绝此字段。旧记录缺失时采用上述默认，客户端保存完整外观；服务器保留的设置 PUT 兼容行为保持独立。

区域随机的公共入场、退场与飘窗边缘参数见[随机与飘窗的动效参数归属](#随机与飘窗的动效参数归属)。`fade` 保留各款原有渐显；`rise` 让卡片与昵称从下方上浮，正文从左侧滑入后轻微回正，不缩放文字。正文包装由本机 adapter 复用或补齐，固定来源的渲染核心保留兼容；漫画的原生编排由本款独立维护。

`styleOptions.<style>.fontSize` 调节正文与行内表情，不作为整张卡片的缩放基准。普通正文和 SC 留言沿用各款字号比例，礼物/上舰文案保留各自排版层级；先锋票根礼物票据固定字样不随正文变化。默认值和范围由能力表定义。头像、框体与装饰仍使用原设计基准：万圣幽灵为 20px，折角便签为 23px，森间手绘/对白/流霞/雪狐童话/青雾/白描为 30px；更大的正文不会连带放大这些外框。昵称与灯牌按各款单独设定，琉璃、夜航讯号和经典气泡的昵称保留 30px。画布/组件整体缩放仍同时缩放文字与装饰；超高单条继续自动适配，其中流霞和雪狐的全宽事件卡临时缩小卡片基准与正文变量以重新换行，恢复空间后清除临时值。已有字号参数不迁移，切换及恢复默认只作用于当前样式；桌面预览与本机场景输出复用同一套 CSS。

各款排版先保留文字对齐和装饰安全区，再协调字号与容器尺寸，不保证任意内容下卡片高度不变。星芒笺聊天昵称保持绝对定位的嵌边标题，正文在内框安全区居中；天穹昵称与正文按基线对齐，星标单独居中。推文动态将昵称与认证标组合，元信息可整体换行；散落小窗将舰徽与灯牌组合，窗角控件保持顶行位置。花与信笺的正文与落款分行，礼物/SC 的发送者、心形和金额在独立底栏，上舰昵称参与排版并随长名称增高。这些规则由各款渲染器/CSS 维护，不改变画布几何、组件缩放或公共信息流适配。

`overlays/danmaku-style-application.js` 的 `applyStyleOptions` 将解析后的外观应用到 DOM、CSS 变量和 Twitter 文本节点，单向读取共享参数约定。`shared/danmaku-style-options.js` 保持无 DOM 副作用；其 `DANMAKU_OPTION_FIELDS` 集中维护参数名称、类型、范围、默认值、选项、分组及所需能力；`DANMAKU_STYLE_OPTIONS` 声明各款能力与默认值，`styleOptionFields(style)` 一次解析并缓存适用字段。「文字样式」「配色与外观」「消息与动效」「高级参数」可独立展开，默认展开文字样式。「配色与外观」在本款有相应字段时显示。「高级参数」包含本款造型细调和通用外观效果。通用外观效果仍由 `shared/component-style-parameters.js` 的 `STYLE_PARAMETER_GROUPS` 与能力表负责，保留既有 `styleOptions[style]` / `styleParameters[style]` 两类配置。

以下本机专属参数沿用同一草稿、保存和恢复默认流程：

| 字段 | 适用样式 | 默认与用途 |
| --- | --- | --- |
| `styleOptions.whiteframe.bubbleColor` | 白描 | 复用配色控件，显示为「边框颜色」；`default`（缺省）保留原来的 85% 白框，自定义接受六位或八位十六进制颜色，色板初始值为 `#ffffffd9`。只改消息与礼物边框，不联动正文色 |
| `styleOptions.<style>.ambientMotion` | 星语、折角便签、暗月、落星尘 | `on` / `off`，默认 `on`；关闭图案、纸张、头像或轨道循环，保留各款入场和正常移动。系统开启「减弱动态效果」仍优先 |

颜色与持续动画直接更新现有消息，不重建信息流；切换样式时按目标样式重设配色与动态。不支持对应能力的样式拒绝该字段，缺省记录无需迁移。

内置样式的默认正文字号来自 `DANMAKU_STYLE_OPTIONS`，其他文字字号由 `shared/danmaku-text-options.js` 按款、按用途定义：以实际消息中原 CSS 字号为基准，取一位小数作为明确的 px 默认值。所有字号独立解析并应用；正文调整不再隐式改变已独立设置的事件字样。字体与颜色未覆盖时仍由各款 CSS 决定，已保存的 `fontSize` 不迁移。默认区域、设计宽度与 `contentScale` 保持不变，长文仍由公共信息流适配。暗夜霓光横排聊天把正文排到全宽第二行，SC 使用全宽正文与金额行；隐藏头像或没有舰徽时回收对应列。天穹保留 80px 条带，不保证单行文字自然宽度不变。

「文字样式」将正文与每款实际节点的昵称、身份与粉丝牌、金额、时间与账号信息、事件说明/标题、装饰小字、礼物名称与数量等用途放在同一张表格中，以字体、字号、颜色三列对齐，不再逐用途折叠；窄侧栏改为每种用途一行的紧凑字段组合。推文动态另有顶部房主昵称、顶部账号与标签及底部提示文字，万圣幽灵另有外框标题。字体使用字体库的纯名称，颜色直接显示可编辑色块；同用途内有不同字体或颜色时，保留各自的短标签和控件，当前值相同的子项合并编辑。字号按本款消息布局分成独立或联动的小组，不固定为一个滑条。先锋票根标题分为礼物票据、会员卡、醒目留言三组，SC 的描边与实体联动；事件说明分为会员信息与系统提示；票面小字与 SC 注记分开。星河漫旅的 SC 标题与角标联动，推文动态的上舰说明与陪伴天数联动、导航标签保持独立。圣诞来信的身份与灯牌按原字号比例共用滑条，只有同时带大航海与灯牌的标签使用较大默认字号；万圣幽灵的送礼动作与上舰/SC 通知分别调节，后者包含同段金额。不把图片里的字样当成文字控件。`DANMAKU_TEXT_TARGETS` 维护逐款节点映射，`DANMAKU_TEXT_GROUPS` 维护通用用途名称，`TEXT_ROLE_LABELS` 将在线榜单、上舰陪伴、含金额的事件标题等按本款用途标明，并通过字段 `textRoleLabel` 同步行标题及无障碍标签；`TEXT_SIZE_CLUSTERS` 按款声明联动关系。未列入联动的细分用途保留独立控件，`danmakuTextSizeFields(style)` 提供解析后的字段与选择器。

每组接受 `styleOptions.<style>.<role>FontFamily`、`<role>FontSize` 和 `<role>Color`；细分字号仍用 `<role><Variant>FontSize` 保存，例如 `amountSuperchatFontSize`、`titleTicketFontSize`。`linkedSizeKey` 指向该细分项的联动主控件，只有被联动项隐藏；`legacySizeKey` 仅保留旧整组字号的缺省继承。字体沿用已有字体库与校验，颜色接受六/八位 HEX；内部 `default` 仍表示没有覆盖，但界面始终解析实际字体和颜色，不提供「原样式/自定义」切换。非正文字号接受最多两位小数，通常范围为 8–96 px；原设计低于 8 px 的装饰小字按默认值向下取整确定下限。有效范围兼容已保存的旧范围，并容纳所属联动主控件按默认比例换算的上下限，控件显示各自实际范围。字段缺省时解析为本款数值，滑条没有「原样式」档位。已有字号保持有效；编辑某个控件时，仅按 `新主字号 × 被联动项默认字号 / 主控件默认字号` 重算该小组，取两位小数，重复调整不会积累比例误差。编辑旧整组字段前固化其他小组当前继承值，避免礼物票据的变化连带影响会员卡或 SC。按款恢复默认会清除该款覆盖并显示对应数值，不迁移旧数据。

字体与颜色的子目标由 `shared/danmaku-text-appearance.js` 声明，保存为可选的 `<role>Part<N>FontFamily` / `<role>Part<N>Color`，正文多色使用 `bodyPart<N>Color`。旧整组字体和颜色仍先应用，子字段仅在显式编辑后覆盖对应节点；不迁移已有记录。`appearanceParent` 关联原字段，`appearanceSelector` 限定子目标，`appearanceTarget` 提供正文目标，`appearanceWhen` 限定配色模式。晶透胶囊的五种昵称色与身份色按当前模式展示和应用；点点流萤与星河漫旅的正文多色也保留独立层次。先锋票根的 SC 描边使用 `colorProperty: 'stroke'`，不会把空心字填实。同用途、同实际字体或颜色的子项共用一个控件，修改时写入各自字段；描边与实心色始终独立。

`overlays/danmaku-appearance-values.js` 通过真实渲染器、合成身份/礼物/SC 消息和样式 CSS 读取当前值，覆盖主题、昵称色系与金额档位。它在每个文档中共享一个离屏测量环境：桌面与画布使用 iframe，处于不透明源（`Origin: null`）的独立预览使用当前页面内的私有 Shadow DOM，保持原有 CSP sandbox。测量只复制弹幕 HTML 的静态外框及 Twitter 区域，不执行页面脚本、不连接消息订阅或读取真实房主资料；最后一个面板销毁时释放。B 站随消息传入的灯牌色仍保留原行为，未覆盖时色块显示合成预览中的颜色。字体名称通过 `shared/font-library.js` 的 `namesOnly` 模式和字体栈解析对应到共享/系统字体库，资源未就绪状态放在提示信息中。

客户端与画布的字号设置使用带边界的滑条区域，显示小组名称、具体字号和可调范围；拖动中更新读数，松开后提交。文字用途、字体与颜色使用紧凑列宽，字号占据剩余宽度，同一用途内的小组按可用宽度排列，不新增折叠项。画布沿用组件缩放换算，最终显示仍受既有排版与整体缩放影响。`overlays/danmaku-text-application.js` 通过每个文档内唯一的样式表更新已有及后续消息，细分选择器仅覆盖对应节点，不增加消息订阅、观察器或请求；切换和恢复默认会替换旧规则。

`shared/danmaku-parameter-controls.js` 根据这些定义构造并绑定控件，`css/components/danmaku-parameter-controls.css` 统一功能区、文字表格、配色网格与窄侧栏布局；桌面和画布通过 `admin/danmaku-parameter-view.js` 接入，独立预览通过 `overlays/danmaku-preview-appearance.js` 接入，仅适配字体来源、画布字号换算和保存上下文。共享效果 UI 由 `shared/component-style-parameter-view.js` 负责，管理页原入口保留重导出；`shared/component-parameter-fields.js` 统一处理编辑中防回填与订阅释放。`shared/danmaku-appearance-draft.js` 只负责值转换及当前样式的不可变更新/重置。

新增样式复用现有字段时只声明能力、默认值和限制；新增参数先在所属字段定义中登记，再由样式渲染模块实现视觉行为，使用现有编辑和保存通道，不再逐入口增加标记、监听或校验分支。弹幕字段定义的本机 Node 镜像由 `node scripts/sync-danmaku-style-options.cjs --write` 从浏览器约定、`danmaku-text-options.js` 及 `danmaku-text-appearance.js` 生成；默认 `--check` 和契约测试检查完整镜像一致性，无需手动维护第二份字段。参数保存与渲染以本机外观和场景为准，新增样式或参数不要求同步旧服务端样式。修改配置时更新本机相关使用方与测试。

区域随机样式的停留时长字段 `styleOptions[style].durationSeconds` 见[随机与飘窗的动效参数归属](#随机与飘窗的动效参数归属)；恢复默认时在必要情况下显式保存当前款默认值以覆盖旧共用 `fullscreenDurationSeconds`，不改变其他款。独立预览的 `history` 同时保留基础参数、外观效果及旧时长；同款多个内置组件仍共享外观，不同款独立，组件位置/尺寸独立。

预览参数传递与草稿保留方式如上，样式切换不清除其他样式的区域或参数。原图模式使用内置的对应 B 站 WebP/PNG 礼物图片（大航海示例复用已有 WebP 图标），不请求直播或外部图片。服务器从已有礼物目录按已结算 `giftVariantId` 精确取得 B 站图片地址，经可选 `giftImageUrl` 随原 `gift` 事件传递。Electron 仍只使用既有共享订阅；`scene-runtime.js` 在独立弹幕和组合场景输出中，通过目录的 `imageResources.resolveSource(source)` 将已接受礼物事件的准确 URL 映射成 `/overtime-gift-images/<basename>`，不按名称或 ID 猜图，不等待图片下载。只有实际显示图片的浏览器 GET 才触发缺图准备，复用目录磁盘缓存与下载队列；该链路不增加逐条礼物 API 查询。资源模块、失败冷却和离线行为见[礼物缓存](../backend/overtime.md#15-服务器全局礼物目录联动)，图片交付见[本地 API](../backend/api.md#共享礼物图片)。

前端图片入口为 `shared/gift-image.js`：`resolveGiftImageSource(value, guardLevel)` 校验来源或按购买等级取本地舰徽；`bindGiftImage(image, source)` 供通用弹幕渲染器、礼物横幅和通知保留各自的 load/error 装饰；`setGiftArtwork(image, source, { format, mimeType, guardLevel })` 供磨砂通知、沉笺、礼物动效，以及全部许愿样式、礼物选择器、加时规则和文本框礼物图位选择原图或静态帧；`setGiftArtworkFallbacks(root)` 为最近礼物和盲盒列表现有图片绑定同一显示入口。显示接口接收调用方已校验的来源，不负责查询目录或发起礼物 API 请求。`gift-image-fallback.js` / `gift-static-image.js` 仅作为共享入口内部实现，业务模块不直接调用。横幅目录图位和通知均接受缓存支持的 WebP、PNG、JPEG、GIF，不再只认 WebP；横幅仍只接受本地目录缓存路径。静态转换合并同一文档内相同来源与格式的任务，完成结果最多保留 64 项、16 MiB 字符串估算容量；失败保留 30 秒冷却，后续使用可重试。绘制首帧后释放原动图来源；延迟完成的任务不能覆盖节点较新的图片。大航海不经 Canvas，按 `giftGuardLevel` 使用本地舰徽，保留房间千舰状态切换；只显示等级标记的样式继续复用专职 `bilibili-guard-icons.js`，不获取礼物原图。图片失败仍按各样式原有空图、主题或占位规则处理，名称、数量和金额始终先显示。

琉璃、杏花白、融影名片、留白、一纸素笺、推文动态和星轨飞语固定显示礼物原图，缺图或失败时图位留空，不回退礼章或星星；其旧 `giftImage` 配置仍接受，但显示统一解析为 `gift`，参数区不再提供插画切换。夜航讯号、经典气泡和月渡花汀可切换样式插画/真实图片，失败保留各自插画。磨砂通知和沉笺同样固定使用真实图片，普通礼物经共享静态首帧转换，大航海直接使用本地对应等级舰徽；其余款保持各自的文字、插画或专用大航海卡片，不额外获取礼物原图。缺少 `giftImageUrl` 时仍保留礼物通知。云端事件协议和保留的服务器设置格式见服务端 `public-overlay-api.md` / OpenAPI `OverlayStyleOptions`。

页面与 `/games` 的画猜消息共同复用 `danmaku-feed.js` DOM 组件。组件不读取 WebSocket 或领域状态，只接收显式消息数组和图片 URL resolver：

消息资格由 `danmaku-message-renderer.js` 提供同步过滤谓词：Harbor 复用自身的礼物金额判定，SC 能力由 `shared/danmaku-style-options.js` 的 `supportsDanmakuSuperchat` 统一提供，预览样本、场景事件入口与通用渲染器共用；Stardust 预览与真实输出均包含 SC，沉笺和其他样式保留各自的布局规则。信息流的快照与增量入口在创建 DOM、裁剪容量之前调用同一谓词。需要按字号重排的 `prismatic`/`snowfox` SC 与大航海卡片由既有渲染分支标记 `data-danmaku-fit="font-size"`，Stardust 渲染器用 `data-danmaku-anchor` 提供上下锚点。信息流读取这些标记，继续负责实际测量、字号二分、zoom、位置分配、动画、定时与销毁。渲染器仍返回 DOM 节点；ADR-0020 的公共核心源码快照与摘要保持不变。

客户端内置固定样式分别维护入场与列表移动参数，公共信息流继续负责测量、同批移动、打断续接及清理。12 款使用仅作用于新增消息的整条入场，雪狐复用已有内部编排，月渡花汀保持既有动效；快照不重播新增的整条入场。逐款设计、CSS 接口、作者提示词和实际播放验收统一见[固定弹幕动效](danmaku-motion.md)。

- 随机样式共用[停留与退场参数](#随机与飘窗的动效参数归属)，默认渐隐并允许选择直接消失；渐隐时长按款保存且包含在总停留时间内。开启「减弱动态效果」或不支持原生动画时按期直接清理；移除、重绘和销毁时取消淡出动画及计时器。
- `measureDanmakuText(message)` 按中英文混合文本的视觉长度估算行数、宽度百分比和最小高度。
- 留白风格在头像下沿居中显示 `LV{medalLevel}`，复用消息渲染器从本条消息的独立 `medalLevel` 写入头像数据属性；缺少灯牌名称不影响已知等级。缺失、零或非法等级不显示，不从舰队身份推算，也不复用上一条消息的等级。该风格不再在正文下重复显示粉丝牌；其他风格沿用原徽章。
- `kind:'gift'` 礼物卡片：
  - 使用专用 `is-gift` 节点，以 `textContent` 展示送礼人、「送出」、礼物名称和数量；登录账号发送的感谢按普通弹幕渲染，不转换成礼物卡、不额外生成感谢文案。除保持原样的蝶恋花外，采用紧凑两行结构（昵称在上，「送出＋礼物名」和数量在下，不显示「谢谢支持」），入场时额外播放一次 ≤360ms 的 `::after` 光泽扫过（开启「减弱动态效果」时不播放）。
  - 各款造型：琉璃为奶油色礼物原图卡（昵称首字圆章、莓红数量胶囊）；夜航讯号为带 1px 青色切角描边的墨蓝通知牌；经典气泡为与 SC 同款的彩色头像昵称标题栏和浅色礼物内容卡（与普通弹幕共用 10px 列表间距）；留白为带细金边的深蓝卡与真实礼物图；融影名片为左侧 60px 方形真实礼物图、无头像的单栏双线框纪念卡；一纸素笺为带虚线分隔的玫瑰色礼物小票；杏花白为奶油色礼物原图卡；流光溢彩为同色高光弧的紧凑通知卡。
  - 选择「礼物原图」且加载成功时，插画节点加 `has-image` 并清除样式插画的 mask 和背景；加载失败恢复样式插画（琉璃、杏花白、融影名片、留白和一纸素笺的图位留空）。`gifts.css` 仅复用内容结构，各风格文件维护配色、轮廓和装饰；样式插画内置于 `public/img/overlays/danmaku-gifts/`，预览真实礼物 WebP 位于 `public/img/overlays/danmaku-previews/gifts/`。
- 本地预览使用场景编辑器，按可用视口等比缩放。消息在当前样式的区域内动态展示；固定样式按区域高度移除最旧的超限消息，随机样式沿用正式直播的随机布局和寿命。样式切换重新播放，地址不变。
- 留白和杏花白礼物卡通过 `showGiftTotal` 选项把数量放在礼物名旁边，原数量位置显示 `giftTotalPrice`（人民币元）的 `¥` 金额（最多两位小数，缺失显示 `—`）；杏花白沿用右侧粉色金额框，名称旁的数量不带底框。本地预览使用合成总额，正式叠加层读取服务器同名展示字段。
- 旧非画布布局的固定礼物卡中，`bubble` / `signal` / `ranked` / `transparent` / `identity` 沿用原客户端 1.5 倍尺寸上限（460px 设计宽度 → 690px 显示宽度）。扣除两侧各 12px 后的空间不足时，卡片、昵称、礼物文字、数量或金额、头像、装饰和间距一起等比缩小；高度通常影响可见条数，单条过高时再整体缩小。经典气泡和融影名片抵消列表已有倍率，避免重复缩放。列表裁剪计入节点自身的 CSS zoom；蝶恋花、普通弹幕及全屏随机礼物同样在单条超出可用区域时整体缩小。画布布局使用上面的区域整体缩放规则，本地预览与正式叠加层同步。
- `createDanmakuFeed(root, options)` 渲染与裁剪：
  - `render(items)` 使用 `DocumentFragment`、`textContent` 和受控 `<img>` 创建消息，`append(item)` 只追加新节点不重建已有 DOM；表情按精确触发文本切分，加载失败回退原触发文本，不使用 `innerHTML`。
  - 游戏层按估算高度保留当前可见区及上方约 5 个视口并自动滚到底部；固定 `/danmaku` 配置 `offscreenViewports: 0`，按实际布局高度、行间距和容器内边距移除最旧的超限节点，保留完整可见消息。页面数据和断线恢复快照硬限制为最近 50 条，共享组件默认上限为 120 条。
  - 固定区域和全屏模式的 `ResizeObserver` 同时观察容器与消息，图片加载、昵称换行或窗口缩放后在动画帧内合并测量与调整，使用不受入场动画缩放影响的布局尺寸；节点移除/替换时取消观察，销毁时取消布局帧和到期计时器。
- 流光溢彩（`glow`）将发送者昵称居中放在消息框上方，文字或表情在深色半透明圆角框内，边框带双层柔光，并在 2px 边框上叠一段静态白色高光弧（按 `data-tone` 取四个角度，不循环播放；不支持 mask 合成的内核省略高光弧），不显示头像/徽章。`ranked-palette.css` 为它和经典气泡提供同一份身份色，普通观众/粉丝青蓝、舰长蓝、提督紫、总督红、主播绿色覆盖优先。本地预览与正式直播共用随机布局与时长，礼物采用同色紧凑双行通知卡。
- `starveil`（点点流萤）复用流光溢彩的区域随机布局、防重叠和停留时长；昵称居中置于深色半透明胶囊上方，文字、细描边与柔光从香槟金、雾玫瑰、冰蓝、淡紫、青瓷、暖桃六组颜色中按消息种子稳定随机选择，不随身份或重新排版变色。正文/表情与真实礼物名称、数量完整显示，不显示头像、徽章和 SC。支持字体、字号、正文颜色、背景透明度、中心倾向和离散程度。
- 经典气泡（`ranked`）通过独立 `data-streamer` 标记将主播名字标签和正文气泡设为绿色，并隐藏主播船锚；普通观众保持青蓝色。可选 `isStreamer` 只由当前房间主播 UID 与本条发送 UID 比较产生，缺失按 `false`；本地 B 站消息入口、信息流投影和服务器 SSE 均保留该展示语义，不公开新增 UID，也不改变其他风格的 `data-identity`。本地纯表情示例同时展示主播身份。
- `data-identity` 语义与旧款视觉分化：共享组件按当前房间身份输出 `data-identity=viewer|fan|captain|admiral|governor`（大航海优先，同时佩戴当前房间灯牌时输出两枚徽标），各款固定/随机样式独立实现视觉：`signal` 用分级信号色、左侧强调色晕染、实色大航海签与「名称｜等级」分段灯牌；`bubble` 用 20/20/20/6 圆角午夜玻璃气泡、头像双圈、灯牌胶囊与柔和光晕；`minimal` 省略左侧色条与普通观众签，粉丝/大航海用单字签与低遮挡分级色；`ranked` 按 `roomGuardLevel` 显示大航海身份色与船锚，按 `roomMedal` 显示粉丝牌等级，模拟预览由样例生成器提供同样的本房字段；`transparent` 无卡片底色或边框，保留头像右侧昵称/正文/下方灯牌等级并用蓝/紫/红昵称区分大航海；`outline` 隐藏头像与徽章，采用浅白半透明 18px 圆角卡与身份色圆点。昵称字号由各款设定（琉璃、夜航讯号、经典气泡普通弹幕为 30px），徽章与等级不小于 12px，数量/金额/等级使用 `--danmaku-num-font` 等宽数字；旧内核不支持 `color-mix` 时通过 RGB 通道变量或 `@supports not` 回退底色。
- `ranked` 使用 624×640 固定设计画布、最大 600px 卡片宽度和 10px 卡片间距，卡片随正文增高；`calculateRankedOverlayScale(width, height)` 取 `min(1, width / 624, height / 640)` 并映射至 `--ranked-scale`，让窗口 resize 时头像、文字和卡片统一等比缩放。浏览器源比例与设计画布不一致时在未占满的一轴保留透明空白，不拉伸或单独重排内部元素。
- `/danmaku` 的观众头像由浏览器直接读取弹幕中携带的 HTTPS B 站 CDN 地址，保留域名白名单且拒绝带账号密码的 URL；头像和模糊底图共享同一地址，使用 `no-referrer` 并异步解码头像，不逐条查询用户资料或让服务器转发头像。图片缺失或失败沿用各样式的默认展示。表情继续使用 `/api/bilibili/avatar` 本地代理；未通过 B 站域名白名单的图片不会进入服务端公开流。
- 固定区域样式的网格行占满可用高度，使消息容器的裁剪预算来自浏览器源视口而非当前堆叠高度（少量消息仍靠底排列）；越界旧消息配合上文「边缘处理」的渐隐遮罩平滑离开，完全移出后清理。
- 各样式的图片表情受正文宽度约束，行内图片不使用负纵向边距，昵称与粉丝牌必要时分行。琉璃保留 12px 消息间距，不绘制底部尾角；直播气泡设计画布内的消息间距为 10px。融影名片（`identity`）的普通观众与粉丝将本条头像放大模糊后铺底，保留头像深浅与色彩分布、白字加细暗描边；右侧固定预留 144px 头像列，清晰头像与卡片等高、最大宽度 144px 且左侧 30% 渐隐，绝对定位不撑高卡片；缺失或失败时两层均用默认插画，舰长/提督/总督使用蓝/紫/红底色，礼物数量紧跟名称、右侧显示 `giftTotalPrice` 已结算总额（卡片宽 600px、最小高度 92px、间距 6px；此处描述客户端本地样式，旧版服务器来源保留其兼容样式）。杏花白的普通头像及头像列均为 55.2px、与圆尾留 12px 净间距，礼物隐藏头像；流光溢彩的普通昵称 26px、礼物昵称 19.5px；一纸素笺和杏花白的昵称在卡片边框内、正文间隔 6px，消息距视口边缘至少 16px、消息间距至少 10px。
- 夜航讯号的粉丝牌等级跟随昵称信息行排版，不再绝对定位到卡片底边；粉丝牌名称在旧布局允许收缩并显示省略号，画布布局则换行完整显示，等级不会挤到正文或边框上。
- 蝶恋花样式的昵称向下偏移 6px，居中占正文区域宽度的 70%，长昵称保持 20px 字号自动换行，连续英文也可在字符间折行。行内表情不使用负纵向边距，图片占用完整行高，避免最后一条消息的表情底部超出消息容器并被裁切。

### 玻璃气泡区域随机弹幕

`glass-bubble`（玻璃气泡）以 [pabo 的公开演示](https://www.youtube.com/watch?v=f_qGJE_PTpU)为基础收敛配色并优化亮背景可读性，位于「组件 → 弹幕姬 → 全部样式 → 区域随机」。`danmaku-glass-bubble.js` 组合安全文本、表情、昵称与金额；`danmaku/glass-bubble.css` 实现烟灰玻璃填色、方向性银色高光、深色昵称牌、柔化居中尾尖、分层展开和 SC 扫光。不显示头像、徽章或礼物图片，素材不含原片背景、人物或可选 GIF。

默认区域铺满画布，正文 27px（18–48px），昵称 23px；默认 [M PLUS Rounded 1c ExtraBold](../../../public/fonts/glass-bubble/README.md)（通过共享资源交付，保留 `Lira Rounded Mplus` 族名与 `/fonts/` 路径，中文字形按本机回退链补齐）。普通消息默认停留 5 秒，礼物/上舰/SC 在当前停留值上增加 3 秒（默认 8 秒），能力表的 `eventDurationExtraMs` 由同一到期调度逻辑读取，不另建计时器。

底板在 380ms 内从中心横向展开，昵称在 140ms 后用 220ms 渐显，正文在 300ms 后按完整字素逐字渐显（每字 180ms、默认步进上限 26ms；普通消息步进总长上限 420ms，礼物/上舰/SC 上限 1400ms）。只有材质缩放，文字不缩放或逐字模糊；SC 在 300ms 后播放一次 950ms 柔和扫光。彩边与金额使用柔和色系：礼物黄绿、大航海绿色，SC 按实际人民币数值分七档（<200 蓝、200 青、500 绿、1000 黄、2000 橙、5000 洋红、10000 红，不做汇率换算）。正文与上舰文案跟随所选文字颜色，零金额显示 `¥0`。

「高级参数 → 玻璃与显字」的字段由共享参数约定定义：显字方式和间隔在创建消息时锁定（仅影响后续消息，整句显示仍保留玻璃展开）；扫光开关和高光直接更新现有节点。

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `glassBubbleReveal` | `typing`（默认）/`instant` | 逐字显现/整句显示 |
| `glassBubbleTypingSpeed` | 10–60ms，默认 26 | 每字显现间隔，越小越快；整句显示时控件停用、保存值保留 |
| `glassBubbleSweep` | `on`（默认）/`off` | SC 的一次扫光 |
| `glassBubbleHighlight` | 0–100%，默认 100 | 银边与表面高光强度，文字及金额不变淡 |

支持字体、字号、正文色、背景不透明度（仅改玻璃填色）和公共随机/退场参数；公共外观能力为 `panel`，底板效果映射到 `.glass-bubble-surface`，文字描边覆盖昵称、正文及金额。当前桌面内核使用 CSS `shape()` 连续绘制轮廓与尾尖，不支持该语法的浏览器源回退圆角框。

### 落星尘区域随机弹幕

星形装饰同时声明 `-webkit-mask` 与标准 `mask`（避免 Chromium 106 将星形显示为实色矩形）。`stardust`（落星尘）以[兔宝的神奇口袋的公开演示](https://www.bilibili.com/video/BV1rJhC6TEiA/)为视觉参考，由 `danmaku-stardust.js` 组合安全消息 DOM、`danmaku/stardust.css` 绘制星芒、轨道和细线，不携带原视频位图素材。

布局为 `fullscreen-random`，默认铺满 1920×1080 画布。透明画面中正文居中、昵称在下、星芒在上，不显示头像或卡片底板。正文默认 28px（18–48px）、默认衬线字体 SimSun/宋体，礼物/上舰/SC 正文比所选字号大 2px，昵称固定 21px 无衬线；正文色默认 `#f2f5f7`，支持字体、正文色与共享随机分布参数。公共效果能力表登记为 `text`，外投影、外发光和文字描边覆盖正文、昵称及 `.stardust-event` 标签（装饰图形不接收文字描边）；`styleParameters.stardust` 包含机器人欢迎弹幕显示开关。

普通礼物显示「星光礼物」、礼物名与数量；SC 显示「醒目留言」、实际 `price` 与完整原文；有效 `giftGuardLevel` 生成「星海相伴」与对应大航海感谢。SC 与上舰增加倾斜轨道和两侧细光线，上舰另有下方星芒。

「高级参数 → 落星尘 · 画面与互动」保存于 `styleOptions.stardust`，本机 Node 与浏览器共用校验：

| 字段 | 用途 | 默认值/约束 |
| --- | --- | --- |
| `stardustEntrance` | 汇聚与点亮 | `on`；可选 `on` / `off`，关闭后直接显示 |
| `stardustKeepCenter` | 为主播留白 | `on`；可选 `on` / `off`，普通消息避开中央，窄区域按可用空间排布 |
| `stardustNicknames` | 观众昵称 | `show`；可选 `show` / `hide` |
| `stardustGiftThreshold` | 大额礼物门槛 | 0.01 元；范围 0.01–1,000,000 元，步长 0.01；已知单条结算总额达到门槛时居顶，未知金额仍散落 |
| `stardustSwapAnchors` | 礼物与上舰上下对调 | `off`；可选 `off` / `on`，默认合格礼物居顶、上舰居底，开启后对调 |

入场时正文从上、昵称从下清晰汇聚（无模糊滤镜），约 650ms 后点亮星芒与事件标签，完整入场约 1.4 秒；点亮结束后事件标签保持 0.93、上舰尾星保持 0.7 不透明度。`stardustEntrance` 独立控制入场，`ambientMotion` 仅控制星芒闪烁和轨道循环；新消息锁定入场、锚点与到期参数，昵称和持续动画可原位更新。

### 雪狐童话固定弹幕

`snowfox`（雪狐童话）使用狐耳圆头像、姓名色条与浅色圆角气泡；SC、礼物、上舰分别采用雪屋留言牌、礼盒横条和「NEW MEMBER」卡。默认普通观众蓝色、当前房间粉丝浅粉色、舰长绿色、提督紫色、总督粉色。SC 头部随昵称换行增高，金额空间不足时另起一行，正文始终位于头部下方；礼物金额缺失时省略占位。图形与主题由 `danmaku-snowfox.js`、`danmaku/snowfox.css` 和 `img/overlays/danmaku-snowfox/` 负责，公共渲染器仍按 ADR-0020 从服务器同步。

默认区域 480×700，支持字体、18–48px 字号、正文色、滚动方向与边缘处理。专属字段 `styleOptions.snowfox.bubbleColor` 接受 `default` 或六/八位 HEX，自定义时联动普通弹幕文字、姓名条、边框、浅底及头像圈（不覆盖 SC、礼物和上舰颜色）；显式正文色仍可单独覆盖正文。详见[雪狐童话规格](../../../specs/danmaku-snowfox.md)，恢复默认与取值校验分别由 `test/danmaku/danmaku-panel-edit-state.test.js` 和 `test/danmaku/danmaku-style-options.test.js` 覆盖。

入场动画由雪狐 CSS 负责：普通消息展开气泡，SC 展开冰牌并轻摆挂饰，礼物弹出礼盒，上舰落下船锚（有限动画仅改内部图层裁剪、透明度和变换，礼物底板仅淡入）。SC 与礼物头像花边不裁切并与雪屋底部一起定位；礼物昵称和金额使用独立网格列，长文本换行。

### 垂丝挂链固定弹幕

`charm-thread` 在默认 480×700 的区域内纵向排列。`danmaku-charm-thread.js` 复用普通弹幕的文本和行内表情，绘制昵称、贴字气泡及外侧细链。按房间身份选图案时，普通观众用蝶扣，本房间粉丝牌用四芒星，本房间大航海用月牙，主播用莲花。礼物保留名称和数量。大航海显示动作与档位，数量大于 1 时在档位后显示份数，金额显示本次事件的总额。醒目留言保留金额与全文。

普通参数 `threadAlign` 取 `left`（默认）或 `right`，`threadCharm` 取 `role`（默认）、`butterfly`、`moon`、`lotus` 或 `star`。高级参数 `threadEntrance` 取 `layered`（默认）或 `none`，`threadEntranceMs` 范围 300–1200，默认 800。样式支持公共 `panel` 效果，目标为 `.thread-copy`。正文默认 24px（16–40px），气泡默认 `#29263e`、90% 不透明度。美术参考取自 [milaeshop 的聊天挂件展示](https://www.etsy.com/listing/1867423714/chat-widget-for-twitch-streamelements)。图案和入场动效由客户端绘制，时间见[固定弹幕动效表](danmaku-motion.md)。

### 星芒笺固定弹幕

`astral` 按 [GhostTypeStudios 的 Astral 公开演示](https://www.etsy.com/listing/1692766782/astral-chat-widget-customizable-colors)重建紫色细框、右侧内凹角、嵌边昵称、金色星芒及悬垂细线。`danmaku-astral.js` 组合四类消息构图，`danmaku/astral.css` 负责几何框、分层入场和星芒循环；字体复用已交付 Nunito，中文使用现有回退。

所有聊天保留内侧细线、圆点和悬星，短句也为完整装饰留出高度；底边身份牌只按 `isStreamer` 或本房间 `roomGuardLevel` 显示。礼物、购买大航海和 SC 使用紧凑提醒框，标题昵称统一跟随本款字体和基准字号；`astral-event-identity` 将昵称与动作合为可换行组，金额独立排列并在超窄区域允许整组换行。

默认区域 640×720（1920×1080 画布中位于 (40,320)）；基准字号 22px（12–48px），聊天正文为基准的 1.1 倍；正文色默认白色，边缘默认直接切断。支持字体、正文色、背景不透明度、上下滚动、持续动画。专属参数位于「高级参数 → 星芒笺」：`astralAccentColor`（六/八位 HEX，默认 `#f7e68b`）、`astralEntrance`（`layered` 默认 / `none`）。公共高级效果能力为 `art`，旋转/透视复用 `component-style-parameters.js` 与 `effectTransform`。入场时序见[固定弹幕动效](danmaku-motion.md#星芒笺分层动效)。

### 暗月固定弹幕

`dark-moon`（暗月）按 [Dark Moon 2.0 公开预览](https://vgen.co/Melonturtle/product/dark-moon-chat-widget-streamelements-/b8274ca7-9240-410d-82af-45eb3c542acd)重建，`danmaku-dark-moon.js` 与 `danmaku/dark-moon.css` 使用内联 SVG/CSS 与现有 Nunito 字库绘制月相图标、分段竖线、暗色卡片、右衬线及底边星芒。

默认普通消息为紫灰细框，仅本房间 `roomGuardLevel`（1 总督/2 提督/3 舰长）使用金边和描边月环；主播可显示「主播」副信息，不因此获得大航海金边。礼物与上舰使用金色提醒条（渐变 `#ffe69f` 至 `#f8cc80`），SC 在提醒条显示昵称与两位小数金额、独立暗色正文区完整保留原文。

默认区域 480×700，正文 32px（18–40px）、默认色 `#c9c0dc`、Nunito 500、行高 1.25、字距 `.04em`；支持字体、正文色、背景不透明度、上下滚动、边缘处理（默认直接切断）及持续动画（关闭后停止星芒、星点和轨道浮动）。礼物/上舰提醒文字按所选字号 `.88` 倍排版、提醒昵称字重 700；普通昵称与装饰保持本款尺寸。共享高级效果能力为 `art`，文字描边覆盖昵称、正文、身份、事件和金额（不开放面板内阴影/内发光）。

「高级参数 → 月环与星芒」直接更新现有装饰，不改变身份或正文颜色：

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `darkMoonPalette` | `original`（默认）/`moonlight`/`ice` | 原作紫金/月白银紫/冰蓝星夜，联动月环、边线和事件装饰 |
| `darkMoonRingSize` | 70–140%，默认 100 | 月环装饰的相对大小，不缩放文字 |
| `darkMoonSparks` | `show`（默认）/`hide` | 边角星芒显隐，与持续动画开关独立 |

### 银环线框固定弹幕

`wireframe`（银环线框）按[兔宝的神奇口袋的公开演示](https://www.bilibili.com/video/BV1Uw8v6XENM/)重建布局与分层入场，`danmaku-wireframe.js` 与 `danmaku/wireframe.css` 使用 CSS/内联 SVG 绘制圈线、罗马档位与共用舰徽。默认西文 Times New Roman，中文使用共享 CDN 字库补齐的完整思源宋体（声明 `Lira Wireframe Serif` 并复用 `/fonts/sea-breeze/sea-breeze-serif.woff2`）。正文 24px（18–48px）、默认区域 480×700；支持公共字体、正文色、底色不透明度（仅改底色）、滚动方向及边缘处理（默认直接切断）。

普通消息按内容宽度显示，头像位于框外，横线和黑底向右渐隐；本房间 `roomGuardLevel` 1/2/3 分别使用总督厚双框与对角星、提督双细框与刻度、舰长圈线，昵称旁显示舰徽与 I/II/III（不把档位当作灯牌等级）。礼物与 SC 占满可用宽度、采用通栏金额栏和独立正文（0 显示 `CN¥0.0`），窄区域中头部可换行、金额自动收紧字号。上舰按 `giftGuardLevel` 显示居中头像、侧线、昵称、舰徽及「已入列」（实际动作与数量保留在无障碍名称中）。聊天与礼物/SC 约 700ms 入场、上舰约 1100ms，详见[固定弹幕动效](danmaku-motion.md#银环线框参考与分层动效)。

「高级参数 → 圈线与描框」控制原生框线、圈线与入场（入场方式与时长在创建消息时锁定，时长按与 700ms 比例缩放各层）：

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `wireframeFadeLength` | 0–100%，默认 100 | 普通消息框右侧渐隐所占宽度；0 保留完整框线，大航海多层框不受影响 |
| `wireframeOrbit` | `show`（默认）/`hide` | 头像外圈显隐，保留头像 |
| `wireframeEntrance` | `traced`（默认）/`none` | 圈线与描框入场/直接显示 |
| `wireframeEntranceMs` | 350–1400ms，默认 700 | 普通消息入场时长；直接显示时控件停用、保存值保留 |

### 圣诞来信固定弹幕

`christmas-letter` 为奶油纸张、糖果色昵称牌与原创圣诞角色插画固定样式（区别于红金配色的 `christmas` 圣诞华灯），由 `danmaku-christmas-letter.js`、`danmaku/christmas-letter.css` 与 `public/img/overlays/danmaku-christmas-letter/` 下的八张原创角色 WebP、三张静裁角色/船只背景实现（复用 Nunito 字体，背景来源见同目录 `guard-scenes-sources.json`）。

默认区域 480×700，正文 28px（18–40px）、默认色 `#725244`；支持字体、正文颜色、背景透明度（仅作用于纸面）、滚动方向与边缘处理（默认直接切断）。正文、表情、普通礼物文案及大航海动作与金额均跟随正文字号；聊天/SC 昵称、SC 金额、徽标和角色贴图保持基准尺寸。有效正整数 `roomMedal.level` 与本房间身份合并显示为「粉丝团 N」「舰长 N」「提督 N」「总督 N」（灯牌名保留在提示中，缺失等级时仅显示已知身份，不把档位 1/2/3 当作数值等级）。购买大航海以对应角色船只背景展示（左文右角色）；SC 走 `danmaku-superchat-renderer.js` 显示金色「SC · 醒目留言」标题、大号实际金额与通栏留言。普通入场约 720ms、重要事件 1460ms，详见[固定弹幕动效](danmaku-motion.md#圣诞来信分层动效)。

### 圣诞华灯固定弹幕

`christmas` 由 `danmaku-christmas.js` 与本地 SVG 装饰组合金边卡片：聊天与 SC 使用酒红底色，普通礼物使用松绿底色与淡金松针，大航海使用深蓝底色与罗盘/波纹暗纹；内联 SVG 圆角边框支持沿轮廓描金（聊天 1040ms、事件 1180ms，正文分别在 350ms/400ms 内显现）。普通聊天带侧边星饰与下缘蝴蝶结（54×30），礼物/上舰/SC 带花环（41×41）与彩灯，金额保留两位小数。

默认区域 480×700，正文 28px（18–40px），聊天/SC/礼物昵称约 23.34px、礼物金额约 18.67px、SC 金额 20px。礼物与大航海采用居中两行感谢文案（首行「谢谢＋昵称」，次行动作/名称/数量与小字金额；礼物名默认常规宋体、正文 92% 字号，动作约 16.33px、数量约 18.67px）。列表内边距为上 8/右 8/下 14/左 36px，卡片间距 18px，系统消息使用更紧凑底板。「弹幕配色」调整聊天与 SC 酒红底色，「背景不透明度」仅改底板与暗纹，「持续动画」仅驱动最新一条侧饰轻摆或彩灯呼吸。分层入场见[固定弹幕动效](danmaku-motion.md#圣诞华灯分层动效)。

专属字段 `styleOptions.christmas.christmasBackground` 提供「卡片背景」：`card`（正常卡片，默认）与 `transparent`（仅文字与挂饰，隐藏底板/底纹/阴影/描金框）。底色渐变经 `color-value.js` 的 sRGB 预乘 alpha 混色生成 RGB/RGBA（不依赖 `color-mix()`，已于 Chromium 106 验证两种模式）。

### 万圣幽灵固定弹幕

`spooky`（万圣幽灵）参考 Melonturtle 的 [Spooky Notes 公开预览](https://www.etsy.com/listing/1578936439/spooky-notes-chat-widget-cute-halloween)实现贴纸、错位纸片及消息区外框，由 `danmaku-spooky.js`、`danmaku/spooky.css` 与 `public/img/overlays/danmaku-spooky/` 维护（默认本地 Nunito 与荆南麦圆，公共渲染核心与来源哈希不变）。

默认区域 480×700（`danmaku-canvas.js` 内部设计宽度 530px）；字号 16–36px、默认 25px。专属选项 `spookyTheme` 接受 `default/autumn/graveyard/moonlight`（默认 `default`），`spookyFrame` 接受 `show/hide`（默认 `show`；外框为页面单份装饰节点，顶部预留 60px CHAT 标题区）。颜色覆盖 `spookyFrameColor`/`spookyMessageColor`/`spookyEventColor`/`spookyAccentColor` 接受 `default` 或 `#RRGGBB[AA]`，正文复用可选 `textColor`（显式设置时换主题保留）；`SPOOKY_THEME_COLORS` 提供初始色与默认正文色镜像约定。透明度 `spookyFrameOpacity`/`spookyMessageOpacity`/`spookyEventOpacity` 为 0–100 整数（默认 100），仅改变底板与背衬纸片 alpha。`resetSpookyColors` 仅清除五项颜色与三项 alpha 覆盖。

普通消息身份取 `roomGuardLevel ?? guardLevel`（显式 0 不借用他房等级，不重复显示「观众」），缺图使用便笺头像；SC 与礼物沿用当前便笺主题（不按金额档位改色）；进房/系统消息使用小型纸条（不自动开启进房显示）。装饰遮罩同时提供 `-webkit-mask` 与标准写法；不支持 `color-mix` 的旧内核由 `danmaku-spooky.js` 读取当前色板并按 sRGB 预乘 alpha 生成回退 RGBA。

### 推文动态固定弹幕

`twitter` 使用白色社交资料卡和帖子列表，默认区域 480×700（1920×1080 新画布位于 `{x:40,y:340}`）。支持字体、18–40px 字号（默认 27px）、正文色（默认 `#141414`）与上下滚动，边缘处理默认 `none`；白色外框保持不透明，礼物固定使用真实原图（隐藏插画切换）。

专属参数保存于 `styleOptions.twitter`，Node 与浏览器副本统一校验：

| 字段 | 用途 | 默认值/约束 |
| --- | --- | --- |
| `twitterHeader` | 房主资料与标签区 | `show`，仅接受 `show` / `hide` |
| `twitterComposer` | 底部提示栏 | `show`，仅接受 `show` / `hide`；隐藏保留自定义文案 |
| `twitterActions` | 每帖评论/转发/爱心/分享装饰行 | `show`，仅接受 `show` / `hide` |
| `twitterColor0` | 单次金额低于 50 元的礼物/SC 底色 | `#409afa` |
| `twitterColor50` | 50～99.99 元的礼物/SC 底色 | `#f9c844` |
| `twitterColor100` | 100～999.99 元的礼物/SC 底色 | `#f89260` |
| `twitterColor1000` | 至少 1000 元的礼物/SC 底色 | `#ef4260` |

四档颜色接受六/八位十六进制字符串（归一小写，八位支持透明度），位于「配色与外观 → 礼物与 SC 配色」，三个版式字段位于「消息与动效」；`applyStyleOptions` 写入 body data 属性与 `--twitter-event-color-<档位>` 立即生效，隐藏顶部/底栏/操作行时回收对应高度（192px/68px/帖子行高）。上舰身份色不受四档事件配色影响。

- **房主资料投影**：独立源复用 `GET /api/bilibili/room/profile` 仅读取本地当前配置房间（返回 `roomId/uid/name/avatarUrl`，同房间在途请求合并与成功缓存，失败或房号不符冷却 30 秒）；预览使用合成房主。本机场景由 `scene-runtime` 装配 [scene-room-profile.js](../../../src/server/scene-room-profile.js) 投影 `data.danmaku.roomProfile`（经 B 站 `room_init` 校验短长号并输出标准长号），[scene-danmaku-display.js](../../../public/js/overlays/scene-danmaku-display.js) 直接使用该可信投影驱动房主头。异步读取前后核对账号与房间配置代次，运行时销毁释放缓存并忽略在途结果；无凭证子框架仅接收该投影，不发起受保护 HTTP 或持有令牌。
- **资料头、底栏与排版**：白卡从顶部 40px 起，116px 悬浮头像位于顶部 13px，资料行高 142px；房主名称 24px/30px 行高，次行 `@<实际 B 站 UID>` 18px/24px 行高，右侧 `Followed` 为静态装饰。消息昵称 24px、灰色身份/时间 18px（行高 32px，元信息灰 `#737373` 对比度约 4.74:1）。底栏默认「欢迎来到直播间 ✨」，可通过 `styleOptions.twitter.composerText` 自定义（单行 NFC 文本、上限 20 可见字符，经 `textContent` 渲染，留空恢复默认；超宽换行并至少保持 68px 高度）。
- **消息、事件与矢量动效**：元信息使用 `@Spectator`/`@Captain`/`@Admiral`/`@Governor` 与 `@Gift`（礼物/SC）；普通礼物与 SC 均采用按四档总额分色的通栏色块（缺图时不占空间、有图时图文居中）。购买大航海在独立白框内以三层渐淡实心阶梯箭头与圆章区分舰长蓝/提督紫/总督红，保留有效正整数陪伴天数。所有图标均为内联 SVG；`danmaku-twitter.js` 与 `danmaku/twitter.css` 负责结构与样式，分层入场与减弱动态效果见[固定弹幕动效](danmaku-motion.md#推文动态分层动效)。

### 花与信笺固定弹幕

`flower-letter` 按《花与信笺》复刻稿接入（署名与重绘来源见[素材说明](../../../public/img/overlays/danmaku-flower-letter/SOURCES.md)），由 `danmaku-flower-letter.js`、`danmaku/flower-letter.css` 与独立 SVG 实现纸面、邮戳、花叶和信封（纸面上下切片固定，中段随内容延展，花叶保持比例）。

普通观众为邮戳信笺，本房间粉丝牌为绿色花笺，舰长/提督/总督为蓝/紫/粉花笺；时间按本机时区显示小时/分钟。购买大航海使用对应上舰信封，普通礼物明确零金额使用邮戳短笺，头像缺失或失败显示昵称首字占位。默认区域 480×700（常规可见纸面宽约 600px，居中左右留 20px），正文 31px（18–40px）、默认 `Lira Yozai`（悠哉字体）；支持字体、字号、正文色、纸面不透明度、滚动方向与边缘处理（默认直接切断）。

### 折角便签与拼贴手账固定弹幕

`pastel-scrapbook`（拼贴手账）使用 616px 设计宽度和 480×608 默认区域。粉蓝底板的透明度独立于纸片。聊天保留正文和 B 站表情，昵称贴根据本房身份显示主播、舰队或粉丝图标。礼物、上舰、SC 和通知使用带图钉的纸张。[固定弹幕动效](danmaku-motion.md)记录各层入场顺序。

`notebook`（折角便签）默认区域 480×700，正文 29px（18–48px），边缘默认直接切断。聊天卡片按内容宽度收放（文字左右各留 10px 内边距，头像独立列居中镂空不覆盖真实头像）；礼物/上舰/SC 使用全宽（普通礼物感谢居中，上舰左对齐）。普通/舰长/提督/总督分别使用米白/蓝/紫/粉便笺，普通礼物使用薄荷抬头，SC 使用同款事件纸张承接；素材来源记录在 `public/img/overlays/danmaku-notebook/provenance.json`。

`danmaku/notebook.css` 负责分层入场、最新纸张浮动及头像独立摆动/缩放（旧纸张暂停时保留当前位置，旧头像继续动作），详见[固定弹幕动效](danmaku-motion.md#折角便签分层动效)。

### 虹边气泡固定弹幕

`animated-gradient` 按 [GhostTypeStudios 公开演示](https://www.etsy.com/listing/1365125747/animated-gradient-chat-widget)重建，默认区域 480×700，正文 25px（16–40px），默认向上滚动、边缘直接切断。`danmaku-animated-gradient.js` 与 `danmaku/animated-gradient.css` 组合错位渐变昵称牌、白色正文气泡、下方细线及事件双框；Montserrat 400/700 经共享 CDN 字库补齐（与天穹横栏 300 字重同包，中文回退系统字体）。

消息无自动到期时间，由公共信息流在滚出区域时淘汰；聊天入场约 1100ms、事件约 1650ms，详见[固定弹幕动效](danmaku-motion.md#虹边气泡动效)。事件条姓名/金额按正文 17/19、事件签按 13/19 缩放，聊天昵称牌保持基准尺寸，背景透明度仅改白底；高级效果映射到 `.gradient-panel`，文字描边包含事件标签和金额。

「高级参数 → 渐变与昵称牌」通过 CSS 更新已有节点（颜色循环按已过时间接续相位，关闭持续动画时暂停周期调节并保留值）：

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `gradientPalette` | `original`（默认）/`sunset`/`ocean`/`lavender` | 原作流彩/落日暖霞/海盐青蓝/薰衣草紫 |
| `gradientCycleSeconds` | 6–24 秒，默认 10 | 颜色往返流转周期，数值越大越慢 |
| `gradientUnderline` | `show`（默认）/`hide` | 底部细线显隐；保留原间距，切换不重播展开 |

### 磨砂通知固定弹幕

`glass` 按 [TurboJyapka Glass 公共演示](https://www.etsy.com/listing/4411923358/glass-twitch-chat-widget-pastel-kawaii)实现，默认区域 480×700，正文 33px（16–40px），新消息默认从顶部进入向下让位（`defaultScrollDirection: down`），边缘直接切断。普通消息无头像，昵称与角色标记在上、正文在下、时间在右上；礼物与大航海使用左侧静态图片、竖分隔线及两行内容；SC 保留金额线条图标、实际金额与完整正文。普通礼物经 `shared/gift-image.js` 转为静态 WebP（匿名 CORS、`no-referrer`，失败回退占位图），大航海直接使用 `bilibili-guard-icons.js` 内置静态 WebP（支持普通/千舰切换）。Quicksand 字体纳入共享软件字体库（族名 `Lira Quicksand`，见[字体说明](../../../public/fonts/glass/README.md)）。

`danmaku/glass.css` 实现透明淡蓝材质、30px 圆角、细白边与星点；背景颜色可调、背景不透明度 0–100%（默认 20%，不淡化文字）。glass、glowy、neon-glass 和 glass-bubble 仅在预览或带同页媒体装饰时使用 `backdrop-filter`（只采样本页内容）；标准透明浏览器源使用各款填充、边框与光泽。礼物/大航海/SC 正文按正文字号 12/11 排版，公共外观能力为 `panel`（映射到 `.glass-panel`），入场横移组合 `--component-transform` 保留用户旋转与倾斜。动效见[固定弹幕动效](danmaku-motion.md)。

「高级参数 → 磨砂通知」直接更新已有卡片（密度仅改留白与事件图标比例，关闭持续动画时隐藏星点并停用闪光强度）：

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `glassTime` | `show`（默认）/`hide` | 右上消息时间显隐 |
| `glassGlintIntensity` | 0–100%，默认 100 | 星点闪光强度，0 隐藏 |
| `glassDensity` | `comfortable`（默认）/`compact` | 舒展/紧凑卡片，默认保持原间距 |

### 暗夜霓光固定弹幕

`glowy` 参照 [milaeshop Glowy 公开演示](https://www.etsy.com/listing/4391673194/glowy-chat-widget-horizontal-and)，采用深色半透明玻璃、身份彩色侧光、方形头像和分层显现。默认区域 480×700，正文 25px（16–40px），默认向上排列、边缘直接切断。横排复用公共信息流的 `flowAxis`（每条逻辑宽 400px，拉宽区域增加容纳条数不放大字形，布局轴切换重建信息流）。

`danmaku-glowy.js` 组合安全文字与表情，横排聊天头像与舰徽分居两侧（隐藏或缺失时释放空间），SC 单独通栏正文，普通礼物用线条礼盒、SC 用留言图标。`danmaku/glowy.css` 负责 `.glowy-material` 底板与两侧灯光（未覆盖强调色时按主播/本房间大航海/礼物/SC 分色，文字描边覆盖昵称、正文、时间、身份与金额）。动效见[固定弹幕动效](danmaku-motion.md#暗夜霓光动效)。

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `glowyLayout` | `vertical`（默认）/`horizontal` | 竖排/横排，滚动方向同时决定消息进入的一端 |
| `glowyAvatar` / `glowyTime` | `show`（默认）/`hide` | 聊天头像/消息时间显隐 |
| `glowyLight` | 0–100%，默认 85 | 彩色侧光强度 |

### 轻语横栏消息流

`horizontal-charm` 参照 [Horizontal Charm 公开演示](https://www.etsy.com/listing/1656260287/horizontal-charm-chat-widget)，归入第四类「横向滚动」第二项。默认区域 1920×120（1920×1080 画布 X=0、Y=960）；正文 24px（12–36px）、默认色 `#51465f`，复用共享字库 Nunito 与荆南麦圆。身份色采用灰紫、玫瑰、暖金、梅紫与鼠尾草绿；事件以透明底图标和双行文字呈现，不请求头像或礼物图。

`danmaku/horizontal-charm.css` 负责气泡与分层入场；公共 `panel` 效果底板目标为聊天的 `.charm-content`，文字效果覆盖昵称、身份、正文与金额。`layout: horizontal` 配合 `fitWidth: false` 保留自然宽度，最多 15 条，长文按气泡最大宽度换行。动效见[固定弹幕动效](danmaku-motion.md#轻语横栏动效)。

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `charmGap` | 8–80px，默认 32 | 消息之间的距离 |
| `charmMaxWidth` | 240–1000px，默认 560 | 气泡/事件正文最大宽度，长文换行保留全文 |

### 咖啡手记固定弹幕

`coffee` 参照[小松绿 Viridis 直播间](https://live.bilibili.com/1727071052) 2026-11-08 视频画面，以透明底、手绘咖啡杯头像框、三缕蒸汽、楷体正文、昵称横线及消息时间组成（大航海与 SC 采用同系列延伸设计）。默认区域 400×640、正文 26px（18–48px），优先使用系统楷体并回退悠哉字体；不显示他房间粉丝牌。

礼物使用淡金双细框、角落星芒与右侧椭圆两位小数金额标签；大航海区分舰长浅蓝、提督淡紫、总督暖杏与船锚装饰（保留有效 `guardAccompanyDays`）；SC 使用暖粉细框与留言符号；事件标签替代聊天时间戳，统一保持透明底与咖啡杯头像。正文按可见字素逐字显现（完整文本先行排版避免反复改高，根入场时长随全文延长），具体时序见[固定弹幕动效](danmaku-motion.md#咖啡手记动效)。

### 晶透胶囊固定弹幕

`neon-glass` 按 [GhostTypeStudios 的 Neon Glass 公开演示](https://www.etsy.com/listing/1576998013/animated-neon-glass-chat-widget)重建银紫色透明胶囊、细窄上下沿高光、彩色昵称及白色提醒图标。默认区域 480×700（X=40、Y=340），胶囊保留自然宽度并受区域宽度约束。

昵称默认按姓名稳定分配原作五色（混入 35% 白色提亮），也可切换为本房间身份色或正文色；省去头像、礼物图和身份徽章。复用本地 `Spooky Nunito`（中文回退系统字体）；正文 24px（16–40px，字重 400），聊天昵称 24px/700，事件发送者 600，金额按正文 85%/600 排版。`danmaku/neon-glass.css` 在银紫渐变下叠加 76% 烟灰蓝承托以保证浅背景可读性，公共底板效果映射到 `.neon-glass-panel`。动效见[固定弹幕动效](danmaku-motion.md#晶透胶囊动效)。

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `neonGlassNameColors` | `original`（默认）/`identity`/`text` | 原作彩色/本房间身份/跟随正文 |
| `neonGlassHighlight` | 0–100%，默认 100 | 玻璃上下沿高光 |
| `neonGlassIcons` | `show`（默认）/`hide` | 提醒图标显隐 |
| `neonGlassEntrance` | `layered`（默认）/`none` | 玻璃与文字分层渐显/直接显示 |
| `neonGlassEntranceMs` | 200–1000ms，默认 480 | 分层入场时长 |

### 天穹横栏消息流

`celestial-horizontal` 参照 [Celestial Horizontal Chat 公开组件](https://meldstudio.co/gallery/celestial-horizontal-chat/)，归入第四类「横向滚动」。默认位于 1920×1080 画布底部 1920×80（X=0、Y=1000）；单行保留完整文本不缩小长文，装饰位于信息流外的单一兄弟节点（不参与消息测量，切换样式时移除）。

昵称使用 Cinzel 700、正文使用 Montserrat 300（见[字体说明](../../../public/fonts/celestial-horizontal/README.md)，中文回退本机字体）；正文 26px（12–40px）、昵称 23px；支持字体、正文色、金色强调色、背景不透明度与持续动画。`layout: horizontal` 配合 `fitWidth: false` 最多保留 15 条，新消息到达时向左推移，空闲静止，动效见[固定弹幕动效](danmaku-motion.md#天穹横栏动效)。

「高级参数 → 星云与星标」通过 CSS 更新背景与已有星标（背景预备 60 颗装饰星点，隐藏分隔线仍保留阅读间距）：

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `celestialNebulaOpacity` | 0–100%，默认 30 | 星云浓度，与背景不透明度相乘 |
| `celestialStarDensity` | `off`/`sparse`/`normal`（默认）/`dense` | 关闭/稀疏/原作/繁星，分别显示 0/12/30/60 颗星点 |
| `celestialStarShape` | `identity`（默认）/`sparkle`/`star` | 按昵称变化/固定四角星/固定五角星 |
| `celestialSeparator` | `show`（默认）/`hide` | 消息分隔线显隐 |

### 星河漫旅消息流

`stargazer` 参照 [Stargazer 公开演示](https://bigbrauz.com/products/stargazer-stream-chat-widget)，由 [danmaku-stargazer.js](../../../public/js/overlays/danmaku-stargazer.js) 复用公共渲染器的安全文本、头像及表情，组合紫金渐变圆角卡片、悬角图标、边缘圆点/星芒、流星和事件粒子；[stargazer.css](../../../public/css/overlays/danmaku/stargazer.css) 负责外观与内部动画。Poppins 400/700 纳入共享字体库（族名 `Stargazer Poppins`，见[字体说明](../../../public/fonts/stargazer/README.md)）。默认区域 480×700，正文 28px（16–36px），默认两端 14px 渐隐。

昵称旁以文字标记主播、本房间大航海与粉丝牌（紫金底色不表示身份）；右上角弹幕/礼物/通知分别显示气泡/礼盒/感叹号图标，SC 显示 `SuperChat` 文本，上舰按 `giftGuardLevel` 显示大航海图片标识（支持普通/千舰切换）。色调和循环相位按事件身份固定，快照重绘不换色。共享光影按 `art` 处理透明轮廓。专属参数保存在 `styleOptions.stargazer`：

| 参数 | 范围与默认 |
| --- | --- |
| `stargazerPalette` / `stargazerColor` | `mixed`/`purple`/`gold`/`chat-purple`/`chat-gold`/`custom`；默认 `mixed`；自定义单色默认 `#c04efe` |
| `stargazerLayout` / `stargazerWidth` | `vertical`/`horizontal`，默认纵向；横排每条宽 220–600px、默认 320px |
| `stargazerGap` / `stargazerAlign` | 间距 6–40px、默认 24px；未铺满靠新消息入口 `bottom` 或旧消息出口 `top`，默认 `bottom` |
| `stargazerFrame` | `show`/`hide`，默认隐藏消息区外框 |
| `stargazerPerspective` / `stargazerAngle` | `none`/`left`/`right`，默认平面；角度 0–12°、默认 6° |
| `stargazerGlow` / `stargazerGradient` / `stargazerGradientOpacity` | 霓虹 0–20、默认 8；双边渐变 `on`/`off`、默认开启；浓度 0–100%、默认 40% |
| `stargazerMaxMessages` / `stargazerHideSeconds` | 最多 1–50 条、默认 13；保留 0–999 秒、默认 0（0 表示只按区域/数量淘汰） |

公共信息流的 `flowAxis` 决定测量和移动轴（纵向 `top` / 横向 `left`），按内容长度维护 `data-flow-overflow`；固定消息到期仅在显式 `expireFixedItems` 下启用。仅排列方式、消息上限或保留秒数改变时重建信息流，其余外观原地生效，详见[固定弹幕动效](danmaku-motion.md#星河漫旅动效)。

### 先锋票根固定弹幕

`ripploid`（先锋票根）采用细线、票券与印刷式分层图形，默认区域 480×700，正文 28px（18–48px）、默认色 `#f5f5f5`，支持字体、字号、正文色、滚动方向与边缘处理，不提供背景透明度或礼物插画参数。身份栏依次显示当前房间粉丝牌（`roomMedal`）、荣耀等级（`UL{honorLevel}`）与本房间大航海（`GOVERNOR`/`ADMIRAL`/`CAPTAIN`），最多三枚徽标，各项独立隐藏且全部缺失时不保留空栏（不从 `userLevel`/`level`/`medalName`/`medalLevel`/`guardLevel` 推断）。

普通礼物以 GIFT TICKET 展示，大航海以 NEW MEMBER 卡展示（头像本体距右 50px 留出三枚菱形装饰，发送者姓名最多两行显示、完整文本留 DOM），系统消息用紧凑横条（渲染器保留旧进房兼容结构，当前本机入口不再投递）。四类卡片共用信息流可用宽度，礼物票券、上舰头像裁切区与 SC 对齐右边界。入场时间轴与减弱动态效果见[固定弹幕动效](danmaku-motion.md#先锋票根分层动效)。

聊天配色沿用 `styleOptions.ripploid.bubbleColor`（`default` 或六/八位 HEX，不覆盖事件卡）；事件配色提供 15 个 `#RRGGBB` 字段（默认 `#f39749`）：`giftColor{0,50,100,500,1000,2000}` 与 `superchatColor{0,50,100,500,1000,2000}`（按 `<50`、`50～<100`、`100～<500`、`500～<1000`、`1000～<2000`、`≥2000` 元分档）以及 `guardColorCaptain`/`guardColorAdmiral`/`guardColorGovernor`，位于「配色与外观 → 先锋票根事件配色」。结构与图形由 `danmaku-ripploid.js`、`danmaku/ripploid.css` 负责，不修改 ADR-0020 固定的 `danmaku-renderer-core.js` 快照。

### 星语固定弹幕

`starlight`（星语）为透明白色固定弹幕，默认区域 480×700，隐藏头像、身份牌、底色与礼物原图参数；SC 使用白色主题，不套用旧款价格底板。普通消息居中显示昵称、细横线与原文；礼物左侧显示昵称与内容、右侧显示金额；SC 顶部显示昵称与两位小数金额、正文通栏。

仅本款接受 `styleOptions.starlight.decorationShape`：`sparkle`（四角星，默认）、`heart`（爱心）、`square`（圆角方块）、`star`（五角星）、`flower`（小花）、`moon`（月牙）、`bow`（蝴蝶结）。图案由内置 SVG 遮罩绘制（同时提供 `mask`/`-webkit-mask` 与 `clip-path` 降级），切换时直接更新已显示消息且各图案带独立循环动画（四角星闪烁、爱心双拍、方块轻弹、五角星缓转、小花轻旋呼吸、月牙摇曳、蝴蝶结轻摆）。

### 对白固定弹幕

`harbor`（对白）由 `danmaku-harbor.js` 与 `harbor.css` 负责，默认区域 480×700，支持字体、18–48px 字号、正文色、背景透明度、滚动方向和边缘处理：

- **气泡与头像基准**：普通消息隐藏昵称，圆头像配灰色气泡（左上角带向左伸出 0.25em、高 0.35em 同色三角尾，最小高度为头像直径 1.08 倍约 2.65em）；行内表情以 `1.15em` 补偿透明边。头像直径以固定 30px 基准计算（普通/礼物 `2.45em`、上舰 `2.59em`、SC `2.52em`），不随正文字号放大。本房间舰长/提督/总督以蓝/紫/红气泡区分，头像框与舰徽遵循房间千舰规则。
- **在线榜与事件卡**：在线榜前三显示排名牌（`onlineRank` 仅接受 1–3 整数，缺少榜单时不推测）。上舰卡展示购买等级、结算总额、动作与已知陪伴天数；SC 通栏展示浅色头部与深色正文区；普通礼物使用简洁通知（礼物名与「× 数量」字号行高一致）。
- **最低礼物门槛**：`styleOptions.harbor.minGiftAmount`（默认 0，范围 0–100000 元、两位小数）仅按每条礼物的 `giftTotalPrice` 过滤（含上舰，等于门槛保留，正门槛下未知金额隐藏，不影响 SC）；快照与增量统一在信息流中筛选，参数变化重建。

### 流霞固定弹幕

`prismatic`（流霞）默认区域 480×700，支持字体、18–48px 字号、正文色（默认 `#292b32`）和上下滚动，不提供底色透明度或礼物原图参数（详情见[流霞规格](../../../specs/danmaku-prismatic.md)）：

- **普通消息与礼物**：头像直径固定 83.25px（`2.775em` × 30px 基准），上方展示 B 站荣耀勋章、本房间粉丝牌、大航海图标与白色昵称；本房间大航海采用逐消息稳定的柔彩混色气泡，普通观众采用白色气泡（左上角为直角，独立大表情区透明），普通礼物为白色条与结算总额。
- **大航海与 SC 全宽卡**：大航海购买采用居中圆头像、白底昵称与感谢文案的多段渐变卡（舰长珠光香槟金、提督冰蓝紫晶、总督浓郁玫瑰金），右下角粗体白字显示本次结算总额上半部分（缺失省略）；陪伴天数优先取通知字段，否则按绑定房主与观众 UID 读陪伴榜 `accompany`（缺失省略）。SC 为薄荷至粉色渐变，上方昵称与右侧白色 `CN¥` 胶囊、下方通栏原文，不显示头像。两类卡片均铺满内容区，长内容超高时缩小字号并重新换行。
- **事件字段投影**：Electron 事件投影及场景缓冲仅保留经校验的可选 `honorLevel`、`roomGuardLevel`、`roomMedal`，大航海感谢另保留 `giftGuardLevel`、`guardAction`、`guardAccompanyDays`（后两项仅在有效购买等级下接受）。

### 固定样式的 SC 展示

雪狐与月渡花汀的 SC 昵称、正文使用当前样式选择的自定义字体（未选择时保留默认字体）；SC 金额沿用样式自身数字字体与字号规则。

收到本场 `superchat-delete` 时，标准弹幕、场景组件和导入 CSS 样式按匿名 `messageId` 找到本地卡片 ID，经信息流的 `remove(ids)` 定点移除并清理缓存和待插入队列，不影响其他卡片。本地持久化同时删除撤回 SC 的正文和金额，仅保留最小平台 ID 回执防止重放恢复，详见[SC 存储约定](../backend/storage.md#32-super-chat-datadb醒目留言库2-表)。撤回事件本身不代表退款。

正式直播软件网页源的 SC 事件来自 LIRA Server 的 `superchat` SSE；本机 `/danmaku` 保留入口通过 `danmakuFeed` / `danmaku:message` 接收 SC，`/danmaku?preview=1` 用合成 SC 验证同一结构。六种旧式固定样式分别为经典矩形、底部签名行气泡、墨蓝切角面板、居中透明淡紫花结细框与档位色角饰（金额使用 Georgia 旧式数字）、透明完整细框与金额列分隔线和头像伸出、带档位色完整细圆角边框及姓名分隔线的连续底板；DOM 使用独立 `is-superchat/sc-*`，CSS 由 `danmaku/superchat.css` 负责。蝴蝶结默认区域加宽后，普通消息与 SC 内容宽度上限为 564px，顶部花结装饰不拉伸。

原文与换行通过 `textContent` 完整显示，金额来自实际 `price`，不显示固定 SC 标签或感谢模板。六款均显示发送者昵称（`.sc-name`），经典气泡、融影名片和琉璃同时显示头像；金额拆为缩小的 `¥`（`.sc-currency`）和数值（`.sc-value`）。颜色优先采用 B 站下发的有效十六进制值；缺失时按 30/50/100/500/1000/2000 档位回退（2 元无自有色时共用 30 元蓝色），先锋票根改用独立 SC 档位配置。精确色表与公开字段由服务端 `public-overlay-api.md` / `SuperChatEvent` 维护。

本地样例统一由 `public/js/overlays/danmaku-preview-samples.js` 提供，内置样式与导入 CSS 预览共用。文本按二次元与模拟真实聊天分池（所有样例正文含标点、换行与表情占位不超过 40 个 Unicode 字符），包含行内小表情、四种独立大表情（小电视鼓掌/笑哭、免费通用冲鸭/这个好耶）、七种普通礼物（总额 ¥0.1、1、13.2、52、100、520、1245）、六条大航海开通/续费通知（舰长/提督/总督各两）及七档 SC（¥2、30、50、100、500、1000、2000），开启机器人欢迎且支持 SC 时每轮共 47 条。大表情原图取自 B 站登录账号直播表情列表并记录于 `public/img/overlays/danmaku-previews/stickers/provenance.json`，预览运行时不读取账号或在线拉取表情。青雾、漫画分镜、散落小窗、落星尘、玻璃气泡、海风散影及沉笺下沉飘窗支持 SC，其余区域随机与飘窗过滤 SC。样例隔离与单计时器生命周期由 `test/danmaku/danmaku-preview-samples.test.js`、`test/danmaku/danmaku-local-preview.test.js` 和 `test/admin/canvas-empty-previews.test.js` 覆盖。

观众样例固定为八个二次元风格身份（普通观众、舰长、提督、总督各两人，复用 `danmaku-ranked/` 头像，独立 UID/固定昵称/大航海身份）；机器人欢迎对象为普通观众「Mio」。所有身份均为本地合成数据，不查询真实账号。

## 6.2 游戏叠加层(/games)的弹幕组件

[overlays/games.js](../../../public/js/overlays/games.js) 是游戏入口，只传入会话中的 `session.danmaku`。你画我猜在聊天隐藏期间保留最新数据，恢复显示时绘制一次。积分榜和答对名单分别在对应内容变化时刷新。画我猜的 `#drawDanmakuFeed` 固定声明 `data-style="bubble"`，不读取或跟随弹幕姬的 `danmakuOverlayStyle` 设置；`games.css` 独立实现适合游戏窄栏的五身份气泡视觉，并自动受益于共享组件的安全表情渲染。

你画我猜的 `choosing` 阶段在画布上显示「主播正在挑选」，倒计时显示 `--:--`，画笔工具禁用；主播在客户端确认题词后，收到完整 `game:update` 切换到 `drawing`，收起等待提示并开始本局倒计时。只有 `drawing` 阶段显示抢答邀请，回合结算与最终排行显示抢答已结束。下一题与选词期间重新打开页面也按公开阶段恢复，展示页不读取私有题词列表。

答案与别名通过 `src/games/draw-guess.js` 的同一规则比较，支持简繁等价（如「苹果」接受「蘋果」），无需为繁体另设别名。题词、公布的答案、弹幕原文和观众昵称保持原文。

重新打开画布时，笔画与橡皮续段按服务端接收顺序重绘。远端清空先到时，客户端在清空后的底图上重画尚未收到确认的本地操作。

`games-drawing.js` 在首个指针结束当前笔画前忽略其他触点。清空确认只作用于打开对话框时的游戏会话和局次。直线、矩形和椭圆拖拽在当前手势内复用一份已绘历史底图，每次移动恢复底图后只画当前形状，避免反复重放全部旧笔画。远端追加、撤销、清空、完整快照重绘或画布实际像素尺寸变化会使底图失效，下一次预览重新生成；结束、取消或禁用工具时随手势释放。普通画笔仍沿原增量路径绘制，操作提交和坐标协议不变。

游戏和转盘共用 `socket-client.js` 的连接生命周期。每次连接成功分别从 `/api/games/session`、`/api/wheel` 补齐状态；游戏请求失败按最多 5 秒间隔重试；增量在 HTTP 恢复期间有界缓存并按版本衔接，完整更新使旧请求失效。转盘请求仍最多重试四次，收到更新后丢弃较旧的 HTTP 响应。转盘通过专用 REST 读取和 `wheel:update` 恢复，不假定普通 snapshot 包含转盘状态。现有互动端点保留，访问凭证仅允许 §1.0 列出的本页操作。

聊天增量逐条即时交付；你画我猜比分由服务端按 40ms 窗口合并公开，阶段切换及完整恢复快照包含最新结果。场景父页显式请求 `incrementalParts=1` 后，游戏画布与比分各自确认版本：未变部分不再随每条聊天复制传输。父页为新 iframe 保留完整基线，活动组件只合并同会话、同回合省略的 `canvas/correct/scores`；断线清空、换回合和新会话不会继承旧画布。独立 `/games` 保持原 WS 字段与快照恢复协议。

- `games.css` 将短消息显示为紧凑气泡，长消息按宽度增长并自然换行增高；交错对齐、实时标题栏和减弱动态效果（`prefers-reduced-motion`）降级只属于视觉层，不改变弹幕字段或游戏协议。

## 6.3 时钟(/clock)

[shared/clock-settings.js](../../../public/js/shared/clock-settings.js) 是内置时钟样式 ID、默认文案、翻页颜色及外观设置键的共同来源。后端 `clock-contract.js`、场景适配器和时钟叠加层直接派生所需集合与映射；严格输入校验仍归后端，宽容回退、旧 URL 参数优先级和布局/DOM 仍归叠加层，预览继续使用同一共享定义。

[overlays/clock.js](../../../public/js/overlays/clock.js) 驱动固定 `/clock` 浏览器源，默认首帧使用本页访问凭证从只读接口 `GET /api/clock/config` 读取已保存设置，并使用设备本地时区显示当前时间、日期和星期。页面外层透明；横向样式使用 560×190 设计坐标，竖向时间轴使用 220×380，月渡花汀使用 560×360。输出按当前样式的可见内容收紧边界，仅留每边 4px；装饰卡片保留完整卡面，透明款包含当前显示的时间、日期、时段与装饰。场景选中框随样式及日期/秒数开关同时调整宽高，保持当前缩放；拖动任意缩放柄时等比缩放，高度自动跟随内容。保存后的独立浏览器源和场景输出使用相同内容边界。

- 风格参数仅接受 `style=peach|starlight|soda|timeline-horizontal|timeline-vertical|digital|minimal|orbit|flip|moonlit-fan`，非法或缺失值回退桃桃便签（`peach`）；前三套分别使用奶油蜜桃兔耳、靛蓝月亮云朵与薄荷气泡小鸭。横向刻度和竖向刻度使用无卡片底的细线排版、年份与英文星期，其中竖向款适配 240×400 浏览器源（含页面边距）。白字数显（`digital`）使用透明背景、白色粗窄数字和细暗描边，上排为 `YYYY-MM-DD` 与英文星期，下排为同字号的 `HH:MM:SS`，沿用横向画布。星轨时钟（`orbit`）使用白字暗描边、星形与环绕线，下排为 `YYYY.MM.DD` 和中文星期；翻牌时钟（`flip`）使用日期/英文星期小牌和时/分/秒双数字牌，均沿用横向画布。
- 极简（`minimal`）使用透明背景、白色粗体和同字号的 `HH:mm:ss`，冒号不闪烁。固定隐藏年份、日期、星期、时段与角标；设置面板隐藏日期和角标控件，保留秒数开关与小时制。切换到其他样式时恢复其日期和时段显示规则。
- 月渡花汀（`moonlit-fan`）由 `clock/moonlit-fan.css` 实现，复用开播主题的银蓝折扇、白山茶与流苏原画；月轮提供浅底靛青字与靛蓝底月白字两套配色，显示衬线数字、小号秒数和中文日期/星期。外围透明，保留完整装饰边界。小预览与组件画布均可选择，沿用现有日期、秒数和小时制开关。
- 月渡花汀的 `moonMode=light|dark|auto` 对应固定浅色、固定深色和自动交替，默认 `light`；`moonIntervalSeconds` 为 1–86400 的整数秒，默认 30。只有自动交替显示间隔控件。自动配色按设备 Unix 时间的间隔段奇偶计算，复用秒调度器；相同间隔的预览与正式输出同步，隐藏恢复或重复设置消息不重置相位。两项 URL 参数独立覆盖保存值，旧配置和旧独立场景缺省补足 `light`/30；显式非法值拒绝保存，读取非法存量值或 URL 值时回退默认值。其他样式不使用这两项外观参数。
- 翻牌颜色为 `flipFrameColor` / `flipFaceColor` / `flipTextColor`，对应外框、牌面、数字，接受 `#RRGGBB` / `#RRGGBBAA`；默认 `#e4e4e4` / `#ffffff` / `#303030`。参数覆盖保存配置时独立合并，非法颜色回退默认值。设置面板提供经典白、石墨黑、香芋紫预设及三个自定义颜色选择器。
- `date=0|1`、`seconds=0|1`、`format=12|24` 控制日期、秒数和小时制；非法值回退默认显示日期/秒数与 24 小时制。`label` 合并空白并截到 16 个 Unicode 字符，始终通过 `textContent` 输出；透明时间轴、白字数显、极简、星轨、翻牌和月渡花汀不显示角标文案。
- 时钟按下一秒边界更新，隐藏秒数时改按下一分钟。月渡花汀的自动明暗切换若更早到期则优先更新。三者共用一次性定时器，页面隐藏时停止调度，恢复可见后立即校时。冒号、星点与月渡花汀流苏动效在 `prefers-reduced-motion: reduce` 下停用。翻牌由 [clock-flip.js](../../../public/js/overlays/clock-flip.js) 持有上下半牌与 WAAPI 动画，仅数值变化时旋转；首次展示、隐藏字段/页面和开启「减弱动态效果」时直接校准。重入动画和切换样式取消旧动画，复用同一个时钟调度器。
- 管理端组件页的「时钟」卡片只展示并复制固定地址；表单修改经受 token 保护的 `POST /api/settings` 显式保存。小预览与公共窗口使用 `componentPreview=1` 及父页消息，不读取正式配置流；小预览额外使用 `previewFit=contain`，按容器宽高等比缩放并居中，切换样式不继承画布编辑器的缩放比例，也不向父页请求改尺寸；白字数显、极简与星轨的小预览使用深色棋盘底。打开公共窗口时卸载小预览，关闭后恢复。样式切换使用 160ms 淡入，开启「减弱动态效果」时停用，不重载页面或重启计时器。旧完整参数内嵌预览消息仍兼容。
- 正式来源使用 `createOverlaySocket()` 接收 `clock` scope 的展示设置键；重连回读配置，晚到 HTTP 不覆盖新快照。旧 URL 显式参数逐字段覆盖保存设置；配置更新复用同一个计时器。

### 时钟与弹幕的逐样式效果

外部网页的 DOM 适配由 [overlays/browser-source-frame.js](../../../public/js/overlays/browser-source-frame.js) 负责，管理页预览与正式场景渲染器共用 `configureBrowserSourceFrame` / `disposeBrowserSourceFrame`，分别在重配置和卸载时释放效果控制器；`shared/scene-browser-source.js` 只保留纯配置规范化，不反向依赖叠加层运行时。

`public/js/shared/component-style-parameters.js` 定义参数范围、编辑默认值、能力表和 `normalizeStyleParameters`。浏览器按这份定义编辑效果，主进程 IPC 和本机场景保存通过 `src/shared/component-style-parameters.js` 的 CommonJS 入口按组件类型校验输入。`component-style-effects.js` 负责效果节点、原属性恢复、动态消息观察和释放。旧服务器来源沿用自己的兼容约定。配置新增可选 `styleParameters` 映射，键为预设名或 `css:<uuid>` / `media:<uuid>` / `resource:<uuid>`；浏览器源使用 `web:<uuid>` 或 `browser`，最多 64 个档案。映射沿用组件外观的归属：内置公共参数及资源型样式按同一样式共享，导入 CSS、普通图片/视频与外部网页按实例保存。缺少某组沿用作者样式，空样式对象恢复该款新增效果；原有 `styleOptions` 保持独立。

效果目标按具体预设区分文字、底板、透明图案和月轮；白平衡、色阶与亮部辉光保持 alpha，旋转/倾斜与原缩放、入场、翻页及飘窗移动组合。重配置先恢复原属性，再应用新样式；销毁时清理滤镜、观察器和监听。导入 CSS 沿用原生或 BLC/blivechat 已知结构；隔离 HTML 只提供 CSS 整体外投影、外发光、矩形边框、变换，不提供跨框架 SVG 调色。

公共 `transform.perspective` 范围 400–4000px、默认 1000px，缺少字段的旧配置沿用 1000px。绘制与 `componentEffectBounds` 共用 `effectTransform`；不另建样式私有透视。编辑器将现有 `transform.rotateY` 显示为「左右透视」，范围 −80°–80°、默认 0；0 为正面，正数左近右远，负数左远右近。它只修改 Y 轴角度，不附加 Z 轴平面旋转，旧的左右侧倾预设已移除；`rotateZ` 以「平面旋转」独立显示。原有字段、手动角度与逐样式保存规则保留，不新增另一套变换或迁移已保存的自定义角度。

固定弹幕编辑器将同一组 `transform` 控件放在「消息与动效 → 位置与变换」，与外观效果的调色、光影分开；按 `DANMAKU_STYLE_OPTIONS` 的样式分类判断，暗夜霓光 / 星河漫旅内部横排仍属固定款。切换分类时移动原控件，不重复创建或订阅；通用控件沿用现有校验和保存通道，固定款的「恢复当前样式效果」保留 `transform`，其余效果及欢迎显示开关按原规则清空。其他弹幕、时钟和网页源保留原变换入口与效果重置语义。

弹幕的 `showEntryMessages` 为兼容保留的持久化键，位于当前样式档案内，默认开启（缺省等同 `true`，显式 `false` 关闭），界面名称为「显示机器人欢迎弹幕」。`danmaku` 的可选布尔 `isWelcome` 由服务器按实际欢迎发送任务匹配 B 站回流后生成，主进程严格校验并由本机缓存保留；只有该标记为 `true` 的消息受此显示开关控制。首次欢迎和二次问候均覆盖，开关不改变 B 站发送；普通聊天、其他机器人回复及礼物/SC 保持原有规则。当前本机场景、单组件源与导入 CSS 不再显示原始 `entry` 提示，旧服务器缺标记时继续将消息作为普通弹幕展示。预览使用机器人欢迎样例，不连接发送接口。新增参数沿用场景和预览保存通道，时钟默认设置由 `clockStyleParameters` JSON 保存；本机弹幕由账号外观档案保存。用户参数表与兼容边界见[外观效果指南](../../guides/component-style-parameters.md)。

### 6.4 组件系统的统一管理与独立导入

`admin/component-preview-session.js` 管理当前浏览器编辑会话；`component-preview-surface.js` 共用 iframe 消息、数据来源、缩放与释放逻辑，参数面板由各组件提供。`component-config-controller.js` 持有页面会话的已保存基线和草稿；两个入口共用显式保存、放弃修改、错误及冲突状态。保存期间的后续编辑保留；外部快照只回填未修改字段。`component-settings-sync.js` 将时钟和队列草稿同步给管理端表单，其他领域字段沿用原回填。

预览会话没有固定编辑时长：已认证的网页读取/编辑及客户端同步都会续期。双方连续两分钟没有有效请求时暂停网页操作并保留有界会话状态；原客户端通过认证且配置代次一致的同步可恢复连接，网页凭证本身不能重新激活已暂停的会话。客户端持续打开时，离开十分钟再刷新仍可编辑。网页与客户端的同步请求每次最多等待五秒，网络错误、408/429/5xx 按 1–5 秒间隔自动重试；网页保留待确认草稿，显示重连状态，恢复后按原顺序同步。保存/发布等待前序编辑确认。刷新/离开网页只释放当前页面的请求、定时器和视图，原客户端继续持有未保存草稿。新页面按已读取的页面标识接管会话；重复接管请求不重置状态，旧页面迟到的修改、关闭和接管重试不能影响新页面。新页面先等待此前已接受操作完成，再恢复本地草稿。网页变更请求串行发送，并携带当前页面标识及递增 `commandId`；中继按页面保留最近一次编号及结果，响应丢失后重试返回原序号，避免重复编辑或发布。未接管的旧页面协议保持兼容。客户端关闭、重新打开新的预览、账号/配置来源切换、显式关闭或授权撤销仍使旧会话失效；永久失效时保留当前可见草稿并停止发送，不能自动恢复已撤销凭证。

编辑页将展示配置的草稿及已保存基线写入同一浏览器、同一本地 origin 的恢复快照；不写入预览 token、直播源访问凭证或实时事件。后端按已认证账号的稳定 scope 和场景标识生成仅作索引、不含鉴权能力的 `draftKey`，随预览片段和已认证快照传递。新连接使用后端确认的 key 查找草稿，恢复只调用原控制器的编辑入口，仍是未保存状态，不自动保存或发布。保存、放弃后的快照同步更新。如果已保存基线或客户端草稿另有变化，暂停编辑并提供「恢复上次草稿」/「使用当前配置」选择，避免自动覆盖。仅已撤销或所属客户端已结束的旧链接退回本地进度的只读展示，继续编辑须从客户端取得新连接；普通刷新和可恢复的闲置连接不会因此退回只读。各连接独立保留有效草稿，未就绪连接不覆盖已有快照；迟到的首次读取仍先检查恢复冲突。断开连接时保留尚未确认的编辑。只读恢复为所有组件使用无实时数据的空数据源，加班机保留外观并明确提示实际数据不可用，不订阅失效会话。浏览器存储失败会提示先保存再关闭；清理浏览器数据、换浏览器或本地端口变化不保证恢复。

父页校验精确 iframe source 与不透明源（`Origin: null`）；`overlays/component-preview-client.js` 校验直接父页和页面 URL origin。iframe 仅接收展示配置与受限数据，不接收完整管理快照。文本框在正文图片和礼物图解码完成后确认配置。解码失败走场景准备失败和重试流程。配置、CSS、素材及效果应用完成后直接回传 `prepared`，不等待 `requestAnimationFrame`（隐藏的直播浏览器源可能暂停动画帧）；资源错误仍报告 status，不能以「已加载页面」代替素材就绪。关闭释放数据订阅、观察器、监听和 iframe；检查底色与适配缩放不进入保存参数。

「点歌 → 浏览器源 → 直播场景 → 编辑场景」通过 `component-preview-registry.js` 惰性加载四个领域控制器，并在系统浏览器打开 `/c#…`（兼容 `/component-preview`）。首次为空，之后恢复已保存布局；已有场景不等待弹幕配置加载，仅首次创建时等待其画布尺寸。单组件预览入口会添加或选中该组件。需要新增共享图层时，桌面通过现有尺寸接口读取保存值，由短入口解析结果把初始尺寸传给预览页；没有保存值才使用组件默认尺寸。同一 canvas 会话的组件、实例和场景切换复用同一个短入口，客户端串行更新最近选择后定位已有网页；恢复草稿的 `draftKey` 随场景变化，入口访问凭证不随之变化。已删除实例或另一场景的旧选择回落到当前画布。访问凭证的有效期与鉴权仍见[API 注册表](../backend/api.md#浏览器组件预览)。顶部「添加组件」通过小窗按类别展示已有样式；「套装」入口按已导入的包显示名称、数量和样式卡片，点击卡片添加对应组件。样式卡片使用 8:5 预览舞台并等比容纳图片；只有一款时适度放大、最大宽 480px，弹幕筛选结果及无图文本框保持紧凑布局。全屏礼物感谢的礼物掉落、礼物摇摇乐使用实际播放器截图作为内置示例图（`public/img/component-previews/gift-frame-gift-drop.webp` 和 `gift-frame-gift-swing.webp`），随客户端交付，无需导入样式包。背景读取成功但没有素材时显示导入指引，读取失败仍显示错误。套装成员来自本机已安装包的 `styles` 数组，按包分组显示；初始不再提供月渡花汀卡片。清单允许可变种类、数量和同类多个样式；分类页与套装页读取同一个库。

导入后，「背景」分类和套装提供月渡花汀静态/动态两种背景。`background` 复用独立组件注册，`style` 默认为 `none`，导入后可为 `moonlit`（静态）或 `moonlit-animated`；新增时按当前画布宽高铺满并放在最上层，作为底图时需将图层拖到组件栏最右侧，之后可移动、缩放、隐藏和调整层级。`overlays/background.js` 先接入预览协议，再根据配置映射并解码图片；动态版由 `background-moonlit.js` 延迟加载并播放 `img/overlays/backgrounds/moonlit-loop-hq-60.webm`（离线以 3840×2160 抗锯齿合成并输出 2560×1440、60fps、24 秒无声循环，保留软 Alpha，底景原画 1672×941）。视频开始播放前或加载失败时保留原图；隐藏页面时暂停并保留进度，销毁时移除视频源与监听器，开启「减弱动态效果」时显示静态原图。`background.css` 默认使用等比覆盖，非 16:9 容器居中裁切，可通过背景外观参数改为完整显示或拉伸。静态资源仍为 `img/overlays/backgrounds/moonlit.webp`，不修改开播动画底图。模板保留样式与本机资源映射，无业务数据；迁移到另一电脑需要连同素材库一起迁移。

新建图层独立选择样式；右侧公共显示参数与客户端及同样式实例共享，首次采用客户端已保存值。普通媒体/CSS、外部网页与没有客户端对应项的配置保留原归属。公共分辨率预设/自定义尺寸独立于组件，图层默认以预定大小居中，窗口改变只影响查看比例。编辑页采用浅色控件与灰色工作区，画布自动适配且不滚动；画布设置、撤销/重做、预览底色、保存、放弃和复制集中在顶部紧凑工具栏，已有图层在画布下方横向排列。撤销使用 Ctrl+Z，重做使用 Ctrl+Y 或 Ctrl+Shift+Z；焦点在文本输入或富文本编辑器中时保留其原生快捷键。画布设置中的场景名称输入框 `maxlength=10`；复制场景时保留原名称前至多 7 个 UTF-16 单元（不拆开代理对）并追加「 副本」，沿用输入框的长度口径。已有场景文档的读取与存储格式保持兼容。直接入口默认收起参数，画布设置与图层按钮可展开右侧面板；折叠保留选择、参数和草稿，隐藏字段校验失败时重新展开。在画布中选择或拖动不会自动展开面板，避免拖动中触发缩放。参数与图层列表按需独立滚动。所有组件都可部分移出画布，X/Y 可为负数；每个组件在画布内至少保留 24×24 逻辑像素，拖动、多选、缩放与保存遵循同一边界。越界内容由编辑器画布及正式组合展示页裁切，不改变组件内部排版；自动高度或共享尺寸更新不会把仍满足最小可见范围的组件推回画布。几何约定见[场景规格](../../../specs/component-scenes.md#scene-document)。

「保存并应用」先提交已排队的资源样式公共参数，再等待场景及其引用的共享外观控制器的网页编辑得到客户端确认，批量保存并再次核对后发布组合画面；原生时钟、队列、弹幕和加班机的独立实例也参与对应公共控制器的保存，无关默认配置不保存。删除最后一个引用图层后，已排队的修改仍会提交。撤销删除或再添加同款样式可接续待保存草稿。写入失败时，仍有图层引用的样式须重试成功才能发布。已无引用的样式释放失败状态，其余图层可继续发布。共享点歌板以点歌规则保存的歌名色和点歌人色一同确认本次发布。场景输出每次读取均返回按已发布可见 item ID 投影的 `appearances`，即使版本未变、`document` 为 `null`；隐藏图层重新显示并发布后读取当前外观，单组件输出仍将目标强制设为可见。渲染器原地更新配置，不重建 iframe、不重播礼物事件，也不带入未发布布局。「放弃修改」还原画布及本次编辑涉及的公共控制器的未保存草稿（含已移除图层），保留无关组件草稿；已经自动保存的公共参数不会回滚。展示板及画布以百分比显示背景不透明度，持久化值仍为 0–1。

参数区仅在 `sharedAppearance.getState(item)` 提供自动保存控制器时标为即时生效；内置时钟、点歌板、弹幕姬和加班机的公共参数仍是控制器草稿，随「保存并应用」生效。位置、尺寸与图层仍需保存并应用。组件面板的画布入口优先选中对应已有图层，没有时加入未保存图层。参数区的保存状态明确标为「公共参数」，与顶部场景的未保存、当前输出状态分别呈现；公共参数没有未保存修改不代表场景布局已保存或应用。画布时钟的克隆参数面板以「当前样式」下拉切换内置样式，保留原参数与外置素材入口，不重复陈列整组样式卡片；客户端原样式选择器保持不变。部分保存失败、冲突或未完成草稿会停止发布，保留之前的直播布局；已经成功保存的共享外观继续生效。客户端浏览器源中的 `canvas-overlay-source.js` 与网页按钮共用 `scene-source-url.js`，自动读取并显示首个已绑定场景的已发布地址，点击地址区域即可复制；未发布时提示先编辑并应用。进入浏览器源页、返回客户端或账号/在线来源改变时重新读取，来源改变立即清除旧地址；读取与复制不创建或发布场景。编辑会话访问凭证与持久输出访问凭证相互独立。

独立组件来源 `/clock`、`/queue`、`/overtime`、`/danmaku?source=component` 与单图层地址 `/scene?id=…&item=…#token=…` 的读取和同步边界见[本地场景浏览器来源](#本地场景浏览器来源)。

队列预设、默认值和样式切换只修改草稿；保存提交所有已编辑样式键和最终样式。队列预览使用样例歌曲和同一渲染器，历史共享主题键仍影响跟随主题的歌单板。画布中的点歌板按当前样式的实际面板尺寸自动收拢边框，高度只读、拖动等比缩放；身份版仍不超过原始设计大小。编辑时按宽度计算内容高度，避免旧框高度反过来限制面板；发布后的来源继续按已保存矩形完整容纳内容。透明样式不继承经典款的背景模糊设置。加班机页面已移除内嵌 iframe，保留紧凑运行状态、初始时长/外观分栏及通栏规则。其公共窗口默认显示实际倒计时，小时/分钟/秒、启停和开始/暂停通过 `overtime` 会话中继到客户端原 `/api/overtime/time`、`/api/overtime/action`。操作立即保存并回填两端，替换非零剩余时间前确认；失败保留时间输入。运行/暂停/结束/未启用示例只供查看，没有修改示例时间的按钮。来源切换清理动画并重置 revision 基线，外观草稿保持；外观保存仍只向原 config 接口提交 `{path, fit}`，时间和规则不进入场景配置。

组件扩展由各环境的显式定义负责：`shared/scene-components.js` 持有前端稳定类型、顺序、缩放轴、内容高度、子渲染器/默认来源 URL 和断线重置能力；`admin/component-preview-definitions.js` 组装纯工厂及样式选择适配。被动 registry 只接收桌面控制器注册，未知类型立即报错，不反向导入工厂或控制器。`clock-preview.js`、`danmaku-preview.js`、`queue-preview.js`、`overtime-preview-factory.js` 不读取桌面状态；桌面、浏览器会话和离线恢复分别注入数据源。舞台优先使用 `startLayerData`，否则使用组件的 `startData`；加班机的多个实例共享一次数据源，最后一个图层释放时停止。

后端 `src/shared/scene-component-types.js` 定义渲染类型，`server/scene-components.js` 的 ports 复用领域配置校验、默认配置及显示投影；`server/component-preview-page.js` 保留显式 HTML 片段白名单，弹幕预览复用 `pages/admin/live-components/danmaku.html` 的画面参数，不包含百宝箱的发送与机器人表单。中继与默认配置草稿缓存保留四个共享类型和 `canvas` 控制类型，不把 `canvas` 作为可渲染组件。`shared/scene-extra-components.js` 定义开播动画、展示板、歌词、三类小游戏、全屏礼物感谢、大航海感谢、礼物滚动、盲盒榜、许愿的独立参数与选择项；`admin/scene-extra-preview.js` 在画布中创建参数面板，实例字段由场景控制器保存，公共字段交回既有共享控制器。高级歌词通过 `advanced-lyric-canvas-settings.js` 复用「搭配 / 编排 / 外观 / 动效」四分类编辑器及其折叠小组，包含所有视觉字段、轮换、位置居中操作及原生命名搭配；原生 `advancedLyric*` 写 settings，资源歌词写样式库。预设库仅供编辑读取，不进入场景配置或直播投影；实例 `lyricLayer` 继续独立。

展示板的示例歌曲曲风跟随各图层的曲风筛选，正式来源筛选实际歌库。独立展示板和场景按完整曲风成员匹配，例如选择 `R&B` 会同时显示标为 `R&B` 和 `流行 / R&B` 的歌曲。兼容 blivechat/blc 的导入弹幕 CSS 在编辑预览中持续补充示例，避免退场动画后永久空白；页面隐藏时暂停，销毁时停止，正式来源只接收直播事件。小游戏画布由 `admin/component-preview-canvas-controller.js` 配置公共 `canvas-data-poller.js`，在客户端每秒读取当前公开对局，沿现有预览会话传给游戏子页；不再使用固定示例局面。`overlays/games.js` 按实际棋盘字段复用数字炸弹按钮、五子棋按钮及坐标；相同完整快照不重建节点或重复绑定点击。落子、范围、回合和胜负变化仍更新棋盘，标题、结果、外观及你画我猜倒计时沿原路径更新。小游戏和开播数据由画布控制器复用 `admin/canvas-data-poller.js` 的单请求轮询、超时及销毁取消；按画布组件类型决定是否请求，读取失败清空本次投影。没有匹配对局或读取失败时，编辑画布显示等待开局，正式来源仍隐藏未进行的游戏；开始、落子与绘画继续由「直播小游戏」管理。新添加的数字炸弹、五子棋、你画我猜分别默认 800×360、600×600、1280×720；五子棋棋盘按组件视口适配，已有图层保留保存的尺寸。

礼物许愿的组件选择与展示样式支持「月渡花汀」（`moonlit`）与画布内置「流光彩带」（`ribbon`），独立浏览器源与场景画布共用 `shared/gift-wish-card.js` 渲染入口：

- **月渡花汀许愿卡**：由 `shared/gift-wish-moonlit.js` 渲染，复用透明折扇荷塘底图 `img/shared/gift-wish-moonlit.webp` 与左侧花枝起点 `gift-wish-moonlit-start.svg`，按 0–100% 进度平移流光与光点（完成态加满格高光与微尘，开启「减弱动态效果」时保持静止）；同一许愿更新时保留卡片节点以保持过渡连续，640px 宽时单条初始高度为 143px。
- **流光彩带（`ribbon`）**：适用于普通礼物和大航海，`shared/gift-wish-ribbon.js` 负责图标、礼物名、已收/目标与流动斜纹（更新时保留节点，填充封顶 100%，计数显示实际数量），外观保存在场景图层、不写入服务端许愿定义。字段由 `shared/gift-wish-ribbon-appearance.js` 声明：`ribbonColor`（`#ee87ac`）、`ribbonTrackColor`（`#fee6fb`）、`ribbonBorderColor`（`#ffffff`）、`ribbonTextColor`（`#ffffff`）、`ribbonOutlineColor`（`#4b494b`）、`ribbonHeight`（40–120px，默认 68）、`ribbonFontSize`（12–48px，默认 26）、`ribbonNumberFontSize`（12–48px，缺省跟随名称字号）、`ribbonSpeed`（0–20 秒，步长 0.5，默认 2，0 为静止）、`ribbonBorderWidth`（0–12px，默认 8）、`ribbonRadius`（0–36px，默认 10）、`ribbonStripeWidth`（4–24px，默认 10）、`ribbonFlowDirection`（`normal`/`reverse`）及 `ribbonDecorationStyle`（`none`/`pastry` 默认/`bow`/`sakura`/`candy`/`star`，同步兼容旧开关 `ribbonDecorations`，素材位于 `public/img/shared/gift-wish-ribbon/*.webp`）。参数面板分「彩带外观」「文字与数字」「彩带动效」；短条保护限制边框 ≤ 条高 18%、圆角 ≤ 条高 50%、图标 ≤ 宽度 16%、字号 ≤ 条高 50% 及内高 72%。开启「减弱动态效果」时停止条纹和进度过渡。
- **文字版与数据轮询**：文字版的 `textPendingColor` / `textReceivedColor` 由每条许愿保存（模板块语法与编辑工具见 [app.md §6](app.md#6-组件与百宝箱)），场景组件直接使用许愿投影中的颜色（不再提供整层颜色覆盖，片段显式配色优先于状态色）。`admin/gift-wishes-canvas-data.js` 在画布有可见许愿图层时订阅已保存许愿。多个可见图层共用一次订阅，隐藏或移除最后一个可见图层后释放画布订阅，其他订阅方照常读取。重新显示时恢复订阅。同一文档内的管理页与画布共用 `shared/gift-wish-client.js` 的 3 秒轮询，有订阅方需要本场状态时立即切至完整请求。文档隐藏时取消定时器与在途读取，恢复可见时每个活动接口补读一次。最后一个订阅方退出时释放监听与缓存。「显示条数」默认 1（1–30），原生样式按内容自动测量高度。

`gift-frame` 和 `guard-thanks` 是两个独立图层，分别通过 `/gift-effects?giftComponent=frame`、`/gift-effects?giftComponent=guard` 的无凭证组件模式复用现有播放器（播放细节见 [§1.4](#14-礼物四方边框gift-effects)），只接收父页传入的对应事件。大航海感谢添加窗提供「辉光」「经典」两张独立卡片（`appearance.config.style=aurora/classic`，旧缺省归一为 `follow`；航海旗帜资源组件仅接收 `nautical` 专属事件）；预览等级、观众昵称和月数（1–999）随预览入口带入画布并回填（不写入场景配置），编辑样例每 8 秒重播、正式来源无样例。`server/scene-gift-events.js` 保留最多 200 条按账号 scope/epoch 隔离的投影窗口，`scene-gift-display.js` 在父页按序列去重并暂存准备期事件（`incrementalParts=1` + `dataVersions` 时未变窗口省略传输）；首次打开、账号代次变化及断线恢复只建立当前基线，已交付事件不在重发布时补播，子页断线清空队列。这些类型不接受 `appearance.mode=shared`，不扩展 `component_output_sizes` 的四类型约束。

月底冲刺 `gift-sprint` 使用 600×80 的独立实例与空外观配置，在组件库的「礼物许愿」分类中添加；编辑画布展示示例进度，正式来源使用当前 `giftSprint` 的投影。管理端将冲刺收进「礼物许愿」顶部折叠区，许愿与冲刺的「打开画布」分别选中对应组件。金额目标和重置仍由「礼物 → 月底冲刺」管理，模板不携带目标或进度；原独立投屏地址保留。

`server/scene-extra-display.js` 复用现有领域读口和叠加层投影；礼物慢读按账号代次、来源版本和日期共享五秒缓存。`getDisplayData` 在本次调用内按需共享一份本地状态快照，点歌板、加班机、歌词和冲刺投影共用该读口；仅含云弹幕或独立领域组件时不读取完整本地状态。下一次调用重新读取，不建立跨请求状态缓存；公共外观读取仍沿用原归属模块。输出异步完成后再次核验账号和场景访问凭证；原展示页的组件模式只接收父页消息，不启动自身 HTTP/WS 数据请求。礼物与小游戏头像按现有 HTTPS B 站图片白名单直接读取，不向子页下发访问凭证。新增类型需通过前后端定义、独立参数、模板和保存/发布一致性测试；若将来扩展共享默认尺寸类型，已有数据库必须追加迁移，不能改写已执行的 v9 建表函数。

场景 HTTP 访问由 `scene-api.js` 提供，`scene-item-controller.js` 只适配文档实例与默认外观。画布会话在 `component-preview-canvas-controller.js` 中持有 revision、冲突与发布状态，保存复用 `component-save-batch.js`。旧工作区和旧场景编辑器入口及其专有会话、模板界面已移除；当前画布继续复用场景文档模型、stage、inspector 和模板数据约定。stage、inspector 和画布视图的只读路径使用模型的冻结快照及快照订阅，避免每个订阅方重复深拷贝；编辑仍通过模型草稿与手势历史提交。

### 心动盲盒收集组件

`/heart-box-collection` 与场景类型 `heart-box-collection` 由 `shared/heart-box-collection.js` / `css/shared/heart-box-collection.css` 共用渲染。`displayStyle=task` 为默认白底、桃色轨道与亮粉填充的四档任务卡，`compact` 为深色紧凑进度；默认视口宽 620，内容高度随样式及奖励显隐自动测量。标题显示本期累计（含手动校准）和下一档目标；累计为 0 时也保留完整轨道、未解锁目标节点和可选奖励。「已收集」为轨道左端内缩的小标签，底色位于轨道填充下方、文字位于上方，0–20 的进度使用同一填充层经过标签而不遮盖文字；已达成节点附勾、未解锁节点带锁。任务卡收集中不重复显示状态文字，全达成后填充保持满格、保留实际超额数量（如 140 / 120）。周五标注「收集已结束」，保留最终结果。

任务卡的 `backgroundStyle` 支持 `white`（经典白）、`sakura`（樱花粉）、`cream`（奶油杏）、`lavender`（薰衣草）、`midnight`（午夜紫），默认 `white`；背景、文字、轨道、节点与奖励卡片一起配色，选项由 `shared/heart-box-collection-appearance.js` 统一提供。客户端「背景样式」与画布参数共用本地 `heartBoxCollectionBackgroundStyle`，自动保存并同步到未指定背景覆盖的独立来源。独立 URL 的 `backgroundStyle` 可固定选择；未知值显示经典白，设置与场景写入仍拒绝未知值。旧配置缺失字段时补为经典白，不改已有紧凑进度的深色外观；切到紧凑进度时隐藏背景参数，返回任务卡恢复已选背景。背景变更只更新显示，不额外读取礼物进度。

布尔展示字段 `showRewards` 默认 `true`，两种样式均可关闭下方城堡、倍率和限开数量，标题、进度与节点保留。组件底部在所有收集状态下均不显示提示文字。客户端与画布共用本地 `heartBoxCollectionShowRewards`，自动保存后覆盖旧图层副本。新复制的裸 `/heart-box-collection` 跟随共享显隐；旧独立 URL 显式指定 `showRewards=false`（或 `0`）仍固定关闭，显式开启也保留覆盖。设置快照只更新显示，不因礼物 revision 未变而额外读取进度。标题与四档奖励分别使用实际心动盲盒、同一张浪漫城堡图片，静态透明 WebP 随组件打包在 `public/img/heart-box-collection/`，来源及转换摘要见该目录 `sources.json`；不依赖运行时礼物目录下载。

管理菜单显示真实数据；画布以 37 / 40 的示例展示四档，正式场景由父页传入当前授权来源的只读投影，子页不另发请求或开连接。独立浏览器源复用许愿信息流的单个可取消轮询及 scoped socket；来源变化清除旧画面，离开管理页停止轮询。服务器周期与解锁规则见[每周任务](../backend/bilibili/gift.md#心动盲盒每周收集)，无需创建普通许愿或配置手动重置。

## 7. 数据消费一览

| 叠加层       | 首帧                                                                 | 实时                                        | 去重指纹                                | 触发重载的 reason                                              |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| queue        | `/api/state`                                                         | snapshot                                    | current+waiting+SC+全部主题键           | `queue:add`/`bilibili:danmaku`/`bilibili:superchat`（80ms 强刷） |
| songs        | `/api/state` + `/api/songs`                                          | snapshot                                    | orderKey/layoutKey/motionKey            | `songs:*`/`cloud:songs`/`database:clear`/`database:clear-all`（220ms 重载） |
| blindbox     | `/api/state` + `/api/gifts/blind-box-stats`                          | 快照、跨日刷新，可选 `r` 轮询               | 统计内容相同保留节点                    | `bilibili:gift*`/`gift:sprint:reset`/`connect`/`settings` 或筛选变化 |
| overtime     | `/api/state`（overtime 字段）                                        | snapshot + `overtime:update`                | `revision` 单调比较                     | `overtime:update` 的 adjustment → 动画入队                     |
| gift-effects | 无触发事件时透明；snapshot 同步官方特效开关 | `gift:frame` / `gift:effect` / `gift:guard-thanks` | 各播放器按 `eventId` 去重；并行动效与串行队列分开，配置缓存与播放见[礼物特效约定](#14-礼物四方边框gift-effects) | 新事件交给对应播放器；刷新不重播历史 |
| opening | `/api/opening/config` | 无 | 无；配置经枚举/文本清洗 | 独立页面每次请求完成后等待 1 秒再读取；收到父页预览配置后停止轮询，组件预览直接接收父页配置；URL 参数可覆盖独立页字段 |
| clock        | `/api/clock/config` + 设备本地时间；URL 参数可覆盖 | `clock` scope settings snapshot + 秒、分钟或月扇换色边界 | HTTP 修订号保护；单一计时器 | 初始读取及重连；快照原位更新 |
| lyrics       | snapshot 中的设置、状态和时间轴                                      | `lyric-state` + `lyric-timeline` + snapshot | 当前行与时间轴内部去重                  | 播放页按状态变化推送                                           |
| danmaku（本机组件） | `/api/danmaku/display` 的 config 与 data | `/api/danmaku/events` 通知后按 epoch/cursor 增量读取，断线回退轮询 | 同一缓冲的 cursor、直播 session 和 reset | 同场断线保留已有消息；确认下播、换场或授权变化清空 |
| danmaku（旧 URL） | snapshot 中的 `danmakuFeed` | `danmaku:message` | 有 id 时按 id；兼容消息按 uid+时间+正文 | 无 reason 重载；断线重连后由 snapshot 恢复 |
| games        | `/api/games/session`                                                 | snapshot + `game:update` + `game:patch` + `game:draw`      | 游戏入口调度器按更新频率合并渲染        | `game:update` / `game:patch` / `game:draw`                                    |
| wheel        | `/api/wheel`，连接成功后补读并有限重试                               | `wheel:update`                            | 状态/抽取 ID 与读取代次                 | 每次 WebSocket 连接成功                                      |

消息类型与 reason 的全集定义以 [ws.md](../backend/ws.md) §3 为准；本表只描述各叠加层接收哪些数据。

歌词性能策略由 `shared/lyric-performance.js` 持有：连续四个超过 45ms 的调度帧减少装饰效果（逐字轻跳、非当前行模糊等），连续填充仍由浏览器 WAAPI 时间轴推进，不因慢帧改为手动刷新或整词跳亮；用户选定的按字点亮模式保持不变。连续 30 个健康帧后恢复完整效果，每次切档重新计数，长帧打断健康计数，恢复后再次卡顿仍按原门槛减少效果。状态直接重绘传入的零间隔不计为健康帧，系统开启「减弱动态效果」时保持静态与低效果，不自动升档。`shared/lyric-frame-scheduler.js` 的 30fps 门控比较保留 0.5ms 时间戳精度容差，避免将浏览器取整后的 33.3ms 跳过至下一帧；传给性能策略的间隔仍是实际测量值，不截断长帧。`lyric-word-animator.js` 只为正在填充的词保留高亮动画，暂停和跳转仍校准到播放位置；不支持 WAAPI 时连续填充回退为手动更新，开启「减弱动态效果」时的静态模式仍按词的结束时间点亮。`opening` 使用 HTTP 配置接口，不订阅快照 WebSocket；`clock` 同时接收受限配置快照。


## 本地场景浏览器来源

场景父页按图层复用发布外观与当前覆盖，覆盖变更或撤销后重新下发，失败保留原有重试。输出以保存的 CSS 像素显示，`scene-renderer.js` 不再按宿主视口缩放整套场景。选中独立组件后点击「组件地址」（无障碍名称「复制组件地址」）使用 `/scene?id=…&item=…#token=…`，服务端直接投影已发布实例到 `(0, 0)`，宽高、样式与整套场景中的这一实例共用同一份配置（导入样式、背景和文本框复用此单图层来源）。

独立组件来源 `/clock`、`/queue`、`/overtime` 与 `/danmaku?source=component` 可直接复制使用，无需打开场景编辑器、创建或发布场景。它们使用已保存的公共外观，与画布内同样式参数同步（显式 URL 参数继续覆盖对应字段）；其他固定来源按 §1.0 的 scope 读取各自领域配置及真实数据，不继承当前选中图层的独立配置或预览示例。这些默认单组件页面通过 `component-output-size.js` 单路读取当前账号保存的输出尺寸（复用各自叠加层身份，不在预览或场景子 frame 内运行；无保存尺寸时保留原行为；请求不重叠，结束后间隔 750ms 重读，8 秒超时，超时由普通定时器触发 `AbortController`，不依赖浏览器源提供 `AbortSignal.any/timeout`）。原点歌板/时钟缩放算法以保存的矩形为可用区域；加班机以保存宽度排版、使用已测量高度。

本机弹幕独立来源的 `danmaku-component-source.js` 与场景共用 `display-source.js`，通过 `/api/danmaku/events` 获知变化后读取 `/api/danmaku/display`（通知健康时每 5 秒校验，断开时回退 750ms 轮询），复用已有云展示缓冲、样式渲染和画布坐标逻辑，不建立本地旧弹幕 WS 或第二条上游 SSE。本机场景与独立弹幕来源均按每条云事件的发送时间显示消息（将带时区时间戳转为毫秒，批量补到时保留各自时间，缺失或无效时使用接收时间；本机生成的开播提示使用本机时间）。首次按 `epoch`/`cursor` 建立读取基线，不生成示例；同场短暂断线、读取失败或游标缺口保留已显示弹幕，恢复后继续追加且不重复开播确认；仅在确认下播、换场、换账号或授权失效时清空（旧 `/danmaku` 本地 WS 行为兼容保留）。

本地直播场景使用 `/scene?id=<UUID>#token=<secret>`。网页点击「保存并应用」更新完整来源；确认删除当前输出场景也会切换到剩余已保存场景，删空则输出透明空画面。布局和资源身份变更需要再次应用；共享外观参数保存后同步到当前输出。OBS 与哔哩哔哩直播姬使用同一浏览器源，尺寸设为场景画布尺寸。输出中未放置组件的区域透明，包含可见组件的实际数据，不含编辑控件、检查底色或示例消息。关闭编辑网页后仍能从本地运行时加载、刷新和接收更新。整场景复制提示使用已发布版本的 `canvas` 宽高，独立图层（含文本框）使用 `itemSizes[itemId]`。只有复制所选共享组件的原始地址时，才读取该组件保存的尺寸。模板导入导出、多选等旧场景编辑器能力保留在其模块中，不作为当前网页入口已提供的功能。

`scene-renderer.js` 与 `scene-source.js` 协作管理场景渲染与增量同步：

- **沙箱子渲染器与版本切换**：`scene-renderer.js` 为可见实例创建无凭证的沙箱子渲染器。新版本的受控视频可暂停预载并回报 `prepared`。全体实例准备成功后，父页显示新容器、释放旧版，再向内部组件发送 `activate`，视频才按配置音量播放。准备失败时旧版继续显示并接收数据，同版本不重载。首次准备失败显示未就绪图层及超时/素材失败原因（且不存在可回退的上一版本），后续输出读取会自动重试；换版失败只记录提示并保留原画面，避免遮挡已成功显示的直播内容。父页把投影回执与已成功显示版本一起提交，准备失败时继续请求旧版所需类型；回执不传给子页面。每个已发送投影的本机样式引用在内存中保留 60 秒。携带活动回执的输出读取和 SSE 服务端心跳通过身份校验后续期。即使隐藏页面暂停轮询，仍连接的 SSE 也可持续保护旧版素材。两条通道同时中断满 60 秒后，单靠旧页面已无法阻止清理。重启服务会清空租约并使旧回执失效。使用 `item` 的独立网页图层向内绘制 iframe 描边，使描边落在输出尺寸内。整场输出沿用外侧描边。`scene.js` 仅从 URL fragment 读取凭证，子页面仅接收外观和显示数据，真实弹幕模式不会生成示例；授权失效清空画面。
- **事件缓冲与游标边界**：首次尚无弹幕订阅方时保留最多 200 条待投递事件，空批次不覆盖增量，队列溢出时标记缺口（`gap`）并保留最新事件；展示纪元（`epoch`）、直播场次或重置（`reset`）变化清除旧批次。游标推进表示事件已交付当前活动页或进入有界待投递缓冲；已交给旧版的事件不在新版重复播放。短暂读取失败保留活动帧已显示的弹幕，离线数据延续同一展示纪元并清除待投递事件；恢复后不重复开播确认。撤销清空全部版本及回执。主进程接收现有 public overlay SSE 并按账号/连接代次隔离，断线报告缺口、不向本地结算管线补消息；同场重连保留已显示内容，展示纪元与游标重置边界见[API 注册表](../backend/api.md#本地场景)。重启且端口不变时来源有效，端口冲突改用其他端口后需重新复制来源。
- **同版本外观更新与配置回执**：同版本共享外观更新以子组件的 `prepared` 回执确认应用，`init`/`config` 与回执携带同一 `configuration` 代次，旧回执不覆盖较新配置。活动帧失败或 12 秒未确认时，父页记录「已保存但应用失败」，后续输出读取对同配置最多尝试三次，仍失败则记录检查素材并刷新来源的提示（不遮挡已有画面）。资源加载失败不缓存 rejected Promise；资源身份变化继续走整版准备。航海旗帜的字号、昵称与头像显隐更新复用已准备的素材与事件队列，原位修改当前文字/显隐，不重复读取三张旗帜或重播已收感谢。
- **通知流与按需云连接**：`scene-source.js` 为共用 `display-source.js` 提供场景查询和游标适配，管理输出读取及 `/api/scene/events` 的 fetch SSE 订阅；`scene.js` 仅负责页面组合。通知只传 `ready`/`change`/`revoked`，数据仍经受限 output 接口读取（沿用场景 Bearer、可选 item 与已提交 version/projection，不向子页面传递）。请求串行且开始至少间隔 100ms，读取期间的新通知合并为一次后续读取；流正常时每 5 秒健康检查，流断开、饱和或接口缺失时回退 750ms 轮询并按 750ms 至 15s 退避重连。初次通知 HTTP 失败不撤销有效输出；收到明确的撤销信号（`revoked`）会中断未完成读取并丢弃迟到响应，输出 401/403/404/423 清空已显示版本与回执。成功提交渲染器后才按新版本/回执重开订阅，`pagehide` 释放全部资源。本机场景或独立组件读取云弹幕投影/默认外观、或有效本机通知流发送 `ready`/`change`/心跳时，由 `display-demand.js` 续期共享云 SSE 需求，最后一次活动后 15 秒释放，再次使用自动恢复；后台 token 续期不撤销来源或重新开播。公共消息 DOM 由 `danmaku-renderer-core.js` 固定源码快照构建，分发规则见 [ADR-0020](../../architecture/adr/0020-shared-danmaku-source.md)。

仅布局变化的发布复用现有版本容器：可见实例 ID/类型集合、内置外观和外部 URL 均不变时，同步更新画布尺寸、位置、显示大小、名称、层级及外部网页分辨率，不移动或重载 iframe，显示版本与投影回执一并推进。纯 `browser`/`clock` 场景不读取业务状态快照；文本框只读取共享舰徽所需的 `roomGuard`；其他端口每轮按所需字段共享一次读取，歌词输出只读取 `lyricState`/`lyricTimeline`，外部网页数据直接来自供应方。

场景歌库投影按归属 scope、授权纪元（`epoch`）和歌曲数据库变更标记复用查询结果；歌词正文按同归属的时间轴对象复用投影。父页通过可选 `dataVersions` 确认已收到的歌单、歌词正文、礼物滚动、盲盒、队列、转盘和游戏数据，之后不变部分省略，播放状态继续更新；盲盒每次核验统计变化（账本、来源代次、账号、本机日界或心动盲盒筛选变化时重发完整榜单）；队列、转盘和游戏的类型通知及账号变化使版本失效，并保留每 5 秒重新读取的恢复核对。旧调用保持完整响应，具体字段和校验见[本地 API](../backend/api.md)。渲染器合并部分更新，保留静态内容用于新 iframe 准备；当前歌词帧只更新播放状态时保留原时间轴。礼物滚动在完整历史分页和身份资料版本均未变时复用分组卡片（门槛变化只重做过滤，目录变化更新素材索引，失败头像继续重试）。

转盘仅在选项文字、权重或字号变化时重建扇区与标签。标签在扇区安全范围内换行并调整字号，停转后的文字保持正向；放不下的名称以编号和完整图例显示，极窄扇区通过对应色块图例识别，不截断名称。抽取动画仍按 spin ID 接纳；重新打开或恢复已结束结果时，直接把中奖扇区中心对准上方箭头，不重播抽取。清空结果会使旧动画回调失效，颜色、显隐和结果照常更新。场景绘画只在 session、轮次、画布 revision 或实际画布尺寸变化时重放历史，空会话后恢复也重画；主机画笔的增量与乐观绘制保持原路径。禁用工具只有在取消未完成笔画时恢复画布，不重复重放未变化的历史。

### 文本框 `/text-box`

配置版本 1 的可选 `scrollMode` 为 `none` / `horizontal` / `vertical`，缺省 `none`；可选整数 `scrollSpeed` 为 10–200 设计像素/秒，缺省 40，旧配置维持原速度。客户端与画布共用「文字排版」「自动滚动」两个设置分区，解释使用 `lira-help` 问号组件；横向、纵向滚动开关互斥，下方的「滚动速度」滑杆使用同一份实例配置。两个开关都关闭时隐藏速率区域并保留数值，再次开启或切换方向继续使用该值。编辑区始终静止；横向输出将换行显示为空格并单行向左播放，纵向保留换行及自动折行向上播放。实际速度随组件宽度等比缩放；短文也会滚动，关闭时恢复原有静态排版。

可选 `backgroundColor` 接受六位或八位十六进制颜色，缺省 `#00000000`，旧场景保持透明；颜色及 alpha 随场景保存、发布、复制和模板往返。文字排版区复用共享「颜色与不透明度」控件，提供「恢复透明」。底色覆盖完整组件视口，正文滚动时底色静止；仅修改底色不重建正文或重置播放。客户端预览台居中等比展示带边界的实际视口，外层留白不改变直播布局；检查底色仅供预览，与输出背景分开。编辑即时更新预览，直播仍需手动「保存并应用」。

`overlays/text-box-scroll.js` 负责输出播放和清理：固定视口以原生滚动偏移移动单份正文，前后各留一个视口的空白，在内容完全离屏时循环，不复制长文或动图，也不建立整段长文的移动 transform 图层。rAF 只更新偏移，正文/排版配置、窗口尺寸或素材尺寸变化时才测量；相同配置或仅速率改变不重建 DOM、不重置进度或增加动画循环。编辑器内容签名排除 `scrollMode`、`scrollSpeed` 与 `backgroundColor`，调整播放及背景参数保留原生撤销。页面隐藏时暂停，恢复时接着播放，销毁时释放帧、观察器和事件。

长文按格式片段渲染，不逐字创建元素。多行纯文本粘贴通过 `textContent` 和既有渲染器构造转义片段，以单次原生插入保留换行、插入位置格式及撤销；不采用剪贴板 HTML，不逐行触发编辑和场景更新。切换播放参数不重建编辑器。文本仍受整个场景 256 KiB UTF-8 文档限制约束。

`shared/text-box-config.js` 校验结构化 text/gift/image 节点，`shared/text-box-renderer.js` 同时供编辑区与输出使用。编辑态的礼物/上传图片是不可编辑的完整方块，保留节点字号（缺省跟随整体字号），内部图片与输出态使用相同的相对字号比例，不另行缩小方块；输出态只渲染图片，保留动图原文件和长宽比。文字通过 DOM `textContent` 渲染，不接受任意 HTML。`overlays/text-box.js` 通过既有组件预览协议接收每份独立配置，以 640px 设计宽度随组件宽度整体缩放。

许愿文字版的 `admin/gifts/wish-text-editor.js` 对正文和不可拆分变量块统一调用 `shared/text-style.js`，将 `textRuns` 中的字体、字号、字重、斜体、下划线、描边与阴影应用到编辑内容；变量块仅保留编辑态的底色和默认提示色，不另设字号或字重。插入变量块和纯文本粘贴读取光标处的格式，位于变量块边界时使用其格式数据，避免把提示色写成输出颜色；保留原生撤销。右侧预览、已保存预览和直播输出继续共用 `shared/gift-wish-card.js`，使用相同片段格式。

管理端 `text-box-preview.js` 在客户端详情和画布参数区挂载同一个 `text-box-editor.js` 与 `text-box-media.js`：

- **富文本工具栏与格式节点**：`rich-text-toolbar.js` 统一负责文本框和许愿文字版的浮动选区工具栏、快捷键、字体与字号选择（调用 `shared/font-library.js` 并在销毁时注销）；`rich-text-format-controls.js` 负责常用/最近/自定义色板及描边、轻阴影、清除格式入口（最近 6 色存于 `admin.textBoxRecentColors`，不进入场景文档）。`text` 节点支持可选 `fontFamily`（非空、最多 200 个 UTF-16 码元，不含控制字符及 `;{}<>`）与布尔 `stroke`/`shadow`（随字号缩放的深色描边/阴影）；清除格式只重置选中文字，保留素材、未选中文字与原生撤销。
- **实例保存与放弃确认**：`text-box.js` 复用场景草稿与发布控制器管理多份实例，并携带实例 ID 打开画布。保存状态通过对比草稿与已保存文档中的文本框实例，区分「文本框有未保存修改」与「场景其他内容有未保存修改」；顶部仅显示圆角文本框切换标签，「复制链接」位于当前项名称旁，保留「保存并应用」「放弃修改」短按钮。保存仍发布整个场景，常驻短提示与问号说明发布范围；切换当前输出或连带其他场景内容/引用共享组件草稿时先确认（等待弹窗期间状态为「等待确认」），放弃包含文本框外修改时同样先确认。无文本框全局默认存储或业务订阅，正式直播使用已发布的 `/scene` 组合/单组件地址，裸 `/text-box` 仅为无凭证子渲染页面。

## 服务器订阅地址与旧画面退役

服务端 ADR-0118 已退役 `/overlay` 及其所有子路径的画面、预览和静态资源，统一返回 404；网页主播中心不再提供弹幕分区或地址复制。正式画面使用客户端提供的本机场景或组件地址，并保持桌面运行。服务器采集和 `/api/public/overlay/events` SSE 继续保留；Device/Streamer `overlay-settings` GET/PUT 及返回字段保持兼容。`overlayUrl` 仍按 ADR-0056 使用 `/overlay/<16位base64url>`，由服务器按认证租户生成并持久保存，但现在只用于事件订阅定位和凭证格式，不能用作直播软件的画面地址。客户端「浏览器源」仅提供本机弹幕组件与场景入口，不再展示或复制旧在线源。`server-overlay-url.js` 保留兼容读取与账号变化观察，过滤等既有远端配置仍使用该生命周期；地址验证、授权资料补全和迟到响应丢弃不变。新弹幕参数与场景地址改用 `authorized-account.js` 的共享授权观察，不再依赖旧外观 URL 读取成功。场景源由本机场景 API 提供，不能从域名拼接或把 DeviceBearer 交给页面。

`danmaku-overlay-settings.js` 通过本机 API 读取与保存，保留草稿控制器的失败、重试及账号变化处理。失败时不以默认值覆盖已有配置；首次旧配置导入失败可重试，成功后的新样式保存不依赖服务器支持。共享授权观察用代次拒绝迟到的初始快照，token 续期不重置草稿；API 使用主进程提供的真实归属对象和授权 `generation` 拒绝跨账号或重新登录后的晚到写入。

验收：首次加载两个观察者收到相同完整订阅定位 URL；错 origin、裸路径、带 query/hash 或非法长度拒绝；切换账号清除旧 URL；本地预览与草稿行为不变。这些检查验证兼容地址解析，不代表旧 HTTP 画面可用。自动化见 `test/danmaku/server-danmaku-settings.test.js` 与 `test/danmaku/danmaku-overlay-ipc.test.js`。

## 投票与评分 `/interactions`

独立 `interactions` scope，仅展示当前类别 3 会话；空场透明。推荐浏览器源 800×600，投票支持 1–6 个选项。管理端预览、主持端结果和实际投屏共用紧凑结果行：轨道最小高度 56px，行间距 8px，长文字自然撑高。卡片和选项区随内容增减高度，全部选项同时展示，不设内部滚动或自动翻页；实时更新保留 DOM。

投票选项按原文精确匹配优先；未精确命中时，只有唯一简繁等价选项才计票。若同时配置「头发」「頭髮」，两项各自的原文仍有效，「頭发」等无法唯一确定的变体不计票，也不消耗观众首次有效投票机会。选项展示与一人一次规则不变。

投票使用固定顺序与 0–100% 标尺，票数/百分比固定在完整轨道内，零票不隐藏；结束标最高/并列最高，零参与无胜者。评分内容最大宽度为 460px，规则文案可自定义，默认说明 1–10 分、只发整数及取最后一次评分。多行输入保留换行，长文本（含连续英文）按卡片宽度自动折行，卡片随内容增高，规则留空则隐藏，不固定行数。底部独立均分框在收集中显示占位「—」，不显示均分或人数，结束后显示两位小数及人数；无人评分显示「暂无评分」。接收曾中断时保留提示。页面 GET、刷新或开多个实例均不启动/延长收集。截止由本地服务控制，与页面可见性无关。

选项文字位于进度条内左侧，票数与比例右对齐。整体底色透明，默认深色文字、浅青色填充，投票不再展示完整规则说明。标题和提示默认空、留空隐藏，不回退到本场主题。管理端「直播画面」按内容、颜色、布局与显示分组，左侧编辑、右侧棋盘格背景预览；窄窗口将预览放到编辑区上方。客户端与画布可调整标题、提示、评分规则、文字/进度条/轨道颜色、整体不透明度、文字大小、卡片圆角、状态和人数显示，不提供整体背景颜色或背景不透明度控件。整体不透明度同时影响卡片全部内容；字号 16–24px，结果行随文字换行自然增高。隐藏人数不隐藏接收中断警告，也不提前公开评分汇总。标题与状态均隐藏时折叠标题区，底部无人数或警告时折叠底部。

草稿即时预览，可切换投票或评分，预览明确使用示例数据；进度条色也用于最终均分框。预览与浮层共用外观样式，按卡片宽度调整选项内的排列。点击应用后通过既有 `/api/settings` 保存并广播，恢复默认也先进入草稿。设置键与默认值见 [storage.md](../backend/storage.md)；只有 `interactions` scope 接收这些展示设置。样式更新不改变会话或选项节点；评分浮层共用这套外观。

标题与提示的字素长度、RGI emoji 和不可见字符校验由桌面与 Node 写入端负责。`interaction-rules.js` 在调用校验时构造 Unicode `v` 正则，避免旧浏览器在导入模块时发生语法错误；`readInteractionAppearance` 渲染已保存标题/提示时只做 trim/NFC，不重复执行写入校验。其他外观字段保留原有归一化规则，文字仍通过纯文本 DOM 显示。Chromium 106 的投票、评分及已保存 emoji 标题已通过独立来源检查。

## 森间手绘固定样式

`sketch`（森间手绘）为透明背景固定弹幕，复用列表滚动。普通观众使用第一种卷线昵称框与素色色带；大航海用户（`guardLevel` 为 1、2、3，即总督、提督、舰长）使用第二种猫兔藤叶框，色带内带有层叠枝叶与浅色花瓣。仅佩戴粉丝牌或主播标记不触发第二种。头像/徽章/礼物原图隐藏；昵称、正文、表情和礼物均保留真实内容。礼物开放式排版显示名称、数量和已结算总额（两位小数，货币符号在后；缺失金额显示 `—`）。SC 保留完整原文与两位小数金额，使用同主题边框。

既有 `textColor` 在此样式作为「主题颜色」，默认 `#7f9f76`，正文使用原色，昵称、礼物、描边、矢量装饰与柔边色带派生协调浅色；枝叶底纹随主题色变化，背景不透明度同步调整色带及其底纹，文字与外框线稿不透明。支持字体、18～48 字号和上下滚动，不接受随机位置/速度/礼物图片参数。旧布局缺少 `sketch` 时仅补齐 480×700 默认区域；切换或恢复参数不改变其他样式。两端 CSS 与装饰模块保持一致；颜色源为 CSS 变量，装饰无外部请求、无定时器。

## 共用大航海身份图标

`public/js/shared/bilibili-room-guard.js` 只维护当前房间人数、订阅与 `isThousandGuardRoom(count)` 判断，不依赖 DOM、素材或网络。人数来自既有快照的 `guard_info.count`：严格大于 1000 使用千舰款，1000 及以下或未知使用普通款，10000 以上仍使用千舰款。`public/js/shared/bilibili-guard-icons.js` 负责素材选择与展示更新：`getGuardIcon(level)`、`getGuardAvatarFrame(level)` 分别返回当前档位的舰徽和头像框路径，均调用同一人数判断；`bindGuardImage` 绑定已知图源，`applyRoomGuardState` 接收快照并更新已有图片及 `--bilibili-guard-*`、`--bilibili-guard-*-frame` CSS 变量。普通头像框复用 `danmaku-guard/bubble-*-frame.webp`，千舰头像框复用 `danmaku-harbor/*-frame.png`，来源见 `danmaku-harbor/sources.json`；舰徽位于 `public/img/admin/gifts/`，来源见同目录 `guard-icon-sources.json`。既有 `getRoomGuardState`/`subscribeRoomGuardState` 导出继续兼容调用方。

接入点包括粉丝档案、最近礼物与提示、加班礼物选择、礼物横幅/许愿、文字组件、点歌队列、流霞/雪狐身份和月渡/雾语/航海 CSS 舰徽。历史数据保留原图地址，渲染时解析，不迁移持久数据或替换用户自选图片。管理端 StateService、叠加层 socket、正式场景与网页画布预览沿既有数据连接同步；预览订阅在关闭时释放，无每张图单独请求。人数更新不重建消息队列。「聊天气泡」「对白」及礼物横幅中已有的等级头像框同步切换，普通观众不新增头像框；独立大航海感谢主题插画仍使用各自样式规则。

`scene-renderer.js` 为每个已就绪 iframe 记住最后发送的 `roomGuard`，相同房间人数状态不重复跨 frame 发送。首帧、人数或房间变化、空状态及重建的 iframe 仍立即同步；已验证来源的子页面重新发送 `ready` 时清除该缓存，使同一 iframe 重载后也能在下一次数据更新恢复舰徽状态。礼物与弹幕事件通道保持原交付规则。
