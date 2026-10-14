# 外部播放器采集与智能播放

Status: Completed

## Goal

接入外部网易云音乐；外部 QQ 与网易云只获取本平台歌词；智能选词仅作用于全民 K 歌。检测与显示选择分离，单一播放来源无需先手动选中，多来源由智能播放或手动优先项决定。结合提供的 Now Playing 项目修复 QQ 采集的已确认缺口。

## Current Behavior And Ownership

- `src/music/qq-client-capture.js` / `qq-client-monitor.js` 已有 QQ SMTC 采集；错误地把超过 3 秒未更新的 SMTC 时间戳当失效，进程退出无恢复。
- `src/server/music-runtime.js` 当前按单选启动一个采集器，外部选中时丢弃内置发布；前端也暂停、禁止内置播放。这与最新要求不符。
- 网易云 3.1.4 的既有实测无 SMTC，需要窗口标题、UI Automation 时间控件和本地曲目记录；参考代码在忽略目录 `tmp/now-playing-lyrics-research-20261014/`。
- 外部歌词解析由新的固定平台 resolver 拥有；复用现有 Provider / 歌词缓存 / 匹配，不继承全民 K 歌多来源偏好。
- Runtime 负责采集生命周期接线，来源选择规则放在音乐域模块；API / 管理快照保持原入口，扩展选择与有效来源信息。
- 文档 owner：`docs/reference/backend/music/services.md`、`backend/api.md`、`backend/ws.md`、`frontend/playback.md`、`frontend/app.md`；用户说明为应用内直播歌词及歌词获取与同步指南。

## Decisions And Compatibility

- 桌面显式启用 `nativeMusicCapture` 后，所有支持的采集器在服务启动时独立检测，退出时清理；独立 server 与普通测试默认不启动原生采集。选择只决定显示优先级。一个播放器播放时始终跟随；多个同时播放时手动优先项若在播放则优先，否则保持仍在播放的当前项，再选择可用项。智能播放不遥控外部播放器。
- `source` 为实际显示来源；新增 `selection` 为 `auto / internal / qq-client / netease-client / wesing`，默认 auto；新增 `neteaseClient` 与 `playingSources`。选择为运行时偏好，不新增持久化字段。
- 内置播放器继续发布候选状态，服务端缓存并隔离版本；切换显示时发布被选中的完整时间轴，旧来源的迟到数据不能覆盖选中来源。
- 网易云本地数据库只读，禁止修改 journal_mode，不读取凭据。准确 ID 无法确认时只在网易云搜索；QQ 只在 QQ 搜索。保留错误/无歌词状态。
- 保留本地鉴权、Overlay 协议、Electron 安全边界和所有无关未提交改动。不提交、不安装依赖、不发布。
- 用户明确选择之后自行测试真实播放器，本次完成模拟契约回归、原生 helper 编译/无客户端检查和隔离 Electron UI 验证，不把这些当成真实播放验收。

## Milestones

- [x] 网易云：UIA 进度/状态、准确歌曲 ID、独立采集生命周期及切歌时序；18 项采集/监视/曲目读取回归通过，含 Windows helper 编译。
- [x] QQ：正确解释 SMTC 时间锚点、保留实际播放状态、监视进程恢复/停止以及非原子切歌；17 项 capture/monitor 回归通过。
- [x] 统一仲裁与固定歌词源：单播放器无需选中、并播优先/保持、暂停/退出交接、旧异步结果不串源；运行时与路由回归通过。
- [x] UI：网易云入口、智能播放、优先项与实际来源区分；去除显示来源对内置播放的误限制；智能选词只属全民；frontend suites 和隔离桌面通过。
- [x] 同步 owner 文档与用户说明，运行文档/语法/架构门禁，审查任务差异。

## Verification

- `node --experimental-vm-modules --test test/lyrics/*.test.js`，以及受影响 `test/wesing/`、`test/playback/` 和现有使用指南测试（按实际命令记录）。
- `npm run check`、`npm run verify:architecture`、`npm run verify:docs`，对应多来源公共契约与生命周期变化。
- 隔离 Electron 检查原生鉴权、网易云/QQ 状态、智能及手动优先项、无播放器/无歌词、内置播放不因跟随项改变而禁用；不操作用户正在运行的应用。
- 最终 `git diff --check`、任务范围 diff 与 `git status --short`；保留既有工作，QA 临时文件仅在 `tmp/`。

## Failure Handling And Done When

监视错误进入可恢复状态；关停后迟到回调无效。仅逐处撤销任务自己引入的变动，不回滚用户已有工作。上述要求均有实现、聚焦回归及同步文档证据后完成；真实播放器兼容性测试按用户选择留给其自行执行，明确报告边界。

## Evidence

- 需求纠正：检测始终独立于选择；跨平台智能选词只允许全民 K 歌。
- 三个并行子任务分别拥有网易云采集、QQ 完善、前端；主任务拥有仲裁、resolver、路由、文档和综合验证，避免同文件冲突。
- 集成审查复现并修复：内置新时间轴先到时不能回放旧曲文字和进度；候选状态先清空为新曲 loading，保留最近实测播放标志，等待对应状态。双方输入与广播版本独立，28 项相关集成回归通过。
- 本平台检索须匹配规范化完整歌名和已知歌手集合，保留 Live/DJ 等版本标记；双方有时长时相差不超过 5 秒，再按最近时长排序。错误歌手与不同录音、精确现场合唱版本均有回归，不沿用点歌评分中的版本惩罚。
- 网易云与 QQ 均处理新曲唯一 SMTC 锚点随歌名同时上报；网易云 UIA/SMTC 时钟切换不混用采样时间。
- 最终组合：用 `rg --files test/lyrics test/wesing test/playback` 枚举 `.test.js`，加 `test/desktop/electron-startup.test.js`、`electron-shutdown.test.js`、`electron-main-modules.test.js`，执行 `node --experimental-vm-modules --test --test-concurrency=4`，443/443 通过，日志 `tmp/external-music-following-tests.log`。
- `npm run check`：1544 文件通过；`npm run verify:architecture`：27/27 通过。初次空 catch 门禁失败已改为显式回退，不扩展旧债白名单。使用指南 16 项通过。
- 隔离 Electron 使用生产 preload、授权会话及 local-media 协议：匿名 `/admin` 401，正常桌面授权通过；15 组情景验证单源/并播/暂停交接、定向重试、空歌词/错误恢复、WeSing 独立偏好、内置音频继续播放，1024/1280 宽度控件检查通过。证据 `tmp/lyric-source-desktop-20261014/qa-evidence.json`，本次两个测试实例均已退出。
- README、交互引导及既有逐字效果截图仍准确，不做无关改动；未提交、打包或替换安装版。真实 QQ/网易云客户端本轮未操作，用户明确自行验收，不将合成场景当作客户端版本兼容性结论。
