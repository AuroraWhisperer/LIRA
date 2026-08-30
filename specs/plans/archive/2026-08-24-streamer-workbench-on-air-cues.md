# 主播工作台直播提词重构 Implementation Plan

> **For agentic workers:** 本计划在当前会话内执行；仓库规则禁止未经请求提交，因此不创建 commit。

**Goal:** 将主播工作台从低价值的开播准备清单改为直播过程中可直接查看和勾选的开场、互动、收尾提词，并清理本机已保存的内置旧条目。

**Architecture:** 保留现有 `admin.streamerWorkbench.v2` localStorage 键、对象字段和三个内部 stage 值，只改变界面语义与内置内容。读取状态时仅识别并替换由历史版本创建的已知内置任务 ID 与原始标题；用户自建任务、场次信息、备忘和删除行为保持不变。

**Tech Stack:** Electron 43，Vanilla JavaScript，HTML，native CSS，Node.js `node:test`。

## Global Constraints

- 不改变页面 URL、localStorage 键、数据字段、后端接口或 Electron 安全边界。
- 不增加依赖、框架、构建步骤或新功能。
- 只迁移标题与 ID 同时匹配的历史内置条目，不改写用户自建任务。
- 保留工作区内已有的无关修改，不提交代码。

---

## Goal

主播打开工作台后，看到的是直播时真正需要看一眼的内容：开场交代、暖场问题、备用话题、互动选择、中场提醒和收尾预告；右侧用于记录观众请求、话题灵感与高光时刻。

## Non-goals

- 不接入直播平台 API、实时弹幕、投票或高光标记接口。
- 不重做工作台视觉布局和交互模型。
- 不删除或重置用户自己添加的任务与备忘。

## Current Behavior

页面把任务分成“开播前 / 直播中 / 下播后”，首次打开写入设备检查、标题公告、页面准备与复盘等通用清单。历史 `admin.streamerPlanner.v1` 的六条内置任务会继续迁移到当前键，因此升级后的用户仍可能看到截图中的设备检查、学歌、剪切片和整理歌单。

## Ownership

- 页面与文案：`public/pages/admin/toolbox/planner.html`。
- localStorage 读取、内置任务和渲染文案：`public/js/admin/todo.js`。
- 侧栏与使用说明：`public/pages/admin/toolbox/shell-start.html`、`public/pages/admin/toolbox/usage-guide.html`。
- 架构事实：`docs/architecture/frontend/app.md`、`docs/architecture/frontend/pages.md`。
- 聚焦测试：`test/toolbox-todo.test.js`。

## Compatibility Constraints

- 继续使用 `admin.streamerWorkbench.v2` 和 `admin.streamerPlanner.v1`。
- 继续使用 `before`、`live`、`after` 三个内部 stage 值，避免格式迁移和调用方变化。
- 历史内置条目的完成态不沿用到语义不同的新提词；用户自建条目的完成态照常保留。
- 历史 v1 键仍不得删除。

## Proposed Changes

- 把可见阶段改为“开场 / 互动 / 收尾”，把清单改称“本场提词”。
- 首次启动提供六条直播中可执行的提词，快捷项同步改为开场说明、暖场问题、备用话题、互动选择、重点提醒和下次预告。
- 把现场备忘改为直播速记，分类改为话题灵感、观众请求和高光时刻。
- 读取状态时精确替换 v1 与 v2 的已知内置旧条目；不补回用户已经删除的内置条目。
- 同步侧栏、使用说明和架构事实描述。

## Milestones

### Task 1: 锁定新内容与兼容行为

**Files:**

- Modify: `test/toolbox-todo.test.js`

**Interfaces:**

- Consumes: `window.AdminApp.todo.getState()` 和 localStorage 测试沙箱。
- Produces: 新阶段文案、无旧检查项、v2 内置条目精确替换、v1 自建任务保留的回归约束。

- [x] **Step 1: 写页面内容断言**

  断言 `planner.html` 包含“本场提词”“开场 / 互动 / 收尾”“直播速记”，且不再包含“设备检查”“开播前 / 直播中 / 下播后”。

- [x] **Step 2: 写内置任务迁移断言**

  构造含 `starter-device-check` 与一个自建任务的 v2 状态，断言前者变为开场提词且后者内容、阶段和完成态不变。

- [x] **Step 3: 运行测试确认先失败**

  Run: `node --test test/toolbox-todo.test.js`

  Expected: 新文案或迁移断言失败。

### Task 2: 实现直播提词与精确迁移

**Files:**

- Modify: `public/pages/admin/toolbox/planner.html`
- Modify: `public/js/admin/todo.js`
- Modify: `public/pages/admin/toolbox/shell-start.html`
- Modify: `public/pages/admin/toolbox/usage-guide.html`
- Modify: `docs/architecture/frontend/app.md`
- Modify: `docs/architecture/frontend/pages.md`

**Interfaces:**

- Consumes: 既有 stage 值、localStorage 键、任务与备忘字段。
- Produces: `upgradeStarterTask(task)`，返回替换后的新提词或原任务；页面 DOM ID 与 `AdminApp.todo` API 不变。

- [x] **Step 1: 更新工作台可见内容**

  将页面任务阶段、快捷项、占位文案、帮助文案和速记分类改成直播中可执行的表述，保留所有 DOM ID 与 data 属性结构。

- [x] **Step 2: 更新内置提词和渲染文案**

  在 `todo.js` 中定义六条新 `STARTER_TASKS`，将 `STAGE_CONFIG`、备忘标签、空状态、完成摘要和“转成提词”按钮同步到新语义。

- [x] **Step 3: 实现精确旧内容替换**

  通过历史内置 ID、原始标题和目标提词的显式映射替换 v1/v2 内置项；不匹配原始标题时原样保留，避免触及用户数据。

- [x] **Step 4: 同步使用说明与架构事实**

  将侧栏和文档中的“三阶段准备清单 / 现场备忘”更新为“开场、互动、收尾提词 / 直播速记”，保留已有的其他改动。

- [x] **Step 5: 运行聚焦测试**

  Run: `node --test test/toolbox-todo.test.js test/toolbox-sidebar.test.js`

  Expected: 全部通过。

## Verification

- `node --test test/toolbox-todo.test.js test/toolbox-sidebar.test.js`
- `node scripts/check-js.js public/js/admin/todo.js`
- `git diff --check`
- `git diff -- public/js/admin/todo.js public/pages/admin/toolbox/planner.html public/pages/admin/toolbox/shell-start.html public/pages/admin/toolbox/usage-guide.html test/toolbox-todo.test.js docs/architecture/frontend/app.md docs/architecture/frontend/pages.md specs/plans/2026-08-24-streamer-workbench-on-air-cues.md`
- `git status --short`

## Rollback Or Failure Handling

若聚焦测试失败，只检查和反向编辑本计划列出的任务自有行；不使用 reset、checkout 或批量删除。若历史内置条目无法被唯一识别，则停止迁移该条目并保留用户现有数据。

## Done When

- 页面不再出现设备检查、标题公告等备播默认项。
- 新用户看到六条开场、互动、收尾提词。
- 已保存的已知 v1/v2 内置旧条目会被替换，用户自建任务与备忘不变。
- 侧栏、使用说明和架构事实与界面一致。
- 聚焦测试、JS 检查和 `git diff --check` 通过，最终差异仅涉及本任务。

## Verification Results

- `node --test test/toolbox-todo.test.js test/toolbox-sidebar.test.js`: 22 passed, 0 failed。
- `node --check public/js/admin/todo.js`: passed。
- 旧可见文案扫描：仅测试中的反向断言保留旧词，运行页面无残留。
- `git diff --check`: passed；换行符提示不影响检查结果。
