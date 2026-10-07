# 制作带滤镜的横屏背景

适用于给 LIRA 制作素材的作者和 AI。交付物为「图片或循环视频 + 滤镜参数」的背景样式 ZIP。导入选用后，画布和直播来源自动应用参数，主播仍可逐项调整、保存或恢复作者默认。效果只处理背景；人物保持在直播软件的独立来源中。

## 从示例开始

复制 [lira-pack.json 完整示例](../examples/background-style/lira-pack.json)。它包含一个列出标准模式全部字段的静态样式，以及一个展示可省略默认字段的动态样式。两者效果相同，只在极亮部加入少量柔光，不主动加暖色或冷色；底图配色已有设计时应从这种设置开始。示例不是参考视频作者的原始参数，也不附带其素材。两个成员的 `config` 各自独立，后续修改不会自动同步。制作分层素材、选用成熟工具与 Shoost 参数对照见[背景美术与滤镜来源](background-art-workflow.md)。

准备自己的 1920×1080 横屏素材，目录如下：

```text
soft-background/
├── lira-pack.json
└── assets/
    ├── background.png
    └── background.webm
```

只有静态或只有动态时，删除另一个 `styles` 成员及对应文件。前景装饰、雪、灯光等可以分层创作，交付前合成为一张 PNG 或一段循环 MP4/WebM。这个通用背景包的每个样式读取一个 `file`，不接受任意 `layers` 数组；同一张底图可被多个不同滤镜的样式引用。

普通素材支持 PNG/JPEG/GIF/WebP/MP4/WebM；透明静态图优先 PNG，动态可使用浏览器能解码的 MP4（如 H.264）或 WebM。视频默认循环、静音；循环接缝与已烘焙的雪花、反光属于素材本身，滤镜不会从静态照片生成这些运动。

## 参数接口

清单根为 `schemaVersion:1`、`id`、`name`、`version` 和 `styles` 数组；成员为 `type:"background"`、`name`、`file`、`width`、`height`、`config`。文件路径相对 ZIP 根目录，使用 `/`，区分大小写。尺寸填写素材设计尺寸，例如 1920×1080 或 2560×1440。包 ID 使用小写字母、数字、点或短横线；版本使用三段数字。

**全部滤镜字段平铺在每个成员的 `config` 内。** 参数名、类型、取值、步长、默认值、算法与顺序以 [背景外观参数合同](../reference/frontend/overlays.md#背景外观参数) 为准，源码定义在 [BACKGROUND_FIELDS](../../public/js/shared/background-appearance.js)。不要再创建 `filters` 子对象，不要使用中文键名。

例如下面只是一个成员的 `config`，应嵌入完整清单，不能作为 ZIP 根清单直接导入：

```json
{
  "colorProcessing": "standard",
  "temperature": 0,
  "glowMode": "normal",
  "glowStrength": 0.12,
  "glowRadius": 12,
  "glowThreshold": 0.9,
  "glowSoftness": 0.1,
  "volume": 0
}
```

- 百分比在 JSON 里用比例：`glowStrength:0.45` 对应面板 45%，不是 45；`opacity:1` 对应 100%。px、色温/色调、LGG 系数、色阶与倍速用原值。
- 新作品写明 `colorProcessing:"standard"`。不写且旧白平衡/分区染色参数非零时，为兼容旧作品会选用 legacy；因此不要仅省略模式再填写色温。
- 缺省参数会补齐默认值。所有新增效果默认关闭或中性；改变辉光半径而不设置大于 0 的强度，不会显示辉光。
- 颜色使用完整六位 `#RRGGBB`。`preserveLuminance` 是仅供旧模式的 JSON 布尔字段，标准模式不使用它；保持亮度也不等于保持原色。
- 白平衡是改色工具：正色温偏暖、负色温偏冷。希望保留蓝白原色时，`temperature/tint` 为 0、三个 `lift*` 为 0、三个 `gamma*`/`gain*` 为 1、颜色遮罩强度为 0；需要逐像素原图时同时关闭辉光等全部效果。
- 输入和输出黑场分别必须小于对应白场。色阶通道一次选择 `rgb/r/g/b` 之一；不是四套独立色阶同时叠加。
- 标准调色使用 Lift/Gamma/Gain 的 RGB 数值控件：Lift 主要调黑场端，Gamma 主要调中间调，Gain 调白场端，各区域会相互影响。`gammaRed` 等与色阶里的总 `gamma` 是不同阶段；不要把色轮位置、十六进制颜色或 `.cube` 内容填进这些字段。
- 旧模式的 `shadow*`/`midtone*`/`highlight*` 是兼容用的分区乘色，不是 LGG；新包不要再用它们设计效果。需要暖色灯光时，素材本身应已有对应光源和色彩。
- `backgroundDefaults`、`mediaStyle`、资源 ID、素材 URL 由导入器生成，作者不要填写。作者参数放 `config`，不要放 `media`。
- 这套参数适用于 LIRA 原生背景及其图片/视频样式。导入 HTML 作为网页组件时，不会自动转换成这套背景配置。

这些是 LIRA 的渲染接口，不是 Shoost 工程文件兼容接口。不能直接导入 Shoost 工程、VTS `.effects.json` 或 `.cube` LUT；已有素材可按本清单重新打包，调色值须按 LIRA 画布预览调整。ZIP 可以提供新素材和已支持的参数，不能给旧客户端安装新滤镜算法。

功能分类参考 [Shoost 作者的效果说明](https://www.patreon.com/MuRo_CG/posts/update-shoost-v0-118328052) 和 [辉光阈值说明](https://www.patreon.com/MuRo_CG/posts/shost-tip-how-to-102566717)。标准白平衡及 LGG 采用有 MIT 授权的 Unity PostProcessing v1 公开公式，具体版本、色彩空间和限制写在字段合同中。其他效果仍是浏览器 SVG 实现，不宣称移植 Shoost 私有算法。已有调色成片可将 LIRA 参数全部置为中性，避免二次改色。

## 打包和导入

在 `soft-background` 目录运行：

```powershell
Compress-Archive -Path .\lira-pack.json, .\assets -DestinationPath ..\soft-background-1.1.0.zip
```

ZIP 根目录必须直接是 `lira-pack.json`，不要包入多一层 `soft-background/`。完整包限制见[组件样式包指南](component-style-packages.md#打-zip-与检查)，普通媒体单文件不超过 512 MiB。

1. 打开 LIRA 画布，在「添加组件 → 背景 → ＋ 添加样式 → 选择 LIRA 样式包（ZIP）」选择文件。
2. 核对预览后添加样式，点击静态或动态背景卡片加入画布。多个背景变体属于背景样式包，使用背景分类入口。
3. 选中背景图层，在右侧展开白平衡、Lift/Gamma/Gain、辉光、周边模糊、暗角、色阶或颗粒，检查效果。旧模式显示旧分区染色，播放参数只在视频背景出现。
4. 点「保存并应用」，使用现有直播场景来源地址放入 OBS 浏览器源或哔哩哔哩直播姬网页来源。仍使用画布提供的完整地址和尺寸，不手写 `/background` 地址或把参数拼到 URL。

导入只增加样式库卡片，不会立即改直播画面。画布编辑只修改当前背景；「恢复样式默认」恢复该包的作者参数，并仍需保存应用。删除库卡片不破坏已使用的背景。调整包内容须提升 `version`；更新包不自动覆盖已保存的实例，主播须更换样式。

程序化接入继续使用现有[组件样式库 API](../reference/backend/api.md#组件样式库)：上传 ZIP 至 `inspect`，检查返回的预览，再用返回的 ID 调用 `install`。这需要当前受权的桌面或画布会话；作者制作静态文件不需要 API 凭据。没有新增专门的滤镜上传端点。

## 验收与常见问题

先导入自己的 ZIP，检查静态和动态成员，再保存、重开并检查正式场景来源。边看视频边调参，播放应连续；与人物来源叠加时只有背景变化。用「恢复样式默认」核对作者预设。最后在实际使用的直播软件上检查 1080p/1440p 的流畅度；大半径模糊、多组滤镜叠加及高分辨率会增加 GPU 开销。

| 现象 | 检查 |
| --- | --- |
| 组件展示参数无效 | 检查字段拼写、JSON 类型、范围、步长、黑白场顺序及客户端是否支持这些字段。不要把 45% 写成 45。 |
| 有滤镜但不像参考图 | 底图光源、纹理、颜色和运动决定大部分观感；本示例只是起点，调参不会补出不存在的街灯或雪景。 |
| 亮部没有发光 | 提高 `glowStrength`，降低 `glowThreshold`；检查前面的调色/色阶是否已把亮部压暗。 |
| 完整显示时留白被颜色覆盖 | 新滤镜保留透明度；原有 `overlayOpacity` 是全画布遮罩，需要透明留白时设为 0。 |
| 同版本内容冲突 | 增加包的 `version`，重新打包。 |
| 导入后当前背景没变 | 从库中选用样式，再保存并应用。 |

仓库的 `test/scenes/component-styles.test.js` 会用合成媒体经真实 inspect/install 校验上述完整示例；`test/overlays/background-filters.test.js` 检查实际像素、透明度和滤镜节点清理。这些检查不代替具体美术素材和实际直播软件的验收。
