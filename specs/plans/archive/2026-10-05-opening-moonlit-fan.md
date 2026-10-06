# 月渡花汀开播成品动画实施计划

**Status:** Completed · 2026-10-05。实现、画布集成、连续播放与最终视频已验证；证据见文末。

**Goal:** 完成与用户蓝白古风参考具有相当美术层次的原创开播动画，无人物模型，包含真实独立运动的多层元素、完整入场和连续待机，并接入 LIRA。

**Architecture:** 沿用 `/opening`、现有配置读取及画布预览。新增 `moonlit-fan` 样式及独立 Canvas 2D 渲染器；分层美术资源负责材质，确定性时间线负责折扇结构展开、绢带形变、花枝、白鹤、蝶、花瓣、雾与水面。音频继续由现有 opening runtime 拥有。

**Tech Stack:** 原生 ES modules、Canvas 2D、CSS、透明 WebP；不增加运行时依赖、进程或构建步骤。

## Current Behavior / Ownership

- `public/js/overlays/opening.js` 拥有开播生命周期、配置、音频与可见性；已有经典和像素卡带。
- `src/server/opening-contract.js` 拥有样式枚举；`settings-contract.js` 和 `routes/opening-routes.js` 复用它。
- `public/js/admin/start-animation.js` 与 `public/pages/admin/toolbox/start-animation.html` 拥有样式选择和编辑项。
- 画布预览/正式场景直接传递开播配置；保持原数据路径。
- 直接检查入口：`test/overlays/opening-style.test.js`、`frontend-opening-runtime.test.js`、`opening-overlay.test.js`、`test/admin/canvas-opening.test.js`。
- 现有 `tmp/opening-moon-fan/concept-16x9.png` 仅为方向稿，不能作为动画验收证据。

## Constraints

- 原有经典/像素样式、配置键、固定 URL、凭据与沙箱规则保持兼容；新增枚举为加法。
- 不含人物模型，不制作礼物感谢；不把整张静图缩放当成独立图层动画。
- 仅新增本主题资源与必要的开播改动，保留工作区其他任务的改动；不提交或创建分支。
- 临时素材、处理脚本、视频与截图在根目录 `tmp/opening-moon-fan/`；正式资源位于 `public/img/overlays/opening-moon-fan/`，避开旧人物素材的打包排除目录。
- 实际用户设置和媒体不得用于测试；使用现有隔离 fixture。

## Milestones

- [x] 制作并检查独立山水、折扇、花枝等原画，处理透明边缘，控制资源体积。验证：透明棋盘底和 1920×1080 合成画面；无绿色溢边、截断和明显风格冲突。
- [x] 新增 `opening-moon-fan.js` 生命周期和 `opening-moon-fan-art.js` 画面/时间线。验证：独立层次与位移，扇片共轴展开，花瓣/蝶连续循环，文字清晰，入场中段及静态减少动态效果可用。
- [x] 接入样式枚举、现有 runtime、编辑器和页面。验证：选择样式、开关、修改文字与画质、来回切换原样式，画布预览和正式输出一致。
- [x] 使用 persistent Playwright 对真实渲染进行视觉与行为验收，至少连续两轮待机。输出可播放视频与本地预览。验证：无跳回首帧、重复入场、错误请求、关闭后帧循环或资源泄漏。
- [x] 更新直接契约文档和计划状态，完成焦点检查、diff 与状态审阅。

## Verification / QA Inventory

1. 单元与现有回归：`node --experimental-vm-modules --test test/overlays/opening-style.test.js test/overlays/frontend-opening-runtime.test.js test/overlays/opening-overlay.test.js test/overlays/opening-moon-fan.test.js`。
2. 开播画布端到端：`node --test test/admin/canvas-opening.test.js`；通过正常表单输入触发预览、样式切换、开关、字幕修改。
3. 新增几何/生命周期测试保护确定性的扇片姿态、循环连续性、停用/销毁取消帧回调、重新启用重置入场；不为美术逐像素镜像实现。
4. 视觉证据：1920×1080 入场中段、完成态、两个循环交界以及 960×540 等比输出；核对无人物、蓝白主色、可读文字、花枝/绢带/扇子/鸟蝶/花瓣/雾水各自运动。
5. 非常规状态：切到其他样式再返回；停用后恢复；减少动态效果；素材加载失败时明确显示错误而非无限空白。
6. 记录实际浏览器环境的帧间隔与长帧，不以静帧或理论预算承诺实机帧率。
7. 检查 `git diff --check`、本任务文件 diff、`git status --short`；资源只含原创生成美术及使用说明，无凭据/运行数据。

## Failure Handling

资源或画面质量不足时继续迭代相应资产和 owning renderer；不更换任务目标为静态图。配置和开关沿用原 owner，失败不覆盖已保存数据。需要回退时仅审阅并逆向本任务补丁，不执行 reset/blanket checkout。

## Done When

可播放且有真实多层动作的完整动画已实际检查；保持参考蓝白古风美感并采用原创主体；现有开播页面可选择并展示；两轮待机连续性、相关控件与生命周期通过；有实际视频/预览可供用户直接看；检查和文档已记录。仅有设计稿、代码或绿测不算完成。

## Completion Evidence

- 正式 WebP 共 11 张、1,642,120 bytes；生成来源与边界见素材目录 README。
- 30 项 opening 单元/回归通过；`test/admin/canvas-opening.test.js` 1 项集成通过，覆盖管理表单、原样式往返、总开关、画质、保留自定义标题和正式场景沙箱输出，子 renderer 无额外 API 请求。
- 最后无障碍名称改动后重跑 `opening-moon-fan.test.js`，5/5 通过。
- 真实动画连续录制 58 秒，包含约 10 秒入场与 48 秒待机。24/48/72 秒完整帧逐像素一致；入场只发生一次。
- 软件 Headless Shell 实测约 12 fps，不能作为硬件表现；完整 Chromium 硬件加速 Intel UHD Graphics 在 1920×1080 标准画质录制时，48 秒待机样本 1360 帧，平均 28.33 fps、P95 间隔 36.4ms。截图等 QA 操作期间有 2 个超过 100ms 的间隔。
- 通过实际按钮检查暂停/继续、重播、低/标准/高画质和全屏；减少动态效果显示完整静帧；960×540 构图已查看。
- 最终交付 `tmp/opening-moon-fan/月渡花汀-完整开播动画.webm`（33.887 秒，1920×1080），正常播放检查连续入场帧，定位 3 秒和 24 秒正常。早期 H.264 导出漏掉入场帧，已移入 QA，不作交付。
- 独立 `月渡花汀-动画预览.html` 内含全部素材，使用同一份生产渲染器，file URL 已直接打开并验收。
- 未启动或修改用户的 Electron/OBS/直播姬实例，未进行实播；不把隔离画布测试描述为 Electron 特权集成验收。无声预览，音乐仍由既有开播 runtime 管理。
- 焦点 diff、语法与 `git diff --check`/`git status --short` 已完成；没有提交、建分支或混入其他任务改动。
