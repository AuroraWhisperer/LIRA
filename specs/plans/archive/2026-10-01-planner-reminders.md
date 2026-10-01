# 主播工作台系统提醒 Implementation Plan

**Status:** Complete — 2026-10-01，日程提醒和编辑布局已实现，隔离 Electron 验收通过。

**Goal:** 日程可勾选系统通知，到指定时间由桌面主进程提醒；整理日程编辑窗口的时间、提醒、分类和备注布局。

**Architecture:** 日程仍以现有 localStorage v3 为唯一持久化来源。renderer 通过固定 IPC 同步提醒快照，Electron 主进程拥有定时器和原生 Notification。采用现有管理窗口来源校验，不增加后台服务或依赖。

**Tech Stack:** Vanilla ESM、native CSS、Electron 43、Node.js test。

## Current Behavior

`streamer-planner.js` 在管理页启动时初始化；model 兼容 v1/v2/v3，读取失败禁止覆盖。日程目前没有提醒，编辑窗口为日期/时间两列、独立全天勾选和较高备注框。

## Ownership

- 日程数据与编辑：`public/js/admin/streamer-planner-model.js`、`streamer-planner.js`。
- 日程布局：`public/pages/admin/toolbox/planner.html`、`public/css/admin/toolbox/streamer-planner/event-dialog.css`。
- 桌面提醒：新建 `src/electron/planner-reminder-controller.js`、`ipc/planner-reminder-ipc.js`；由 `main.js` 装配和释放，`preload.js` 暴露固定桥。
- 合约：`docs/reference/frontend/app.md`、`docs/reference/desktop/preload.md`。
- 验证：现有三份 planner tests、新增 desktop controller/IPC tests、隔离 Electron QA。

## Compatibility Constraints

- 保留 `admin.streamerWorkbench.v3`、version 3 和历史迁移；新增可选 `reminderTime`（空字符串为关闭），旧日程默认关闭。
- 定时日程在开始时间提醒；全天日程单独选择当日提醒时间，默认 09:00。
- 仅 LIRA 运行时提醒；管理页初始化恢复未来提醒，启动时不补发历史日程。已排定日程在运行期间休眠后恢复时补发一次。
- 同一 id/提醒时间在进程内至多发送一次；编辑、取消和删除同步替换快照，切换面板或最小化不取消。
- 仅主窗口、主 frame、精确本机 origin 的 `/admin` 可调用；不开放任意通知、文件、URL 或 Electron API。
- 所有现有未提交用户改动保持原样。不提交、不分支、不发布。

## Non-goals

关闭应用后的唤醒/系统任务、云同步、提前提醒、循环日程、重构日历/备忘/待办。

## Proposed Changes / Interfaces

`normalizeEvent` 保留并校验 `reminderTime`；定时日程有提醒时跟随 `time`。`getEventReminderTimestamp(event)` 将本地日期和提醒时间转为毫秒时间戳。

固定桥 `plannerReminders.getState()` 和 `plannerReminders.sync(reminders)`，返回 `{ok:true,supported:boolean}` 或 `{ok:false,error:code}`。快照仅 `{id,title,detail,remindAt}`；main 校验白名单字段、长度、有效整数时间和重复 id，整批验证后替换。

controller 用一个有上限延迟的 timeout 调度最近提醒，resume 时重新检查；发送前标记已处理，保留 Notification 引用并在关闭/失败/退出释放。点击通知恢复并聚焦主窗口。Windows 设置与打包 appId 相同的 AppUserModelId。

## Milestones

- [x] 数据与调度：增加 model/定时/取消/重复同步/休眠/来源校验测试，完成 controller、IPC、preload 和生命周期装配。
- [x] 编辑布局：名称 → 日期及全天/时间 → 系统提醒 → 分类 → 精简备注 → 操作；检查开关、全天提醒时间、编辑回显、保存后恢复和关闭提醒。
- [x] 合约与验收：更新两个 owner 合约，在 `tmp/` 独立 profile 和本机临时服务运行 Electron，检查实际 preload/IPC、布局和原生通知。

## Verification

```powershell
node --test test/admin/streamer-planner-model.test.js test/admin/streamer-planner.test.js test/admin/streamer-planner-view.test.js test/desktop/planner-reminders.test.js test/desktop/legacy-ipc-source.test.js test/desktop/electron-main-modules.test.js test/desktop/electron-shutdown.test.js
npm run check
npm run verify:architecture
npm run verify:docs
git diff --check
git status --short
```

Electron QA 使用 Playwright interactive 项目依赖，不启动仓库生产 main（开发模式 storage 来自仓库 data）。独立测试入口加载真实 preload、registrar、controller 和 planner 资源，不读真实用户数据、不使用实际授权凭据。确认测试服务器精确路由响应后加载。

## Rollback / Failure Handling

读取失败不写入/同步空日程；存储写入失败保留内存和现有提醒，显示原有保存失败状态。IPC/系统不支持在提醒区说明，可继续编辑日程。退出时取消 timeout/resume listener、关闭当前通知并移除 IPC。回退仅审查并逆向本任务补丁；不使用 reset/blanket checkout。

## Done When

勾选的定时和全天日程都能恢复未来提醒、取消和删除不再触发、切页和最小化不丢失、同一提醒不重复；聚焦测试、相关边界/ESM 与文档检查通过，Electron 布局和调用已验证，仓库门禁的任务外失败明确记录，最终 diff 无运行数据或敏感材料。

## Evidence

- 日程 model/controller/view、原生调度/IPC、原有 IPC 来源及桌面启动/退出：74 tests passed。
- 管理页组合、唯一样式归属及工具箱入口：18 tests passed。
- `npm run check`：1141 JavaScript files passed；`npm run verify:docs`：9 tests passed。
- `npm run verify:architecture`：ESM、依赖和组合边界通过（21/22）；剩余失败仅为任务外 `public/css/admin/toolbox/fan-profiles.css`、`public/js/admin/fans/index.js`、`test/gifts/frontend-gift-wishes.test.js` 超出既有行数登记。本任务 main 仅增加 21 行显式接线，单独复核并登记 755 行上限。
- Impeccable 对修改的 HTML/CSS 扫描：`[]`，无发现。
- Electron QA 使用真实 preload、来源 registrar、请求授权适配器和 Notification；匿名 `/admin` 返回 401，授权返回 200。时间仅在隔离 controller 的测试时钟中前移，并经 resume 检查发出两条实际原生通知：定时 20:00 和全天 09:30 均收到 `show`，没有 `failed`；第一条在最小化状态下发出。
- 正常 UI 操作验证：空时间阻止保存、提醒开关、全天展开时间、保存/刷新回显、去重、09:30 自选时间、删除确认完成后取消快照（前移时钟不增加通知），renderer pageerror 为 0。
- 原始窗口 1160×800；弹窗无内容裁切，备注高 76px。截图留在 `tmp/planner-reminder-qa/timed-dialog.png` 和 `all-day-dialog.png`。
- 本次创建的 Electron 窗口、服务和通知已关闭，未启动生产 main 或读取真实用户数据。通知仍受 Windows 系统设置影响，关闭 LIRA 后不触发。
