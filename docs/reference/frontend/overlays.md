# 直播画面悬浮层(overlays/)

直播平台为 B 站；OBS 与哔哩哔哩直播姬均通过浏览器源 / 网页来源使用这些画面。文中的 overlay 指通用直播展示页。本机画面使用 `127.0.0.1`，要求与 LIRA 同机并保持客户端运行；既可用直播场景的一个来源，也可直接导入独立组件。在线弹幕姬使用服务器返回的完整 HTTPS 地址，关闭客户端后仍可展示。本机 `/danmaku?source=component` 是独立组件来源，`/danmaku?preview=1` 是示例预览；完整操作见 [组件与浏览器源指南](../../guides/component-sources.md)。

> 涉及文件:[pages/overlays/queue.html](../../../public/pages/overlays/queue.html)、[pages/overlays/songs.html](../../../public/pages/overlays/songs.html)、[pages/overlays/blindbox.html](../../../public/pages/overlays/blindbox.html)、[pages/overlays/overtime.html](../../../public/pages/overlays/overtime.html)、[pages/overlays/lyric-window.html](../../../public/pages/overlays/lyric-window.html)、[pages/overlays/opening.html](../../../public/pages/overlays/opening.html)、[js/overlays/](../../../public/js/overlays)、[css/overlays/](../../../public/css/overlays)

本文档描述各个叠加层页面的框架、数据消费与各自 UI。快照字段与消息类型见 [ws.md](../backend/ws.md),客户端通信行为见 [comms.md](comms.md),页面入口 URL 见 [pages.md](pages.md) §2,加班机领域状态见 [backend/overtime.md](../backend/overtime.md)。

### 本地媒体样式

[component-media-style.js](../../../public/js/shared/component-media-style.js) 定义独立组件配置中的可选 `mediaStyle`，服务端 `normalizeSceneConfig` 统一校验。支持 background、opening、danmaku、clock、gift-wishes、gift-frame、guard-thanks；新增字段不改变原业务配置与事件。字段如下：

| 字段 | 含义与范围 |
| --- | --- |
| `id/src/kind` | 样式 UUID、受限本机素材 URL、image 或 video；导入服务生成，清单不能覆盖 |
| `width/height` | 原图或设计画布像素，整数 1–7680 |
| `content` | `{x,y,width,height}` 百分比内容区，必须在 0–100 内，宽高至少 5 |
| `textColor/fontSize` | 六位十六进制颜色；12–200 像素 |
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
| `blindbox` | GET `/gifts/blind-box-stats`，保留 `boxName` 筛选 | 本页主题与心动盲盒展示设置；统计仅盒数、总成本、开出礼物总价值、总盈亏、榜单显示名/盒数/盈亏及 `heartBoxProgress.openedSinceCastle` |
| `overtime` | 无 | `overtime` 的 revision、状态、服务端时间、有效余时、背景与展示规则；`overtime:update` 的同一状态及结算动画字段 |
| `gift-effects` | 无 | `giftEffectDanmakuEnabled`；`gift:frame` 的礼物铭牌/特效身份字段，`gift:effect` 的播放 URL 与 RGB/alpha 布局，`gift:guard-thanks` 的等级/昵称/月数/头像/文字模式 |
| `gift-feed` | GET `/gifts/display-settings`、`/gifts/history`、`/gifts/card-profiles`、`/overtime/gifts/catalog`、`/bilibili/avatar` | `gifts.viewRevision` 与刷新 reason；`gift-catalog:update` 仅为失效通知，不附完整目录 |
| `gift-sprint` | 无 | `giftSprint.targetRmb/remainingCrystalBalls`；月底冲刺文字版直接使用既有服务端折算数量，未设目标或断线时清空文字，重连恢复；页面 `/gift-sprint`，`preview=1` 显示底色与提示；画布模式通过父页接收同一投影，不启动子页 WebSocket |
| `gift-export` | GET `/bilibili/avatar` | 无业务快照或专用消息；导出行、配置和目录由 Electron main 的冻结输入提供，不授予流水选择或导出 IPC 权限 |
| `lyrics` | 无 | 本页歌词设置、`lyricState/lyricTimeline`；`lyric-state/lyric-timeline` 仅含曲名/艺人、行词文本与时间、播放/排序状态 |
| `games` | GET `/games/session`、`/games/winner-profile`、`/bilibili/avatar`；POST `/games/session` 仅 `stop/restart`，`/games/session/move` 仅数字/坐标字符串，`/games/session/draw` 仅 `append/undo/clear` | `game:update` 的完整公开游戏态、`game:patch` 的聊天/状态增量、`game:draw` 的画笔操作；兼容已存在的 `state.games`，不新增全局字段 |
| `danmaku` | GET `/bilibili/avatar` | `danmakuFeed`、`liveStatus.enabled/roomId/connected/message`、`danmakuOverlayStyle/danmakuFullscreenDurationSeconds`；`danmaku:message` 仅展示消息、身份、头像与表情字段 |
| `wheel` | GET `/wheel`；POST `/wheel/spin` | `wheel:update`；仅候选标签/权重、抽取时序/索引及上次结果索引 |
| `opening` | GET `/opening/config` | 无；配置仅启用、文案、画质/轨道/音符/均衡器、音频开关/音量及当前音频/人物图 URL |
| `clock` | GET `/clock/config` | 无；仅 `style/showDate/showSeconds/hourFormat/label/flipFrameColor/flipFaceColor/flipTextColor/moonMode/moonIntervalSeconds` |

本日礼物的服务端读取固定北京时间今天、每页 100 条、按创建时间升序；页面只能传分页 cursor 和 viewRevision，不能扩大日期、来源或筛选范围。返回仅保留 `viewRevision/nextCursor/partial`，以及横幅需要的 `eventId/artworkPath` 和礼物显示名、礼物 ID/变体、币种、单价、数量、头像、大航海等级。目录仅保留礼物 ID/名称/变体和本地图片路径，不暴露来源配置、同步状态或完整流水元数据。

游戏投影按游戏类型逐字段选择。数字炸弹的隐藏数字、你画我猜的未揭晓词条/别名和管理态不对展示页开放；只有领域状态已经 `answerRevealed: true` 才传递 `revealedAnswer`。公开弹幕保留观众实际发送的文本。落子不能携带对象形式的主持控制指令，开始/配置游戏和转盘、提前揭晓/切换题目仍属于管理端。

设置字段表以投影模块中的显式键为准，并覆盖共享消费者：队列保留通用主题、序号/置顶/六条规则及各风格字体和滚动键；`storybookQueue`、`neonVinylQueue`、`cherryRibbonQueue`、`goldenLilyQueue` 仅允许 `FontSize/FontFamily/FontWeight/UseCustomTextColor/TextColor/ScrollMode/ScrollSpeed` 七个已消费后缀，旧 `illustratedQueue*` 仅保留现有兼容回退键。歌单保留独立 `songBoard` 设置及共享主题回退键，盲盒保留自身标题与通用主题，歌词保留 `DESKTOP_LYRIC_DEFAULTS` 对应的 51 个展示键。不得将任意同前缀的新键视为已授权。

每个 overlay HTML 响应都使用 `Content-Security-Policy: sandbox allow-scripts`，不允许 `allow-same-origin`；直接打开和嵌入管理预览都处于 opaque origin，不能访问父 frame 的 DOM、fetch 或凭据。预览父页通过 `postMessage(..., '*')` 发送展示配置，子页核对 `event.source === parent` 及管理页服务 origin；当前 overlay 与共享渲染器不依赖 localStorage、sessionStorage 或 IndexedDB。

静态脚本、样式、字体和图片可跨 opaque origin 加载，HTML 不开放 CORS 读取。API 只为允许的页面路径/方法接受 `Origin: null`，实际请求仍验证页面凭据；预检不授予身份或管理权限。引导脚本只给同一服务的 `/api/` 和 `/ws` 附加本页凭据，401 或 WS 关闭后最多合并一次 `/api/state` 探测，确认旧凭据失效才重新加载页面。`topic=danmaku` 只缩小订阅，不能扩展 scope；overlay 的 WS 文本/二进制业务入站帧关闭为 1008，正常 ping/pong/close 保留。`shutdown` 对所有 scope 仅包含类型和原因。

区域随机位置参数：outline、cream、glow、starveil 的 `styleOptions` 支持 `centerBias`（中心倾向）与 `dispersion`（离散程度），均为 1～50 整数，默认 1。中心倾向越高，越偏向区域中央、越少落在边角；离散程度越高，越偏向离上一条卡片中心欧式距离更远的位置。两者共同调整概率权重，不承诺每条消息固定距离；边界和防重叠优先，拥挤时沿用最旧消息淘汰。上一条过期后仍保留其中心作为下一条参考，清空/重建 feed 时重置。参数在线更新只影响后续位置选择，已显示位置保持稳定。固定与 floating/comet 样式不接受这两个字段；旧参数缺失使用默认，空样式对象恢复默认，旧 PUT 省略 styleOptions 保留已有值。

算法由 `danmaku-random-position.js` 拥有：48 个稳定伪随机均匀候选，Gumbel-max 按指数权重选择（中心归一化距离惩罚与实际欧式距离奖励）。仅在候选无法放置时尝试边角/相邻空隙。预览、独立弹幕与服务器使用同一算法；参数面板复用既有滑块与草稿应用流程。

浮光掠影飘窗样式 `floating` 为固定/随机之外的独立布局，由 `danmaku-floating.js` 复用消息渲染器。灰底浅色描边圆角卡片从右向左匀速移动，大航海深色、其余浅色；仅显示昵称与正文/表情（礼物沿用文字通知，SC 不显示）。`styleOptions.floating.speedPixelsPerSecond` 为 20～600 整数、默认 120 逻辑像素/秒，默认区域铺满画布；旧九/十区域配置补齐缺失区域。预览、桌面参数与服务端正式画面同步支持，动画、计时器及观察器由布局模块释放。

`comet`（鹤舞花枝间，原流光彗尾）沿用飘窗布局和速率，参数与区域仍按 `comet` 保存。各身份统一使用参考图的香槟金横框、左侧花枝、右侧白鹤及上方独立花纹昵称牌；暖金文字带柔和白色描边，昵称、正文和表情均为实时 DOM。花框和昵称牌为不含示例文字的透明 WebP，金框与昵称牌底板按九宫格伸展；重绘的花叶、白鹤、花簇与灯笼分别锚定四角，随框体增高沿对应上下边缘展开，保持原比例、不挤在中部；昵称牌小花保持固定尺寸，长昵称及多行正文分别扩展对应区域。卡片按内容在 540–700px 之间伸缩，默认 30px 字号下 30 字排 2 行、40 字排 3 行，昵称牌与正文、金色底板居中对齐；小区域整体等比缩小。全部装饰包含在卡片边界内，完整离场后清理；不再外伸丝带尾部或播放布料波纹，不增加动画计时器。背景透明度同时作用于花框和昵称牌，文字保持不透明。素材来源见 `public/img/overlays/danmaku-comet/provenance.json`。

### 1.1 通用模式

所有叠加层:

- **透明背景**:`html,body` 透明(`overlays/base.css`),只渲染卡片面板,供 浏览器源叠加;加班机层独立样式(整屏倒计时)。
- **状态获取**:队列、歌单、盲盒、加班机等快照消费者先 `fetch('/api/state')` 拿首帧快照,再连 `/ws` 收后续快照;WS 断开时按指数退避重连,重连前再次 `loadState()` 兜底(见 [comms.md](comms.md) §3)。
- **字体**:中文字体栈 `Microsoft YaHei / PingFang SC` + 多语言回退(`overlay-utils.js` 的 `multilingualFontFallback`);队列/歌单板经 CSS 变量 `--overlay-font-family` 由管理页设置注入,加班机数字与 LIVE 徽标用 Bahnschrift / Bahnschrift SemiCondensed(见 §4)。
- **指纹去重**:内容未变不重渲染(队列层 `computeStateKey`、歌单层三段指纹、加班机 revision 比较,详见 [comms.md](comms.md) §3.2)。
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

- **工作原理**:以 anchor 记录(当前视口首行 key/index/offset)为起点,向两侧按 `beforeViewports=1 / afterViewports=1.5` 个视口高度增量构建 DOM 节点(`probeOverflow` 先探测内容是否超出一屏,不超出则整表渲染),`wrapIndex` 取模实现环形复用;滚动时 `tick` 按 `pixelsPerSecond(viewportHeight / secondsPerViewport)` 推进 `scrollTop`,超出前缓冲区的顶部节点被回收并追加到尾部(`recycleTopRecords`),始终保持窗口内只有可见 + 缓冲节点。
- **联动**:`setRecords`/`relayout` 以 anchor 保持视口稳定(歌单刷新/字体加载完成/视口 resize 时不跳位);`secondsPerViewport` 由歌单滚动速度设置换算;页面隐藏时 `pause()` 停止 rAF([songs.js:102-108](../../../public/js/overlays/songs.js#L102-L108))。
- **速度精度**:保留浏览器写入 `scrollTop` 后的像素舍入余量，下一帧与回收顶部节点时继续累计；低速不会因高刷新率停住，各刷新率下保持相同的每秒位移。滚动速度 1–100 数值越大越快。
- 浏览器无 `requestAnimationFrame`/`ResizeObserver` 时自动降级(整表渲染 + window resize 监听)。

### 1.4 礼物四方边框(`/gift-effects`)

`gift-effects.html` 保留透明全屏浏览器源地址，消费 `gift:frame`，并将 `gift:effect`
交给独立的 `gift-effect-player.js`。官方特效按已验证 RGB/alpha 坐标用 WebGL 合成，
单条播放、最多 3 条等待、等待超过 12 秒丢弃；错误、30 秒超时和停用统一清理。
弹幕开关关闭或 WS 断开时停止指令特效并清空其队列；手动预览不受开关限制。
服务器代码解析、桌面共用测试播放解析器和兼容规则见 [弹幕礼物特效规格](../../../specs/gift-effect-danmaku.md)。
**特效 1 · 林间花信**（`themeId: woodland-bloom`）通过「更多样式」导入 1.0.0 ZIP 后播放本地 `woodland-bloom-v4.webm`，视频不再内置于安装包。
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
预览接口每次生成独立 ID。队列只接受 `woodland-bloom`，缺省主题仍按特效 1 处理。
`gift-frame-player.js` 交给 `gift-effects-frame.js` 播放。特效 1 由 `giftFrameEnabled` 和
`giftFrameThresholdRmb` 控制；final 礼物按整数分比较触发门槛。
缎带礼笺已撤销，其管理入口、播放器与素材已移除；历史设置不再参与触发，旧主题事件被队列忽略。
加载允许 10 秒，媒体进度停滞 5 秒触发清理；加载耗时不扣减特效 1 的 8 秒动画。
正常结束、解码错误、播放拒绝、超时和 pagehide 都释放回调/计时器并清空画面；错误后后续事件重新加载媒体并推进队列。
旧静态图、挂饰、Canvas 粒子和 frame motion 模式已移除；URL motion 仍只影响大航海感谢。
`gift:effect` 官方特效的独立播放器和队列保持既有行为。

**大航海感谢**：辉光和经典分别启用、设置文字；同时启用时每次合格上舰产生两个带风格后缀的事件，独立风格画布图层各自播放对应事件；通用旧图层及独立页面仍依次播放。画布组件文字默认 `follow`，使用事件文字；已有显式 `bilingual/zh/en` 覆盖继续有效。同一页面在 `#guardThanksRoot` 消费 `gift:guard-thanks`，由 `overlays/gift-effects-guard.js` 按 eventId 去重（预览不去重）、逐条播放，最多 12 条等待、等待超过 90 秒丢弃，队列满时舍弃最早的最低等级；有等待时缩短停留。渲染由 `shared/guard-thanks-card.js` 分发到两套互不影响的风格，经典风格的 Canvas 粒子由 `guard-thanks-particles.js` 管理，辉光光点随卡片一起管理与退场；时间与 DOM 工具共用 `guard-thanks-stage.js`，均同时供画布组件预览使用；1280×1080 设计舞台按 `min(宽/1280, 高/1080)` 居中缩放。事件 `style=classic`（`guard-thanks-classic.js` + `css/shared/guard-thanks.css`）为金属徽章风格：舰长/提督/总督分别为蓝色船锚、紫色罗盘、红金船舵，依次播放冲击波与闪光、徽记入场、头像徽章描边、丝带标题逐字弹出与扫光、标语和感谢铭牌，并有对应的气泡/星芒/彩纸余烬粒子；入场 1.5 秒，停留 3.3/4.0/5.0 秒，退场 0.7 秒；头像只直连 HTTPS hdslb 地址（`no-referrer`），失败或缺失时显示昵称首字，预览使用内置样例头像。事件 `style=aurora`（`guard-thanks-aurora.js` + `css/shared/guard-thanks-aurora.css`）为珠贝质感的辉光柔和风格：舰长冰蓝独立船锚、提督紫晶月弧罗盘、总督红色珠贝与金属独立船舵，仅提督保留实体月弧，使用 1280×1280 的 `img/overlays/guard-thanks/*-pearl-v1.webp` 无损透明纹章，适配组件推荐的 2560×1440、16:9 输出；纹章、标题、光晕、光线与粒子共同使用各档主色，总督辅以金色。入场按弧线勾勒、固定纹章淡入、称谓与说明出现、星芒及光点分批点亮展开；纹章始终保持原位与角度，仅淡入淡出。反光按原图 alpha 裁切后掠过表面，外圈流光以亮头与柔尾沿弧线掠过，细光环、柔光晕与光线缓慢流动，整张卡片统一淡出。称谓采用本地裁剪的宋体标题字库 `fonts/guard-thanks-serif-400.woff2`，下方排列中英说明与月数，文字全程不虚化，以贴合字形的细边保持明暗背景上的轮廓，不铺大面积光雾或黑色暗衬。图片解码和字库在入场前准备，最多等待 1.4 秒；失败或超时时使用矢量纹章及系统衬线字体，播放中不迟到替换；**不出现送礼人头像与名字**。舰长保持 1 条流光、18 枚外圈光点与 3 处纹章星芒；提督增加到 3 条流光、32 枚光点、6 处星芒，并加入双弧与 8 枚星链节点；总督为 5 条流光、50 枚光点、8 处星芒及 12 枚星链节点，另有 9 道冠冕状金色光线和双重扩散环。光点每六枚一组错峰出现。减少动态效果时保留静态主色构图，隐藏闪光、流光、粒子与新增光饰，仅对整张卡片淡入淡出。入场 2.8/3.0/3.2 秒、停留 3.0/3.4/4.0 秒、退场 1.0 秒，三档总时长为 6.8/7.4/8.2 秒；新增的 1 秒用于分段入场，连播只压缩停留（取 0.7），总时长为 5.9/6.38/7.0 秒。两套风格的文字都支持中英双语、中文、英文。`?motion=reduced` 或系统减少动态效果时只做淡入淡出（辉光保留静帧构图）；`?preview=1&guardPreview=<tier>`（可加 `&guardStyle=aurora|classic`、`&guardText=`、`&guardMonths=`）可在页面内单独预览。

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

画布的示例数据携带 `preview: true`；金额门槛过滤全部示例时，在组件内说明原因及调整方法。正式来源不携带该标记，空集合保持透明，不输出预览提示。

`shared/gift-card-model.js` 同时供滚动展示和导出运行时派生卡片：仅对北京时间今天的记录，按送礼人 UID、相同礼物 ID 和礼物名合并，累加数量及各条历史单价乘数量的整数分金额，颜色按合计金额计算。身份来自 `/api/gifts/card-profiles`，对同人今日全部卡片使用最新已知昵称、头像及大航海等级；null 不覆盖已知等级，0 明确移除头像框，同等级续费保留未变化的卡片节点。未知 UID 不按昵称合并，旧日期和原始流水保持独立。导出只合并所选记录，资料更新可使用今日未选记录的证据。滚动阈值按合并后的卡片数计算，稳定分组键保留滚动锚点；资料暂不可用时预览说明未完成身份合并。

礼物助手的滚动礼物面板生成当前本地端口的 `127.0.0.1/gift-feed` 地址，`?preview=1` 只增加预览底色和状态。页面独立于管理面板生命周期，按北京时间遍历今天全部分页，包含未参与冲刺的有效付费历史。“最小礼物金额（元）”支持整数或一位小数，默认 0 不限制；正数在完整分页、合并卡片后按 `cardTotalCents` 严格大于门槛过滤，未知 UID 独立记录按历史单价乘数量计价，比较使用整数分。该过滤只作用于滚动集合，不改变历史记录、分色金额或图片导出；配置契约见 [API 设置端点](../backend/api.md)。`gift-feed-state.js` 用 eventId 去重并保留轮播锚点；默认 3 行、速率 12（每行 3.9 秒），速率 1–50 线性对应每行 `5000 - (scrollSpeed - 1) * 4900 / 49` 毫秒。过滤后的条目超过显示行数时连续匀速向上滚动，最后一条紧接第一条；不足或刚好填满时静态显示，不复制填满。动画按帧时间累计位移，换行保留余量，无间隔等待，DOM 只保留可见行及最多一条动画缓冲，并复用未变化的节点。页面隐藏时释放动画帧，恢复后接着当前位置移动。暂停和低功耗选项已移除。

WebSocket 通知合并后重读，并每 30 秒对账；刷新保留滚动进度，新集合在换行边界应用，静态或隐藏时立即更新。礼物通知只重读礼物与身份资料，设置、素材分别在对应失效通知时读取，首次加载、重连及定时对账补读两者；请求期间收到的失效通知合并到下一批。横幅按稳定卡片键插入或复用，`updateGiftBanner` 就地更新数量、颜色、名字、头像与舰队框，只在文字改变时重新测量字体，成功图片不随连击重建。滚动换行先移除离开的行，再插入新的缓冲行，避免搬动仍可见的节点；重复通知且展示资料未变时没有 DOM 写入，失败头像仍可单独重试。午夜、来源切换或投影代次变化清空旧集合，迟到请求不得恢复旧来源。保存配置即更新静态行颜色。`shared/gift-banner.js` 和 `css/shared/gift-banner.css` 同时拥有管理预览、PNG 和 直播画面的横幅：基础尺寸 560×96，包含头像占位、可空大航海边框、昵称、黄色礼物名、本地 WebP 和数量。颜色条的圆弧左端与头像同心，头像四周留 10 像素内距；昵称区、颜色条和 WebP 位置固定，数量保持字号并只向右扩展画布。PNG 按实际画布的 2 倍尺寸导出，基础宽度 1120 像素，合并时取本页最宽横幅；浏览器源建议宽度 900，以容纳多位数量。金额/时间/备注不进入横幅。

## 2. 队列叠加层(/queue)

[overlays/queue.js](../../../public/js/overlays/queue.js) 渲染 `state.queue`(current + waiting)与 `state.superChats`:

HTTP 初始/重连请求带本页读取代次，较新的完整 WS 状态使旧请求失效。HTTP 与 WS 共用内容指纹；延迟补数和重连取得相同内容时保留节点及滚动进度。

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

客户端「组件 → 礼物姬 → 盲盒盈亏榜」和画布共用标题、榜单人数、盈利筛选、心动盲盒筛选、城堡展示、紧凑布局、自动翻页及字体配色设置。字体与配色继续沿用通用主题；画布只显示一个盈利筛选，旧 `hideLoss` 字段仍作兼容别名。新复制的地址不带这些参数，保存后跟随 settings 更新；已有 URL 显式提供的同名参数继续优先。筛选变更会重新读取统计并使场景盲盒缓存失效。

[overlays/blindbox.js](../../../public/js/overlays/blindbox.js):

- 数据:汇总 + 排行榜来自 `GET /api/gifts/blind-box-stats`(可选 `?boxName=心动盲盒` 只看心动盒);快照 reason 以 `bilibili:gift`/`gift:sprint:reset`/`connect` 触发重取统计。所有带 state 的快照立即应用主题及标题；统计与设置独立判断新旧，相同统计内容保留榜单节点和翻页进度。
- URL 参数(短别名 + 长键):`top/t`(榜单位数,0=仅汇总,-1=全部)、`winners/w`(只看盈利)、`heartBox/hb`、`title/tt`(自定义标题,优先于设置 `blindboxOverlayTitle`)、`compact/c`、`hideLoss/hl`、`refresh/r`(轮询秒数)、`noScroll/ns`；这些显式参数兼容旧链接。管理页「组件 → 礼物姬 → 盲盒盈亏榜」保存公共设置并复制不带参数的 `/blindbox` 地址(见 [app.md](app.md) §4.3)。
- 紧凑布局默认关闭，自动翻页默认开启，由共享设置 `blindboxCompact` / `blindboxAutoPages` 控制，旧 URL 的显式参数优先。盲盒默认隐藏滚动条；`noScroll=1` / `ns=1` 保持隐藏，显式 `0` 恢复细滚动条和手动浏览。隐藏模式超高内容复用 `auto-pages.js` 每 8 秒翻页，保留 32px 阅读重叠并在尾页停留后回到顶部。该模块也服务画猜积分、正确答案、窄布局和游戏结果卡；不使用连续动画，低功耗或减少动效时仍可阅读全部已选内容。滚轮、指针、触摸或键盘操作暂停 16 秒，焦点留在区域内时持续暂停；页面隐藏不翻页，卸载时清理。
- 呈现:独立浏览器源默认宽 720px；画布中新建组件默认 720×640px，尺寸定义由 `shared/scene-extra-components.js` 提供。顶栏第一行并列标题与总盈亏(涨绿跌红)，第二行显示开盒数、花费和开出价值；“开出价值”直接使用统计的 `summary.totalValue`。字号比例为 1 时，标题与昵称 32px、盈亏金额 38px，统计、名次、盒数及空提示 30px；字号跟随 `themeFontScale`，全部文字下限为 30px，紧凑布局只收紧间距。容器宽度不超过 539px 时，标题、总盈亏与统计分行排列。榜单每位观众分两行显示昵称及开盒数量/盈亏，较长金额按空间换行；容器达到 600px 时榜单改为单行。前三名显示带数字和绶带的金、银、铜奖牌，第四名起使用普通数字；奖牌由 CSS 绘制，尺寸跟随字号比例。榜首浅金色强调，金额右对齐，不显示额外头衔、重复表头或空白页脚。没有开盒记录时省略汇总，只显示“等待开盒”；已有开盒但盈利筛选结果为空时显示“暂无盈利观众”。仅汇总模式隐藏标题和榜单，保留顶栏统计及零值。`compact/winners-only/summary-only/no-scroll` 类切换形态；主题从快照 settings 经 `applyTheme` 应用(与队列层同套令牌)。
- 心动盲盒:勾选后，顶栏下的细分隔栏可显示「今天 N 倍堡」「还有 N 个堡」「已开 X 个盲盒」，文案基准 30px、数字基准 36px，字号缩小时仍不低于 30px，空间不足自动换行。倍数留空隐藏，剩余数与开盒数各有独立开关，剩余数为手动值（0 也显示）；关闭心动筛选后整栏隐藏。自动进度沿用[后端统计规则](../backend/bilibili/gift.md#4-盲盒服务器结果与客户端展示)，只计算今日心动盲盒开出浪漫城堡后的数量。设置更新即刻应用，无需重建相同榜单；画布使用示例开盒数 12，正式浏览器源使用实际统计。字段默认值和范围见[存储设置](../backend/storage.md)。
- 数据刷新:WS reason `bilibili:gift`/`gift:sprint:reset`/`connect` 重取统计,`refresh/r` 参数支持定时轮询(≥10s)兜底,适用于 WS 不稳的投屏环境。

## 6. 桌面歌词页(/lyrics)

画布资源样式 `moonlit-lyrics` 通过现有套装加载器按需装入 `css/lyrics/moonlit.css` 与 `moonlit-font.css`，复用银蓝花枝并加载套装内的霞鹜文楷 Light 分片字体；`style` 默认为 `default`，导入后可为 `moonlit`。它与普通桌面歌词共用 `lyrics/desktop-lyric-renderer.js`、`desktopLyric*` 参数及 `--preview-*` 变量，不建立额外时间轴或轮询。诗笺和花枝属于当前句强调层，逐字高亮为暖金；字体、字号、颜色、行高、翻译、描边、透明度、显示行数及暂停隐藏仍由共享设置决定。默认主字 48px、行高 1.2、单句显示，诗笺最小高度 108px；内容增多时允许扩高。字体参数「月渡花汀文楷」在渲染时映射为当前资源版本专用字体名，自定义字体仍走共享参数。字体资源为可选项，旧套装继续有效；新套装携带完整字符覆盖的 23 个 WOFF2 分片和 OFL 许可证。退出资源样式时随套装样式表一起移除装饰与字体。逐字节点挂载前清空该行的静态文字，避免原句和逐字层重复显示。

[overlays/lyric-window.js](../../../public/js/overlays/lyric-window.js):

- 画布使用静态示例歌词，预览投影关闭暂停隐藏；保存的 `desktopLyricHideOnPause` 不变，正式输出仍按实际播放状态决定是否隐藏。
- 使用方:管理页「复制桌面歌词」复制规范地址 `/lyrics`,供浏览器或 浏览器源使用;页面背景透明,实际输出不包含管理页预览使用的网格/纯色辅助背景。
- 数据:首次连接和重连均从 `/ws` 的 snapshot 取得 `desktopLyric*` 设置、`lyricState` 和 `lyricTimeline`，并消费增量 `lyric-state`、`lyric-timeline`。页面不再请求不存在的 `GET /api/settings`。
- 渲染:直接复用 `admin/desktop-lyric-preview.js` 的完整时间轴渲染器,显示整首歌词、翻译、罗马音、当前行逐字进度、长间奏三秒倒计时和播放进度;逐字高亮支持连续填充与按时间点亮两种模式,隐藏 `desktopLyricPreviewPlayback` 只提供 aria-live 文本,当前行 `LyricWordAnimator` 是唯一视觉逐字更新源。样式设置通过同一组 `--preview-*` CSS 变量应用,因此浏览器源与管理页实时预览一致。
- 显示行数:设置 `desktopLyricVisibleLines` 为 `0` 时保持整首可见;正整数仍创建整首时间轴,只将当前行窗口外的行标记为不可见。`1` 仅显示当前行;偶数向下扩展,奇数向上下扩展,整首数据继续保留以保证同步和自动跟随。
- 逐字动效:连续填充与按字点亮共用轻跳效果，按原始字词时间上浮、轻微放大，长音保持后柔和落回；默认样式、月渡花汀及共享该渲染器的样式均适用。暂停与跳转对齐播放位置，只为当前字词及短暂收尾创建位移动画；换行、关闭逐字或性能降级时释放，系统减少动态效果时只保留高亮。无逐字时间数据时保持原有整行显示，不推算字词时间。
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

独立弹幕的布局契约由 `shared/danmaku-layout.js` 定义为 `{canvas,contentScale,regions}`，与 main 和服务器镜像保持一致；公共分辨率预设由 `shared/canvas-presets.js` 提供1280×720、1920×1080默认、2560×1440、3840×2160、1080×1920及自定义（320～7680整数）。十种样式各自记忆 `{x,y,width,height}`；七种固定默认距左/下40，尺寸依次为bubble380×560、signal560×600、minimal294×480、ranked640×640、transparent520×540、identity640×560、moonlit640×720；outline/cream/glow默认铺满，称“区域随机”。独立弹幕区域至少64×64且不能超出其画布；统一编辑器的三栏布局及公共图层操作见下方组件系统说明。

固定样式按当前区域宽度相对该样式默认宽度的比例，统一缩放文字、头像、卡片、装饰和间距；区域高度通常决定可见条数，移动区域不改变外观；特别矮的区域限制整体倍率，确保内边距后仍有内容空间。礼物与SC卡片在设计空间内先适配扣除两侧各12px后的可用宽度，再随区域一起缩放，避免窄区域裁掉数量或图片。随机样式以contentScale为倍率上限，窄区域同时缩小内容，保证头像和装饰仍有排版空间。固定与随机样式都会将超出可用宽高的单条消息整体缩小，尺寸恢复后重新按自然大小排版；长昵称、礼物名、数量和金额允许换行，不以省略号代替内容。区域越小，文字也越小；消息过多时仍按原规则整条移除最旧消息。同比改分辨率会同比改变区域和contentScale；换宽高比保留contentScale，未调整的默认区域继续靠左下，自定义区域收敛到新边界，原铺满区域继续铺满。styleOptions保存逻辑字号，独立编辑器的画布字号使用当前实际内容倍率换算。`overlays/danmaku-canvas.js` 与服务器使用同一CSS变量/坐标规则，正式页等比居中、透明且不含选框。网页来源尺寸与画布一致即可精确还原位置。旧配置layout:null继续使用原来源窗口布局，旧PUT省略layout不清除已保存画布，首次显式应用编辑器才启用新画布。

### 月渡花汀

新增固定样式 `moonlit`：灰色普通弹幕、霁蓝舰长、藕紫提督、胭脂红总督，矩形中放头像、昵称及文字/表情，头像旁使用现有 B 站三档大航海徽章。新消息先显示头像、昵称、正文及对应身份深色的小矩形底框（比昵称底色更深、更接近黑色）；停留约 333ms 后，以 900ms 从左向右覆盖墨迹和花饰，前缘为约占元素宽度 20% 的柔边遮罩而非硬裁切，底框始终保留，不淡出或删除。固定列表以相对位置动画移动，时长为 420ms 加本轮最大位移像素（普通单行约 520ms，卷轴与上任更长，上限 760ms），同一轮各行共用时长与曲线，从静止起步时先短暂加速而非瞬间达到峰值速度；避免整卡 transform 图层切换改变文字栅格化效果；连续追加从当前可见位置与当前速度衔接，新消息跟随队尾保持间距，支持向上与向下滚动及缩放。移出显示区域的旧消息在移动完成后清理，消息数量上限仍立即生效。由 `danmaku-moonlit.js` 只负责装饰组合，主题 CSS 和透明山水/花鸟素材独立维护，消息仍复用安全渲染器与现有 feed。

购买大航海采用中央头像、左侧斜向错落的两字称谓、右侧斜向错落的“上任”及下方姓名带。三档沿用对应身份色；山水、月轮、背景与头像先用 1450ms 从上到下显现，1500ms 时开始以 1550ms 从左到右显现题字、姓名与恰好三只鸟。正式 `gift` 新增可选 `avatarUrl` 和购买等级 `giftGuardLevel`，经 Electron 云端事件白名单验证后传入组件；发送者当前身份不能触发上任。普通礼物与 SC 共用固定大小的银蓝花枝、滚轴、双边线与月白纸面组成的紧凑卷轴，含头像、昵称和已结算总额；普通礼物显示礼物名与数量，SC 在相同位置显示完整原文，不设正文固定高度。卷轴采用约 150px 高的紧凑单行布局，头像在左、昵称与金额同排、正文及数量在下；长文自然增高。卷轴先以 1400ms 从右向左展开纸面、山水底纹、头像和文字，滚轴中心始终贴合纸面裁切边界，展开后停在左侧；展开完成后，再以 1200ms 从左向右显现双边线、笔刷边缘和花枝，第一阶段不显示外围装饰。除纸面展开保持与滚轴对齐的硬裁切外，墨迹、花饰、外围装饰、上任场景与题字的显现都使用移动的柔边遮罩。纸面内部的山水底纹向左延伸，透明度从左端 0 平滑过渡到右端 55%，与纸面共用从右向左的展开裁切；头像和文字在纸面内垂直居中。外围装饰完成后，绢面微光以 52% 峰值强度从左向右扫过一次，持续 1800ms 后消失；减少动态效果时不播放微光。银蓝月白色明确替代本主题的 SC 价格色。其他样式保持原规则。旧字段缺失时使用普通礼物卷轴/头像回退，旧九区域布局只补默认 moonlit 区域。

合成预览打开或刷新时先显示普通礼物，再显示舰长感谢，其余样例随机无放回播放，包含三档上任，复用原播放和清理机制；减少动态效果时直接显示完整内容。服务器公开页与本机预览素材、结构、动画同步，服务端部署后新样式才可用于在线来源。覆盖 `test/danmaku/danmaku-message-renderer.test.js`、`test/danmaku/danmaku-local-preview.test.js` 与 `test/scenes/scene-cloud-controller.test.js`。

### 本地页面 /danmaku 与示例

`whiteframe`（白描）复用区域随机布局：透明底、细白色圆角框，昵称居中在框上方；框内显示弹幕或礼物名 × 数量，礼物已结算总额居中放在框下（如 `138¥`，缺失金额为 `—`）。不显示头像、徽章与送出前缀，所有身份默认白色。支持字体、字号、文字颜色、停留时长及随机位置参数，不提供背景或礼物图片选项。旧布局缺少该样式时补齐全画布区域，不改变已有区域。桌面预览和服务器展示使用同一结构与样式；在线来源需要部署对应服务端版本。

`overlays/danmaku.js` 与 `danmaku-preview.js` 复用十种样式和feed。预览随机混播内置弹幕（总督、提督、舰长、粉丝、普通观众和主播表情）、送礼通知及当前样式支持的 SC；首条立即出现，后续每隔 0.8～2.2 秒随机追加一条。每轮不重复抽取，全部样例播放完再开始新一轮，每条生成新消息ID和时间戳。复用正式feed的滚动、区域裁剪、随机排布和停留时间过期；可手动“重新播放”，切换样式或参数重新演示。页面隐藏时暂停，恢复时继续播放而不补发积压消息；关闭页面清理播放计时器、可见性监听、待渲染帧和feed。不连接WebSocket。素材本地，不发外部图片请求。单独打开时兼容初始style/styleOptions/时长query并通过可用的history保存草稿；嵌入时由受信父页保留草稿。经典样式、画中人在画布模式共用区域内容倍率，避免再次缩放；旧非画布模式保留原600px基准缩放。

小表情 `kind:inline` 无论夹在文字里、重复发送或单独发送，图片高度均为正文的 `1em`；整张表情包 `kind:sticker` 使用原尺寸的 1.4 倍，即普通样式 `4.48em`、经典样式与画中人 `5.74em`，宽度按原比例并受现有画布限制。缺少 kind 的旧载荷仍沿用整条匹配时放大的兼容分类。预览文字示例显式标记 inline，纯图片示例标记 sticker。

保留的非预览本地入口以 `topic=danmaku` 连接 WebSocket，按 snapshot 的 `settings.danmakuOverlayStyle` / `danmakuFullscreenDurationSeconds` 切换样式和停留时间，从 `danmakuFeed` 恢复消息并消费 `danmaku:message`。按消息 `id` 去重，同一帧批量追加；连接中断时指数退避重连，连接状态仍以 `liveStatus` 为准。客户端复制和打开的正式 浏览器源地址由服务器提供，本地预览不改变服务器配置。

本地页面对去重、截取最近 50 条后的消息内容做完整比较。内容未变且 feed 无需初始化时，快照保留现有消息节点、到期计时器及尚未绘制的增量帧；仍更新直播连接状态。首次空快照、实际消息修正/清空/重连补数、样式或全屏期限变更导致的 feed 重建仍执行恢复。此优化不改变远端正式 overlay 的 SSE，也不承诺有变化的快照完全免于重建。真实页面模块和共享 feed 的节点/计时器回归见 `test/danmaku/danmaku-snapshot-stability.test.js`。

弹幕工具的显示顺序为直播链接、黑名单与屏蔽词、样式选择、参数调节、应用操作。`danmaku-style-options.js` 定义各样式字体、正文字号范围、背景不透明度及礼物插画选项；无底色样式不显示底色参数，蝶恋花与流光溢彩没有独立礼物图位。`styleOptions` 由服务端按样式保存，Electron 仅通过既有认证通道校验和投影；旧服务器不支持时禁用新参数并提示更新。切换样式保留各自草稿，恢复默认只重置当前样式，仍需显式应用。七种固定样式另有“滚动方向”：up 为从下向上（默认），down 为从上向下；方向随当前样式草稿保存、传给本地预览并在应用后通过服务器推送更新。随机样式隐藏且不接受该参数；反向排列仍淘汰最旧消息。原有全屏停留时间位于参数区。

固定弹幕常规参数另有“边缘处理”，保存为当前样式的 `styleOptions.<style>.edgeFade`：`both` 上下两端渐隐、`top` 仅上边渐隐、`bottom` 仅下边渐隐、`none` 直接切断。明确选择的上/下边不随滚动方向改变；旧值 `single` 仍兼容，按滚动方向解析为移出端的 `top` 或 `bottom`，界面显示具体边缘。流霞缺省为 `both`，其他固定样式保留原有 `single`；渐隐范围沿用 32px，星语保留 24px，随内容一起缩放。公共 `motion.css` 负责遮罩，样式只指定自身范围；不改消息淘汰、动画或计时。管理页、画布参数与独立预览共用草稿，恢复默认只重置当前样式；随机和飘窗隐藏且拒绝此字段。旧记录缺失时采用上述默认，旧 PUT 省略 `styleOptions` 时保留已有设置；服务端正式来源同步支持后生效。

`shared/danmaku-appearance-draft.js` 为管理页和场景编辑器提供字段转换、当前样式草稿更新、重置及停留时间检查；两端保留各自 DOM、授权与保存状态，画布字号换算仍归预览控制器。样式名称、支持名单与随机布局能力由 `shared/danmaku-style-options.js` 的样式表统一提供。

预览参数传递与草稿保留方式如上，样式切换不清除其他样式的区域或参数。原图模式使用内置合成礼物图片，不请求直播或外部图片。正式服务器浏览器源从已有礼物目录取得精确已结算版本的 B 站图片地址，经可选 `giftImageUrl` 随原 `gift` 事件传递；浏览器直接加载，使用 `no-referrer`，失败保留样式插画。服务器不转发图片二进制；缺少新字段时行为兼容。正式协议和各样式边界见服务端 `public-overlay-api.md` / OpenAPI `OverlayStyleOptions`。

页面与 `/games` 的画猜消息共同复用 `danmaku-feed.js` DOM 组件。组件不读取 WebSocket 或领域状态，只接收显式消息数组和图片 URL resolver：

- 三种随机样式在本地预览和正式直播的停留时间最后 400ms 原地渐进淡出，曲线为 `cubic-bezier(0.4, 0, 1, 1)`，不延长总停留时间。减少动态效果或不支持原生动画时按期直接清理；移除、重绘和销毁时取消淡出动画及计时器。
- `measureDanmakuText(message)` 按中英文混合文本的视觉长度估算行数、宽度百分比和最小高度。
- 留白风格在头像下沿居中显示 `LV{medalLevel}`，复用消息渲染器从本条消息的独立 `medalLevel` 写入头像数据属性；缺少灯牌名称不影响已知等级。缺失、零或非法等级不显示，不从舰队身份推算，也不复用上一条消息的等级。该风格不再在正文下重复显示粉丝牌；其他风格沿用原徽章。
- `kind:'gift'` 使用专用 `is-gift` 节点，以 `textContent` 展示送礼人、“送出”、礼物名称和数量。登录账号发送的感谢按普通弹幕渲染，不转换成礼物卡，不额外生成感谢文案，也不提供单独的感谢示例。除保持原样的蝶恋花外，礼物采用与普通聊天不同的排版和造型：琉璃为奶油色猫咪插画卡（昵称首字圆章、莓红数量胶囊），青墨笺为带 1px 青色切角描边的墨蓝通知牌，经典样式为带接缝线的礼章票券，留白的礼物使用带细金边的深蓝渐变星光卡，画中人为无头像的单栏双线框纪念卡，一纸素笺为带虚线分隔的玫瑰色礼物小票，杏花白为花束礼物卡，流光溢彩为同色高光弧的紧凑通知卡。除蝶恋花外，礼物卡入场时额外播放一次 ≤360ms 的光泽扫过（`::after` 只改变背景位置和透明度，不改变入场方向、时长或布局，减少动态效果时不播放）。选择“礼物原图”且图片加载成功时，插画节点加 `has-image`，清除样式插画的 mask 和背景，原图不会被裁成线框；加载失败恢复样式插画。除蝶恋花外，送礼通知使用紧凑的两行结构：昵称在上，“送出＋礼物名”和数量在下一行，不显示“谢谢支持”。`gifts.css` 仅复用内容结构，各风格文件拥有配色、轮廓和装饰；插画仅用于适合的样式。素材全部内置于 `public/img/overlays/danmaku-gifts/`，各风格不复用同一礼物图。该展示能力不新增公开 SSE 事件或礼物业务处理链路。
- 本地预览使用场景编辑器，按可用视口等比缩放。消息在当前样式的区域内动态展示；固定样式按区域高度移除最旧的超限消息，随机样式沿用正式直播的随机布局和寿命。样式切换重新播放，地址不变。
- 留白和杏花白礼物卡通过 `showGiftTotal` 选项把数量放在礼物名旁边，原数量位置显示 `giftTotalPrice`（人民币元）的 `¥` 金额，最多两位小数。金额直接来自已结算总额；旧消息缺失金额时显示 `—`。杏花白沿用右侧粉色金额框，名称旁的数量不带底框。其他样式继续显示原数量布局。本地预览使用合成总额，正式 overlay 消费服务器同名展示字段。

- 旧非画布布局的固定礼物卡中，`bubble` / `signal` / `ranked` / `transparent` / `identity` 沿用原客户端 1.5 倍尺寸上限（460px 设计宽度 → 690px 显示宽度）。扣除两侧各 12px 后的空间不足时，卡片、昵称、礼物文字、数量或金额、头像、装饰和间距一起等比缩小；高度通常影响可见条数，单条过高时再整体缩小。经典样式和画中人抵消列表已有倍率，避免重复缩放。列表裁剪计入节点自身的 CSS zoom；蝶恋花、普通弹幕及全屏随机礼物同样在单条超出可用区域时整体缩小。画布布局使用上面的区域整体缩放规则，本地预览与正式 overlay 同步。

- `createDanmakuFeed(root, options).render(items)` 使用 `DocumentFragment`、`textContent` 和受控 `<img>` 创建消息，`append(item)` 只追加新节点，不重建已有 DOM。游戏层继续按估算高度保留当前可见区及上方约 5 个视口并自动滚到底部；固定 `/danmaku` 配置 `offscreenViewports: 0`，按实际布局高度、行间距和容器内边距移除最旧的超限节点，保留完整可见消息。固定区域和全屏模式的 `ResizeObserver` 同时观察容器与消息，图片加载、昵称换行或窗口缩放后在动画帧内合并测量与调整，使用不受入场动画缩放影响的布局尺寸。节点移除或替换时取消观察，销毁时取消布局帧和到期计时器。表情按精确触发文本切分，加载失败回退原触发文本，不使用 `innerHTML`。页面数据和断线恢复快照仍分别硬限制为最近 50 条，共享组件默认上限仍为 120 条。
- 流光溢彩（`glow`）将发送者昵称居中放在消息框上方，文字或表情在深色半透明圆角框内，边框带双层柔光，并在 2px 边框上叠一段静态白色高光弧（按 `data-tone` 取四个角度，不循环播放；不支持 mask 合成的内核省略高光弧），不显示头像/徽章。`ranked-palette.css` 为它和经典样式提供同一份身份色，普通观众/粉丝青蓝、舰长蓝、提督紫、总督红、主播绿色覆盖优先。本地预览与正式直播共用随机布局与时长，礼物采用同色紧凑双行通知卡。

- `starveil`（点点流萤）复用流光溢彩的区域随机布局、防重叠和停留时长；昵称居中置于深色半透明胶囊上方，文字、细描边与柔光从香槟金、雾玫瑰、冰蓝、淡紫、青瓷、暖桃六组颜色中按消息种子稳定随机选择，不随身份或重新排版变色。正文/表情与真实礼物名称、数量完整显示，不显示头像、徽章和 SC。支持字体、字号、正文颜色、背景透明度、中心倾向和离散程度；旧布局缺少 starveil 时补齐当前画布区域。本地预览与服务端正式画面采用同一造型。
- 经典样式（`ranked`）通过独立 `data-streamer` 标记将主播名字标签和正文气泡设为绿色，并隐藏主播船锚；普通观众保持青蓝色。可选 `isStreamer` 只由当前房间主播 UID 与本条发送 UID 比较产生，缺失按 false；本地 B 站消息入口、feed 投影和服务器 SSE 均保留该展示语义，不公开新增 UID，也不改变其他风格的 `data-identity`。本地纯表情示例同时展示主播身份。
- 共享组件按当前房间身份为每条消息输出 `data-identity=viewer|fan|captain|admiral|governor`；大航海身份优先，拥有大航海且佩戴当前房间灯牌时仍同时输出两枚徽标。五套固定弹幕姬只共享该语义，不共享身份视觉：`signal` 使用分级信号色、左侧强调色晕染、舰长/提督/总督实色标签和“名称｜等级”分段粉丝牌，`bubble` 使用 20/20/20/6 圆角的午夜玻璃气泡、头像双圈、粉丝牌胶囊和柔和分级光晕，`minimal` 不绘制左侧色条，普通观众省略身份签，粉丝与大航海身份保留单字身份签和低遮挡分级色；`ranked` 隐藏徽标，以普通/粉丝共用的石墨灰及舰长蓝、提督紫、总督金四档整卡底色表达身份，用户名和正文在左、头像在右；`transparent` 不绘制卡片底色、边框或大航海徽标，保留头像右侧的昵称、正文和下方粉丝牌等级，并用蓝、紫、红色昵称区分舰长、提督、总督。`outline` 虽保留同一 DOM 身份字段以兼容共享组件，但 CSS 统一隐藏头像、徽标和灯牌；卡片使用浅白半透明底、18px 圆角和分层柔和阴影，昵称前的身份色圆点与昵称颜色一致：普通观众灰色，大航海使用蓝紫红识别色；正文为深色，左对齐排版并轻微淡入。各样式昵称为 14–16px，徽章与等级不小于 12px；数量、金额和等级使用 `--danmaku-num-font` 等宽数字。旧版直播软件内核不支持 `color-mix` 时，各样式以 RGB 通道变量或 `@supports not` 回退保留文字背后的底色。
- `ranked` 使用 624×640 固定设计画布、最大 600px 卡片宽度和 10px 卡片间距，卡片随正文增高；`calculateRankedOverlayScale(width, height)` 取 `min(1, width / 624, height / 640)` 并投影到 `--ranked-scale`，让窗口 resize 时头像、文字和卡片统一等比缩放。浏览器源比例与设计画布不一致时在未占满的一轴保留透明空白，不拉伸或单独重排内部元素。
- `/danmaku` 的观众头像由浏览器直接读取弹幕中携带的 HTTPS B 站 CDN 地址，保留域名白名单且拒绝带账号密码的 URL；头像和模糊底图共享同一地址，使用 `no-referrer` 并异步解码头像，不逐条查询用户资料或让服务器转发头像。图片缺失或失败沿用各样式的默认展示。表情继续使用 `/api/bilibili/avatar` 本地代理；未通过 B 站域名白名单的图片不会进入服务端公开流。
- 固定区域样式的网格行占满可用高度，使消息容器的裁剪预算来自浏览器源视口，而不是当前消息堆叠高度；少量消息仍靠底部排列。追加消息后，边界处的旧消息保留仍在范围内的部分，由容器裁掉越界部分；旧消息离开的一侧（向上滚动为顶部、向下滚动为底部）由 `motion.css` 统一加 32px 渐隐遮罩，不再被硬边切断，完全移出后才清理；向上、向下滚动及弹幕、礼物、SC 共用该规则，仍受消息数量上限约束。
- 各样式的图片表情受正文宽度约束，行内图片不使用负纵向边距，昵称与粉丝牌必要时分行。琉璃保留 12px 消息间距，不绘制底部尾角；直播气泡设计画布内的消息间距为 10px。画中人(`identity`)的普通观众与粉丝将本条头像放大模糊后铺底，保留头像的深浅和色彩分布，白字加细暗描边；右侧清晰头像宽 180px，左侧 30% 渐隐，图片不撑高卡片。缺失或失败时两层均使用默认插画，舰长/提督/总督继续使用蓝/紫/红身份底色，礼物保持独立样式。背景复用成功加载且经过 URL resolver 的图片，不读取跨域像素；本地和服务器样式一致。卡片宽 600px、最小高度 92px、间距 6px，按可用宽度等比缩小，正文换行时向下增长。一纸素笺和杏花白的昵称放在卡片边框内，正文间隔 6px；消息距离视口边缘至少 16px，消息之间至少 10px，已放得下的消息保留位置，空间不足时先移除最旧消息。
- 青墨笺的粉丝牌等级跟随昵称信息行排版，不再绝对定位到卡片底边；粉丝牌名称在旧布局允许收缩并显示省略号，画布布局则换行完整显示，等级不会挤到正文或边框上。
- 蝶恋花样式的昵称向下偏移 6px，居中占正文区域宽度的 70%，长昵称保持 16px 字号自动换行，连续英文也可在字符间折行。行内表情不使用负纵向边距，图片占用完整行高，避免最后一条消息的表情底部超出消息容器并被裁切。

### 星语固定弹幕

`starlight`（星语）为透明白色固定弹幕：普通消息居中显示昵称、细横线与原文，表情保留；礼物左侧显示昵称和内容、右侧显示实际人民币金额，数量紧接礼物名；SC 顶部显示昵称与两位小数金额，正文在下方占满可用宽度，顶部空间不足时金额自动换行。四角星在装饰层缩放闪烁，消息复用固定列表平滑纵向滚动；减少动态效果时停用星光和位移。隐藏头像、身份牌、底色与礼物原图参数，沿用字体、字号、正文色和上下滚动设置。SC 使用白色主题，不套用六款旧样式的价格底板。长昵称与长留言换行，过高单条按现有区域规则整体适配。默认区域为 520×640；旧画布仅补齐缺失的星语区域，其他区域不变。主题文件 `danmaku/starlight.css` 与服务端同名主题一致。

`prismatic`（流霞）复用固定列表、头像、表情和礼物渲染链路，默认区域 640×720，旧布局只补充缺失区域。上方使用 B 站荣耀勋章、当前房间粉丝牌及大航海图标和白色昵称；当前房间的大航海文字使用逐消息稳定的柔彩混色气泡，普通文字用白色气泡，独立图片/表情内容区透明，礼物用白色条和已结算人民币总额。详情与参考图见[流霞规格](../../../specs/danmaku-prismatic.md)。字体、字号（18–48）、正文色和上下滚动使用公共设置，默认正文色 `#292b32`；不提供底色透明度或礼物原图参数。大航海购买使用居中圆头像、白底昵称和感谢文案的渐变卡：舰长珠光香槟金、提督冰蓝紫晶、总督浓郁玫瑰金，以多段渐变和静态高光形成层次。右下角用粗体白字显示本次人民币结算总额的上半部分，下半部分沿卡片底边裁切；缺失或非法金额省略，不重复乘数量。开通／续费读取明确的 B 站通知动作，未知时显示“感谢支持”；陪伴天数优先使用当次通知的明确天数，否则按绑定房主与观众 UID 读取陪伴榜 `accompany`，缺失时省略，不换算购买月数或使用本地补录。SC 为薄荷至粉色渐变，上方昵称与右侧白色 CN¥ 金额胶囊，下方完整原文与换行；不显示头像和金额旁圆点，保持实际金额。大航海与 SC 卡片均铺满弹幕内容区，与容器左右边缘对齐，沿用现有画布安全留白；共用字号基准，SC 昵称和正文左边线一致、金额靠右。长内容超出可用高度时缩小字号并重新换行，保留卡片宽度和完整文本。感谢卡由主题模块负责，SC 共用 `danmaku-superchat-renderer.js`，普通礼物保持白色条。Electron 事件投影及场景缓冲只保留经过验证的可选 `honorLevel`、`roomGuardLevel`、`roomMedal` 展示字段；大航海感谢另保留可选 `giftGuardLevel`、`guardAction`、`guardAccompanyDays`，后两项仅在有效购买等级下接受。旧消息缺失时隐藏相关徽章，不把佩戴的其他房间粉丝牌或旧 `guardLevel` 推断为当前房间身份。

### 固定样式的 SC 展示

正式直播软件网页源由 LIRA Server 的 `superchat` SSE 事件提供；本机 `/danmaku?preview=1` 用合成 SC 验证同一结构，保留的旧本地捕捉入口不新增 SC 展示链。六种固定样式分别为经典矩形、底部签名行气泡、墨蓝切角面板、居中对称细饰（金额使用 Georgia 旧式数字）、透明开口细框和头像伸出连续底板；DOM 使用独立 `is-superchat/sc-*`，CSS 由 `danmaku/superchat.css` 负责，不复用聊天或礼物正文。

原文与换行通过 textContent 完整显示，金额来自实际 price，不显示固定 SC 标签或感谢模板。六款均显示发送者昵称（`.sc-name`），经典、画中人和琉璃同时显示头像；金额拆为缩小的 `¥`（`.sc-currency`）和数值（`.sc-value`）；长文换行，单条高于可用区域时整体缩放。颜色优先采用 B 站随消息下发的有效十六进制值；缺失字段按 30/50/100/500/1000/2000 档位回退，2 元有自有色就使用自有色，否则共用 30 元蓝色。价格色不使用普通弹幕身份色或自定义正文色。精确色表与公开字段由 Server `public-overlay-api.md` / `SuperChatEvent` 维护。

本地样例统一由 `public/js/overlays/danmaku-preview-samples.js` 提供，内置样式与导入 CSS 的弹幕预览共用。文本按二次元、模拟真实聊天分池，普通弹幕和 SC 均覆盖短句、36–40 字符长句与复读，所有样例正文（含标点、换行和表情占位文本）不超过 40 个 Unicode 字符。另含单个／连续行内小表情、文字加表情、独立表情包、不同名称／数量／金额的礼物，以及舰长、提督、总督的开通或续费通知；礼物金额与陪伴天数仅为合成展示值。SC 覆盖 ¥2、30、50、100、500、1000、2000 七档，每档各有两种语气。图片复用内置样例素材，不请求外部资源。内置预览每轮无放回混播，保留流霞、月渡花汀的开场顺序；区域随机与飘窗样式过滤 SC，与正式输出一致。覆盖测试：`test/danmaku/danmaku-preview-samples.test.js`、`test/danmaku/danmaku-local-preview.test.js`、`test/danmaku/danmaku-message-renderer.test.js`，导入 CSS 的复用与正式输出隔离见 `test/admin/canvas-empty-previews.test.js`；真实服务端造型及画布验收见 Server `e2e/overlay-superchat.spec.js`。

昵称池使用 2–16 字符的合成用户名，涵盖短中文、二次元昵称、中英数字混合、下划线／短横线、默认账号风格和 16 字符长名；同一观众的弹幕、SC、礼物与大航海通知复用名字，入场通知也由样例模块提供。长度上限核对自 [B 站个人中心](https://account.bilibili.com/account/setting) 当前昵称输入框的 `maxlength: 16`（2026-10-10），取名内容遵循[官方昵称规则](https://www.bilibili.com/blackboard/help.html#/?qid=310&pid=309)。这些名字仅用于本地预览，不查询账号是否存在或可注册。

## 6.2 游戏叠加层(/games)的弹幕组件

[overlays/games.js](../../../public/js/overlays/games.js) 是游戏入口，只传入会话中的 `session.danmaku`。画我猜的 `#drawDanmakuFeed` 固定声明 `data-style="bubble"`，不读取或跟随弹幕姬的 `danmakuOverlayStyle` 设置；`games.css` 独立实现适合游戏窄栏的五身份气泡视觉，并自动受益于共享组件的安全表情渲染。

游戏和转盘共用 `socket-client.js` 的连接生命周期。每次连接成功分别从 `/api/games/session`、`/api/wheel` 补齐状态；游戏请求失败按最多 5 秒间隔重试；增量在 HTTP 恢复期间有界缓存并按版本衔接，完整更新使旧请求失效。转盘请求仍最多重试四次，收到更新后丢弃较旧的 HTTP 响应。转盘通过专用 REST 读取和 `wheel:update` 恢复，不假定普通 snapshot 包含转盘状态。现有互动端点保留，页面凭据仅允许 §1.0 列出的本页操作。

- `games.css` 将短消息显示为紧凑气泡，长消息按宽度增长并自然换行增高；交错对齐、实时标题栏和 reduced-motion 降级只属于视觉层，不改变弹幕字段或游戏协议。

## 6.3 萌时钟(/clock)

[overlays/clock.js](../../../public/js/overlays/clock.js) 驱动固定 `/clock`
浏览器源，默认首帧使用本页凭据从只读接口 `GET /api/clock/config` 读取已保存设置，并使用
设备本地时区显示当前时间、日期和星期。页面外层透明；横向样式使用 560×190
设计坐标，竖向时间轴使用 220×380，月渡花汀使用 560×360。输出按当前样式的可见内容收紧边界，
仅留每边 4px；装饰卡片保留完整卡面，透明款包含当前显示的时间、日期、时段与装饰。
场景选中框随样式及日期/秒数开关同时调整宽高，保持当前缩放；拖动任意缩放柄时等比缩放，
高度自动跟随内容。保存后的独立浏览器源和场景输出使用相同内容边界。

- 风格参数仅接受 `style=peach|starlight|soda|timeline-horizontal|timeline-vertical|digital|orbit|flip|moonlit-fan`，
  非法或缺失值回退桃桃便签(`peach`)；前三套分别使用奶油蜜桃兔耳、靛蓝月亮云朵
  与薄荷气泡小鸭。横向刻度和竖向刻度使用无卡片底的细线排版、年份与英文星期，
  其中竖向款适配 240×400 Browser Source（含页面边距）。白字数显(`digital`)
  使用透明背景、白色粗窄数字和细暗描边，上排为 `YYYY-MM-DD` 与英文星期，
  下排为同字号的 `HH:MM:SS`，沿用横向画布。星轨时钟(`orbit`) 使用白字暗描边、
  星形与环绕线，下排为 `YYYY.MM.DD` 和中文星期；翻牌时钟(`flip`) 使用日期/英文星期
  小牌和时/分/秒双数字牌，均沿用横向画布。
- 月渡花汀(`moonlit-fan`) 由 `clock/moonlit-fan.css` 拥有，复用开播主题的银蓝折扇、
  白山茶与流苏原画；月轮提供浅底靛青字与靛蓝底月白字两套配色，显示衬线数字、小号秒数和中文日期/星期。
  外围透明，保留完整装饰边界。小预览与组件画布均可选择，沿用现有日期、秒数和小时制开关。
- 月渡花汀的 `moonMode=light|dark|auto` 对应固定浅色、固定深色和自动交替，默认 `light`；
  `moonIntervalSeconds` 为 1–86400 的整数秒，默认 30。只有自动交替显示间隔控件。
  自动配色按设备 Unix 时间的间隔段奇偶计算，复用秒调度器；相同间隔的预览与正式输出同步，
  隐藏恢复或重复设置消息不重置相位。两项 URL 参数独立覆盖保存值，旧配置和旧独立场景缺省补足 light/30；
  显式非法值拒绝保存，读取非法存量值或 URL 值时回退默认值。其他样式不使用这两项外观参数。
- 翻牌颜色为 `flipFrameColor` / `flipFaceColor` / `flipTextColor`，对应外框、牌面、数字，
  仅接受 `#RRGGBB`；默认 `#e4e4e4` / `#ffffff` / `#303030`。参数覆盖保存配置时独立合并，
  非法颜色回退默认值。设置面板提供经典白、石墨黑、香芋紫预设及三个自定义颜色选择器。
- `date=0|1`、`seconds=0|1`、`format=12|24` 控制日期、秒数和小时制；非法值
  回退默认显示日期/秒数与 24 小时制。`label` 合并空白并截到 16 个 Unicode
  字符，始终通过 `textContent` 输出；透明时间轴、白字数显、星轨、翻牌和月渡花汀不显示角标文案。
- 时钟按下一秒边界使用一次性 timeout 更新；页面隐藏时停止调度，恢复可见后
  立即校时。冒号、星点与月渡花汀流苏动效在 `prefers-reduced-motion: reduce` 下停用。
  翻牌由 [clock-flip.js](../../../public/js/overlays/clock-flip.js) 持有上下半牌与 WAAPI 动画，
  仅数值变化时旋转；首次展示、隐藏字段/页面和减少动态效果时直接校准。
  重入动画和切换样式取消旧动画，复用同一个时钟调度器。
- Admin 组件页的「时钟」卡片只展示并复制固定地址；表单修改经受 token 保护的
  `POST /api/settings` 显式保存。小预览与公共窗口使用 `componentPreview=1` 及父页消息，
  不读取正式配置流；打开公共窗口时卸载小预览，关闭后恢复。样式切换使用 160ms 淡入，
  减少动态效果时停用，不重载页面或重启计时器。旧完整参数内嵌预览消息仍兼容。
- 正式来源使用 `createOverlaySocket()` 接收 clock scope 的展示设置键；重连回读配置，
  晚到 HTTP 不覆盖新快照。旧 URL 显式参数逐字段覆盖保存设置；配置更新复用同一个计时器。

### 时钟与弹幕的逐样式效果

`component-style-parameters.js` 拥有纯参数范围、默认编辑值、能力表与校验，`component-style-effects.js` 拥有效果节点、原属性恢复、动态消息观察和释放；服务器使用同合同镜像。配置新增可选 `styleParameters` 映射，键为预设名或 `css:<uuid>` / `media:<uuid>` / `resource:<uuid>`；浏览器源使用 `web:<uuid>` 或 `browser`，最多 64 个档案。映射沿用组件外观的归属：内置公共参数及资源型样式按同一样式共享，导入 CSS、普通图片/视频与外部网页按实例保存。缺少某组沿用作者样式，空样式对象恢复该款新增效果；原有 `styleOptions` 保持独立。

效果目标按具体预设区分文字、底板、透明图案和月轮；白平衡、色阶与亮部辉光保持 alpha，旋转/倾斜与原缩放、入场、翻页及飘窗移动组合。重配置先恢复原属性，再应用新样式；销毁时清理滤镜、观察器和监听。导入 CSS 沿用原生或 BLC/blivechat 已知结构；隔离 HTML 只提供 CSS 整体外投影、外发光、矩形边框、变换，不提供跨框架 SVG 调色。

弹幕的 `showEntryMessages` 位于当前样式档案内，默认 false。服务器的短暂 `entry` 只携带本场公开展示字段，本机缓存不重放旧进房，显示开关独立于自动欢迎发送。新增参数沿用场景和预览保存通道，时钟默认设置由 `clockStyleParameters` JSON 保存；在线弹幕由所属租户的 overlay-settings 保存。用户参数表与兼容边界见[外观效果指南](../../guides/component-style-parameters.md)。

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
展示已有样式；“套装”入口按已导入的包显示名称、数量和样式卡片，点击卡片添加对应组件。
套装成员来自本机已安装包的 styles 数组，按包分组显示；初始不再提供月渡花汀卡片。清单允许可变种类、数量和同类多个样式；分类页与套装页读取同一个库。

导入后，“背景”分类和套装提供月渡花汀静态/动态两种背景。`background` 复用独立组件注册，`style` 默认为 `none`，导入后可为 `moonlit`（静态）或 `moonlit-animated`；新增时按当前画布宽高铺满并放在最上层；作为底图时需将图层拖到组件栏最右侧，之后可移动、缩放、隐藏和调整层级。`overlays/background.js` 先接入预览协议，再根据配置映射并解码图片；动态版由 `background-moonlit.js` 延迟加载并播放 `img/overlays/backgrounds/moonlit-loop-hq-60.webm`：同画风重新绘制底景、月亮、柳叶、灯笼、云雾与花瓣，逐枝节/逐叶动画和重新绘制的水纹、倒影离线以 3840×2160 缓冲抗锯齿合成并输出 2560×1440、60fps、24 秒无声循环；素材保留软 Alpha，原始 RGBA 帧直接编码，底景原画仍为 1672×941。运行时不再切条扭曲图片，也不需要 Canvas RAF。视频开始播放前或加载失败时保留原图；隐藏页面时暂停并保留进度，销毁时移除视频源与监听器，减少动态效果时显示静态原图。`background.css` 默认使用等比覆盖，非 16:9 容器居中裁切；可通过背景外观参数改为完整显示或拉伸。静态资源仍为 `img/overlays/backgrounds/moonlit.webp`，不修改开播动画底图。模板保留样式与本机资源映射，无业务数据；迁移到另一电脑需要连同素材库一起迁移。

新建图层独立选择样式；右侧公共显示参数与客户端及同样式实例共享，首次采用客户端已保存值。普通媒体/CSS、外部网页与没有客户端对应项的配置保持原 owner。公共分辨率预设/自定义尺寸独立于组件，
图层默认以预定大小居中，窗口改变只影响查看比例。编辑页采用浅色控件与灰色工作区，画布自动适配且不滚动；
画布设置、预览底色、保存、放弃和复制集中在顶部紧凑工具栏，已有图层在画布下方横向排列。
直接入口默认收起参数，画布设置与图层按钮可展开右侧面板；折叠保留选择、参数和草稿，隐藏字段校验失败时重新展开。
在画布中选择或拖动不会自动展开面板，避免拖动中触发缩放。参数与图层列表按需独立滚动。
所有组件都可部分移出画布，X/Y 可为负数；每个组件在画布内至少保留 24×24 逻辑像素，拖动、多选、缩放与保存遵循同一边界。越界内容由编辑器画布及正式组合展示页裁切，不改变组件内部排版；自动高度或共享尺寸更新不会把仍满足最小可见范围的组件推回画布。几何契约见[场景规格](../../../specs/component-scenes.md#scene-document)。

「保存并应用」只等待场景及其引用的共享外观 owner 的网页编辑得到客户端确认，批量保存并再次核对后发布组合画面；原生时钟、队列、弹幕和加班机的独立实例也参与对应公共 owner 的保存，无关默认配置不保存。
场景输出每次读取均返回按已发布 item ID 投影的 `appearances`，即使版本未变、`document` 为 null。渲染器原地更新配置，不重建 iframe、不重播礼物事件，也不带入未发布布局。
「放弃修改」还原画布及本次编辑涉及的公共 owner 的未保存草稿（含已移除图层），保留无关组件草稿；已经自动保存的公共参数不会回滚。
部分保存失败、冲突或未完成草稿会停止发布，保留之前的直播布局；已经成功保存的共享外观继续生效。客户端浏览器源中的
`canvas-overlay-source.js` 与网页按钮共用 `scene-source-url.js`，自动读取并显示首个已绑定场景的已发布地址，
点击地址区域即可复制；未发布时提示先编辑并应用。进入浏览器源页、返回客户端或账号/在线来源改变时重新读取，
来源改变立即清除旧地址；读取与复制不创建或发布场景。编辑会话能力与持久输出能力不同。

独立组件来源 `/clock`、`/queue`、`/overtime` 和 `/danmaku?source=component` 可直接复制使用，
无需打开场景编辑器、创建或发布场景。它们使用已保存的公共外观，与画布内同样式参数同步；显式 URL 参数继续覆盖对应字段。
本机弹幕的 `danmaku-component-source.js` 与场景共用 `display-source.js`，通过 `/api/danmaku/events`
获知变化后读取 `/api/danmaku/display`；通知健康时五秒校验，断开时回退 750ms 读取。
复用已有云展示缓冲、样式渲染和 canvas 坐标逻辑；不建立本地旧弹幕 WS 或第二条上游 SSE。
首次/断线/换账号清空旧消息并按 epoch/cursor 继续，不生成示例。旧 `/danmaku` 本地 WS 行为兼容保留。

队列预设、默认值和样式切换只修改草稿；保存提交所有已编辑样式键和最终样式。
队列预览使用样例歌曲和同一渲染器，历史共享主题键仍影响跟随主题的歌单板。
画布中的点歌板按当前样式的实际面板尺寸自动收拢边框，高度只读、拖动等比缩放；
身份版仍不超过原始设计大小。编辑时按宽度计算内容高度，避免旧框高度反过来限制面板；
发布后的来源继续按已保存矩形完整容纳内容。透明样式不继承经典款的背景模糊设置。
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
显式 HTML 片段 allowlist，弹幕预览复用 `pages/admin/live-components/danmaku.html` 的画面参数，不包含百宝箱的发送与机器人表单。中继与默认配置草稿缓存保留四个共享类型和 `canvas` 控制类型，不把 canvas 作为可渲染组件。
`shared/scene-extra-components.js` 定义开播动画、展示板、歌词、三类小游戏、全屏礼物感谢、大航海感谢、礼物滚动、盲盒榜、许愿的独立参数与选择项；
`admin/scene-extra-preview.js` 直接在画布中创建参数面板，其修改由场景 owner 保存。
展示板的示例歌曲分类跟随各图层的分类筛选，正式来源仍筛选实际歌库，不写入示例歌曲。兼容 blivechat/blc 的导入弹幕 CSS 在编辑预览中持续补充示例，避免退场动画后永久空白；页面隐藏时暂停，销毁时停止，正式来源只消费直播事件。
小游戏画布通过 `admin/games-canvas-data.js` 在客户端每秒读取当前公开对局，沿现有预览会话传给游戏子页；不再使用固定示例局面。
小游戏和开播数据适配器复用 `admin/canvas-data-poller.js` 的单请求轮询、超时及销毁取消；按画布组件类型决定是否请求，读取失败清空本次投影。
没有匹配对局或读取失败时，编辑画布显示等待开局，正式来源仍隐藏未进行的游戏；开始、落子与绘画继续由「直播小游戏」管理。
新添加的数字炸弹、五子棋、你画我猜分别默认 800 × 360、600 × 600、1280 × 720；五子棋棋盘按组件视口适配，已有图层保留保存的尺寸。
礼物许愿的组件选择与展示样式均支持「月渡花汀」（`moonlit`）。独立浏览器源与场景画布共用
`shared/gift-wish-card.js` 渲染入口；同一条月渡花汀许愿更新时保留卡片节点，使进度过渡和装饰动画连续。
许愿画布由 `admin/gift-wishes-canvas-data.js` 从客户端缓存礼物目录随机选取有图片的礼物；全局目录不足时补读房间缓存，同次预览不随参数变化重新抽取。「显示条数」默认 1，可设为 1–30；示例不足时重复使用缓存礼物补足条数。示例周期随各图层的周期选择调整，切换长期或本场仍可预览。目录为空时提示同步礼物库，不使用虚构礼物。示例与进度不写入许愿或场景，正式来源仍读取实际许愿，最多显示设定条数。原生样式按内容测量高度，画布外框与参数中的自动高度一起更新，高度不超过场景画布；素材装饰保留自定义尺寸。月渡花汀在 640px 宽时的单条初始高度为 143px，旧套装尺寸由客户端实测纠正。
外观与动态效果规则见[前端页面](pages.md)。
`gift-frame` 和 `guard-thanks` 是两个独立图层，分别通过 `/gift-effects?giftComponent=frame`、
`/gift-effects?giftComponent=guard` 的无凭据组件模式复用现有播放器，只消费父页传入的对应事件。
礼物姬预览入口直接打开并选中对应画布图层，不再提供独立播放页或共用来源地址。
大航海感谢添加窗提供「辉光」「经典」两张独立卡片，以 `appearance.config.style=aurora/classic` 保存图层风格；各原生图层只播放对应风格的实时事件，预览按图层风格渲染。旧配置缺少 style 时归一为 `follow`，继续使用事件风格；普通媒体样式维持原事件消费行为，航海旗帜资源组件只消费上文的 nautical 专属事件。
大航海感谢参数面板的动画风格属于持久化外观；预览等级（舰长/提督/总督）、观众昵称和月数（1–999）仍为示例参数，修改后立即重播，
客户端礼物姬填写的这三项参数随预览入口带入画布并回填；持续轮询不覆盖画布中随后修改的值。
切换等级、动画风格、动画文字或图层选择时保留本页预览输入。等级、观众昵称和月数不写入场景配置，直播仍使用真实上舰事件；礼物姬预览选择对应风格的内置图层，不存在时新建，不覆盖另一风格或本机素材图层。
编辑样例每八秒重播，正式来源无样例。`server/scene-gift-events.js` 从既有礼物显示事件接收最多
200 条按账号 scope/epoch 隔离的投影窗口；`scene-gift-display.js` 在父页按序列去重、暂存准备期事件。
首次打开、账号代次变化及断线恢复只建立当前基线；已交付事件不会在重发布时补播，子页断线清空队列。
这些类型不接受 `appearance.mode=shared`；公共显示参数仍按上文的 owner 共享，不创建独立默认配置会话，也不扩展 `component_output_sizes` 的四类型约束。
月底冲刺 `gift-sprint` 使用 600 × 80 的独立实例与空外观配置，在组件库的「礼物许愿」分类中添加；编辑画布展示示例进度，正式来源使用当前 `giftSprint` 的投影。管理端将冲刺收进「礼物许愿」顶部折叠区，许愿与冲刺的「打开画布」分别选中对应组件。金额目标和重置仍由「礼物 → 月底冲刺」管理，模板不携带目标或进度；原独立投屏地址保留。
`server/scene-extra-display.js` 复用现有领域读口和 overlay 投影；礼物慢读按账号代际、来源版本和日期共享五秒缓存。
输出异步完成后再次核验账号和场景能力；原展示页的组件模式只接收父页消息，不启动自身 HTTP/WS 数据请求。
礼物与小游戏头像按现有 HTTPS B 站图片白名单直接读取，不向子页下发访问凭据。
新增类型需通过前后端定义、独立参数、模板和保存/发布一致性测试；若将来扩展共享默认尺寸类型，
已有数据库必须追加迁移，不能改写已执行的 v9 建表函数。

场景 HTTP 访问由 `scene-api.js` 提供，`scene-item-controller.js` 只适配文档实例与默认外观。
画布会话在 `component-preview-canvas-controller.js` 中持有 revision、冲突与发布状态，
保存复用 `component-save-batch.js`。旧工作区和旧场景编辑器入口及其专有会话、模板界面已移除；
当前画布继续复用场景文档模型、stage、inspector 和模板数据契约。
stage、inspector 和画布视图的只读路径使用模型的冻结快照及快照订阅，避免每个消费者重复深拷贝；编辑仍通过模型草稿与手势历史提交。

## 7. 数据消费一览

| 叠加层       | 首帧                                                                 | 实时                                        | 去重指纹                                | 触发重载的 reason                                              |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| queue        | `/api/state`                                                         | snapshot                                    | current+waiting+SC+全部主题键           | `queue:add`/`bilibili:danmaku`/`bilibili:superchat`(80ms 强刷) |
| songs        | `/api/state` + `/api/songs`                                          | snapshot                                    | orderKey/layoutKey/motionKey            | `songs:*`/`cloud:songs`/`database:clear`/`database:clear-all`(220ms 重载) |
| blindbox     | `/api/state` + `/api/gifts/blind-box-stats`                          | snapshot(即时设置)+ 轮询                     | 统计内容相同保留节点                    | `bilibili:gift`/`gift:sprint:reset`/`connect`                  |
| overtime     | `/api/state`(overtime 字段)                                          | snapshot + `overtime:update`                | `revision` 单调比较                     | `overtime:update` 的 adjustment → 动画入队                     |
| gift-effects | `/gift-effects` 页面播放特效 1 的 8 秒透明 WebM + 独立 DOM 感谢词条 | `gift:frame`                                | `eventId` 去重 + 50 条 FIFO 等待，无等待时效  | 每个合格 final 礼物一次播放                                    |
| opening      | `/api/opening/config`                                                | 无                                          | 无；首帧配置经枚举/文本清洗             | 页面加载一次；Admin 预览可由 URL 参数覆盖                      |
| clock        | `/api/clock/config` + 设备本地时间；URL 参数可覆盖 | clock scope settings snapshot + 秒边界定时器 | HTTP 修订保护；单一计时器 | 初始读取及重连；快照原位更新 |
| lyrics       | snapshot 中的设置、状态和时间轴                                      | `lyric-state` + `lyric-timeline` + snapshot | 当前行与时间轴内部去重                  | 播放页按状态变化推送                                           |
| danmaku（本机组件） | `/api/danmaku/display` 的 config 与 data | `/api/danmaku/events` 通知后按 epoch/cursor 增量读取，断线回退轮询 | 同一缓冲的 cursor、直播 session 和 reset | 保存默认外观后原位更新；断线/账号变化清空旧消息 |
| danmaku（旧 URL） | snapshot 中的 `danmakuFeed` | `danmaku:message` | 有 id 时按 id；兼容消息按 uid+时间+正文 | 无 reason 重载；断线重连后由 snapshot 恢复 |
| games        | `/api/games/session`                                                 | snapshot + `game:update` + `game:patch` + `game:draw`      | 游戏入口调度器按更新频率合并渲染        | `game:update` / `game:patch` / `game:draw`                                    |
| wheel        | `/api/wheel`，连接成功后补读并有限重试                               | `wheel:update`                            | 状态/抽取 ID 与读取代次                 | 每次 WebSocket 连接成功                                      |

消息类型与 reason 的全集定义以 [ws.md](../backend/ws.md) §3 为准;本表只描述各叠加层**消费**哪些。

歌词性能策略由 `shared/lyric-performance.js` 持有：连续四个长帧先从 WAAPI 降为手动，再连续四个长帧进入静态模式。`lyric-word-animator.js` 在模式实际改变时取消并清空旧动画，静态模式仍按当前时间更新进度。opening 使用 HTTP 配置接口，不订阅快照 WebSocket；clock 同时消费受限配置快照。


## 本地场景浏览器来源

输出以保存的 CSS 像素显示，`scene-renderer.js` 不再按宿主视口缩放整套场景。
选中独立组件后点击「组件地址」（无障碍名称「复制组件地址」）使用 `/scene?id=…&item=…#token=…`，服务端直接投影
已发布实例到 (0,0)，宽高、样式与整套场景中的这一实例共用同一份配置。
共享默认图层的单组件按钮复制原 `/clock`、`/queue`、`/overtime` 或
`/danmaku?source=component` 地址；这些页面通过 `component-output-size.js` 单路读取
当前账号保存的输出尺寸，限制页面及内容布局，不受 OBS/直播姬视口分辨率影响。
该读取复用各自 overlay 身份，不在预览或场景子 frame 内运行；无保存尺寸时保留原行为。
请求不重叠，结束后间隔 750ms 重读，8 秒超时，页面释放时取消请求和定时器。
原点歌板/时钟缩放算法此时以保存的矩形为可用区域；加班机以保存宽度排版、使用已测量高度。

当前入口和操作见上方组件系统说明。直播场景使用既有 scene 文档、保存与发布 owner；模板导入导出、多选与撤销等旧场景编辑器能力保留在其模块中，不作为当前网页入口已提供的功能。

本地直播场景使用 `/scene?id=<UUID>#token=<secret>`。网页点击「保存并应用」更新完整来源；确认删除当前输出场景也会切换到剩余已保存场景，删空则输出透明空画面。默认配置之后的修改需要再次应用。OBS 与哔哩哔哩直播姬使用同一浏览器源，尺寸设为场景画布尺寸。输出中未放置组件的区域透明，包含可见组件的实际数据，不含编辑控件、检查底色或示例消息。关闭编辑网页后仍能从本地运行时加载、刷新和接收更新。

`scene-renderer.js` 为可见实例创建无凭据的沙箱子 renderer，全体准备成功后替换整套；准备失败保留旧版，旧版仍接收数据。同版本不重载。父页把投影回执与已成功显示版本一起提交，准备失败时继续请求旧版所需类型；回执不传给子页面。首次没有弹幕消费者时保留最多 200 条待投递事件，空批次不覆盖增量，溢出设置 gap 并保留最新事件；连接 epoch、直播场次或 reset 变化清除旧批次。游标推进表示事件已交付 active 或进入有界待投递缓冲；已交给旧版的事件不在新版重复播放。断线同步更新随后提交版本使用的离线状态并清除待投递事件，撤销清空全部版本及回执。`scene.js` 只从 fragment 取凭据，子页面仅收外观和显示数据，真实弹幕模式不会生成示例；授权失效清空画面。主进程接收现有 public overlay SSE 并作账号/连接代际隔离，断线报告缺口，不向本地结算管线补消息。重启且端口不变时来源有效；端口冲突改用其他端口后需重新复制来源。完整 HTTP 契约见 [API 注册表](../backend/api.md#本地场景)。

`scene-source.js` 为共用的 `display-source.js` 提供场景查询和游标适配，管理输出读取及 `/api/scene/events` 的 fetch SSE 订阅；`scene.js` 仅负责页面组合。通知只传 ready/change/revoked，数据仍经受限 output 读取；通知连接沿用场景 Bearer、可选 item 与已提交 version/projection，不向子页面传递。请求串行且开始至少间隔 100ms，读取期间的新通知合并为一次后续读取。流正常时每五秒健康检查；流断开、饱和或接口缺失时回退 750ms 轮询，并按 750ms 至 15s 退避重连。初次通知 HTTP 失败不撤销有效输出；显式 revoked 会中断未完成读取并丢弃迟到响应。输出 401/403/404/423 清空已显示版本与回执。成功提交 renderer 后才按新版本/回执重开订阅；pagehide 取消读取、流和定时器并释放 renderer。

本机场景或独立组件读取云弹幕投影/默认外观时，由 `display-demand.js` 续期共享需求；最后一次读取后 15 秒释放云 SSE，再次使用自动恢复。无弹幕的场景不续期。主进程保留账号与连接隔离，闲置断开清空实时事件，配置缓存保留；已认证的设置读取和保存直接更新缓存，不要求先打开直播来源。公共消息 DOM 由 `danmaku-renderer-core.js` 的固定源码快照构建，原 `danmaku-message-renderer.js` 保留桌面入场策略，分发规则见 [ADR-0020](../../architecture/adr/0020-shared-danmaku-source.md)。

仅布局变化的发布复用现有版本容器：可见实例 ID/类型集合、内置外观和外部 URL 均不变时，同步更新画布尺寸、位置、显示大小、名称、层级及外部网页分辨率，不移动或重载 iframe；显示版本与投影回执一并推进。其他变化仍按上述整版准备和回退流程处理。纯 browser/clock/text-box 场景的输出不读取业务状态快照；需要展示数据的端口每轮共享一次读取。外部网页的数据直接来自供应方，不经过内置组件通知与读取链路。

### 文本框 `/text-box`

`shared/text-box-config.js` 校验结构化 text/gift/image 节点，`shared/text-box-renderer.js` 同时供编辑区与输出使用。编辑态的礼物/上传图片是不可编辑的完整方块；输出态只渲染图片，保留动图原文件、长宽比及相对字号比例。文字通过 DOM `textContent` 渲染，不接受任意 HTML。`overlays/text-box.js` 通过既有组件预览协议接收每份独立配置，以 640px 设计宽度随组件宽度整体缩放。

管理端 `text-box-preview.js` 在客户端详情和画布参数区挂载同一个 `text-box-editor.js` 与 `text-box-media.js`，选区工具栏保留原生撤销、字号配色和不可拆分素材。`text-box-format-controls.js` 负责常用/最近/自定义色板，以及描边、轻阴影、清除格式入口；最近 6 色仅存于本地 UI 偏好 `admin.textBoxRecentColors`，不进入场景文档。text 节点可带布尔 `stroke` / `shadow`；缺省关闭，共享 renderer 使用随字号缩放的深色描边、阴影。清除格式只重置选中文字，保留素材、未选中文字和原生撤销。`text-box.js` 复用场景草稿及发布 owner 管理多份实例，并携带实例 ID 打开画布。保存状态位于顶部保存操作旁，通过比较草稿与已保存文档中的文本框实例，区分“文本框有未保存修改”与“场景其他内容有未保存修改”；删除最后一个文本框仍属于文本框修改。保存与放弃修改仍作用于当前场景草稿。没有文本框全局默认存储或业务数据订阅。正式直播使用已发布的 `/scene` 组合/单组件地址；裸 `/text-box` 仅为无凭据的子渲染页面。

## 服务器浏览器源地址

服务器弹幕姬地址按服务端 ADR-0056 使用 `/overlay/<16位base64url>`。`server-overlay-url.js` 在初次授权资料和授权状态变化后，通过既有主进程 `getOverlaySettings()` 读取完整 URL，验证与资料 `songPageUrl` 同源，再同时提供给点歌投屏地址及弹幕工具；不从域名拼接裸路径、不生成或上传密钥。账号切换先清空地址，迟到回复按代际丢弃。该只读 capability 仅用于用户明确要求的展示/复制/打开，DeviceBearer 保持在 main。失败不回退公开地址。网页、不同设备和重装后使用同一服务端持久密钥；本地 `/danmaku?preview=1` 预览不依赖它。

验收：首次加载两个观察者收到相同完整 URL；复制/打开保留随机串；错 origin、裸路径、带 query/hash 或非法长度拒绝；切换账号不显示旧 URL；本地预览与草稿行为不变。自动化见 `test/danmaku/server-danmaku-settings.test.js` 与 `test/danmaku/danmaku-overlay-ipc.test.js`。


## 投票与评分 `/interactions`

独立 interactions scope，仅展示当前类别 3 会话；空场透明。推荐浏览器源 800×600，投票支持 1–6 个选项。管理端预览、主持端结果和实际投屏共用紧凑结果行：轨道最小高度 56px，行间距 8px，长文字自然撑高。卡片和选项区随内容增减高度，全部选项同时展示，不设内部滚动或自动翻页；实时更新保留 DOM。

投票使用固定顺序与 0–100% 标尺，票数/百分比固定在完整轨道内，零票不隐藏；结束标最高/并列最高，零参与无胜者。评分使用最大宽度 460px 的整体边框卡片，规则文案可自定义，默认说明 1–10 分、只发整数及取最后一次评分。多行输入保留换行，长文本（含连续英文）按卡片宽度自动折行，卡片随内容增高，规则留空则隐藏，不固定行数。底部独立均分框在收集中显示占位「—」，不显示均分或人数，结束后显示两位小数及人数；无人评分显示「暂无评分」。接收曾中断时保留提示。页面 GET、刷新或开多个实例均不启动/延长收集。截止由本地服务控制，与页面可见性无关。

选项文字位于进度条内左侧，票数与比例右对齐。默认白底、深色文字、浅青色填充，不再展示完整规则说明。标题和提示默认空、留空隐藏，不回退到本场主题。管理端「直播画面」按内容、颜色、布局与显示分组，左侧编辑、右侧棋盘格背景预览；窄窗口将预览放到编辑区上方。可调整标题、提示、评分规则、文字/背景/进度条/轨道颜色、背景与整体不透明度、文字大小、卡片圆角、状态和人数显示。背景不透明度只影响底色，整体不透明度同时影响卡片全部内容；字号 16–24px，结果行随文字换行自然增高。隐藏人数不隐藏接收中断警告，也不提前公开评分汇总。标题与状态均隐藏时折叠标题区，底部无人数或警告时折叠底部。

草稿即时预览，可切换投票或评分，预览明确使用示例数据；进度条色也用于评分边框与最终均分框。预览与浮层共用外观样式，按卡片宽度调整选项内的排列。点击应用后通过既有 `/api/settings` 保存并广播，恢复默认也先进入草稿。设置键与默认值见 [storage.md](../backend/storage.md)；只有 interactions scope 接收这些展示设置。样式更新不改变会话或选项节点；评分浮层共用这套外观。


## 绿萌简笔画固定样式

`sketch`（绿萌简笔画）为透明背景固定弹幕，复用列表滚动。普通观众使用第一种卷线昵称框与素色色带；大航海用户（`guardLevel` 为 1、2、3，即总督、提督、舰长）使用第二种猫兔藤叶框，色带内带有层叠枝叶与浅色花瓣。仅佩戴粉丝牌或主播标记不触发第二种。头像/徽章/礼物原图隐藏；昵称、正文、表情和礼物均保留真实内容。礼物开放式排版显示名称、数量和已结算总额（两位小数，货币符号在后；缺失金额显示 `—`）。SC 保留完整原文与两位小数金额，使用同主题边框。

既有 `textColor` 在此样式作为「主题颜色」，默认 `#7f9f76`，正文使用原色，昵称、礼物、描边、矢量装饰与柔边色带派生协调浅色；枝叶底纹随主题色变化，背景不透明度同步调整色带及其底纹，文字与外框线稿不透明。支持字体、18～48 字号和上下滚动，不接受随机位置/速度/礼物图片参数。旧布局缺少 sketch 时仅补齐 680×720 默认区域；切换或恢复参数不改变其他样式。两端 CSS 与装饰模块保持一致；颜色源为 CSS 变量，装饰无外部请求、无定时器。
