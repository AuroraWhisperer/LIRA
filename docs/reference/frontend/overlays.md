# 直播画面悬浮层(overlays/)

直播平台为 B 站；OBS 与哔哩哔哩直播姬均通过浏览器源 / 网页来源使用这些画面。文中的 overlay 指通用直播展示页。本机画面使用 `127.0.0.1`，要求与 LIRA 同机并保持客户端运行；既可用直播场景的一个来源，也可直接导入独立组件。在线弹幕姬使用服务器返回的完整 HTTPS 地址，关闭客户端后仍可展示。本机 `/danmaku?source=component` 是独立组件来源，`/danmaku?preview=1` 是示例预览；完整操作见 [组件与浏览器源指南](../../guides/component-sources.md)。

> 涉及文件:[pages/overlays/queue.html](../../../public/pages/overlays/queue.html)、[pages/overlays/songs.html](../../../public/pages/overlays/songs.html)、[pages/overlays/blindbox.html](../../../public/pages/overlays/blindbox.html)、[pages/overlays/overtime.html](../../../public/pages/overlays/overtime.html)、[pages/overlays/lyric-window.html](../../../public/pages/overlays/lyric-window.html)、[pages/overlays/opening.html](../../../public/pages/overlays/opening.html)、[js/overlays/](../../../public/js/overlays)、[css/overlays/](../../../public/css/overlays)

本文档描述各个叠加层页面的框架、数据消费与各自 UI。快照字段与消息类型见 [ws.md](../backend/ws.md),客户端通信行为见 [comms.md](comms.md),页面入口 URL 见 [pages.md](pages.md) §2,加班机领域状态见 [backend/overtime.md](../backend/overtime.md)。

### 实时榜单

画布「添加组件」首项为「实时榜单」，选择「实时四榜」添加独立图层；使用本地静态缩略图，不为组件选择列表发起榜单请求。选中后的参数与实时数据沿用同一场景组件。

`live-rankings` 是独立场景组件，默认 1080×940，通过 `/scene?id=…&item=…#token=…` 输出。`/live-rankings` 仅为沙箱渲染壳，匿名加载不返回榜单，数据由受保护父场景通过原组件协议交付。组件及客户端共用 [live-rankings-view.js](../../../public/js/shared/live-rankings-view.js)，字段和范围选择归 [live-rankings.js](../../../public/js/shared/live-rankings.js)；接口与调度事实见 [Bilibili API](../backend/api.md#实时四榜)。

| 配置 | 默认与范围 |
| --- | --- |
| `showHot/showNew/showPopular/showArea` | 四个榜单分别开关，默认全开 |
| `range/nearby` | 默认 `nearby`，当前房间上下各 2 名，可设 0–10；`all` 展示完整榜单并翻页 |
| `pageSize/pageSeconds` | 完整榜每页 5 行（3–20），每 8 秒翻页（3–30） |
| `columns/theme` | 每行 2 榜，可选 1/2/4；浅色，可选深色或透明底 |
| `fontSize/showAvatar/accent` | 18px（12–32）、显示头像、本房间强调色 `#f25483` |

名次与原始热度值 / 助力值保持分离，不换算成礼物票数。当前房间按房间号高亮，完整榜额外固定显示自身排名和差距；附近模式在列表包含本房间时省略重复的固定行。未上榜、未获参榜资格或上游没返回附近名次时如实说明，不生成虚构邻居。客户端完整列表可滚动；直播源完整榜自动翻页，增加行数或改成一栏时应相应增加组件高度或减小字号。

行节点按房间复用；250ms 本地时钟只更新倒计时和翻页，不调用 B 站。超过两秒未成功更新或请求失败显示延迟和数据年龄。管理标签隐藏 / 暂停时解除自己的订阅，其他展示可继续；编辑网页连接、可见榜单图层和已打开的来源决定是否继续消费。外观只随场景保存，实时榜单不落库。

### 本地媒体样式

[component-media-style.js](../../../public/js/shared/component-media-style.js) 定义独立组件配置中的可选 `mediaStyle`，服务端 `normalizeSceneConfig` 统一校验。支持 background、opening、danmaku、clock、gift-wishes、gift-frame、guard-thanks；新增字段不改变原业务配置与事件。字段如下：

| 字段 | 含义与范围 |
| --- | --- |
| `id/src/kind` | 样式 UUID、受限本机素材 URL、image 或 video；导入服务生成，清单不能覆盖 |
| `width/height` | 原图或设计画布像素，整数 1–7680 |
| `content` | `{x,y,width,height}` 百分比内容区，必须在 0–100 内，宽高至少 5 |
| `textColor/fontSize` | 六/八位十六进制颜色（可含 Alpha）；12–200 像素 |
| `showText/textTemplate` | 事件素材是否叠字；文案最多 160 字，支持 `{name}/{gift}/{count}/{tier}/{months}` |
| `durationMs/textDelayMs/volume` | 事件最长播放 250–120000 ms、叠字延迟 0–60000 ms、视频音量 0–1；默认静音 |

装饰由 [component-media.js](../../../public/js/overlays/component-media.js) 组合在原 clock/danmaku/gift-wishes 根节点外，图像填满组件，内容限制在配置区；背景隐藏内置画面。背景与装饰视频循环。时钟禁用内置自动缩放以使用设定内容区；弹幕和许愿数据仍由各自 owner 更新。

gift-frame/guard-thanks 使用同一媒体事件播放器接入既有去重与顺序队列；图片按时长显示，视频取实际结束或配置时长较早者。省略时长的视频默认上限 120 秒，图片 6 秒；文件选择器读取视频时长作为默认值。开播素材在正式输出中随原开关从关变开播放一次，关停立即隐藏；轮询同一开启状态不重播。编辑画布中的开播素材播完后间隔 1 秒循环，关闭总开关时静音，切换样式、断开或销毁时停止循环。礼物预览循环按整段素材及事件数安排，不每 8 秒截断长素材。结束、重置或 dispose 清除定时器并暂停视频。

`component-preview-client` 等待装饰和事件素材就绪后才报告 prepared；编辑预览在此时结束加载提示，成功更换样式也会清除此前的加载错误。失败报告外观准备失败，正式来源保留上一版本。所有动态文字用 `textContent`，图片/视频不执行包内代码。正式场景仍遵守保存应用边界；网页源保持原单独组件合同。作者文件格式见[套装指南](../../guides/component-style-packages.md)。

### 第三方网页与 CSS

所有组件样式库复用 `component-source-import.js` 的统一「选择文件」和折叠「粘贴网址或代码」入口。文件按扩展名自动分流 HTML/CSS、ZIP 确认和媒体编辑；粘贴内容自动区分 HTTP(S) 地址、HTML 与 CSS。名称、尺寸和文件夹选择放在「更多设置」；文件夹优先使用根首页、唯一首页、唯一 HTML 或唯一样式，歧义时才展开选择。网页/CSS 默认尺寸为弹幕 480×720、其他组件 800×600，媒体尺寸沿用编辑器读取结果，ZIP 沿用作者清单。桌面由主进程选择文件并复制网页配套目录，浏览器回退为显式选择文件或文件夹；不需要作者清单。库中的 HTML 保留导入分类，使用 browser 组件保存和输出；替换保留图层几何与身份，browser 样式库允许再选任何已导入 HTML。删除库卡片仍保留正在使用的资源。

`component-css-style.js` 定义 `cssStyle:{id,src,engine,width,height}`，`src` 仅允许本机导入路径，宽高为 32–7680，`engine` 为 native/blivechat/blc，后两者仅用于 danmaku。入口及本地 CSS imports 一起识别宿主。CSS 与媒体/资源样式互斥，组件内通过带 CORS 的 link 加载；CSS 加载失败或没有有效规则时报告失败，正式输出保留旧版。选择其他内置样式或「改用内置样式」移除 CSS。

`/imported-danmaku` 是无凭据、`sandbox allow-scripts` 的子渲染页；预览与 scene 共用相同 DOM，scene 只接收已有 LIRA 弹幕展示投影，不读取管理 API、不生成示例。它提供常见 blivechat/YouTube 与 BLC 消息结构，非这两套结构的专用选择器不保证兼容；LAPLACE 特征会提示使用原网页或配套 HTML。第三方 HTML 在原有 browser 沙箱中执行，保留原相对资源与脚本，数据仍来自作者网页；不代理原工具 API，也不注入 LIRA 权限。文件与 API 限制见[组件样式库 API](../backend/api.md#组件样式库)。

### 背景外观参数

[background-appearance.js](../../../public/js/shared/background-appearance.js) 定义 background 配置顶层的通用字段，适用于普通图片/视频与资源型背景。服务端沿用场景字段白名单、数值范围与步长校验；其他组件不接受这些新增字段。

| 字段 | 范围、默认值与行为 |
| --- | --- |
| `opacity` | 0–1，步长 0.01，默认 1；整个背景及遮罩一起透明，不影响其他组件 |
| `blur` | 0–30 px，整数，默认 0；cover/fill 外扩三倍模糊半径避免容器边缘露白，contain 保留素材边缘 |
| `fit` | cover / contain / fill，新增样式默认 cover；旧 mediaStyle 场景未声明时保留 fill |
| `brightness/saturation/contrast` | 0–2，步长 0.01，默认 1；依次应用模糊、亮度、饱和度、对比度，原始效果不启用滤镜 |
| `overlayColor/overlayOpacity` | 六位十六进制颜色，默认 #ffffff；强度 0–1、步长 0.01、默认 0。无背景时不显示遮罩 |
| `colorProcessing` | standard / legacy；新中性配置默认 standard。未声明且 temperature、tint 或任一旧分区强度非零时自动补 legacy，保留旧效果。新作者必须明确写 standard |
| `temperature/tint` | number，−100–100，整数，默认 0；色温负冷正暖，色调负绿正洋红。相对调色量，不是开尔文；standard 使用 CAT02，legacy 使用旧 RGB 增益 |
| `liftRed/liftGreen/liftBlue` | number，−1–1，步长 0.01，默认 0；标准模式逐通道 Lift 系数，抬高/压低黑场端 |
| `gammaRed/gammaGreen/gammaBlue` | number，0.1–3，步长 0.01，默认 1；标准模式逐通道 Gamma 系数，大于 1 提亮中间调 |
| `gainRed/gainGreen/gainBlue` | number，0–3，步长 0.01，默认 1；标准模式逐通道 Gain 系数，改变白场端 |
| `preserveLuminance` | boolean，默认 true；仅 legacy 生效，在裁切到色域前保持 sRGB 加权亮度。standard 不应用此扩展，面板隐藏该项 |
| `shadowColor/midtoneColor/highlightColor` | 六位十六进制颜色，默认 #ffffff；仅 legacy 生效，暗部、中间调、亮部的乘色，白色中性；不是 LGG |
| `shadowStrength/midtoneStrength/highlightStrength` | number，0–1，步长 0.01，默认 0；仅 legacy 生效，各区域染色强度 |
| `glowMode` | normal / streak / star，默认 normal；柔光 / 横向光条 / 十字星芒 |
| `glowStrength` | number，0–2，步长 0.01，默认 0（关闭）；亮部辉光以 screen 混合到背景 |
| `glowRadius` | number，0–60 px，整数，默认 12；柔光标准差为半径的一半；横向光条的纵向标准差为横向的 1/8，星芒为两条正交光条的平均 |
| `glowThreshold/glowSoftness` | number，0–1，步长 0.01，默认 0.7 / 0.2；高于阈值的亮部产生辉光，柔和度决定阈值之后的渐变区间；阈值 1 时无亮部被选中 |
| `irisBlur` | number，0–30 px，整数，默认 0（关闭）；周边高斯模糊的标准差为此值的一半 |
| `irisRange/irisSoftness` | number，0–1，步长 0.01，默认 0.45 / 0.3；中心清晰区域半径及向外过渡宽度 |
| `irisCenterX/irisCenterY` | number，0–1，步长 0.01，默认 0.5；左上角为 (0,0)，右下角为 (1,1) |
| `vignetteColor` | 六位十六进制颜色，默认 #000000；边缘覆盖颜色 |
| `vignetteOpacity` | number，0–1，步长 0.01，默认 0（关闭） |
| `vignetteRange/vignetteSoftness/vignetteRoundness` | number，0–1，步长 0.01，默认 0.55 / 0.45 / 0；中心区域半径、过渡宽度、圆度。圆度 0 随画幅拉成椭圆，1 为圆形 |
| `vignetteCenterX/vignetteCenterY` | number，0–1，步长 0.01，默认 0.5；坐标与周边模糊相同 |
| `levelsChannel` | rgb / r / g / b，默认 rgb；一次调整 RGB 全体或一个颜色通道 |
| `inputBlack/inputWhite` | number，整数，范围 0–254 / 1–255，默认 0 / 255；必须 inputBlack < inputWhite |
| `gamma` | number，0.1–3，步长 0.01，默认 1；大于 1 提亮中间调 |
| `outputBlack/outputWhite` | number，整数，范围 0–254 / 1–255，默认 0 / 255；必须 outputBlack < outputWhite |
| `grainStrength/grainSize` | number；强度 0–1，步长 0.01，默认 0（关闭）；大小 1–8 px，步长 0.5，默认 1；固定种子的单色颗粒，无逐帧闪动 |
| `playbackRate` | 0.5–2，步长 0.05，默认 1，仅视频生效 |
| `volume` | 0–1，步长 0.01，默认 0；旧配置未声明时读取 mediaStyle.volume；静态背景保留值但不显示控件 |
| `backgroundDefaults` | 可选的上述背景参数快照，不包含 style、媒体路径或嵌套快照；导入时由客户端生成，随实例保存，用于恢复样式默认 |

字段使用扁平 `config`，不能嵌套 `filters`、`whiteBalance` 等对象。所有数值以表中单位保存；界面标 `%` 的字段乘 100 显示，色温/色调、色阶、px、倍速使用原值。颜色只接受 `#RRGGBB`，不接受 CSS 表达式。省略字段补默认值；未知字段、非有限值、越界、错误步长和黑白场次序均被拒绝。完整可复制清单及导入步骤见[背景样式包作者指南](../../guides/background-style-packages.md)。

固定处理顺序：全局模糊 → 亮度 → 饱和度 → 对比度 → 白平衡 → LGG（standard）或旧分区乘色（legacy）→ 色阶 → 辉光 → 周边模糊 → 暗角 → 颗粒 → 原有全画布颜色遮罩 → 整体不透明度。两种调色模式互斥，隐藏字段保留值但不生效；切换不会换算数值，可能改变画面。滤镜仅作用于背景组件，不处理其他组件或人物。

`background-filters.js` 的标准白平衡与 LGG 使用 SVG `linearRGB`，其他步骤使用 sRGB。数学 owner 为 [background-color-science.js](../../../public/js/overlays/background-color-science.js)，移植 [Unity PostProcessing v1](https://github.com/Unity-Technologies/PostProcessing/tree/933df236f509ed64ae5763ed57af33f2342cd1c2) 的 `CalculateColorBalance`、`WhiteBalance` 和 `LiftGammaGain`，该固定版本为 MIT，完整许可随模块发布。未使用 v2 的受限许可代码，也不是 Unity 完整的 HDR/ACES/色调映射管线。

标准白平衡采用上游 `/55` 缩放和 D65 参考白点，合成为 `LMS_TO_LINEAR × diag(balance) × LINEAR_TO_LMS` 矩阵；不叠加自定义“保持亮度”。标准 LGG 每通道计算 `v = gain × (c + lift × (1−c))`，正值再做 `v^(1/gamma)`，负值最终裁切至 0，输出限制在 SDR 0–1。`c` 为线性 RGB；不是对 sRGB 字节值直接求幂。SVG 在阶段边界限制色域，不能恢复 HDR 高光。字段是实际 RGB 系数，不是 Shoost/Unity 色轮位置或色轮主控滑块值；范围是 LIRA 系数接口边界，不宣称 Shoost 数值兼容。

legacy 保留原 RGB 增益及亮度补偿。亮度权重为 (0.2126, 0.7152, 0.0722)，分区蒙版取白平衡后的亮度 L，权重依次为 `(1-L)²`、`4L(1-L)`、`L²`，以强度混合乘色结果。色阶使用 256 点 LUT：`outputBlack + (outputWhite-outputBlack) × clamp((v-inputBlack)/(inputWhite-inputBlack),0,1)^(1/gamma)`。辉光渐变为阈值到阈值加柔和度之间的 smoothstep；柔和度 0 时为硬阈值。辉光、径向蒙版与颗粒仍为 LIRA 的 SVG 实现，参数概念来源和差异见[成熟工具与背景制作流程](../../guides/background-art-workflow.md)，不能称为 Shoost 算法移植。

径向蒙版的坐标按素材显示元素归一化。默认椭圆的半径 1 对应居中时画幅角落，圆度 1 时圆半径 1 对应短边的约 0.707 倍；中心区内无作用，从 range 到 `min(1,range+softness)` 线性增加，range 为 1 时基本没有边缘效果。周边模糊使用默认椭圆。滤镜最后恢复输入 alpha，不把透明图片或 contain 留白涂实；全局模糊先于此步骤，会按原有行为柔化 alpha。原有颜色遮罩仍覆盖整个背景画布，包括留白。

`admin/background-parameter-view.js` 通过当前实例 controller 即时预览，基础参数展开，其余效果分组折叠，播放参数仅视频可见。更换库样式加载该样式当前外观及作者默认快照，保持图层几何信息。资源背景的编辑与恢复按样式 ID 保存并同步；普通媒体背景仍只修改当前实例。旧包无需重打，缺失参数采用客户端默认值；已用实例不随新版包修改。预览与正式输出共用 `background.js`、`background-filters.js` 与 `background.css`；调参不重建素材元素或重置视频进度。不新增解码器副本或逐帧 JS 循环；默认中性参数不建立 SVG 滤镜，反复调参复用一个 filter，销毁时清理节点和尺寸监听。

### 窗映四时背景

`windowlight-background` 是 `background` 的受信资源预设，固定 `style: 'windowlight'`，设计尺寸 1920×1080。外置包提供晴天、黄昏、雨天、夜晚四张样式卡片，每张默认手动显示对应场景，四景均持续播放动效；手动与自动模式只决定场景切换，不控制动效开关。四张卡片共用同一包中的全部八张 WebP。成品素材为 1920×1080，包含四种光照的场景底图，以及独立的 `dappled-light` 投光、`prismatic-light` 虹彩、`window-mask` 窗玻璃遮罩与 `lamp-light` 灯光素材，逻辑路径为 `img/overlays/backgrounds/windowlight/`。没有前景百合层。画面以用户确认的四张实际截图为构图依据，结合 BV1nEHQ6iEkB 重新创作，不是原作者工程或逐帧相同复刻。

[scene-extra-components.js](../../../public/js/shared/scene-extra-components.js) 拥有以下顶层字段，后台沿用字段白名单与范围校验。它们独立于通用 `BACKGROUND_FIELDS` 和 `backgroundDefaults`，恢复滤镜默认不改变场景或轮播设置。

| 字段 | 默认值 | 契约 |
| --- | --- | --- |
| `sceneMode` | `manual` | `manual` 手动选择；`auto` 定时轮播 |
| `windowScene` | `sunny` | `sunny` / `sunset` / `rainy` / `night`；手动显示场景，自动模式的起始场景 |
| `sceneIntervalSeconds` | `300` | 10～3600 秒的整数；自动模式从所选场景开始，按晴天→黄昏→雨天→夜晚循环 |

[background-windowlight.js](../../../public/js/overlays/background-windowlight.js) 拥有素材解码、场景切换和生命周期；[background-windowlight-effects.js](../../../public/js/overlays/background-windowlight-effects.js) 拥有局部光照与玻璃水滴；[background-windowlight.css](../../../public/css/overlays/background-windowlight.css) 拥有合成、适配与场景过渡。四景从同一张 1920×1080 重绘合成底稿派生，从房间左侧斜看右侧窗户，窗框侧面、斜向窗台和桌沿体现纵深，室内物件位置保持一致。主体使用 1374×1145 近景生图并补绘左墙，来源与提示词保存在素材目录的 `provenance.json`，不是原生全景 4K。

光照以约 30 fps 更新：固定投光范围内的空间变化模拟树影遮挡，虹彩与灯下折射只作局部微移；不平移整张光纹、不周期性改变台灯本身亮度。WebGL 不可用时显示静态光层。雨滴通过 Canvas 折射雨天底图，具有各自的停留、加速、汇聚和短暂尾痕，玻璃遮罩排除斜向窗框及室内物件。两张动效画布的尺寸与底图同为 1920×1080，跟随 `cover`、`contain`、`fill` 一致适配。通用外观滤镜处理合成背景。页面隐藏时停止动画帧和轮播，恢复后继续；减少动态效果时特效静止，自动轮播仍有效。重复配置不增加节点或轮播计时器，调整滤镜不重置轮播场景，销毁清理动画帧、图形资源、节点和计时器。

`admin/scene-extra-preview.js` 仅在该原生样式显示场景切换、场景与轮播间隔；自动模式仍可选择起始场景，间隔仅自动模式可见。四张卡片属于同一种背景组件，通过背景分类导入；操作与导出见[窗映四时分层背景](../../guides/background-style-packages.md#窗映四时分层背景)。

### 资源型样式

资源型样式是单个组件的外观实现，可以单独交付，也可以作为跨组件套装的成员。ZIP、lira-pack.json、packageId 或资源数量不决定套装分类。`component-style-library.js` 以包内不同组件分类（category 或 type）是否超过一种区分套装；单组件包通过对应组件「＋ 添加样式」导入，套装通过全局入口导入。画布套装分类只显示跨组件组合，旧包按同样规则展示；存储和导入清单格式保持兼容。

该分类与导入规则适用于所有现有及以后新增的组件，不按具体组件或素材包名称设置例外。画布组件分类和图层「更换样式」都复用 `component-style-library.js`；独立设置页由 `component-style-client.js` 挂载同一个样式库。新增组件应接入现有组件注册与样式校验，并复用这些入口。多个同类变体仍是组件样式；HTML 样式按其保留的 `category` 归属原组件，不能因渲染类型为 `browser` 就另算一种组件。

`woodland-gift-frame` 是林间花信的 `gift-frame` 资源预设，默认大小 1920×1080、业务配置为空，仅映射原 `woodland-bloom-v4.webm` 到本机不可变资源。导入后仍使用 `gift-effects-frame.js` 的原生视频、头像与感谢文字布局和既有队列，不经过普通媒体样式播放器。启用、触发金额和模拟预览仍在客户端全屏礼物感谢页，导入不改写这些参数；样式卡片直接添加画布图层，不打开空参数页。新增图层使用默认尺寸，更换样式保留既有图层的位置和尺寸。

`nautical-guard-thanks` 是使用固定旗帜素材、可调头像和昵称的 `guard-thanks` 资源预设，不关联内置 `style` 枚举；仍校验组件类型、完整资源集合、同包路径和扩展名。它包含 `guard-nautical/{captain,admiral,governor}.webp` 与 `avatar.png`，使用客户端可信的 `guard-nautical-player.js` / `guard-nautical.css`。原始 1920×1080 透明动画按 tier 选择，播放 5 秒，头像在 1 秒后入场、昵称在 1.2 秒后入场，4–5 秒淡出。头像使用已校验的 B 站头像地址，失败回退本地默认头像；昵称只写 textContent。每次使用独立 Blob URL 重启动画，停止/销毁释放 URL、图层和计时器。旗帜文字已在原图内，不支持 textMode 翻译。

航海旗帜复用 final 礼物投影与队列，独立启用状态见[设置存储合同](../backend/storage.md)。同一次 ingress 生成 `guard-thanks:<购买ID>:nautical` 专属场景事件；资源组件只接受该风格，内置及普通素材组件忽略它，重复事件由现有队列去重。`showAvatar/showUserName` 默认 true，`nameFontSize` 默认 45（24–96 整数），功能页和画布共用控件；播放器按配置显示头像、昵称及字号。固定素材不显示语言或月数控件，等级和昵称仅用于模拟预览，不保存为真实观众数据。导入不改变已有场景布局；保存样式默认值会同步所有使用该资源样式的组件，位置、尺寸及样式选择仍由场景保存。

独立配置中的可选 `resourceStyle` 与 `mediaStyle` 互斥，形状为 `{id,preset,preview,width,height,resources}`。共享 [component-resource-style.js](../../../public/js/shared/component-resource-style.js) 限定预设、组件类型、兼容样式枚举、资源逻辑路径与扩展名。preview 与全部资源必须来自同一不可变包目录；禁止任意路径或脚本。用户调整几何信息不改变资源映射。月渡花汀弹幕新增可选的 `scroll-landscape.webp`；旧套装缺少该素材时保留原纸面，新导出的套装包含山水。可选素材仍受逻辑路径、扩展名与同包目录校验。

[component-resources.js](../../../public/js/overlays/component-resources.js) 只读取客户端已知 CSS，替换白名单素材 URL 并预解码图片/字体、检查视频可读性。配置代次隔离迟到结果；切换内置样式与销毁时释放样式表。JS 动画通过同一映射加载分层素材，背景不再在接收配置前等待已外置图片。旧内置月渡花汀场景的枚举仍可读取；要在安装版恢复效果，需导入 ZIP 并在原图层更换样式。

### Overlay 模块边界

| 门面/入口         | 内部模块                                                                       | 所有权边界                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `queue-render.js` | `queue-theme.js`                                                               | render 拥有队列 DOM；theme 只映射设置到 CSS 变量并由 render 兼容再导出                                          |
| `queue.js` | `queue-request-notice.js` | queue 接线并交付快照；notice 拥有提示 DOM、结果顺序、阅读时间、进出场/文字动画与资源释放 |
| `gift-effects.js` | `gift-frame-queue.js` / `gift-frame-player.js` / `gift-motion-player.js` / `gift-effect-player.js` / `gift-effects-guard.js` / `gift-effects-component.js` | 固定来源入口拥有单一 WebSocket 和消息分发；各队列/播放器拥有自身去重、播放和清理；组件适配器只接收父页配置与事件，不另建连接。林间花信画面由 `gift-effects-frame.js` 播放，掉落物理由共享 `gift-drop-physics.js` 计算 |
| `danmaku.js` | `danmaku-style-application.js` | 入口拥有配置接纳、feed 和数据连接；样式适配器将既有样式配置映射为 DOM dataset 与 CSS 变量，不持有消息或连接 |
| `games.js`        | `games-result.js` / `games-drawing.js` / `games-drawing-geometry.js` / `games-drawing-controls.js` | 入口拥有游戏会话、结果操作请求和恢复，games-session.js 负责增量与快照排序；result 拥有结果窗、头像请求代次、位置及按钮状态；drawing 拥有画板同步，geometry 是纯形状/颜色计算，controls 只适配画板启停与撤销状态 |

这些模块均由页面以 ES Module 加载；内部模块不得自行创建第二条 WebSocket 连接或重复持有会话状态。

## 1. 悬浮层框架

### 1.0 本地页面权限与数据投影

本地展示页面各有独立的 `overlay` 身份，不能调用其他页面或管理端的接口。固定页面地址仍可作为 浏览器源打开；服务端只在该页 HTML 中注入本次运行的页面凭据，管理凭据不进入 HTML。`songlist` 对应 `songs.html`，`lyrics` 对应 `lyric-window.html`，其余 scope 与同名 HTML 对应。`/pages/overlays/<文件名>` 原始地址和 `/<scope>` 使用相同权限与响应头；`/songs` 仍是管理入口。

签发及精确路径/方法白名单由 [access-policy.js](../../../src/server/access-policy.js) 拥有，受限操作由 [overlay-http.js](../../../src/server/overlay-http.js) 适配。REST、初始快照、合并快照及所有 WS JSON 出口统一经过 [overlay-projection.js](../../../src/server/overlay-projection.js)。投影逐层选取已列出的标量、对象及数组字段；新增 owner 字段和新增设置不会自动对展示页开放，不能直接展开整个 `state` 或 `settings`。管理请求保留原 DTO。

所有页面允许 `GET /api/state` 作为凭据恢复探测，但只返回下表中的本页投影；无快照消费者的页面得到空对象，不据此向全局快照加入游戏或转盘。表中 GET/POST 路径均省略 `/api` 前缀，头像代理仅开放给实际需要头像的页面。

| Scope | 专用 HTTP 读取与允许操作 | 快照字段与专用 WS 消息 |
|---|---|---|
| `queue` | 无 | `queue.current/waiting` 的歌名、请求者显示名、置顶、`is_live` 与大航海/灯牌展示字段；`superChats.message/price`；本页主题设置 |
| `songlist` | GET `/songs`，服务端固定 `enabledOnly: true`，保留分类筛选 | 本页歌单主题设置；歌曲仅 `id/name/artist/category_name/language/name_initial` |
| `blindbox` | GET `/gifts/blind-box-stats`，保留 `boxName` 筛选 | 本页主题与心动盲盒展示设置；统计仅盒数、总成本、开出礼物总价值、总盈亏、榜单显示名/盒数/盈亏及 `heartBoxProgress.openedSinceCastle` |
| `overtime` | 无 | `overtime` 的 revision、状态、服务端时间、有效余时、背景与展示规则；`overtime:update` 的同一状态及结算动画字段 |
| `gift-effects` | GET `/bilibili/avatar` | `giftEffectDanmakuEnabled`；`gift:frame` 的礼物铭牌/特效身份字段，`gift:effect` 的播放 URL 与 RGB/alpha 布局，`gift:guard-thanks` 的等级/昵称/月数/头像/文字模式 |
| `gift-feed` | GET `/gifts/display-settings`、`/gifts/history`、`/gifts/card-profiles`、`/overtime/gifts/catalog`、`/bilibili/avatar` | `gifts.viewRevision` 与刷新 reason；`gift-catalog:update` 仅为失效通知，不附完整目录 |
| `gift-wishes` | GET `/gifts/wishes` | `gifts.viewRevision`；响应仅含当前来源的许愿定义、进度、直播窗口状态和分页信息 |
| `heart-box-collection` | GET `/gifts/heart-box-collection` | `gifts.viewRevision`；响应仅含本期时间、收集状态、累计、下一档差额、四档奖励及缓存图片，不附送礼人或原始记录 |
| `gift-sprint` | 无 | `giftSprint.targetRmb/remainingCrystalBalls`；月底冲刺文字版直接使用既有服务端折算数量，未设目标或断线时清空文字，重连恢复；页面 `/gift-sprint`，`preview=1` 显示底色与提示；画布模式通过父页接收同一投影，不启动子页 WebSocket |
| `gift-export` | GET `/bilibili/avatar` | 无业务快照或专用消息；导出行、配置和目录由 Electron main 的冻结输入提供，不授予流水选择或导出 IPC 权限 |
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

设置字段表以投影模块中的显式键为准，并覆盖共享消费者：队列保留通用主题、序号/置顶/六条规则及各风格字体和滚动键；`storybookQueue`、`neonVinylQueue`、`cherryRibbonQueue`、`goldenLilyQueue` 仅允许 `FontSize/FontFamily/FontWeight/UseCustomTextColor/TextColor/ScrollMode/ScrollSpeed` 七个已消费后缀，旧 `illustratedQueue*` 仅保留现有兼容回退键。歌单保留独立 `songBoard` 设置及共享主题回退键，盲盒保留自身标题与通用主题，歌词保留 `DESKTOP_LYRIC_DEFAULTS` 对应的 51 个展示键。不得将任意同前缀的新键视为已授权。

每个 overlay HTML 响应都使用 `Content-Security-Policy: sandbox allow-scripts`，不允许 `allow-same-origin`；直接打开和嵌入管理预览都处于 opaque origin，不能访问父 frame 的 DOM、fetch 或凭据。预览父页通过 `postMessage(..., '*')` 发送展示配置，子页核对 `event.source === parent` 及管理页服务 origin；当前 overlay 与共享渲染器不依赖 localStorage、sessionStorage 或 IndexedDB。

静态脚本、样式、字体和图片可跨 opaque origin 加载，HTML 不开放 CORS 读取。API 只为允许的页面路径/方法接受 `Origin: null`，实际请求仍验证页面凭据；预检不授予身份或管理权限。引导脚本只给同一服务的 `/api/` 和 `/ws` 附加本页凭据，401 或 WS 关闭后最多合并一次 `/api/state` 探测，确认旧凭据失效才重新加载页面。`topic=danmaku` 只缩小订阅，不能扩展 scope；overlay 的 WS 文本/二进制业务入站帧关闭为 1008，正常 ping/pong/close 保留。`shutdown` 对所有 scope 仅包含类型和原因。

区域随机位置参数：outline、mist、comic、window、whiteframe、cream、glow、starveil、sea-breeze-random 的 `styleOptions` 支持 `centerBias`（中心倾向）与 `dispersion`（离散程度），均为 1～50 整数，默认 1。中心倾向越高，越偏向区域中央、越少落在边角；离散程度越高，越偏向离上一条卡片中心欧式距离更远的位置。两者共同调整概率权重，不承诺每条消息固定距离；边界和防重叠优先，拥挤时沿用最旧消息淘汰。上一条过期后仍保留其中心作为下一条参考，清空/重建 feed 时重置。参数在线更新只影响后续位置选择，已显示位置保持稳定。固定与 floating/comet 样式不接受这两个字段；旧参数缺失使用默认，空样式对象恢复默认，旧 PUT 省略 styleOptions 保留已有值。

算法由 `danmaku-random-position.js` 拥有：48 个稳定伪随机均匀候选，Gumbel-max 按指数权重选择（中心归一化距离惩罚与实际欧式距离奖励）。仅在候选无法放置时尝试边角/相邻空隙。预览、独立弹幕与服务器使用同一算法；参数面板复用既有滑块与草稿应用流程。

### 随机与飘窗的动效参数归属

两类布局共用字段合同和参数编辑器，数值仍按 `styleOptions.<style>` 保存。沉笺采用下节的专属下沉参数，不使用横向飘窗参数。桌面、画布与独立预览在基础外观之后展示「随机弹幕通用参数」或「飘窗弹幕通用参数」；款式特有入场放在高级参数的本款分组，不能同时叠加普通随机入场。字段能力由 `DANMAKU_STYLE_OPTIONS` 声明，本机 Node 镜像由同一浏览器合同生成。

| 字段 | 适用范围 | 值、默认与作用 |
| --- | --- | --- |
| `durationSeconds` | 全部区域随机 | 2–30 秒；星尘 2.0 默认 12、玻璃气泡默认 5，两款不继承旧共用值；其余默认 6 并兼容旧值；包含入场和退场 |
| `exitAnimation` | 全部区域随机 | `fade`（默认）渐隐、`none` 直接消失；只作用于正常到期 |
| `exitDurationMs` | 全部区域随机 | 100–1000ms；星尘 2.0 默认 1000，其余默认 400；关闭渐隐时保留数值但停用控件 |
| `entranceAnimation` | 一纸素笺、青雾、杏花白、白描、流光溢彩、点点流萤、郁香海风随机 | `fade`（默认）保留样式渐显、`rise` 上浮弹入、`none` 直接显示 |
| `entranceDurationMs` | 上述普通随机 | 100–1000ms；缺省渐显为郁香海风 800、青雾 280、点点流萤 260、其余 200；旧 `rise` 缺少时长时保持 500ms |
| `floatingEdgeFade` | 横向飘窗（不含沉笺） | `both` 两端、`right` 入场端、`left` 离场端、`none` 直接切断；极光/星轨默认 `both`，其余 `none` |
| `floatingEdgeFadeSize` | 横向飘窗（不含沉笺） | 4–80 逻辑 px、默认 28；每端上限为区域宽度 4%，不改变移动速度或完整离场时机 |

随机 feed 在新增或恢复每条消息时锁定其停留与退场参数，`setExpirationOptions` 只更新后续消息的配置；在原到期点移除，撤回、拥挤淘汰和销毁仍即时清理。`danmaku.js` 的样例预览、场景配置和独立组件输出均原地更新同款动效参数，保留已有节点、随机位置、动画和到期点。切换样式或影响消息结构的配置仍重建；显式重播仍重新播放示例。

两类 feed 在新消息真正取得位置后设置 `data-live-entry`；恢复快照直接显示完整消息。普通随机由本机 `danmaku-random-entrance.js` 锁定入场选项与时长并复用安全正文，`random-entrance.css` 管理共用上浮和入场开关；漫画、小窗、极光、星轨只编排各自内部图层。飘窗边缘遮罩统一由 `floating-motion.css` 拥有，横向移动、等待和完整拖尾清理由 floating feed 拥有。款式仅声明默认边缘和专属入场，不再重复实现相同遮罩。系统减少动态效果省略入场强调和随机渐隐，飘窗保留阅读所需横移；`ambientMotion` 仍只控制装饰循环。 两类 feed 在偏好切到减少动态时清除已有和等待消息的入场许可，恢复动态后旧消息不重播；飘窗的偏好监听随 feed 销毁释放。

文字入场和公共到期渐隐沿用 [绘制连续性约束](danmaku-motion.md#实现契约)，通过不继承的注册属性在实际画布缩放下绘制；小窗窗框与星轨光尾等重叠装饰同样避免间接改变文字栅格。横向飘窗以 `left` 插值推进，适配比例由独立 `scale` 保持，组件的旋转／倾斜仍归 `transform`；移动速度、等待避让、完整拖尾离场和用户特效不变。

### 郁香海风固定与区域随机弹幕

`sea-breeze`（郁香海风）与 `sea-breeze-random`（郁香海风 · 随机）参照[原作公开预览](https://www.bilibili.com/video/BV1vHY76oEEf/)的文字、彩色身份牌和渐隐镜像，由 `danmaku-sea-breeze.js` 重组公共安全文字与 B 站表情 DOM，`danmaku/sea-breeze.css` 拥有排版和分层渐显。默认正文 32px（18–48px）、昵称 26px、标签 12px、金额 20px；调整正文字号不缩放昵称和标签。默认使用随客户端提供的[专用宋体](../../../public/fonts/sea-breeze/README.md)与系统 Times New Roman；不新增启动下载或服务器 renderer。字形和时序依据视频采样选择，不声称与原作者源码参数一致。

固定款默认区域 480×700，`styleOptions['sea-breeze'].seaBreezeAlign` 接受 `left/center/right`，默认 `center`；支持原有滚动方向和边缘处理，默认直接切断。随机款默认铺满画布，使用公共避让、停留与退场，渐显默认 800ms，可用通用入场控制调整。已有布局缺少两款时只补齐对应区域，不移动已保存区域。

两款均在「高级参数 → 海风倒影」提供以下字段，分别存入各自的 `styleOptions[style]`；默认保留原倒影。调整直接作用于现有文字层，倒影范围参与消息占位，原文字和身份牌保持清晰；强度或长度为 0 时关闭倒影并收回其占位。

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `seaBreezeReflectionOpacity` | 0–60%，默认 28 | 倒影强度，0 关闭 |
| `seaBreezeReflectionLength` | 0–200%，默认 130 | 倒影高度相对于正文字号的比例，0 关闭 |
| `seaBreezeReflectionGap` | -20–30px，默认 -9 | 原文字层与倒影间距；负值靠近，正值拉开 |

两版均不显示头像；昵称、正文和事件金额组成统一文字倒影。聊天的大航海与灯牌使用本房间 `roomGuardLevel` 与 `roomMedal`，不将其他房间身份升级为本房大航海；主播标记使用 `isStreamer`。游客、舰长、提督、总督分别使用紫蓝、浅蓝、紫、粉红标签，礼物与 SC 使用香槟金。普通礼物显示名称、数量和 `giftTotalPrice` 已结算总额，不重复乘数量；SC 显示实际 `price` 并保留完整原文与换行，昵称、正文和金额复用 `danmaku-superchat-renderer.js` 的 `getSuperChatColors(item).accentColor`：优先采用消息自带的有效配色，缺失或无效时按公共金额档位回退，倒影继承相同文字颜色。未知金额显示 `—`。购买大航海按 `giftGuardLevel` 显示对应身份与欢迎、续费或支持文案；缺少动作时不宣称开通或续费。现有事件合同不提供房管字段，因此不补造原作示例中的房管标记。

场景入口、示例和公共 feed 通过能力 `fullscreenSuperchat` 接受本款随机 SC；撤回与到期沿用共享生命周期。稳定快照不重播入场；系统减少动态效果时直接显示。桌面选择/保存、画布和本地场景使用同一实现，OBS 与哔哩哔哩直播姬均可通过本机场景浏览器源显示。

### 沉笺下沉飘窗

`sinking`（沉笺）位于本机样式库的「飘窗弹幕」，默认铺满画布；旧本机布局缺少本款时补齐区域。`danmaku-sinking.js` 重组公共安全消息 DOM，`danmaku/sinking.css` 使用九宫格贝壳玻璃底片，保留原生文字、行内表情、礼物名称与数量、上舰动作及 SC 完整原文。普通礼物通过共享 `gift-image.js` 显示礼物图片首帧的静态 WebP，上舰使用当前房间的大航海图标；图片位于礼物文案上方。礼物使用 `giftTotalPrice` 已结算总额，SC 使用实际 `price`。默认宋体、正文 30px（18–40px）；三张本地 WebP 与来源记录位于 `img/overlays/danmaku-sinking/`，随客户端交付，不增加启动下载或服务器 renderer。

`danmaku-sinking-geometry.js` 持有底图 alpha 边缘采样，按 CSS 相同的九宫格映射上凹边及左右边，再将出生点投影到薄片当时的转动、透视与用户变换，用户透视距离与卡片 CSS 共用 `transform.perspective`（缺省 1000px），脱离后独立上浮。三色共用相同 alpha；更换底片或九宫格参数时须同步采样与映射。

专属字段保存在 `styleOptions.sinking`，桌面和画布共用「沉笺 · 水下薄片」参数组：

| 字段 | 范围与默认 |
| --- | --- |
| `sinkingPalette` | `ivory` 珍珠白（默认）、`mint` 浅海绿、`blue` 冰蓝；默认正文色随色泽变化，显式自定义色保留 |
| `sinkingDurationSeconds` | 2–30 秒整数，默认 10；含入场、阅读和退场 |
| `sinkingTravel` | 区域高度的 10–40%，默认 24%；受可用空间约束 |
| `sinkingSway` | 0–36 逻辑 px，默认 18；按区域宽度缩放 |
| `sinkingBubbleDensity` | 1–100 整数，默认 50；低、中档沿用原曲线，50 以上平滑增加，100 为原成品预览最大密度的 3 倍（120 个/秒，每张最多 390 个粒子槽位） |

`danmaku-sinking-feed.js` 拥有入水、缓慢下沉、退入深处及气泡的一条 rAF 循环，复用现有随机落点算法并预留整段运动路径。入水与退场的景深模糊仅应用于玻璃底片，昵称、正文、表情和金额保持清晰。卡片最短入场间隔 180ms，拥挤时最多等待 2 秒；新消息取得位置后才开始计时，快照按原时间恢复，过期不重播。每条锁定停留、行程和摆幅，参数修改只影响后续消息；密度与材质原位更新，不重置当前卡片寿命。气泡出生位置按复用周期缓存，区域或卡片几何变化时失效；隐藏粒子不重复写透明度，表面光泽与水深只在对应阶段参数变化时更新，保持粒子数量、轨迹和时长。撤回、清空和销毁释放节点与粒子；系统减少动态效果时关闭下沉、摆动和气泡，仅保留淡入淡出。通用横移速度、分散和边缘参数不适用于本款。样式保存与本地场景输出共用既有账号外观存储和事件订阅，场景允许 SC 并转发撤回。

### 漫画对白区域随机弹幕

`comic`（漫画对白）为客户端内置区域随机样式，默认铺满画布；旧本机布局缺少该区域时补齐。`danmaku-comic.js` 重新组合公共安全 renderer 的文字、头像和 B 站表情，`danmaku/comic.css` 绘制原创 SVG 对白框、旁白框、爆炸框及淡网点纸面。设计参考为 [Comicalize](https://booth.pm/ja/items/8139579) 的漫画语言，不交付原商品图片或模板。样式外观保存在授权账号的本机桌面存储，输出复用既有场景订阅；不新增消息连接、资源下载或服务器 renderer。

正文默认宋体、26px，范围 18–42px；昵称和头像保持独立尺寸。普通聊天可横排或从右向左竖排，长文沿用 feed 的完整测量与整体适配。礼物及上舰用横排旁白框，SC 用横排爆炸框，保留完整原文与换行。身份只取 `roomGuardLevel`／`roomMedal`；上舰称谓取 `giftGuardLevel`，开通／续费取 `guardAction`，未知动作显示支持。礼物金额使用 `giftTotalPrice` 单条已结算总额，不再乘数量，未知金额显示 `—`。聊天、礼物、上舰与 SC 共用随机避让、2–30 秒停留和清理；场景消息层允许本款 SC，并沿用本场 SC 撤回。

以下字段仅由 `styleOptions.comic` 接受，客户端与画布共用参数编辑器：

| 字段 | 值／范围 | 默认 | 行为 |
| --- | --- | --- | --- |
| `comicWritingMode` | `horizontal` / `vertical` | `horizontal` | 普通聊天阅读方向；已有内容重新测量 |
| `comicShape` | `mixed` / `speech` / `box` / `burst` | `mixed` | 后续普通聊天造型；混排结果按消息内容稳定选择 |
| `comicStrokeWidth` | 整数 1–4 | 2 | 墨线宽度，px |
| `comicTexture` | 整数 0–30 | 8 | 纸面网点不透明度百分比，0 关闭 |
| `comicEntrance` | `pop` / `ink` / `fade` / `none` | `pop` | 漫画弹出／墨线勾勒／轻柔渐显／直接显示，创建消息时锁定 |
| `comicEntranceMs` | 整数 180–800 | 420 | 入场时长，ms，创建消息时锁定 |

入场图形层与正文层分离：弹出只短暂缩放、轻转纸面；正文最多下移 5px 后渐显，不旋转、抖动或持续变形。墨线方式勾勒 SVG 边线，纸面在前 18% 时长内达到设定的不透明度，再带出文字，避免暗背景下黑字先于纸面出现；渐显方式只调整整张对白的不透明度。系统减少动态效果时省略这些入场动画。背景不透明度同时作用于纸面与网点，文字保持清晰；通用视觉效果以 `art` 作用于 `.comic-ink` 的透明轮廓，不开放矩形底板内阴影／内发光。测量、避让、拥挤淘汰、到期渐退和销毁继续由共享 feed 拥有。

参数面板的「漫画造型与入场」使用「入场方式／入场时长」，两个字段只控制出现。勾线由独立 SVG 遮罩按路径推进，显示用的墨线保持 `non-scaling-stroke`，避免拉伸后归一化虚线只绘出很短一段再突然补齐。正常到期使用上面的随机通用退场参数，默认最后约 400ms 整条渐隐；`durationSeconds` 包含入场和退场，默认 6 秒与 420ms 入场组合，完整稳定显示约 5.3 秒。拥挤淘汰、显式撤回和清空即时移除；减少动态效果时到期直接清理。

### 散落小窗区域随机弹幕

`window`（散落小窗）为客户端内置区域随机样式，默认铺满画布；旧本机布局只补齐缺失区域。造型参考 [随机小窗弹幕](https://booth.pm/ja/items/9096557) 的圆角窗面、昵称胶囊与窗角图形，以原创 DOM/CSS 实现，不包含原商品素材。`danmaku-window.js` 复用公共安全文本、头像和表情 renderer，`danmaku/window.css` 拥有窗面与分层入场；布局、避让、拥挤淘汰、到期与撤回清理由共享 feed 负责。外观按授权账号保存在本机，客户端、画布和本机场景共用，不新增服务器 renderer、资源下载或消息连接。

正文默认 26px、范围 18–40px，头像保持 21px、昵称 15px、粉丝牌 12px，不随正文字号变化；聊天、礼物、上舰和 SC 的昵称使用相同行高与字距。昵称限制在 8em 内、最多两行，超出两行省略；昵称胶囊、大航海图标与粉丝牌垂直居中，身份栏为右侧窗角装饰预留空间。正文完整换行，超出区域的单条消息沿用整张等比适配。普通聊天保留 B 站表情。昵称右侧的大航海 WebP 替代原有文字身份，只读取 `roomGuardLevel`，复用 `setGuardIcon` 的普通／千舰切换；其右侧的圆角粉丝牌读取 `roomMedal` 的名称、正整数等级、颜色与点亮状态，不使用其他房间的佩戴身份。两项默认开启，缺少对应身份时独立隐藏。礼物和上舰显示真实名称、数量及 `giftTotalPrice` 已结算总额，不再次乘数量；上舰称谓取 `giftGuardLevel`，动作取 `guardAction`，未知动作显示「支持」。SC 保留完整字面原文、换行和实际 `price`；金额缺失显示 `—`。四类消息共用 2–30 秒停留、随机分布与本场 SC 撤回。

以下字段仅由 `styleOptions.window` 接受。客户端、画布和独立预览均在常规参数区直接显示「大航海图标」和「粉丝牌」；其余字段在「高级参数 → 散落小窗」中编辑：

| 字段 | 值／范围 | 默认 | 行为 |
| --- | --- | --- | --- |
| `windowPalette` | `porcelain` / `sakura` / `night` | `porcelain` | 白瓷蓝／樱花粉／月夜蓝，联动窗面、边框、昵称牌及默认正文色 |
| `windowWidth` | 整数 220–560 | 380 | 单张窗面逻辑宽度，px；长文换行，现有消息重新测量 |
| `windowRadius` | 整数 10–36 | 22 | 窗面圆角，px |
| `windowControls` | `show` / `hide` | `show` | 显示／隐藏右上角最小化与关闭图形，仅作装饰 |
| `windowGuard` | `show` / `hide` | `show` | 显示／隐藏昵称右侧的本房间大航海图标，已有消息即时生效 |
| `windowMedal` | `show` / `hide` | `show` | 显示／隐藏大航海图标右侧的本房间粉丝牌名称与等级，沿用接口配色，已有消息即时生效 |
| `windowEntrance` | `mixed` / `pop` / `unfold` / `rise` / `none` | `mixed` | 随机混合／轻弹出现／小窗展开／轻盈上浮／直接显示 |
| `windowEntranceMs` | 整数 180–1000 | 460 | 入场时长，ms，直接显示时停用控件 |

入场方式与时长在创建消息时锁定，只作用于新消息；混合按消息种子稳定选择。窗框独立缩放、展开或上浮，正文只渐显并轻移 3px，不缩放、旋转或持续漂移；快照直接显示完整小窗。`ambientMotion` 仅控制内边线呼吸，关闭后保留新消息入场。系统减少动态效果时关闭入场与呼吸。背景不透明度只作用于窗面及昵称底色，文字与边框保持清晰；显式正文色优先于配色默认值。字体、停留、退场、中心倾向与离散程度沿用本款通用参数，恢复默认只重置当前样式。

### 飘窗弹幕

浮光掠影飘窗样式 `floating` 为固定/随机之外的独立布局，由 `danmaku-floating.js` 复用消息渲染器。灰底浅色描边圆角卡片从右向左匀速移动，大航海深色、其余浅色；仅显示昵称与正文/表情，SC 不显示。两款飘窗（floating、comet）的礼物通知共用普通弹幕的昵称栏与正文布局，正文为“用户名投喂了礼物名×数量”，不使用通用礼物卡片结构。`styleOptions.floating.speedPixelsPerSecond` 为 20～600 整数、默认 120 逻辑像素/秒，默认区域铺满画布；旧九/十区域配置补齐缺失区域。预览、桌面参数与服务端正式画面同步支持，动画、计时器及观察器由布局模块释放。

所有飘窗样式的基础参数共用“飘动速度”和“分散程度”滑块，均为 1～100、默认 50，设置按款保存。速度刻度以 `round(120 × 3^e)` 映射，`e=(s−50)/49`（s≤50）或 `(s−50)/50`（s>50）：1/50/100 对应 40/120/360 逻辑像素/秒；保存继续使用 `speedPixelsPerSecond`。旧 20～600 数值完整保留，调其他参数不会裁剪；超出新刻度范围时显示实际倍率及“旧值”，直到用户手动调整速度。

飘窗的 `styleOptions.<style>.floatingDispersion` 为 1～100 整数、缺失默认 50；固定及区域随机样式拒绝此字段。位置 owner 为 `danmaku-floating-position.js`：以当前时刻的卡片/特效/拖尾边界计算到最近在途弹幕的欧式边缘距离，在整个纵向范围内二分可用区间求最大间距。1 从基础间隙（最多 8 逻辑像素）开始随机选位，50 使用基础间隙至最大可用间距之间的中间门槛，100 选择全域最远位置（含上下边界及中间空隙），不限制为若干卡片高度。第一条均匀随机；更新分散度不挪动已有卡片，更新速度保留当前位置。同速平移保持入场时的相对距离。拥挤时缩小目标间距，完全无空位时隐藏等待、每 100ms 重试，最多等待 2 秒后淘汰；显示与等待合计沿用 50 条上限。清空/销毁释放等待计时器。

`comet`（鹤舞花枝间，原流光彗尾）沿用飘窗布局和速率，参数与区域仍按 `comet` 保存。各身份统一使用参考图的香槟金横框、左侧花枝、右侧白鹤及上方独立花纹昵称牌；暖金文字带柔和白色描边，昵称、正文和表情均为实时 DOM。花框和昵称牌为不含示例文字的透明 WebP，金框与昵称牌底板按九宫格伸展；重绘的花叶、白鹤、花簇与灯笼分别锚定四角，随框体增高沿对应上下边缘展开，保持原比例、不挤在中部；昵称牌小花保持固定尺寸，长昵称及多行正文分别扩展对应区域。卡片按内容在 459–700px 之间伸缩，默认 30px 字号下 30 字排 2 行、40 字排 3 行，昵称牌与正文、金色底板居中对齐；小区域整体等比缩小。全部装饰包含在卡片边界内，完整离场后清理；不再外伸丝带尾部或播放布料波纹，不增加动画计时器。背景透明度同时作用于花框和昵称牌，文字保持不透明。素材来源见 `public/img/overlays/danmaku-comet/provenance.json`。

### 极光薄笺飘窗弹幕

`aurora`（极光薄笺）为客户端内置飘窗，复用 `danmaku-floating.js` 的匀速横移、分散、拥挤等待和完整离场清理。默认铺满画布，旧本机布局缺少 `aurora` 时补齐默认区域；账号本机外观、画布共享参数与本地场景输出继续走既有 owner。普通消息保留真实昵称、完整文字与 B 站表情；礼物显示真实礼物名、数量和 `giftTotalPrice` 单条已结算人民币总额，不再次乘数量，缺失金额显示 `—`；上舰按真实 `guardAction` 显示开通／续费，未知动作显示支持。沿用飘窗契约不显示 SC。

造型由 `danmaku-aurora.js` 组合公共安全 renderer 的内容，`danmaku/aurora.css` 绘制原创珠光纸面、切角、独立昵称签和吊饰；参考为 [jelly float 极光评论](https://booth.pm/ja/items/8000236) 的材料与构成，不携带原作商品素材。公共 renderer core 的固定来源快照不变。卡片外层交给 feed 移动，内层在 520ms 内完成轻推渐显，昵称 420ms、正文 300ms 分别延后 80ms、130ms 渐入；仅在 feed 标记实际开始显示的 `[data-live-entry]` 上播放，等待位置与恢复快照不提前播放入场。持续流光周期 11 秒，吊饰轻摆 6.8 秒，文字不参与持续变形。关闭公共 `ambientMotion` 或启用系统减少动态效果时，装饰循环停止；减少动态效果还省略分层入场，保留横向阅读位移。

正文字号默认 26px、范围 18–40px，昵称为独立 17px 层级；卡片随长文增高，装饰留在测量边界内，小区域沿用 feed 的整体适配。公共背景不透明度作用于纸面与昵称签底板，不淡化文字；通用效果按 `art` 作用于纸片、昵称签与吊饰的透明边缘，不开放矩形底板的内阴影／内发光。以下独立字段均位于 `styleOptions.aurora`，仅本款接受，客户端和画布使用同一控件合同：

| 字段 | 范围／选项 | 默认 | 作用 |
| --- | --- | --- | --- |
| `auroraPalette` | `lilac`、`glacier`、`rose`、`champagne` | `lilac` | 紫藤极光、冰川青蓝、玫瑰晨曦、香槟月白；不覆盖自定义正文颜色 |
| `auroraSheen` | 整数 0–100 | 55 | 珠光强度百分比，作用于纸面叠层与高光 |
| `auroraCharm` | `star`、`moon`、`none` | `star` | 四角星、月牙或隐藏；切换不改变已有卡片尺寸 |
| `auroraSway` | 整数 0–12 | 5 | 吊饰左右摆幅（度）；0 为静止，不移动正文 |
| `auroraEntrance` | `layered` / `none` | `layered` | 薄笺分层展开／直接显示；逐条锁定 |
| `auroraEntranceMs` | 整数 180–1200 | 520 | 入场时长 ms，按比例调整纸面、昵称与正文时序；逐条锁定 |

配色、珠光、吊饰与摆幅通过 dataset／CSS 变量更新已有卡片，不重播入场；恢复默认只清空本款参数。字体、文字颜色、速度、分散及通用效果继续复用公共合同，不增加独立连接或计时器。此新增款在客户端交付，旧服务器在线源保持独立兼容范围。

分层时序由本款 CSS 按 `auroraEntranceMs` 比例编排；`auroraEntrance=none` 时内部直接显示，横移不变。边缘显隐使用飘窗通用参数，清理仍等完整卡片移出。吊饰摆幅仅在吊饰可见且 `ambientMotion=on` 时产生可见动作，隐藏或关闭循环不会丢弃已保存摆幅。

### 星轨飞语飘窗

`startrail`（星轨飞语）为客户端本地内置飘窗，默认区域铺满画布，正文默认 28px、范围 18–44px。`danmaku-startrail.js` 在既有安全消息 renderer 的昵称、正文、表情和礼物名／数量 DOM 外组合原创四角星、光尾与三枚星尘；移除通用礼物卡片标记，使礼物保持同款透明文字造型。礼物／大航海图片复用既有图片节点与加载逻辑，移到昵称前，按昵称字号显示为 1em 方框（默认 15px）、等比缩放并垂直居中，未加载或加载失败时隐藏；动作、礼物名与数量仍在第二行。昵称按消息 `guardLevel` 区分：普通／粉丝牌使用中性浅灰，大航海复用 `danmaku/base.css` 的共享配色变量 `--guard-captain`（舰长蓝）、`--guard-admiral`（提督紫）、`--guard-governor`（总督红），不维护本款专用身份色，与星芒颜色参数独立。固定服务器 renderer 快照和远程仓库不变，SC 沿用飘窗不展示规则。

`styleOptions.startrail` 专属字段：`startrailColor` 为六／八位 HEX、默认 `#b9dfff`；`startrailStarSize` 为 12–40 整数 px、默认 24；`startrailTailLength` 为 0–360 整数 px、默认 180，0 隐藏尾迹；`startrailGlow` 为 0–100 整数、默认 45；`startrailDust` 为 `on|off`、默认 `on`；`startrailEntrance` 为 `spark|none`、默认 `spark`（星芒点亮／直接显示）；`startrailEntranceMs` 为 250–1200 整数 ms、默认 680。字段由共用契约生成控件并在本机 Node 镜像校验，仅本款可用。没有底板，不提供背景透明度；公共效果按文字型表面处理，速度、分散程度与 `ambientMotion` 复用既有字段。

`danmaku/startrail.css` 拥有分层入场和装饰循环，正文不做缩放／位移动画。样式通过内部 `--danmaku-entry-inset` 声明星芒、间距与首字宽度的逻辑 px 内缩，floating feed 按实际组件缩放仅在新消息首次放置时消费，使低速时入场也在可视范围开始；其他款缺失时为 0，快照继续按原时间恢复，速度／尺寸更新不重新内缩。共用 feed 在新增消息真正取得可用位置时标记 `data-live-entry`，等待期间不启动入场，快照恢复不标记；速度或外观更新不重播标记。入场方式和时长在创建消息时锁定，之后调节只影响新消息，避免已完成的正文渐显重新启动；直接显示或减少动态效果时不使用入场内缩，从区域右边缘移入。`--danmaku-trail-width` 返回实际 px 尾长，由既有位置计算与完整离场清理消费。

左右边缘使用飘窗通用显隐参数，默认每端 28 逻辑 px 且不超过区域宽度 4%；中部保留完整透明度。进入和消失均随匀速移动经过柔边，完整光尾离场后才清理，不增加独立退场时长或停留参数。星芒中央亮点继承颜色 alpha，0% 不透明度不会残留白点；辉光字段在界面以百分比显示，值域及默认不变，入场建议 450–800ms。星尘依附光尾，尾长为 0 时一并隐藏。样式与循环无额外计时器或连接；减少动态效果关闭入场强调与装饰循环，保留横向阅读。

### 1.1 通用模式

所有叠加层:

- **透明背景**:`html,body` 透明(`overlays/base.css`),只渲染卡片面板,供 浏览器源叠加;加班机层独立样式(整屏倒计时)。
- **状态获取**:队列、歌单、盲盒、加班机等快照消费者先 `fetch('/api/state')` 拿首帧快照,再连 `/ws` 收后续快照;WS 断开时按指数退避重连,重连前再次 `loadState()` 兜底(见 [comms.md](comms.md) §3)。
- **字体**:中文字体栈 `Microsoft YaHei / PingFang SC` + 多语言回退(`overlay-utils.js` 的 `multilingualFontFallback`);队列/歌单板经 CSS 变量 `--overlay-font-family` 由管理页设置注入,加班机数字与 LIVE 徽标用 Bahnschrift / Bahnschrift SemiCondensed(见 §4)。
- **指纹去重**:内容未变不重渲染(队列层 `computeStateKey`、歌单层三段指纹、加班机 revision 比较,详见 [comms.md](comms.md) §3.2)。
- **点歌 LIVE**：所有点歌板样式仅在单项 `is_live` 为 true 时显示深珊瑚红底、白色圆点与 LIVE 字样的紧凑徽标；预览与实际浏览器源复用同一徽标，预览示例通过 `is_live` 标记，不把状态文字写入歌名。使用后端队列顺序，不根据第 1 位猜测演唱状态。`is_live` 纳入队列指纹，单独切换标记也会刷新。
- **低功耗模式**:`overlay-utils.js` 的 `overlayLowPowerEnabled(settings)`——URL 参数 `?quality=low` 强制开启、`?quality=pretty|smooth` 强制关闭、否则读设置 `overlayLowPowerMode`([overlay-utils.js:48-53](../../../public/js/overlays/overlay-utils.js#L48-L53))。低功耗下加班机走 `low-motion` 类(动画 180ms、关闭 transform/filter,[overtime.css:307-310](../../../public/css/overlays/overtime.css#L307-L310))。

### 1.2 CSS 变量注入表(唯一成文处)

队列/歌单/盲盒叠加层在每次快照到达时调用 `applyTheme(settings)` 把 settings 值写入 `:root` CSS 变量；以下是**全部 28 个** `--overlay-*` 变量的注入来源与默认值。写入由 [overlay-theme.js](../../../public/js/overlays/overlay-theme.js) 的 `applyOverlayTheme(root, panel, settings, options)` 统一完成：共享实现只负责变量与 `low-power`/`has-backdrop-blur`/`gradient-bg` 类，页面通过 `resolve`（键覆盖规则）、`defaults`（本页默认值）和 `fontScale` 三个接缝保留各自差异。点歌板用 `resolve` 实现"独立主题时优先 `songBoard*` 覆盖"，并覆盖 `themeOpacity`/`themeRadius`/`backdropBlur`/`glowIntensity`/`gradientEnd` 的默认值；下表的默认值列是共享默认，不是每个页面的实际取值。

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
经典脚本形式是该工具的唯一 owner;模块消费者经 [overlay-utils-module.js](../../../public/js/overlays/overlay-utils-module.js) 具名导入同一批函数(队列、盲盒、主题适配、歌单板),不新增转发包装,也不各自直读全局。

### 1.3 song-virtual-scroller.js(歌单虚拟滚动)

歌单板专用:可变行高记录的**环形 DOM 窗口**虚拟滚动([song-virtual-scroller.js:28-58](../../../public/js/overlays/song-virtual-scroller.js#L28-L58))。

- **工作原理**:以 anchor 记录(当前视口首行 key/index/offset)为起点,向两侧按 `beforeViewports=1 / afterViewports=1.5` 个视口高度增量构建 DOM 节点(`probeOverflow` 先探测内容是否超出一屏,不超出则整表渲染),`wrapIndex` 取模实现环形复用;滚动时 `tick` 按 `pixelsPerSecond * elapsed / 1000` 推进 `scrollTop`,超出前缓冲区的顶部节点被回收并追加到尾部(`recycleTopRecords`),始终保持窗口内只有可见 + 缓冲节点。
- **联动**:`setRecords`/`relayout` 以 anchor 保持视口稳定(歌单刷新/字体加载完成/视口 resize 时不跳位);`songs.js` 将 `scrollSeconds`（沿用设置键名）或 URL `speed` 的 1–100 档位通过 `scrollSpeedToPixelsPerSecond` 线性映射为 1–250 CSS 像素/秒，默认档位为 20（约 48.79 CSS 像素/秒），再调用 `setPixelsPerSecond`；高度仅影响可见内容和缓冲区，不参与速度计算。组件预览和实际展示共用此逻辑；页面隐藏时 `pause()` 停止 rAF([songs.js:102-108](../../../public/js/overlays/songs.js#L102-L108))。
- **速度精度**:保留浏览器写入 `scrollTop` 后的像素舍入余量，下一帧与回收顶部节点时继续累计；低速不会因高刷新率停住，各刷新率下保持相同的每秒位移。
- 浏览器无 `requestAnimationFrame`/`ResizeObserver` 时自动降级(整表渲染 + window resize 监听)。

### 1.4 礼物四方边框(`/gift-effects`)

「全屏礼物感谢」内置 `gift-drop`（礼物掉落）和 `gift-swing`（礼物摇摇乐）。两款可同时启用，在客户端分别保存最低结算金额、大小和存活时长；摇摇乐另有摆幅。画布 `gift-frame` 的两张内置卡使用可选 `style` 字段选择对应主题；旧 `{}` / `follow` 接受全部已启用主题，导入资源和媒体样式不播放这两款。导入的图片/视频图层只播放 `themeId: imported` 且 `styleIds` 含自身 `mediaStyle.id` 的事件，不再跟随林间花信；其他图层（内置、林间花信资源样式、CSS 外观）忽略 `imported` 事件。预览样例不受此限制。规则由共享 `gift-frame-style-triggers.js` 的 `isGiftFrameEventForLayer` 拥有。启用与参数保存在本机设置，不复制进场景；修改只影响后续结算，画布示例从同一已保存设置读取，参数页的预览可展示未保存草稿。

两款的参数直接展示在各自卡片中，均提供速度控制；掉落另有数量倍率与弹跳力度，摇摇乐的送礼人、礼物名、数量可分别勾选，全部关闭仅保留图片与直杆。组合由共享 `gift-motion-settings.js` 的 `GIFT_SWING_TEXT_MODES` 定义，复用原 `textMode` 字段并保留 `full/gift/none` 含义。范围与默认值见[本机礼物动效设置](../backend/storage.md#71-关键设置的归属与约束)。参数页由同一共享定义生成，保存与草稿预览复用同一组字段。金额使用窄输入框，其他数值使用带范围端点的 `parameter-range` 滑块，旁边只读显示当前值和单位。

`gift-motion-player.js` 和共享 `gift-drop-physics.js` 分别拥有 DOM/动画生命周期和固定步长刚体计算。事件沿现有 `gift:frame` 携带独立 `eventId`、`startedAt`（本机捕捉 final 的毫秒时刻）、`artworkPath` 与 `motion.size/durationSeconds/speed`，掉落另含 `bounce/quantityMultiplier`，摇摇乐另含 `angle/textMode`，不进入旧 FIFO。大小按 1920×1080 逻辑舞台计算；速度按百分比控制运动快慢，掉落初速度按速度倍率缩放、重力按其平方缩放，碰撞取两件礼物较低的弹性，摇摇乐按速度倍率改变回摆节奏。缺少参数时沿用字段默认值。掉落每张图片分配 0–1000ms 随机延迟，预定下落时刻为 `startedAt + delay`，截止时间为该时刻加 `durationSeconds * 1000`；等待下落时隐藏且不参与物理计算。摇摇乐截止时间仍为 `startedAt + durationSeconds * 1000`。数量倍率、速度设置、图片加载、准备等待、页面隐藏都不重新计时；每张图片在自己的最后 600ms 淡出，截止时移除刚体，失去支撑的上层继续受重力。摇摇乐每次结算生成一张由直杆支撑的礼物图，没有底座，文字按该次结算的 `textMode` 组合显示，独立回摆和到期；不合并不同结算的计时。

摇摇乐的礼物图、文字与定长 SVG 直杆共用一个旋转容器，绕底端中心转动；杆体使用静态直线路径，底端固定在画面底部，不逐帧弯曲或拉伸。杆的上端伸入礼物图中心并被图片遮挡，避免素材透明边缘造成连接处断开。

掉落按实际件数与数量倍率生成图片，默认 4 倍，实际 `num` 不变。单次最多 60 张代表图按倍率复制，超出部分在最后一张保留真实余量；同屏最多 400 张（含等待下落的图片），新事件不提前淘汰旧礼物，容量满时不再加入。所有图片都从顶部在同一秒内随机错开下落，数量倍率不延长该窗口。碰撞框宽高为图片的 80%，与图片中心对齐，图片仍按设置的原尺寸显示；这是对透明留白与不规则轮廓的简化近似，不按每张素材逐像素检测。掉落与摇摇乐均通过共享 `gift-image.js` 选择静态 WebP；首帧转换及缓存委托 `gift-static-image.js`，遵循本节共享图片接口的容量和失败冷却规则，失败回退现有占位图。礼物许愿复用该转换但保持静态 PNG。摇摇乐最多同时保留 80 张，新事件同样不挤走旧立牌。重复事件不重复生成；来源 reset、关闭画面和销毁清理节点、帧循环、预览定时器与监听。普通连接短暂中断时已显示的掉落仍按原截止时间结束。正式来源不产生示例、不重播历史、不增加图片目录或 B 站请求。

`gift-effects.html` 保留透明全屏浏览器源地址，消费 `gift:frame`，并将 `gift:effect`
交给独立的 `gift-effect-player.js`。官方特效按已验证 RGB/alpha 坐标用 WebGL 合成，
单条播放、最多 3 条等待、等待超过 12 秒丢弃；错误、30 秒超时和停用统一清理。
弹幕开关关闭或 WS 断开时停止指令特效并清空其队列；手动预览不受开关限制。
服务器代码解析、桌面共用测试播放解析器和兼容规则见 [弹幕礼物特效规格](../../../specs/gift-effect-danmaku.md)。
**特效 1 · 林间花信**（`themeId: woodland-bloom`）通过全屏礼物感谢页「添加样式」导入 1.0.0 ZIP 后播放本地 `woodland-bloom-v4.webm`，视频不再内置于安装包。
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
单行显示“感谢 {礼物名}×{数量} ~”；动态文字由 `textContent` 写入，不显示金额。
头像读取事件 `avatarUrl`，经既有 B 站头像代理和 gift-effects scope 凭据加载；缺失或失败使用默认头像，预览无真实头像时使用本机示例。
文字在 0.65–1.1 秒跟随铭牌淡入，7.2 秒开始淡出，完整展示阶段固定；长文字先适量减小字号，再省略尾部，数量独立保留。
原生边框画布预览以共享的 8 秒时长乘示例事件数后留出 1.5 秒间隔，避免旧 8 秒循环截断退场。
导入的 WebM 通过 `/component-media/` 支持 Range/HEAD。旧图层及 `/gift-effects` 仍使用原静态视频 URL，由 `gift-frame-resource.js` 解析已安装的官方预设并返回不缓存的 307；未导入时返回 404，从库中移除卡片仍保留既有图层资源。HTML 不再预加载固定路径，由播放器在收到组件配置后选择资源，避免导入样式额外请求旧路径。

`gift-frame-queue.js` 负责自定义边框的 FIFO 队列：1 条播放、最多 50 条等待；当前播放不被插队或打断，
满队列忽略新事件，已排队项不因等待时长失效，也不按金额排序。实时与预览均按 eventId 去重，
预览接口每次生成独立 ID。队列接受 `woodland-bloom` 与 `imported`，缺省主题仍按特效 1 处理；导入媒体先由组件按 `styleIds` 筛选，再进入同一顺序队列，旧 `/gift-effects` 不接收导入事件。
`gift-frame-player.js` 交给 `gift-effects-frame.js` 播放。特效 1 由 `giftFrameEnabled` 和
`giftFrameThresholdRmb` 控制；final 礼物按整数分比较触发门槛。
缎带礼笺已撤销，其管理入口、播放器与素材已移除；历史设置不再参与触发，旧主题事件被队列忽略。
加载允许 10 秒，媒体进度停滞 5 秒触发清理；加载耗时不扣减特效 1 的 8 秒动画。
正常结束、解码错误、播放拒绝、超时和 pagehide 都释放回调/计时器并清空画面；错误后后续事件重新加载媒体并推进队列。
旧静态图、挂饰、Canvas 粒子和 frame motion 模式已移除；URL motion 仍只影响大航海感谢。
`gift:effect` 官方特效的独立播放器和队列保持既有行为。

**大航海感谢**：辉光和经典分别启用、设置文字；同时启用时每次合格上舰产生两个带风格后缀的事件，独立风格画布图层各自播放对应事件；通用旧图层及独立页面仍依次播放。画布组件文字默认 `follow`，使用事件文字；已有显式 `bilingual/zh/en` 覆盖继续有效。同一页面在 `#guardThanksRoot` 消费 `gift:guard-thanks`，由 `overlays/gift-effects-guard.js` 按 eventId 去重（预览不去重）、逐条播放，最多 12 条等待、等待超过 90 秒丢弃，队列满时舍弃最早的最低等级；有等待时缩短停留。渲染由 `shared/guard-thanks-card.js` 分发到两套互不影响的风格，经典风格的 Canvas 粒子由 `guard-thanks-particles.js` 管理，辉光光点随卡片一起管理与退场；时间与 DOM 工具共用 `guard-thanks-stage.js`，均同时供画布组件预览使用；1280×1080 设计舞台按 `min(宽/1280, 高/1080)` 居中缩放。事件 `style=classic`（`guard-thanks-classic.js` + `css/shared/guard-thanks.css`）为金属徽章风格：舰长/提督/总督分别为蓝色船锚、紫色罗盘、红金船舵，依次播放冲击波与闪光、徽记入场、头像徽章描边、丝带标题逐字弹出与扫光、标语和感谢铭牌，并有对应的气泡/星芒/彩纸余烬粒子；入场 1.5 秒，停留 3.3/4.0/5.0 秒，退场 0.7 秒；头像只直连 HTTPS hdslb 地址（`no-referrer`），失败或缺失时显示昵称首字，预览使用内置样例头像。事件 `style=aurora`（`guard-thanks-aurora.js` + `css/shared/guard-thanks-aurora.css`）为珠贝质感的辉光柔和风格：舰长冰蓝独立船锚、提督紫晶月弧罗盘、总督红色珠贝与金属独立船舵，仅提督保留实体月弧，使用 1280×1280 的 `img/overlays/guard-thanks/*-pearl-v1.webp` 高质量有损彩色、无损 alpha 的透明纹章，适配组件推荐的 2560×1440、16:9 输出；纹章、标题、光晕、光线与粒子共同使用各档主色，总督辅以金色。入场按弧线勾勒、固定纹章淡入、称谓与说明出现、星芒及光点分批点亮展开；纹章始终保持原位与角度，仅淡入淡出。反光按原图 alpha 裁切后掠过表面，外圈流光以亮头与柔尾沿弧线掠过，细光环、柔光晕与光线缓慢流动，整张卡片统一淡出。称谓采用本地裁剪的宋体标题字库 `fonts/guard-thanks-serif-400.woff2`，下方排列中英说明与月数，文字全程不虚化，以贴合字形的细边保持明暗背景上的轮廓，不铺大面积光雾或黑色暗衬。图片解码和字库在入场前准备，最多等待 1.4 秒；失败或超时时使用矢量纹章及系统衬线字体，播放中不迟到替换；**不出现送礼人头像与名字**。舰长保持 1 条流光、18 枚外圈光点与 3 处纹章星芒；提督增加到 3 条流光、32 枚光点、6 处星芒，并加入双弧与 8 枚星链节点；总督为 5 条流光、50 枚光点、8 处星芒及 12 枚星链节点，另有 9 道冠冕状金色光线和双重扩散环。光点每六枚一组错峰出现。减少动态效果时保留静态主色构图，隐藏闪光、流光、粒子与新增光饰，仅对整张卡片淡入淡出。入场 2.8/3.0/3.2 秒、停留 3.0/3.4/4.0 秒、退场 1.0 秒，三档总时长为 6.8/7.4/8.2 秒；新增的 1 秒用于分段入场，连播只压缩停留（取 0.7），总时长为 5.9/6.38/7.0 秒。两套风格的文字都支持中英双语、中文、英文。`?motion=reduced` 或系统减少动态效果时只做淡入淡出（辉光保留静帧构图）；`?preview=1&guardPreview=<tier>`（可加 `&guardStyle=aurora|classic`、`&guardText=`、`&guardMonths=`）可在页面内单独预览。

### 1.5 开播动画(`/opening`)

`openingStyle` 在工具箱中选择 `classic`（经典舞台，默认）或 `pixel-cassette`（像素卡带），
通过配置字段与 URL 参数 `style` 传递；非法值回退经典舞台。`moonlit-fan`（月渡花汀）保留为兼容枚举，
需导入外置套装并在场景中选用，依赖 [资源型样式](#资源型样式) 的素材映射，不再是工具箱默认选项。
切换复用原有预览、轮询、总开关及音乐控制。
开播配置默认值由 [shared/opening-settings.js](../../../public/js/shared/opening-settings.js) 的 `OPENING_DEFAULTS` 单一拥有；
文案、副标题、主播名、页脚、画质、轨道动效与装饰开关直接取外观定义的默认值，管理页表单回填与浏览器源渲染都读这一份，不各自保留字面量。
像素样式由 `opening-pixel.js` 在 480×270 Canvas 上绘制，按 16:9 最近邻放大。头像默认留空，
通过原人物图上传入口携带 `style=pixel-cassette` 单独保存，不与经典舞台共用图片；上传图保持比例、
居中适配原有 160×160 逻辑像素区域（1920×1080 输出时为 640×640），小图也放大至该区域。
首次选择像素样式时才创建绘图上下文，头像仅在该样式启用且已上传后请求；替换或清除不会重置动画时间。
Canvas 使用固定的 `role="img"`
与无障碍名称；阶梯进度是循环装饰，不逐秒播报。
进度从 0% 开始，每秒跳 20%，100% 保持 1 秒后清空，6 秒一轮；`loading...` 含句点逐字跳跃，
头像、卡带卷轴、装饰及不同路径的背景图案持续运动。低画质或减少动态效果时静止装饰，保留阶梯进度；
隐藏、关闭、切回经典样式或 pagehide 时取消像素帧循环；隐藏后恢复沿用当前进度，关闭后重开或重新
切入像素样式从 0% 开始。像素样式下隐藏文案和轨道编辑项并保留保存值；
轨道动效仅用于经典舞台，音乐继续由同一个开播 runtime 管理。

月渡花汀由 `opening-moon-fan.js` 拥有素材与帧循环，`opening-moon-fan-art.js` 拥有画面与时间线。
首次启用时加载 `img/overlays/opening-moon-fan/` 中的独立 WebP；22 片共轴展开的山水折扇、
双翼白鹤、四组花枝、绢带、流苏、蝶、花瓣、雾和倒影各自运动。背景保留亭台桥廊、满月、
叠山与水面灯影，以近实远淡的对比区分主体；挂饰只保留左侧一组。
每轮 15 秒：0–3.7 秒展开及文案入场，约 3.7–9.2 秒停留；9.2–10.8 秒文案渐隐，
10.2–13.2 秒扇面共轴收拢，13–13.8 秒折扇下移淡出，绢带/花枝依次退场；
13.8–15 秒仅留山水背景及其环境动作，随后重新入场。背景仅首次淡入，周期边界不闪白。
白鹤每轮 1.6–6.5 秒飞过；扇子倒影随收拢姿态变化。标准/流畅画质画布为
1920×1080，目标分别为 30/60 fps；轻量为 1280×720、20 fps，实际帧率取决于设备。
隐藏时暂停并保留进度；关闭、切换样式后重新启用重播入场；pagehide 销毁帧循环。
减少动态效果时显示完整静止构图。素材失败显示刷新提示，不不断重试或启动空帧循环。
该样式不使用人物图或轨道动效；保留文案，花瓣/蝴蝶开关沿用 `openingShowNotes`/`openingShowEq`。
选择此样式时仅将尚未编辑的经典默认标题/副标题替换为主题文案；已自定义的文字保持不变。
默认标题使用独立书法素材，自定义文字用本机楷体；长文案按预留区域缩放，清空后保持为空。

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

Admin 预览通过「预览」打开并选中 `opening` 图层；固定浏览器源地址仍规范化为 `127.0.0.1`。
画布子 iframe 沿用 `sandbox allow-scripts` 与 component-preview 消息，只接受直接父窗口的受限显示数据，
不自行读取 API 或连接 WebSocket。客户端在场景包含开播图层时单次读取配置，结束后间隔 1 秒刷新；
失败发送空数据，编辑器回退为默认动画预览，关闭连接取消请求和定时器。正式场景由 `scene-extra-display.js` 读取并投影同一配置。
画布保存图层位置、尺寸及可选的 `style` 外观：`original`（旧空配置的兼容默认）跟随客户端，
`classic` / `pixel-cassette` 分别固定为经典舞台 / 像素卡带，`moonlit-fan` 固定为月渡花汀。
“添加组件”分别展示经典舞台和像素卡带，添加时固定为所选样式；两款各自的设置由开播设置拥有。月渡花汀等资源样式按各自样式 ID 共享外观参数，画布只显示它支持的字段；修改经典舞台的文案不会影响配套样式。导入、保存与回退规则见[开播配置合同](../backend/api.md#21-开播动画域opening)。画布始终显示动画预览，未启用时静音；正式输出仍遵循总开关。预览不回写总开关，图层样式不回写客户端设置。
文本、音量、轨道和画质变化就地应用；只有更换音乐、关闭或重新开启画面才重新加载相应音频。
相同配置不重建节点或重置轨道，粒子节点仅随画质变化重建，不再运行未使用的粒子变量定时器。
素材上传/清除同样增量更新预览，关闭总开关隐藏正式画面并清空音频，画布保留静音动画预览；设置保存合并并串行执行，重复值不再写入。

经典舞台使用完整人物图，像素卡带使用独立大头贴；两者初始图片均为空，不互相借用，也不清除已有上传。经典舞台没有人物图时使用居中文案构图；人物存在时保持左文右图。主标题最低 `3.4cqw`，允许长标题换为两行，
无人物时最低 `4cqw`；页脚为 `1.25cqw`。文字与无人物构图由 `opening-layout.css` 拥有。
经典舞台和像素卡带默认使用高画质，保留已保存的有效画质选择。漂浮音符和氛围律动固定开启，客户端与画布不再提供独立开关，旧设置及 URL 中的关闭值不再关闭这两项效果；低画质及减少动态效果仍按渲染器规则降级。月渡花汀的花瓣、蝴蝶参数不受影响。
“氛围律动”为固定节奏装饰，不表示实时音频频谱；旧保存键 `openingShowEq` 继续兼容接收。

### 1.6 本日礼物 `/gift-feed`

设置页的两列金额与循环参数下方为「卡片外观」，「尾部样式」与「条带内部」可独立组合。尾部提供经典斜切、双色燕尾、折叠飘带；燕尾保留经典斜切主体，仅在尾部下方 1/3 接出浅色反向小三角；飘带在主条带右端露出向下错位的浅色短尾，并以深色折面连接前后两层。内部保留原纯色，另有丝缎流光、星屑幻彩、几何拼片、菱格织纹、糖纸波点；非纯色材质带细微边缘光影，纹样在文字区域降低对比。丝缎使用连续柔光曲面，星屑使用稀疏微光与细轨迹，几何使用渐变晶面，菱格带双线压纹，波点为细小珠光点。默认外观与旧版一致；选项及默认值由 `shared/gift-banner-styles.js` 统一提供，字段契约见 [API 设置端点](../backend/api.md)。画布共享相同参数，设置页沿用保存、取消与填入默认值流程。纹理使用内嵌 SVG 背景，无新增素材请求，所有样式沿用现有价格配色与卡片尺寸。设置刷新将尾部及纹理纳入横幅缓存签名，就地更新静态或滚动卡片；导出继续读取同一份已保存配置与共享 CSS。

画布的示例数据携带 `preview: true`；金额门槛过滤全部示例时，在组件内说明原因及调整方法。正式来源不携带该标记，空集合保持透明，不输出预览提示。

`shared/gift-card-model.js` 同时供滚动展示和导出运行时派生卡片：仅对北京时间今天的记录，按送礼人 UID、相同礼物 ID 和礼物名合并，累加数量及各条历史单价乘数量的整数分金额，颜色按合计金额计算。身份来自 `/api/gifts/card-profiles`，对同人今日全部卡片使用最新已知昵称、头像及大航海等级；null 不覆盖已知等级，0 明确移除头像框，同等级续费保留未变化的卡片节点。未知 UID 不按昵称合并，旧日期和原始流水保持独立。导出只合并所选记录，资料更新可使用今日未选记录的证据。滚动阈值按合并后的卡片数计算，稳定分组键保留滚动锚点；资料暂不可用时预览说明未完成身份合并。

礼物助手的滚动礼物面板生成当前本地端口的 `127.0.0.1/gift-feed` 地址，`?preview=1` 只增加预览底色和状态。页面独立于管理面板生命周期，按北京时间遍历今天全部分页，包含未参与冲刺的有效付费历史。“最小礼物金额（元）”支持整数或一位小数，默认 0 不限制；正数在完整分页、合并卡片后按 `cardTotalCents` 严格大于门槛过滤，未知 UID 独立记录按历史单价乘数量计价，比较使用整数分。该过滤只作用于滚动集合，不改变历史记录、分色金额或图片导出；配置契约见 [API 设置端点](../backend/api.md)。`gift-feed-state.js` 用 eventId 去重并保留轮播锚点；默认 3 行、速率 12（每行 3.9 秒），速率 1–50 线性对应每行 `5000 - (scrollSpeed - 1) * 4900 / 49` 毫秒。过滤后的条目超过显示行数时连续匀速向上滚动，最后一条紧接第一条；不足或刚好填满时静态显示，不复制填满。动画按帧时间累计位移，换行保留余量，无间隔等待，DOM 只保留可见行及最多一条动画缓冲，并复用未变化的节点。页面隐藏时释放动画帧，恢复后接着当前位置移动。暂停和低功耗选项已移除。

WebSocket 通知合并后重读，可见时每 30 秒对账；隐藏时暂停协调请求并保留失效标记，恢复可见后立即确认设置与目录。目录携带内容摘要，未变化时复用已有数组，不下载和双重序列化完整目录；同版本图片修复仍会更新。刷新保留滚动进度，新集合在换行边界应用，静态时立即更新。礼物通知只重读礼物与身份资料，设置、素材分别在对应失效通知时读取，首次加载、重连及定时对账补读两者；请求期间收到的失效通知合并到下一批。横幅按稳定卡片键插入或复用，`updateGiftBanner` 就地更新数量、颜色、名字、头像与舰队框，只在文字改变时重新测量字体，成功图片不随连击重建。滚动换行先移除离开的行，再插入新的缓冲行，避免搬动仍可见的节点；重复通知且展示资料未变时没有 DOM 写入，失败头像仍可单独重试。午夜、来源切换或投影代次变化清空旧集合，迟到请求不得恢复旧来源。保存配置即更新静态行颜色。`shared/gift-banner.js` 和 `css/shared/gift-banner.css` 同时拥有管理预览、PNG 和 直播画面的横幅：基础尺寸 428×72，行间隔 8px，包含头像占位、可空大航海边框、昵称、黄色礼物名、本地 WebP 和数量。颜色条的圆弧左端与头像同心，56×56 头像置于 (8, 8)，与颜色条圆弧留 4 像素间隙；昵称区、颜色条和 WebP 位置固定，数量保持字号并只向右扩展画布。PNG 按实际画布的 2 倍尺寸导出，基础宽度 856 像素，每页最多 39 条时基础画面为 856×6224，合并时取本页最宽横幅；浏览器源建议宽度 900，以容纳多位数量。金额/时间/备注不进入横幅。

礼物横幅的图片解析由 `shared/gift-banner.js` 拥有。滚动展示、管理预览及 PNG 输出在接收目录快照时建立 variant ID 与「礼物 ID＋规范化名称」索引，同一快照的多张横幅共用；目录替换后重建。规范化继续使用 NFKC、空白合并及小写，重复匹配仍显示占位图，variant 优先且不回退到含糊名称，大航海图标与已指定 `artworkPath` 保持优先级。显式索引保存快照值；仍直接传入可变数组的一次性调用继续即时匹配，不隐式缓存旧数组。

滚动源与画布首次完整读完当天分页后，以同一个内容版本请求有界增量；少量新礼物或更正只传变化行。客户端按 `sortTime` 升序、同时间 `sortId` 降序合并，替换或移除变化身份，保留未变化对象和完整轮播集合。日期、来源、投影代次仍独立校验；跨页内容变动不确认版本。服务器不能证明增量完整时自动返回普通分页，旧服务没有排序标识时继续条件确认和全量读取，详见 [礼物查询契约](../backend/bilibili/gift.md#5-礼物冲刺与查询)。

## 2. 队列叠加层(/queue)

[overlays/queue.js](../../../public/js/overlays/queue.js) 渲染 `state.queue`(current + waiting)与 `state.superChats`:

HTTP 初始/重连请求带本页读取代次，较新的完整 WS 状态使旧请求失效。HTTP 与 WS 共用内容指纹；延迟补数和重连取得相同内容时保留节点及滚动进度。

- **点歌结果提示**：六套内置风格和复用队列渲染器的资源风格共用面板顶部提示，成功为浅绿底绿字，失败为浅红底红字，显示「点歌人 点歌 歌名 成功/失败」。字号沿用当前主文本，内边距、行高与边条随字号缩放；结果固定在右侧。正文窗至少保留 4em 或整行可用宽度；极大字号无法同排时，结果另起一行靠右，保证完整字符可见。正文放得下时保持静止，超宽时保留原字号，开头停 0.6 秒，再以每秒约 2.5em 的速度单次横移，末尾至少停 0.9 秒；很窄的正文窗进一步限制到每秒 0.65 个可视窗宽。每条的完整阅读期至少 3.6 秒，超长内容按实际滚动距离自动延长，计算时长四舍五入到 0.1 秒，读完后才淡出。提示以 240ms 轻微下滑淡入、180ms 淡出退出，不模糊文字；`prefers-reduced-motion` 下只用短淡入淡出，取消垂直位移，必要的正文横移降为每秒约 1em。
- **提示顺序与重排**：[queue-request-notice.js](../../../public/js/overlays/queue-request-notice.js) 消费[临时结果窗口](../backend/music/services.md#81-统一队列语义)，独立来源与场景使用同一投影；首次只建立基线，之后的新 ID 按顺序排队，不覆盖正在阅读的结果，重复快照不续时、不重复播放，旧快照兼容单条字段。接收后等待的结果有独立阅读期，不按接收期限提前取消。宽度、字号或字体实际变化时重新测量当前文字并给予完整阅读期；重复主题或相同尺寸不重启动画。提示浮在面板顶部，不改变歌曲行、队列尺寸或滚动位置；没有独立请求或订阅。卸载取消提示动画/计时并释放尺寸与字体监听。

- **六种风格**:`classic`(默认,经典卡片列表)、`identity`(身份版,观众名突出,含 SC 置顶区)、`storybook`(奶油蓝插画画框)、`neon-vinyl`(甜粉麦克风舞台)、`cherry-ribbon`(紫金星月梦境)与 `golden-lily`(奶油金唱片铃兰);由设置 `overlayQueueStyle` 决定,遗留 `festival` 归一为 `identity`,未知值回退 `classic`。样式由 `overlays/base.css` 导入的 `.queue-*` 主题类承载。
- **风格 3**:框体与词条素材位于 `public/img/overlays/song-board-style-3/`;原始框体保留 alpha,`.queue-storybook::before` 在框内开口后叠加不透明白层,框外仍透明。词条黄色端点恒显示队列序号,浅蓝固定宽度区域复用身份版的歌名、点歌人、大航海/灯牌名与灯牌等级格式;没有大航海或灯牌时省略对应字段。内容实际宽度溢出时由 `scheduleIdentityContentScroll` 在该区域内左右往返,不会扩张词条素材。纵向超出画框时复用身份版的循环/往返滚动测量。
- **月渡花汀点歌板**：资源套装预设 `moonlit-queue` 使用 `overlayQueueStyle: identity`，复用风格 2 的内容、置顶、SC 与滚动；大航海身份使用应用内保存的 B 站舰长、提督、总督图片，保留粉丝牌名称与等级。独立 `queue-moonlit.css` 使用金黄藤蔓、翠绿叶子、紫花与玉坠边框，面板和列表横条完全透明；歌名使用深紫粗体，点歌人略小，序号为赭金色；文字配浅金描边与轻微阴影，徽章采用暖金细边及浅绿、藕紫、胭脂浅底，在山水背景上保持可读。边框为可选资源，旧套装缺失时省略装饰。预设显式携带内容字号（30px）、序号开关与阈值、滚动参数；画布中可编辑置顶、字号和序号显示。本样式不显示标题及底部规则，对应参数也不展示，旧配置中的标题和规则不影响输出；内置风格 2 保持原有行为。仅在导入并选用该资源样式时生效；切回内置风格会移除资源样式。新增组件为 391×476（原尺寸的 85%），内部按 430px 设计宽度等比适配。
- **风格 4 / 5**:各自的框体与词条素材位于 `public/img/overlays/song-board-style-4/` 和 `song-board-style-5/`;框体和词条素材自带粉色或紫金渐变底色。两种风格隐藏通用顶部标题和点歌顺序数字,省略四组字段的说明标签并将短内容居中。每条记录输出歌名、点歌人,并在有数据时输出大航海等级、灯牌名与等级;没有大航海或灯牌时省略对应字段。大航海身份按总督红、提督紫、舰长蓝区分,同一条记录后接的灯牌名与等级徽章沿用该身份色;无大航海时才使用灯牌自身等级色。整组内容实际宽度溢出时复用 `scheduleIdentityContentScroll` 左右往返,纵向超出画框时复用插画风格滚动测量。风格 4 的列表下边界与前景底边内沿对齐,保证滚动终点的最后一条完整露出;风格 5 的列表窗口顶部与首条词条上边缘对齐、底部收进 30px。`prefers-reduced-motion` 下停用横纵动画。
- **风格 6**:奶油金唱片铃兰框体与横向词条素材位于 `public/img/overlays/song-board-style-6/`;词条以内容窗宽度的 72% 居中,完整收进画框的左右前景边框之间,列表上边界位于画框高度的 16.5% 以完整露出首条顶部装饰,相邻卡片以 `4px` 间距清晰分开,左侧花形圆圈显示从 1 开始的队列序号,右侧固定信息窗省略说明标签并输出歌名、点歌人,在有数据时输出大航海等级、灯牌名与等级;没有大航海或灯牌时省略对应字段。大航海与后接灯牌徽章使用和风格 4/5 相同的总督红、提督紫、舰长蓝身份色,无大航海时保留灯牌等级色。信息窗内容实际宽度溢出时复用 `scheduleIdentityContentScroll` 左右往返,纵向超出画框时复用插画风格滚动测量,列表下边界停在第 4 个序号附近;`prefers-reduced-motion` 下停用横纵动画。
- **风格 4–6 的画框层级**:完整框图作为底层保留中间色块,卡片与文字位于中层,同一框图去掉中心填充后以 `border-image` 作为顶层装饰。卡片滚动时会从丝带、花朵、唱片等边框装饰下方经过,但始终显示在框内中间色块上方。
- **六种风格的浏览器源缩放**:六款点歌板都在固定设计坐标中完成排版(`classic` 宽 405px、`identity` 宽 430px、插画风格宽 560px),内部背景、框体、词条、文字、徽章、间距和裁切窗口不随浏览器源单独重排。`queue-viewport.js` 在面板完成渲染后按浏览器源可用宽度与高度分别计算比例并取较小值;风格 1、3–6 可随浏览器源整体放大或缩小,风格 2 将最大倍率限制为 `1`,在较大的 浏览器源画布中保持默认 430px 宽度,仅在画布不足时等比缩小。源比例与点歌板不一致时在未占满的一轴保留透明空白,不拉伸图片或文字。风格 3 的列表窗口仍在设计画布内整体上移 10px,为最底部可见词条保留安全距离。
- **风格 3–6 的词条缩放**:词条盒、位图、文字窗口和序号共用同一坐标系,不通过裁剪去掉上下装饰。风格 3 在 CSS 背景坐标中排除原 PNG 顶部和右侧的大块透明留白,不改写原始素材;风格 4/5 的完整 PNG 占内容窗宽度的 94%,风格 4 使用 `2172:517.5` 显示比例(高度为此前的 115%),风格 5 的显示高度为素材原比例的 80%;风格 6 使用完整 PNG 比例占 72%,三款列表起点都避开画框顶部前景装饰。
- **滚动**:classic 走 CSS 动画滚动(`classic-scroll` 循环 + `scrolling-bounce` 有节奏往返模式,loop clone 双份列表实现无缝循环),读取 `queueScrollMode`/`queueScrollSpeed`;identity 读取 `identityQueueScrollMode`/`identityQueueScrollSpeed`;风格 3–6 分别读取 `storybookQueue*`、`neonVinylQueue*`、`cherryRibbonQueue*`、`goldenLilyQueue*` 的滚动模式和速度。六种风格都在固定设计高度的列表窗内测量真实内容溢出,浏览器源 resize 后 `relayoutQueue` 重新配置并再次同步整板比例;重渲染时 `captureScrollAnimation/restoreScrollAnimation` 在 rAF 帧内恢复 CSS 动画进度,不跳帧不闪动([queue.js:174-202](../../../public/js/overlays/queue.js#L174-L202))。
- **低功耗**:`overlayLowPowerMode` 或 `?quality=low` 时停用毛玻璃/辉光等重特效(`.overlay-panel.low-power` 面板级降级,classic/identity 共用,[foundation-and-classic.css](../../../public/css/overlays/base/foundation-and-classic.css))。
- **快照消费**:指纹 = 当前歌/等待队列的请求 ID、歌名、昵称、置顶，以及当前样式实际消费的舰队等级/粉丝牌等级/名称，再加 SC 与全部主题和滚动键;`queue:add`/`bilibili:danmaku`/`bilibili:superchat` 等 reason 走 80ms 延迟 `loadState()` 强刷(确保请求者元数据落库后再取,见 [queue.js:96-110](../../../public/js/overlays/queue.js#L96-L110));`live:status` 只更新直播状态不重渲染。
- 主题:经典/身份版色板、字体、字号、置顶 3 条、规则 6 条均来自快照 `settings`(管理页「点歌板/展示板」配置);`public/js/shared/queue-style-settings.js` 在渲染和滚动测量前把当前 `overlayQueueStyle` 的独立设置投影到现有渲染字段。风格 2 保留 `identityQueueFontSize` 并新增独立滚动模式;风格 3–6 各自持久化内容字号、字体、字重、自定义文字颜色、纵向滚动模式和速度,旧共享 `illustratedQueue*`/`queueScrollMode` 值仅作为旧快照兼容回退。

风格 1、2 的设置页、独立预览和画布参数使用「字体设置」选择器，分别读写 `overlayFontFamily` 与 `identityQueueFontFamily`，默认均为 `Microsoft YaHei`；选择器提供软件字体库和系统字体库，切换风格回填各自选择，编辑时只更新当前风格的字体键。风格 2 渲染时将独立值投影至既有 `--overlay-font-family`；旧快照缺键时兼容原 `overlayFontFamily`。首次升级与旧场景读入保留旧字体，后续独立保存；插画风格保留各自字体，月渡花汀资源样式保留包内专用字体。

## 3. 歌单叠加层(/songlist)

[overlays/songs.js](../../../public/js/overlays/songs.js)(ES Module):

- 数据:`GET /api/state` + `GET /api/songs?enabledOnly=true[&category=]`(支持 URL `?category=` 单分类过滤)。
- 排序:`songBoardSortMode`(默认拼音/字母,`length` 按时长分组),`buildSongRecords` 生成记录,分组模式下加分组头。
- 字号:普通 `/songlist` 关闭主题同步时，歌曲按 `songBoardSongFontSize × songBoardFontSize / 16` 显示，保留整体字号倍率；同步主题时继续使用 16px 基准乘该倍率。画布组件沿用 `scene-components.css` 的绝对歌名字号覆盖。
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
| `height: var(--component-height, 100vh)` | `100dvh` 覆盖必须放在 `@supports (height: 100dvh)` 内。旧内核对 `var()` 内不支持的单位会在计算值阶段判为无效，连续写 `vh`、`dvh` 不能兜底；配合 size containment 会使高度变成 0。已在 Chromium 106 复现并验证修复。 | [overtime.css](../../../public/css/overlays/overtime.css) |

### 4.3 时钟与数字呈现

- 时钟字号:**8.5em × 2cqmin = 17cqmin** 等比缩放(`font: 700 8.5em/0.9 Bahnschrift SemiCondensed,…` + `tabular-nums`,[overtime.css:94-100](../../../public/css/overlays/overtime.css#L94-L100));管理页预览时钟为 `clamp(42px, 5vw, 70px)`([console.css](../../../public/css/admin/overtime/console.css))。
- 时间格式:`formatClockSeconds` 恒补零到两位 → `02:05:09`,超过 99 小时自然增长为 `120:00:00`([overtime.js:267-273](../../../public/js/overlays/overtime.js#L267-L273))。
- 时钟调度:运行中按当前显示层级的下一秒/分钟/小时边界使用一次性 timeout 更新，值未变化不写 DOM；暂停、结束或页面隐藏时清除时钟 timer，恢复可见或收到新 revision 时重新锚定。
- 数量封顶:结算卡片数量 `> 99999` 显示 `99999+`([overtime.js:275-278](../../../public/js/overlays/overtime.js#L275-L278))。
- 结算动画:每次 `overtime:update` 携带 `adjustment` 时入队(队列上限 5,满则合并为"连续礼物 · 净变化"聚合卡片)依序播放盖章动画 + 门票高亮 + 时钟变色闪动([overtime.js:167-230](../../../public/js/overlays/overtime.js#L167-L230))。
- **动画降级**:`prefers-reduced-motion: reduce` 媒体查询与 `low-motion` 类都把动画压缩到 180ms;低功耗 `?quality=low` 时动画时长同步缩短。
- 设计令牌:夜色 `#181823`、粉 `#ff6f91`、青 `#21b6a8`、珊瑚 `#f0677d`、金 `#f5b72f`、文字 `#fff7fb`([overtime.css:1-8](../../../public/css/overlays/overtime.css#L1-L8));门票按效果取色:加时=青、减时=珊瑚、盲盒=金、文字展板=粉、不变=灰。文字展板规则的自定义文字通过 `textContent` 写入效果区域，收到对应礼物不改变数字倒计时。

## 5. 盲盒叠加层(/blindbox)

客户端「组件 → 礼物姬 → 盲盒盈亏榜」和画布共用标题、榜单人数、盈利筛选、心动盲盒筛选、城堡展示、紧凑布局、自动翻页及字体配色设置。字体与配色继续沿用通用主题；画布只显示一个盈利筛选，旧 `hideLoss` 字段仍作兼容别名。新复制的地址不带这些参数，保存后跟随 settings 更新；已有 URL 显式提供的同名参数继续优先。筛选变更会重新读取统计并使场景盲盒缓存失效。

面板最大高度以 `100vh` 减去上下边距为基线，仅在 `@supports (height: 100dvh)` 内改用 `dvh`，避免旧内核让带 `var()` 的 `calc()` 计算失效而丢失视口限制；超出高度的榜单仍可滚动。

[overlays/blindbox.js](../../../public/js/overlays/blindbox.js):

- 数据:汇总 + 排行榜来自 `GET /api/gifts/blind-box-stats`，携带 top/hideLoss（心动盒额外带 boxName）；服务端按先过滤再截取的规则裁剪 perUser，top=0 不返回用户榜。快照 reason 以 `bilibili:gift`/`gift:sprint:reset`/`connect` 触发重取统计；最多一个请求在途，其间多次变化合并为后续一次刷新。所有带 state 的快照立即应用主题及标题；统计与设置独立判断新旧，相同统计内容保留榜单节点和翻页进度，汇总模式不序列化用户榜。
- URL 参数(短别名 + 长键):`top/t`(榜单位数,0=仅汇总,-1=全部)、`winners/w`(只看盈利)、`heartBox/hb`、`title/tt`(自定义标题,优先于设置 `blindboxOverlayTitle`)、`compact/c`、`hideLoss/hl`、`refresh/r`(轮询秒数)、`noScroll/ns`；这些显式参数兼容旧链接。管理页「组件 → 礼物姬 → 盲盒盈亏榜」保存公共设置并复制不带参数的 `/blindbox` 地址(见 [app.md](app.md) §4.3)。
- 紧凑布局默认关闭，自动翻页默认开启，由共享设置 `blindboxCompact` / `blindboxAutoPages` 控制，旧 URL 的显式参数优先。盲盒默认隐藏滚动条；`noScroll=1` / `ns=1` 保持隐藏，显式 `0` 恢复细滚动条和手动浏览。隐藏模式超高内容复用 `auto-pages.js` 每 8 秒翻页，保留 32px 阅读重叠并在尾页停留后回到顶部。该模块也服务画猜积分、正确答案、窄布局和游戏结果卡；不使用连续动画，低功耗或减少动效时仍可阅读全部已选内容。滚轮、指针、触摸或键盘操作暂停 16 秒，焦点留在区域内时持续暂停；页面隐藏不翻页，卸载时清理。
- 呈现:独立浏览器源默认宽 720px；画布中新建组件默认 720×640px，尺寸定义由 `shared/scene-extra-components.js` 提供。顶栏第一行并列标题与总盈亏(涨绿跌红)，第二行显示开盒数、花费和开出价值；“开出价值”直接使用统计的 `summary.totalValue`。字号比例为 1 时，标题与昵称 32px、盈亏金额 38px，统计、名次、盒数及空提示 30px；字号跟随 `themeFontScale`，全部文字下限为 30px，紧凑布局只收紧间距。容器宽度不超过 539px 时，标题、总盈亏与统计分行排列。榜单每位观众分两行显示昵称及开盒数量/盈亏，较长金额按空间换行；容器达到 600px 时榜单改为单行。前三名显示带数字和绶带的金、银、铜奖牌，第四名起使用普通数字；奖牌由 CSS 绘制，尺寸跟随字号比例。榜首浅金色强调，金额右对齐，不显示额外头衔、重复表头或空白页脚。没有开盒记录时省略汇总，只显示“等待开盒”；已有开盒但盈利筛选结果为空时显示“暂无盈利观众”。仅汇总模式隐藏标题和榜单，保留顶栏统计及零值。`compact/winners-only/summary-only/no-scroll` 类切换形态；主题从快照 settings 经 `applyTheme` 应用(与队列层同套令牌)。
- 心动盲盒:勾选后，顶栏下的细分隔栏可显示「今天 N 倍堡」「还有 N 个堡」「已开 X 个盲盒」，文案基准 30px、数字基准 36px，字号缩小时仍不低于 30px，空间不足自动换行。倍数留空隐藏，剩余数与开盒数各有独立开关，剩余数为手动值（0 也显示）；关闭心动筛选后整栏隐藏。自动进度沿用[后端统计规则](../backend/bilibili/gift.md#4-盲盒服务器结果与客户端展示)，只计算今日心动盲盒开出浪漫城堡后的数量。设置更新即刻应用，无需重建相同榜单；画布使用示例开盒数 12，正式浏览器源使用实际统计。字段默认值和范围见[存储设置](../backend/storage.md)。
- 画布缩放：组件预览与场景输出使用 720px 设计宽度，按组件实际宽度整体等比缩放文字、奖牌和间距；上述字号及下限均为缩放前的设计尺寸。可用高度换算回设计坐标，继续用于原有翻页；仅调整高度不改变字号。独立 `/blindbox` 浏览器源保留原有自适应重排。
- 数据刷新:WS reason `bilibili:gift`/`gift:sprint:reset`/`connect` 重取统计,`refresh/r` 参数支持定时轮询(≥10s)兜底,适用于 WS 不稳的投屏环境。

## 6. 直播歌词页(/lyrics)

管理入口「组件 → 音乐展示 → 直播歌词」分为基础与高级两个编辑界面。编辑页签只选择本地预览，不改输出开关；`desktopLyricEnabled` 与 `advancedLyricEnabled` 分别控制基础多行和高级构图，两者可同时启用。默认只启用基础层。合并输出 `/lyrics` 同时启用时将基础放在上部 55%、高级放在下部 45%；仅一层显示时使用完整区域。`?layer=basic` / `?layer=advanced` 可分别摆放，仍服从各自开关。场景仍使用 `lyrics` 类型，实例字段 `lyricLayer=both|basic|advanced` 只筛选本实例，不被公共外观覆盖；组件整体位置和尺寸仍由场景拥有。

高级视觉由 `lyrics/advanced-lyric-renderer.js`、`advanced-lyric-layouts.js`、`advanced-lyric-motion.js` 与 `css/lyrics/advanced-lyric.css` 负责。排版、材质、描边/投影/发光等叠加字效、入场/停留/退场/逐字动作及装饰相互组合；始终只显示当前句，可附当前句翻译，不生成上下句。`advancedLyricHideUnsung` 默认开启：字形及描边、投影、回声按时间显现，底板随该组首字出现；关闭后当前整句可见并保留逐字高亮。退出仅使用演唱结束后的剩余时间，不提前淡出尾字。构图在换句、有关设置、字体载入或容器尺寸变化时测量并适配，显现过程中不重新排版或测量。已提供的逐字时间随字形映射；多字 token 在其区间内按字形均分，缺少逐字时间或翻译独立时间时使用句内估算。组合字形保持完整，连写文字与超长句的合并单元用连续蒙版显现。排版与入场轮换按句索引确定，返回同一句时保持相同组合；减少动态效果时保留时间显现并取消空间动作。前端配置与视觉目录来源为 `shared/advanced-lyric-appearance.js` / `advanced-lyric-catalog.js`，保存边界见 [歌词视觉设置](../backend/storage.md#歌词视觉设置)。

基础和高级共用 `desktop-lyric-renderer.js` 的一套歌词输入、当前行索引和 `LyricWordRenderer` 时钟/调度；高级渲染器只消费 frame，不创建网络连接、歌词解析或自己的帧循环。高级动画由同一播放位置校正 Web Animations 的时间，暂停/跳转同步更新；两层关闭、页面不可见或无歌词时停止持续帧任务，关闭基础层释放整首行 DOM。单文档共享不等于跨浏览器进程复用绘制：两个独立浏览器源仍各自绘制，场景数据依旧通过父窗口传入。目录缩略卡静态绘制，当前预览才播放动作。

编辑预览可在输出关闭时查看所选层；「查看实际叠加」按真实开关合成。示例试播只替换该预览的合成时间轴，不发布到真实歌词源、不控制音乐播放器；点击「当前歌曲」恢复已缓存的实时数据。样例隐藏时暂停并取消结束定时器，重新可见后继续；到结尾停止，手动重播。预览背景仅用于检查透明内容，不进入输出。

普通歌词默认使用「荆南麦圆」（`Lira Maiyuan`）。所有现有字体入口（播放器、歌词、弹幕及其独立预览、点歌板、展示板及画布对应参数）由 `shared/font-library.js` 使用同一份 `shared/font-catalog.js`，显示“软件字体库”中的 19 款字体及“系统字体库”中的本机已安装字体；包含悠哉、志莽行、马善政、霞鹜文楷、Nunito、思源宋体、Poppins、Quicksand、Montserrat、Cinzel、M PLUS Rounded 1c、Noto Sans、Gowun Dodum、Noto Serif Tibetan，得意黑复用已有文件。完整字体首次经 CDN 补齐后通过本地 `css/shared/display-fonts.css` 按需加载，首次补齐需要联网；缺字沿用系统/补字回退，资源及许可见[字体说明](../../../public/fonts/README.md)。歌词字体值仍允许最多 256 个字符；画布其他字体参数保留原 80 字符限制。旧字体 ID、未加引号的字体名和已保存的系统组合值继续可读，不改写已有选择。独立预览中的系统字体枚举沿用浏览器许可；未获许可时仍保留当前设置。月渡花汀资源样式仍使用包版本专用文楷，带引号或旧名称均可映射。

字体补字自动处理，设置页和画布均不显示备用字体输入。`lyrics/desktop-lyric-styles.js` 在所选字体之后依次使用 `Lira Lyric Korean`（韩文）、`Lira Xiaolai`（中日及其他已收录文字）、`Lira Lyric Extended`（扩展字母），再保留旧 `desktopLyricFallbackFontFamily` 和系统字体作为最后备用；旧键继续可读，设置页自动保存不覆盖它。末尾的 `serif`、`sans-serif`、`monospace` 移到补字字体之后。阿拉伯文、希伯来文、泰文及南亚等连写或组合文字由链首的 `Lira Lyric Scripts` 按 `unicode-range` 提供完整字形，避免装饰字体只覆盖部分字符而拆散排版。补字资源由共享字体库统一登记，与其他组件共用本机 CDN 缓存，兼容字体族由目录元数据生成，按文字需要加载；纯中文歌词不加载额外语种字库；支持常见中、英、日、韩、欧洲、中东、南亚及东南亚歌词文字，但不承诺全部 Unicode。详细范围、上游版本及许可见[自动补字资源](../../../public/fonts/lyrics-fallback/README.md)。客户端预览、画布与直播输出共用此字体链。

歌词正文、翻译和罗马音均按内容自动判断文字方向。包含连写文字、组合附标或分解韩文的句子保留完整文本排版，以整行跟随播放，避免逐字高亮的独立块拆断字形；普通中文、英文、日文及预组韩文继续使用原有逐字效果。

字体大小 `desktopLyricFontSize` 为 24–72px，设置值直接决定正文的 CSS 字号；翻译按 `desktopLyricTranslationScale` 缩放，罗马音为翻译字号的 86%。客户端预览和直播输出共用字号规则，窄画面通过换行容纳内容，不再按视口或预览容器宽度另行缩小文字。

字间距 `desktopLyricLetterSpacing` 范围为 `-0.1–2em`，默认 `0`，步长 `0.01em`；设置页、画布参数与共享渲染器使用相同限制。设置页的字间距滑块通过 `data-range-scale="balanced"` 将负值侧分配为轨道的 25%、正值侧分配为 75%，两侧分别线性映射；拖动、零点标记和圆点位置共用 `shared/parameter-range.js` 的映射。原生输入值、键盘步长、数字输入与保存值仍使用实际 em 数值；未标记的滑块保留原有线性比例。

`desktopLyricCurrentLineEnhanced` 控制当前句的底板和光晕，界面名为「当前行底板」，普通歌词默认关闭；逐字高亮独立保留。更新不改写已保存的字体或底板开关，恢复默认才使用新默认值。月渡花汀资源样式显式启用该项以保留其诗笺效果。

画布资源样式 `moonlit-lyrics` 通过现有套装加载器按需装入 `css/lyrics/moonlit.css` 与 `moonlit-font.css`，复用银蓝花枝并加载套装内的霞鹜文楷 Light 分片字体；`style` 默认为 `default`，导入后可为 `moonlit`。它与普通直播歌词共用 `lyrics/desktop-lyric-renderer.js`、`desktopLyric*` 参数及 `--preview-*` 变量，不建立额外时间轴或轮询。诗笺和花枝属于当前句强调层，逐字高亮为暖金；字体、字号、颜色、行高、翻译、描边、透明度、显示行数及暂停隐藏仍由共享设置决定。默认主字 48px、行高 1.2、单句显示，诗笺最小高度 108px；内容增多时允许扩高。字体参数「月渡花汀文楷」在渲染时映射为当前资源版本专用字体名，自定义字体仍走共享参数。字体资源为可选项，旧套装继续有效；新套装携带完整字符覆盖的 23 个 WOFF2 分片和 OFL 许可证。退出资源样式时随套装样式表一起移除装饰与字体。逐字节点挂载前清空该行的静态文字，避免原句和逐字层重复显示。

[overlays/lyric-window.js](../../../public/js/overlays/lyric-window.js):

- 画布使用静态示例歌词，预览投影关闭暂停隐藏；保存的 `desktopLyricHideOnPause` 不变，正式输出仍按实际播放状态决定是否隐藏。
- 使用方:管理页直播歌词预览顶部「复制合并地址」复制规范地址 `/lyrics`,供浏览器或浏览器源使用;页面背景透明,实际输出不包含管理页预览使用的网格/纯色辅助背景。
- 数据:首次连接和重连均从 `/ws` 的 snapshot 取得两层视觉设置（排除自存搭配库）、`lyricState` 和 `lyricTimeline`，并消费增量 `lyric-state`、`lyric-timeline`。页面不再请求不存在的 `GET /api/settings`。
- 基础渲染:与管理页 `admin/desktop-lyric-preview.js` 共用 `lyrics/desktop-lyric-renderer.js` 的完整时间轴渲染器,显示整首歌词、翻译、罗马音、当前行逐字进度和长间奏三秒倒计时;预览与直播输出均不显示歌曲总进度条。逐字高亮支持连续填充与按时间点亮两种模式,隐藏 `desktopLyricPreviewPlayback` 只提供 aria-live 文本,当前行 `LyricWordAnimator` 是基础层的唯一视觉逐字更新源。样式设置通过同一组 `--preview-*` CSS 变量应用,因此浏览器源与管理页实时预览一致。
- 基础间奏提示:按上一句最后一个有效字词的结束时间计算空档，无逐字时间时使用有效的行结束时间；空档至少 6 秒，才在下一句前最后 3 秒显示三个点。只有开始时间或以下一句开始时间推算结束时间的普通歌词不猜测间奏；长前奏仍从歌曲起点计算。限定显示行数时，提示在已唱完的当前行内替换正文、翻译和罗马音，保留原占位，下一句不会被额外提示行推开；整首模式保留独立提示行。提示尺寸随字号调整，颜色跟随文字和显式已唱配色，跳转和模式切换会恢复歌词。
- 预览底板:网格与纯色辅助背景按未唱文字的相对亮度自动使用浅色或深色，保证默认黑字和浅色文字均可检查；只影响管理页辅助底板，直播来源仍透明。无歌词提示也跟随文字颜色。
- 文字描边:新配置、恢复默认及新建画布歌词组件的 `desktopLyricStrokeEnabled` 默认 `false`；缺失设置时同样关闭。已有配置中显式保存的描边选择继续生效。
- 逐字配色:「高亮与配色 → 逐字高亮方式」及画布参数集中提供「已唱颜色」「未唱颜色」，文字排版不重复展示文字颜色。未唱颜色复用原 `desktopLyricTextColor`，原保存值保持不变，同时用于普通整句、翻译、罗马音及关闭逐字时的歌词。新增 `desktopLyricSungColor` 默认空值，表示跟随样式（普通为 `#ffcf4a`，月渡花汀为 `#93682f`）；取消跟随后自定义当前句的已唱高亮色，两种高亮模式共用。两个颜色按钮各自支持透明度，不改写统一的 `desktopLyricOpacity`；同组保留歌词文字不透明度控制，统一影响两种颜色。恢复默认将未唱设为黑色、已唱恢复跟随。预览、直播来源和画布共用 `--preview-color` 与 `--preview-sung-color`。
- 基础设置分组:客户端与画布共用 `admin/desktop-lyric-parameter-layout.js`，依次为文字排版、显示内容、高亮与配色、描边与阴影、位置与动效、背景与画面、播放与同步。前两组默认展开；更多排版、当前行强调、阴影位置、位置微调、3D 倾斜和画面调色分别收在所属组内。翻译、描边、阴影、背景关闭时收起依赖参数，关闭逐字时收起已唱颜色，均保留原值；分组摘要展示当前状态，不统计参数数量。非当前行不透明度仍使用 `desktopLyricBaseOpacity`，同时作用于前后歌词；繁体字形仍由字体的 `font-variant-east-asian` 实现，不转换歌词文本。
- 显示行数:管理页和画布「显示内容 → 显示行数」提供整首、当前句、当前句和下一句、自定义行数；选择自定义可继续输入原范围内的行数，切换预设后可回到本次编辑的自定义值。界面选项不新增持久化字段，仍由 `desktopLyricVisibleLines` 同步控制预览与浏览器源。设置 `desktopLyricVisibleLines` 为 `0` 时保持整首可见;正整数仍创建整首时间轴,只将当前行窗口外的行标记为不可见。`1` 仅显示当前行;偶数向下扩展,奇数向上下扩展,整首数据继续保留以保证同步和自动跟随。
- 播放换句:正常播放到下一句时，`lyrics/desktop-lyric-line-transition.js` 记录换句前的位置；已经可见的行从原位置连续移动，新进入的行在 360ms 内轻移、淡入。退出显示窗口的句子保留切换瞬间的逐字高亮，以不参与布局及辅助阅读的短暂快照在 180ms 内淡出；结束、切歌、跳转、手动浏览及样式变更时清理。连续换句从尚未结束的动画位置续接，不排队。这项基础过渡独立于弹性动画开关，系统减少动态效果时只保留 140ms 淡入淡出。
- 逐字动效:连续填充与按字点亮共用轻跳效果，按原始字词时间上浮、轻微放大，长音保持后柔和落回；默认样式、月渡花汀及共享该渲染器的样式均适用。暂停与跳转对齐播放位置，只为当前字词及短暂收尾创建位移动画；换行、关闭逐字或性能降级时释放，系统减少动态效果时只保留高亮。无逐字时间数据时保持原有整行显示，不推算字词时间。
- 增量渲染:只为当前正在填充的词创建高亮动画；未开始的词保持未亮，唱完的词写入全亮状态后释放动画，跳回词内时按当前进度重建。暂停保留当前词的填充位置，不逐帧重写相同时间或反复调用 play/pause；手动及静态高亮只写变化值。换行仅更新旧、新活动行涉及的状态与可见窗口差集；跳转同步跨越区间，显示行数变化同步新窗口，替换时间轴时重建初始状态。倒计时只在目标句或显示秒数变化时更新。共享渲染器按规范化后的设置和完整时间轴去重，相同快照不重建歌词、取消换行动画或重置手动浏览；真实内容和设置变化仍即时生效。
- 隐藏预览:共享 `LyricWordRenderer` 同时检查文档可见性与调用方指定显示区域的 IntersectionObserver；桌面歌词观察实际舞台，避免把隐藏的 aria-live 节点当成显示区域，全民 K 歌观察包含歌词、进度条和时间的完整面板，避免单独滚出歌词行时停更仍可见的进度。隐藏时停止刷新调度，桌面歌词同时暂停逐字动效并清理滚动/换行过渡；状态接收及播放时钟仍正常更新，重新可见时立即按当前时钟重绘和跟随，不补播隐藏期间动画。观察器在 renderer dispose 时释放。可见时的帧率、画质及既有性能自适应规则保持不变。
- 性能默认值:新配置默认关闭弹性滚动、非当前行模糊和行缩放,优先保证歌词清晰与浏览器源稳定;用户已保存的显式设置继续生效。左对齐、居中、右对齐和两端对齐统一作用于当前句与普通歌词；两端对齐时逐字节点按行分布，英文词间空格保留。居中的正文、翻译和罗马音使用均衡换行，行缩放以所选对齐边缘或中轴为原点，切换高亮不会改变对齐方向。
- **滚动与跟随**:歌词视口拥有独立纵向滚动；上下留白按视口高度及所选对齐位置计算，首句、末句和限定行数也可落在指定锚点。当前行及相邻行使用实际高度，视口或时间轴尺寸改变后重新跟随，避免长句、翻译或字体加载后的定位偏移。弹性动画开启时，自动跟随使用逐帧弹簧；关闭时直接更新滚动锚点，由上述播放换句过渡衔接视觉位置。用户滚轮、触摸、指针或键盘滚动后暂停自动跟随 6 秒,再恢复到当前行。
- **状态防回灌**:客户端只接受更大的 `generation`,或同一 generation 下严格递增的 `sequence`;旧客户端缺字段时保持兼容。`content-visibility:auto` 与 `contain-intrinsic-size` 跳过视口外绘制,不改变完整歌词的滚动结构。
- **时钟与逐字连续性**:共享 `LyricWordRenderer` 的普通状态更新使用 `LyricClock` 已有的 350 ms 漂移容差，在容差内保持本地连续时钟，不逐包强制校准。连续播放且速率不变时，与上次原始采样相同的 `currentMs` 不作为新锚点，避免重复读数把同一个字的填充反复拉回；本地时钟仍按播放速率推进，并受歌曲时长约束。首次状态、generation/曲目变化、显式 discontinuity、暂停/继续、速率变化及新位置的超阈值漂移才重锚；因此内置 seek 和来源切换允许小幅向后跳转，外置读数变化后的大幅跳转也能立即跟随。完整时间轴预载各行 `words`，`desktop-lyric-renderer` 按本地时钟直接开始下一句首字，不等待新句状态包；晚到的当前句状态复用已创建的动画。旧时间轴没有逐字时间时回退 `lyricState.words`，下一行采样提前到达时保留显示中当前行的动画，实际换行再释放。generation/曲目变化同步重锚当前逐字动画。此策略统一覆盖内置及各外置播放器的管理页预览和歌词浏览器源；WeSing 播放页仍复用同一时钟。

### 歌曲信息(/now-playing)

独立透明页面 [now-playing.html](../../../public/pages/overlays/now-playing.html) 由 [now-playing.js](../../../public/js/overlays/now-playing.js) 接收 `nowPlaying/nowPlayingConfig` 快照及 `now-playing` 消息；画布内通过 `mountSceneExtraClient('now-playing')` 使用父页提供的配置和 `{nowPlaying}`，不另开歌曲订阅。

[now-playing-renderer.js](../../../public/js/shared/now-playing-renderer.js) 与客户端预览共享，提供黑胶、圆形封面、带唱臂唱片机，以及横向/纵向布局。仅唱片旋转，文字保持稳定；暂停保留当前角度，缺失封面使用默认唱片，旧图片加载结果不能覆盖新歌。显示唱片/歌名/歌手、暂停隐藏与空曲目隐藏分别可调，系统减少动态效果时停止旋转。歌名和歌手通过文本节点输出。

当前曲目信息来自与歌词相同的来源仲裁，曲目没有歌词仍可展示。客户端入口为「组件 → 音乐展示 → 歌曲信息」，可切换当前/示例预览；独立页面只接收本组件的外观与歌曲展示字段，允许只读配置请求，不获得音乐控制或管理权限。画布中与歌词分别摆放、缩放、隐藏和发布。原生字段统一见 [now-playing-appearance.js](../../../public/js/shared/now-playing-appearance.js)。

## 6.1 弹幕姬

桌面设置区通过已有场景地址输出画面；样式选择与弹幕过滤各有独立边框，
弹幕过滤位于参数调节的「高级参数」下方，包含用户黑名单和敏感词屏蔽，
由 `admin/danmaku-overlay-filters.js` 通过独立受限 IPC 管理服务器私有配置。UID 可直接输入，
也可读取当前绑定直播间的 B 站在线榜后搜索、勾选；榜单只包含接口返回的部分观众。
词语按正文包含匹配（英文不区分大小写），支持单个移除和一键清空。列表操作即时提交，
确认成功才更新展示，失败保留输入；账号切换清空输入与列表、忽略旧回包。
过滤只影响保存后新收到的普通弹幕，不改变现有卡片、礼物、系统提示或其他弹幕消费者，
服务器配置在客户端关闭后仍生效。样式预览与显式应用流程保持独立。

桌面弹幕外观由 `danmaku-appearance.js` 与 `danmaku-appearance-store.js` 按授权 Server origin + streamerId 保存在本机。`danmaku-overlay-settings.js` 复用配置控制器，通过本机管理 API 读取和保存，编辑仅为草稿；迟到回包不覆盖新编辑或新账号。首次成功读取承接旧远端配置，后续云端外观不再覆盖本地参数。具体接口见 [本机弹幕外观管理](../backend/api.md#本机弹幕外观管理)，持久格式见 [本地场景持久化](../backend/storage.md#本地场景持久化)。

“预览与调整”由 `admin/danmaku-overlay-settings.js` 使用 `danmaku-preview.js` 创建组件描述，再经 `component-preview-dialog.js` 打开系统浏览器中的场景编辑器。其 `/danmaku?preview=1&componentPreview=1` 子 frame 保留 `sandbox allow-scripts`、opaque origin，不能访问父页凭据/preload；网页修改经临时组件会话返回客户端原控制器，再写本机外观 API。关闭销毁 frame 和消息监听但保留共享草稿；账号切换使旧会话及迟到保存失效。新流程使用既有本机场景来源，要求桌面持续运行；旧服务器在线源独立兼容，当前客户端的外观保存不会改变其配置。

独立弹幕的布局契约由 `shared/danmaku-layout.js` 定义为 `{canvas,contentScale,regions}`，与客户端 Node 校验保持一致；公共分辨率预设由 `shared/canvas-presets.js` 提供1280×720、1920×1080默认、2560×1440、3840×2160、1080×1920及自定义（320～7680整数）。各样式各自记忆 `{x,y,width,height}`；固定样式默认距左/下40，其中七款尺寸依次为bubble570×560、signal560×600、minimal588×576、ranked640×640、transparent520×540、identity640×616、moonlit480×700，Twitter 为480×700；outline/cream/glow默认铺满，称“区域随机”。新默认尺寸不覆盖已保存的区域位置和尺寸。独立弹幕区域至少64×64且不能超出其画布；统一编辑器的三栏布局及公共图层操作见下方组件系统说明。

从旧布局向场景添加新增弹幕样式时，`admin/danmaku-preview.js` 对缺失的样式区域使用 `defaultRegion(style, canvas, contentScale)`，不回退到整张画布尺寸；已保存的样式区域继续沿用原位置和尺寸。固定、区域随机、飘窗和横向样式分别遵循既有默认区域规则。

新增的 19 款固定列表样式统一使用宽 480、高 700 的竖向默认区域。`overlays/danmaku-canvas.js` 的 `FIXED_DESIGN_WIDTHS` 保留这些样式原有的绘制宽度，区域相对绘制宽度缩放文字与卡片，避免新默认宽度放大已保存图层里的文字。旧六款、区域随机、飘窗与横向样式的默认区域不变；恢复区域默认会使用新尺寸，已保存区域不自动调整。

固定样式按当前区域宽度相对该样式绘制基准宽度的比例，统一缩放文字、头像、卡片、装饰和间距；区域高度通常决定可见条数，移动区域不改变外观；特别矮的区域限制整体倍率，确保内边距后仍有内容空间。礼物与SC卡片在设计空间内先适配扣除两侧各12px后的可用宽度，再随区域一起缩放，避免窄区域裁掉数量或图片。随机样式以contentScale为倍率上限，窄区域同时缩小内容，保证头像和装饰仍有排版空间。固定与随机样式都会将超出可用宽高的单条消息整体缩小，尺寸恢复后重新按自然大小排版；长昵称、礼物名、数量和金额允许换行，不以省略号代替内容。区域越小，文字也越小；消息过多时仍按原规则整条移除最旧消息。同比改分辨率会同比改变区域和contentScale；换宽高比保留contentScale，未调整的默认区域继续靠左下，自定义区域收敛到新边界，原铺满区域继续铺满。styleOptions保存逻辑字号，独立编辑器的画布字号使用当前实际内容倍率换算。`overlays/danmaku-canvas.js` 与服务器使用同一CSS变量/坐标规则，正式页等比居中、透明且不含选框。网页来源尺寸与画布一致即可精确还原位置。旧配置layout:null继续使用原来源窗口布局，旧PUT省略layout不清除已保存画布，首次显式应用编辑器才启用新画布。

### 月渡花汀

新增固定样式 `moonlit`：灰色普通弹幕、霁蓝舰长、藕紫提督、胭脂红总督，矩形中放头像、昵称及文字/表情，头像旁使用现有 B 站三档大航海徽章。新消息先显示头像、昵称、正文及对应身份深色的小矩形底框（比昵称底色更深、更接近黑色）；停留约 333ms 后，以 900ms 从左向右覆盖墨迹和花饰，前缘为约占元素宽度 20% 的柔边遮罩而非硬裁切，底框始终保留，不淡出或删除。固定列表以相对位置动画移动，时长为 420ms 加本轮最大位移像素（普通单行约 520ms，卷轴与上任更长，上限 760ms），同一轮各行共用时长与曲线，从静止起步时先短暂加速而非瞬间达到峰值速度；避免整卡 transform 图层切换改变文字栅格化效果；连续追加从当前可见位置与当前速度衔接，新消息跟随队尾保持间距，支持向上与向下滚动及缩放。移动完成时按已测尺寸清理旧消息；连续追加也在既有位置测量批次中淘汰当前与目标都完全越过退出边界的旧行，保留部分可见内容和装饰留白，消息数量上限仍立即生效。由 `danmaku-moonlit.js` 只负责装饰组合，主题 CSS 和透明山水/花鸟素材独立维护，消息仍复用安全渲染器与现有 feed。

购买大航海采用中央头像、左侧斜向错落的两字称谓、右侧斜向错落的“上任”及下方姓名带。三档沿用对应身份色；山水、月轮、背景与头像先用 1450ms 从上到下显现，1500ms 时开始以 1550ms 从左到右显现题字、姓名与恰好三只鸟。正式 `gift` 新增可选 `avatarUrl` 和购买等级 `giftGuardLevel`，经 Electron 云端事件白名单验证后传入组件；发送者当前身份不能触发上任。普通礼物与 SC 共用固定大小的银蓝花枝、滚轴、双边线与月白纸面组成的紧凑卷轴，含头像、昵称和已结算总额；普通礼物显示礼物名与数量，SC 在相同位置显示完整原文，不设正文固定高度。卷轴采用约 150px 高的紧凑单行布局，头像在左、昵称与金额同排、正文及数量在下；长文自然增高。卷轴先以 1400ms 从右向左展开纸面、山水底纹、头像和文字，滚轴中心始终贴合纸面裁切边界，展开后停在左侧；展开完成后，再以 1200ms 从左向右显现双边线、笔刷边缘和花枝，第一阶段不显示外围装饰。除纸面展开保持与滚轴对齐的硬裁切外，墨迹、花饰、外围装饰、上任场景与题字的显现都使用移动的柔边遮罩。纸面内部的山水底纹向左延伸，透明度从左端 0 平滑过渡到右端 55%，与纸面共用从右向左的展开裁切；头像和文字在纸面内垂直居中。外围装饰完成后，绢面微光以 52% 峰值强度从左向右扫过一次，持续 1800ms 后消失；减少动态效果时不播放微光。银蓝月白色明确替代本主题的 SC 价格色。其他样式保持原规则。旧字段缺失时使用普通礼物卷轴/头像回退，旧九区域布局只补默认 moonlit 区域。

合成预览打开或刷新时先显示普通礼物，再显示舰长感谢，其余样例随机无放回播放，包含三档上任，复用原播放和清理机制；减少动态效果时直接显示完整内容。本机预览与本机场景使用同一素材、结构和动画，随客户端交付；旧服务器公开页独立兼容。云端事件 `avatarUrl`、`giftGuardLevel` 等字段的白名单与拒绝由 `test/scenes/scene-cloud-controller.test.js` 覆盖，渲染文本安全由 `test/danmaku/danmaku-message-renderer.test.js` 覆盖；预览开场顺序、上任场景与动效以实际播放验收。

### 本地页面 /danmaku 与示例

`mist`（青雾）为全屏／区域随机样式：普通用户使用透明直角白框，当前直播间大航海用户（`roomGuardLevel` 为 1/2/3）使用浅青渐白卡片，外置昵称与爪印、内置圆头像；普通弹幕、礼物、上舰和 SC 的现有头像统一为 `1.4375em`（30px 正文下为 43.125px），普通消息、礼物及 SC 的头像列随之加宽，保持原间距；不把旧 `guardLevel` 或其他房间粉丝牌推断为本房身份。礼物显示赠送内容、数量、人民币结算总额和白色昵称胶囊；金额不重复乘数量，缺失时显示 `—`。购买大航海按 `giftGuardLevel` 显示带对应舰长／提督／总督图标的感谢卡，开通／续费和陪伴天数仅使用已有事实，未知动作显示“感谢支持”、未知天数不编造。SC 使用青绿标题与浅青正文，显示头像、昵称、实际金额和完整原文／换行；使用主题色而非价格档位色。四类消息共用随机避让、2～30 秒停留时间与过期清理；SC 支持本场撤回。旧布局缺少 `mist` 时补齐全画布区域，已有区域不变。支持字体、18～40 字号、正文颜色、背景透明度、中心倾向与离散程度；不提供滚动方向或礼物原图参数。

`whiteframe`（白描）复用区域随机布局：透明底、细白色圆角框，昵称居中在框上方；框内显示弹幕或礼物名 × 数量，礼物已结算总额居中放在框下（如 `138¥`，缺失金额为 `—`）。不显示头像、徽章与送出前缀，所有身份默认白色。支持字体、字号、文字颜色、停留时长、随机位置及下述入场动画参数，不提供背景或礼物图片选项。旧布局缺少该样式时补齐全画布区域，不改变已有区域。桌面预览和服务器展示使用同一结构与样式；在线来源需要部署对应服务端版本。

`overlays/danmaku.js` 与 `danmaku-preview.js` 复用内置样式和feed。预览随机混播内置弹幕（总督、提督、舰长、粉丝、普通观众和主播表情）、送礼通知及当前样式支持的 SC；首条立即出现，后续每隔 1231～3385 毫秒随机追加一条。每轮不重复抽取，全部样例播放完再开始新一轮，每条生成新消息ID和时间戳。复用正式feed的滚动、区域裁剪、随机排布和停留时间过期。字体、颜色、背景透明度与外观效果原位更新，保留现有消息和下一条播放计时器；随机位置、飘窗分散与入场动画参数仅影响后续新消息，飘动速度由现有feed更新。切换样式、礼物图片或金额门槛、滚动方向、随机停留时长、机器人欢迎显示开关，以及手动“重新播放”或重置区域时重新演示。弹幕参数与共享外观效果控件在 `input` 阶段只更新读数，在 `change` 阶段提交草稿，避免拖动和输入中间值反复传播。页面隐藏时暂停，恢复时继续播放而不补发积压消息；关闭页面清理播放计时器、可见性监听、待渲染帧和feed。不连接WebSocket。素材本地，不发外部图片请求。单独打开时兼容初始style/styleOptions/时长query并通过可用的history保存草稿；嵌入时由受信父页保留草稿。经典样式、灵动弹幕在画布模式共用区域内容倍率，避免再次缩放；旧非画布模式保留原600px基准缩放。

小表情 `kind:inline` 无论夹在文字里、重复发送或单独发送，图片默认高度为正文的 `1em`；对白使用 `1.15em` 补偿素材透明边，使可见图形与正文相当，不改变独立贴纸尺寸；整张表情包 `kind:sticker` 使用原尺寸的 1.4 倍，即普通样式 `4.48em`、经典样式与灵动弹幕 `5.74em`，宽度按原比例并受现有画布限制。缺少 kind 的旧载荷仍沿用整条匹配时放大的兼容分类。预览文字示例显式标记 inline，纯图片示例标记 sticker。

保留的非预览本地入口以 `topic=danmaku` 连接 WebSocket，按 snapshot 的 `settings.danmakuOverlayStyle` / `danmakuFullscreenDurationSeconds` 切换样式和停留时间，从 `danmakuFeed` 恢复消息并消费 `danmaku:message` 与 `danmaku:superchat-delete`。按消息 `id` 去重，同一帧批量追加；浮动 feed 在整批节点加入后统一测量，单条追加仍同步布局，保留空间等待与退出时序。SC 撤回按 `messageId` 同时移除已渲染及待追加卡片，不重建相邻消息。连接中断时指数退避重连，连接状态仍以 `liveStatus` 为准。该 WS 入口只保留兼容；新场景和 `/danmaku?source=component` 使用本地外观与统一接收的服务器事件，本地预览不写正式配置。

本地页面对去重、截取最近 50 条后的消息内容做完整比较。内容未变且 feed 无需初始化时，快照保留现有消息节点、到期计时器及尚未绘制的增量帧；仍更新直播连接状态。legacy WS 中已有内容完整匹配前缀的纯尾部追加复用正常追加，后续同 ID 单项继续去重；相同规范化外观不重复写入样式。首次空快照、前缀不符的消息修正/清空/补数、样式或全屏期限变更导致的 feed 重建仍执行权威恢复。此优化不改变场景/component 的配置确认或远端正式 overlay 的 SSE。真实页面模块和共享 feed 的节点/计时器回归见 `test/danmaku/danmaku-snapshot-stability.test.js`。

弹幕组件依次展示监控及预览、最近使用、参数、弹幕过滤和保存操作；输出地址沿用公共场景入口。主页「最近使用」最多显示 4 款内置样式，当前草稿、已保存款优先，再按最近使用去重补齐；固定位置、区域随机、飘窗弹幕和横向滚动四种显示方式混排；客户端和画布的内置样式卡片均用紧凑单行展示左侧中文名称与右侧英文标识，客户端卡片的悬停提示保留显示方式。「全部样式」打开样式库，内置样式按显示方式、样式动效、节日限定和外观特征取交集筛选；顶部排列筛选条件与「清除筛选」，底部紧凑栏固定显示结果数量与「添加样式」导入入口。样式动效按默认外观中的分层入场、独立图层变化或装饰动画标注，整卡淡入／平移、列表滚动或飘窗平移本身不计入；标签不随个人参数变化。选择内置卡片只更新原草稿并关闭弹窗；导入样式在库内独立展示，沿用原参数流程，不参与这些标签筛选和最近使用记录。

外观特征按默认外观的可见元素标注：「文字」以文字、头像或细线框为主，没有明显的独立卡片底色；「卡片」使用对话气泡、色块卡片或界面窗格；「纸笺」具有便笺、手账、信纸、票据或纸页拼贴外观；「插画」具有花草、动物或节庆物件等独立装饰，不按观众头像或礼物图片归类；「光效」具有辉光、星光、流光或明显的渐变、虹彩材质。同一款可同时命中多个标签，例如流霞属于卡片与光效，花与信笺属于纸笺与插画。客户端与画布共用这些标签和筛选逻辑。

`public/js/admin/danmaku-style-library.js` 拥有选择器与最近使用记录，`danmaku-style-catalog.js` 只维护筛选标签，`visual` 数组保存同一样式的多个外观特征。历史使用 `localStorage` 键 `lira.danmaku-recent-styles.v1.<encodeURIComponent(account)>`，按已有授权账号 UI 标识隔离并保留至重启后；只有同一控制器代际内保存成功才记录返回的 `saved.style`，浏览、选择、预览与保存失败不记入。原始 `data-danmaku-style` 卡片仅在库中保留一份供画布读取，主页副本使用 `data-recent-danmaku-style` 并转发原选择入口。

`danmaku-style-options.js` 定义各样式字体、正文字号范围、背景不透明度、礼物插画及入场动画选项；无底色样式不显示底色参数，蝶恋花与流光溢彩没有独立礼物图位。`styleOptions` 由本机账号配置按样式保存，不受远端支持哪些样式限制。切换样式保留各自草稿，恢复默认只重置当前样式，仍需显式应用。固定样式另有“滚动方向”：up 为从下向上（多数款默认），down 为从上向下（Glass 玻璃通知默认）；方向随当前样式草稿保存、传给本地预览并在保存后通过本地场景通知更新。随机样式隐藏且不接受该参数；反向排列仍淘汰最旧消息。区域随机的停留时间位于参数区，按当前样式保存。

固定弹幕常规参数另有“边缘处理”，保存为当前样式的 `styleOptions.<style>.edgeFade`：`both` 上下两端渐隐、`top` 仅上边渐隐、`bottom` 仅下边渐隐、`none` 直接切断。明确选择的上/下边不随滚动方向改变；旧值 `single` 仍兼容，按滚动方向解析为移出端的 `top` 或 `bottom`，界面显示具体边缘。各款缺省由能力表定义，例如流霞为 `both`、仿推特 3.0 和 Glass 玻璃通知为 `none`；其余款沿用自身默认；渐隐范围沿用 32px，星语保留 24px，随内容一起缩放。公共 `motion.css` 负责遮罩，样式只指定自身范围；不改消息淘汰、动画或计时。管理页、画布参数与独立预览共用草稿，恢复默认只重置当前样式；随机和飘窗隐藏且拒绝此字段。旧记录缺失时采用上述默认，客户端保存完整外观；旧服务器源的 PUT 兼容行为保持独立。

区域随机的公共入场、退场与飘窗边缘参数见[动效归属](#随机与飘窗的动效参数归属)。`fade` 保留各款原有渐显；`rise` 让卡片与昵称从下方上浮，正文从左侧滑入后轻微回正，不缩放文字。正文包装由本机 adapter 复用或补齐，固定来源的 renderer core 保留兼容；漫画的原生编排由本款独立维护。

`styleOptions.<style>.fontSize` 只调节正文与行内表情，不作为整张卡片的缩放基准。普通正文和 SC 留言沿用各款字号比例，礼物／上舰文案保留各自排版层级；RIPPLOID 礼物票据固定字样不随正文变化。默认值为 30px，幽灵便笺 20px（16–36）、手账风 23px（18–48）、RIPPLOID 24px（18–48）、花与信笺与暗月 24px（18–40）、仿推特 3.0 22px（18–40）、漫画对白 26px（18–42）、散落小窗 26px（18–40）、星尘 2.0 28px（18–48）、郁香海风两版 32px（18–48）；其余范围由能力表定义。头像、头像框、昵称、徽章和装饰采用各款默认设计尺寸：幽灵便笺的 em 设计基准固定 20px，手账风固定 23px，绿萌简笔画／对白／流霞／雪狐物语／青雾／白描固定 30px；星语昵称固定 22.5px，点点流萤昵称固定 23.4px。气泡随正文换行和行高自然增高，装饰跟随对应边缘定位。琉璃、青墨笺和经典样式的昵称保留 30px，其他原已独立的样式保留自身设置。画布／组件整体缩放仍同时缩放文字与装饰；超高单条继续自动适配，其中流霞和雪狐的全宽事件卡同时临时缩小卡片基准与正文变量以重新换行，恢复空间后清除临时值。已有字号参数不迁移、不新增头像或昵称字号设置，切换及恢复默认仍只作用于当前样式；桌面预览与本机场景输出复用同一套 CSS，旧服务器源保留自己的兼容合同。

`overlays/danmaku-style-application.js` 的 `applyStyleOptions` 将解析后的外观应用到 DOM、CSS 变量和 Twitter 文本节点，单向消费共享参数合同。`shared/danmaku-style-options.js` 保持无 DOM 副作用；其 `DANMAKU_OPTION_FIELDS` 集中维护参数名称、类型、范围、默认值、选项、分组及所需能力；`DANMAKU_STYLE_OPTIONS` 声明各款能力与默认值，`styleOptionFields(style)` 一次解析并缓存适用字段。常用与高级只是界面分组，不影响逐样式保存。通用外观效果仍由 `shared/component-style-parameters.js` 的 `STYLE_PARAMETER_GROUPS` 与能力表负责，保留既有 `styleOptions[style]` / `styleParameters[style]` 两类配置。

以下本机专属参数沿用同一草稿、保存和恢复默认流程，不要求旧服务器在线源同步支持：

| 字段 | 适用样式 | 默认与用途 |
| --- | --- | --- |
| `styleOptions.whiteframe.bubbleColor` | 白描 | 复用配色控件，显示为「边框颜色」；`default`（缺省）保留原来的 85% 白框，自定义接受六位或八位十六进制颜色，色板初始值为 `#ffffffd9`。只改消息与礼物边框，不联动正文色 |
| `styleOptions.<style>.ambientMotion` | 星语、手账风、暗月、星尘 2.0 | `on` / `off`，默认 `on`；关闭图案、纸张、头像或轨道循环，保留各款入场和正常移动。系统减少动态效果仍优先 |

颜色与持续动画直接更新现有消息，不重建 feed；切换样式时按目标样式重设配色与动态。不支持对应能力的样式拒绝该字段，缺省记录无需迁移。

`shared/danmaku-parameter-controls.js` 根据这些定义构造并绑定控件；桌面和画布通过 `admin/danmaku-parameter-view.js` 接入，独立预览通过 `overlays/danmaku-preview-appearance.js` 接入，仅适配字体来源、画布字号换算和保存上下文。共享效果 UI 由 `shared/component-style-parameter-view.js` 负责，管理页原入口保留重导出；`shared/component-parameter-fields.js` 统一处理编辑中防回填与订阅释放。`shared/danmaku-appearance-draft.js` 只负责值转换及当前样式的不可变更新/重置。

新增样式复用现有字段时只声明能力、默认值和限制；新增参数先在所属字段定义中登记，再由样式渲染模块实现视觉行为，使用现有编辑和保存通道，不再逐入口增加标记、监听或校验分支。弹幕字段定义的本机 Node 镜像由 `node scripts/sync-danmaku-style-options.cjs --write` 从浏览器合同生成；默认 `--check` 和合同测试检查完整镜像一致性，无需手动维护第二份字段。参数保存与渲染以本机外观和场景为准，新增样式或参数不要求同步旧服务端样式。修改配置时更新本机相关消费者与测试。

区域随机样式的停留时间为 `styleOptions[style].durationSeconds`，2–30 秒整数。星尘 2.0 缺省为 12 秒、玻璃气泡为 5 秒，两款不读取旧共用停留值；其余款缺失时读取旧 `fullscreenDurationSeconds`，无有效旧值时为 6 秒。新控件只修改当前样式；恢复默认回到本款默认值，必要时显式保存该值以覆盖旧共用值，不改变其他款。固定和飘窗样式不接受该项。独立预览的 history 同时保留基础参数、外观效果及旧时长；同款多个内置组件仍共享外观，不同款独立，组件位置/尺寸独立。

预览参数传递与草稿保留方式如上，样式切换不清除其他样式的区域或参数。原图模式使用内置的对应 B 站 WebP／PNG 礼物图片（大航海示例复用已有 WebP 图标），不请求直播或外部图片。服务器从已有礼物目录按已结算 `giftVariantId` 精确取得 B 站图片地址，经可选 `giftImageUrl` 随原 `gift` 事件传递。Electron 仍只使用既有共享订阅；`scene-runtime.js` 在独立弹幕和组合场景输出中，通过目录的 `imageResources.resolveSource(source)` 将已接受礼物事件的准确 URL 映射成 `/overtime-gift-images/<basename>`，不按名称或 ID 猜图，不等待图片下载。只有实际显示图片的浏览器 GET 才触发缺图准备，复用目录磁盘缓存与下载队列；旧远端来源保留 HTTPS B 站 URL 的兼容加载，不增加逐条礼物 API 查询。资源模块、失败冷却和离线行为见[礼物缓存](../backend/overtime.md#15-服务器全局礼物目录联动)，图片交付见[本地 API](../backend/api.md#共享礼物图片)。

前端图片入口为 `shared/gift-image.js`：`resolveGiftImageSource(value, guardLevel)` 校验来源或按购买等级取本地舰徽；`bindGiftImage(image, source)` 供通用弹幕 renderer、礼物横幅和通知保留各自的 load/error 装饰；`setGiftArtwork(image, source, { format, mimeType, guardLevel })` 供 Glass、沉笺、礼物动效，以及全部许愿样式、礼物选择器、加时规则和文本框礼物图位选择原图或静态帧；`setGiftArtworkFallbacks(root)` 为最近礼物和盲盒列表现有图片绑定同一显示入口。显示接口接收调用方已校验的来源，不负责查询目录或发起礼物 API 请求。`gift-image-fallback.js` / `gift-static-image.js` 仅作为共享入口内部实现，业务消费者不直接调用。横幅目录图位和通知均接受缓存支持的 WebP、PNG、JPEG、GIF，不再只认 WebP；横幅仍只接受本地目录缓存路径。静态转换合并同一文档内相同来源与格式的任务，完成结果最多保留 64 项、16 MiB 字符串估算容量；失败保留 30 秒冷却，后续使用可重试。绘制首帧后释放原动图来源；延迟完成的任务不能覆盖节点较新的图片。大航海不经 Canvas，按 `giftGuardLevel` 使用本地舰徽，保留房间千舰状态切换；只显示等级标记的样式继续复用专职 `bilibili-guard-icons.js`，不获取礼物原图。图片失败仍按各样式原有空图、主题或占位规则处理，名称、数量和金额始终先显示。

琉璃、杏花白、灵动弹幕、留白、一纸素笺、仿推特 3.0 和星轨飞语固定显示礼物原图，缺图或失败时图位留空，不回退礼章或星星；其旧 `giftImage` 配置仍接受，但显示统一解析为 `gift`，参数区不再提供插画切换。青墨笺、经典样式和月渡花汀可切换样式插画／真实图片，失败保留各自插画。Glass 玻璃通知和沉笺同样固定使用真实图片，普通礼物经共享静态首帧转换，大航海直接使用本地对应等级舰徽；其余款保持各自的文字、插画或专用大航海卡片，不额外获取礼物原图。缺少 `giftImageUrl` 时仍保留礼物通知。正式协议和旧服务器样式边界见服务端 `public-overlay-api.md` / OpenAPI `OverlayStyleOptions`。

页面与 `/games` 的画猜消息共同复用 `danmaku-feed.js` DOM 组件。组件不读取 WebSocket 或领域状态，只接收显式消息数组和图片 URL resolver：

客户端内置固定样式分别维护入场与列表移动参数，公共 feed 继续负责测量、同批移动、打断续接及清理。12 款使用仅作用于新增消息的整条入场，雪狐复用已有内部编排，月渡花汀保持既有动效；快照不重播新增的整条入场。逐款设计、CSS 接口、作者提示词和实际播放验收统一见[固定弹幕动效](danmaku-motion.md)。服务器 feed 独立维护，本轮客户端调整不表示远端正式源已同步。

- 三种随机样式在本地预览和正式直播的停留时间最后 400ms 原地渐进淡出，曲线为 `cubic-bezier(0.4, 0, 1, 1)`，不延长总停留时间。减少动态效果或不支持原生动画时按期直接清理；移除、重绘和销毁时取消淡出动画及计时器。
- `measureDanmakuText(message)` 按中英文混合文本的视觉长度估算行数、宽度百分比和最小高度。
- 留白风格在头像下沿居中显示 `LV{medalLevel}`，复用消息渲染器从本条消息的独立 `medalLevel` 写入头像数据属性；缺少灯牌名称不影响已知等级。缺失、零或非法等级不显示，不从舰队身份推算，也不复用上一条消息的等级。该风格不再在正文下重复显示粉丝牌；其他风格沿用原徽章。
- `kind:'gift'` 使用专用 `is-gift` 节点，以 `textContent` 展示送礼人、“送出”、礼物名称和数量。登录账号发送的感谢按普通弹幕渲染，不转换成礼物卡，不额外生成感谢文案，也不提供单独的感谢示例。除保持原样的蝶恋花外，礼物采用与普通聊天不同的排版和造型：琉璃为奶油色礼物原图卡（昵称首字圆章、莓红数量胶囊），青墨笺为带 1px 青色切角描边的墨蓝通知牌，经典样式为与 SC 同款的彩色头像昵称标题栏和浅色礼物内容卡，礼物与 SC 都不另加外层留白，与普通弹幕共用 10px 列表间距；留白的礼物使用带细金边的深蓝卡与真实礼物图，灵动弹幕为左侧 60px 方形真实礼物图、无头像的单栏双线框纪念卡，一纸素笺为带虚线分隔的玫瑰色礼物小票，杏花白为奶油色礼物原图卡，流光溢彩为同色高光弧的紧凑通知卡。除蝶恋花外，礼物卡入场时额外播放一次 ≤360ms 的光泽扫过（`::after` 只改变背景位置和透明度，不改变入场方向、时长或布局，减少动态效果时不播放）。选择“礼物原图”且图片加载成功时，插画节点加 `has-image`，清除样式插画的 mask 和背景，原图不会被裁成线框；加载失败恢复样式插画，琉璃、杏花白、灵动弹幕、留白和一纸素笺的图位则留空。除蝶恋花外，送礼通知使用紧凑的两行结构：昵称在上，“送出＋礼物名”和数量在下一行，不显示“谢谢支持”。`gifts.css` 仅复用内容结构，各风格文件拥有配色、轮廓和装饰；插画仅用于适合的样式。样式插画内置于 `public/img/overlays/danmaku-gifts/`，各风格不复用同一插画；预览的真实礼物 WebP 位于 `public/img/overlays/danmaku-previews/gifts/`。该展示能力不新增公开 SSE 事件或礼物业务处理链路。
- 本地预览使用场景编辑器，按可用视口等比缩放。消息在当前样式的区域内动态展示；固定样式按区域高度移除最旧的超限消息，随机样式沿用正式直播的随机布局和寿命。样式切换重新播放，地址不变。
- 留白和杏花白礼物卡通过 `showGiftTotal` 选项把数量放在礼物名旁边，原数量位置显示 `giftTotalPrice`（人民币元）的 `¥` 金额，最多两位小数。金额直接来自已结算总额；旧消息缺失金额时显示 `—`。杏花白沿用右侧粉色金额框，名称旁的数量不带底框。其他样式继续显示原数量布局。本地预览使用合成总额，正式 overlay 消费服务器同名展示字段。

- 旧非画布布局的固定礼物卡中，`bubble` / `signal` / `ranked` / `transparent` / `identity` 沿用原客户端 1.5 倍尺寸上限（460px 设计宽度 → 690px 显示宽度）。扣除两侧各 12px 后的空间不足时，卡片、昵称、礼物文字、数量或金额、头像、装饰和间距一起等比缩小；高度通常影响可见条数，单条过高时再整体缩小。经典样式和灵动弹幕抵消列表已有倍率，避免重复缩放。列表裁剪计入节点自身的 CSS zoom；蝶恋花、普通弹幕及全屏随机礼物同样在单条超出可用区域时整体缩小。画布布局使用上面的区域整体缩放规则，本地预览与正式 overlay 同步。

- `createDanmakuFeed(root, options).render(items)` 使用 `DocumentFragment`、`textContent` 和受控 `<img>` 创建消息，`append(item)` 只追加新节点，不重建已有 DOM。游戏层继续按估算高度保留当前可见区及上方约 5 个视口并自动滚到底部；固定 `/danmaku` 配置 `offscreenViewports: 0`，按实际布局高度、行间距和容器内边距移除最旧的超限节点，保留完整可见消息。固定区域和全屏模式的 `ResizeObserver` 同时观察容器与消息，图片加载、昵称换行或窗口缩放后在动画帧内合并测量与调整，使用不受入场动画缩放影响的布局尺寸。节点移除或替换时取消观察，销毁时取消布局帧和到期计时器。表情按精确触发文本切分，加载失败回退原触发文本，不使用 `innerHTML`。页面数据和断线恢复快照仍分别硬限制为最近 50 条，共享组件默认上限仍为 120 条。
- 流光溢彩（`glow`）将发送者昵称居中放在消息框上方，文字或表情在深色半透明圆角框内，边框带双层柔光，并在 2px 边框上叠一段静态白色高光弧（按 `data-tone` 取四个角度，不循环播放；不支持 mask 合成的内核省略高光弧），不显示头像/徽章。`ranked-palette.css` 为它和经典样式提供同一份身份色，普通观众/粉丝青蓝、舰长蓝、提督紫、总督红、主播绿色覆盖优先。本地预览与正式直播共用随机布局与时长，礼物采用同色紧凑双行通知卡。

- `starveil`（点点流萤）复用流光溢彩的区域随机布局、防重叠和停留时长；昵称居中置于深色半透明胶囊上方，文字、细描边与柔光从香槟金、雾玫瑰、冰蓝、淡紫、青瓷、暖桃六组颜色中按消息种子稳定随机选择，不随身份或重新排版变色。正文/表情与真实礼物名称、数量完整显示，不显示头像、徽章和 SC。支持字体、字号、正文颜色、背景透明度、中心倾向和离散程度；旧布局缺少 starveil 时补齐当前画布区域。本地预览与服务端正式画面采用同一造型。
- 经典样式（`ranked`）通过独立 `data-streamer` 标记将主播名字标签和正文气泡设为绿色，并隐藏主播船锚；普通观众保持青蓝色。可选 `isStreamer` 只由当前房间主播 UID 与本条发送 UID 比较产生，缺失按 false；本地 B 站消息入口、feed 投影和服务器 SSE 均保留该展示语义，不公开新增 UID，也不改变其他风格的 `data-identity`。本地纯表情示例同时展示主播身份。
- 共享组件按当前房间身份为每条消息输出 `data-identity=viewer|fan|captain|admiral|governor`；大航海身份优先，拥有大航海且佩戴当前房间灯牌时仍同时输出两枚徽标。五套固定弹幕姬只共享该语义，不共享身份视觉：`signal` 使用分级信号色、左侧强调色晕染、舰长/提督/总督实色标签和“名称｜等级”分段粉丝牌，`bubble` 使用 20/20/20/6 圆角的午夜玻璃气泡、头像双圈、粉丝牌胶囊和柔和分级光晕，`minimal` 不绘制左侧色条，普通观众省略身份签，粉丝与大航海身份保留单字身份签和低遮挡分级色；`ranked` 隐藏徽标，以普通/粉丝共用的石墨灰及舰长蓝、提督紫、总督金四档整卡底色表达身份，用户名和正文在左、头像在右；`transparent` 不绘制卡片底色、边框或大航海徽标，保留头像右侧的昵称、正文和下方粉丝牌等级，并用蓝、紫、红色昵称区分舰长、提督、总督。`outline` 虽保留同一 DOM 身份字段以兼容共享组件，但 CSS 统一隐藏头像、徽标和灯牌；卡片使用浅白半透明底、18px 圆角和分层柔和阴影，昵称前的身份色圆点与昵称颜色一致：普通观众灰色，大航海使用蓝紫红识别色；正文为深色，左对齐排版并轻微淡入。昵称字号由各样式拥有，琉璃、青墨笺和经典普通弹幕为 30px，其他样式保留原层级；徽章与等级不小于 12px；数量、金额和等级使用 `--danmaku-num-font` 等宽数字。旧版直播软件内核不支持 `color-mix` 时，各样式以 RGB 通道变量或 `@supports not` 回退保留文字背后的底色。
- `ranked` 使用 624×640 固定设计画布、最大 600px 卡片宽度和 10px 卡片间距，卡片随正文增高；`calculateRankedOverlayScale(width, height)` 取 `min(1, width / 624, height / 640)` 并投影到 `--ranked-scale`，让窗口 resize 时头像、文字和卡片统一等比缩放。浏览器源比例与设计画布不一致时在未占满的一轴保留透明空白，不拉伸或单独重排内部元素。
- `/danmaku` 的观众头像由浏览器直接读取弹幕中携带的 HTTPS B 站 CDN 地址，保留域名白名单且拒绝带账号密码的 URL；头像和模糊底图共享同一地址，使用 `no-referrer` 并异步解码头像，不逐条查询用户资料或让服务器转发头像。图片缺失或失败沿用各样式的默认展示。表情继续使用 `/api/bilibili/avatar` 本地代理；未通过 B 站域名白名单的图片不会进入服务端公开流。
- 固定区域样式的网格行占满可用高度，使消息容器的裁剪预算来自浏览器源视口，而不是当前消息堆叠高度；少量消息仍靠底部排列。追加消息后，边界处的旧消息保留仍在范围内的部分，由容器裁掉越界部分；旧消息离开的一侧（向上滚动为顶部、向下滚动为底部）由 `motion.css` 统一加 32px 渐隐遮罩，不再被硬边切断，完全移出后才清理；向上、向下滚动及弹幕、礼物、SC 共用该规则，仍受消息数量上限约束。
- 各样式的图片表情受正文宽度约束，行内图片不使用负纵向边距，昵称与粉丝牌必要时分行。琉璃保留 12px 消息间距，不绘制底部尾角；直播气泡设计画布内的消息间距为 10px。灵动弹幕(`identity`)的普通观众与粉丝将本条头像放大模糊后铺底，保留头像的深浅和色彩分布，白字加细暗描边；右侧固定预留 144px 头像列，清晰头像固定为 92×92px，始终靠右上；修改正文字号或增加正文行数不会放大头像。头像左侧 30% 渐隐，图片不参与卡片行高计算，文字区宽度不随头像变化。缺失或失败时两层均使用默认插画，舰长/提督/总督继续使用蓝/紫/红身份底色，礼物保持独立样式，数量紧跟礼物名称，右侧显示 `giftTotalPrice` 已结算总额，不重复乘数量。背景复用成功加载且经过 URL resolver 的图片，不读取跨域像素；本地和服务器样式一致。卡片宽 600px、最小高度 92px、间距 6px，按可用宽度等比缩小，正文换行时向下增长。杏花白的普通头像及头像列均为 55.2px，保留与圆尾的 12px 净间距，礼物仍隐藏头像。流光溢彩的普通昵称为 26px、礼物昵称为 19.5px，正文和原有间距不变。一纸素笺和杏花白的昵称放在卡片边框内，正文间隔 6px；消息距离视口边缘至少 16px，消息之间至少 10px，已放得下的消息保留位置，空间不足时先移除最旧消息。
- 青墨笺的粉丝牌等级跟随昵称信息行排版，不再绝对定位到卡片底边；粉丝牌名称在旧布局允许收缩并显示省略号，画布布局则换行完整显示，等级不会挤到正文或边框上。
- 蝶恋花样式的昵称向下偏移 6px，居中占正文区域宽度的 70%，长昵称保持 16px 字号自动换行，连续英文也可在字符间折行。行内表情不使用负纵向边距，图片占用完整行高，避免最后一条消息的表情底部超出消息容器并被裁切。

### 玻璃气泡区域随机弹幕

`glass-bubble`（玻璃气泡）以 [pabo 的公开演示](https://www.youtube.com/watch?v=f_qGJE_PTpU)为基础，按后续美化要求收敛配色并改善亮背景下的可读性，位于客户端「组件 → 弹幕姬 → 全部样式 → 区域随机」。`danmaku-glass-bubble.js` 组合安全文本、表情、昵称与真实金额；`danmaku/glass-bubble.css` 拥有烟灰玻璃填色、方向性银色高光、深色昵称牌、柔化的居中尾尖、分层展开和 SC 扫光。不显示头像、徽章或礼物图片，生产素材不含原片背景、人物或可选 GIF；原站另售的管理程序不在本款范围内。

默认区域铺满画布，正文 27px（18–48px），昵称 21px；默认 [M PLUS Rounded 1c ExtraBold](../../../public/fonts/glass-bubble/README.md)，中文字形按本机回退链补齐。字体通过现有共享资源交付，并保留 `Lira Rounded Mplus` 族名与 `/fonts/` 路径。昵称和长文可换行；随机位置、避让、区域缩放、消息上限及移除继续由公共 feed 管理。普通消息默认停留 5 秒，礼物／上舰／SC 在当前停留值上增加 3 秒，默认 8 秒；能力表的 `eventDurationExtraMs` 由同一到期 owner 消费，不另建计时器。

底板在 380ms 内从中心横向展开，昵称在 140ms 后用 220ms 渐显，正文在 300ms 后按完整字素逐字渐显，每字 180ms、默认步进上限 26ms；实际步进取所选显字间隔与可读性预算中的较小值，普通消息的步进总长最多 420ms，礼物／上舰／SC 最多 1400ms。普通长文可在最短 2 秒停留、最长 1 秒退场开始前显示全文；付费事件沿用额外 3 秒停留。只有材质缩放，文字不缩放或逐字模糊。SC 在 300ms 后播放一次 950ms 的柔和扫光。快照直接显示终态，普通外观调整不重播旧消息，减少动态效果直接显示全文；退场沿用公共随机参数。彩边与金额使用柔和色系：礼物黄绿、大航海绿色，SC 按实际人民币数值分七档：低于 200 蓝、200 青、500 绿、1000 黄、2000 橙、5000 洋红、10000 红；保留参考的数值档位，不做汇率换算。正文与上舰文案统一跟随所选文字颜色。金额缺失显示 `—`，零显示 `¥0`；数量不重复乘结算总额，开通／续费语义保留，SC 撤回只移除对应留言。

「高级参数 → 玻璃与显字」的字段由共享参数合同定义。显字方式和间隔在创建消息时锁定，只影响后续消息；整句显示保留玻璃展开，已有消息不重播显字。扫光开关和高光直接更新现有节点，默认保留原作。

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `glassBubbleReveal` | `typing`（默认）／`instant` | 逐字显现／整句显示 |
| `glassBubbleTypingSpeed` | 10–60ms，默认 26 | 每字显现间隔，越小越快；整句显示时控件停用、保存值保留 |
| `glassBubbleSweep` | `on`（默认）／`off` | SC 的一次扫光 |
| `glassBubbleHighlight` | 0–100%，默认 100 | 银边与表面高光强度，文字及金额不变淡 |

支持字体、字号、正文色、背景不透明度和公共随机／退场参数；透明度只改变玻璃填色。公共外观能力为 `panel`，底板效果映射到 `.glass-bubble-surface`，文字描边覆盖昵称、正文及金额。当前桌面内核使用 CSS `shape()` 连续绘制轮廓与尾尖；不支持该语法的浏览器源回退圆角框。本机预览、画布及本机场景共用实现，旧布局只补齐缺失区域；不要求服务器镜像新样式。

### 星尘 2.0 区域随机弹幕

`stardust`（星尘 2.0）以[兔宝的神奇口袋的公开演示](https://www.bilibili.com/video/BV1rJhC6TEiA/)为视觉参考，由 `danmaku-stardust.js` 组合安全消息 DOM、`danmaku/stardust.css` 绘制星芒、轨道和细线；不携带原视频位图素材，也不新增启动下载。客户端「组件 → 弹幕姬 → 全部样式 → 区域随机」与画布共用本款目录和本地渲染器，不要求远程样式或参数镜像。

布局为 `fullscreen-random`，默认铺满 1920×1080 画布；旧布局仅补齐缺失的本款区域。透明画面中正文居中、昵称在下、星芒在上，不显示头像或卡片底板。正文默认 28px、范围 18–48px，默认衬线字体为 SimSun／宋体；礼物、上舰与 SC 正文比所选字号大 2px，昵称固定 16px 无衬线。正文色默认 `#f2f5f7`，可继续调整字体、正文色与共享随机分布参数。

公共效果能力表将本款登记为 `text`，外投影、外发光和文字描边覆盖正文、昵称及 `.stardust-event` 标签，装饰图形不接收文字描边；调色与变换仍由共享效果模块处理。`styleParameters.stardust` 沿用同一套本机保存、场景发布和恢复流程，包含机器人欢迎弹幕显示开关。

普通礼物显示「星光礼物」、真实礼物名与数量，金额直接取已结算人民币总额 `giftTotalPrice`，不再次乘数量；未知金额不补造。SC 显示「醒目留言」、实际 `price` 与完整原文／换行，不解析留言为 HTML。有效 `giftGuardLevel` 生成「星海相伴」和对应舰长／提督／总督感谢，明确 `guardAction: 'renew'` 时使用续费守护语义。SC 与上舰增加倾斜轨道和两侧细光线，上舰另有下方星芒；SC 删除沿用共享事件路径。

「高级参数 → 星尘 · 画面与互动」保存于 `styleOptions.stardust`，本机 Node 与浏览器共用校验：

| 字段 | 用途 | 默认值／约束 |
| --- | --- | --- |
| `stardustEntrance` | 汇聚与点亮 | `on`；可选 `on` / `off`，关闭后直接显示 |
| `stardustKeepCenter` | 为主播留白 | `on`；可选 `on` / `off`，普通消息避开中央，窄区域按可用空间排布 |
| `stardustNicknames` | 观众昵称 | `show`；可选 `show` / `hide` |
| `stardustGiftThreshold` | 大额礼物门槛 | 0.01 元；范围 0.01–1,000,000 元，步长 0.01；已知单条结算总额达到门槛时居顶，未知金额仍散落 |
| `stardustSwapAnchors` | 礼物与上舰上下对调 | `off`；可选 `off` / `on`，默认合格礼物居顶、上舰居底，开启后对调 |

入场时正文从上、昵称从下汇聚，以清晰文字渐显和位移呈现，不给正文或昵称叠加模糊滤镜；约 650ms 后点亮星芒与事件标签，完整入场约 1.4 秒。`stardustEntrance` 独立控制入场，`ambientMotion` 只控制星芒闪烁和轨道循环；系统减少动态效果时直接完整显示并停止循环。新消息锁定入场、锚点与到期参数，昵称和持续动画可原位更新；共享 feed 继续负责避让、拥挤淘汰、停留和正常退场，不增加消息订阅或计时器。保存、重启和恢复当前款默认均沿用本机账号外观流程，OBS 与哔哩哔哩直播姬使用已应用的本机场景浏览器源。

点亮动画结束后回到各元素的原始不透明度，事件标签保持 0.93、上舰尾星保持 0.7，与关闭入场直接显示时一致。

### 雪狐物语固定弹幕

`snowfox`（雪狐物语）使用狐耳圆头像、姓名色条与浅色圆角气泡；SC、礼物、上舰分别采用雪屋留言牌、礼盒横条和「NEW MEMBER」卡。默认普通观众蓝色、当前房间粉丝浅粉色、舰长绿色、提督紫色、总督粉色；只读取明确的 `roomGuardLevel` / `roomMedal`，上舰由 `giftGuardLevel` 分类。SC 头部随昵称换行增高，金额在空间不足时另起一行，正文始终位于整个头部下方，保留完整原文和实际金额；礼物使用已结算总额，缺失时省略。图形与主题由 `danmaku-snowfox.js`、`danmaku/snowfox.css` 和 `img/overlays/danmaku-snowfox/` 负责，公共 renderer 仍按 ADR-0020 从服务器同步。

默认区域 480×700，旧布局只补齐缺失区域；支持字体、18–48 px 字号、正文色、滚动方向与边缘处理。新增 `styleOptions.snowfox.bubbleColor`，接受 `default` 或六／八位 HEX，自定义时联动普通弹幕文字、姓名条、边框、浅底及头像圈，不覆盖 SC、礼物和上舰颜色。显式正文色仍可单独覆盖正文。管理面板、画布和独立预览都提供默认／自定义切换，恢复默认仅重置当前样式；旧配置缺省使用身份色。详情见[雪狐物语规格](../../../specs/danmaku-snowfox.md)，按样式恢复默认互不影响由 `test/danmaku/danmaku-panel-edit-state.test.js` 覆盖，取值校验由 `test/danmaku/danmaku-style-options.test.js` 覆盖；本地场景使用客户端所带的样式实现。

入场动画由雪狐 CSS 拥有：普通消息展开气泡，SC 展开冰牌并轻摆挂饰，礼物弹出礼盒，上舰落下船锚。有限动画只改变内部图层的裁剪、透明度和变换；礼物底板仅淡入，根节点的位置与测量仍由 feed 负责，追加时保留旧节点且不重播入场。减少动态效果时直接呈现完整卡片。SC 与礼物头像花边不裁切，并与雪屋底部一起定位；礼物昵称和金额使用独立网格列，长文本换行，缺失金额不留占位。

### Astral 星笺固定弹幕

`astral` 按 [GhostTypeStudios 的 Astral 公开演示](https://www.etsy.com/listing/1692766782/astral-chat-widget-customizable-colors)重建紫色细框、右侧内凹角、嵌边昵称、金色星芒及悬垂细线。`danmaku-astral.js` 复用公共 renderer 的安全文字和表情，只拥有四类消息的构图；`danmaku/astral.css` 拥有几何框、分层入场和星芒循环。参考图片和视频不进入运行素材；字体复用已交付 Nunito，中文使用现有回退，不新增下载、连接或计时器。

所有聊天保留内侧细线、圆点和悬星，短句也为完整装饰留出高度；底边身份牌只按 `isStreamer` 或本房间 `roomGuardLevel` 显示，不推断旧 `guardLevel` 或外房身份。礼物、购买大航海和 SC 使用紧凑提醒框；标题昵称统一跟随本款字体和基准字号，不受通用礼物的固定小字覆盖。`astral-event-identity` 将昵称与动作合为可换行组，长昵称完整换行，金额独立排列、在常用宽度下与首行对齐，超窄区域允许整组换行。上舰的开通／续费取真实 `guardAction`，金额为已结算 `giftTotalPrice` 或 SC `price`，不重复乘数量；未知金额显示 `—`，零金额保留。SC 完整保留字面文字、空格和换行，沿已有消息 ID 撤下，不重建其他卡片。

默认区域 640×720，位置为 1920×1080 画布中的 (40,320)；旧布局仅补齐缺失区域。基准字号 20px、范围 12–48px，聊天正文为基准的 1.1 倍；正文色默认白色，边缘默认直接切断。支持字体、正文色、背景不透明度、上下滚动、持续动画；窄区域的内外留白随宽度收敛，正文自动换行。`astralAccentColor` 支持六位或八位 HEX，默认 `#f7e68b`；`astralEntrance` 为 `layered`（默认）或 `none`，位于「高级参数 → Astral · 星笺」。关闭持续动画只停止星芒闪烁，直接显示只关闭分层入场；系统减少动态效果时全部静止显示。

公共高级效果能力为 `art`，沿整体透明轮廓施加投影、辉光和调色，文字效果覆盖昵称、正文、身份、事件和金额。公共旋转、左右透视和透视距离复用 `component-style-parameters.js` 与 `effectTransform`，不另建 Astral 变换系统。客户端、画布、预览及本机场景共用本机逐样式外观；不新增服务器样式合同。入场时序见[动效合同](danmaku-motion.md#astral-星笺分层动效)。

### 暗月固定弹幕

`dark-moon`（暗月）是按 [Dark Moon 2.0 公开预览](https://vgen.co/Melonturtle/product/dark-moon-chat-widget-streamelements-/b8274ca7-9240-410d-82af-45eb3c542acd)重建的本地固定弹幕。`danmaku-dark-moon.js` 复用公共 renderer 的安全文字与 B 站表情，再组合昵称、月相图标、分段竖线、暗色卡片、右衬线及底边星芒；CSS 位于 `danmaku/dark-moon.css`。几何图形使用内联 SVG/CSS，复用现有 Nunito 字库；公开演示只作分析，不作为运行素材或外部下载。

默认普通消息为紫灰细框，只有有效的本房间 `roomGuardLevel`（1 总督／2 提督／3 舰长）使用金边和描边月环，`guardLevel` 与其他房间灯牌不影响配色。主播可显示「主播」副信息，但不因此获得大航海金边。礼物与开通／续费使用金色提醒条，数量和已结算总额取实际事件；未知购买动作显示「支持」，缺失金额显示 `—`。SC 的真实昵称与两位小数金额位于提醒条，完整原文在独立暗色正文区，不裁断多行文字。

默认区域 480×700，正文 24px、范围 18–40px、颜色 `#c9c0dc`，Nunito 500、行高 1.28、字距 .09em。金色提醒条渐变为 `#ffe69f` 至 `#f8cc80`。支持字体、正文色、背景不透明度、上下滚动、边缘处理及持续动画，边缘默认直接切断；字号调整正文/SC 留言及表情，礼物／上舰提醒文字以所选字号的 .88 倍保持层级，提醒昵称使用同一所选字体的 700 字重；普通昵称与装饰保持本款尺寸。关闭持续动画后停止星芒、星点和轨道浮动，保留入场与列表移动；减少动态效果时直接完整显示。样式、预览图及参数通过现有客户端样式库、画布和本机场景交付；旧布局只补齐缺失区域，不改变已保存的其他区域，也不新增服务器渲染合同。

共享高级效果能力为 `art`：轮廓、投影、辉光和颜色效果作用于完整构图，文字描边同时覆盖昵称、正文、身份、事件和金额；不提供只适用于面板的内阴影／内发光。`component-style-effects.js` 按样式补充文字选择器，继续使用原有配置、保存、追加节点观察和恢复／清理机制；不另建监听器或样式专用效果控制器。

「高级参数 → 月环与星芒」直接更新现有装饰，不改变本房间身份、实际事件金额或正文颜色；未自定义时正文仍使用 `#c9c0dc`。默认保留原作紫金和原月环尺寸。

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `darkMoonPalette` | `original`（默认）／`moonlight`／`ice` | 原作紫金／月白银紫／冰蓝星夜，联动月环、边线和事件装饰 |
| `darkMoonRingSize` | 70–140%，默认 100 | 月环装饰的相对大小，不缩放文字 |
| `darkMoonSparks` | `show`（默认）／`hide` | 边角星芒显隐，与持续动画开关独立 |

### 线框星事固定弹幕

`wireframe`（线框星事）按[兔宝的神奇口袋的公开演示](https://www.bilibili.com/video/BV1Uw8v6XENM/)重建布局和分层入场。`danmaku-wireframe.js` 组合安全文本、B 站表情、头像、圈线、罗马档位与共用舰徽，`danmaku/wireframe.css` 拥有外观和入场。默认西文使用 Times New Roman，中文使用共享 CDN 字库补齐的完整思源宋体，以 `Lira Wireframe Serif` 声明并复用 `/fonts/sea-breeze/sea-breeze-serif.woff2`，不依赖系统宋体的小字号字形；圈线与装饰由 CSS／内联 SVG 绘制。正文 24px、范围 18–48px，区域 480×700；支持公共字体、正文色、底色不透明度、滚动方向及边缘处理，默认直接切断。透明度只改变底色，文字和线条保持清晰。卡片缩略图由实际 renderer 截取，参考视频及其背景、头像不作为生产素材交付。思源宋体纳入共享字体启动下载，旧字体族名和本地路径保持兼容。

普通消息按内容宽度显示，头像位于框外，横线和黑底向右渐隐；本房间 `roomGuardLevel` 1／2／3 分别使用总督厚双框与对角星、提督双细框与刻度、舰长圈线。昵称旁显示实际身份舰徽与 I／II／III，不将档位当作灯牌等级；普通粉丝牌只读取 `roomMedal`，不回填外房间身份。各类消息共用对称的左右外边距，礼物与 SC 占满可用宽度，使用通栏金额栏和独立正文；窄区域中头部可换行、金额按可用宽度收紧字号，正文缩进随宽度收紧但保留所选字号。金额来自 `giftTotalPrice` 或 `price`，不再乘数量，缺失显示 `—`，0 显示 `CN¥0.0`。SC 仍由公共 SC dispatcher 创建，保留完整原文和撤下行为。开通／续费按 `giftGuardLevel` 显示居中头像、侧线、昵称、舰徽及「已入列」，实际动作与数量保留在可访问名称中。

默认聊天与礼物／SC 约 700ms 入场，上舰约 1100ms，动画顺序见[分层动效](danmaku-motion.md#线框星事参考与分层动效)。共享 feed 负责移动、中断、淘汰与清理；没有独立计时器、连接或列表控制器。系统减少动态效果时完整静态显示。旧布局仅补缺失的 `wireframe` 区域，客户端选择卡、画布与本机场景共用该实现；服务器旧渲染源保留自身契约。

「高级参数 → 圈线与描框」保留公共轮廓颜色与宽度的职责，只增加原生框线、圈线和入场控制。框线渐隐与圈线显隐直接更新已有节点；入场方式与时长在创建消息时锁定，仅影响新消息，时长按所选值与 700ms 的比例缩放各层，上舰保留较长的相对节奏。

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `wireframeFadeLength` | 0–100%，默认 100 | 普通消息框右侧渐隐所占宽度；0 保留完整框线，大航海多层框不受影响 |
| `wireframeOrbit` | `show`（默认）／`hide` | 头像外圈显隐，保留头像 |
| `wireframeEntrance` | `traced`（默认）／`none` | 圈线与描框入场／直接显示 |
| `wireframeEntranceMs` | 350–1400ms，默认 700 | 普通消息入场时长；直接显示时控件停用、保存值保留 |

### 圣诞来信固定弹幕

`christmas-letter` 是奶油纸张、糖果色昵称牌与原创圣诞角色插画组成的客户端固定弹幕样式，区别于红金配色的 `christmas`（圣诞绮笺）。渲染适配器为 `danmaku-christmas-letter.js`，样式为 `danmaku/christmas-letter.css`，八张原创角色 WebP 与三张用户截图裁切的角色／船只背景随客户端本地静态资源交付，位于 `public/img/overlays/danmaku-christmas-letter/`；复用已有 Nunito 字体，不新增启动下载或服务器渲染实现。

默认区域 480×700，正文默认 24px、范围 18–40px，正文颜色默认 `#725244`。支持字体、正文颜色、背景透明度、滚动方向与边缘处理，边缘默认直接切断；透明度只作用于纸面，昵称、正文和插画保持清楚。正文、表情、普通礼物的昵称／动作／礼物名／数量／合计，以及大航海的动作正文和金额均跟随正文字号；聊天与 SC 昵称、SC 金额、徽标和角色贴图保持作者尺寸。样式注册、Node 合同镜像、桌面选择、画布预览与本地场景输出共用现有保存入口。

普通聊天以 `isStreamer`、本房间 `roomGuardLevel` 和 `roomMedal` 显示主播、大航海或粉丝团装饰。有效的正整数 `roomMedal.level` 与身份合并显示为「粉丝团 N」「舰长 N」「提督 N」或「总督 N」，灯牌名称保留在提示中；缺失等级时仅显示已知身份，不从其他房间的 `medalLevel`／`medalName` 补位，也不把身份档位 1／2／3 当作数值等级。普通礼物采用紧凑通知；购买大航海由 `giftGuardLevel` 决定身份标签与对应角色船只背景，卡片不再显示泛称标题，保留昵称、实际金额及开通／续费／支持动作。背景来自用户提供的三张截图，经去除外侧浅底和独立题字后静态裁切；左侧保留文字区域，右侧展示舰长／提督／总督对应角色，原图记录见同目录 `guard-scenes-sources.json`。SC 按真实 `superchat` 事件进入既有 `danmaku-superchat-renderer.js`，由该模块创建 SC 根节点与完整原文，再调用本款外观组合函数；不把 SC 改成普通聊天，也不根据文字或金额猜测类型。SC 使用金色「SC · 醒目留言」标题、大号实际金额和通栏完整留言，聊天表情继续复用公共解析。金额直接使用 `price` 或已结算的 `giftTotalPrice`，不再乘数量，未知金额显示 `—`。普通入场约 720ms，连续到达收敛装饰，重要事件保留 1460ms 完整编排，详见[圣诞来信动效](danmaku-motion.md#圣诞来信分层动效)。

### 圣诞绮笺固定弹幕

`christmas` 为客户端内置固定弹幕，沿用本机外观保存和场景输出。`danmaku-christmas.js` 复用安全消息与表情渲染后组合金边卡片：聊天与 SC 使用酒红底色，普通礼物使用松绿底色与淡金松针，大航海使用深蓝底色与罗盘、波纹暗纹；背景图案为本款本地 SVG。渲染器创建独立的内联 SVG 圆角边框以支持沿轮廓描金；底板、边框、文字与装饰分别入场，聊天 1040ms、礼物／上舰／SC 1180ms，正文分别在 350ms、400ms 内显现。普通聊天带侧边星饰和下缘蝴蝶结，礼物、上舰及 SC 带花环和彩灯。昵称只显示真实消息，本房间大航海身份取 `roomGuardLevel`，粉丝标记取 `roomMedal`；不借用其他房间身份。礼物数量、单条已结算总额与 SC 金额如实显示，金额保留两位小数，缺失显示 `—`，未知上舰动作只显示“支持”。SC 正文通栏保留完整文字与换行，表情继续复用公共安全解析。

默认区域 480×700，正文 24px、可调 18–40px，聊天与 SC 昵称固定 16px，礼物感谢昵称 20px、金额 14px，SC 金额 20px；正文字号不改变昵称、金额与装饰尺寸。SC 金额与类型位于昵称右侧，较长时整组换行，正文按可用宽度自然换行并保留用户的显式换行，不均衡行长。礼物与大航海采用居中的两行感谢文案：首行为“谢谢＋真实昵称”，次行为动作、礼物／大航海名称和数量，金额以小字跟随；普通礼物使用“送来的”，大航海仍按真实事件区分开通／续费／支持。礼物名默认采用常规字重的宋体与疏朗字距，字号为正文的 92%（默认约 22px），动作和数量固定 14px，数量略高于名称基线；选择其他字体时礼物名同步使用所选字体。两行均允许长内容自然折行，金额空间不足时居中换到下一行；单条长文仍由公共 feed 完整适配。舞台不再叠加内边距，列表上／右／下／左内边距为 8／8／14／36px，左侧为外伸星饰保留空间，底部保留完整蝴蝶结。卡片间距 18px，蝴蝶结为 54×30，花环为 41×41，系统消息使用更紧凑的底板。常规字体、正文颜色、滚动方向和边缘处理沿用共享控件；「弹幕配色」调整聊天与 SC 的酒红底色，礼物与大航海保留各自配色；「背景不透明度」只影响底板及其暗纹，「持续动画」控制最新一条的侧饰轻摆或彩灯呼吸，旧消息装饰静止。SVG 装饰由本款本地资源提供，不新增外部图片请求或启动下载。分层入场和实际播放要求见 [动效合同](danmaku-motion.md#圣诞绮笺分层动效)。

### 幽灵便笺固定弹幕

客户端内置样式 `spooky`（幽灵便笺）以 Melonturtle 的 [Spooky Notes 公开预览](https://www.etsy.com/listing/1578936439/spooky-notes-chat-widget-cute-halloween)为美术参考，保留贴纸、错位纸片及 Chat Box；这不是作者的付费源码。专属装饰由 `danmaku-spooky.js` 创建，素材位于 `public/img/overlays/danmaku-spooky/`，样式由 `danmaku/spooky.css` 维护；公共渲染核心及来源哈希不变，队列、适配、移动、删除与销毁继续由 `danmaku-feed.js` 负责。

配置追加固定区域 `spooky: [530,620]`，缺少它的旧布局回填默认值，不移动已有区域。`spookyTheme` 仅接受 `default/autumn/graveyard/moonlight`，默认 `default`；`spookyFrame` 仅接受 `show/hide`，默认 `show`。专属选项仅对该样式有效，浏览器和 Node 合同镜像同步；字号 16–36、默认 20。外框是页面中单份装饰节点，其可见性和配色由样式控制，不插入消息队列。带外框时，内边框顶部保留 60px 的 CHAT 标题区，弹幕容器下边界与内边框对齐；默认尺寸下容器高 494px，内部继续保留头像与贴纸所需的上下留白。

`spookyFrameColor`、`spookyMessageColor`、`spookyEventColor`、`spookyAccentColor` 为可选 `default` 或 `#RRGGBB[AA]` 覆盖，缺省跟随四套主题。正文复用可选 `textColor`：未设置时解析当前主题的正文色，显式设置时即使等于紫色主题默认值也视为自定义，并在换主题时保留。客户端和画布共用原参数面板；颜色模式不单独持久化，选择跟随主题删除对应覆盖键，独立预览采用相同编辑规则。`SPOOKY_THEME_COLORS` 为选择自定义时的初始色与正文默认色提供镜像合同；CSS 保留完整主题层次，自定义消息底色以该色和 65% 原色 / 黑色的深色端组成渐变。

`spookyFrameOpacity`、`spookyMessageOpacity`、`spookyEventOpacity` 为 0–100 整数，缺省 100。渲染端分别设置填充权重，仅改变底板和背衬纸片的 alpha，不在父节点设置整体 opacity。强调色派生纸片、书签、蛛网与外框边线，事件文字保留主题配色；不改变真实头像。`resetSpookyColors` 仅删除五项颜色和三项 alpha 的覆盖，保留主题、外框、字体、字号、其他样式及布局；顶部完整恢复仍清空当前样式参数。主题与颜色通过 CSS 变量原位生效，沿用既有保存和同样式共享 owner。

普通消息复用原渲染器的安全文本和表情节点，身份取 `roomGuardLevel ?? guardLevel`，显式房间等级 0 不借用其他房间等级，不重复显示“观众”。礼物保留原名称、数量和已结算金额，上舰采用 `giftGuardLevel`；头像经原有 URL resolver 加载，缺图使用便笺头像。SC 与礼物沿用当前便笺主题，不按金额档位改色。SC 直接使用原始 `message` 和实际 `price`，头部与通栏正文分开，沿用公共 feed 处理长文、撤回及区域适配。进入/系统消息使用小型纸条，不自动开启进房显示。

装饰遮罩同时提供 `-webkit-mask` 和标准写法。旧直播软件内核不支持 `color-mix` 时，`danmaku-spooky.js` 在主题与参数应用后读取当前 CSS 色板，按 sRGB 预乘 alpha 混色生成 RGBA，供 `spooky.css` 的特性检测回退使用；保留四套主题、自定义颜色、渐变方向及各层独立透明度。支持该能力的内核继续使用原 CSS，布局、贴纸、文字和动画不变。

默认使用本地 Nunito 与现有荆南麦圆，字体许可随资源提供。本地场景随客户端交付该实现，不依赖服务器样式版本。

### 仿推特 3.0 固定弹幕

`twitter` 使用白色社交资料卡和帖子列表，默认区域 480×700；1920×1080 新画布默认位于 `{x:40,y:340}`，旧布局只补齐缺失区域。支持字体、18–40px 字号（默认 22px）、正文色（默认 `#141414`）与上下滚动，边缘处理默认 `none`。白色外框保持不透明，礼物／SC 色块可通过专属配色调整不透明度。礼物固定使用真实原图，旧 `giftImage` 值仍接受但解析为 `gift`，管理页与预览隐藏插画切换。

专属参数保存于 `styleOptions.twitter`，Node 与浏览器副本统一校验；其他样式拒绝这些字段，旧记录缺失时使用默认值，不迁移已有数据：

| 字段 | 用途 | 默认值／约束 |
| --- | --- | --- |
| `twitterHeader` | 房主资料与标签区 | `show`，仅接受 `show` / `hide` |
| `twitterComposer` | 底部提示栏 | `show`，仅接受 `show` / `hide`；隐藏保留自定义文案 |
| `twitterActions` | 每帖评论／转发／爱心／分享装饰行 | `show`，仅接受 `show` / `hide` |
| `twitterColor0` | 单次金额低于 50 元的礼物／SC 底色 | `#409afa` |
| `twitterColor50` | 50～99.99 元的礼物／SC 底色 | `#f9c844` |
| `twitterColor100` | 100～999.99 元的礼物／SC 底色 | `#f89260` |
| `twitterColor1000` | 至少 1000 元的礼物／SC 底色 | `#ef4260` |

四档颜色接受六位或八位十六进制字符串，归一为小写；八位值由既有选色器调整不透明度。客户端与克隆画布面板共用 `bindDanmakuParameters`，三个版式字段位于常用参数，四档配色位于「高级参数 → 礼物与 SC 配色」；独立预览同步提供。`applyStyleOptions` 写入 body 的对应 data 属性与 `--twitter-event-color-<金额档位>`，卡片通过可继承变量立即换色，保留既有节点与播放时间。隐藏顶部回收资料／标签的 192px 和白卡顶部预留，隐藏底栏回收至少 68px，隐藏操作行缩短帖子；取消隐藏恢复参考布局。上舰身份色不受四档事件配色影响。「恢复默认」只清空当前样式的参数，按现有流程应用后保存；服务端采用相同参数合同与渲染模块；部署对应服务器版本后在线生效。

独立源的顶部房主资料复用 `GET /api/bilibili/room/profile`，只读取本地当前配置房间，响应仅含 `roomId/uid/name/avatarUrl`，不接受页面指定房间或主播身份。预览固定使用合成房主。本机场景由 `scene-runtime` 经现有显示数据投影 `data.danmaku.roomProfile` 的同四个公共字段；先核对本地 `liveStatus.roomId` 与授权云状态 `state.roomGuard.roomId` 一致，异步读取完成后再次核对账号代次和房间。各画布共享同账号、房间的待处理读取及30秒结果缓存，资料加载不等待或阻断消息交付；失败或不同房间投影为 `null` 并保持中性等待。无凭据子框架只消费该投影，不请求受保护资料HTTP、不接收token，不新增远程资料协议。异步旧响应、取消和头像失败不影响消息列表。

资料头保留参考图的悬浮头像：白卡从组件顶部 40px 开始，116px 头像位于顶部 13px，伸出白卡但完整包含在显示区域内；资料行高 142px。房主名称为 24px／30px 行高，第二行以 `@<实际 B 站 UID>` 显示账号，18px／24px 行高，资料相对头像下移；右侧 `Followed` 为不可交互的装饰，不读取或修改关注关系。昵称和账号均限制在自身可用宽度内。消息昵称与灰色身份／时间继续使用同一字体和 32px 行高，字号分别为 24px／18px，居中对齐并保持间距；长昵称优先省略，为身份和时间保留空间，避免挤到右侧箭头。

UID、未激活页签、陪伴天数、底栏提示和空列表文字复用元信息灰色 `#737373`，在白底上的对比度约为 4.74:1；`Followed` 装饰沿用参考图的浅灰色。文字由 DOM 直接渲染，图标使用 SVG；预览适应窗口时随整张画布缩放，不代表输出分辨率。直播软件网页源宽高应匹配画布，放大内容应调整组件尺寸或字号后重新应用，避免把较小的网页源直接拉大。

底栏默认显示「欢迎来到直播间 ✨」，可通过当前样式的 `styleOptions.twitter.composerText` 修改。只接受单行字符串，上限 20 个 Unicode 可见字符（组合表情计一个），支持中文、英文、数字和符号；去除首尾空格并归一为 NFC，换行／控制字符或超长值拒绝，空白值删除覆盖并恢复默认。Node 与浏览器复用同一参数合同，页面只通过 `textContent` 渲染，不解析 HTML。客户端、画布参数和独立预览提供「底部提示文字」及实时字数，保存和恢复默认沿用样式参数流程；旧配置没有此字段时直接使用默认。较宽文案自动换行，底栏至少为原 68px，并随内容增高，完整显示文字。本机场景直接使用客户端合同与渲染器；旧服务器在线源的独立实现不作为本机保存的前置条件。

普通聊天保留安全正文、表情和头像；表情按完整比例显示，宽图限制到正文可用宽度，多张纯表情使用贴图尺寸并自然换行，帖子高度随内容增长，操作行始终位于内容下方。昵称后的元信息使用 `@Spectator`、`@Captain`、`@Admiral`、`@Governor`，礼物／SC 使用 `@Gift`，并保留实际消息时间。普通礼物显示真实名称、数量、原图及可用的已结算总额，名称与数量位于通栏色块内，金额位于色块上方。缺图或加载失败时，空图片节点不占布局空间，赠送文字相对色块居中；有图片时，图片与文字整体居中。SC 同样使用通栏色块，保留发送者、实际金额和完整原文，并沿用 `messageId` 撤回。两者的本款色块按本次总额分为蓝（低于 50 元）、黄（50–99.99 元）、橙（100–999.99 元）、红（至少 1000 元）。

购买大航海仍以 `giftGuardLevel` 区分舰长／提督／总督，独立白色框内使用三层渐淡、向右上方的实心矢量阶梯箭头和圆章，替换小箭头排布；动作只接受明确的开通／续费，未知时显示“感谢支持”，陪伴天数仅使用正整数事实。当前房间大航海身份与本次购买等级分开读取，对勾与上舰装饰使用舰长蓝、提督紫、总督红。

每张卡片的评论、转发、爱心、分享及下拉箭头均为 inline SVG，不放大低清位图，也不生成点赞数、关注状态或交互结果。`danmaku-twitter.js` 拥有矢量结构，`danmaku/twitter.css` 拥有布局和关键帧；共享 feed 继续负责测量、移动、淘汰和快照，分层入场与 reduced motion 见[固定弹幕动效](danmaku-motion.md#仿推特-30-分层动效)。

### 花与信笺固定弹幕

`flower-letter` 为客户端新增固定弹幕，复用安全文本／表情 renderer、既有实时消息订阅和共享 feed。视觉按用户认可的《花与信笺》复刻稿接入，原作署名与重绘来源见 [素材说明](../../../public/img/overlays/danmaku-flower-letter/SOURCES.md)。`danmaku-flower-letter.js` 只负责消息组合，`danmaku/flower-letter.css` 与独立 SVG 负责纸面、邮戳、花叶和信封，不携带研究视频或截图。纸面上／下切片固定，中段随长文或单张大表情延展，为底部落款保留空间，花叶保持比例；头像与文字不在贴图内。

普通观众为邮戳信笺；本房间粉丝牌为绿色花笺；本房间舰长／提督／总督为蓝／紫／粉花笺。只使用 `roomGuardLevel` 和 `roomMedal.level`，不把其他房间的佩戴身份推断为当前房间身份。时间使用消息 `timestamp` 按本机时区显示小时／分钟，昵称、灯牌等级、头像和表情使用真实消息内容，缺失身份／时间不补造。

`giftGuardLevel` 为有效购买等级时使用对应上舰信封；明确 `guardAction` 决定开通／续费，未知动作显示感谢支持。普通礼物显示礼物名、数量与已结算 `giftTotalPrice`，不重复乘数量；明确零金额使用邮戳短笺，未知金额不伪造为免费。SC 保留完整原文、换行、昵称和 `price`；头像缺失或失败时显示昵称首字占位。

默认区域 480×700，旧布局只补齐缺少的本款区域。常规信笺的可见纸面宽约 600px，居中后左右各留约 20px，花叶和邮戳等比缩放，正文显示字号保持不变。正文字号 18–40、默认 24，字体默认共享库 `Lira Yozai`（悠哉字体）；可覆盖字体、字号、正文色、纸面不透明度、滚动方向与边缘处理，边缘默认直接切断。管理页样式卡片、画布添加组件和独立预览使用同一目录，样式缩略图由实际消息 DOM 高清渲染；现有外观效果继续适用。服务器独立弹幕源已同步支持该样式、参数和画布；源码接入不代表远程服务器已部署。

### 手账风固定弹幕

`notebook` 是客户端内置固定弹幕，默认区域 480×700，正文字号默认 23px、范围 18–48px，边缘默认直接切断。聊天卡片按昵称和正文的内容宽度收放，文字左右各留 0.875em 内边距（固定 23px 设计基准），最多占满列表扣除内边距后的可用宽度，头像和间隔占据独立空间；短句保持单行，长正文按可用宽度自动折行。礼物、上舰与 SC 卡片使用全宽，普通礼物感谢文字在正文区域居中，上舰感谢文字左对齐。普通／舰长／提督／总督分别使用原片的米白／蓝／紫／粉便笺；昵称、粉丝牌、当前房间身份、真实头像和 B 站表情沿用消息字段及既有 URL resolver。头像装饰中央镂空，不把默认 TV 图覆盖在真实头像上；表情不增加样式自身动画。

`danmaku-notebook.js` 复用共用 renderer 的安全正文和表情，组合头像、纸张、胶带、折角、昵称和正文；聊天身份只读取 `roomGuardLevel`，粉丝牌读取 `roomMedal`，不将其他房间的佩戴身份作为当前房间身份。普通礼物使用薄荷抬头、实际数量及金额，大航海购买按 `giftGuardLevel` 显示感谢和购买等级；明确的 `guardAction` 区分开通／续费，未知动作显示感谢支持。SC 保留实际金额及完整字面正文，用同款事件纸张承接；参考原片没有展示 SC，不将这部分称为原作者 SC 的复刻。素材与原片来源记录在 `public/img/overlays/danmaku-notebook/provenance.json`。

`danmaku/notebook.css` 拥有分层入场、最新纸张浮动及头像独立摆动/缩放，旧纸张暂停时保留当前位置，旧头像仍继续动作；公共 feed 继续拥有排序、测量、移动、中断和销毁，没有新增消息计时器或样式名称分支。具体时序见[固定弹幕动效](danmaku-motion.md#手账风分层动效)。客户端预览、画布与本地场景浏览器源共用这一实现；旧服务器在线源继续遵循其独立版本契约，不是本地样式交付的依赖。

### Animated Gradient 渐变气泡固定弹幕

`animated-gradient` 按 [GhostTypeStudios 公开演示](https://www.etsy.com/listing/1365125747/animated-gradient-chat-widget)重建固定弹幕。默认区域 480×700，正文 19px（16–40px），默认向上滚动、边缘直接切断。`danmaku-animated-gradient.js` 复用安全文本／表情解析，只组合错位渐变昵称牌、白色正文气泡、下方细线及事件双框；`danmaku/animated-gradient.css` 拥有外观、渐变循环和分层入场。本款 Montserrat 400／700 经共享 CDN 字库补齐，与天穹横栏的 300 字重归入同一包，保留原字体族名和本地 URL；中文回退到系统字体；参考视频及其宣传背景不作为运行素材。

普通聊天按内容宽度显示，本房间大航海取 `roomGuardLevel`、粉丝牌取 `roomMedal`，房主取显式 `isStreamer`；不把其他房间身份或 Twitch 代词写入消息。礼物和上舰使用独立事件条，显示真实名称、数量和 `giftTotalPrice` 已结算金额，开通／续费取 `guardAction`，未知动作显示“支持”；SC 使用同款事件头并完整保留字面原文与换行，金额来自 `price`。未知金额显示 `—`，0 是已知金额；没有重复乘数量。

消息没有自动到期时间，历史快照和实时消息均保留到滚出区域，再由公共 feed 淘汰。聊天入场约 1100ms，事件约 1650ms，详见[动效时序](danmaku-motion.md#animated-gradient-渐变气泡动效)。字体、字号、正文色、底色不透明度、方向、边缘与持续动画开关复用公共参数；事件条姓名／金额按正文的 17/19、事件签按 13/19 缩放，聊天昵称牌保持原尺寸，透明度只改变白底。高级效果映射到 `.gradient-panel`，文字描边包含事件标签和金额；没有新增观察器、连接或消息定时器。客户端、画布和本机场景共用实现，旧布局仅补缺失的新区域，服务器旧源保持独立。

「高级参数 → 渐变与昵称牌」通过 CSS 更新已有昵称牌、事件签与细线，不重建消息。颜色循环使用事件已过时间接续相位；关闭持续动画时暂停调节周期并保留已保存值。默认保留原作流彩。

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `gradientPalette` | `original`（默认）／`sunset`／`ocean`／`lavender` | 原作流彩／落日暖霞／海盐青蓝／薰衣草紫 |
| `gradientCycleSeconds` | 6–24 秒，默认 10 | 颜色往返流转周期，数值越大越慢 |
| `gradientUnderline` | `show`（默认）／`hide` | 底部细线显隐；保留原间距，切换不重播展开 |

### Glass 玻璃通知固定弹幕

`glass` 是客户端内置固定弹幕，按 [TurboJyapka Glass 公共演示](https://www.etsy.com/listing/4411923358/glass-twitch-chat-widget-pastel-kawaii) 的布局与动画实现。默认区域 480×700，正文 22px（16–40px），新消息默认位于顶部、旧卡向下让位，边缘直接切断。普通消息无头像，昵称与角色标记在上、正文在下、消息时间位于右上；礼物与大航海使用左侧真实静态图片、竖分隔线及两行内容。SC 保留金额线条图标，并在同款通知卡中额外保留实际金额与完整字面正文。

`danmaku-glass.js` 复用共用 renderer 的安全文本和表情，当前房间大航海标记只读取 `roomGuardLevel`，灯牌标记只读取 `roomMedal`，主播标记读取 `isStreamer`；购买等级及动作分别读取 `giftGuardLevel`、`guardAction`，金额取实际结算值。普通礼物只加载 resolver 放行的图片，通过 `shared/gift-image.js` 选择静态 WebP，首帧转换复用本节的共享缓存规则；原图请求使用匿名 CORS 和 `no-referrer`。缺图、下载或转换失败沿用共享礼物占位图并保留文字。大航海按购买等级直接使用 `bilibili-guard-icons.js` 的内置静态 WebP，随既有房间人数状态切换普通／千舰款，不依赖礼物目录或远端图片，不新增 B 站请求。无头像请求。Quicksand 已纳入共享软件字体库和 CDN 下载，保留 `Lira Quicksand` 族名及原字重，来源与许可见 [字体说明](../../../public/fonts/glass/README.md)。

`danmaku/glass.css` 拥有透明淡蓝材质、30px 圆角、细白边与微弱星点。背景颜色可调，背景不透明度 0–100%、默认 20%，不淡化文字；默认舒展密度下昵称、时间、图标与间隔保持本款设计基准。`defaultScrollDirection` 与 `defaultBackgroundOpacity` 由共享字段合同解析，其他款缺省仍为 `up` 和 100。持续动画开关控制星点，减少动态效果时直接显示卡片并隐藏星点。入场与让位时序见[固定弹幕动效](danmaku-motion.md)。桌面保存、画布和本机场景共用本款；服务器旧在线来源保持独立。

礼物、大航海及 SC 正文均按正文字号的 12/11 排版，整卡只跟随组件缩放，SC 不再套用旧版 460px 卡片的额外倍率。前后端公共外观能力均登记为 `panel`；`component-style-effects.js` 将所有消息的轮廓、投影与内外光影映射到 `.glass-panel`，文字描边覆盖昵称、正文、时间与 SC 类型/金额。入场横移组合 `--component-transform`，保留用户旋转和倾斜；关闭效果时由公共 owner 恢复原属性，不增加样式私有观察器、队列或计时器。

玻璃背景保留透明度并使用页面内 `backdrop-filter`；浏览器源不能采样 OBS／哔哩哔哩直播姬的其他来源，也不能跨场景子 iframe 模糊另一图层。演示游戏背景不随样式打包。

「高级参数 → 玻璃通知」直接更新已有卡片；密度只改变卡片留白与事件图标比例，正文仍使用所选字号。关闭持续动画时隐藏星点并停用闪光强度控件，已保存强度保留。

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `glassTime` | `show`（默认）／`hide` | 右上消息时间显隐 |
| `glassGlintIntensity` | 0–100%，默认 100 | 星点闪光强度，0 隐藏 |
| `glassDensity` | `comfortable`（默认）／`compact` | 舒展／紧凑卡片，默认保持原间距 |

### Glowy 流光玻璃固定弹幕

`glowy` 参照 [milaeshop Glowy 公开演示](https://www.etsy.com/listing/4391673194/glowy-chat-widget-horizontal-and)，使用深色半透明玻璃、身份彩色侧光、方形头像和分层显现。默认区域 480×700，正文 22px（16–40px），默认向上排列、边缘直接切断。横排复用公共 feed 的 `flowAxis`，每条逻辑宽度 400px；拉宽组件区域增加容纳空间，不额外放大字形。公共 feed 按当前轴预留变换与光影的外沿：竖排使用上下边距，横排使用左右边距，测量、续接和移除使用同一尺寸。布局轴改变时重建 feed，头像、时间、侧光和公共效果直接更新已有消息。

`danmaku-glowy.js` 组合共用安全文字／表情节点；聊天右侧舰徽只读取 `roomGuardLevel`，上舰读取 `giftGuardLevel` 和 `guardAction`，复用 `setGuardIcon` 的普通／千舰图案。普通礼物用线条礼盒，SC 用留言图标；事件保留真实发送者、动作、名称、数量及已结算金额，SC 保留完整字面原文和撤回行为。不会为装饰图标增加远程图片请求。

`danmaku/glowy.css` 拥有 `.glowy-material` 底板、左侧光条和右侧柔光；公共底板效果映射到材质层，文字描边覆盖昵称、正文、时间、身份与金额。背景不透明度控制底板填充，侧光强度独立控制两侧灯光；未覆盖强调色时按主播／本房间大航海／普通礼物／SC 分色。使用系统字体并支持公共自定义字体，不新增字体下载。入场、让位和持续动画职责见 [Glowy 动效](danmaku-motion.md#glowy-流光玻璃动效)。

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `glowyLayout` | `vertical`（默认）／`horizontal` | 竖排／横排，滚动方向同时决定消息进入的一端 |
| `glowyAvatar` / `glowyTime` | `show`（默认）／`hide` | 聊天头像／消息时间显隐 |
| `glowyLight` | 0–100%，默认 85 | 彩色侧光强度 |

### Charm 轻语横栏消息流

`horizontal-charm` 参照 [Horizontal Charm 公开演示](https://www.etsy.com/listing/1656260287/horizontal-charm-chat-widget)，作为第四类「横向滚动」第二项。默认区域 1920×120，位于 1920×1080 画布的 X=0、Y=960；已有布局只补齐缺失区域，不覆盖自定义尺寸。正文字号 12–36px、默认 20px，默认正文色 `#51465f`；复用共享字库的 Nunito 与荆南麦圆，缺字回退到本机中文字体，不新增字体资源。昵称签收紧字距并保留原始大小写，身份色采用灰紫、玫瑰、暖金、梅紫与鼠尾草绿；事件类型作为次级文字。支持字体、正文色、强调色及气泡底板不透明度。

`danmaku-horizontal-charm.js` 复用公共安全文字与行内表情渲染，组合身份小标、彩色昵称签和白色尾尖气泡。主播取 `isStreamer`，本房间大航海取 `roomGuardLevel`；普通礼物与上舰保留真实名称、数量、购买档位、动作和已结算总额，未知金额显示 `—`。SC 保留字面完整原文与实际金额并支持撤下。事件以透明底图标和双行文字呈现，不请求头像或礼物图。

`danmaku/horizontal-charm.css` 拥有气泡与分层入场；公共 `panel` 效果的底板目标仅为聊天的 `.charm-content`，文字效果覆盖昵称、身份、正文和金额。公共透视与旋转和入场组合。`layout: horizontal` 复用 feed 的移动、打断续接、淘汰、适高与销毁，`fitWidth: false` 保留自然宽度，最多 15 条；长文按气泡最大宽度换行。无独立订阅、队列或计时器。动效见[轻语横栏动效](danmaku-motion.md#charm-轻语横栏动效)。

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `charmGap` | 8–80px，默认 32 | 消息之间的距离 |
| `charmMaxWidth` | 240–1000px，默认 560 | 气泡／事件正文最大宽度，长文换行保留全文 |

### 咖啡手记固定弹幕

`coffee` 参照[小松绿 Viridis 直播间](https://live.bilibili.com/1727071052)在 2026-11-08 的视频画面右侧弹幕，以透明底、手绘咖啡杯头像框、三缕蒸汽、楷体正文、昵称横线及消息时间组成。黑板和木框属于参考直播场景，不绘入弹幕组件。普通聊天及礼物的细金框、金额标签和描线入场来自实时视频采样；原字体文件与动画源码无法确认，大航海和 SC 未捕捉到完整触发，采用同系列延伸设计，当前效果为独立复现。

`danmaku-coffee.js` 装饰公共安全 renderer 的内容，`css/overlays/danmaku/coffee.css` 拥有外观与入场；排序、位置、打断、淘汰与清理由公共 feed 负责。默认区域 400×640、正文 26px（可调 18–48px），支持公共字体、正文颜色、滚动方向、边缘处理和持续动画。默认优先使用系统楷体，不可用时回退既有悠哉字体；不新增字体下载。头像、昵称、时间和正文来自真实消息；聊天的本房间大航海等级决定小徽标与昵称色，不显示他房间粉丝牌。

礼物使用淡金双细框、角落星芒、礼物名与数量；右侧椭圆金额标签始终按 `giftTotalPrice` 的已结算人民币总额显示两位小数，不乘数量，未知金额不伪造为零。大航海用 `giftGuardLevel` 区分舰长浅蓝、提督淡紫、总督暖杏与船锚装饰，显示实际 `guardAction`（开通／续费／未知时支持）、数量及有效的 `guardAccompanyDays`。SC 使用暖粉细框与留言符号，标签显示 SC 和实际金额，正文完整保留换行及空白。事件标签替代聊天时间戳；所有事件仍使用透明底、同一咖啡杯头像和安全文字节点，不新增图片请求或礼物图配置。SC 下线沿用公共移除链路。

正文按可见字素逐个显现，组合表情不拆开，已有表情节点及加载失败文本回退继续生效。完整文字先参与排版，避免打字过程中反复改高；根入场时长随全文延长，文字未写完前不会提前撤去入场标记。减少动态效果立即展示全文，外观修改不重播已有消息。桌面样式库与画布共用本机外观保存；无服务端样式同步或额外订阅。具体时序见[咖啡手记动效](danmaku-motion.md#咖啡手记动效)。

### Neon Glass 霓光玻璃固定弹幕

`neon-glass` 按 [GhostTypeStudios 的 Neon Glass 公开演示](https://www.etsy.com/listing/1576998013/animated-neon-glass-chat-widget)重建银紫色透明胶囊、高光、彩色昵称及白色提醒图标，属于「固定位置」样式。默认在 1920×1080 画布左下方占 480×700（X=40、Y=340）；旧布局只补缺失区域，已有区域／图层不改尺寸。`danmaku-neon-glass.js` 只组合公共安全文字／表情节点；纵向排序、上下方向、边缘渐隐、打断续接、越界淘汰和销毁沿用公共固定 feed，胶囊保留自然宽度并受区域宽度约束，超高长文由公共适配完整缩入区域，无私有队列或订阅。

昵称按姓名稳定分配原作五色，并混入 35% 白色提高辨识度；可改为当前房间身份色或正文色，身份只读取 `roomGuardLevel`、`roomMedal` 与 `isStreamer`，跟随正文模式直接使用所选正文色。礼物保留真实名称、数量及已结算总额，零金额与未知金额分开；大航海显示本次购买档位和开通／续费动作，SC 保留实际金额、完整字面原文及撤回。省去的头像、礼物图和身份徽章不触发图片解析或下载。字体复用本地 `Spooky Nunito`，中文回退系统字体；正文默认 24px、范围 16–40px，字重 400，聊天昵称保持 24px／700，事件发送者为 600。金额及 SC 金额提示按正文 85%／600 排版，数量保留正文字号；也支持公共字体、正文色、胶囊配色及背景不透明度。

`danmaku/neon-glass.css` 拥有玻璃底板与文字的分层入场；银紫渐变下叠加 76% 烟灰蓝承托，减少浅色直播画面对白字的冲淡，高光改为细窄的上下沿。公共背景不透明度仍控制整个底板，降低后会更透明。公共底板效果映射到 `.neon-glass-panel`，描边覆盖昵称、正文、动作和金额；公共侧倾／透视作用于消息根节点，入场和纵向移动保留变换。参数在客户端及画布共用，按账号存于本机，通过本地组件／场景输出；宣传背景、人物、视频及作者代码不打包。中文字体和 B 站事件为适配，不声明逐像素一致；动效职责见[Neon Glass 动效](danmaku-motion.md#neon-glass-霓光玻璃动效)。

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `neonGlassNameColors` | `original`（默认）／`identity`／`text` | 原作彩色／本房间身份／跟随正文 |
| `neonGlassHighlight` | 0–100%，默认 100 | 玻璃上下沿高光 |
| `neonGlassIcons` | `show`（默认）／`hide` | 提醒图标显隐 |
| `neonGlassEntrance` | `layered`（默认）／`none` | 玻璃与文字分层渐显／直接显示 |
| `neonGlassEntranceMs` | 200–1000ms，默认 480 | 分层入场时长 |

### 天穹横栏消息流

`celestial-horizontal` 参照 [Celestial Horizontal Chat 公开组件](https://meldstudio.co/gallery/celestial-horizontal-chat/)，归入独立第四类「横向滚动」，不属于固定位置、区域随机或飘窗弹幕。客户端、画布添加组件和独立预览共用目录。默认 1920×1080 画布底部 1920×80 横栏（X=0、Y=1000），横向铺满、底部贴齐；新建、恢复区域默认及无布局输出均使用 80px 条高，旧布局仅补齐缺失区域，已有自定义区域和场景图层保留尺寸。拉宽区域增加文字空间，字形按 `contentScale` 缩放。

[danmaku-celestial-horizontal.js](../../../public/js/overlays/danmaku-celestial-horizontal.js) 组合公共安全文字／表情 DOM、按昵称稳定选择的金色星形、姓名和正文；礼物保留真实名称、数量及已结算总额，大航海按本次购买档位和开通／续费动作展示，未知动作显示支持，SC 使用实际金额及完整原文，支持撤下。单行保留完整文本而不缩小长文，区域应留足所需宽度。CSS 拥有紫色半透明底、金色边线、星云与星点；装饰位于 feed 外的单一兄弟节点，不参与消息测量，样式切换时移除。

昵称 Cinzel 700、正文 Montserrat 300 的 Latin 字形与 OFL 来源见[字体说明](../../../public/fonts/celestial-horizontal/README.md)，通过既有软件字体库与本地字体 URL 交付，中文沿本机字体回退。正文字号 12–40px、默认 16px，昵称保持 16px；支持所选字体、正文色、金色强调色、背景不透明度及持续动画。`layout: horizontal` 使用公共 feed 的 `left` 测量、打断续接、淘汰与清理，最多 15 条，`fitWidth: false` 保留自然单行宽度；无新订阅、消息队列或计时器。实际原款只在新消息到达后向左推移，空闲文字静止，动效见[天穹横栏动效](danmaku-motion.md#天穹横栏动效)。宣传片的全屏星空不属于组件。

「高级参数 → 星云与星标」通过 CSS 更新背景和已有星标，不替换消息或背景节点；恢复按昵称变化时使用原来稳定生成的造型。背景节点预备 60 颗装饰星点，默认显示原来的前 30 颗及其位置；分隔线隐藏时仍保留阅读间距。

| 字段 | 范围与默认 | 作用 |
| --- | --- | --- |
| `celestialNebulaOpacity` | 0–100%，默认 30 | 星云浓度，仍与背景不透明度相乘 |
| `celestialStarDensity` | `off`／`sparse`／`normal`（默认）／`dense` | 关闭／稀疏／原作／繁星，分别显示 0／12／30／60 颗星点 |
| `celestialStarShape` | `identity`（默认）／`sparkle`／`star` | 按昵称变化／固定四角星／固定五角星 |
| `celestialSeparator` | `show`（默认）／`hide` | 消息分隔线显隐 |

### Stargazer 星旅消息流

`stargazer` 是客户端本地样式，视觉参照 [Stargazer 公开演示](https://bigbrauz.com/products/stargazer-stream-chat-widget)。[danmaku-stargazer.js](../../../public/js/overlays/danmaku-stargazer.js) 复用 canonical renderer 的安全文本、头像及 B 站行内表情，再组合紫金渐变圆角卡片、悬角图标、边缘圆点／事件星芒、流星和事件粒子；[stargazer.css](../../../public/css/overlays/danmaku/stargazer.css) 拥有外观与内部动画。Poppins 400/700 已纳入共享软件字体库和 CDN 下载，同一包提供两个字重并保留 `Stargazer Poppins` 族名；来源和许可见 [字体说明](../../../public/fonts/stargazer/README.md)。默认区域 480×700，正文 22px、范围 16–36px，默认两端 14px 渐隐。

普通消息的头像、昵称、本房间大航海和粉丝牌来自真实事件；其他房间 `guardLevel` 不成为本房间身份。昵称旁用文字标记主播、本房间舰长／提督／总督及粉丝牌，紫金底色不表示身份；本地预览样例也提供 `roomGuardLevel` 和 `roomMedal`。右上角的弹幕／礼物／通知只显示气泡／礼盒／感叹号，无可见文字；SC 只显示 `SuperChat` 文本，不带符号；上舰按 `giftGuardLevel` 显示舰长／提督／总督对应的大航海图片标识，复用 `setGuardIcon` 的普通／千舰切换，无文字标签。边缘圆点与星芒只作装饰。礼物／上舰第一行显示发送者和已知身份，下一行显示实际动作、名称及数量，已结算 `giftTotalPrice` 在右侧以小字显示；长内容自然换行，金额缺失显示未知，不推算。SC 显示实际发送者、价格和完整字面正文，并支持原有撤回。色调和循环相位按事件身份固定，快照重绘不换色。样式不创建自己的消息队列、订阅或 JS 循环。

专属参数保存在 `styleOptions.stargazer`，通过公共参数面板、当前账号本机外观与场景发布链路使用。共享光影以 `art` 处理含图标和星芒的透明轮廓，不开放矩形底板内阴影／内发光。字段合同由 `shared/danmaku-style-options.js` 维护并生成本机 Node 镜像：

| 参数 | 范围与默认 |
| --- | --- |
| `stargazerPalette` / `stargazerColor` | mixed、purple、gold、chat-purple、chat-gold、custom；默认 mixed；自定义单色默认 `#c04efe` |
| `stargazerLayout` / `stargazerWidth` | vertical／horizontal，默认纵向；横排每条宽 220–600px、默认 320px |
| `stargazerGap` / `stargazerAlign` | 间距 6–40px、默认 24px；未铺满靠新消息入口 bottom 或旧消息出口 top，默认 bottom |
| `stargazerFrame` | show／hide，默认隐藏 Chat Box 外框 |
| `stargazerPerspective` / `stargazerAngle` | none／left／right，默认平面；角度 0–12°、默认 6° |
| `stargazerGlow` / `stargazerGradient` / `stargazerGradientOpacity` | 霓虹 0–20、默认 8；双边渐变 on／off、默认开启；浓度 0–100%、默认 40% |
| `stargazerMaxMessages` / `stargazerHideSeconds` | 最多 1–50 条、默认 13；保留 0–999 秒、默认 0，0 表示只按区域／数量淘汰 |

公共 feed 的 `flowAxis` 只指定测量和移动轴：默认纵向 `top`，横向使用 `left`；横向两端遮罩沿左右显示，上边／下边分别对应左／右，不改变原纵向样式。feed 根据测量后的内容长度维护 `data-flow-overflow`，旧消息出口对齐仅在内容未铺满时生效，超出后仍让最新消息连续进入可见区。固定消息到期仅在显式 `expireFixedItems` 下启用，沿用事件时间、末段渐隐及销毁清理；后续追加只续接位置，不取消正在进行的到期渐隐。只有排列方式、消息上限、保留秒数改变时重建 feed，其余外观作用于已有消息，动效合同见 [固定弹幕动效](danmaku-motion.md#stargazer-星旅动效)。

### RIPPLOID 固定弹幕

`ripploid` 使用统一的细线、票券和印刷式分层图形，默认区域 480×700，旧布局只补齐缺失区域；支持字体、18–48px 字号（默认 24px）、正文色（默认 `#f5f5f5`）、滚动方向与边缘处理，不提供背景透明度或礼物插画参数。普通聊天保留真实昵称、原文与表情，身份栏依次显示当前房间粉丝牌名称／等级、`UL{honorLevel}` 荣耀等级和当前房间大航海身份，最多三枚徽标。粉丝牌读取 `roomMedal.name` 与正整数 `roomMedal.level`，荣耀只读取正整数 `honorLevel`，大航海只读取 `roomGuardLevel`（1/2/3 对应 GOVERNOR/ADMIRAL/CAPTAIN）；各项缺失或无效时独立隐藏，全部缺失时不保留空徽标栏。不会从 `userLevel`、`level`、`medalName`、`medalLevel` 或 `guardLevel` 推断这些身份。

徽标的 `title` 分别注明当前直播间灯牌、荣耀等级与当前直播间大航海。预览使用合成身份；正式场景使用当前授权房间及场次的消息，切房或场次重置时清空旧消息，新消息重新读取对应身份。服务端仅在灯牌所属房主与当前房主一致时提供 `roomMedal`；`roomGuardLevel` 属于本房间，`honorLevel` 独立于房间。

普通礼物以 GIFT TICKET 显示真实发送者、礼物名、数量和 `giftTotalPrice` 已结算人民币总额，不重复乘数量；未知或非法总额显示 `—`。购买大航海仍是 `kind:'gift'`，由 `giftGuardLevel` 区分舰长／提督／总督并生成 NEW MEMBER 卡，显示真实发送者与可用头像，不编造开通／续费动作或陪伴天数。SC 保留发送者、实际 `price`、完整原文和换行。系统消息使用带标签的紧凑横条；渲染器保留旧进房消息的兼容结构和真实昵称，当前本机消息入口不再投递该类型。不重复渲染普通聊天徽标与身份栏。四类卡片共用 feed 可用宽度，礼物票券、上舰头像裁切区与 SC 对齐右边界，票券与事件区同高；上舰头像本体距右侧 50px，留出三枚菱形装饰的位置。NEW MEMBER 发送者姓名最多显示两行，完整文本仍保留在 DOM。各类消息的入场时间轴及减少动态效果规则见[固定弹幕动效](danmaku-motion.md#ripploid-分层动效)。

聊天配色沿用 `styleOptions.ripploid.bubbleColor`：`default` 保留多色装饰，自定义六／八位 HEX 只统一普通聊天装饰，不覆盖事件卡。事件配色另有 15 个仅接受 `#RRGGBB` 的字段，默认均为 `#f39749`：`giftColor{0,50,100,500,1000,2000}` 按本条礼物已结算总额分档，`superchatColor{0,50,100,500,1000,2000}` 按实际 SC 金额分档，档位均为 `<50`、`50～<100`、`100～<500`、`500～<1000`、`1000～<2000`、`≥2000` 元；`guardColorCaptain`、`guardColorAdmiral`、`guardColorGovernor` 分别对应购买的舰长、提督、总督。客户端和画布在「参数调节 → RIPPLOID 事件配色」直接展示礼物、上舰和 SC 三组颜色，不再嵌入「高级参数」。管理面板、画布参数和独立预览共用逐样式草稿与恢复规则，切换样式会清理这些 CSS 变量，在线正式源仍需匹配的服务端版本。

桌面适配层 `danmaku-message-renderer.js` 装饰普通消息并分流购买大航海，`danmaku-superchat-renderer.js` 分流 SC；结构与图形由 `danmaku-ripploid.js`、`danmaku/ripploid.css` 负责。ADR-0020 固定的 `danmaku-renderer-core.js` 快照不修改，公共 feed 继续负责测量、移动和清理，不新增公开消息字段或事件。

### 星语固定弹幕

`starlight`（星语）为透明白色固定弹幕：普通消息居中显示昵称、细横线与原文，表情保留；礼物左侧显示昵称和内容、右侧显示实际人民币金额，数量紧接礼物名；SC 顶部显示昵称与两位小数金额，正文在下方占满可用宽度，顶部空间不足时金额自动换行。仅此样式接受 `styleOptions.starlight.decorationShape`：`sparkle`（四角星，默认）、`heart`（爱心）、`square`（圆角方块）、`star`（五角星）、`flower`（小花）、`moon`（月牙）、`bow`（蝴蝶结）。缺失或恢复默认为四角星；图案作用于普通弹幕、礼物和 SC 的既有装饰位置，切换时直接更新已显示消息，不重播或改变内容、尺寸和布局。图案由内置 SVG 遮罩绘制，同时提供 `mask` / `-webkit-mask` 与同轮廓 `clip-path` 降级，不依赖字体；装饰动画随图案独立切换：四角星缩放闪烁、爱心双拍轻跳、方块轻弹、五角星缓转、小花轻旋呼吸、月牙轻浮摇曳、蝴蝶结轻摆，昵称与金额旁的装饰错开相位，消息复用固定列表平滑纵向滚动；减少动态效果时停用星光和位移。隐藏头像、身份牌、底色与礼物原图参数，沿用字体、字号、正文色和上下滚动设置。SC 使用白色主题，不套用六款旧样式的价格底板。长昵称与长留言换行，过高单条按现有区域规则整体适配。默认区域为 480×700；旧画布仅补齐缺失的星语区域，其他区域不变。主题文件 `danmaku/starlight.css` 与服务端同名主题一致。

`harbor`（对白）由 `danmaku-harbor.js` 与 `harbor.css` 负责主题结构和外观，默认区域 480×700。普通消息隐藏昵称，圆头像搭配灰色气泡；文字和表情气泡顶部与头像对齐，左上角带向左伸出 0.25em、高 0.35em 的同色三角尾部，底板为尾部预留等宽间距；普通文字气泡最小高度为头像直径的 1.08 倍（约 2.65em），单行正文垂直居中，多行随内容增高，行内表情补偿透明边后与正文视觉等高，独立贴纸保持原尺寸，普通／礼物头像直径为 2.45em，上舰为 2.59em，SC 为 2.52em（均以固定 30px 设计基准计算，不随正文字号改变）；本房间舰长／提督／总督以蓝／紫／红气泡区分，仅采用 `roomGuardLevel`；对应等级的头像框与舰徽共用下述房间人数规则。在线榜前三显示排名牌，`onlineRank` 由 Server 的当前房间榜单快照匹配后投影，Electron 只接受整数 1–3，缺少榜单时不推测。上舰卡使用购买等级、结算总额、明确动作和已知陪伴天数；SC 占满弹幕区域可用宽度，为头像旁昵称／金额上下排列的浅色头部与深色正文区。普通礼物使用简洁通知，礼物名与“× 数量”采用一致字体、行高并保留间距。`styleOptions.harbor.minGiftAmount` 默认 0，允许 0–100000 元、两位小数，只按每条 gift 的 `giftTotalPrice` 过滤（含上舰、等于保留、正门槛下未知金额隐藏），不重复乘数量或影响 SC；快照与增量统一在 feed 筛选，参数变化重建。常规字体、18–48 字号、正文色、背景透明度、滚动方向和边缘处理沿用现有入口。配置与在线榜契约同步维护于 Server 的公开直播画面 OpenAPI；本地预览与正式源均接入。

`prismatic`（流霞）复用固定列表、头像、表情和礼物渲染链路，默认区域 480×700，旧布局只补充缺失区域。普通消息头像直径固定为 83.25px（`2.775em` × 30px 设计基准），大航海购买卡保留专用头像尺寸。上方使用 B 站荣耀勋章、当前房间粉丝牌及大航海图标和白色昵称；当前房间的大航海文字使用逐消息稳定的柔彩混色气泡，普通文字用白色气泡；文字气泡左上角为直角，其余圆角不变，左侧不绘制圆点、菱形、方块或尾部；独立图片/表情内容区透明，礼物用白色条和已结算人民币总额。详情与参考图见[流霞规格](../../../specs/danmaku-prismatic.md)。字体、字号（18–48）、正文色和上下滚动使用公共设置，默认正文色 `#292b32`；不提供底色透明度或礼物原图参数。大航海购买使用居中圆头像、白底昵称和感谢文案的渐变卡：舰长珠光香槟金、提督冰蓝紫晶、总督浓郁玫瑰金，以多段渐变和静态高光形成层次。右下角用粗体白字显示本次人民币结算总额的上半部分，下半部分沿卡片底边裁切；缺失或非法金额省略，不重复乘数量。开通／续费读取明确的 B 站通知动作，未知时显示“感谢支持”；陪伴天数优先使用当次通知的明确天数，否则按绑定房主与观众 UID 读取陪伴榜 `accompany`，缺失时省略，不换算购买月数或使用本地补录。SC 为薄荷至粉色渐变，上方昵称与右侧白色 CN¥ 金额胶囊，下方完整原文与换行；不显示头像和金额旁圆点，保持实际金额。大航海与 SC 卡片均铺满弹幕内容区，与容器左右边缘对齐，沿用现有画布安全留白；正文独立调节，SC 昵称和正文左边线一致、金额靠右。长内容超出可用高度时缩小字号并重新换行，保留卡片宽度和完整文本。感谢卡由主题模块负责，SC 共用 `danmaku-superchat-renderer.js`，普通礼物保持白色条。Electron 事件投影及场景缓冲只保留经过验证的可选 `honorLevel`、`roomGuardLevel`、`roomMedal` 展示字段；大航海感谢另保留可选 `giftGuardLevel`、`guardAction`、`guardAccompanyDays`，后两项仅在有效购买等级下接受。旧消息缺失时隐藏相关徽章，不把佩戴的其他房间粉丝牌或旧 `guardLevel` 推断为当前房间身份。

### 固定样式的 SC 展示

雪狐与月渡花汀的 SC 昵称、正文使用当前样式选择的自定义字体；未选择时保留各款默认字体。SC 金额继续使用样式自己的数字字体，字号、字重和行高仍由原样式规则控制。

收到本场 `superchat-delete` 时，标准弹幕、场景组件和导入 CSS 样式按匿名 `messageId` 找到本地卡片 ID，经 feed 的 `remove(ids)` 定点移除，同时清理消息缓存和待插入帧队列。重复或其他场次的撤回不影响其他卡片；不全量重绘、重播剩余通知。上游下线仅影响展示，历史金额和已存正文保留，不代表退款。旧服务端无 `messageId` 的 SC 保持兼容。

正式直播软件网页源由 LIRA Server 的 `superchat` SSE 事件提供；本机 `/danmaku` 保留入口通过公开 `danmakuFeed` / `danmaku:message` 接收 SC，`/danmaku?preview=1` 用合成 SC 验证同一结构。六种旧式固定样式分别为经典矩形、底部签名行气泡、墨蓝切角面板、居中透明淡紫花结细框与档位色角饰（金额使用 Georgia 旧式数字）、透明完整细框与金额列分隔线和头像伸出、带档位色完整细圆角边框及姓名分隔线的连续底板；DOM 使用独立 `is-superchat/sc-*`，CSS 由 `danmaku/superchat.css` 负责，不复用聊天或礼物正文。RIPPLOID 与仿推特 3.0 在各自主题章节维护独立结构。蝴蝶结默认区域加宽后，普通消息与 SC 的内容宽度上限为 564px，顶部原有花结装饰不随加宽拉伸。

原文与换行通过 textContent 完整显示，金额来自实际 price，不显示固定 SC 标签或感谢模板。六款均显示发送者昵称（`.sc-name`），经典、灵动弹幕和琉璃同时显示头像；金额拆为缩小的 `¥`（`.sc-currency`）和数值（`.sc-value`）；长文换行，单条高于可用区域时整体缩放。颜色优先采用 B 站随消息下发的有效十六进制值；缺失字段按 30/50/100/500/1000/2000 档位回退，2 元有自有色就使用自有色，否则共用 30 元蓝色。价格色不使用普通弹幕身份色或自定义正文色；RIPPLOID 不使用这组 B 站价格色，改用其独立的 SC 档位配置。精确色表与公开字段由 Server `public-overlay-api.md` / `SuperChatEvent` 维护。

本地样例统一由 `public/js/overlays/danmaku-preview-samples.js` 提供，内置样式与导入 CSS 的弹幕预览共用。文本按二次元、模拟真实聊天分池，普通弹幕和 SC 均覆盖短句、36–40 字符长句与复读，所有样例正文（含标点、换行和表情占位文本）不超过 40 个 Unicode 字符。另含单个／连续行内小表情、文字加表情、四种独立大表情（小电视鼓掌／笑哭、免费通用冲鸭／这个好耶），按各自宽高比显示并进入模拟弹幕轮播，以及七种普通送礼通知，模拟总额分别为 ¥0.1、1、13.2、52、100、520、1245，其中 ¥52 的疯狂打call 和 ¥520 的小金人分别覆盖 50～99.99 元与 500～999.99 元区间。舰长、提督、总督各提供开通与续费两条通知，共六条，每条使用独立消息 ID；礼物金额与陪伴天数仅为合成展示值。SC 覆盖 ¥2、30、50、100、500、1000、2000 七档，每档一条，共七条，混合两种语气。开启机器人欢迎且支持 SC 时，每轮共 43 条。图片复用内置样例素材，不请求外部资源；大表情图片取自 B 站登录帐号的直播表情列表，通用表情已核对无需送礼或等级解锁，原图与表情标识记录于 `public/img/overlays/danmaku-previews/stickers/provenance.json`，预览运行时不读取帐号或在线拉取表情。内置预览每轮无放回混播，保留流霞、月渡花汀和青雾的开场顺序；青雾、漫画对白、散落小窗、星尘 2.0、玻璃气泡与郁香海风区域随机，以及沉笺下沉飘窗支持 SC，其他区域随机与飘窗样式过滤 SC，与正式输出一致。样例只引用内置图片且实例间不共享可变状态由 `test/danmaku/danmaku-preview-samples.test.js` 覆盖，每轮播放一次、单计时器与关闭停止由 `test/danmaku/danmaku-local-preview.test.js` 覆盖；样例文案长度与语气分池属于内容维护，不设自动断言。导入 CSS 的复用与正式输出隔离见 `test/admin/canvas-empty-previews.test.js`；真实服务端造型及画布验收见 Server `e2e/overlay-superchat.spec.js`。

昵称池使用 2–16 字符的合成用户名，涵盖短中文、二次元昵称、中英数字混合、下划线／短横线、默认账号风格和 16 字符长名；同一观众的弹幕、SC、礼物与大航海通知复用名字，入场通知也由样例模块提供。长度上限核对自 [B 站个人中心](https://account.bilibili.com/account/setting) 当前昵称输入框的 `maxlength: 16`（2026-10-10），取名内容遵循[官方昵称规则](https://www.bilibili.com/blackboard/help.html#/?qid=310&pid=309)。这些名字仅用于本地预览，不查询账号是否存在或可注册。

## 6.2 游戏叠加层(/games)的弹幕组件

[overlays/games.js](../../../public/js/overlays/games.js) 是游戏入口，只传入会话中的 `session.danmaku`。画我猜的 `#drawDanmakuFeed` 固定声明 `data-style="bubble"`，不读取或跟随弹幕姬的 `danmakuOverlayStyle` 设置；`games.css` 独立实现适合游戏窄栏的五身份气泡视觉，并自动受益于共享组件的安全表情渲染。

你画我猜的 `choosing` 阶段在画布上显示「主播正在挑选」，倒计时显示 `--:--`，画笔工具禁用；主播在客户端确认题词后，收到完整 `game:update` 切换到 `drawing`，收起等待提示并开始本局倒计时。下一题与选词期间重新打开页面也按公开阶段恢复，展示页不读取私有题词列表。

`games-drawing.js` 的直线、矩形和椭圆拖拽在当前手势内复用一份已绘历史底图，每次移动恢复底图后只画当前形状，避免反复重放全部旧笔画。远端追加、撤销、清空、完整快照重绘或画布实际像素尺寸变化会使底图失效，下一次预览重新生成；结束、取消或禁用工具时随手势释放。普通画笔仍沿原增量路径绘制，操作提交和坐标协议不变。

游戏和转盘共用 `socket-client.js` 的连接生命周期。每次连接成功分别从 `/api/games/session`、`/api/wheel` 补齐状态；游戏请求失败按最多 5 秒间隔重试；增量在 HTTP 恢复期间有界缓存并按版本衔接，完整更新使旧请求失效。转盘请求仍最多重试四次，收到更新后丢弃较旧的 HTTP 响应。转盘通过专用 REST 读取和 `wheel:update` 恢复，不假定普通 snapshot 包含转盘状态。现有互动端点保留，页面凭据仅允许 §1.0 列出的本页操作。

聊天增量逐条即时交付；你画我猜比分由服务端按 40ms 窗口合并公开，阶段切换及完整恢复快照包含最新结果。场景父页显式请求 `incrementalParts=1` 后，游戏画布与比分各自确认版本：未变部分不再随每条聊天复制传输。父页为新 iframe 保留完整基线，活动组件只合并同会话、同回合省略的 `canvas/correct/scores`；断线清空、换回合和新会话不会继承旧画布。独立 `/games` 保持原 WS 字段与快照恢复协议。

- `games.css` 将短消息显示为紧凑气泡，长消息按宽度增长并自然换行增高；交错对齐、实时标题栏和 reduced-motion 降级只属于视觉层，不改变弹幕字段或游戏协议。

## 6.3 时钟(/clock)

[shared/clock-settings.js](../../../public/js/shared/clock-settings.js) 是内置时钟样式 ID、默认文案、翻页颜色及外观设置键的共同来源。后端 `clock-contract.js`、场景适配器和时钟 overlay 直接派生所需集合与映射；严格输入校验仍归后端，宽容回退、旧 URL 参数优先级和布局/DOM 仍归 overlay，预览继续使用同一共享定义。

[overlays/clock.js](../../../public/js/overlays/clock.js) 驱动固定 `/clock`
浏览器源，默认首帧使用本页凭据从只读接口 `GET /api/clock/config` 读取已保存设置，并使用
设备本地时区显示当前时间、日期和星期。页面外层透明；横向样式使用 560×190
设计坐标，竖向时间轴使用 220×380，月渡花汀使用 560×360。输出按当前样式的可见内容收紧边界，
仅留每边 4px；装饰卡片保留完整卡面，透明款包含当前显示的时间、日期、时段与装饰。
场景选中框随样式及日期/秒数开关同时调整宽高，保持当前缩放；拖动任意缩放柄时等比缩放，
高度自动跟随内容。保存后的独立浏览器源和场景输出使用相同内容边界。

- 风格参数仅接受 `style=peach|starlight|soda|timeline-horizontal|timeline-vertical|digital|minimal|orbit|flip|moonlit-fan`，
  非法或缺失值回退桃桃便签(`peach`)；前三套分别使用奶油蜜桃兔耳、靛蓝月亮云朵
  与薄荷气泡小鸭。横向刻度和竖向刻度使用无卡片底的细线排版、年份与英文星期，
  其中竖向款适配 240×400 Browser Source（含页面边距）。白字数显(`digital`)
  使用透明背景、白色粗窄数字和细暗描边，上排为 `YYYY-MM-DD` 与英文星期，
  下排为同字号的 `HH:MM:SS`，沿用横向画布。星轨时钟(`orbit`) 使用白字暗描边、
  星形与环绕线，下排为 `YYYY.MM.DD` 和中文星期；翻牌时钟(`flip`) 使用日期/英文星期
  小牌和时/分/秒双数字牌，均沿用横向画布。
- 极简(`minimal`) 使用透明背景、白色粗体和同字号的 `HH:mm:ss`，冒号不闪烁。
  固定隐藏年份、日期、星期、时段与角标；设置面板隐藏日期和角标控件，保留秒数开关与小时制。
  切换到其他样式时恢复其日期和时段显示规则。
- 月渡花汀(`moonlit-fan`) 由 `clock/moonlit-fan.css` 拥有，复用开播主题的银蓝折扇、
  白山茶与流苏原画；月轮提供浅底靛青字与靛蓝底月白字两套配色，显示衬线数字、小号秒数和中文日期/星期。
  外围透明，保留完整装饰边界。小预览与组件画布均可选择，沿用现有日期、秒数和小时制开关。
- 月渡花汀的 `moonMode=light|dark|auto` 对应固定浅色、固定深色和自动交替，默认 `light`；
  `moonIntervalSeconds` 为 1–86400 的整数秒，默认 30。只有自动交替显示间隔控件。
  自动配色按设备 Unix 时间的间隔段奇偶计算，复用秒调度器；相同间隔的预览与正式输出同步，
  隐藏恢复或重复设置消息不重置相位。两项 URL 参数独立覆盖保存值，旧配置和旧独立场景缺省补足 light/30；
  显式非法值拒绝保存，读取非法存量值或 URL 值时回退默认值。其他样式不使用这两项外观参数。
- 翻牌颜色为 `flipFrameColor` / `flipFaceColor` / `flipTextColor`，对应外框、牌面、数字，
  接受 `#RRGGBB` / `#RRGGBBAA`；默认 `#e4e4e4` / `#ffffff` / `#303030`。参数覆盖保存配置时独立合并，
  非法颜色回退默认值。设置面板提供经典白、石墨黑、香芋紫预设及三个自定义颜色选择器。
- `date=0|1`、`seconds=0|1`、`format=12|24` 控制日期、秒数和小时制；非法值
  回退默认显示日期/秒数与 24 小时制。`label` 合并空白并截到 16 个 Unicode
  字符，始终通过 `textContent` 输出；透明时间轴、白字数显、极简、星轨、翻牌和月渡花汀不显示角标文案。
- 时钟按下一秒边界使用一次性 timeout 更新；页面隐藏时停止调度，恢复可见后
  立即校时。冒号、星点与月渡花汀流苏动效在 `prefers-reduced-motion: reduce` 下停用。
  翻牌由 [clock-flip.js](../../../public/js/overlays/clock-flip.js) 持有上下半牌与 WAAPI 动画，
  仅数值变化时旋转；首次展示、隐藏字段/页面和减少动态效果时直接校准。
  重入动画和切换样式取消旧动画，复用同一个时钟调度器。
- Admin 组件页的「时钟」卡片只展示并复制固定地址；表单修改经受 token 保护的
  `POST /api/settings` 显式保存。小预览与公共窗口使用 `componentPreview=1` 及父页消息，
  不读取正式配置流；小预览额外使用 `previewFit=contain`，按容器宽高等比缩放并居中，
  切换样式不继承画布编辑器的缩放比例，也不向父页请求改尺寸；白字数显、极简与星轨的小预览使用深色棋盘底。
  打开公共窗口时卸载小预览，关闭后恢复。样式切换使用 160ms 淡入，
  减少动态效果时停用，不重载页面或重启计时器。旧完整参数内嵌预览消息仍兼容。
- 正式来源使用 `createOverlaySocket()` 接收 clock scope 的展示设置键；重连回读配置，
  晚到 HTTP 不覆盖新快照。旧 URL 显式参数逐字段覆盖保存设置；配置更新复用同一个计时器。

### 时钟与弹幕的逐样式效果

外部网页的 DOM 适配由 [overlays/browser-source-frame.js](../../../public/js/overlays/browser-source-frame.js) 拥有，管理页预览与正式 scene renderer 共用 `configureBrowserSourceFrame` / `disposeBrowserSourceFrame`，分别在重配置和卸载时释放效果控制器；`shared/scene-browser-source.js` 只保留纯配置规范化，不反向依赖 overlay 运行时。

`component-style-parameters.js` 拥有纯参数范围、默认编辑值、能力表与校验，`component-style-effects.js` 拥有效果节点、原属性恢复、动态消息观察和释放；本机场景使用客户端合同，旧服务器镜像仅属于其兼容在线源。配置新增可选 `styleParameters` 映射，键为预设名或 `css:<uuid>` / `media:<uuid>` / `resource:<uuid>`；浏览器源使用 `web:<uuid>` 或 `browser`，最多 64 个档案。映射沿用组件外观的归属：内置公共参数及资源型样式按同一样式共享，导入 CSS、普通图片/视频与外部网页按实例保存。缺少某组沿用作者样式，空样式对象恢复该款新增效果；原有 `styleOptions` 保持独立。

效果目标按具体预设区分文字、底板、透明图案和月轮；白平衡、色阶与亮部辉光保持 alpha，旋转/倾斜与原缩放、入场、翻页及飘窗移动组合。重配置先恢复原属性，再应用新样式；销毁时清理滤镜、观察器和监听。导入 CSS 沿用原生或 BLC/blivechat 已知结构；隔离 HTML 只提供 CSS 整体外投影、外发光、矩形边框、变换，不提供跨框架 SVG 调色。

公共 `transform.perspective` 范围 400–4000px、默认 1000px，缺少字段的旧配置沿用 1000px。绘制与 `componentEffectBounds` 共用 `effectTransform`；不另建样式私有透视。编辑器将现有 `transform.rotateY` 显示为「左右透视」，范围 −80°–80°、默认 0；0 为正面，正数左近右远，负数左远右近。它只修改 Y 轴角度，不附加 Z 轴平面旋转，旧的左右侧倾预设已移除；`rotateZ` 以「平面旋转」独立显示。原有字段、手动角度与逐样式保存规则保留，不新增另一套变换或迁移已保存的自定义角度。

固定弹幕编辑器将同一组 `transform` 控件放在「高级参数 → 固定弹幕通用参数」，与外观效果的调色、光影分开；按 `DANMAKU_STYLE_OPTIONS` 的样式分类判断，Glowy / Stargazer 内部横排仍属固定款。切换分类时移动原控件，不重复创建或订阅；通用控件沿用现有校验和保存通道，固定款的「恢复当前样式效果」保留 `transform`，其余效果及欢迎显示开关按原规则清空。其他弹幕、时钟和网页源保留原变换入口与效果重置语义。

弹幕的 `showEntryMessages` 为兼容保留的持久化键，位于当前样式档案内，默认开启（缺省等同 true，显式 false 关闭），界面名称为「显示机器人欢迎弹幕」。`danmaku` 的可选布尔 `isWelcome` 由服务器按实际欢迎发送任务匹配 B 站回流后生成，主进程严格校验并由本机缓存保留；只有该标记为 true 的消息受此显示开关控制。首次欢迎和二次问候均覆盖，开关不改变 B 站发送；普通聊天、其他机器人回复及礼物/SC 保持原有规则。当前本机场景、单组件源与导入 CSS 不再显示原始 `entry` 提示，旧服务器缺标记时继续将消息作为普通弹幕展示，旧在线源保留自己的兼容行为。预览使用机器人欢迎样例，不连接发送接口。新增参数沿用场景和预览保存通道，时钟默认设置由 `clockStyleParameters` JSON 保存；本机弹幕由账号外观档案保存，旧服务器在线源仍使用其租户 overlay-settings。用户参数表与兼容边界见[外观效果指南](../../guides/component-style-parameters.md)。

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
配置、CSS、素材及效果应用完成后直接回传 prepared，不等待 `requestAnimationFrame`；隐藏的直播浏览器源可能暂停动画帧。资源错误仍报告 status，不能以“已加载页面”代替素材就绪。
关闭释放数据订阅、观察器、监听和 iframe；检查底色与适配缩放不进入保存参数。

「点歌 → 浏览器源 → 直播场景 → 编辑场景」通过 `component-preview-registry.js`
惰性加载四个 owner，并在系统浏览器打开 `/c#…`（兼容 `/component-preview`）。首次为空，之后恢复已保存布局；
已有场景不等待弹幕配置加载；仅首次创建时等待其画布尺寸。
单组件预览入口会添加或选中该组件。需要新增共享图层时，桌面通过现有尺寸接口读取保存值，
由短入口解析结果把初始尺寸传给预览页；没有保存值才使用组件默认尺寸。
同一 canvas 会话的组件、实例和场景切换复用同一个短入口，客户端串行更新最近选择后定位已有网页；恢复草稿的 draftKey 随场景变化，入口能力不随之变化。已删除实例或另一场景的旧选择回落到当前画布。能力的有效期与鉴权仍见 [API 注册表](../backend/api.md#浏览器组件预览)。
顶部「添加组件」通过小窗按类别
展示已有样式；“套装”入口按已导入的包显示名称、数量和样式卡片，点击卡片添加对应组件。
样式卡片使用 8:5 预览舞台并等比容纳图片；只有一款时适度放大、最大宽 480px，弹幕筛选结果及无图文本框保持紧凑布局。全屏礼物感谢的礼物掉落、礼物摇摇乐使用实际播放器截图作为内置示例图，分别为 `public/img/component-previews/gift-frame-gift-drop.webp` 和 `gift-frame-gift-swing.webp`，随客户端交付，无需导入样式包。背景读取成功但没有素材时显示导入指引，读取失败仍显示错误。
套装成员来自本机已安装包的 styles 数组，按包分组显示；初始不再提供月渡花汀卡片。清单允许可变种类、数量和同类多个样式；分类页与套装页读取同一个库。

导入后，“背景”分类和套装提供月渡花汀静态/动态两种背景。`background` 复用独立组件注册，`style` 默认为 `none`，导入后可为 `moonlit`（静态）或 `moonlit-animated`；新增时按当前画布宽高铺满并放在最上层；作为底图时需将图层拖到组件栏最右侧，之后可移动、缩放、隐藏和调整层级。`overlays/background.js` 先接入预览协议，再根据配置映射并解码图片；动态版由 `background-moonlit.js` 延迟加载并播放 `img/overlays/backgrounds/moonlit-loop-hq-60.webm`：同画风重新绘制底景、月亮、柳叶、灯笼、云雾与花瓣，逐枝节/逐叶动画和重新绘制的水纹、倒影离线以 3840×2160 缓冲抗锯齿合成并输出 2560×1440、60fps、24 秒无声循环；素材保留软 Alpha，原始 RGBA 帧直接编码，底景原画仍为 1672×941。运行时不再切条扭曲图片，也不需要 Canvas RAF。视频开始播放前或加载失败时保留原图；隐藏页面时暂停并保留进度，销毁时移除视频源与监听器，减少动态效果时显示静态原图。`background.css` 默认使用等比覆盖，非 16:9 容器居中裁切；可通过背景外观参数改为完整显示或拉伸。静态资源仍为 `img/overlays/backgrounds/moonlit.webp`，不修改开播动画底图。模板保留样式与本机资源映射，无业务数据；迁移到另一电脑需要连同素材库一起迁移。

新建图层独立选择样式；右侧公共显示参数与客户端及同样式实例共享，首次采用客户端已保存值。普通媒体/CSS、外部网页与没有客户端对应项的配置保持原 owner。公共分辨率预设/自定义尺寸独立于组件，
图层默认以预定大小居中，窗口改变只影响查看比例。编辑页采用浅色控件与灰色工作区，画布自动适配且不滚动；
画布设置、撤销/重做、预览底色、保存、放弃和复制集中在顶部紧凑工具栏，已有图层在画布下方横向排列。撤销使用 Ctrl+Z，重做使用 Ctrl+Y 或 Ctrl+Shift+Z；焦点在文本输入或富文本编辑器中时保留其原生快捷键。
画布设置中的场景名称输入框 `maxlength=10`；复制场景时保留原名称前至多 7 个 UTF-16 单元（不拆开代理对）并追加「 副本」，沿用输入框的长度口径。已有场景文档的读取与存储格式保持兼容。
直接入口默认收起参数，画布设置与图层按钮可展开右侧面板；折叠保留选择、参数和草稿，隐藏字段校验失败时重新展开。
在画布中选择或拖动不会自动展开面板，避免拖动中触发缩放。参数与图层列表按需独立滚动。
所有组件都可部分移出画布，X/Y 可为负数；每个组件在画布内至少保留 24×24 逻辑像素，拖动、多选、缩放与保存遵循同一边界。越界内容由编辑器画布及正式组合展示页裁切，不改变组件内部排版；自动高度或共享尺寸更新不会把仍满足最小可见范围的组件推回画布。几何契约见[场景规格](../../../specs/component-scenes.md#scene-document)。

「保存并应用」只等待场景及其引用的共享外观 owner 的网页编辑得到客户端确认，批量保存并再次核对后发布组合画面；原生时钟、队列、弹幕和加班机的独立实例也参与对应公共 owner 的保存，无关默认配置不保存。
场景输出每次读取均返回按已发布可见 item ID 投影的 `appearances`，即使版本未变、`document` 为 null；隐藏图层重新显示并发布后读取当前外观，单组件输出仍将目标强制设为可见。渲染器原地更新配置，不重建 iframe、不重播礼物事件，也不带入未发布布局。
「放弃修改」还原画布及本次编辑涉及的公共 owner 的未保存草稿（含已移除图层），保留无关组件草稿；已经自动保存的公共参数不会回滚。
展示板及画布以百分比显示背景不透明度，持久化值仍为 0–1。

参数区仅在 `sharedAppearance.getState(item)` 提供自动保存 owner 时标为即时生效；内置时钟、点歌板、弹幕姬和加班机的公共参数仍是控制器草稿，随保存并应用生效。位置、尺寸与图层仍需保存并应用。组件面板的画布入口优先选中对应已有图层，没有时加入未保存图层。
参数区的保存状态明确标为「公共参数」，与顶部场景的未保存、当前输出状态分别呈现；公共参数没有未保存修改不代表场景布局已保存或应用。画布时钟的克隆参数面板以「当前样式」下拉切换内置样式，保留原参数与外置素材入口，不重复陈列整组样式卡片；客户端原样式选择器保持不变。
部分保存失败、冲突或未完成草稿会停止发布，保留之前的直播布局；已经成功保存的共享外观继续生效。客户端浏览器源中的
`canvas-overlay-source.js` 与网页按钮共用 `scene-source-url.js`，自动读取并显示首个已绑定场景的已发布地址，
点击地址区域即可复制；未发布时提示先编辑并应用。进入浏览器源页、返回客户端或账号/在线来源改变时重新读取，
来源改变立即清除旧地址；读取与复制不创建或发布场景。编辑会话能力与持久输出能力不同。

独立组件来源 `/clock`、`/queue`、`/overtime` 和 `/danmaku?source=component` 可直接复制使用，
无需打开场景编辑器、创建或发布场景。它们使用已保存的公共外观，与画布内同样式参数同步；显式 URL 参数继续覆盖对应字段。
其他固定来源按本页 §1.0 的 scope 读取其领域配置及真实数据，不继承当前选中图层的独立配置或预览示例。
独立图层使用 `/scene?id=…&item=…#token=…`，只输出该图层并归零位置；导入样式、背景和文本框复用此来源。
本机弹幕的 `danmaku-component-source.js` 与场景共用 `display-source.js`，通过 `/api/danmaku/events`
获知变化后读取 `/api/danmaku/display`；通知健康时五秒校验，断开时回退 750ms 读取。
复用已有云展示缓冲、样式渲染和 canvas 坐标逻辑；不建立本地旧弹幕 WS 或第二条上游 SSE。
首次按 epoch/cursor 建立读取基线，不生成示例；同场短暂断线、读取失败或游标缺口保留已显示弹幕，恢复后继续追加且不重复开播确认。确认下播、换场、换账号或授权失效才清空。旧 `/danmaku` 本地 WS 行为兼容保留。

队列预设、默认值和样式切换只修改草稿；保存提交所有已编辑样式键和最终样式。
队列预览使用样例歌曲和同一渲染器，历史共享主题键仍影响跟随主题的歌单板。
画布中的点歌板按当前样式的实际面板尺寸自动收拢边框，高度只读、拖动等比缩放；
身份版仍不超过原始设计大小。编辑时按宽度计算内容高度，避免旧框高度反过来限制面板；
发布后的来源继续按已保存矩形完整容纳内容。透明样式不继承经典款的背景模糊设置。
加班机页面已移除内嵌 iframe，保留紧凑运行状态、初始时长/外观分栏及通栏规则。
其公共窗口默认显示实际倒计时，小时/分钟/秒、启停和开始/暂停通过 overtime 会话中继到客户端原 `/api/overtime/time`、`/api/overtime/action`。操作立即保存并回填两端，替换非零剩余时间前确认；失败保留时间输入。运行/暂停/结束/未启用示例只供查看，没有修改示例时间的按钮。
来源切换清理动画并重置 revision 基线，外观草稿保持；外观保存仍只向原 config 接口提交 `{path, fit}`，时间和规则不进入场景配置。

组件扩展由各环境的显式定义负责：`shared/scene-components.js` 持有前端稳定类型、顺序、
缩放轴、内容高度、子 renderer/默认来源 URL 和断线重置能力；
`admin/component-preview-definitions.js` 组装纯工厂及样式选择适配。被动 registry 只接收桌面
owner 注册，未知类型立即报错，不反向导入工厂或 owner。`clock-preview.js`、
`danmaku-preview.js`、`queue-preview.js`、`overtime-preview-factory.js` 不读取桌面状态；
桌面、浏览器会话和离线恢复分别注入数据 provider。舞台优先消费 `startLayerData`，否则使用
组件的 `startData`；加班机的多个实例共享一次 provider，最后一个图层释放时停止。

后端 `src/shared/scene-component-types.js` 定义渲染类型，`server/scene-components.js`
的 ports 复用领域配置校验、默认配置及显示投影；`server/component-preview-page.js` 保留
显式 HTML 片段 allowlist，弹幕预览复用 `pages/admin/live-components/danmaku.html` 的画面参数，不包含百宝箱的发送与机器人表单。中继与默认配置草稿缓存保留四个共享类型和 `canvas` 控制类型，不把 canvas 作为可渲染组件。
`shared/scene-extra-components.js` 定义开播动画、展示板、歌词、三类小游戏、全屏礼物感谢、大航海感谢、礼物滚动、盲盒榜、许愿的独立参数与选择项；
`admin/scene-extra-preview.js` 直接在画布中创建参数面板，其修改由场景 owner 保存。
展示板的示例歌曲分类跟随各图层的分类筛选，正式来源仍筛选实际歌库，不写入示例歌曲。兼容 blivechat/blc 的导入弹幕 CSS 在编辑预览中持续补充示例，避免退场动画后永久空白；页面隐藏时暂停，销毁时停止，正式来源只消费直播事件。
小游戏画布由 `admin/component-preview-canvas-controller.js` 配置公共 `canvas-data-poller.js`，在客户端每秒读取当前公开对局，沿现有预览会话传给游戏子页；不再使用固定示例局面。
`overlays/games.js` 按实际棋盘字段复用数字炸弹按钮、五子棋按钮及坐标；相同完整快照不重建节点或重复绑定点击。落子、范围、回合和胜负变化仍更新棋盘，标题、结果、外观及你画我猜倒计时沿原路径更新。
小游戏和开播数据由画布控制器复用 `admin/canvas-data-poller.js` 的单请求轮询、超时及销毁取消；按画布组件类型决定是否请求，读取失败清空本次投影。
没有匹配对局或读取失败时，编辑画布显示等待开局，正式来源仍隐藏未进行的游戏；开始、落子与绘画继续由「直播小游戏」管理。
新添加的数字炸弹、五子棋、你画我猜分别默认 800 × 360、600 × 600、1280 × 720；五子棋棋盘按组件视口适配，已有图层保留保存的尺寸。
礼物许愿的组件选择与展示样式均支持「月渡花汀」（`moonlit`）。独立浏览器源与场景画布共用
`shared/gift-wish-card.js` 渲染入口；同一条月渡花汀许愿更新时保留卡片节点，使进度过渡和装饰动画连续。
画布内置「流光彩带」（`ribbon`），适用于普通礼物和大航海。`shared/gift-wish-ribbon.js` 负责图标、礼物名、已收/目标与流动斜纹；同一许愿更新时保留节点，填充封顶 100%，计数仍显示实际数量。外观保存在场景图层，不写入服务端许愿定义，正式输出使用发布后的场景地址。
彩带字段由 `shared/gift-wish-ribbon-appearance.js` 声明并沿既有场景校验保存：`ribbonColor`（填充，`#ee87ac`）、`ribbonTrackColor`（未完成底色，`#fee6fb`）、`ribbonBorderColor`（边框，`#ffffff`）、`ribbonTextColor`（文字，`#ffffff`）、`ribbonOutlineColor`（描边，`#4b494b`）；`ribbonHeight` 为 40–120px（默认 68），`ribbonFontSize` 为名称字号 12–48px（默认 26，兼容原统一字号），`ribbonSpeed` 为 0–20 秒的流动周期（步长 0.5，默认 2，0 为静止）。`ribbonDecorationStyle`（「右下角装饰」）可选 `none`（无）、`pastry`（默认，原奶油条）、`bow`（蝴蝶结）、`sakura`（樱花）、`candy`（爱心糖）、`star`（流星）。旧开关 `ribbonDecorations` 保留用于读取已保存场景，`false` 仍隐藏装饰；参数面板以款式下拉项统一控制显示与造型，切换时同步该旧开关。四款新装饰使用随客户端交付的 `public/img/shared/gift-wish-ribbon/*.webp` 透明素材，预置倾角并按条高适配，底部预留空间以避免遮挡数字或裁切；切换款式复用卡片、斜纹与装饰节点。参数仅在彩带样式下显示；系统请求减少动态效果时停止条纹和进度过渡。
`ribbonBorderWidth` 为 0–12px（默认 8，0 隐藏边框），`ribbonRadius` 为 0–36px（默认 10），`ribbonStripeWidth` 为条纹横向粗细 4–24px（默认 10，循环纹理尺寸为两倍），`ribbonFlowDirection` 为 `normal`（默认，向右）或 `reverse`（向左）；`ribbonNumberFontSize` 可独立设置为 12–48px，缺省或空值时跟随名称字号，沿用旧配置效果。参数面板分为「彩带外观」「文字与数字」「彩带动效」。为保持短条比例，实际边框不超过条高的 18%，圆角不超过条高的一半，图标不超出内框或组件内容宽度的 16%；名称和数字的实际字号同时限制在条高的一半及可用内高的 72% 以内，描边随各自字号缩放。数字还按字符数量适配组件宽度，完整显示长计数；名称使用剩余空间并保留完整名称提示。宽度或可用空间不足时，实际字号可低于输入字号。
文字版的 `textPendingColor` / `textReceivedColor` 由每条许愿拥有，场景组件直接使用许愿投影中的颜色，随已保存设置及 `todayCount` 更新。画布不再提供整层颜色覆盖；旧场景中的同名字段仍可读取和保存，但不参与渲染，避免覆盖客户端设置。文字片段的显式配色仍按原规则优先于状态色。
许愿画布由 `admin/gift-wishes-canvas-data.js` 读取已保存的许愿，保留实际周期、内容、进度和每条文字颜色；周期及完成项过滤与正式输出相同，没有许愿时提示客户端添加。`shared/gift-wish-client.js` 按接口地址共用一次可取消的三秒轮询，客户端许愿页和画布订阅同一数据，保存后的主动刷新同时更新两端；最后一个消费者退出时取消读取并清除缓存。多个图层不增加请求，切换到无许愿的场景释放订阅；失败清空画布旧内容。「显示条数」默认 1，可设为 1–30，不复制条目补足数量。原生样式按内容测量高度，画布外框与参数中的自动高度一起更新，高度不超过场景画布；素材装饰保留自定义尺寸。月渡花汀在 640px 宽时的单条初始高度为 143px，旧套装尺寸由客户端实测纠正。
外观与动态效果规则见[前端页面](pages.md)。
`gift-frame` 和 `guard-thanks` 是两个独立图层，分别通过 `/gift-effects?giftComponent=frame`、
`/gift-effects?giftComponent=guard` 的无凭据组件模式复用现有播放器，只消费父页传入的对应事件。
礼物姬预览入口直接打开并选中对应画布图层。固定 `/gift-effects` 来源仍由「点歌 → 浏览器源」和礼物特效工具提供，消费已启用的内置动效、林间花信、官方礼物特效及普通大航海感谢；导入的图片/视频感谢样式与航海旗帜使用对应图层的 `/scene` 单组件地址或组合场景。
大航海感谢添加窗提供「辉光」「经典」两张独立卡片，以 `appearance.config.style=aurora/classic` 保存图层风格；各原生图层只播放对应风格的实时事件，预览按图层风格渲染。旧配置缺少 style 时归一为 `follow`，继续使用事件风格；普通媒体样式维持原事件消费行为，航海旗帜资源组件只消费上文的 nautical 专属事件。
大航海感谢参数面板的动画风格属于持久化外观；预览等级（舰长/提督/总督）、观众昵称和月数（1–999）仍为示例参数，修改后立即重播，
客户端礼物姬填写的这三项参数随预览入口带入画布并回填；持续轮询不覆盖画布中随后修改的值。
切换等级、动画风格、动画文字或图层选择时保留本页预览输入。等级、观众昵称和月数不写入场景配置，直播仍使用真实上舰事件；礼物姬预览选择对应风格的内置图层，不存在时新建，不覆盖另一风格或本机素材图层。
编辑样例每八秒重播，正式来源无样例。`server/scene-gift-events.js` 从既有礼物显示事件接收最多
200 条按账号 scope/epoch 隔离的投影窗口；`scene-gift-display.js` 在父页按序列去重、暂存准备期事件。
新版父页显式请求 `incrementalParts=1` 并确认 `dataVersions` 后，未变化礼物窗口不再重复复制和传输；版本存在但正文省略时保留游标及待播事件，真正移除该类型才清理。旧页面继续取得完整窗口。
首次打开、账号代次变化及断线恢复只建立当前基线；已交付事件不会在重发布时补播，子页断线清空队列。
这些类型不接受 `appearance.mode=shared`；公共显示参数仍按上文的 owner 共享，不创建独立默认配置会话，也不扩展 `component_output_sizes` 的四类型约束。
月底冲刺 `gift-sprint` 使用 600 × 80 的独立实例与空外观配置，在组件库的「礼物许愿」分类中添加；编辑画布展示示例进度，正式来源使用当前 `giftSprint` 的投影。管理端将冲刺收进「礼物许愿」顶部折叠区，许愿与冲刺的「打开画布」分别选中对应组件。金额目标和重置仍由「礼物 → 月底冲刺」管理，模板不携带目标或进度；原独立投屏地址保留。
`server/scene-extra-display.js` 复用现有领域读口和 overlay 投影；礼物慢读按账号代际、来源版本和日期共享五秒缓存。`getDisplayData` 在本次调用内按需共享一份本地状态快照，点歌板、加班机、歌词和冲刺投影共用该读口；仅含云弹幕或独立领域组件时不读取完整本地状态。下一次调用重新读取，不建立跨请求状态缓存；公共外观读取仍沿用自己的 owner。
输出异步完成后再次核验账号和场景能力；原展示页的组件模式只接收父页消息，不启动自身 HTTP/WS 数据请求。
礼物与小游戏头像按现有 HTTPS B 站图片白名单直接读取，不向子页下发访问凭据。
新增类型需通过前后端定义、独立参数、模板和保存/发布一致性测试；若将来扩展共享默认尺寸类型，
已有数据库必须追加迁移，不能改写已执行的 v9 建表函数。

场景 HTTP 访问由 `scene-api.js` 提供，`scene-item-controller.js` 只适配文档实例与默认外观。
画布会话在 `component-preview-canvas-controller.js` 中持有 revision、冲突与发布状态，
保存复用 `component-save-batch.js`。旧工作区和旧场景编辑器入口及其专有会话、模板界面已移除；
当前画布继续复用场景文档模型、stage、inspector 和模板数据契约。
stage、inspector 和画布视图的只读路径使用模型的冻结快照及快照订阅，避免每个消费者重复深拷贝；编辑仍通过模型草稿与手势历史提交。

### 心动盲盒收集组件

`/heart-box-collection` 与场景类型 `heart-box-collection` 由 `shared/heart-box-collection.js` / `css/shared/heart-box-collection.css` 共用渲染。`displayStyle=task` 为粉色四档任务卡，`compact` 为深色紧凑进度；默认视口宽 620，内容高度随样式及奖励显隐自动测量。标题显示本期真实累计和下一档目标；累计为 0 时隐藏进度轨道与「已收集」标记，保留未解锁目标节点和可选奖励。有收集进度时，粗轨道穿过圆形数字节点，已达成节点附勾、未解锁节点带锁，粉色款在轨道起点显示「已收集」。全达成保留超额数量。周五标注「收集已结束」，保留最终结果。

布尔展示字段 `showRewards` 默认 `true`，两种样式均可关闭下方城堡、倍率和限开数量，标题、进度与节点保留。组件底部在所有收集状态下均不显示提示文字。独立 URL 使用 `showRewards=false`（或 `0`）关闭；管理页开关同步本页预览与复制地址，画布中的开关随该图层保存，旧场景缺字段时补默认值。标题与四档奖励分别使用实际心动盲盒、同一张浪漫城堡图片，静态透明 WebP 随组件打包在 `public/img/heart-box-collection/`，来源及转换摘要见该目录 `sources.json`；不依赖运行时礼物目录下载。

管理菜单显示真实数据；画布以 37 / 40 的示例展示四档，正式场景由父页传入当前授权来源的只读投影，子页不另发请求或开连接。独立浏览器源复用许愿 feed 的单个可取消轮询及 scoped socket；来源变化清除旧画面，离开管理页停止轮询。服务器周期与解锁规则见 [每周任务](../backend/bilibili/gift.md#心动盲盒每周收集)，无需创建普通许愿或配置手动重置。

## 7. 数据消费一览

| 叠加层       | 首帧                                                                 | 实时                                        | 去重指纹                                | 触发重载的 reason                                              |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| queue        | `/api/state`                                                         | snapshot                                    | current+waiting+SC+全部主题键           | `queue:add`/`bilibili:danmaku`/`bilibili:superchat`(80ms 强刷) |
| songs        | `/api/state` + `/api/songs`                                          | snapshot                                    | orderKey/layoutKey/motionKey            | `songs:*`/`cloud:songs`/`database:clear`/`database:clear-all`(220ms 重载) |
| blindbox     | `/api/state` + `/api/gifts/blind-box-stats`                          | snapshot(即时设置)+ 轮询                     | 统计内容相同保留节点                    | `bilibili:gift`/`gift:sprint:reset`/`connect`                  |
| overtime     | `/api/state`(overtime 字段)                                          | snapshot + `overtime:update`                | `revision` 单调比较                     | `overtime:update` 的 adjustment → 动画入队                     |
| gift-effects | 无触发事件时透明；snapshot 同步官方特效开关 | `gift:frame` / `gift:effect` / `gift:guard-thanks` | 各播放器按 `eventId` 去重；并行动效与串行队列分开，见 §1.4 | 新事件交给对应播放器；刷新不重播历史 |
| opening      | `/api/opening/config`                                                | 无                                          | 无；首帧配置经枚举/文本清洗             | 页面加载一次；Admin 预览可由 URL 参数覆盖                      |
| clock        | `/api/clock/config` + 设备本地时间；URL 参数可覆盖 | clock scope settings snapshot + 秒边界定时器 | HTTP 修订保护；单一计时器 | 初始读取及重连；快照原位更新 |
| lyrics       | snapshot 中的设置、状态和时间轴                                      | `lyric-state` + `lyric-timeline` + snapshot | 当前行与时间轴内部去重                  | 播放页按状态变化推送                                           |
| danmaku（本机组件） | `/api/danmaku/display` 的 config 与 data | `/api/danmaku/events` 通知后按 epoch/cursor 增量读取，断线回退轮询 | 同一缓冲的 cursor、直播 session 和 reset | 同场断线保留已有消息；确认下播、换场或授权变化清空 |
| danmaku（旧 URL） | snapshot 中的 `danmakuFeed` | `danmaku:message` | 有 id 时按 id；兼容消息按 uid+时间+正文 | 无 reason 重载；断线重连后由 snapshot 恢复 |
| games        | `/api/games/session`                                                 | snapshot + `game:update` + `game:patch` + `game:draw`      | 游戏入口调度器按更新频率合并渲染        | `game:update` / `game:patch` / `game:draw`                                    |
| wheel        | `/api/wheel`，连接成功后补读并有限重试                               | `wheel:update`                            | 状态/抽取 ID 与读取代次                 | 每次 WebSocket 连接成功                                      |

消息类型与 reason 的全集定义以 [ws.md](../backend/ws.md) §3 为准;本表只描述各叠加层**消费**哪些。

歌词性能策略由 `shared/lyric-performance.js` 持有：连续四个超过 45ms 的调度帧减少装饰效果（逐字轻跳、非当前行模糊等），连续填充仍由浏览器 WAAPI 时间轴推进，不因慢帧改为手动刷新或整词跳亮；用户选定的按字点亮模式保持不变。连续 30 个健康帧后恢复完整效果，每次切档重新计数，长帧打断健康计数，恢复后再次卡顿仍按原门槛减少效果。状态直接重绘传入的零间隔不计为健康帧，系统减少动态效果时保持静态与低效果，不自动升档。`shared/lyric-frame-scheduler.js` 的 30fps 门控比较保留 0.5ms 时间戳精度容差，避免将浏览器取整后的 33.3ms 跳过至下一帧；传给性能策略的间隔仍是实际测量值，不截断长帧。`lyric-word-animator.js` 只为正在填充的词保留高亮动画，暂停和跳转仍校准到播放位置；不支持 WAAPI 时连续填充回退为手动更新，系统减少动态效果时的静态模式仍按词的结束时间点亮。opening 使用 HTTP 配置接口，不订阅快照 WebSocket；clock 同时消费受限配置快照。


## 本地场景浏览器来源

输出以保存的 CSS 像素显示，`scene-renderer.js` 不再按宿主视口缩放整套场景。
选中独立组件后点击「组件地址」（无障碍名称「复制组件地址」）使用 `/scene?id=…&item=…#token=…`，服务端直接投影
已发布实例到 (0,0)，宽高、样式与整套场景中的这一实例共用同一份配置。
共享默认图层的单组件按钮复制原 `/clock`、`/queue`、`/overtime` 或
`/danmaku?source=component` 地址；这些页面通过 `component-output-size.js` 单路读取
当前账号保存的输出尺寸，限制页面及内容布局，不受 OBS/直播姬视口分辨率影响。
该读取复用各自 overlay 身份，不在预览或场景子 frame 内运行；无保存尺寸时保留原行为。
请求不重叠，结束后间隔 750ms 重读，8 秒超时，页面释放时取消请求和定时器；超时通过普通定时器触发 `AbortController`，不依赖浏览器源提供 `AbortSignal.any/timeout`。
原点歌板/时钟缩放算法此时以保存的矩形为可用区域；加班机以保存宽度排版、使用已测量高度。

当前入口和操作见上方组件系统说明。直播场景使用既有 scene 文档、保存与发布 owner；模板导入导出、多选等旧场景编辑器能力保留在其模块中，不作为当前网页入口已提供的功能。

本地直播场景使用 `/scene?id=<UUID>#token=<secret>`。网页点击「保存并应用」更新完整来源；确认删除当前输出场景也会切换到剩余已保存场景，删空则输出透明空画面。布局和资源身份变更需要再次应用；共享外观参数保存后同步到当前输出。OBS 与哔哩哔哩直播姬使用同一浏览器源，尺寸设为场景画布尺寸。输出中未放置组件的区域透明，包含可见组件的实际数据，不含编辑控件、检查底色或示例消息。关闭编辑网页后仍能从本地运行时加载、刷新和接收更新。
复制提示使用已发布场景或独立图层的实际宽高，不使用正在编辑的草稿尺寸；原默认组件地址的尺寸由既有组件尺寸接口读取。文本框单组件复制同样显示已发布尺寸。

`scene-renderer.js` 为可见实例创建无凭据的沙箱子 renderer，全体准备成功后替换整套；准备失败保留旧版，旧版仍接收数据。同版本不重载。父页把投影回执与已成功显示版本一起提交，准备失败时继续请求旧版所需类型；回执不传给子页面。首次没有弹幕消费者时保留最多 200 条待投递事件，空批次不覆盖增量，溢出设置 gap 并保留最新事件；展示 epoch、直播场次或 reset 变化清除旧批次。游标推进表示事件已交付 active 或进入有界待投递缓冲；已交给旧版的事件不在新版重复播放。短暂读取失败保留活动帧已显示的弹幕，离线数据延续同一展示 epoch 并清除待投递事件；恢复后不重复开播确认。撤销清空全部版本及回执。`scene.js` 只从 fragment 取凭据，子页面仅收外观和显示数据，真实弹幕模式不会生成示例；授权失效清空画面。主进程接收现有 public overlay SSE 并作账号/连接代际隔离，断线报告缺口，不向本地结算管线补消息；同场重连保留已显示内容，展示 epoch 与游标 reset 的边界见 [API 注册表](../backend/api.md#本地场景)。重启且端口不变时来源有效；端口冲突改用其他端口后需重新复制来源。

首次准备失败显示未就绪图层及超时/素材失败原因，不声称有上一版本；后续输出读取会自动重试。换版失败只记录提示并保留原画面，避免错误提示遮住已成功显示的直播内容。

同版本共享外观更新以子组件的 `prepared` 回执确认应用，`init/config` 与回执携带同一 `configuration` 代次；旧回执不覆盖较新配置。活动帧失败或 12 秒未确认时，父页记录“已保存但应用失败”，后续输出读取对同配置最多尝试三次，仍失败则记录检查素材并刷新来源的提示；沿用已有输出时不遮挡画面的规则。资源加载失败不缓存 rejected Promise；资源身份变化继续走整版准备。航海旗帜的字号、昵称与头像显隐更新复用已准备的素材与事件队列，原位修改当前文字/显隐，不重复读取三张旗帜或重播已收感谢。

`scene-source.js` 为共用的 `display-source.js` 提供场景查询和游标适配，管理输出读取及 `/api/scene/events` 的 fetch SSE 订阅；`scene.js` 仅负责页面组合。通知只传 ready/change/revoked，数据仍经受限 output 读取；通知连接沿用场景 Bearer、可选 item 与已提交 version/projection，不向子页面传递。请求串行且开始至少间隔 100ms，读取期间的新通知合并为一次后续读取。流正常时每五秒健康检查；流断开、饱和或接口缺失时回退 750ms 轮询，并按 750ms 至 15s 退避重连。初次通知 HTTP 失败不撤销有效输出；显式 revoked 会中断未完成读取并丢弃迟到响应。输出 401/403/404/423 清空已显示版本与回执。成功提交 renderer 后才按新版本/回执重开订阅；pagehide 取消读取、流和定时器并释放 renderer。

本机场景或独立组件读取云弹幕投影/默认外观，以及含弹幕的有效本机通知流成功发送 ready/change/心跳时，由 `display-demand.js` 续期同一共享需求；最后一次读取或有效通知活动后 15 秒释放云 SSE，再次使用自动恢复。页面读取短暂停顿但通知仍健康时保持云连接；无弹幕场景、撤销及失败写入不续期。正常后台 token 续期沿用当前展示授权生命周期，不撤销来源或重新开播。主进程保留账号与连接隔离，闲置断开清空实时事件，配置缓存保留；已认证的设置读取和保存直接更新缓存，不要求先打开直播来源。公共消息 DOM 由 `danmaku-renderer-core.js` 的固定源码快照构建，原 `danmaku-message-renderer.js` 保留桌面入场策略，分发规则见 [ADR-0020](../../architecture/adr/0020-shared-danmaku-source.md)。

仅布局变化的发布复用现有版本容器：可见实例 ID/类型集合、内置外观和外部 URL 均不变时，同步更新画布尺寸、位置、显示大小、名称、层级及外部网页分辨率，不移动或重载 iframe；显示版本与投影回执一并推进。其他变化仍按上述整版准备和回退流程处理。纯 browser/clock 场景的输出不读取业务状态快照；文本框只读取共享舰徽所需的 roomGuard。其他端口每轮按所需字段共享一次读取，歌词输出只读取 lyricState/lyricTimeline，不连带读取队列、SC、礼物或冲刺。外部网页的数据直接来自供应方，不经过内置组件通知与读取链路。

场景歌库投影按 owner scope、授权 epoch 和歌曲数据库的既有变更标记复用查询结果；歌词等无关通知不会重新查询、排序未变化的完整歌库。歌词正文按同 owner 的时间轴对象复用投影，歌曲切换或正文替换后重新准备。父页通过可选 `dataVersions` 确认已收到的歌单、歌词正文、礼物滚动、盲盒、队列、转盘和游戏数据，之后不变部分省略，播放状态继续更新；完整发送时返回独立歌单/歌词/盲盒副本。盲盒每次核验统计变化，未变化时保留前次榜单；账本、来源代次、账号、本机日界或心动盲盒筛选变化后重新发送完整榜单，各实例继续应用自身人数和盈利筛选。队列、转盘和游戏的类型通知及账号变化使版本失效，并保留每五秒重新读取的恢复核对。旧调用保持完整响应，具体字段和校验见 [API](../backend/api.md)。

渲染器合并部分更新，保留静态内容用于新 iframe 准备；当前歌词帧只更新播放状态时保留原时间轴。输出读取失败、授权撤销或整个页面重载后重新获取所需内容。礼物滚动在完整历史分页和身份资料版本均未变时复用分组卡片；门槛变化只重做过滤，目录变化更新素材索引，失败头像继续重试。跨日、来源变化与清空使旧数据失效，现有通知、补读和滚动节奏保持不变。

转盘仅在选项文字、权重或字号变化时重建扇区与标签；抽取动画仍按 spin ID 接纳，颜色、显隐和结果照常更新。场景绘画只在 session、轮次、画布 revision 或实际画布尺寸变化时重放历史，空会话后恢复也重画；主机画笔的增量与乐观绘制保持原路径。禁用工具只有在取消未完成笔画时恢复画布，不重复重放未变化的历史。

### 文本框 `/text-box`

配置版本 1 的可选 `scrollMode` 为 `none` / `horizontal` / `vertical`，缺省 `none`；可选整数 `scrollSpeed` 为 10–200 设计像素/秒，缺省 40，旧配置维持原速度。客户端与画布共用“文字排版”“自动滚动”两个设置分区，解释使用 `lira-help` 问号组件；横向、纵向滚动开关互斥，下方的“滚动速度”滑杆使用同一份实例配置。两个开关都关闭时滑杆禁用但保留速率，切换方向继续使用该值。编辑区始终静止；横向输出将换行显示为空格并单行向左播放，纵向保留换行及自动折行向上播放。实际速度随组件宽度等比缩放；短文也会滚动，关闭时恢复原有静态排版。

`overlays/text-box-scroll.js` 拥有输出播放和清理：固定视口以原生滚动偏移移动单份正文，前后各留一个视口的空白，在内容完全离屏时循环，不复制长文或动图，也不建立整段长文的移动 transform 图层。rAF 只更新偏移，正文/排版配置、窗口尺寸或素材尺寸变化时才测量；相同配置或仅速率改变不重建 DOM、不重置进度或增加动画循环。编辑器内容签名同样排除 `scrollMode` 与 `scrollSpeed`，调整播放参数保留原生撤销。页面隐藏时暂停，恢复时接着播放，销毁时释放帧、观察器和事件。

长文按格式片段渲染，不逐字创建元素。多行纯文本粘贴通过 `textContent` 和既有 renderer 构造转义片段，以单次原生插入保留换行、插入位置格式及撤销；不采用剪贴板 HTML，不逐行触发编辑和场景更新。切换播放参数不重建编辑器。文本仍受整个场景 256 KiB UTF-8 文档限制约束。

`shared/text-box-config.js` 校验结构化 text/gift/image 节点，`shared/text-box-renderer.js` 同时供编辑区与输出使用。编辑态的礼物/上传图片是不可编辑的完整方块，保留节点字号（缺省跟随整体字号），内部图片与输出态使用相同的相对字号比例，不另行缩小方块；输出态只渲染图片，保留动图原文件和长宽比。文字通过 DOM `textContent` 渲染，不接受任意 HTML。`overlays/text-box.js` 通过既有组件预览协议接收每份独立配置，以 640px 设计宽度随组件宽度整体缩放。

许愿文字版的 `admin/gifts/wish-text-editor.js` 对正文和不可拆分变量块统一调用 `shared/text-style.js`，将 `textRuns` 中的字体、字号、字重、斜体、下划线、描边与阴影应用到编辑内容；变量块仅保留编辑态的底色和默认提示色，不另设字号或字重。插入变量块和纯文本粘贴读取光标处的格式，位于变量块边界时使用其格式数据，避免把提示色写成输出颜色；保留原生撤销。右侧预览、已保存预览和直播输出继续共用 `shared/gift-wish-card.js`，使用相同片段格式。

管理端 `text-box-preview.js` 在客户端详情和画布参数区挂载同一个 `text-box-editor.js` 与 `text-box-media.js`，选区工具栏保留原生撤销、字号配色和不可拆分素材。`rich-text-toolbar.js` 统一拥有文本框和许愿文字版的浮动选区工具栏、快捷键、字体与字号选择，调用 `shared/font-library.js` 的软件/系统字体库选项并在销毁时注销；`rich-text-format-controls.js` 负责常用/最近/自定义色板，以及描边、轻阴影、清除格式入口；最近 6 色仅存于本地 UI 偏好 `admin.textBoxRecentColors`，不进入场景文档。text 节点可带可选 `fontFamily`（非空、最多 200 个 UTF-16 code unit，不含控制字符及 `;{}<>`）和布尔 `stroke` / `shadow`；字体缺省继承原字体，效果缺省关闭，共享 renderer 使用随字号缩放的深色描边、阴影。清除格式只重置选中文字，保留素材、未选中文字和原生撤销。`text-box.js` 复用场景草稿及发布 owner 管理多份实例，并携带实例 ID 打开画布。保存状态位于顶部保存操作旁，通过比较草稿与已保存文档中的文本框实例，区分“文本框有未保存修改”与“场景其他内容有未保存修改”；删除最后一个文本框仍属于文本框修改。顶部显示正在编辑与当前输出的场景名，保留“保存并应用”“放弃修改”短按钮。保存仍发布整个场景，页面常驻说明包含已保存但尚未应用的内容；该说明不代表自动检测保存/发布差异。切换当前输出或连带其他场景内容/引用的共享组件草稿时先确认，等待弹窗期间状态为“等待确认”。放弃仍作用于整个当前场景草稿，包含文本框以外的修改时先确认；取消或确认期间场景变化不提交。没有文本框全局默认存储或业务数据订阅。正式直播使用已发布的 `/scene` 组合/单组件地址；裸 `/text-box` 仅为无凭据的子渲染页面。

## 服务器浏览器源地址

旧服务器弹幕姬地址按服务端 ADR-0056 使用 `/overlay/<16位base64url>`，由服务器按认证租户生成并持久保存。`server-overlay-url.js` 保留兼容读取与账号变化观察，过滤等既有远端配置仍使用该生命周期；地址验证、授权资料补全和迟到响应丢弃不变。新弹幕参数与场景地址改用 `authorized-account.js` 的共享授权观察，不再依赖旧外观 URL 读取成功。场景源由本机场景 API 提供，不能从域名拼接或把 DeviceBearer 交给页面。

`danmaku-overlay-settings.js` 通过本机 API 读取与保存，保留草稿控制器的失败、重试及账号变化处理。失败时不以默认值覆盖已有配置；首次旧配置导入失败可重试，成功后的新样式保存不依赖服务器支持。共享授权观察用代际拒绝迟到的初始快照，token 续期不重置草稿；API 使用 main 提供的真实 owner 和授权 generation 拒绝跨账号或重新登录后的晚到写入。

验收：首次加载两个观察者收到相同完整 URL；复制/打开保留随机串；错 origin、裸路径、带 query/hash 或非法长度拒绝；切换账号不显示旧 URL；本地预览与草稿行为不变。自动化见 `test/danmaku/server-danmaku-settings.test.js` 与 `test/danmaku/danmaku-overlay-ipc.test.js`。


## 投票与评分 `/interactions`

独立 interactions scope，仅展示当前类别 3 会话；空场透明。推荐浏览器源 800×600，投票支持 1–6 个选项。管理端预览、主持端结果和实际投屏共用紧凑结果行：轨道最小高度 56px，行间距 8px，长文字自然撑高。卡片和选项区随内容增减高度，全部选项同时展示，不设内部滚动或自动翻页；实时更新保留 DOM。

投票使用固定顺序与 0–100% 标尺，票数/百分比固定在完整轨道内，零票不隐藏；结束标最高/并列最高，零参与无胜者。评分内容最大宽度为 460px，规则文案可自定义，默认说明 1–10 分、只发整数及取最后一次评分。多行输入保留换行，长文本（含连续英文）按卡片宽度自动折行，卡片随内容增高，规则留空则隐藏，不固定行数。底部独立均分框在收集中显示占位「—」，不显示均分或人数，结束后显示两位小数及人数；无人评分显示「暂无评分」。接收曾中断时保留提示。页面 GET、刷新或开多个实例均不启动/延长收集。截止由本地服务控制，与页面可见性无关。

选项文字位于进度条内左侧，票数与比例右对齐。整体底色透明，默认深色文字、浅青色填充，投票不再展示完整规则说明。标题和提示默认空、留空隐藏，不回退到本场主题。管理端「直播画面」按内容、颜色、布局与显示分组，左侧编辑、右侧棋盘格背景预览；窄窗口将预览放到编辑区上方。客户端与画布可调整标题、提示、评分规则、文字/进度条/轨道颜色、整体不透明度、文字大小、卡片圆角、状态和人数显示，不提供整体背景颜色或背景不透明度控件。整体不透明度同时影响卡片全部内容；字号 16–24px，结果行随文字换行自然增高。隐藏人数不隐藏接收中断警告，也不提前公开评分汇总。标题与状态均隐藏时折叠标题区，底部无人数或警告时折叠底部。

草稿即时预览，可切换投票或评分，预览明确使用示例数据；进度条色也用于最终均分框。预览与浮层共用外观样式，按卡片宽度调整选项内的排列。点击应用后通过既有 `/api/settings` 保存并广播，恢复默认也先进入草稿。设置键与默认值见 [storage.md](../backend/storage.md)；只有 interactions scope 接收这些展示设置。样式更新不改变会话或选项节点；评分浮层共用这套外观。

标题与提示的字素长度、RGI emoji 和不可见字符校验由桌面与 Node 写入端负责。`interaction-rules.js` 在调用校验时构造 Unicode `v` 正则，避免旧浏览器在导入模块时发生语法错误；`readInteractionAppearance` 渲染已保存标题/提示时只做 trim/NFC，不重复执行写入校验。其他外观字段保留原有归一化规则，文字仍通过纯文本 DOM 显示。Chromium 106 的投票、评分及已保存 emoji 标题已通过独立来源检查。


## 绿萌简笔画固定样式

`sketch`（绿萌简笔画）为透明背景固定弹幕，复用列表滚动。普通观众使用第一种卷线昵称框与素色色带；大航海用户（`guardLevel` 为 1、2、3，即总督、提督、舰长）使用第二种猫兔藤叶框，色带内带有层叠枝叶与浅色花瓣。仅佩戴粉丝牌或主播标记不触发第二种。头像/徽章/礼物原图隐藏；昵称、正文、表情和礼物均保留真实内容。礼物开放式排版显示名称、数量和已结算总额（两位小数，货币符号在后；缺失金额显示 `—`）。SC 保留完整原文与两位小数金额，使用同主题边框。

既有 `textColor` 在此样式作为「主题颜色」，默认 `#7f9f76`，正文使用原色，昵称、礼物、描边、矢量装饰与柔边色带派生协调浅色；枝叶底纹随主题色变化，背景不透明度同步调整色带及其底纹，文字与外框线稿不透明。支持字体、18～48 字号和上下滚动，不接受随机位置/速度/礼物图片参数。旧布局缺少 sketch 时仅补齐 480×700 默认区域；切换或恢复参数不改变其他样式。两端 CSS 与装饰模块保持一致；颜色源为 CSS 变量，装饰无外部请求、无定时器。

## 共用大航海身份图标

`public/js/shared/bilibili-room-guard.js` 只维护当前房间人数、订阅与 `isThousandGuardRoom(count)` 判断，不依赖 DOM、素材或网络。人数来自既有快照的 `guard_info.count`：严格大于 1000 使用千舰款，1000 及以下或未知使用普通款，10000 以上仍使用千舰款。`public/js/shared/bilibili-guard-icons.js` 负责素材选择与展示更新：`getGuardIcon(level)`、`getGuardAvatarFrame(level)` 分别返回当前档位的舰徽和头像框路径，均调用同一人数判断；`bindGuardImage` 绑定已知图源，`applyRoomGuardState` 接收快照并更新已有图片及 `--bilibili-guard-*`、`--bilibili-guard-*-frame` CSS 变量。普通头像框复用 `danmaku-guard/bubble-*-frame.webp`，千舰头像框复用 `danmaku-harbor/*-frame.png`，来源见 `danmaku-harbor/sources.json`；舰徽位于 `public/img/admin/gifts/`，来源见同目录 `guard-icon-sources.json`。既有 `getRoomGuardState`／`subscribeRoomGuardState` 导出继续兼容调用方。

接入点包括粉丝档案、最近礼物与提示、加班礼物选择、礼物横幅／许愿、文字组件、点歌队列、流霞／雪狐身份和月渡／雾语／航海 CSS 舰徽。历史数据保留原图地址，渲染时解析，不迁移持久数据或替换用户自选图片。Admin StateService、overlay socket、正式场景与网页画布预览沿既有数据连接同步；预览订阅在关闭时释放，无每张图单独请求。人数更新不重建消息队列。「聊天气泡」「对白」及礼物横幅中已有的等级头像框同步切换，普通观众不新增头像框；独立大航海感谢主题插画仍使用各自样式规则。

`scene-renderer.js` 为每个已就绪 iframe 记住最后发送的 `roomGuard`，相同房间人数状态不重复跨 frame 发送。首帧、人数或房间变化、空状态及重建的 iframe 仍立即同步；已验证来源的子页面重新发送 `ready` 时清除该缓存，使同一 iframe 重载后也能在下一次数据更新恢复舰徽状态。礼物与弹幕事件通道保持原交付规则。
