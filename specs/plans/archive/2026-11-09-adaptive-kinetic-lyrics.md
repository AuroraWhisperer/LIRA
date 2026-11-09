# 当前句高级歌词的自适应编排

Status: Completed

承接上一轮三个完整编排；此轮验收不代表任意歌曲均达到逐曲制作的 PV 水平。

## 目标与当前问题

让短句、长句、快句、长音、外文及普通 LRC 自动采用合适的词组和动效。当前实现固定最多三组、默认强调句尾，且缺少逐字时间仍逐字估算，演示效果不能代表这些情况。

## 决策与范围

- 在已有 layouts/choreography/renderer 中完成，保持三个编排及既有设置键、保存、HTTP/WS、播放时钟和自由构图合同。
- 在词边界上用动态规划平衡宽度与可读时间；标点、可信时间间隙作为断点线索。最多五组，快句或短句合并。
- 完整有效时间沿用源时间；普通 LRC 和不完整时间按词组展示，估算只负责编排，不宣称逐字同步。
- 焦点是当前词组接过画面：前文缩小并适度降低存在感；长音稳定停留，快句减少位移与倾斜。仅用明显时长差作强调线索，不声称语义或音乐重音识别。
- 编排确定性、完整文字、尾音、暂停/跳转、减少动态效果与隐藏清理继续保持。仅构建/尺寸变化测量，无新帧循环、网络请求、依赖或音频模型。
- 本轮不接入音频强制对齐或逐曲编辑；这些需要独立评估音源、模型、语言和对齐误差。

## 所有者与同步

实现：`public/js/lyrics/advanced-lyric-layouts.js`、`advanced-lyric-choreography.js`、`advanced-lyric-renderer.js`；目录文案：`public/js/shared/advanced-lyric-catalog.js`。
覆盖：已有 `test/lyrics/advanced-lyric-renderer.test.js` 与 `advanced-lyric-browser.test.js`。
参考合同：`docs/reference/frontend/overlays.md`；用户指导：`public/pages/admin/toolbox/usage-guide-configuration.html`。无新增设置/入口，存储参考、README 与交互导览无需扩展。

## 实施与验证

1. 复现不同歌词条件的不足，实施自适应分组与时间精度分级 → 原有纯函数套件加针对完整文本、断词、快句与延长时间的行为覆盖。
2. 扩展完整编排至可变组数，改善主次和阅读停留 → 原有浏览器套件验证遮挡/裁切、时间显示、暂停跳转及尾字，不按固定曲线或默认值断言。
3. 用隔离预览播放中英混合、长短快慢、普通 LRC 和缺失时间例子 → 检查不同阶段的完整性、主体可读性与真实连续播放，保留 `tmp/` 证据。沿用 Playwright Interactive 技能与已有预览服务器，不操作用户播放器。

聚焦命令：`node --experimental-vm-modules --test test/lyrics/advanced-lyric-renderer.test.js test/lyrics/advanced-lyric-browser.test.js test/lyrics/desktop-lyric-renderer.test.js`；相关语法检查、`npm run verify:docs`、变更 diff 与 `git diff --check`。不重复本轮未变更的保存/Electron 权限测试。

## 完成条件与局限

上述行为和文档一致、聚焦验证通过、检查本轮差异并保留其他任务修改。验证用原创隔离歌词，不使用真实用户数据；需明确尚未得到实际歌曲音频同步、OBS/直播姬及任意曲库艺术质量证据。遇到缺陷只修复当前所有者；回退只撤销本轮修改，不批量还原文件。

## 证据

- 高级歌词纯函数及浏览器 19 项通过；共享桌面歌词 renderer 25 项通过，共 44 项。新增覆盖自然断点/快句合并、非句尾长音强调、缺失时间的整组显现和最大动作下的交接遮挡；原有暂停、跳转、尾字、隐藏清理、单时钟与零逐帧测量继续通过。
- 8 个相关 JavaScript 文件语法通过。文档门禁第一次发现本计划状态标签格式，已修正；后续检查本计划通过，整体 9/10，被并行新增 `2026-11-09-client-unused-files.md` 的状态阻断，未修改该任务文件。归档后再执行门禁并以最终报告为准。
- 9 类原创隔离输入 × 3 个编排共 27 组合，在 960×530、字号 110、宽度 100%、动作幅度 2 下检查每组开始后的 50/100/200/400/650ms 及结尾：无可见文字裁切或组间遮挡，无页面错误。覆盖短句、快句、长句、句中长音、中/英/日/阿拉伯文及不完整时间。
- 实际 `/lyrics?layer=advanced` 返回 200；使用该页面已有 renderer 单例和共享时钟，连续播放观察到前文让位，暂停在长音阶段截图，无页面错误。未启动真实用户播放器、读取用户曲库或新增音频处理。
- `tmp/adaptive-lyrics-evidence/case-matrix.json`、`long-line-sequence.png`、`sustained-phrase-output.png` 保留证据；本轮基线保存在 `tmp/adaptive-lyrics-baseline/` 以区分并行修改。测试进程在最终交付前关闭。
- 技术参考、用户指南、编辑器提示和示例播放已同步。原有设置和保存合同未变，本轮不重复上一轮 Electron 保存测试；README 与交互导览没有新增入口或流程，保持原状。

## 后续能力的边界

本轮只使用文字与已有时间，不监听音频。若需让普通 LRC 也接近逐字同步，应独立评估已知歌词与人声的强制对齐、分离伴奏及置信度回退；语言模型可辅助语义分组，但不能凭歌词生成真实演唱时间。高质量逐曲 PV 还包含人工确认的节拍、重音、段落和镜头设计，不能以本轮合成用例代替真实曲库验收。

方法参考：[Aegisub 时间编辑](https://aegisub.org/docs/latest/karaoke_timing_tutorial/)、[After Effects 文本选择器](https://helpx.adobe.com/after-effects/desktop/animating-text/text-animation/animating-text.html)、[Folia 动效调节](https://folia-site.cielaniska.top/guide/lyrics-animation-tuning)、[WhisperX 对齐及其局限](https://github.com/m-bain/whisperX)。没有引入这些项目的实现或依赖。
