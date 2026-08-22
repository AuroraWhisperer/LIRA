# Feature: LIRA 全屏开播动画浏览器源

## Status

Draft — Ready for implementation after minor spec fixes

## Goal

为 LIRA 增加一个可被 B 站直播姬或 OBS Browser Source 加载的 **1920×1080 全屏开播等待场景**。

页面以完全不透明的粉黑舞台覆盖当前直播画面，持续渲染一套与主播形象匹配的动态插画：背景光晕、唱片环、音乐心拍流光线、人物轻动态、音符、粒子、EQ 和可配置文案。页面没有固定的播放结束状态，主播切换到正式直播场景后，浏览器源自然停止显示。

第一版以静态资源和前端动画为主，不引入新进程、端口、框架、数据库表或 WebSocket 状态。目标是先得到一个稳定、可长时间运行、适合直播姬浏览器源的视觉场景，再根据使用反馈增加管理页配置。

## Context

### 用户素材

用户提供的主播图像是透明背景 PNG，尺寸约为 `1086×1448`，比例约 `3:4`，包含完整人物、麦克风、音符、蝴蝶结和粉黑配色。它适合在 16:9 画布的右侧作为主视觉，人物伸出的手可以与左侧文案和音乐心拍线形成视觉连接。

临时剪贴板文件不应直接作为运行时资源。实现时应将经过确认的素材复制到：

```text
public/img/overlays/opening/avatar.png
```

### LIRA 当前运行事实

- LIRA 使用 Electron 43、Node.js 24+、Vanilla JavaScript ES modules 和原生 CSS，无前端构建步骤。
- OBS 浏览器源页面位于 `public/pages/overlays/`，前端逻辑位于 `public/js/overlays/`，样式位于 `public/css/overlays/`。
- `src/server/http-utils.js` 通过显式 `pageMap` 将 `/overtime`、`/queue` 等地址映射到 overlay HTML，并为 overlay 页面放开 iframe/frame-ancestors 限制。
- `/overtime` 已有全屏 `100vh`/`100dvh`、容器查询、低功耗模式和 `prefers-reduced-motion` 的实现，可作为全屏页面的尺寸与降级参考。
- 管理页 `public/js/admin/display.js` 当前生成 `/queue`、`/songlist`、`/lyrics` 地址；新页面若要出现在管理页，需要显式增加 URL 展示，而不是依赖通配路由。
- 设置存储由 `src/storage/settings-store.js` 的 key-value 默认值管理。第一版不需要添加持久化键，避免把视觉原型变成跨后端的配置变更。

### 公开资料归纳

公开的 Starting Soon/VTuber 直播包装通常将主播身份、动态氛围背景、倒计时或进度提示、简短文案和音乐信息放在同一屏；1920×1080 是常见的直播画布。[AnimArts 直播包装指南](https://animarts.studio/blog/stream-overlay-design-guide)、[StreamSkins Starting Soon 示例](https://streamskins.net/stream-starting-soon-screen/)。

B 站没有统一的开播动画视觉模板，实际使用通常是直播姬素材中的浏览器页面或视频素材；公开的直播姬教程展示了通过浏览器素材加载自定义页面的路径。[B 站直播姬浏览器素材教程](https://www.bilibili.com/video/BV1b4411B7Vc/)。

OBS Browser Source 支持 URL、宽高、帧率、自定义 CSS 以及网页中的图像和音频任务。[OBS Browser Source 文档](https://obsproject.com/kb/browser-source)

## Design direction

### Theme: 粉黑甜心歌房

视觉关键词：

```text
可爱少女 · 粉黑甜心歌房 · 蝴蝶结与蕾丝 · 粉色舞台光 · 动态插画 · 轻微动态
```

这套方向把角色自身的粉黑配色、蝴蝶结、蕾丝、音符和麦克风作为视觉语言来源。成品应像一张持续呼吸的少女系直播插画，而不是软件 UI 页面；不使用泛化的紫色赛博霓虹、科技面板、仪表盘卡片或粗进度条。可爱感来自柔软轮廓、奶油粉高光和克制的小细节，不靠全屏堆叠爱心与贴纸。

画面的四个核心元素固定为 **人物、唱片环、音乐心拍流光线、粉色舞台光**。EQ、漂浮音符、粒子和文字高光只能作为陪衬。主动态集中在人物后方的唱片、心拍线和麦克风附近，人物本体只做轻微呼吸与漂浮，保证角色脸部、服装和麦克风始终清晰。

### Color tokens

```text
--opening-night:       #1D151C   巧克力紫黑背景
--opening-cocoa:       #35252E   暖棕紫中间色
--opening-pink:        #FF6FA5   草莓粉主高亮
--opening-pink-soft:   #FFC3D8   奶油腮红粉
--opening-text:        #FFF8FB   奶油柔白文字
--opening-gold:        #FFE2A8   极少量香槟高光
--opening-shadow:      rgba(12, 7, 11, 0.58)
```

紫黑只负责托住角色，不能向蓝紫霓虹偏移；金色只允许出现在极少量星点或文字细节中。大面积高饱和粉只用于视觉焦点，不铺满背景。

### Layout

设计基准固定为 `1920×1080`，浏览器源改变尺寸时保持整体比例，不将人物和文字分别拉伸。根画布使用 `aspect-ratio: 16 / 9` 居中缩放；不足的边缘区域填充同色巧克力紫黑，不产生变形。`html`、`body` 和根舞台均使用 `opacity: 1` 的实色或渐变背景，不允许透出下方直播内容；只有人物 PNG 保留 Alpha 透明通道。

```text
┌─────────────────────────────────────────────────────────┐
│  SINGING LIVE                                ·    ♪     │
│                                                         │
│  今晚唱给你听                   柔光 / 极淡唱片环       │
│  开 播 准 备 中                                          │
│                                                         │
│  ───────╲╱────♡────╲╱────────·           主播形象      │
│       音乐心拍流光线                         麦克风      │
│                                                         │
│  @主播名                           MUSIC · LIVE          │
└─────────────────────────────────────────────────────────┘
```

- 人物位于右侧，建议高度为画布的 `82%–87%`，不强制贴底。以 1920×1080 为基准时，人物高度约 `900px`、宽度约 `675px`，水平锚点建议位于 `x=1120–1180px`；垂直视觉锚点约为 `y=120px`，但实际位置必须满足 `y ≤ 1080 − 人物实际高度`，最大高度 `87%` 时 `y` 不得超过 `140px`，以保证鞋和飘带不裁切。
- 左侧保留约 `38%` 的安静区域放置主标题、状态和主播名。
- 人物伸出的手朝向心拍线终点，流光在安全区外指向麦克风一侧，形成“文案 → 心拍线 → 伸出的手 → 麦克风 → 人物”的阅读路径；线条不能为了指向而穿过脸部或麦克风。
- 人物高度和位置首先保证帽子、双马尾、裙摆、鞋和飘带完整；不得为了放大人物而让角色显得塞满画面。

### Background hierarchy and character safe zone

背景保持克制，并按以下固定顺序建立纵深：

```text
完全不透明的巧克力紫黑渐变
        ↓
大型柔和草莓粉径向舞台光
        ↓
非常淡的大唱片圆环
        ↓
少量虚线、音轨或波纹纹理
        ↓
3–4 个可见的慢速音符与少量粉白粒子（high 档最多 6 个节点）
        ↓
人物 PNG
        ↓
麦克风附近的局部高亮星点
        ↓
主标题与辅助文字
```

人物眼睛、脸部、麦克风和伸出的手共同组成 **特效安全区**。唱片边缘、EQ、心拍线、音符和随机粒子不得穿过这些区域；脸后只允许低对比度、边缘柔软的固定光晕。麦克风星点只能出现在麦克风外缘，不能掠过眼睛或遮挡表情。安全区属于截图视觉验收项，不要求引入运行时碰撞检测。

标题使用圆润但不过分幼态的粗体无衬线字，奶油白为主、草莓粉为辅；不添加按钮、标签胶囊、玻璃卡片或可被误认为软件控件的容器。背景纹理的对比度必须低于人物轮廓和文字。

## Animation behavior

### 入场与待机分离

页面首次加载时执行一次短入场动画，完成后进入多组异步循环。不能把所有内容塞进一个 24 秒时间轴，否则每轮同时归零会产生明显接缝。

```text
0.0s   背景从深色淡入
0.3s   人物附近的粉色光晕出现
0.5s   人物开始柔和浮现
0.8s   唱片环显现
1.0s   主标题淡入
1.2s   音乐心拍线绘制
1.5s   辅助文字出现
2.0s   进入待机循环
```

`character-enter` 从 `opacity: 0; transform: translate3d(0, 12px, 0) scale(.985)` 开始，在 `0.8–1.0s` 内过渡到 `opacity: 1; transform: none`。使用柔和的 ease-out，不允许人物从屏幕外飞入、弹跳或产生 PPT 转场感。

### 人物 transform 分层（强制实现约束）

呼吸、漂浮和摆动不能在同一个人物元素上声明多个都会修改 `transform` 的 CSS animation，否则动画会互相覆盖。人物 DOM 必须使用嵌套 wrapper，让每一层只拥有一种变换：

```html
<div class="character-anchor">
  <div class="character-enter">
    <div class="character-float">
      <div class="character-sway">
        <div class="character-breathe">
          <img class="character-image" alt="">
        </div>
      </div>
    </div>
  </div>
</div>
```

```text
character-anchor     固定人物位置、尺寸和裁切
character-enter      只负责首次入场的 opacity/translate/scale，结束于 identity
character-float      只负责 translateY 漂浮
character-sway       只负责 rotate 摆动
character-breathe    只负责 scale 呼吸
character-image      只显示 PNG，不声明循环 transform
```

这些 wrapper 是验收要求，不得由实现者合并成单一 `.character` 元素。入场动画只能落在 `character-enter`，不得复用 float/sway/breathe 三个循环层；入场完成后该层停在 `transform: none`、`opacity: 1`。

### 不同周期的待机动画

| 层级 | 元素 | 建议周期/范围 | 说明 |
|---|---|---:|---|
| 主要 | 人物呼吸 | 6.3 秒 | `scale(1) → 1.006 → 1`，不包含位移 |
| 主要 | 人物漂浮 | 8.7 秒 | 轻微 `translateY`，不超过 5px |
| 主要 | 人物摆动 | 11.2 秒 | `rotate(-0.15deg) → 0.15deg` |
| 主要 | 唱片环 | 43 秒 | 缓慢旋转，透明度低 |
| 主要 | 心拍流光线 | 5.6 秒 | 光点约用前 45% 时间单向通过，剩余时间淡出停歇 |
| 环境 | 背景光晕 | 17 秒 | 右上到右下缓慢漂移 |
| 环境 | 音符 | 7/9/11/13 秒 | 3–6 个错开上浮、旋转、淡出，并保留空窗 |
| 环境 | EQ | 600–1200ms 更新 | 小批量更新目标高度，穿插 1.5–3 秒停顿 |
| 细节 | 麦克风光点 | 1.5–3 秒生命周期 | 随机间隔 2–5 秒，小范围出现 |
| 细节 | 文字高光 | 12–18 秒 | 只在其中约 1 秒低对比度扫描，其余时间静止 |

人物、唱片和背景光可以持续以极低幅度运动；音符、粒子、EQ、心形和文字高光必须有彼此错开的静止或不可见区间。任一时刻不应让全部元素同时达到运动峰值。

### 音乐心拍流光线

音乐心拍线是主题签名元素，但不表示真实时间进度。它是一条细的心电线/音频波形，线宽建议为 `2–3px`，不使用外框、底槽或填充比例：

```text
───────╲╱────♡────╲╱─────────
            · → 微弱流光
```

静态波形可以用内联 SVG `path` 或 CSS mask 绘制，颜色为低透明度草莓粉；移动光点必须由伪元素的 `transform: translate3d()` 驱动，不得使用 JS 每帧更新，也不得使用 `background-position`。`.track` 必须是 `position: relative; overflow: hidden` 的裁切容器，`::before` 使用绝对定位、`pointer-events: none`，只在线条遮罩内可见。伪元素是宽约 `112–144px` 的柔和线性高光，从左向右通过后淡出，并在下一轮前保留静止空窗。小心形只偶尔做一次 `opacity/scale` 心拍，不能持续跳动。

推荐结构：

```text
.track
├── .track-waveform    静态 SVG/path 或 CSS mask
└── ::before           柔和流光，translate3d() 单向通过
```

`.track::before` 的高光宽度和位移距离必须固定且可测量，移动结束后通过不可见空窗复位，不能在复位帧产生闪跳。不得增加承担同一移动职责的 `.track-flow` DOM 子元素。最终轮廓必须保持“细线”，禁止还原成带矩形边框、斜纹填充或进度槽的粗灯轨。

推荐关键帧边界为：`0%–8%` 位于左侧裁切区且不可见，`8%–45%` 完成一次单向通过，`45%–60%` 在右侧淡出，`60%–100%` 保持静止空窗；允许等价时间分配，但必须保留“通过—淡出—停歇”三段并避免复位闪跳。

如果未来需要真实的“等待倒计时”，另加独立的数值倒计时组件；不能把主题心拍线同时当作语义进度条。

## Runtime architecture

### Page and asset layout

第一版建议新增以下文件：

```text
public/pages/overlays/opening.html
public/css/overlays/opening.css
public/js/overlays/opening.js
public/img/overlays/opening/avatar.png
public/img/overlays/opening/background.webp       # 可选
public/img/overlays/opening/music.ogg             # MVP 必备的授权循环音频，默认不自动启用
test/opening-overlay.test.js
```

MVP 还会修改两个现有管理页文件，用于复制浏览器源地址：

```text
public/pages/admin/song/overlay-addresses.html
public/js/admin/display.js
```

`background.webp` 缺失时使用 CSS 渐变和唱片环作为背景；`music.ogg` 必须存在并由实现测试验证。`audio=browser` 加载或播放失败时，页面回退为无网页音频并保留视觉动画。

页面依赖关系：

```text
直播姬/OBS Browser Source
          │  GET /opening
          ▼
src/server/http-utils.js
          │  pageMap + overlay frame policy
          ▼
opening.html
    ┌─────┼───────────────┐
    ▼     ▼               ▼
 opening.css  opening.js  本地图片/音频资源
    │         │
    │         ├─ 入场动画状态
    │         ├─ query 参数解析
    │         ├─ 粒子/音符/EQ 调度
    │         └─ 可选音频播放状态
    ▼
1920×1080 全屏动态场景
```

### 页面职责

`opening.html` 只保留稳定的语义 DOM：背景层、唱片环、人物层、人物 transform wrapper、心拍线、文案、EQ 和粒子容器。不要把大量动态 HTML 作为模板字符串反复重建。

`opening.css` 负责固定布局、颜色令牌、关键帧和画质降级。动画优先使用 `transform`、`opacity`，避免持续改变 `top/left/width/height`；人物变换按 wrapper 分层，心拍流光按伪元素 `translate3d()` 实现。

`opening.js` 只负责：

- 解析并约束 URL 参数。
- 在首帧添加入场状态，完成后切换到待机状态。
- 使用有限数量的 DOM 节点调度粒子和音符。
- 根据画质档位启停 EQ、粒子和高光。
- 在页面隐藏时暂停非必要的 JS 调度，在重新可见时恢复保存的动画相位；页面真正重新加载时重新执行入场动画。

该页面不连接 `/ws`，不读取点歌队列，也不参与 B 站消息处理。开播等待场景的内容应该是确定的，避免网络断开时出现半加载状态。

### 页面隐藏与重新加载的生命周期

必须区分“页面仍然存在但不可见”和“Browser Source 被销毁或重新加载”：

| 情况 | 页面状态 | 处理方式 |
|---|---|---|
| `document.visibilityState === 'hidden'` | JS/DOM 仍然存在 | 暂停粒子调度和非必要动画，保存当前相位 |
| 页面重新变为 `visible` | 同一页面继续运行 | 从保存的相位恢复，不重新执行入场动画 |
| Browser Source 刷新或重新创建 | 新的 document/JS 状态 | 视为新加载，重新执行一次约 2 秒入场动画 |

直播姬/OBS 的首选浏览器源设置为：

```text
Width: 1920
Height: 1080
FPS: 30
Shutdown source when not visible: Off
Refresh browser when scene becomes active: Off
```

如果主播希望每次切回开播场景都重新播放入场动画，可以主动打开 `Refresh browser when scene becomes active`；这属于浏览器源刷新行为，不是页面内部试图保存跨 reload 的动画状态。

## Server and route integration

实现时需要在 `src/server/http-utils.js` 做三处明确变更：

1. `pageMap` 增加：

   ```js
   ['/opening', 'pages/overlays/opening.html']
   ```

2. `addFrameProtectionHeaders()` 的 overlay 路径集合增加 `/opening`，使直播姬/OBS 能加载页面。
3. `contentType()` 增加 `.ogg` → `audio/ogg` 的 MIME 映射，供 MVP 的可选网页音频模式使用。其他格式不在第一版契约内。

不要通过通配路径把 `pages/overlays/opening.html` 暴露成另一条未声明的公共页面；新页面必须和现有 overlay 一样拥有显式入口。

## URL configuration contract

### MVP：查询参数配置

第一版仍不引入数据库键，但同时提供 URL 参数契约和管理页即时编辑器。浏览器源地址由管理页生成，主播不需要每次手工拼接 URL。

| 参数 | 默认值 | 约束 | 作用 |
|---|---|---|---|
| `title` | `今晚唱给你听` | 最多 20 个字符 | 主标题 |
| `subtitle` | `开播准备中` | 最多 40 个字符 | 副标题 |
| `name` | `主播名` | 最多 32 个字符 | 主播名 |
| `footer` | `SINGING LIVE` | 最多 48 个字符 | 底部辅助文字 |
| `quality` | `normal` | `high/normal/low` | 画质档位 |
| `showNotes` | `true` | 布尔值 | 是否显示漂浮音符 |
| `showEq` | `true` | 布尔值 | 是否显示 EQ |
| `audio` | `none` | `none/browser` | 默认不在网页内播放音频；`browser` 为可选实验模式 |
| `debug` | `false` | `0/1` | 仅在 `1` 时显示音频失败等诊断提示 |

第一版固定为“入场一次 + 待机循环”，不支持一次播放后停住的 `mode`，避免把等待页误解为自动结束的片头。所有参数先经长度和字符约束，再通过 `textContent` 写入 DOM。未知参数忽略；非法枚举和布尔值回退默认值；文案按 Unicode 码点计数并去除控制字符。不得将 URL 文案直接拼接进 HTML。

### MVP：管理页即时 URL 编辑器

在现有 `public/pages/admin/song/overlay-addresses.html` 的“直播画面”区域增加开播画面编辑卡片：

```text
主标题       [ 今晚唱给你听          ]
副标题       [ 开播准备中            ]
主播名       [ 主播名                ]
底部文字     [ SINGING LIVE          ]
画质         [ Normal ▼             ]
☑ 显示音符   ☑ 显示 EQ

浏览器源地址 [ http://127.0.0.1:... ] [复制地址]
```

输入或选择变化时，`public/js/admin/display.js` 只使用 `URL`/`URLSearchParams` 重新生成 `openingUrl` 并更新页面，不调用 `/api/settings`，不写入 localStorage，也不保存到数据库。复制按钮沿用现有 `data-copy-url` 机制。`audio=none` 固定由编辑器生成；`audio=browser` 仅作为手工调试参数，不在正式编辑卡片中暴露。

### 后续：管理页持久化

当第一版在直播姬中稳定运行后，再考虑增加：

- `openingTitle`
- `openingSubtitle`
- `openingStreamerName`
- `openingFooter`
- `openingQuality`
- `openingShowNotes`
- `openingShowEq`

这些键需要同时更新 `src/storage/settings-store.js` 默认值、管理页片段、`public/js/admin/display.js` 表单收集和相关测试。素材路径不应让用户输入任意文件系统路径；只允许仓库内置资源或已经校验过的本地媒体协议。

## Audio strategy

### MVP 推荐模式：独立媒体源

第一版默认 `audio=none`，浏览器源只负责画面；音乐作为直播姬/OBS 的媒体源单独添加并循环播放。这样不依赖浏览器 autoplay 和浏览器源的音频路由，且能单独调节音乐音量。OBS Media Source 原生支持本地音频循环。[OBS Media Source 文档](https://obsproject.com/kb/media-sources)

### 可选模式：网页内置音频

`audio=browser` 是 MVP 必须实现和测试的可选运行模式，但默认值仍为 `audio=none`。只有 URL 明确指定 `audio=browser` 时，网页才加载同源 `<audio loop>` 播放 `music.ogg`。`play()` 失败时，正式画面静默降级为无网页音频并执行 `console.warn()`；只有 `debug=1` 时才显示诊断提示。Chrome 官方文档说明带声音的自动播放可能需要用户交互，因此不能假设 Browser Source 一定允许无交互播放。[Chrome Autoplay Policy](https://developer.chrome.com/blog/autoplay/)

网页无法检测直播姬/OBS 是否同时配置了独立媒体源，因此互斥属于操作约束：使用 `audio=none` 时可添加独立媒体源；使用 `audio=browser` 时不得再添加同一音乐的独立媒体源。M4 分别测试两种配置，不要求页面自动识别外部音频。

第一版不做真实 FFT。EQ 使用定时器分批生成平滑目标高度即可；以后确实需要音乐同步时，再增加 Web Audio `AnalyserNode`，并保留无音频时的程序动画兜底。

EQ 只作为人物后方的背景纹理，不得做成独立控件。柱体使用细线或短圆角条，不带面板、刻度、标签和外框；整体 `opacity` 保持在 `0.10–0.18`，更新之间保留随机静止区间。EQ 不得进入人物特效安全区，也不能比心拍线或标题更醒目。

音频必须是主播拥有授权或明确可用于直播的素材。报告不规定具体曲目，也不把 B 站视频音频抓取作为实现方案。

## Quality and performance

### 画质档位

```text
high:
  人物、唱片环、心拍线、6 个音符、最多 24 个粒子、16 根低透明度 EQ、光晕、高光

normal:
  人物、唱片环、心拍线、4 个音符、最多 12 个粒子、10 根低透明度 EQ、基础光晕

low:
  人物呼吸、唱片环、静态心拍线、文字入场；关闭音符、粒子、EQ、重滤镜
```

### 运行约束

- 默认目标为 1920×1080、30 FPS。
- 数量上限由画质档位固定：high 为 24 粒子/6 音符/16 EQ，normal 为 12 粒子/4 音符/10 EQ，low 为 0 粒子/0 音符/0 EQ。
- 大面积 `filter: blur()` 和多层 `box-shadow` 不作为持续动画；只保留少量固定光晕。
- `quality=low` 仍保留人物呼吸、唱片和静态心拍线；`prefers-reduced-motion: reduce` 的优先级更高，会停止人物漂浮/摆动、唱片旋转、心拍流光、音符、粒子和高光，只保留不超过 180ms 的必要淡入和静态画面。
- 页面不可见时通过 `document.visibilitychange` 暂停粒子调度和非必要 `requestAnimationFrame`；重新可见后从保存的动画相位继续，不重新触发入场。CSS 动画由 `visibility`/低功耗类统一降级。
- 不使用 WebGL、Three.js、Live2D、复杂物理引擎或视频解码作为 MVP 依赖。

## Security and compatibility

- 新增 `/opening` 是本地 overlay 页面，不改变已有 HTTP、WebSocket、IPC、数据库和认证契约。
- 页面不需要访问 Cookie、B 站 API 或任意文件系统；服务端若按现有机制注入 `window.__API_TOKEN__`，`opening.js` 不得读取、记录或转发它。
- 图片、音频和字体引用必须使用仓库内路径或同源路径，禁止把用户输入直接变成 CSS `url()`。
- 文案查询参数必须经过长度限制并通过 `textContent` 渲染，避免 HTML 注入。
- 路由必须纳入现有 overlay frame policy；其他管理页继续保留 `frame-ancestors 'none'` 和 `X-Frame-Options: DENY`。
- 保留 `100vh` 兜底，再声明 `100dvh`，避免直播姬 Chromium 内核在动态视口单位不完整时塌陷。
- 不把临时剪贴板路径、用户绝对路径或外部 CDN URL 写入默认配置。

## Implementation milestones

### M1：静态页面与视觉骨架

新增 `opening.html`、`opening.css`、`opening.js` 和已确认的主播 PNG，完成固定 1920×1080 构图、人物层、背景层、文案层、唱片环和音乐心拍线。

验证：Chrome 本地预览无控制台错误，完全不透明的巧克力紫黑背景覆盖整个 16:9 画布；人物高度处于 `82%–87%`，不裁头、不裁脚、不压满画面；脸部、眼睛、麦克风和伸出的手没有被装饰层穿过，1920×1080 下文案可读。

### M2：服务器入口与 MVP 地址编辑器

更新 `src/server/http-utils.js` 的 page map、frame policy 和必要媒体 MIME；在 `public/pages/admin/song/overlay-addresses.html` 增加开播画面编辑卡片，由 `public/js/admin/display.js` 生成不落库的 `openingUrl`；增加 `/opening` 的路由测试。

验证：`GET /opening` 返回 200、Content-Type 为 HTML、没有禁止嵌入的 frame headers；静态图片和音频路径能按预期返回；编辑字段安全编码进 URL，编辑过程没有设置写请求。

### M3：动态调度与画质降级

加入多周期人物、唱片、心拍流光、音符、粒子和 EQ；实现 `quality=high/normal/low`、`prefers-reduced-motion` 和页面隐藏暂停。

验证：30 分钟连续运行没有 DOM 数量无限增长、明显循环接缝或错误日志；低画质模式关闭非必要特效。

### M4：直播姬验证与音频选择

在直播姬中以 `1920×1080 / 30 FPS` 加载管理页生成的 `http://127.0.0.1:<port>/opening?...`，分别测试网页音频和独立媒体源。

验证：普通隐藏再显示时继续原动画相位；Browser Source 真正刷新时重新播放入场动画；分别在“`audio=none` + 独立媒体源”和“`audio=browser` + 无独立媒体源”两种互斥配置下测试，后者无法 autoplay 时静默降级并只在 `debug=1` 显示诊断。

### M5：保存为默认值（可选）

只有在 M1–M4 稳定后，才考虑把 MVP 编辑器中的文字和画质保存为默认值。该阶段才增加管理页持久化设置键，并单独写实现计划、更新 `specs/README.md`、架构页面索引和对应测试。

## Acceptance criteria

1. `/opening` 是显式注册的 overlay 页面，能被直播姬/OBS Browser Source 直接加载。
2. 在 1920×1080、30 FPS 下，根舞台完全不透明并覆盖整个画面；人物 PNG 保留透明轮廓，人物和主要文案不被裁切。
3. 页面首次加载有短入场动画，随后进入持续运行的多周期待机动画；不存在“所有元素同时归零”的明显大循环。
4. 1920×1080 基准下人物高度为 `82%–87%`；帽子、双马尾、裙摆、鞋和飘带完整，人物眼睛、脸、麦克风和伸出的手处于无遮挡的特效安全区。
5. 人物至少具备呼吸、轻漂浮和轮廓光变化；呼吸、漂浮、摆动分别由嵌套 wrapper 持有自己的 `transform`，不得互相覆盖。首次入场从 12px 下方柔和浮现，不从屏幕外飞入。
6. 音乐心拍线保持 `2–3px` 的细线外观，不带矩形框、底槽或斜纹进度填充；柔和高光由 `.track::before` 的 `translate3d()` 单向通过，不使用 `background-position` 或 JS 每帧更新。
7. 唱片环、音符、粒子、EQ 和麦克风光点存在数量上限，不会无限创建 DOM 节点；次要元素具有错开的静止区间，不会持续同时运动。
8. EQ 只作为 `opacity: 0.10–0.18` 的背景纹理，不带面板、刻度、标签或外框，也不进入人物特效安全区。
9. `quality=low` 和 `prefers-reduced-motion: reduce` 能显著减少动态特效，页面仍保持可读和可用。
10. 查询参数文案使用安全的文本渲染，并受到长度限制。
11. 默认 `audio=none` 时视觉动画不依赖音频；MVP 支持的 `audio=browser` 被阻止时正式画面静默降级，只在 `debug=1` 显示诊断。两种音频配置分别验收，外部媒体源互斥由操作者保证。
12. 管理页可以即时编辑标题、副标题、主播名、底部文字、画质、音符和 EQ，并生成不落库的 `openingUrl`。
13. 普通隐藏再显示恢复原动画相位；Browser Source 真正刷新或重新创建时重新执行一次入场动画。
14. 新增功能不改变现有 overlay、WebSocket、IPC、认证、数据库和直播页面契约。
15. Electron/直播姬截图验收中不存在科技 HUD 网格、仪表盘卡片、刻度面板、玻璃容器或粗矩形进度槽；背景虚线、音轨和波纹不得排列成规则化 HUD 网格。

## Tests and verification

实现时至少增加：

```text
test/opening-overlay.test.js
```

测试覆盖：

- HTML、CSS、JS 和主播素材路径存在。
- `src/server/http-utils.js` 显式注册 `/opening`。
- `/opening` 不返回禁止 iframe 的安全响应头。
- 管理页存在全部 MVP 编辑字段并生成 `openingUrl`，地址以本地 `127.0.0.1` origin 为基准，编辑过程不调用 `/api/settings`。
- 人物 DOM 存在独立的 `character-enter`、`character-float`、`character-sway`、`character-breathe` 分层，每层只声明自己的 `transform` 动画。
- 心拍线包含静态 `.track-waveform` 和移动的 `.track::before` 柔和高光；高光使用 `translate3d()`，`.track` 负责 `position/overflow` 裁切并保留通过—淡出—停歇关键帧；不依赖 `background-position` 或 JS 每帧更新，也不存在同职责 `.track-flow` 子元素。
- `visibilitychange` 只负责同一 document 的暂停/恢复；初始化路径在新 document 加载时重新触发入场。
- 关键 DOM、画质参数、`audio=none/browser`、`debug=1`、`prefers-reduced-motion` 和文案安全渲染存在。
- CSS 或截图验收覆盖根舞台不透明、人物尺寸/底边约束、特效安全区、低透明度 EQ 以及无 HUD/UI 装饰容器。
- `music.ogg` 存在，且 `.ogg` 的 `audio/ogg` MIME 映射与 `audio=browser` 加载失败降级均有覆盖。

建议验证顺序：

```text
node --test test/opening-overlay.test.js
npm run verify:docs
npm run check
npm run verify:quick
```

最后检查：

```text
git diff --check
git status --short
```

视觉验收仍需在 Electron/直播姬浏览器源中完成，不能只以普通浏览器窗口为准。

## Non-goals

第一版明确不包含：

- 真实 Live2D 骨骼、嘴型、眨眼和局部物理。
- WebGL、Three.js 或复杂 3D 粒子系统。
- 真实音乐 FFT 或音频驱动的人物动作。
- 科技 HUD、仪表盘卡片、玻璃面板、粗矩形进度条或高密度赛博霓虹背景。
- B 站礼物、弹幕、点歌队列和 `/ws` 实时数据。
- 从 B 站视频或第三方站点抓取音乐。
- 新增服务进程、端口、前端构建工具或运行时依赖。
- 可持久化的管理页主题编辑器、用户上传资源和任意本地文件选择器（留到后续阶段）；MVP 仅提供不落库的 URL 编辑器。

## Decision summary

采用 **本地资源驱动的独立全屏 Browser Overlay + CSS/JavaScript 多周期动态动画 + 可选独立媒体源** 的 MVP。

视觉采用 **粉黑可爱少女歌房 × 动态插画 × 轻舞台包装**。人物、唱片环、音乐心拍线和粉色舞台光承担主要识别度；EQ、音符与粒子降为背景陪衬，明确排除科技 HUD 和软件 UI 观感。

理由：

1. 与 LIRA 现有 overlay 页面、HTTP page map 和 Electron 本地服务模型一致。
2. 不需要新后端状态，不会把一个纯视觉页面耦合到 B 站连接或播放状态。
3. 单张透明 PNG 已足够做呼吸、漂浮、轮廓光、镜头和环境动效。
4. 独立媒体源规避浏览器带声音 autoplay 和音频路由差异；网页内音频仍可作为可选能力。
5. 通过多个不同周期和错开空窗的轻动画保持长期动态感，同时用 low 画质和 reduced-motion 控制直播机资源占用。

## Done when

本功能实现完成的条件：

- 主播 PNG 已复制到仓库内的 opening 素材目录，并确认允许用于直播。
- 默认主标题、主播名和底部辅助文案已确定；`music.ogg` 已确认具备直播授权。
- M1–M4 的实现、焦点测试、`verify:docs`、`check` 和 `verify:quick` 均通过。
- 直播姬 1920×1080 浏览器源连续运行至少 30 分钟，画面无明显接缝、错误日志或资源无限增长。
- 完成 `git diff`、`git diff --check` 和 `git status --short` 审查，未混入临时文件、用户数据或未授权媒体。
