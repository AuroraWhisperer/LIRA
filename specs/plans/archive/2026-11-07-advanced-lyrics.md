# 基础与高级实时歌词 Implementation Plan

**Status:** Completed

**Goal:** 保留现有基础多行歌词，增加独立的高级一至两句视觉编辑界面。编辑页签与输出状态分离；两个输出开关独立且允许同时显示。高级提供可组合的排版、字体配色、字效材质、入场／停留／退场／逐字动作、装饰和轮换，并复用已有歌词采集、时间轴和播放时钟。

**Architecture:** 沿用模块化单体、原生 ESM/CSS、现有 `/lyrics` 页面和 `lyrics` 场景类型。在现有渲染组合根下挂载高级纯视觉渲染器，同一文档只创建一个歌词时钟和帧调度器。后台不新增歌词采集、解析或网络连接。

**Tech Stack:** Electron 43、Node.js 24+、原生 ES modules/CSS、Web Animations API、现有 node:test/Playwright 测试工具。

## 当前事实与来源

- 管理入口为「组件 → 音乐展示 → 直播歌词」；表单 `desktop-lyric.js` 负责自动保存，`desktop-lyric-preview.js` 复用管理页歌词事件。
- `/lyrics` 由 `lyric-window.js` 建立一条现有 overlay socket；场景 iframe 使用 `mountSceneExtraClient('lyrics')` 接收父窗口数据，无独立 socket。场景已按时间轴版本避免重复传输完整歌词。
- `desktop-lyric-renderer.js` 拥有基础多行 DOM、当前句和换行动画；`LyricWordRenderer` 拥有时钟、30fps 调度、文档/元素可见性。
- `SCENE_EXTRA_COMPONENTS.lyrics.fields` 连接场景校验、默认值和共享外观；高级外观须加入同一事实源，不能只在管理表单保存。
- 视频参考：[歌词页面实操展示](https://www.bilibili.com/video/BV1RQxu6UEF7/)。此前已实际观看并确认排版、字效、材质、动作与装饰可组合；未取得原程序或完整素材库。
- 参考 [JIZURA 组合模型](https://github.com/852wa/JIZURA/blob/main/docs/EXPRESSION_PACKS.md)、[LyricalStudio 模板](https://github.com/arijit-debug/LyricalStudio/blob/main/src/templates/index.ts) 和其 [FitBox](https://github.com/arijit-debug/LyricalStudio/blob/main/src/templates/FitBox.tsx)。本次自行实现算法和视觉，不引入整个应用或新运行依赖。

## 边界与兼容

- 原采集、匹配、QQ／网易云／全民 K 歌同步、认证及歌词事件合同沿用。基础设置默认值、旧样式资源包和已有场景保持可用。
- 新增 `desktopLyricEnabled` 默认 true、`advancedLyricEnabled` 默认 false；编辑页签仅为本地 UI 状态。
- `/lyrics` 默认合成两个启用层；可用 `?layer=basic` / `?layer=advanced` 分别摆放。场景 `lyricLayer` 是实例级显示筛选，不由共享外观覆盖。
- 两个独立浏览器源必然各自绘制，不宣称跨进程零绘制成本；同一来源共享采集结果和同一文档内的时钟、当前句计算。
- 现有工作区有大量非本任务改动，包括歌词 renderer/test、overlays.md 和计划索引。只在这些改动上局部追加；不回滚、不提交、不改无关领域。
- 不新增服务、框架、构建链或启动下载；纹理和几何装饰由 CSS/DOM 实现。

## 所有者与接口

| 责任 | 文件与消费者 |
| --- | --- |
| 高级目录与配置定义 | 新 `public/js/shared/advanced-lyric-catalog.js`、`advanced-lyric-appearance.js`；供编辑器、场景、服务端验证与 renderer 使用 |
| 配置保存与投影 | `src/storage/settings-defaults.js`、`src/server/settings-contract.js`、`overlay-projection.js`、`public/js/shared/scene-extra-components.js`；保留既有设置事务 |
| 编辑与本地预览 | `public/js/admin/desktop-lyric.js`、`desktop-lyric-preview.js`、`desktop-lyric-controls.js`；新增高级编辑模块及 scoped CSS，更新歌词 HTML fragments |
| 共享渲染与生命周期 | `public/js/lyrics/desktop-lyric-renderer.js`、`public/js/shared/lyric-word-renderer.js`；接入高级渲染和双开关 |
| 高级纯视觉 | 新 `public/js/lyrics/advanced-lyric-renderer.js`、构图/动作模块及 `public/css/lyrics/advanced-lyric.css` |
| 输出 | `public/js/overlays/lyric-window.js` 与对应 HTML；保持现有场景传输 |
| 合同与指导 | `docs/reference/frontend/overlays.md`、`docs/reference/backend/storage.md`、相应页面/接口文档及歌词使用指南；按实际影响局部更新 |

高级渲染器接口：

```js
createAdvancedLyricRenderer(root) => ({
  applySettings(rawSettings),
  renderFrame({ currentMs, line, index, nextLine, playing, discontinuity, trackTitle }),
  setVisible(visible),
  dispose(),
});
```

高级 renderer 不获取网络、不创建时钟或长期帧循环。组合根一次求当前句，将同一位置提供给两个视图。布局测量限于换句、相关设置、字体就绪和 resize；逐帧只更新活跃动作与高亮。随机/轮换选择由句索引稳定决定，seek 回来不产生随机跳变。停用或不可见时取消动画、观察者的无效工作和帧调度。

管理预览使用 `setPreviewLayer('basic'|'advanced'|'both')`。basic/advanced 允许在输出关闭时编辑预览，both 按两个开关合成；该方法不保存输出状态。实际输出 `init({layer})` 始终受两个开关控制。

## 里程碑与验证

- [x] **配置与目录：** 明确真实可用的构图、材质、叠加字效、动作、装饰和预设，严格归一化新配置，默认升级不改变既有基础外观。用配置/设置事务/场景共享外观测试验证非法值拒绝与保存恢复。
- [x] **共享运行时：** 两层开关四种组合、可见性、暂停、seek、禁用后停止工作；原多行/逐字测试继续通过；同一文档不增加 socket 或歌词解析。
- [x] **高级视觉：** 各目录选项对应真实可见的差异，跨维度组合可用；中英文、长句、emoji 完整显示；1–2句切换、歌词时钟驱动动作，实际浏览器输出验证。
- [x] **编辑界面：** 基础/高级切换、独立显示开关、分类效果卡片、参数修改、预设与轮换、实时保存及恢复；高级关闭时仍可试样式，隐藏预览停止动画。
- [x] **交付核验：** 在隔离 Electron 中验证真实管理入口；浏览器源与场景验证共享配置及两层输出；同步合同、指南和必要测试，检查最终 diff。

预定聚焦检查（随着具体新增测试补充文件名与结果）：

```text
node --experimental-vm-modules --test test/lyrics/desktop-lyric-settings*.test.js test/lyrics/desktop-lyric-renderer.test.js
node --experimental-vm-modules --test test/lyrics/advanced-lyric*.test.js
node --experimental-vm-modules --test test/scenes/scene-extra-components.test.js test/scenes/shared-appearance.test.js
npm run verify:docs
npm run verify:architecture
git diff --check
git status --short
```

测试必须使用合成歌词、隔离配置/数据库和本任务进程。不得打开或重启用户正在运行的应用。脚本、截图及 Electron 用户数据放 `tmp/`。字体/样式可使用现有资源，不触发新的启动下载。

## 完成条件

两个界面清晰可切换；两个开关可独立保存并同时输出；高级拥有真实可组合的视觉库与预览；基础旧行为通过回归；禁用/隐藏层无持续动画或无效完整 DOM 重建；同一文档一条歌词数据输入、一套时钟；输出与编辑采用同一视觉实现；长句、换句、暂停、seek 和场景发布验证完成；对应合同、使用说明、测试与最终 diff 已核对。未验证的视频像素一致性不作为完成宣称。

## 失败处理

失败先定位具体配置、布局或生命周期原因，只回退本任务拥有的变更。默认高级关闭保证未启用的新效果不影响旧显示；不得用全仓恢复、清理或关闭用户应用作回滚。

## 执行记录

- 2026-11-07：完成首轮现有实现和上游参考审计，冻结双层共享时钟/事件设计，启动配置、编辑器、纯视觉、运行时分工。
- 2026-11-07：完成 22 种构图、12 种材质、组合字效/动作/装饰、双独立开关、合并与独立浏览器源、场景层筛选、自存搭配及共享时钟接入。
- 2026-11-07：聚焦歌词与设置/场景检查通过；隔离 Electron 验证页签、示例试播、保存恢复、实时切回、双层叠加和布局高度；浏览器源验证合并、独立层和关闭动画；字体/长句/暂停/seek/隐藏行为通过。
- 2026-11-07：完成文档同步、存储依赖分层修正、最终差异和架构/文档门禁复核。视频原程序未公开，未宣称像素级一致；未实播、提交、打包或发布。
