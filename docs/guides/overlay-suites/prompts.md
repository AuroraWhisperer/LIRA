# 套装制作提示词

以下模板依据多轮反馈和最终版本重新编写，用于今后复用。它们不是当时逐字输入的完整记录，也不意味着一次生成就能达到现有成品。实际反馈过程见 [调试复盘](iteration-history.md)；原始英文提示词、模型和加工记录保存在归档副本中，位置见文末。

使用方法：给 Codex 先贴「总任务」，再贴本轮需要的部件；给图像工具贴「统一美术前缀 + 单张素材指令」。改已有作品时优先使用文末「一轮修改」模板，写清当前版本、问题和保留部分。生成同系列素材时附已认可的开播成品与花枝图，让“同画风”有具体参照。

## A. 给 Codex 的总任务

```text
我要制作一套可用于 LIRA 的直播视觉套装，主题名为【主题名】。

先阅读：
D:/Work/Live/docs/guides/overlay-suites/README.md
D:/Work/Live/docs/guides/overlay-suites/iteration-history.md
D:/Work/Live/docs/guides/overlay-suites/production-guide.md
D:/Work/Live/docs/guides/overlay-suites/sources-and-history.md
D:/Work/Live/archive/moonlit-suite/README.md
并遵守项目及目录下的 AGENTS.md。

本轮范围：【全部套装 / 指定部件】。
目标画布：【宽×高】；动态背景参考月渡花汀已确认的 2560×1440、60fps。
画风：【例如工笔水墨、月白银蓝、靛青、少量淡金】。
主视觉：【例如折扇、月色山水、白山茶】。
参考图和视频：【路径、网址、时间段；分别注明参考配色/布局/动作】。

部件包括：静态与动态背景、弹幕（含上任/礼物/SC）、礼物许愿进度、时钟、全屏上任与礼物感谢、开播动画。先确认各自已有实现与接入状态，避免把独立样片当成已接入功能。

先把已确认的要求写成简短需求卡，再从已有素材与版本继续制作：美术方向 → 素材拆层 → 实际动作 → 完整组合。每轮依据画面反馈修订，必要时删掉不合适的层或调整做法，按本轮范围接入并验证。
月渡花汀的 15 秒、24 秒和具体毫秒数属于该案例的已实现版本；制作新主题时，按其用途和参考确定节奏。
不直接重写已有功能。需要生成的图片逐张明确用途、构图、留白、透明度、锚点和禁止项。
昵称、头像、礼物、数量、金额、进度、时间和 SC 保持实时可编辑，不能烧进图片。
动画须有入场、稳定停留和退场/循环；分层各自动作，不能只把整张图缩放或扭曲。
不要用静帧冒充动画，不要只展示部件局部。全屏感谢和动态背景必须交完整组合播放。

工作文件放 tmp/<主题>-<部件>/。最终交付原始图、提示词、处理脚本、动作源码、完整预览、关键验证记录及路径表；阶段结束复制到 archive/<主题>/<日期或版本>/。保留旧版本，不自动提交或发布。
缺少必要信息时只问影响本轮结果的问题，其余依据项目已有约定继续完成。
```

## B. 月渡花汀统一美术前缀

```text
Production artwork for the Chinese classical livestream collection “Yue Du Hua Ting”.
Match the supplied finished opening artwork and white camellia assets in drawing style, material and color.
Exquisite gongbi fine-line painting with mineral watercolor, subtle rice-paper or silk texture ON the painted objects.
Pearl white #F3F5FA, mist blue #DDE5F3, silver periwinkle #8FA9D0, blue-gray #627AA9, deep indigo #253353, extremely sparse pale champagne-gold accents.
Refined white camellias with layered rounded petals, natural indigo foliage, quiet silver ornament and traditional Chinese forms.
Readable at the intended livestream display size; intricate material details with a clear silhouette and controlled visual density.
No human, character model, photorealistic object, 3D plastic render, neon, saturated cyan, Western floral wreath or random fantasy jewelry.
No text, logo or watermark unless this request is explicitly for the separate calligraphy title.
For isolated assets use genuine alpha transparency, including interior holes; no checkerboard painted into the image, no paper rectangle, no cast shadow outside the object.
```

该前缀用于月渡花汀主美术，身份变体另行指定蓝/紫/红。背景低对比，文字底衬可以较深。新主题应整体替换颜色、物件和画法，不能只替换名字。

## C. 背景：静态底景与独立动态

图像生成，接在统一前缀后：

```text
Create ONE full-bleed animation background plate, wide 16:9.
Pale silver-blue mountain lake with Chinese waterside pavilions, small arched stone bridges, receding mountains and delicate architectural linework. Soft mist separates depth without washing out every structure.
Main architecture at the left and right edges; reserve the central lake and sky for livestream subjects and later overlays. Lake horizon around 65% image height. Keep distant mountains and water low contrast.
NO moon, hanging willow branches, foreground lanterns, falling petals, circular ripple rings or bright vertical reflection streaks. Those will be separate animated layers.
No fan, large foreground flower sprays, characters, lettering or borders. Maintain enough painted detail to look finished when all overlay components are hidden.
```

另一次生成月亮/灯笼/雾/花瓣图集：

```text
Create a transparent 2×2 production sprite atlas with wide empty gutters.
Top left: one pale circular moon with painted crater texture and a soft edge.
Top right: one slender ivory Chinese silk lantern with sparse pale-gold ribs, hanging thread and a small indigo tassel.
Bottom left: a horizontal veil of softly fading white mist.
Bottom right: separate curled white camellia petals, each disconnected from the others.
Every object must fit fully inside its cell. No labels, cell borders or baked background. Use the exact same painted material and pale color family as the supplied background.
```

另一次生成柳叶：

```text
Create exactly six isolated slender willow leaves on genuine transparency, in a regular 3 columns × 2 rows atlas with generous empty gutters.
Each cell contains one long pointed leaf and a short stem, stem upward and tip downward.
Vary the curvature and visible silver underside. Fine painted veins, pale steel-blue and periwinkle pigment, soft alpha edges.
No whole branches, clusters, bamboo bunches or saturated green. Each leaf must be independently usable for a hanging branch animation.
```

给 Codex 的动画任务：

```text
以完整新底景和独立素材合成动态背景。月亮明显渐现/完全隐去；柳枝分节摆动，叶片逐片转动并延迟跟随；水面独立生成流动波纹与倒影；灯笼绕悬挂点摆动，雾和花瓣各自循环。
固定机位，不对原背景截图切条或整体扭曲。所有动作在 24 秒闭合，60fps，输出 1440 帧；交完整 2560×1440 合成视频。
保留源素材柔和 alpha，采用高分辨率缓冲缩采样；不要用压缩 JPEG 帧当中间输出。
WebM 用于产品，MP4 用于观看；分层文件只作为编辑材料。核对实际解码尺寸、完整组合、循环接头与目标负载下播放情况。
```

## D. 开播：扇、花、鹤与时间线

折扇原画：

```text
Create ONE fully opened Chinese folding fan, front orthographic view, isolated on transparent alpha.
A symmetric radial silhouette spanning roughly 160 degrees, silver-blue engraved ribs converging on one clearly defined pivot on the vertical centerline near the lower part of the canvas.
Outer paper face: pale ink mountains, waterfall, a tiny pavilion and restrained gold pigment. Inner rib openings remain genuinely transparent.
Whole fan visible with generous margin, no flowers, birds, tassels, scenery outside the fan or lettering. It must be suitable for cutting into radial sectors for an actual opening and closing animation.
```

花枝原画：

```text
Create FOUR separate white-camellia botanical corner sprays on transparent alpha, arranged in a 2×2 atlas with wide empty gutters.
Use layered white petals, indigo slender leaves, fine curved woody stems and a few pale-gold details. Vary the corner orientations and density; each branch has its own natural silhouette.
No connected border, no frame rectangle, no large shadow. Keep every spray separate and fully inside its quadrant for independent motion.
```

白鹤原画：

```text
Create one gongbi-painted flying white crane as THREE disconnected animation parts on transparent alpha: a wingless body in side view flying right, a near wing, and a smaller far wing.
Long extended neck, ivory feathers with blue-gray shadows, fine dark trailing legs. Large transparent gutters between parts, clear wing roots for rotation. No additional bird, scene, text or overlapping pieces.
```

书法标题单独生成：

```text
The exact four Chinese characters “月渡花汀”, left to right in one horizontal line.
Elegant legible running-script calligraphy, deep indigo #202E50, authentic brush strokes and fine dry-brush edges. Complete strokes with generous margins.
Transparent background; no other words, seal, English, flowers, scenery, frame, shadow or glow.
```

给 Codex 的动画任务：

```text
使用分层素材制作真正的折扇开合，所有扇片共轴。复用现有月渡花汀 renderer 与单帧循环。
按最终 15 秒节奏：0–3.7 秒入场，停留至约 9 秒，9.2–10.8 秒文字淡出，10.2–13.2 秒收扇，13.8 秒前退场，短暂留景再展开。
白鹤双翼、绢带、花枝、流苏、水面、花瓣独立运动；信息停留时保证文字稳定清楚。
背景控制在中等密度，远山与水纹低对比，挂饰只保留必要数量。
交完整两轮播放和独立预览，检查入场、半收、全收、空景及再次展开。默认标题可用书法图，自定义文字继续可编辑。
```

## E. 时钟：优先复用，不重新抽一套素材

```text
基于月渡花汀现有开播素材设计配套时钟。复用银蓝折扇、白山茶、流苏与山水，圆形读数区、外围透明。
保留时间、日期、秒数、12/24 小时制为真实文字，不绘制参考图中用途不明的三个小圆圈。
提供浅色底深字、靛蓝底月白字两版，支持固定浅色、固定深色、自动交替，默认间隔 30 秒并可修改。
装饰轻微摆动即可，不能干扰读数。检查默认尺寸和小尺寸，并交深浅对照与实际走时预览。
```

只有现有山水无法适配圆形区域时才补生成，要求“圆形中心提亮、细节向边缘分布、无数字、无刻度、无文字”，不要重绘整套装饰。

## F. 弹幕：身份与先后顺序写清楚

```text
制作/修改月渡花汀弹幕样式，沿用现有 DOM renderer、消息流与业务数据。
普通观众灰、舰长蓝、提督紫、总督红，头像旁使用项目现有 B 站身份图，不自己生成徽章。
普通消息先保留小尺寸的深色身份底框，0.5 秒后用 1.6 秒从左向右刷入墨色，底框始终存在。支持头像、昵称、文本与表情。
上任先自上而下显示背景与头像，再从左向右显示对应身份称谓和三只鸟。
礼物/SC 先用 1.4 秒从右向左展开素纸与内容，展开到哪里显示到哪里；之后上下边饰、笔刷和花枝再用 1.2 秒从左向右出现。不要在纸尚未展开时露出装饰。
礼物包含头像、昵称、礼物名、数量与价值，SC 使用留言内容。长内容不拉伸花枝和滚轴。
连续消息平滑接续滚动。交完整实时速度预览和清晰静帧，避免用低分辨率视频评价原画质量。
如加入淡山水暗纹，先标为新提案；内部山水跟随纸面从右向左，不能跟随边饰向右。
```

需要补画卷轴素材时：

```text
Create a refined Chinese silver-blue scroll decoration asset on transparency: delicate engraved roller, moon-white silk-paper texture, fine double-line edge, white camellia and indigo branches.
Keep the content area quiet and empty. Separate roller, edge decoration and corner flowers so paper height can adapt to text without stretching the illustration.
No avatar, badge, nickname, price, gift or readable lettering; those are runtime elements.
```

## G. 礼物许愿：贴圆装饰与可读进度

圆环原画：

```text
Create ONE compact circular ornament around a dark indigo gift medallion, on genuine transparency.
Traditional Chinese gongbi white camellias with many rounded overlapping petals, indigo curved branches and tapered leaves, subtle silver ruyi cloud tracery and moon-white silk.
Decoration follows the ENTIRE circular rim in a narrow band, with varied dense and quiet areas and a few larger camellias. Keep the circle compact, not surrounded by a huge sparse floral halo.
Match the supplied folding fan and opening flower artwork. No Western small-flower wreath, 3D plastic flowers, text or gift icon.
```

给 Codex 的组合任务：

```text
将紧凑圆环放左侧，右侧延长深靛水墨条。礼物名、已收/目标计数、进度条都位于足够深的底色上，不能压在透明浅色末端。
起点固定一枚银蓝小折扇，0 进度仍可见；进度移动端点在 0 时隐藏。收礼时填充平滑推进，流光和细碎光点克制，计数超过目标照实显示，视觉进度封顶。
复用礼物许愿现有数据链路，更新不替换整张卡片、不重复注册动效。
检查 416px、720px、0 进度、满额、超额和长名字，交动态预览与配合背景的完整效果。
```

## H. 全屏感谢：以最新月伞花汀为准

纸伞原画：

```text
Create ONE large elegant Chinese oil-paper parasol as a transparent production cutout, slightly tilted for placement along the side of a 16:9 frame.
Ivory and pale blue translucent paper with delicate indigo mountains and waterside pavilion painting; fine bamboo/silver-blue ribs, restrained pale-gold joints, complete handle and silhouette.
Match the white camellia and folding-fan collection. No person, hand, background, side curtain, lettering or cast floor shadow. Keep all tips fully visible and preserve soft alpha edges.
```

底部花汀原画：

```text
Create ONE continuous wide lower-edge landscape ornament on transparency for a 16:9 livestream thank-you frame.
White camellias and indigo leaves at the lower corners, low moonlit mountains, tiny pavilions, flowing silver-blue water and a few small lotus lanterns connect across the bottom.
Top edge rises and falls naturally but the central upper field remains empty transparent space for the streamer. Low profile, detailed gongbi mineral-watercolor texture, quiet pale-gold reflections.
No solid rectangular plaque, enclosing text box, name, avatar, lettering, person or opaque full-screen background. Water motion will be added later.
```

给 Codex 的组合任务：

```text
制作完整的月伞花汀全屏感谢：两侧山水纸伞、底部连续花汀、四角花枝、上方花体和下方感谢文字同时组合在 16:9 画面中，中央透明。
上任显示 new member、头像、昵称及“舰长上任/提督上任/总督上任”，去掉“新”；称谓文楷，“上任”略小错落，昵称保持清晰宋体。
礼物显示 new presents、昵称、礼物名与数量，不显示送礼人头像。
约 0.18 秒开始纸伞入场，右侧稍晚，0.4 秒花汀、0.6 秒花枝跟进，0.9–1.75 秒信息显现。稳定停留期间花枝、花瓣、水波和莲灯分别运动；约 8 秒信息先退，9.6 秒完全透明。
不要恢复已放弃的玉饰第一层、两侧架子、侧边丝巾或包围式底部铭牌。
交完整交互 HTML、观看视频、透明静帧、源码与字体许可；检查三档上任和礼物模式。MP4 的预览底色必须明确标注。
当前已有版本是独立样片；本轮是否接真实事件按明确任务范围执行，不能仅凭做出动画就宣称已接入。
```

## I. 一轮修改与交付提示词

```text
当前版本：【文件路径；必要时写明视频时刻或截图区域】。
我看到的问题：【具体对象与现象，例如白色数字落在透明末端、纸面未展开就露出花饰】。
参考的是：【哪张图/哪段视频的哪一点；如配色不采用，也明确写出】。
我希望改成：【形状、位置、密度；动画说明谁先出现、向哪边、谁随后出现】。
已经满意并要保留：【配色、主体、布局或其他部分】。
本轮请只围绕上述问题调整，先看当前实现与来源，复用能继续用的素材。若当前做法实现不了目标，说明需要换哪部分做法。
展示方式：【完整组合、实际尺寸、正常播放速度；关键时刻的前后对照】。
以实际画面检查这轮变化；有提案、未实现内容或未验证场景时，明确标注。
更新本轮预览、素材/脚本/提示词来源与版本记录，保留旧版本以便比较。
归档时复制文件并核验 SHA-256，记录原路径和新路径；不移动仍被旧脚本引用的文件，不复制缓存、日志、用户数据或整个测试环境。
```

下面三段把历史反馈整理成更清楚的制作指令，**是本次改写，不是用户原话**。这些修改已存在于当前版本，示例用于以后表达类似问题，不应直接当作待办重做。

**背景密度：**

```text
保留当前银蓝配色和亭台、月亮、倒影。现在挂饰与枝蔓太多，主体不够突出；上一版又偏空。请把背景密度调到这两版之间，减少前景装饰并压低远山、水纹对比。用同一时刻的完整画面给我比较，再看收扇后的空景是否仍然完整。
```

**礼物许愿：**

```text
保留左圆右横条的布局。圆环缩紧，白山茶和墨蓝枝叶沿整圈贴边，画风对照已经认可的开播素材。延长深色水墨衬底，让名称、计数和进度始终落在深色区域；起点增加同套银蓝折扇，零进度也保留。给我看实际小尺寸和完整收礼推进过程。
```

**卷轴动作：**

```text
以这条为最新方向：先让纸面和内部内容从右向左展开，展开到哪里才显示到哪里；纸面完全展开后，上下边线和花枝再从左向右出现。保留普通弹幕的小身份底框，并把它加深。请分别展示纸面展开中、装饰显现中、完成后三个时刻，再交正常速度的连续消息预览。
```

## 历史原始提示词入口

以下路径均相对 `D:/Work/Live/archive/moonlit-suite/`；对应原文件去掉 `files/` 后即为原仓库相对路径。

| 内容 | 原始提示词副本 |
| --- | --- |
| 开播方向稿 | `files/tmp/opening-moon-fan/generation-prompt.txt` |
| 开播第一批分层原画 | `files/tmp/opening-moon-fan/source/generation-prompts.json` |
| 开播背景/挂饰修订 | `files/tmp/opening-moon-fan/source/revision-prompts.json` |
| 动态背景干净底景、图集、柳叶 | `files/tmp/moonlit-background-rebuild/source/prompts.json` |
| 弹幕原画与来源 | `files/public/img/overlays/danmaku-moonlit/provenance.json`、`files/tmp/danmaku-moonlit/generation-calls.txt` |
| 礼物许愿初版与最终圆环 | `files/tmp/gift-wish-moonlit/frame-prompt.txt`、`files/tmp/gift-wish-moonlit/ring-v4-prompt.txt` |
| 早期全屏感谢（被修订） | `files/tmp/moonlit-thanks/source/prompts.json` |
| 最新月伞与花汀 | `files/tmp/moonlit-thanks-refinement/source/generation-prompts.json` |
| 对话中保留的图像生成调用参数 | `conversations/thread-excerpts.json` 中各对话的 `historicalImageRequests` |

原始提示词包含探索中的绿幕、旧构图和未采用的玉饰/枝蔓。复现历史时使用原文；制作新版本时优先使用上面的最终方向模板，并结合当前素材和 [制作指南](production-guide.md)。
