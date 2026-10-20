# 内置播放器输出与电音助手使用说明

**Status:** Completed

日期：2026-10-19。

## 目标与范围

在「百宝箱 → 设置」新增独立的内置播放器输出设置，让用户把 LIRA、QQ 音乐、网易云音乐的播放器输出与电音助手「原声通道」对齐，并明确选择不同的「最终输出」。更新电音助手帮助及现有使用文档，纳入用户提供的两张截图，沿用现有样式和自然中文。

不改外部播放器设置，不修改系统默认音频设备，不调整声卡驱动、不放宽原生隔离检查、不发布安装包。用户允许新增必要说明；其他现有内容的调整须先提出具体方案并取得确认。保留开始任务前已有的原生诊断、恢复提示及文档修改。

## 当前行为与职责

- `public/pages/admin/main-end.html` 的 `#music-player` 是内置播放的唯一媒体元素，全屏模式沿用该元素。
- `public/js/playback/core/initializer.js`、`controller.js` 与 `features/playback-controls.js` 拥有播放初始化和控制；目前没有输出设备选择。
- `public/pages/admin/toolbox/settings.html` 已有独立设置卡片；新增设置沿用这些样式。播放器领域拥有设备枚举、实际切换及本机偏好，设置 UI 只负责展现和调用。
- `public/pages/admin/toolbox/audio-assistant.html` 的原声说明尚未明确与播放器输出相同。`audio-assistant-feedback.js` 的迁移失败建议需要与手动对齐步骤保持一致。
- `native/audio-assistant/AudioSession.cs` 已拒绝原声通道与最终输出相同；本任务核对并复用该检查，不重写路由。
- 使用文档入口为「百宝箱 → 使用文档」，相关正文在 `usage-guide-toolbox-work.html`；截图放入 `public/img/usage-guide/`，沿用 WebP，避免现有安装包排除 PNG 的规则漏图。
- 技术契约：`docs/reference/frontend/playback.md`、`docs/reference/frontend/app.md`；同步核对 `docs/guides/`、README、`interactive-tour-config.js` 的影响。

## 兼容性与实现决策

- 通过媒体元素 `setSinkId` 切换输出，只保存本机浏览器偏好，不加入主播远程设置或更改现有设置键。默认保持系统默认输出。
- 成功切换后再保存选择；加载保存设备失败或设备失联时保留可诊断的选择，不把失败报告为成功。开始播放前完成输出初始化，避免先从错误设备出声。
- 同源管理窗口通过已有浏览器存储机制同步；释放设备变化与窗口监听，避免重复初始化和过期异步结果覆盖新选择。
- 保持 context isolation、桌面授权、session partition 和现有 IPC。先用隔离 Electron 验证设备枚举与切换；若受权限阻断，先定位具体权限及可信来源范围，再决定最小变更，禁止一概放开音频权限。
- 原声通道与最终输出的不同设备约束继续由原生会话负责。播放器预先使用原声通道时，说明用户须明确选择另一个最终输出，不能依赖「自动跟随原输出」。

## 实施与验证

- [x] 播放器子任务：新增设备选择 owner、独立设置 UI、初始化接线与聚焦测试。覆盖真实媒体切换调用、保存失败、设备缺失、过期操作、跨窗口与清理；复用现有测试辅助。
- [x] 文案子任务：修改已明确授权的原声/最终输出帮助和对应故障提示，加入两张图的操作步骤、内置设置入口与通道对照。保留现有相关行为说明，分事实准确性、操作顺序和中文表达三轮校对。
- [x] 校验子任务：核对预先对齐通道的原生路径及同设备拒绝行为，执行直接受影响的播放、音频反馈、文档与页面组合测试。
- [x] 桌面验证：使用 `tmp/` 下隔离数据和测试实例，通过真实 preload/session 检查设置卡片、设备枚举/切换/恢复、原声说明及两张图片显示。设备不可用通过隔离偏好复现；同输出拒绝核对原生启动路径及前端反馈，不接管用户正在播放的音乐，不把无实播检查当作听感验收。
- [x] 执行 `npm run verify:docs`、相关语法/模块边界检查、`git diff --check`，审阅任务差异和 `git status --short`。

## 失败处理与完成条件

失败时只修正本任务拥有的文件或偏好，保留原有未提交内容；测试实例与数据位于仓库 `tmp/` 并由创建者清理。不能恢复设备时保留明确提示，不能通过默认回落隐藏错误。

完成需满足：新设置能实际控制内置播放器并记住选择；界面、帮助及使用文档说明一致；两张截图可在打包资源规则下加载；聚焦检查和桌面检查提供与结论相符的证据。无法在当前硬件上验证的外部播放器/声卡听感明确记为限制，不扩张为兼容性承诺。

## 验证记录

- 播放器相关 118 项测试通过，含 9 项新输出 owner 行为测试、播放/音质/队列/速度、页面组合和全屏空格交互。旧空格断言曾在异步输出初始化前检查播放次数，现等待实际调用后仍严格验证只播放一次；相同并发组合重跑通过。
- 音频控件、反馈和桌面桥 22 项通过。新增取消启动用例先复现「等待设备切换时关闭当前歌曲，随后仍启动」，加入操作版本及开关/释放检查后通过；同时覆盖关闭助手和释放页面。输出 owner 最后两处默认回退调整后，与控件合计 18 项再次通过。
- 指南图片、唯一锚点、链接归属和导航共 23 项通过；两图无损转换为 WebP，原尺寸分别为 579×160 和 588×226。技术参考已同步，README、独立指南和交互式引导不包含新增设备选择的旧步骤，现有说明仍准确，无需修改。
- 隔离 Electron 使用真实 preload、请求授权与正式权限处理器：授权 `/admin?desktop=1` 为 200、匿名 `/admin` 为 401。枚举并选择非默认 OMEN 输出成功，媒体 `sinkId` 与所选设备一致，保存/重载/刷新成功。缺失设备保留选择、暂停且阻止播放；重新选默认输出后恢复。新控件无重复，过程无页面异常。
- 桌面查看了独立设置卡片、原声帮助、两张截图和新指南锚点；图片均实际加载，内置输出说明跳转后标题未被目录条遮挡。截图保存在 `tmp/player-output-guide-qa/`；使用隔离数据，没有接管真实 QQ/网易云播放或改变系统默认设备。
- 一次设计扫描返回空结果；相关语法检查通过。架构门禁初次失败定位到已有 `system-metrics.js` 中两处 PowerShell 空 catch，同时修正本任务新模块的空 catch。用户随后明确同意一并修复性能查询：失败时显式赋原空值，行为不变；13 项性能测试及 27 项架构检查通过。
- 没有测试 ROUTIST 实机听感、QQ/网易云实际处理链路或 OBS/直播姬采集；这些不作为本次实现通过的证据。未构建或更新安装包。
- 文档门禁 10 项通过，差异检查通过；原有未提交修改保留。隔离 Electron 已退出。清理已验证绝对路径的两个本次运行目录被自动审批以 `blocked by policy` 拒绝，因此保留 `tmp/player-output-guide-qa/run-I8vHKj` 与 `run-uUPqtT`，没有改用其他方式删除；截图与复核夹具也保留在 `tmp/`，均未进入源码差异。

实际聚焦命令：

```powershell
node --experimental-vm-modules --test test/playback/output-device.test.js test/playback/frontend-playback.test.js test/playback/playback-quality.test.js test/playback/playback-queue-behavior.test.js test/playback/audio-assistant-speed.test.js test/admin/admin-page-composition.test.js test/admin/frontend-admin-layout.test.js test/admin/shared-ui-interactions.test.js
node --experimental-vm-modules --test test/admin/audio-assistant-controls.test.js test/admin/audio-assistant-feedback.test.js test/desktop/audio-assistant.test.js
node --experimental-vm-modules --test test/playback/output-device.test.js test/admin/audio-assistant-controls.test.js
node --test test/server/system-metrics.test.js
npm run verify:architecture
npm run verify:docs
git diff --check
```
