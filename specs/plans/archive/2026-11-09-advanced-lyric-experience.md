# 高级歌词演唱表现与组合体验

Status: Completed — 2026-11-09

用户要求参考 folia-major 全面提升高级歌词，并增加可组合的视觉可能性。

## 目标与边界

让歌词焦点随演唱保持、转移，提供真正不同的完整编排，降低比较和组合效果的操作成本。借鉴 Folia 的当前词状态、持续长音和镜头构图原则，使用 LIRA 原有 Vanilla JS/CSS/WAAPI 独立实现。

保留当前句专用、透明输出、同一播放时钟、无额外请求或帧循环的边界。普通 LRC 不推断真实长音或音频重音；不移植第三方源码、播放器/账号/AI 服务、全屏背景或新依赖。不提交、不打包，不触碰现有其他任务改动。

## 当前证据与 owner

- 已有 25 种排版、12 种材质、3 种自适应完整编排。长音动作统一在 650ms 内结束，竖排高亮也左右填充。
- `public/js/lyrics/advanced-lyric-renderer.js` 组装歌词与时间轨道，`advanced-lyric-motion.js` 拥有逐字轨道，`advanced-lyric-layouts.js` / `advanced-lyric-choreography.js` 拥有分句与空间编排。
- `public/js/shared/advanced-lyric-catalog.js` 是可选效果目录；`public/js/admin/advanced-lyric-editor.js` 提供本地设置和画布共用编辑器。沿用现有字段，仅扩充受校验的目录值。
- `public/js/admin/desktop-lyric-preview.js` 拥有本地试播，当前必须顺序等待 31 秒样例；现有 fixture 可验证不发布到真实播放。
- 契约 owner：`docs/reference/frontend/overlays.md`；操作指导：`public/pages/admin/toolbox/usage-guide-configuration.html`。
- 测试 owner：`test/lyrics/advanced-lyric-renderer.test.js`、`advanced-lyric-browser.test.js`、`desktop-lyric-settings.test.js`。运行时复用 `component-preview-server` 与隔离 Electron `danmaku-canvas-editor.cjs`，不使用真实数据。

## 实施与验证

- [x] 演唱焦点：可靠长音持续到源结束后归位；新增长音舒展和柔边填色；竖排沿文字方向填色。验证轨道的长音保持、尾音释放、暂停/seek、减少动态效果与隐藏清理。
- [x] 完整编排：聚焦镜头让当前词组保持中央，历史词组退到两侧；纵向翻页让新词组从下方进入、已唱词组收成上方诗行。复用原分句和一组一轨，测量包含所有关键姿态，支持估算词组与减少动态效果。旧编排只微调远近透明度层次。
- [x] 组合入口：补充配套整套搭配和独立三色配色，内置造型搭配保留已有舞台位置/尺寸，命名自存搭配保持原完整恢复语义。说明卡片与运动实际一致。
- [x] 比较操作：短句/长句/快句/英文/单字长音直达，保留暂停状态、隐藏暂停和回到实时歌曲的语义。扩展既有样例行为用例。
- [x] 同步契约和指南，完成视觉检查、聚焦测试与最终 diff 审查。

命令：

```text
node --experimental-vm-modules --test test/lyrics/advanced-lyric-renderer.test.js test/lyrics/desktop-lyric-settings.test.js test/lyrics/desktop-lyric-renderer.test.js
node --experimental-vm-modules --test test/lyrics/advanced-lyric-renderer.test.js test/lyrics/desktop-lyric-settings-runtime.test.js test/lyrics/desktop-lyric-publication.test.js test/scenes/shared-appearance.test.js
node --test test/lyrics/advanced-lyric-browser.test.js
npm run verify:docs
git diff --check
git status --short
```

按目录扩展的实际校验路径补跑直接相关投影/保存测试；不自动升级到全仓测试。UI 检查覆盖正常与窄舞台、中文/英文/长句、快句和长音、实际中间运动状态、退出尾字保留；桌面入口验证配色/整套搭配及片段选取。合成歌词截图留存到 `tmp/advanced-lyric-experience/`。

## 兼容与失败处理

无设置键、HTTP/WS/IPC、持久化格式或 Electron 生命周期变更。旧目录值和命名搭配继续可读。保存与发布沿用已有 owner。若新增编排出现重叠，修正该编排姿态与尺寸预算；不可删字、提前退场或削弱有效断言。回退只逐块撤回任务改动，不覆盖其他未提交内容。

## 完成条件

新增组合可通过现有编辑器选用并在同一渲染器播放；长音和填色正确跟随源时间；试播不改变真实输出；相关测试、文档门禁、范围 diff 检查通过；具体运行环境及未覆盖的外部实播限制如实记录。

## 结果

新增聚焦镜头、纵向翻页两种完整编排，总计 27 种排版、五种完整编排；新增三套整套搭配、六套独立配色、长音舒展、柔边填色和五类选段试播。内置搭配保留舞台位置与尺寸，自存搭配仍完整恢复原设置。

相关测试去重后 84 项通过（两组 Node 检查分别 36、44 项，其中 9 项重复；浏览器 13 项），七个生产 JS 语法检查通过。隔离 Electron 验证了预设切换保留 X45、配色与布局独立、API 读回保存结果，以及自存搭配恢复 X50；页面没有脚本错误或横向溢出。正常舞台及 520×240 窄舞台长句已查看。

实测修复两处问题：纵向翻页的旧词行曾相互重叠，已调整位置与尺寸预算并通过遮挡检查；暂停切段曾停在首字显现前，现停在片段开始后最多 350ms 的可读位置。两项修复均保留对应浏览器行为覆盖。独立子代理复核未发现待修问题。

技术契约与使用指南已同步。文档门禁初轮 9/10，失败首先指向本计划的中文状态格式，现使用标准状态并归档；复跑仍为 9/10，唯一失败改为其他任务的 `2026-11-09-client-functional-bugfixes.md` 缺少有效活动状态，保留其原文，不将该门禁报告为全绿。文档链接、接口、规格及路由检查均通过。无设置键、持久化格式、HTTP/WS/IPC 或依赖变更。测试实例已关闭；未进行真实 OBS／哔哩哔哩直播姬宿主验收，未提交、打包或发布。

参考 Folia 的 [GlowWord](https://github.com/chthollyphile/folia-major/blob/main/src/components/visualizer/GlowWord.tsx) 和 [sonnetCameraTracking](https://github.com/chthollyphile/folia-major/blob/main/src/components/visualizer/sonnet/sonnetCameraTracking.ts) 中的演唱状态、持续长音和时间轴焦点原则；纵向翻页为 LIRA 自有设计。没有复制第三方源码或宣称移植 Folia 的全部功能。

清理时已正常关闭本轮 Electron、浏览器上下文与本地预览服务。自动审批拒绝删除两个自有合成数据目录，返回 `blocked by policy`；`tmp/advanced-lyric-experience/electron-fj2o1R/` 与 `electron-OLXXpn/` 保留，未尝试其他删除途径。效果截图保留在同一任务目录。
