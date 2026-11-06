# 全屏礼物感谢：导入样式独立触发与统一效果列表

Status: Awaiting Verification

需求来自 2026-11-06 用户指令：未导入的林间花信不应出现；每个样式独立（摇摇乐是摇摇乐的，林间花信是林间花信的），导入后与掉落、摇摇乐并列在同一列表中，不再放在「更多样式」小框里；同步修正描述旧布局的文档。

## Goal

「组件 → 礼物姬 → 全屏礼物感谢」改为一列效果卡片：礼物掉落、礼物摇摇乐、已导入的林间花信、每个已导入的图片/视频样式，最后是「＋ 添加样式」。每张事件驱动的卡片有自己的启用开关、触发金额、预览示例、「在画布中预览」与「保存设置」；导入样式另有「添加到画布」「移除」。林间花信只在导入后出现。导入的图片/视频样式不再跟随林间花信的开关。

## Non-goals

- 不改大航海感谢（已按「完整设置条目」显示），不改时钟、弹幕、点歌板等「选外观」页面的缩略图选择。
- 网页（HTML 浏览器源）样式不接收 LIRA 礼物事件，CSS 样式套用在内置组件上；二者不新增触发器，只显示说明、添加与移除。
- 不改礼物结算、账本、门槛语义（单次最终结算总额，含等于）、掉落/摇摇乐的设置键与播放。
- 不改林间花信的视频、队列（最多 50 条）和旧内置图层兼容。

## Current Behavior

- `gift.html` 静态写死林间花信卡片，`gift-frame.js` 只在未导入时显示提示；样式库瓷砖挂在面板底部「更多样式」。
- 服务端只产生一条林间花信 `gift:frame`（`giftFrameEnabled` / `giftFrameThresholdRmb`），`gift-effects-component.js` 中导入的图片/视频图层也消费这条事件，因此标着「林间花信」的开关实际控制所有导入素材。
- 文档：`component-style-packages.md` 写「导入后本页保留原来的启用开关」「点林间花信卡片添加到画布」；`app.md` 规定未导入时显示缺失提示；`component-sources.md` 只写「沿用现有触发条件」；`pages.md` 大航海感谢「更多样式」描述已过时；使用手册仍用旧标签。

## Ownership

- 触发判断：`src/bilibili/gift/frame-config.js`（礼物领域）。设置契约：`src/server/settings-contract.js`、`src/storage/settings-defaults.js`。
- 事件扇出：`src/server/runtime-transport.js`；投影白名单：`src/server/overlay-projection.js`；场景窗口：`scene-gift-events.js`（不改）。
- 启动迁移与样式 ID 读取：新 `src/server/gift-frame-style-triggers.js`，由 `src/server.js` 组合根接线。
- 播放分流：`public/js/overlays/gift-effects-component.js`。
- 页面：`public/pages/admin/toolbox/gift.html`、`public/css/admin/toolbox/gift-effects.css`、`public/js/admin/gift-frame.js`（林间花信）、新 `public/js/admin/gift-frame-styles.js`（导入样式卡片）、`gift-motion-settings.js` 与共享字段标签、`component-style-client.js`（库挂载与按钮迁移）。
- 共享读取：新 `public/js/shared/gift-frame-style-triggers.js`。
- 文档：`docs/reference/backend/{ws,storage}.md`、`docs/reference/backend/bilibili/gift.md`、`docs/reference/frontend/{app,pages,overlays}.md`、`docs/guides/{component-sources,component-style-packages}.md`、`usage-guide-guard-thanks.html`。

## Compatibility Constraints

- 新设置键 `giftFrameStyleTriggers`：JSON 对象，键为样式 UUID，值 `{ enabled: 'true'|'false', thresholdRmb }`，最多 1000 条；默认 `''`。`''` 表示尚未迁移：所有导入图片/视频样式按升级前规则跟随 `giftFrameEnabled` / `giftFrameThresholdRmb`。已迁移后缺少条目视为关闭、门槛 20 元。
- 启动迁移幂等：仅当值为 `''` 且样式库可读时，为库中（含已从可选库移除、场景仍可能引用的）全部全屏礼物感谢图片/视频样式写入升级前的开关与金额；样式库不可读则跳过，下次启动重试，期间保持旧行为。
- `giftFrameEnabled` / `giftFrameThresholdRmb` 键名、默认值和旧内置/林间花信图层播放不变，只是不再驱动导入素材。
- `gift:frame` 新增本地主题 `themeId: 'imported'` 与 `styleIds` 字段，仅发布到场景窗口（不广播到旧 `/gift-effects` WS 页面，避免误播林间花信）。投影白名单只追加 `styleIds`。
- 页面 URL、元素 ID（林间花信与掉落/摇摇乐）、样式库 API、导入/删除确认流程不变。

## Changes / Milestones

- [x] 共享读取 + 设置契约 + 启动迁移 + 事件生成与扇出 + 投影。验证：frame-config 与迁移单测、运行时发布与投影测试。
- [x] 播放分流：导入图片/视频图层只播放列出自己 ID 的事件和预览；其他图层不播 `imported` 事件。验证：组件分流测试。
- [x] 页面：统一卡片列表、林间花信导入后出现（仍开启但未导入时保留以便关闭）、导入样式卡片各自草稿与保存（串行保存整份映射）、「＋ 添加样式」放在列表末尾；统一文案。验证：现有 gift-frame 草稿测试、新增导入卡片保存测试、隔离 Electron 实际界面。
- [x] 文档与使用手册同步，补充「效果类组件导入样式整行显示」规则。验证：`npm run verify:docs`，人工对照实现。
- [x] 收尾：聚焦测试、`npm run check`（如适用）、`git diff --check`、状态核对。

## Failure Handling

样式库读取失败时页面显示读取失败提示，林间花信卡片仅在已开启时保留；服务端无法列出样式 ID 时不生成导入事件（不影响林间花信和掉落/摇摇乐）。保存失败保留草稿并提示重试。回退只撤销本任务补丁；工作区已有大量用户修改，不提交、不切分支。

## Verification Results

- 新增/扩展聚焦测试：`gift-frame-config`（独立开关与含等号门槛、未迁移时沿用旧规则、整份映射写入、非法值拒绝）、`scene-gift-events`（运行时→场景窗口投影保留 `styleIds`、旧 WS 页面收不到导入事件、图层分流、样式库不可读不影响其他效果）、新 `test/server/gift-frame-style-triggers.test.js`（启动迁移含已移除样式、只迁一次、样式库损坏时下次重试）。
- 相关回归：gift-frame 草稿、运行时发布、画布礼物组件、管理页启动、预览注册/契约、林间花信样式包、大航海感谢（含管理页）、礼物导入、掉落/摇摇乐、设置契约/启动、场景运行时、共享外观，合计 120+ 项通过。两项因本任务改变的前提调整：`canvas-gift-components` 依赖样式库未答复时不改动卡片可见性（实现处理），`gift-guard-thanks-admin` 按真实应用补上样式库列表结果后林间花信卡片才出现（未改断言）。唯一未通过的 `overtime descriptions…` 为既有夹具缺少 `showConfirmationDialog` 导出，与本任务无关。
- 桌面 E2E `woodland-style-import-electron` 1/1：真实 ZIP 经新「添加样式」导入、保存林间花信设置、添加到画布并预览。
- 隔离 Electron 实际界面（`tmp/gift-frame-redesign-mockup/`）：未导入时只显示掉落、摇摇乐与「添加样式」；导入林间花信与一张图片后顺序为掉落→摇摇乐→林间花信→图片→添加样式；图片样式默认关闭 20 元，单独开启并保存 30 元后只写入自身条目，林间花信保持关闭 20 元；控制台无错误。使用手册截图据此重拍（1440×904，82 KB）。
- `npm run verify:docs` 10/10，`npm run verify:architecture` 30/30，`git diff --check` 通过。
- `npm run check` 跑完 1751 个文件但因运行期间工作区文件被并行修改而未记录结果；本任务触及的全部 JS 逐一 `node --check` 通过。
- 约 18:09–18:12 工作区另有并行改动修改场景/预览共享路径（`overlay-projection.js`、`scene-extra-display.js`、`component-preview-*` 等，非本任务）。此后 `canvas-gift-components` 三项（含与本任务无关的心动盲盒、月底冲刺）均在等待场景输出时超时；此前同一套件 3/3 通过。需待并行改动稳定后重跑该套件。
- 隔离验证时共享截图夹具因并行会话修改 `media-request-headers.js` 签名而无法启动，仅在本任务 `tmp/` 夹具内加适配，未改共享文件。
- 未验证：真实礼物在 OBS／哔哩哔哩直播姬中驱动导入图片/视频图层的实播；未打包、提交或发布。
