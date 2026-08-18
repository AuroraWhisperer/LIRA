# 桌面歌词高性能渲染升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变桌面歌词现有显示语义和 WebSocket/HTTP 公共契约的前提下，将逐字高亮升级为“本地时间锚点 + 当前行动态渲染 + WAAPI 优先 + 30fps 基线自适应 + 可视区域虚拟化”的稳定方案。

**Architecture:** 保留服务端和播放页的权威时间发布机制，客户端收到状态后建立本地单调时间锚点。桌面歌词时间轴渲染器负责行级 DOM、当前行定位和浏览器原生可视区域跳过；逐字动画器只服务当前行，优先用 WAAPI 控制高亮层，浏览器不支持或动画效果不稳定时回退到固定 30fps 的手动 reveal。全民 K 歌面板继续复用共享时钟/逐字动画能力，但不引入桌面歌词的整首时间轴虚拟化。

**Tech Stack:** Vanilla ES modules、原生 DOM、Web Animations API、`requestAnimationFrame`（30fps 门控）、CSS `transform`/`opacity`/`clip-path`、现有 Electron 43.2.0/Chromium、`node:test`。

## Global Constraints

- 保持 Node.js 24+、CommonJS 后端、Vanilla JavaScript ES modules、无前端构建步骤。
- 不改变 `/api/playback/lyric-state`、`/api/playback/lyric-timeline`、`lyric-state`、`lyric-timeline` 的请求路径、消息类型和载荷形状。
- 保持 `desktopLyricVisibleLines=0` 表示完整歌词可滚动查看；正整数继续表示当前行窗口显示数量。
- 保持播放、暂停、seek、切歌、断线重连、时间偏移、`prefers-reduced-motion` 和 WeSing 的现有语义。
- 不把 Canvas/WebGL/WebGPU 引入运行时，不增加第三方依赖，不创建新进程或服务。
- 先写聚焦测试，再实现；每个任务完成后运行对应测试和 `git diff --check`。

## 追加实施约束（2026-08-18）

- WAAPI reveal 不承诺一定走 GPU 合成。WAAPI 只是动画调度方式，真正性能取决于被动画的 CSS 属性；`clip-path`/reveal 在部分 Chromium/GPU 组合下仍可能触发 Paint，因此必须保留性能检测和 fallback：WAAPI reveal → 30fps 手动 reveal → 静态高亮。实施后必须用 DevTools Performance 实测 Paint、主线程和帧率，不能仅凭使用 WAAPI 就认定性能更好。
- 30fps 调度必须使用 `requestAnimationFrame` + 时间门控，不使用 `setInterval(33)`。rAF 继续负责和浏览器绘制周期同步，但只有距离上次实际 JS 更新达到约 33.3ms 时才执行进度条、倒计时、漂移检测等逻辑。`LyricClock` 本身不需要定时器，只基于 `performance.now()` 和时间锚点按需计算当前媒体时间。
- WAAPI 正常播放期间禁止每 30fps 持续写 `animation.currentTime`。正常播放时让 WAAPI 自己运行，30Hz 调度器只读取 `LyricClock` 并检测 drift。只有 pause/resume、seek、切歌或歌词时间线变化、明显时间回跳、drift 超过阈值时，才允许重新设置或重锚动画时间。
- latest-wins 必须同时使用 `generation + sequence` 防止旧状态回灌。每条 `lyric-state` 携带单调递增 `sequence`；切歌、seek、重新加载时间线等 discontinuity 切换新的 `generation`。客户端只接受 generation 更新，或同一 generation 下 `sequence > lastSequence` 的状态。latest-wins 仅用于降低请求堆积，generation + sequence 负责保证正确性；新增字段必须向后兼容。
- 先把以上约束补入本计划，确认设计和验收标准同步更新后，再按既定阶段实施；不要改变现有视觉效果和外部 HTTP/WS 契约，除非为 generation/sequence 增加向后兼容字段。

## 设计决策

### 1. 时间模型

- 新增共享 `LyricClock` 责任：保存 `{ currentMs, durationMs, playing, updatedAt }` 锚点，用 `performance.now()` 估算本地播放位置。
- 普通状态更新只在时间差超过校正阈值时重置动画；播放/暂停/seek/切歌等强制状态立即重锚。
- 服务端仍是跨页面和跨来源的权威状态；客户端只负责两次快照之间的连续显示。
- 播放页状态上报改成“最新值优先”：最多一个请求在途，未发送的旧状态可被新状态覆盖；强制状态仍按顺序发送。
- `lyric-state` 兼容增加 `generation` 和 `sequence` 字段；普通播放状态在当前 generation 内递增 sequence，切歌、seek、时间线重载等 discontinuity 先递增 generation 并从 sequence=1 开始。旧客户端忽略未知字段，新客户端拒绝旧 generation 或不递增 sequence 的状态。

### 2. 逐字动画模型

- 桌面歌词只维护一套可见逐字 DOM；隐藏的 `desktopLyricPreviewPlayback` 仅作为无障碍/状态文本，不再逐帧写每个词的进度。
- 当前行的每个词使用 base 文本层 + highlight 文本层。高亮层通过 `clip-path: inset(...)` 或等价的 reveal 属性显示，优先创建 WAAPI 动画；不把现有 `linear-gradient` 自定义属性直接改成 WAAPI，因为那仍可能在每帧触发文字 Paint。
- 每个词动画使用绝对时间窗口：`startMs` 为动画起点，`endMs-startMs` 为持续时间。创建后通过 `animation.currentTime` 对齐当前本地时间；动画对象只在当前行或词签名变化时创建。
- 暂停时暂停动画；seek、切歌或权威时间明显回跳时只重置当前行动画，不重建整首时间轴。
- 无逐字时间数据时保持静态文本；WAAPI 不可用时回退到现有 CSS 变量渐变，但由 30fps 调度器节流。
- WAAPI reveal 运行时先记录帧耗时和 Paint/主线程预算；发现持续长帧或高频 Paint 时按 WAAPI → 30fps 手动 reveal → 静态高亮顺序降级。正常播放不在每个调度 tick 写 `animation.currentTime`，仅在离散事件、明显回跳或 drift 超阈值时重锚。

### 3. 行级 DOM 与懒加载

- 用户语义不变：`visibleLines=0` 仍可滚动查看整首歌词；正整数仍以当前行作为中心窗口。
- 第一层懒加载使用每行 `content-visibility: auto`/`contain-intrinsic-size` 跳过可视区外的绘制，同时保留行索引和滚动结构；高行数或低功耗档位再启用“可视区 + 前后两个视口缓冲”的复杂节点窗口。
- 需要回收复杂节点时使用带测量高度的 spacer/占位记录维持 `scrollHeight`，不粗暴删除整首行索引，避免“全部显示”模式滚动条跳动。
- 当前行、用户滚动位置和自动跟随目标所在行具有优先物化权；手动滚动期间暂停自动跟随，但不破坏当前行时间同步。
- 文字、翻译、罗马音的高度变化由字体加载、窗口 resize、设置变化触发局部重新测量；用 anchor 保持滚动位置稳定。

### 4. 30fps 基线与降级

- 默认基线为 30fps（约 33ms 调度周期），因为歌词视觉同步不需要每次屏幕刷新都执行 JS。这里的 30fps 指 JS 编排、状态校正和 fallback 更新频率。
- WAAPI 动画在合成友好的 reveal 属性上交给浏览器动画时间轴运行；若实际 profile 发现该属性仍触发高频 Paint，则切换到严格 30fps 手动 reveal，而不是继续强行使用 WAAPI。
- 运行时以固定 30fps 作为 JS 编排、进度条、倒计时和 fallback 更新频率；不为了追求 60fps 增加动态升档逻辑。WAAPI 若由浏览器合成线程执行，仍可自然按显示器刷新率播放。
- 调度器必须由 rAF 驱动并使用约 33.3ms 的时间门控；只有门控通过才执行进度条、倒计时、fallback reveal 和 drift 检测，`LyricClock` 不创建定时器。
- 运行时使用带滞后的帧预算采样：持续掉帧时关闭昂贵效果并降为静态高亮/CSS fallback；恢复后只恢复效果，不自动提高 JS 调度频率。
- `document.visibilityState !== 'visible'`、暂停、`prefers-reduced-motion: reduce` 或低功耗档位时停止/暂停动画循环。
- 低功耗档位关闭全局 filter、mask、blur、scale、重阴影和不必要的 `will-change`；只保留行高亮和基本 opacity。

### 5. 视觉效果边界

- 删除所有歌词行的全局 `will-change`，只在当前行跟随动画或确实发生合成动画时临时启用。
- viewport 的 brightness/contrast/saturation、mask-image、背景滤镜改成显式效果类，默认路径不创建额外离屏绘制。
- 当前行增强效果保留，但只作用于当前行；低功耗档位不改变歌词颜色语义，只降低阴影/模糊/背景效果。

## 实施任务

### Task 1: 建立共享时间锚点和 30fps 调度器

**Files:**
- Create: `public/js/shared/lyric-clock.js`
- Create: `public/js/shared/lyric-frame-scheduler.js`
- Modify: `public/js/shared/lyric-word-renderer.js`
- Test: `test/desktop-lyrics.test.js`

**Interfaces:**
- `LyricClock.setState(state, { force })`、`getPosition(now)`、`pause()`、`dispose()`。
- `LyricFrameScheduler.start(callback)`、`stop()`、`setTargetFps(fps)`，默认 30fps，仅在页面可见且播放中运行。
- `LyricWordRenderer` 保持现有构造参数和 `setState/getPosition/dispose` 公共接口，内部改为复用共享 clock/scheduler。

- [ ] 为暂停冻结、权威时间回跳、播放恢复、30fps 门控和隐藏页面停止调度补充失败测试。
- [ ] 运行 `node --test test/desktop-lyrics.test.js`，确认新测试在实现前失败。
- [ ] 实现 clock/scheduler，保持当前 WeSing 和桌面预览调用方式不变。
- [ ] 运行 `node --test test/desktop-lyrics.test.js`，确认共享渲染器旧测试和新测试通过。

### Task 2: 实现 WAAPI 当前行逐字动画器

**Files:**
- Create: `public/js/shared/lyric-word-animator.js`
- Modify: `public/js/shared/lyric-word-renderer.js`
- Modify: `public/js/admin/desktop-lyric-preview.js`
- Modify: `public/css/admin/desktop-lyric-preview.css`
- Test: `test/desktop-lyrics.test.js`

**Interfaces:**
- `LyricWordAnimator.mount(lineElement, words, options)` 创建当前行词节点和动画。
- `LyricWordAnimator.sync(position, { playing, force })` 对齐 WAAPI currentTime/播放状态。
- `LyricWordAnimator.clear({ commit })` 提交或清理旧行并释放 Animation 对象。
- `LyricWordAnimator.supported()` 判断 WAAPI 和所需 CSS 能力；不支持时走 30fps CSS fallback。

- [ ] 测试 WAAPI 不可用时回退、同一词签名不重建、暂停/seek 对齐 currentTime、旧行清理和无 words 静态文本。
- [ ] 实现当前行双层文本节点和逐词 reveal，确保 base/highlight 层文本宽度一致、翻译和罗马音不重复动画；动画属性优先使用简单 inset/clip，不再每帧修改渐变停止点。
- [ ] 将桌面预览的逐帧词进度从 `style.setProperty('--preview-word-progress', ...)` 改为当前行 animator；保留严格 30fps 的手动 reveal fallback。
- [ ] 运行 `node --test test/desktop-lyrics.test.js`。

### Task 3: 消除桌面歌词的重复逐字渲染

**Files:**
- Modify: `public/js/admin/desktop-lyric-preview.js`
- Modify: `public/pages/overlays/lyric-window.html`
- Modify: `public/js/overlays/lyric-window.js`
- Test: `test/desktop-lyrics.test.js`

**Interfaces:**
- 桌面时间轴渲染器成为当前行唯一视觉逐字渲染源。
- `desktopLyricPreviewPlayback` 只在行切换/状态变化时更新可访问文本，不再交给共享逐字 renderer 每帧更新。

- [ ] 增加静态断言：桌面歌词页面只有一条逐字视觉更新链，隐藏 playback 节点不参与逐帧 word progress。
- [ ] 删除重复的隐藏逐字 DOM 驱动，确保播放页、管理页预览和 `/lyrics` 均能显示当前行高亮。
- [ ] 验证 aria-live 文本在切行、暂停、无歌词时仍正确。
- [ ] 运行 `node --test test/desktop-lyrics.test.js`。

### Task 4: 启用浏览器原生可视区域懒绘制

**Files:**
- Modify: `public/js/admin/desktop-lyric-preview.js`
- Modify: `public/css/admin/desktop-lyric-preview.css`
- Test: `test/desktop-lyrics.test.js`

**Interfaces:**
- 保持现有 `rowElements`、`findActiveLyricIndex`、跟随滚动和 `visibleLines` 接口。
- 每行使用 `content-visibility: auto` 和 `contain-intrinsic-size`；不默认增加可能改变 flex/宽度测量语义的显式 layout containment。JS 只在当前行变化、字体加载、resize、设置变化时更新必要 class/样式。

- [ ] 测试 `visibleLines=0` 仍保留完整滚动高度，正整数窗口行为不变，当前行和滚动锚点不跳动。
- [ ] 给歌词行启用 `content-visibility: auto` 和 `contain-intrinsic-size`，不引入自定义虚拟滚动器；只有实测后才考虑额外 `contain: paint`。
- [ ] 确保当前行、前后邻近行和自动跟随目标在 Chromium 下可正常测量；对不支持 `content-visibility` 的环境保留现有完整 DOM 回退。
- [ ] 在字体加载、resize、设置变化后执行局部 relayout，不重建整首歌词。
- [ ] 运行 `node --test test/desktop-lyrics.test.js`。

### Task 5: 增加性能档位和效果降级

**Files:**
- Create: `public/js/shared/lyric-performance.js`
- Modify: `public/js/admin/desktop-lyric-preview.js`
- Modify: `public/js/shared/lyric-word-animator.js`
- Modify: `public/css/admin/desktop-lyric-preview.css`
- Test: `test/desktop-lyrics.test.js`

**Interfaces:**
- `createLyricPerformanceProfile({ onChange })` 返回 `profile`、`recordFrame(duration)`、`setVisible(visible)`、`dispose()`。
- Profile 至少包含 `targetFps`、`wordAnimation`、`effects` 三项；档位切换具有滞后，不暴露新的持久化设置。

- [ ] 测试默认 30fps、持续长帧降级、页面隐藏暂停和 reduced-motion 强制低功耗。
- [ ] 实现固定 30fps 编排、掉帧时关闭 blur/scale/mask/重阴影并让逐字动画退回静态或 CSS fallback；不实现自动 60fps 升档。
- [ ] 删除全行 `will-change`，只给当前动画元素临时设置并在结束时移除。
- [ ] 运行 `node --test test/desktop-lyrics.test.js`。

### Task 6: 将歌词状态发布改为最新值优先

**Files:**
- Modify: `public/js/playback/services/lyric-service.js`
- Test: `test/desktop-lyrics.test.js`

**Interfaces:**
- 保持 `publishBrowserState(state, force)` 和 `syncWindow(track, audio, force)` 签名不变。
- 内部只保留一个在途请求；新状态覆盖待发送旧状态；强制状态按顺序完成。

- [ ] 添加请求阻塞期间收到多个普通状态时只发送最终状态的测试，同时保留强制播放/暂停/seek 顺序测试。
- [ ] 实现 latest-wins 队列，失败时清理待发送状态并允许下一次重试。
- [ ] 运行 `node --test test/desktop-lyrics.test.js`。

### Task 7: 完成文档、回归和手工性能验收

**Files:**
- Modify: `docs/architecture/frontend/playback.md`
- Modify: `docs/architecture/frontend/overlays.md`
- Modify: `docs/architecture/engineering/test.md`
- Test: `test/desktop-lyrics.test.js`

- [ ] 更新架构文档，明确 WAAPI 优先、30fps 基线、当前行唯一逐字源、虚拟化和降级策略。
- [ ] 运行聚焦测试：`node --test test/desktop-lyrics.test.js`。
- [ ] 运行语法和架构门禁：`npm run check`、`npm run verify:architecture`。
- [ ] 用 64 行、500 行、带翻译/罗马音的歌词分别测试管理页预览和 `/lyrics`。
- [ ] 在 Electron 硬件加速开启和关闭两种情况下录制 Performance，确认普通设备默认约 30fps、无长时间重复 paint 风暴、切行/seek 不跳行。
- [ ] 最后检查 `git diff`、`git diff --check`、`git status --short`，确认没有生成文件和无关修改。

## 验收标准

- 桌面歌词仍按行显示，`visibleLines` 的用户行为不变；选择“全部”时完整歌词可滚动查看，但窗口外不保留复杂逐字 DOM。
- 播放中桌面歌词只有当前行参与逐字动画，隐藏 playback 节点不再重复执行逐字进度更新。
- 正常设备默认以 30fps 运行 JS 调度；WAAPI 可用时由浏览器负责当前行 reveal，低端设备可关闭昂贵效果或退回 30fps fallback 而不出现明显卡顿。
- WAAPI reveal 必须经过实际 Performance 录制验证；验收记录 Paint、主线程占用和帧率，并能证明发生降级时按 WAAPI → 手动 30fps → 静态高亮顺序工作。
- 正常播放期间不能每 30fps 写 `animation.currentTime`；仅 pause/resume、seek、切歌/时间线变化、明显回跳或 drift 超阈值允许重锚。
- 客户端只接受新 generation，或同一 generation 内严格递增 sequence 的 `lyric-state`；旧字段缺失时沿用兼容的旧客户端行为但不阻塞连接。
- 暂停、恢复、拖动、切歌、断线重连、时间偏移和权威时间回跳后，歌词位置与高亮不会持续漂移或倒退。
- 现有桌面歌词、管理页预览、WeSing 逐字面板和相关测试全部保持兼容。

## 不采用的方案

- 不把整首歌词搬到 Canvas/WebGL/WebGPU：会增加字体、缩放、无障碍、命中测试和 Electron 兼容成本。
- 不用纯 CSS `@keyframes` 作为唯一时间源：暂停、seek、切歌和权威时间校正都需要可编程重锚。
- 不把 60fps 作为硬性目标：歌词同步的正确性和低端设备稳定性优先于每屏刷新一次的 JS 工作量。

## 执行记录

- 已完成共享 `LyricClock`、rAF 30fps 门控、当前行 WAAPI/manual/static 三段降级、桌面唯一逐字渲染源、`content-visibility`、性能档位、latest-wins 以及 generation/sequence 版本过滤。
- 已通过 `node --experimental-vm-modules --test test/desktop-lyrics.test.js`（25 项）、`npm run check`、`npm run verify:docs`、`npm run verify:architecture` 和 `npm test`（653 项，652 通过、1 skipped、0 failed）。
- 已在本地 `/lyrics` 页面验证完整时间轴、当前行、双层词节点和 aria-live 文本；当前浏览器控制面未暴露 DevTools Performance tracing 或页面 Performance API，因此 Paint/主线程/帧率的硬件加速开关对比仍需在 Electron DevTools 中由人工录制确认，不能在本次自动化结果中冒充已完成。
