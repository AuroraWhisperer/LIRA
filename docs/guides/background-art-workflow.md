# 背景美术、滤镜来源与制作流程

核对日期：2026-10-07。本文仅针对横屏静态/动态背景，不含人物画面处理。背景包的打包格式见[背景样式包作者指南](background-style-packages.md)，精确字段定义以[背景外观参数规范](../reference/frontend/overlays.md#背景外观参数)为准。

## Shoost 参数核对

Shoost 的公开资料只介绍了效果名称、用途和部分操作流程，并未公开完整的着色器代码、滑块范围或工程文件格式。下表所说的“对应”仅指概念一致，相同数值不会得出完全一样的画面。

| Shoost 官方功能 | LIRA 支持与边界 |
| --- | --- |
| 白平衡：色温、色调、取色校正、保持亮度 | 标准模式支持色温/色调，采用公开 CAT02 公式。未实现取色校正；旧版保持亮度只在兼容模式有效，且不等于保持色相。 |
| 调色：提升（暗部）/ 伽马（中灰）/ 增益（亮部）（Lift/Gamma/Gain，简称 LGG）、普通与 Log 色轮、分色相调整 | 标准模式支持 LGG 的 RGB 系数调节。未实现色轮手势、Log 色轮及六色相选择性校正；旧版三区乘色不是 LGG。 |
| 周边模糊：模糊量、中心半径、过渡与中心位置 | 有对应字段；LIRA 用归一化径向蒙版及高斯模糊，数值尺度见参数规范。 |
| 暗角：颜色、半径、柔和度、圆度、位置、不透明度 | 有对应字段；具体算法与边缘形状按 LIRA 实现，与 Shoost 私有算法不同。 |
| 色阶：通道、输入黑白场/伽马、输出黑白场 | 有对应字段；LIRA 一次选一个通道，不保存四套独立通道曲线。 |
| 颗粒：强度、大小 | 有对应字段；LIRA 是固定单色纹理，不是逐帧胶片噪声。 |

以上类别和功能依据 [Shoost v0.14 官方说明](https://www.patreon.com/MuRo_CG/posts/update-shoost-v0-118328052)。该版本还支持按添加顺序排列效果；LIRA 使用参数规范约定的固定顺序，不提供任意效果堆栈。

辉光的 Normal、Streak、Star 三种模式在 [Shoost 功能索引](https://www.patreon.com/MuRo_CG/posts/introducing-62585593) 中有明确记录；[作者辉光教程](https://www.patreon.com/MuRo_CG/posts/shost-tip-how-to-102566717) 解释了亮度阈值与阈值平滑，并示范先隔离背景，让窗户等亮部发光。LIRA 的三种形状、强度、半径和阈值遵循这些常见概念，但高斯核、光条比例、屏幕混合及范围是本项目的 SVG 实现，不是 Shoost 源码。

本次核对顺带修正了两个早期实现问题：新样式不再用随意缩放 RGB 来充当白平衡，也不再拿分区乘色充当调色轮。标准模式下的白平衡与 LGG 公式移植自 [Unity PostProcessing v1](https://github.com/Unity-Technologies/PostProcessing/tree/933df236f509ed64ae5763ed57af33f2342cd1c2)（[MIT 许可](https://github.com/Unity-Technologies/PostProcessing/blob/933df236f509ed64ae5763ed57af33f2342cd1c2/LICENSE)），公式与许可一并存放在 [background-color-science.js](../../public/js/overlays/background-color-science.js)——这里只借用色彩计算公式，不引入 Unity 运行时，也不照搬完整的 HDR 渲染管线。

## 其他成熟工具及参数

| 工具 | 常用参数与用途 | 如何交付给 LIRA |
| --- | --- | --- |
| After Effects | 辉光阈值、像素半径、强度、基于颜色/透明通道、合成方式、光晕颜色及方向；适合分层动画与合成 | 先合成并导出静态图/循环视频，LIRA 中保持中性或做少量再调整 |
| DaVinci Resolve | 提升/伽马/增益/偏移（Lift/Gamma/Gain/Offset）、色温、色调、对比度、饱和度、色相、曲线与选择性调色；适合统一素材配色 | 导出已调色成片；效果烘焙后不依赖运行时插件 |
| OBS | 伽马（Gamma）、对比度、亮度、饱和度、色相偏移、不透明度、乘色、加色；另有 LUT 路径与强度 | 可以在 OBS 来源上后处理，但不会随 LIRA ZIP 自动迁移到其他直播软件 |

参数依据：[Adobe Glow 官方说明](https://helpx.adobe.com/after-effects/desktop/apply-effects-and-animation-presets/list-of-effects/stylize-effects.html)、[DaVinci Resolve Color 官方介绍](https://www.blackmagicdesign.com/products/davinciresolve/color)、[OBS 调色滤镜](https://obsproject.com/kb/color-correction-filter)。这是各工具的原生能力对照，不代表 LIRA 已实现表内每一项。

不同软件的同名参数也不通用。例如 OBS 的亮度范围为 −1…1、默认 0；对比度 −4…4、默认 0；Gamma −3…3、默认 0；饱和度 −1…5、默认 0。LIRA 的亮度/对比度/饱和度默认 1，色阶 Gamma 也默认 1，不能直接照填 OBS 的 0。[OBS 参数表](https://obsproject.com/kb/color-correction-filter)

OBS 原生 LUT 滤镜接受 `.png` 或 `.cube`，强度 0–1。LUT 只是颜色查找表，不携带动态粒子、模糊半径或辉光的空间扩散；LIRA 背景包目前不解析 LUT。如果想在 OBS 和哔哩哔哩直播姬里呈现完全一致的调色效果，请先在后期软件里套好 LUT 再导出成片，导入 LIRA 时保持默认中性参数即可。[OBS LUT 文档](https://obsproject.com/kb/apply-lut-filter)

## 美术通常怎样做

在 Shoost 作者公开的[动画氛围制作流程](https://www.patreon.com/MuRo_CG/posts/shoost-v0-10-0-87407825)中，做法是先定下光晕扩散效果、虚化背景、调整明暗/饱和度/对比度，再顺着画面里的实际光源补光晕，最后统一整体色调（原教程也包含人物处理，这里只参考背景部分）。这也说明调色参数必须贴合现有构图和光源，不能硬套一组万能数值。

另一个成熟流程是 Photoshop 分层绘制后，在 AE 中按合成导入并保留图层尺寸，再对各层制作运动和效果。这是 Adobe 官方演示的工作方式。[Adobe 分层合成教程](https://www.adobe.com/learn/after-effects/web/create-composition-animation)

结合 LIRA 的背景交付要求，建议按以下步骤制作：

1. **确定原画和配色。** 把天空、建筑/室内、灯光、近景装饰、雪/雨/尘点分别制作。银蓝夜景保留冷色主体，暖窗等局部光源画在素材中；不要用全局色温替代局部打光。
2. **按深度和光源合成。** 远景适当模糊，灯光层控制亮部，装饰前景单独摆放；这一阶段的局部蒙版和图层关系由制作工具负责。
3. **制作循环。** 雪、雾、反光、灯光变化各自做动画，检查首尾接缝后合成一段背景视频。静态版从相同构图输出，避免两个版本布局不同。
4. **决定效果是否烘焙。** 需要与作者预览精确一致的局部光效、LUT 或复杂合成先烘焙到成片；希望主播后期可调的整体白平衡、LGG、辉光等交给 LIRA。不要把同一效果既烘焙又全强度叠加。
5. **导出并打包。** 静态用 PNG/WebP，动态选浏览器可解码的 MP4/WebM；推荐横屏 1920×1080 或 2560×1440。在 ZIP 内放 `lira-pack.json` 和每个样式的单个媒体文件，参数写入扁平 `config`。
6. **验收原色与播放。** 用无滤镜版本作为对照，先确认白平衡 0、Lift 0、Gamma/Gain 1，再少量增加所需效果；检查循环接缝、保存重开和正式直播画面。

以上步骤是基于公开制作流程整理的建议，并非对参考视频作者幕后工程的推断。雪、反光、窗灯和材质无法仅靠全局调色生成。

## 导入格式与可复用边界

[参考视频](https://www.bilibili.com/video/BV1yk4y6iEtJ/) 展示成片效果；同作者[使用教程](https://www.bilibili.com/video/BV1sjD8BDEv6/) 中可观察到 MP4 背景、PNG 静态前景及 WebM 动态前景。这只是一位作者的素材交付方式，不能据此推断所有售卖包都采用相同结构。由于未获取其付费素材包或 Shoost 工程样本，其工程后缀与内部数据结构未作核实。

Shoost v0.17 的官方说明提到效果预设可以替换当前效果或追加到已有效果，并可打开预设文件夹分享，但官方并未公开可供第三方直接解析的文件格式规范。[官方预设说明](https://www.patreon.com/MuRo_CG/posts/update-shoost-v0-158905816)

| 拿到的文件 | 本项目如何使用 |
| --- | --- |
| PNG/JPEG/WebP/GIF/MP4/WebM 媒体 | 已有完整画面可直接导入；分层素材先在制作软件里合成为一个背景文件 |
| 分层 PSD、AE/Resolve 工程 | 留作作者源文件，在对应软件导出后再打包；不是 LIRA 背景媒体格式 |
| Shoost 工程/效果预设 | 当前不解析；回到原工具导出成片，或按 LIRA 字段重新配置可调参数 |
| `.cube` / LUT PNG | 在支持 LUT 的软件里套用后导出成片；普通 LUT PNG 不能当成背景照片或滤镜参数直接导入 |
| LIRA 样式 ZIP | 直接通过背景分类的「＋ 添加样式」入口导入；参数、素材和恢复作者默认一同生效 |

LIRA 的“滤镜包”是客户端已支持的参数预设，不是安装新渲染插件。需要新增算法时仍需升级客户端；如果只是交付另一套配色或背景，无需改动接口。
