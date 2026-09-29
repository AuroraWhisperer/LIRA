# 星轨与翻牌时钟实施计划

Status: Completed

## Goal

在百宝箱「萌时钟」中增加参考图对应的星轨时钟、可调色机械翻牌时钟，沿用固定 OBS 地址与现有预览。

## Non-goals

不改旧款设计、路由、认证、桌面生命周期或数据库结构，不引入依赖。

## Current Behavior / Ownership

`public/js/overlays/clock.js` 持有本地时间、缩放与单一秒边界计时器；`public/js/admin/clock-card.js` 持有设置表单与预览消息。`src/server/clock-contract.js` 验证设置，`settings-defaults.js` 提供默认值，`overlay-projection.js` 限定 OBS 可读字段。现有两份 `test/overlays/*clock*.test.js` 覆盖参数、设置与预览。

## Compatibility Constraints

新增 `orbit`、`flip` 样式及 `clockFlipFrameColor` / `clockFlipFaceColor` / `clockFlipTextColor` 三个六位十六进制颜色键。旧数据缺失颜色时用浅灰框、白牌、深灰字；GET 配置仅新增对应颜色字段。保留旧参数、固定地址、opaque iframe 来源验证与隐藏页面停止调度行为。

## Proposed Changes / Milestones

1. 扩展设置契约、默认值、投影及表单（含三种预设）。验证合法/非法颜色、保存回读、预览不重载。
2. 新增两个独立样式 CSS 文件；星轨用透明底白字与矢量星轨，翻牌复用现有时间/日期节点，独立翻牌渲染模块仅对变化值播放上下半牌旋转。验证首帧静态、进位、跨日、减少动态效果与切换清理。
3. 更新 overlay 契约文档；使用隔离的浏览器源预览检查两款及三个配色，检查翻牌中间帧。桌面管理入口使用已有自动化表单测试验证，不以浏览器截图声称验证桌面权限能力。

## Verification

- `node --experimental-vm-modules --test test/overlays/clock-overlay.test.js test/overlays/frontend-clock-runtime.test.js test/overlays/overlay-http-access.test.js`
- 受影响 JS 语法检查；`npm run verify:architecture`、`npm run verify:docs`（新增模块与计划/契约）。
- 隔离浏览器源实测与截图保存在 `tmp/`，不读取或修改真实用户设置。
- 最后检查 touched diff、`git diff --check`、`git status --short`。

## Rollback / Failure Handling

失败时保留用户数据与旧样式，只修正本任务文件；需要回退时逐项逆转本任务 diff，不执行广泛 checkout/reset。

## Done When

两种样式可选，翻牌颜色可保存和预览，机械翻牌动效与日期/秒数/小时制兼容；相关测试通过、视觉检查完成、文档更新、diff 无运行时产物。

## Completion Evidence

- 2026-09-29：时钟契约、表单运行时、overlay HTTP、admin composition/style ownership 共 35 项测试通过；新增用例覆盖非法颜色原子拒绝、颜色保存回读/投影、预设/自定义预览、午夜进位、减少动态效果、隐藏秒数与动画清理。
- `npm run verify:architecture`：22 项通过；所有受影响 JS 语法检查通过。
- 独立内存配置的生产 HTTP handler `/clock` 返回 200，隔离 Chromium 检查星轨两种秒数状态、三种翻牌配色、12h/日期/秒数开关、上下半牌中间帧及固定地址读取保存设置，页面无脚本错误。截图在 `tmp/clock-qa/`；未运行真实用户桌面或修改用户配置，完整 Electron 回归不在本次验证范围。
- 界面检测器返回空 findings；独立审阅确认秒数状态的星轨装饰间距修正，最终 disposition 为 ship。
- 当前契约文档已更新；归档后 `npm run verify:docs` 9 项通过。最终 diff/status 已检查，`git diff --check` 通过，截图与测试临时材料均留在忽略的 `tmp/`。
