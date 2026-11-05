# 音乐展示组件 Implementation Plan

Status: Completed

## Goal

将「点歌 → 直播歌词」完整迁至「组件 → 音乐展示 → 直播歌词」，同组新增「正在播放」，展示当前内置或外部音乐源的旋转唱片、歌名和歌手。两个组件共用当前音乐来源，独立选择外观、发布浏览器源、在画布中摆放与显隐。默认黑胶横排；提供封面/黑胶/唱片机与横向/纵向布局。

## Current Behavior

`music-runtime` 已负责内置、QQ、网易云、全民 K 歌的来源仲裁，并持续保存各来源的曲目状态。外部无歌词时，候选真实播放状态与歌词渲染状态不同，唱片必须使用候选真实播放状态。现有歌词页包含来源选择、样式设置、完整时间轴预览与 `/lyrics` 地址。画布组件使用公共类型定义、受限显示投影和本机外观存储；全屏播放器已有唱片与唱臂视觉。

工作区存在其他任务的大量未提交修改。所有实施采用局部补丁，保留原有编辑及暂存状态，不提交、不切分支、不操作用户运行中的客户端。

## Ownership And Interfaces

- 音乐数据：`src/server/music-runtime.js`、相关采集器与内置歌词发布端拥有歌曲状态；新增只读 `nowPlaying` 快照与 `now-playing` 消息。形状为 `{ source, trackTitle, artists, coverUrl, playing }`，只在这些字段变化时发布。
- 来源仲裁仍由现有 `lyric-source-selection.js` 拥有；新增展示不创建采集器、不重新选择来源、不重复搜索封面。封面只来自已有可信曲目结果，缺失时使用默认唱片。换曲清除旧封面，异步旧结果不得覆盖新歌。
- 展示：`public/js/shared/now-playing-renderer.js` 导出 `createNowPlayingRenderer(root)`，返回 `updateConfig(config)`、`updateState(state)`、`dispose()`，管理预览和浏览器源共用。文字使用 DOM 文本输出，旋转与暂停独立于歌词是否可用。
- 场景类型为 `now-playing`；共享字段定义放在 `public/js/shared/now-playing-appearance.js`，由 `scene-extra-components.js` 引用。新页面 `/now-playing` 复用现有 overlay 身份、白名单投影和场景子页协议。
- 客户端：`app.js`、组件导航与页面组合拥有「音乐展示」分组；保留 `desktopLyricPage` 身份并兼容旧入口。新设置页为 `nowPlayingPage`，按现有本机公共外观机制保存并传播至对应场景。
- 样式与布局由各组件拥有；场景位置、尺寸、层级和显隐由现有场景拥有。现有歌词 URL、设置键与权限保持兼容。

## Work And Parallel Ownership

- [x] 数据子代理：当前曲目状态、内外部元数据、快照/WS、页面权限与场景显示投影；验证无歌词播放、来源切换、暂停与旧异步结果。
- [x] 界面子代理：歌词整页迁移、分组导航、新设置页、预览/保存/浏览器源/画布入口；验证旧入口与单次初始化。
- [x] 渲染子代理：共享渲染器、样式字段、透明网页源、画布分类/预览/参数；验证内容显隐、暂停保留角度及缺失封面。
- [x] 主代理：本机外观持久化与跨入口一致性、接口整合、文档/指南同步、隔离 Electron 与浏览器源验收、最终差异审查。

## Security And Compatibility

新页面只接收歌曲展示字段与自己的外观配置，不接收完整播放队列、账户、令牌、原始采集诊断或本地路径。图片地址经既有允许来源规则规范化；不接受任意文件读取或代理。新增外观写入复用受保护的管理/本机接口与服务端校验；不放宽 Host、Origin、Electron 或 overlay 边界。无需数据库 schema 迁移、新服务、依赖或构建步骤。

## Verification

- 使用 `npm test -- --file=<owning-test>` 运行直接影响的音乐状态、来源交接、外部采集、overlay 权限/投影、场景公共外观、管理导航与新组件用例；各子代理记录实际文件与结果。
- 使用隔离 Electron 夹具检验「组件 → 音乐展示」导航、整页歌词操作保留、当前曲目预览、外观保存与重新读取、画布中的两个独立图层。测试数据置于仓库 `tmp/`。
- 用真实浏览器源页面验证播放旋转、暂停保持角度、切歌更新、无歌词仍展示、封面缺失、组件内容与整块显隐。无外部真实账户/音乐客户端依赖的确定性夹具覆盖数据链路。
- `npm run check`、`npm run verify:architecture`、`npm run verify:docs`；新页面/实时字段涉及的访问边界与契约运行各自拥有者测试。失败先定位并定向复验，不盲目重复全套。
- 最后审查任务差异、`git diff --check` 和 `git status --short`，确认未引入运行数据或敏感内容。

## Documentation

更新拥有者：`docs/reference/backend/music/services.md`、`docs/reference/backend/ws.md`、`docs/reference/frontend/app.md`、`pages.md`、`overlays.md`；按实际新增持久化更新 storage/scene 对应契约。同步 `docs/guides/component-sources.md`、相关应用内使用文档和交互引导，核对旧「点歌 → 直播歌词」入口及截图。

## Failure Handling

只读数据不可用时显示等待/默认唱片，不误报真实播放或沿用错误曲目。设置保存失败保留草稿并显示现有错误状态。任何回退均只撤回本任务补丁，不覆盖用户与其他任务修改。测试实例由创建者关闭并使用独立数据目录。

## Done When

- 两个子目录确实出现在「音乐展示」组，原歌词整页迁移且旧入口可达。
- 当前内外部来源的歌名/歌手与歌词一致；无歌词也能工作，暂停停转、切歌正确。
- 黑胶横排默认及其他布局可实际选择，显示项/外观可保存并在重读后保留。
- 预览、独立浏览器源、场景内独立摆放/显隐完整工作，保护边界保持。
- 相应测试、技术文档、使用指南已同步，隔离运行与最终差异检查有实际证据。

## Evidence

- 2026-11-04：数据工作线 154 项聚焦检查通过（音乐/来源/恢复 48，状态/投影/场景 87，HTTP 权限/路由/恢复 19）；界面导航与歌词回归 29 项，原生画布按钮与配置传递回归 24 项，实时预览订阅/画布控制器 26 项通过。分组包含重叠检查，不汇总为去重总数。
- `npm test -- --file=test/scenes/shared-appearance.test.js`：10/10，包含管理与画布共用外观、样式身份保留、非法整批写入拒绝。
- `npm test -- --file=test/settings/settings-contract.test.js --file=test/admin/interactive-tour.test.js --file=test/admin/frontend-usage-guide-search-browser.test.js`：24/24。新增唱片浏览器行为 2/2，既有场景参数用例 18/18。
- 隔离 Electron 使用真实 admin HTML、preload、管理请求鉴权和本地运行时，临时数据仅在 `tmp/music-display-qa/`。验证分组收放、歌词唯一实例/原标签移除、来源跳转、内置与合成 QQ 当前歌名、无歌词真播放、三种样式与布局、保存重读。退出并重建运行时后旋转周期 31 秒仍保留；非法 HTTP 配置返回 400，原保存内容不变。
- 独立 `/now-playing` HTTP 200；歌曲信息、暂停角度保持、暂停隐藏保存后立即生效与恢复通过。实际剪贴板得到该浏览器源地址。画布入口发现错误通道后修复为现有独立图层流程，歌词与唱片分别保存坐标并发布；输出收到同一曲目，隐藏唱片保留歌词，再恢复两个图层。新实时预览订阅已在重开画布后验证使用当前歌曲。
- 客户端截图 `tmp/music-display-qa/now-playing-settings.png`、`lyrics-settings.png`，画布及输出 `canvas.png`、`scene-output.png`；使用指南的歌词截图已更新，新增正在播放截图与说明。图中均为合成测试数据。
- `npm run check`：1,707 个 JavaScript 文件通过。`npm run verify:docs` 首次 10/10；归档后的复核 9/10，API/链接检查通过，唯一失败是并行新增的 `2026-11-04-comic-danmaku.md` 尚缺 Status 行，本计划已正确归档。`npm run verify:architecture`：27/28；唯一失败是工作区原有 `public/js/admin/client-settings.js:47` 的空 catch 债务，本任务未修改这两项其他工作；相应边界检查通过，不为此扩大修改范围。
- UI 检测仅提示唱片的同心纹路使用重复渐变；它是本需求的黑胶纹理，保留。测试实例已关闭；无安装包构建、发布或真实音乐账户/OBS/直播姬实播，外部来源通过确定性采集样本验证。封面不可得时按设计使用默认唱片。
- 临时数据与 Electron 配置目录的递归清理被自动审批以策略阻止为由拒绝；未尝试其他删除方式。相关合成数据保留在被 Git 忽略的 `tmp/music-display-qa/`，测试进程已通过原持有句柄关闭。
