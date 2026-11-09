# 客户端与画布参数补齐

Status: Complete

## Goal

补齐礼物掉落、礼物摇摇乐与高级歌词的画布编辑；统一心动盲盒奖励显隐和实时榜单展示方式的两端设置。榜单默认从第 1 名开始，可切换为跟随本房间名次，两端人数自动适配高度。客户端、画布重开和正式输出读取同一 owner，编辑不覆盖其他字段。

## Non-goals

不变更礼物结算、真实数量、账号/预览授权、场景 URL、几何、图层样式选择与发布机制；不修改其他正在进行的测试和榜单改动，不提交或发布。

## Current Behavior

- 全屏礼物的两个内置样式各有五项外观/动效参数，只有客户端有控件；画布共享读写没有接入。真实事件已携带保存的 motion。
- 高级歌词画布只显示部分字段；完整编辑器、轮换和搭配已经由客户端拥有。
- 心动盲盒奖励开关仅改客户端预览/URL；画布另存图层值。
- 榜单范围与附近名次仅改客户端查看；画布另存图层值。当前工作区另有按单榜添加图层的修改，须保留。
- 上轮现有聚焦测试 26 项通过，不能证明缺失的编辑能力已实现。

## Ownership And Compatibility

- `public/js/shared/gift-motion-settings.js` 定义礼物字段；既有 `giftDrop*`/`giftSwing*` settings 及结算模块拥有值。画布不复制到场景文档。
- `public/js/admin/advanced-lyric-editor.js` 继续拥有完整高级编辑 UI；native `advancedLyric*` 仍由 settings 保存，资源样式继续由样式库保存。
- 心动盲盒 `showRewards`、榜单 `range` 通过本地 settings 的有界字段映射共享。旧图层 `nearby/pageSize` 字段保留兼容，两端显示人数使用既有实际高度计算；统一后共享设置优先，图层的身份、外观和几何不变。
- `src/server/scene-shared-appearance.js` 与 `canvas-shared-appearance.js` 继续承担受限画布共享参数读写，不扩大 capability 权限。
- `component-config-controller.js`、`component-settings-sync.js`、`component-settings-save.js` 复用补丁、确认与并发草稿处理。新增设置只在本机保存，不加入云端字段。
- 独立心动盲盒 URL 保留显式 `showRewards` 覆盖；未指定时跟随共享设置。已有明确 URL 不改变含义。

## Milestones

- [x] 礼物：复用字段定义生成画布控件（含既有启用/金额），按样式范围读写既有设置；客户端与画布互改、草稿预览、结算与输出一致，禁止跨样式/未知字段写入。
- [x] 高级歌词：复用完整编辑器，命名空间隔离控件与标签；所有视觉字段、轮换、原生搭配可保存和回填，资源样式沿用库 owner。
- [x] 心动盲盒/榜单：新增有界设置映射、两端回填和按字段保存，榜单暂停查看继续只影响本页订阅；独立来源与场景输出一致。
- [x] 在现有 owning suites 增补具体行为缺口，使用隔离 Electron/画布与合成数据库验证双向、重开、发布后的输出，验证失败保留草稿/重试及不同字段并发。
- [x] 同步 owning reference、操作指南/内置帮助，执行相关检查与最终差异审核；工作区其他任务的未通过项单独记录。

## Verification And QA Inventory

先扩展现有 `test/scenes/shared-appearance.test.js`：验证按样式受限礼物设置与事件、完整歌词字段/搭配、心动显隐与榜单范围共享；非法补丁不能部分写入，场景身份不变。再扩展现有场景/桌面验证，不新增静态 UI 清单测试。

聚焦命令按实现实际影响选用：

```powershell
node --experimental-vm-modules --test test/scenes/shared-appearance.test.js test/admin/canvas-shared-appearance.test.js test/gifts/gift-motion-effects.test.js test/settings/settings-contract.test.js
node --experimental-vm-modules --test test/gifts/gift-motion-browser.test.js test/lyrics/desktop-lyric-settings-runtime.test.js test/lyrics/advanced-lyric-browser.test.js test/scenes/live-rankings.test.js test/admin/live-rankings-client.test.js
node --experimental-vm-modules --test test/desktop/shared-canvas-appearance-electron.test.js
npm run verify:docs
npm run verify:modularity
```

UI 验证覆盖：两款礼物全部字段与独立文字勾选、完整高级歌词编辑分类/轮换、心动奖励开关、榜单展示方式与自动人数；客户端→画布、画布→客户端、重开、合成正式事件/发布来源。异常检查覆盖保存失败保留编辑和不同入口并发修改不同字段。用本任务自有隔离进程，不操作用户客户端；截图及脚本只放 `tmp/`。功能检查后按目标桌面尺寸检查控件可达、标签关联与分组，无需不相关移动端/浏览器矩阵。

## Documentation Owners

`docs/reference/frontend/app.md`、`pages.md`、`overlays.md`；新增本地设置由 `docs/reference/backend/storage.md` 说明；既有画布共享接口字段/边界变化由 `docs/reference/backend/api.md` 说明。操作入口更新 `docs/guides/component-sources.md` 与 `public/pages/admin/toolbox/usage-guide-scene-editing.html`、相关礼物/歌词帮助，按实际影响修改，保留其他任务内容。

## Failure Handling And Final Review

失败先修 owner；使用工作开始时的相关文件快照和分段差异只逆转本任务行，不重置其他变更。检查实际任务 diff、语法、`git diff --check` 与 `git status --short`；既有无关失败单独记录，不修改以获取绿色结果。合成状态与临时脚本不进入产品 diff。

## Done When

上述五项能力均能从两端操作并保存/重开回填，正式输出使用确认的同一配置；现有身份、结算、权限、显式 URL 与并发草稿契约保留；相应测试、桌面/画布证据和文档齐备，任务差异已审核。

## Execution Evidence

- 用户确认两端人数自动适配高度、展示方式双向同步；随后明确默认从第 1 名开始，可切换为以本房间（如第 15 名）为中心显示附近名次。
- `shared-appearance`、`settings-contract`、`gift-motion-effects`、`overlay-projection`、`live-rankings` 五套共 59 项通过；投影矩阵随后补齐心动 scope 并单独 13 项通过。
- 画布共享、组件定义/registry、歌词保存、礼物实际播放、榜单订阅/高度输出、资源样式、真实 Electron 双向保存/发布的十套共 36 项通过。新增桌面用例也验证了不同字段并发、失败保留草稿并重试，以及第 15 名附近和增高后的行数。
- 独立组件来源四项通过，包含新增的心动共享开关与旧 URL 显式 true/false 覆盖；设置广播不改变礼物进度。
- 存储层改回显式 defaults 后，将 `liveRankingsRange` 核对为 `all`；最终重跑共享外观、settings 与全部三项 Electron 用例，38 项通过。
- 最终隔离 Electron/Chromium 手动核对两款礼物全部字段、独立文字勾选、七分类高级编辑、两项排版轮换、命名搭配保存/恢复/重开及发布。高级预设库不进入直播投影，礼物参数不复制进图层，页面错误为 0。263px 参数栏无横向溢出，标签关联完整；截图在 `tmp/canvas-align-final-TrmeRg/`。
- 23 个修改模块/测试语法通过；`verify:architecture` 29 项与 `verify:modularity` 通过。Impeccable detector 只报告原有选择器侧边标记（`component-preview-page.css`），本次未改该处。
- 技术参考同步 API、storage、app、pages、overlays；操作指南及场景/礼物/歌词内置帮助同步。交互导览的入口与导航步骤未变，无需修改。
- 扩展歌词渲染及指南检查 18 项中 17 项通过。另一项自适应歌词工作正在修改 renderer：减少动态效果下普通 LRC 的显示结果为“一二三四”，原断言期待“一二”（`advanced-lyric-browser.test.js` 的 unsung visibility 用例）。该用例未加载本次编辑器/适配器，保留其实现与失败，不修改另一任务的预期。
- `verify:docs` 归档前后均为 9/10，失败仅为另一活动计划 `2026-11-09-adaptive-kinetic-lyrics.md` 使用未被检查器识别的状态标签；本文计划与链接有效。
- 最后核对实际差异与 `git status --short`，`git diff --check` 通过；新增模块均为任务所需，`tmp/` 合成状态与截图未进入差异，其他任务内容保留。
- 收尾时并行审计新增了同字段迟到回执回归，暴露客户端旧保存路径的竞争；当前卡片已复用既有 `component-config-controller` 与 settings 确认口。新回归和全部三项 Electron 联动最终 4/4 通过，合计直接相关 100 项（重跑不重复计数）。相应模块/测试语法通过，参考文档同步；不替换或重复实现审计方的修复。
- 所有自有验证进程已关闭；清理隔离数据目录的 PowerShell 请求被执行策略拒绝，未改用其他路径绕过，合成数据与截图保留在 `tmp/`，不进入产品差异。未操作真实用户数据、提交、打包或发布。
