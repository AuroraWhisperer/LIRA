# 桌面全屏取色实施计划

## Goal / Current Behavior

颜色组件的「取色」可选取 LIRA 窗口外的桌面像素。现有
`public/js/shared/color-picker.js` 直接使用 EyeDropper；Electron Windows
实现存在窗口边界限制（electron/electron#27980）。不透明度保持原值。

## Ownership / Compatibility / Non-goals

- 桌面 owner：`src/electron/screen-color-picker.js`，main 负责注册与释放。
- 使用现有 main-window IPC 来源检查；主页面只得到 HEX，不得到截图。
- 临时窗口使用隔离 sandbox preload、独立内存 session、本地固定页面。
- 不改持久化、授权、业务颜色事件、浏览器原生 EyeDropper 或画板取色。
- 保留工作区已有修改；不提交、不打包、不重启用户实例。
- 契约：`docs/reference/desktop/preload.md`、`desktop/windows.md`、
  `frontend/pages.md`；指南更新现有配置页。

## Proposed Changes / Milestones

- [x] 注册无参数 `desktop:pick-screen-color` / `desktop:cancel-screen-color`。
  复用 main-window registrar。单次全屏快照按 display_id 匹配屏幕，分别覆盖
  display.bounds；主进程根据点击坐标读取像素。重复请求拒绝。
  所有窗口、截图引用与监听由本次操作拥有；取消、导航、关闭、显示器变化、
  失败和 dispose 均结束操作。测试伪造来源、参数、缩放、取消及捕获中的退出。
- [x] 共享组件优先桌面桥，仍保持 alpha 与 input/change；关闭或切换字段取消，
  迟到结果不写新字段。浏览器保持 EyeDropper。失败在控件内提示。
- [x] 隔离 Electron 运行真实截图与窗口，用窗口外固定色块验证取色；用户确认正常。
  Escape、重复启动、清理以定向自动化覆盖；实机自动化取消的限制见下文。
  补充契约与使用指南。

## Verification / Done When

运行 `node --test test/desktop/screen-color-picker.test.js`、
`node --test test/ui/frontend-color-control.test.js`，相关 Electron IPC 测试，
`npm run check`、`npm run verify:architecture`、`npm run verify:docs`。
通过隔离 Electron 的窗口外取色和定向取消检查后复核 diff、`git diff --check` 与
`git status --short`。多显示器比例由单元测试覆盖；实机仅按可用显示器验证。

## Rollback / Failure Handling

失败返回固定错误，关闭临时窗口，不修改原色。只撤回本任务差异，不使用
reset/checkout。无法捕获完整显示器时失败，不静默取错屏幕或降级为窗口内取色。

## Status

Status: Completed

2026-10-17，本次工作区未提交、未打包。相关回归 44 项通过，增加主 renderer 崩溃
清理覆盖后 owner 5 项再次通过。语法检查、架构 27 项、文档 10 项通过。
文档门禁首次发现本计划状态标签格式错误，修正后通过。

隔离 Electron 43 在单显示器、150% 系统缩放下运行生产 preload 与取色 owner，
窗口外色块返回 `#34a26f80`，用户回复「正常的」。后续自动化重复验证未得到稳定
结果：期望色块时实际返回白色，预期断言超时；该轮未计为通过，也未完成实机 Esc
自动化。测试窗口允许人工交互且色块未置顶，前台内容无法保证固定；本次以用户
确认和已通过的定向回归收口，不声称实机取消或多显示器已自动验收。多屏负坐标、
150% 像素映射、取消、崩溃、显示器变化、导航与捕获中关闭由 owner 测试覆盖。

测试进程已关闭。临时脚本留在 `tmp/screen-color-picker-qa/fixture.cjs`；
自动审批拒绝递归删除 `tmp/screen-color-qa-UmrK5G`，该隔离数据目录保留，
没有改用其他工具绕过。相关契约及用户指南已同步。
