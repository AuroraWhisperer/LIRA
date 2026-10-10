# 窗映四时动态背景

Status: Completed

日期：2026-10-10。

## 目标与边界

新增一套横屏窗边插画背景，同一构图提供晴天、黄昏、雨天、夜晚；手动选择或按用户确认的可调间隔轮播。使用分层素材叠加缓慢投光、虹彩、台灯和窗外雨丝，不包含近景百合。参考为用户提供的 BV1nEHQ6iEkB 及两张截图；用户确认暂无原素材、按参考图重建，效果不声明逐像素或逐帧相同。室内、花束及窗帘保留在固定底图，避免不完整遮挡重建造成双影，运动仅作用于光影和雨丝。

沿用现有受信资源样式与场景发布机制，不引入任意包脚本、天气服务、新框架或运行时依赖。不改用户运行中的实例、账户、现有画布或六个预先修改的使用指南文件。

## 当前实现与归属

- `public/js/overlays/background.js` 组合通用外观与月色背景；新 `background-windowlight.js` 负责四场景分层渲染、轮播和清理，独立 CSS 负责动画。
- `public/js/shared/scene-extra-components.js` 是字段与校验元数据 owner；`public/js/admin/scene-extra-preview.js` 自动生成字段面板。后台复用元数据。
- `public/js/shared/component-resource-style.js` 是受信 preset 及资源白名单 owner。沿用 schemaVersion 2 ZIP 和 `scripts/component-style-zip.js`。素材外置分发，安装包不内嵌。
- 技术合同为 `docs/reference/frontend/overlays.md`；用户/作者说明为 `docs/guides/background-style-packages.md`。核查现有引导入口，避免重复指引。

## 契约与兼容

`style: 'windowlight'`，资源预设 `windowlight-background`。新增 `sceneMode: 'manual'|'auto'`（默认 manual）、`windowScene: 'sunny'|'sunset'|'rainy'|'night'`（默认 sunny）、`sceneIntervalSeconds`（10–3600 整数，默认 300）。自动模式按晴天→黄昏→雨天→夜晚轮播，所选场景为起点。仅该样式展示专用控件，间隔仅自动模式展示。背景通用滤镜和恢复默认快照维持现有职责。

资产保持相同坐标与比例，逐层组合；切换时淡入淡出。页面隐藏暂停运动与轮播，恢复后继续；减少动态效果偏好保留静态画面。重复配置不增加计时器，不在调色时重置场景。保留旧月色静态/动态与媒体背景行为，不更改 HTTP/IPC/auth 或数据库结构。

## 实施与验证

- [x] 生成并检查窗边原画，制作四种场景底图及独立投光、虹彩、雨窗遮罩、灯光素材与来源记录。检查四场景坐标一致、无前景百合。
- [x] 子代理实现共享字段及面板显隐，验证字段、规范化和面板交互。
- [x] 主代理实现 `createWindowlightBackground(root)`，提供 `update(config, { visible, reducedMotion })` 与 `dispose()`，接入现有背景入口。验证手动四场景、定时顺序、设置更新、隐藏/销毁、滤镜与旧背景兼容。
- [x] 制作资源 ZIP 与可复现打包脚本；复用真实包导入校验，检查预设资源映射、无任意代码执行。
- [x] 使用既有隔离 Electron fixture 验证导入、选择、参数、保存、重开与正式输出；`tmp/` 保存 QA 截图，不触碰真实用户数据。使用 `playwright-interactive` 处理需要持续控制的隔离 QA。
- [x] 同步相关合同与使用说明，通过文档、静态、架构与差异检查，审阅任务 diff 与工作区状态。

## 验证与交付记录

以下为 2026-10-10 的执行证据，保留分层方案取舍、参数保存归属及隔离验收范围：

- `node --experimental-vm-modules --test test/overlays/background-moonlit.test.js test/scenes/scene-extra-components.test.js test/admin/scene-component-definitions.test.js`：20 项通过。
- `node --test test/overlays/background-windowlight.test.js test/overlays/background-filters.test.js`：11 项通过，包括淡入过程中改变轮播间隔仍保留不透明底图的浏览器回归；该问题先复现为旧底图不透明度 0.5，再修复为保持 1。
- `node --experimental-vm-modules --test test/scenes/component-styles.test.js test/admin/canvas-empty-previews.test.js`：28 项通过，覆盖真实 ZIP 检查/导入、共享资源、删除卡片后的引用保留、重新导入及专用控件显隐。
- `npm run check` 通过；`npm run verify:architecture` 26 项通过；`npm run verify:docs` 10 项通过；`git diff --check` 通过。
- 实际 Electron 使用 `test/fixtures/danmaku-canvas-editor.cjs`，独立临时数据目录、内存数据库与随机本地端口。验证授权桌面导入四卡、四种手动场景、自动夜晚起始/10 秒间隔、保存及重开参数恢复。资源样式参数按现有合同保存在样式库，原始场景草稿中的作者配置不是当前参数 owner。
- 正式 `/scene` 输出返回 HTTP 200；在 1920×1080 设计画布验证夜晚自动切为晴天及四种手动输出，页面错误为空。实际输出截图位于 `tmp/windowlight-qa/output-*.png`，四宫格为 `output/windowlight-preview.jpg`。隔离实例及本次创建的参考浏览器标签页已关闭；删除临时用户数据的操作被自动审批以“blocked by policy”拒绝，`tmp/windowlight-qa/electron-X3apmW` 暂留，未换用其他方式绕过。
- `output/窗映四时-背景样式-1.0.0.zip` 为 1,066,943 字节；SHA-256 为 `f97f5858141404a5894d0b58f51f8442d28a7054d8e539066339bea5174d39c1`。四张卡片共享八张 WebP，需支持该预设的客户端代码。
- LiraHub 生成原画保存在 `output/windowlight-source/windowlight-master.png`，精确提示词、模型、裁切、哈希和离线加工脚本见 `public/img/overlays/backgrounds/windowlight/provenance.json`。素材使用统一 1536×864 裁切；房间与窗帘固定，光影和雨丝独立运动。
- 技术参考、背景样式指南和外置资源打包说明已同步。现有应用内使用指南与引导不枚举具体背景样式，入口未变化，故无需更新；保留六个预先存在的用户修改。

未测试 OBS 或哔哩哔哩直播姬的真实直播/长时间性能，也未制作或发布新版客户端安装器。本次为用户确认的参考重建，不代表原视频素材或逐帧一致的复刻；这些范围限制不冒充已经完成的实播验收。

## 完成与失败处理

完成以可导入 ZIP、四场景真实渲染、自动/手动参数保存及有据的视觉/行为检查为准。记录实际通过的测试与未覆盖的实播限制。若素材或生成不可用，保留已完成代码和来源说明并明确阻塞；回退仅撤销本任务拥有的具体改动，不重置其他工作。
