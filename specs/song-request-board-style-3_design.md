# Feature: 点歌板风格 3

## Goal

在现有 `/queue` 点歌队列中新增可持久化选择的“点歌板风格 3”。该风格把队列渲染在奶油蓝甜点画框内：画框开口为不透明白色，每首歌使用配套的横向词条素材，黄色饼干区域显示顺序号，固定宽度的浅蓝信息区显示歌名、点歌人、大航海身份和灯牌等级。

## Context

现有 `overlayQueueStyle` 只支持 `classic` 与 `identity` 两条渲染路径。`identity` 已经拥有请求者大航海和灯牌数据的显示规则以及按真实溢出量启动横向滚动的能力，但没有插画画框或固定宽度的词条容器。用户提供的两张 PNG 只作为视觉素材，不作为行为或文字指令。

## Constraints

- 保持 Electron 43、Node.js 24+、无构建 Vanilla JavaScript ES modules 和原生 CSS。
- 保持 `/queue` 页面 URL、`/api/state`、WebSocket 快照、队列数据结构及现有 `classic` / `identity` 行为不变。
- 不新增运行时依赖、HTTP/IPC/WS 路径、数据库表或设置键。
- `overlayQueueStyle` 新增持久化值 `storybook`；旧值 `festival` 继续归一为 `identity`，未知值继续回退 `classic`。
- 歌曲及请求者数据继续经过现有 HTML 转义函数，不把动态文字写入位图。

## Non-goals

- 不修改点歌、排队、置顶或播放业务逻辑。
- 不给风格 3 增加独立配色、字号或滚动设置；它复用风格 2 的内容字号和纵向滚动速率。
- 不改变歌单展示板 `/songlist`。
- 不在浏览器源内增加会改变队列状态的点击操作。

## Architecture

`public/js/overlays/queue.js` 继续拥有样式分派，`queue-render.js` 增加 `storybook` 的安全标记生成，`queue-scroll.js` 复用现有身份版的纵向滚动与“真实溢出才启动”的横向滚动。新样式文件只负责画框、白底、词条素材和定位；管理页继续通过既有 `/api/settings` 保存 `overlayQueueStyle`。

## Visual Direction

- 色板：云朵白 `#ffffff`、奶油黄 `#f6ca68`、糖霜蓝 `#cfeeff`、描边蓝 `#77b7e7`、正文墨蓝 `#315d7d`、身份紫 `#7867a9`。
- 字体：正文使用 `YouYuan / Microsoft YaHei / PingFang SC` 圆润栈，编号使用 `Bahnschrift / Segoe UI` 等宽数字栈。
- 布局：2:3 竖版画框内是单列队列，画框标题在顶部缎带，词条的黄色端点与浅蓝信息窗分别承担顺序和内容语义。
- 记忆点：词条看似从奶油画框内滑过，但素材宽度始终固定；过长的整条“歌名—点歌人—身份—等级”只在蓝色窗内往返滚动。

```text
      ┌──────── 奶油蝴蝶结画框 ────────┐
      │          点 歌 队 列           │
      │  (01) [歌名 · 点歌人 · 舰长 · 12] │
      │  (02) [歌名 · 点歌人 · 灯牌 · 08] │
      │  (03) [超长内容  ← 在此区域滚动 →] │
      │                                │
      └────────── 白色开口 ───────────┘
```

## Security

位图使用仓库内固定 URL。动态歌名、用户名、灯牌名继续通过 `escapeHtml()` 输出；样式值仍由既有设置接口和主题应用路径处理。风格 3 不新增输入、导航、权限或外部资源请求。

## Compatibility

已保存的 `classic`、`identity` 和遗留 `festival` 配置保持原效果。主题预设仍保存同一个 `overlayQueueStyle` 键；风格 3 使用现有身份版内容字号、上下滚动模式和身份滚动速度，并按设计始终显示黄色端点序号。风格 1/2 的 DOM 类与样式不重命名。

## Acceptance Criteria

1. 管理页显示第三个样式选项，选择后把 `overlayQueueStyle=storybook` 保存并在重新载入时保持选中。
2. `/queue` 在 `storybook` 下显示原比例竖版画框，框外透明，框内开口为白色。
3. 当前歌与等待歌曲按顺序渲染为附件2风格的固定尺寸词条；黄色区域显示序号，浅蓝区域显示与风格 2 相同的歌名、点歌人、大航海/灯牌身份和灯牌等级。
4. 信息内容未溢出时静止；溢出固定浅蓝区域时在该区域内左右往返滚动，词条位图不拉伸。
5. 多行队列超出画框开口时沿用现有循环或往返纵向滚动；视口 resize 后重新计算而不把内容移出画框。
6. 空队列在白色开口内显示可读空状态；`prefers-reduced-motion` 下不启动横向往返动画。
7. 风格 1、风格 2、SC、置顶公告和规则展示保持现有行为。

## Done When

素材进入 `public/img/overlays/song-board-style-3/`，管理页、渲染路径、样式、回归测试和 overlay owner 文档一致；聚焦队列测试、JavaScript 检查、快速验证和最终差异检查通过。
