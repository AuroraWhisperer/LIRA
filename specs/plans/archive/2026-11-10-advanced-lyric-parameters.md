# 高级歌词可感知外观参数

Status: Completed

本计划已完成并归档，作为参数兼容与验收证据保留。当前字段契约以存储参考、渲染参考及源字段表为准。

## Goal

让高级歌词的字体、投影、发光与材质可以独立调整，并在同一句歌词中产生清楚可见的差别；参数同时适用于桌面编辑器、画布和本地输出。

## Current Behavior And Ownership

- `public/js/shared/advanced-lyric-appearance.js` 定义字段、默认值、规范化及保存搭配，已有字体、字重、字号、字距。
- `src/storage/settings-defaults.js` 沿用现有显式设置键注册方式补齐默认值；存储 schema 不变。
- `public/js/admin/advanced-lyric-editor.js` 生成两个入口共用的控件，`lyrics/advanced-lyric-renderer.js` 与 CSS 消费参数。
- 当前投影、发光只有开关及共享强度；材质的角度和纹理密度固定，演唱高亮会覆盖材质。
- 外观通过现有共享设置 owner 保存；不新增网络连接、服务端独立字段表或资源下载。
- 契约：`docs/reference/backend/storage.md` 歌词视觉设置；渲染说明：`docs/reference/frontend/overlays.md`；用户入口说明：配置与场景编辑使用指南。

## Changes And Compatibility

在既有字段表追加以下参数，旧设置和旧搭配通过默认值解析，保持原有效果：

| 字段后缀（均以 advancedLyric 开头） | 默认值 | 范围/枚举 | 作用 |
| --- | --- | --- | --- |
| FontStyle | normal | normal / italic | 正体与斜体 |
| LineHeight | 1.2 | 0.9–1.8，步长 0.05 | 同词组换行行距，参与测量 |
| HighlightOpacity | 1 | 0–1，步长 0.05 | 演唱填色浓度，不改变动作或时间 |
| ShadowColor | #00000085 | 现有颜色格式 | 独立投影颜色与透明度 |
| ShadowDistance | 1 | 0–8，步长 0.25 | 原投影距离的倍数 |
| ShadowAngle | 90 | -180–180，步长 5 | 右为 0°、下为 90° |
| ShadowBlur | 1 | 0–4，步长 0.1 | 原投影模糊半径的倍数 |
| GlowRadius | 1 | 0.25–3，步长 0.25 | 原发光范围的倍数 |
| GlowOpacity | 1 | 0–1，步长 0.05 | 发光浓度，沿用强调色 |
| GradientAngle | 160 | 0–360，步长 5 | 各方向材质相对原方向旋转 |
| TextureScale | 1 | 0.5–3，步长 0.1 | 条纹、圆点、粉笔颗粒大小 |

仅在相关效果启用或材质选中时展示其控制项；行距标明仅作用于换行。字体库及安装字体继续使用既有选择器。扩展现有字距上限到 0.6em。纯色效调整不重建字形或重新计时。字形形态及行距调整沿用既有重建、测量路径。

## Non-goals

不新增字体资源、字体管理入口、MV 时间轴、演示播放、音频分析、动画循环、服务器渲染或依赖；不更改真实歌词时间、当前句规则、场景位置、认证或已有用户配置。

## Milestones And Verification

- [x] 字段、编辑器和渲染器接入；逐项确认字段确有消费者及条件显示。
- [x] 扩展现有契约/保存行为用例，确认新字段可保存、旧搭配补默认值，不重复静态清单断言。
- [x] 在现有浏览器用例覆盖形态变更后的完整文本与适配，以及纯外观参数不重建/不重置时间；用真实渲染器作同句前后对照。
- [x] 扩展既有隔离 Electron 用例，验证桌面与画布的字体和新参数同步保存。
- [x] 同步字段契约、渲染说明及用户指南；执行 `npm run verify:docs`。
- [x] 检查本任务差异、`git diff --check` 和 `git status --short`，保留其他任务改动。

聚焦命令：`node --experimental-vm-modules --test test/lyrics/advanced-lyric-renderer.test.js test/lyrics/advanced-lyric-browser.test.js`；现有共享外观/设置套件按所有权选择；`node --experimental-vm-modules --test --test-name-pattern="motion, advanced lyrics" test/desktop/shared-canvas-appearance-electron.test.js`。新增生产 JS 改动用 `node --check`。不自动扩展为全仓测试。

## Failure Handling And Done When

只回退本任务字段、消费者和测试，不重置或覆盖并发改动。测试用隔离临时数据，产物置于 `tmp/`，不操作用户运行中的应用。完成条件是可见对照、保存与兼容验证通过，文档同步，最后差异检查通过；长时间直播硬件验证不属于本次参数功能验收。

## Evidence

- `advanced-lyric-renderer`、`advanced-lyric-browser`、`settings-contract`、`overlay-projection` 相关套件共 57/57 通过；调整两处断言后对应 2/2 重跑通过。
- 既有隔离 Electron `motion, advanced lyrics` 用例 1/1 通过，覆盖桌面与画布双向回填及保存投影。
- 生产 JS 语法检查、`npm run verify:docs` 10/10、字体机械扫描通过；未运行全仓套件。
- 隔离 Electron 的同句视觉对照覆盖字体/斜体、换行行距/字距、投影、发光、渐变方向、条纹尺度和演唱填色浓度。桌面控件检查确认相关参数随开关/材质变化，霓虹材质即使独立发光开关关闭仍可调整自带光晕；最终页面错误为空。
- 截图保存在 `tmp/advanced-lyric-parameters/`；隔离 Electron 已关闭。自动审批策略拒绝删除 `electron-session` 临时目录，仅返回 blocked by policy，未尝试其他删除方式。
- 测试、存储/渲染参考及配置/场景指南同步完成；交互导览未列具体字效参数，无需更改。未打包发布，未做直播软件长时间实播。
