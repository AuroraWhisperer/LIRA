# 网易云内外播放器歌词同步修复

**Status:** Completed

**后续缺陷：** 用户切换到唱片样式后，MSAA 无法取得被隐藏的进度与状态控件；普通页面对照恢复。此前实测不覆盖该场景，后续独立引擎时钟与剩余验收见[外部网易云独立播放时钟](../2026-10-14-netease-independent-clock.md)。

## Goal

内置网易云优先取得真实逐字时间；平台未提供时按用户授权，以行时间及字词长度估算，连续显示填充/逐字高亮。外部网易云取得当前歌曲的真实时钟后加载同平台歌词。保留已登录账号与现有歌曲、播放队列和窗口状态。

## 修复前证据

- 外部客户端 3.1.4.203507 实机采样识别《石头歌》及数值 ID，但 UIA 返回 Unknown，没有 positionMs / durationMs。恢复窗口未解决用户问题，不能将最小化视作唯一原因。
- Provider 使用旧 `/api/song/lyric`，没有 yv 参数；共享解析器仅以完全相同的 LRC 起始时间挂接逐字数据。
- 外部采集在有效时钟前不请求歌词；当前 loading 文案混淆读取进度和请求歌词。
- 开始工作前已有歌词换行过渡相关未提交改动，涉及 renderer、CSS、overlay 文档、使用说明及新增 line-transition 文件，保留这些改动。

## Ownership And Compatibility

- 内置/外置共享网易云歌词：`src/music/providers/netease-provider.js`；解析器：`src/music/lyric-parser.js`；派生缓存：`src/music/lyrics-service.js`。
- 外部采样与时钟：`src/music/netease-client-monitor.js`、`netease-client-capture.js`、`netease-client-track.js`。
- 连续渲染复用 `public/js/shared/lyric-clock.js`、`lyric-word-animator.js` 和现有 desktop renderer。
- 测试 owners：`test/music/netease-provider.test.js`、`test/lyrics/lyrics.test.js`、`netease-client-*.test.js`、现有渲染/时钟测试。
- 文档 owners：`docs/reference/backend/music/netease-provider.md`、`services.md`；用户入口：`public/pages/admin/toolbox/usage-guide-configuration.html`。
- 不变更 HTTP/WS/IPC 载荷、认证、账号存储、播放权限和 QQ 行为；不添加运行时依赖、常驻服务或修改网易云客户端。实机只读诊断与确定性测试分开，测试仅使用合成数据。

## Milestones

- [x] 比较旧/新歌词接口，确认 v1 可提供 YRC；当前《石头歌》只提供 LRC。Windows MSAA 实机读取成功，保留现有 UIA/SMTC 并补 MSAA 回退，没有采用内存偏移、插件注入或客户端改写。
- [x] 网易云以 YRC 自身时间构建行，缺少有效逐字数据时使用 LRC 行时间估算。仅更新网易云派生缓存版本，保留 QQ v5。
- [x] 外部 monitor 补 MSAA 控件扫描、缓存及 COM 引用释放，继续使用既有时钟和新曲校验；聚焦回归覆盖暂停、seek、切歌、失联与重建。
- [x] 隔离 Electron 验证连续填充、离散高亮、暂停与 seek；保留已有换行动画改动。技术参考与应用内使用指南已同步。

## Verification / QA Inventory

- `node --test test/music/netease-provider.test.js test/lyrics/lyrics.test.js test/lyrics/netease-client-monitor.test.js test/lyrics/netease-client-capture.test.js test/lyrics/netease-client-track.test.js test/lyrics/external-client-lyrics.test.js`
- `node --experimental-vm-modules --test test/lyrics/desktop-lyric-renderer.test.js test/lyrics/lyric-performance.test.js test/lyrics/lyric-word-motion.test.js test/lyrics/desktop-lyric-publication.test.js`
- Provider 合成回归：LRC 与 YRC 不同时间戳、无 YRC 回退、翻译/罗马音选择、单词空格；缓存回归：旧网易云缓存不复用，新缓存只请求一次。
- 外部只读实机检查：歌曲 ID、递增时间、歌词解析就绪；确定性样本验证暂停、seek、切歌和无时钟。无法实测的控制操作明确记录。
- Electron 使用现有隔离 fixture 和 tmp 数据，核查精确路由响应；播放合成音频驱动真实 lyric service 和 renderer，以真实播放/暂停/seek 控件验证两种高亮、连续采样和截图。探索场景：暂停中 seek、切换高亮模式。
- Markdown 变更运行 `npm run verify:docs`；按实际修改运行语法/架构检查；最后查看任务相关 diff、`git diff --check` 与 `git status --short`。

## Failure Handling / Non-goals

不重启或控制用户正在使用的客户端来做隔离测试，不复制登录凭据，不改变客户端版本。读不到有效时钟时保持明确等待状态；仅回退本任务拥有的变更，不覆盖已有改动。不扩展其他音乐平台、歌词样式或播放器功能。

## Done When

两条问题链的根因有证据、修复和对应回归；实际逐字动画与外部采集经过可取得的运行时验证，未覆盖的实机情形如实记录；文档与代码一致，最终 diff 无临时文件或秘密。

## 验证结果与边界

- 上述后端聚焦组合 55 项、渲染/时钟组合 33 项、`node --experimental-vm-modules --test test/admin/frontend-usage-guide.test.js` 16 项通过；7 个修改过的 JavaScript 文件通过 `node --check`；`npm run verify:docs` 10 项通过。
- 回归先复现四项失败：旧接口、YRC/LRC 时间错位、缺失逐字估算、网易云旧缓存命中；修复后通过。MSAA 合成 Windows Form 验证进度/按钮读取、缓存控件更新、重扫和释放，不依赖真实客户端。
- 真实网易云 3.1.4.203507：MSAA 读到 01:39 / 03:20 和 Paused；用户主动开始播放后，独立只读采集进入 ready，37 行歌词含 381 个估算字词，进度从 157000 ms 连续到 199770 ms。随后另一首曲目也读到 Paused 和 162000 / 483000 ms。
- 匿名上游诊断：曲目 33894312 取得 47 行、394 个真实 YRC 词；《石头歌》1869411855 取得 37 行、381 个估算字词。诊断与确定性测试分开，不复制已登录账号凭据。
- Electron 使用既有 `danmaku-canvas-editor.cjs` 隔离 fixture：自身临时 userData/sessionData、内存数据库、随机端口、真实 preload/桌面授权；fixture 验证匿名 `/admin` 401，再通过正常桌面授权载入。合成 WAV 的 HTMLAudioElement 驱动真实 LyricService，通过拦截发布边界连接真实 desktop renderer，操作播放/暂停/进度/模式控件。
- 可见窗口中 650 ms 记录 158 帧不同填充值；2.4 秒暂停时第三字保持 40% 填充，400 ms 后完全相同；暂停中拖到 8.5 秒正确定位第二行，离散模式前三字高亮、后三字未高亮。初次隐藏 fixture 的帧数受可见性影响，改为显示自有隔离窗口后完成验证，未据此修改生产动画。
- 两张截图保留在忽略的 `tmp/netease-playback-research/`；自有 Electron、采集辅助进程均结束，合成 Electron 数据目录已清理。
- 托盘/精简模式未实机验收；估算时间不保证逐字贴合演唱。截图与登录引导入口没有改变，保留原指南图片、README 和交互导览；使用指南补充估算效果说明。
- 用户运行的是 `D:/Work/live-exe/LIRA/LIRA.exe`；本轮修改源码，未替换正在使用的安装包、提交或发布。安装版要包含本次修复的构建后才生效。
