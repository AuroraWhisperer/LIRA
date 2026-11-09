# Current-line Kinetic Lyrics Implementation Plan

Status: Complete

## Goal

把高级桌面歌词做成当前句内的动态排版：词组按演唱时间进入，已经出现的词组让位、缩放并组成完整画面。用户可直接选择完整编排，再调整节奏、动作幅度和外观；不要求逐首手工打关键帧。

## Current Behavior And Reference

现有 22 个静态版式、12 套搭配组合通用入场、停留和退场。隔离渲染发现“四角构图”将“把此刻唱成一首歌”分成“把此 / 刻唱 / 成一 / 首歌”；各组没有协调的句内运动。普通 LRC 的估算时间覆盖整句，因此无尾音空隙时退场不能执行；准确尾字不能为退场而提前消失。

研究对照：[PV Tool](https://github.com/DanteAlighieri13210914/pv-tool) 的整套模板与速度/幅度参数；[Folia](https://folia-site.cielaniska.top/guide/lyrics-animation-tuning) 的分组、构图、镜头和场景关系；[BAS](https://bilibili.github.io/bas/) 的对象时间轴；[After Effects](https://helpx.adobe.com/after-effects/desktop/animating-text/text-animation/animating-text.html) 的文字选择器和预设。仅借鉴交互和编排原则，不复制代码。效果质量以实播、可读性和控制有效性评价，不用数量或测试通过宣称超过所有产品。

## Ownership

- `public/js/lyrics/advanced-lyric-layouts.js`：文字单位、词边界和构图。
- `public/js/lyrics/advanced-lyric-choreography.js`：新增纯编排时间轴；由已有 renderer 调用，不新增播放器或时钟。
- `public/js/lyrics/advanced-lyric-renderer.js`、`advanced-lyric-motion.js` 和 `public/css/lyrics/advanced-lyric.css`：实际输出、尺寸适配和 WAAPI 生命周期。
- `public/js/shared/advanced-lyric-{catalog,appearance}.js`、`src/storage/settings-defaults.js`：本地外观字段和默认值；复用现有 Layout/MotionDuration/MotionAmount，不增加设置键。
- `public/js/admin/advanced-lyric-editor.js`、`public/css/admin/desktop-lyric/advanced.css`：完整编排入口和适用控制项。预览与输出继续共用 renderer。
- 测试：`test/lyrics/advanced-lyric-{renderer,browser}.test.js`、已有 settings/scenes 契约；桌面保存通过隔离 Electron 夹具确认。
- 文档：`docs/reference/frontend/overlays.md`、`docs/reference/backend/storage.md`、`public/pages/admin/toolbox/usage-guide-configuration.html`。检查 tour 入口是否受影响。

## Compatibility And Non-goals

保留现有布局 ID、保存搭配、基础/高级双层开关、逐字时间和隐藏未唱字行为。只显示当前句；宿主独占歌词订阅和播放时钟，禁止逐帧测量、额外网络/音频分析。无框架、依赖、HTTP/WS/IPC、安全或数据结构迁移。旧的明确保存布局不强制替换；新增默认编排用于缺省值和重置。无手工 PV 编辑器、远程渲染或真实用户数据操作。不提交、不发布、不覆盖其他并行任务修改。

## Proposed Changes And Milestones

1. [x] 词边界分组：用 Intl 词边界、标点和已有时间间隙选择完整词组；不足时减少分组。保留所有字符、时间和英文单词；装饰逐字构图仍能按字排。
   - 验证：现有文字/布局测试及中文词边界回归；不固定装饰坐标。
2. [x] 三种完整编排：逐段让位、两翼接力、重音落版。每组一条统一空间轨道，按宿主时间推进，前组为新组让位，末段形成整句构图；快速句自动压缩动作，慢句稳定停留。减少动态效果时保持可读静态构图。真实尾音不提前退场，只有实际空隙才退场。
   - 验证：暂停、回退、跳转、倍速、隐藏/恢复、末字保留；实际短句、长句、中英混排、慢句/快句和普通 LRC 播放。
3. [x] 模板优先编辑：新增编排卡片和整套搭配，说明随选中编排变化；通用进出场/停留库仅用于自由构图，避免提供无效参数。保留字效和轮换。默认采用逐段让位。预览现有 renderer 已有本地样例状态接口，但管理页缺少触发入口；在 `desktop-lyric-preview.js` 与其 HTML/CSS 增加短句/长句/快句连续试播、暂停及当前歌曲恢复，沿用宿主帧循环并在隐藏时暂停唯一结束定时器。
   - 验证：独立 Electron 管理页面选择、参数保存/重开，正式 renderer 输出同样设置；现有保存/场景契约验证新 ID。
4. [x] 同步文档和验收：记录截图/实播与性能证据，修复观察到的内容丢失、重叠和生命周期问题。更新用户说明和 owning reference，检查任务差异。

## Verification

- `node --experimental-vm-modules --test test/lyrics/advanced-lyric-renderer.test.js test/lyrics/advanced-lyric-browser.test.js test/lyrics/desktop-lyric-renderer.test.js test/lyrics/desktop-lyric-settings-runtime.test.js`
- `node --test test/settings/settings-contract.test.js test/scenes/shared-appearance.test.js`
- 对修改 ESM 执行 `node --check`；`npm run verify:docs`；如新增模块归属触及门禁，运行已有架构验证。
- 使用现有 component preview server 与 Electron 夹具，先核对精确路由状态，再检查 UI 和实播；所有临时文件和数据在 `tmp/`，关闭自建进程。
- 记录文字可读性、同步/恢复、参数实际影响，以及典型句子的动画/DOM 数量和是否出现逐帧布局；不以合成数据替代真实歌曲听感结论。
- 最后检查任务 diff、`git diff --check` 和 `git status --short`；共享文档只修改本任务段落。

## Rollback Or Failure Handling

保留旧布局和自由组合，新增编排发生问题时可选旧布局。修改前后对照任务文件；只逆转本任务的具体补丁，不做 reset、批量 checkout 或删除。发现无法确认的真实播放差异时记录具体限制并继续可独立验证部分。

## Done When

三套模板在当前句中表现出协调的动态构图；分组不再无意义切词；暂停/跳转/尾音和原设置兼容；参数能真实改变效果；桌面保存与本地输出一致；直接测试和文档检查通过，实际渲染及范围差异已审查。完成本轮实现并留下明确可复测的质量基线，不用无限期自动化替代本次交付。

## Execution Evidence

- 词组回归、三套编排的逐字显隐、确定性跳转、参数生效、长句适配与稳态零测量通过。
- 初次直接 Node 命令中 settings-runtime 3 项因 fallback 打包器不支持 namespace import 报 `sharedUtils is not defined`；按仓库 ESM 测试方式使用 `--experimental-vm-modules` 后 3/3 通过，无生产修补。
- 与画布任务并行时保留 `createAdvancedLyricEditor` 的 `idPrefix` / `savedPresets` 选项，只叠加本任务编排编辑行为。
- 六个直接相关测试文件共 78 项通过；随后把既有尾字用例收紧为 20ms 短尾音，浏览器 9/9 再次通过。8 个修改 JS 模块语法检查通过。
- 隔离 Electron：三套搭配逐一保存通过；两翼接力重开仍选中；交接时长 900ms / 幅度 1.4 自动保存；完整编排隐藏自由动作控件，切回自由构图恢复。试播按短句、长句、快句推进，暂停/恢复与结束重播正常，长句无可见字符越界；结束后运行中动画为 0。10 分钟夹具授权过期导致一次末段保存失败，使用新的正常授权夹具重做三套保存全部通过，不修改保护机制。
- 正式 `/lyrics?layer=advanced` 返回 200，通过现有 WS 收到已保存 `corner-relay` 和 `#b8e4d8`，使用合成歌词驱动同一正式 renderer，完整当前句输出正确。无真实账号、播放器或用户应用操作。
- 960×540 Chromium 实际播放约 2.6 秒：LayoutCount 增量 1，LayoutDuration 约 0.08ms，ScriptDuration 约 11ms；稳态 80 帧回归验证零尺寸读取/无字形重建。该短窗口不代表真实直播 FPS 或 GPU 性能。
- 证据保留于 `tmp/kinetic-lyrics-DI6HAK/`：`desktop-advanced.png`、`saved-output.png`、`choreography-sequence.png`。测试进程关闭；浏览器源及桌面均使用隔离数据。
- 文档门禁 10/10 通过。架构检查 29/30：并行画布任务在 `src/storage/settings-defaults.js` 新增对 `public/js/shared/scene-shared-appearance.js` 的依赖，触发 storage 边界失败；本任务在该文件只将布局默认值改为 `phrase-flow`，未改动该依赖。新前端模块无未声明引用或循环依赖。
- 设计检测仅提示原有渐变材质缩略图的 gradient-text；保留这项用户可选文字材质，新编排默认纯色。技术参考和使用指南已更新；README 与交互导览未包含具体歌词编排步骤，入口未变，无需修改。
- 最终全工作区差异检查发现并行任务的 `test/songs/random-song-filter.test.js` 多余末尾空行；本任务文件单独检查无空白错误。清理隔离测试数据的 PowerShell 命令被执行策略拒绝，未给出具体原因，未换方式重试；进程已关闭，两个合成数据目录保留在 `tmp/`。

## Quality Baseline And Limits

| 对照方向 | 本轮可复测结果 |
| --- | --- |
| PV Tool 的整套模板 | 三套完整时间编排，词组之间有让位关系，保留一键选择与原自由组合 |
| Folia 的分组与场景关系 | 自动词边界与时序分组，三阶段构图；长句自动适配，主次字号明确 |
| BAS 的对象时间轴 | 每组独立空间轨道，共享宿主时钟，暂停/跳转/倍速/隐藏可恢复 |
| AE 的逐歌手工演出 | 未替代逐歌艺术指导和手工关键帧；不据自动样例宣称全面超过专业制作 |

后续修改应复用上述短/长/快句样例和既有同步回归，再与真实歌单的语言、停顿和情绪进行对照。分组来自词典与时间数据，不是语义理解或音频重音识别。普通 LRC 时间仍是估算；真实歌曲听感、OBS/直播姬实机和长期 GPU 负载未在本轮执行。未提交、打包或发布。
