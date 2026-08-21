# 主播计划与备忘工作台实施计划

## Goal

把现有按“今天 / 本周 / 本月”和百分比推进的通用计划器，改成围绕单场直播工作的“下一场直播 + 开播前 / 直播中 / 下播后清单 + 现场备忘”桌面工作台，并允许把备忘转成明确行动。

## Non-goals

- 不接入服务端、账号同步、通知或第三方日历。
- 不改变百宝箱页面 URL、Admin 分片顺序或 Electron 安全边界。
- 不增加前端框架、构建步骤、运行时依赖或通用项目管理能力。
- 不改动用户当前未提交的 Bilibili 用户信息规格与架构文档。

## Current Behavior

`public/js/admin/todo.js` 使用 `admin.streamerPlanner.v1` 在 `localStorage` 中保存任务数组。任务只有今天、本周、本月三个时间桶、四个类别和五档百分比进度；首次使用自动写入六条示例任务。`public/pages/admin/toolbox/planner.html` 和 `public/css/admin/other-features/streamer-planner.css` 将这些任务显示成三栏时间线。`test/toolbox-todo.test.js` 覆盖 HTML 结构、窄屏布局、任务增删改和 Admin 初始化。

## Ownership

- Owner: `public/js/admin/todo.js`、`public/pages/admin/toolbox/planner.html`、`public/css/admin/other-features/streamer-planner.css`
- Contract: `docs/architecture/frontend/app.md` §6、`docs/architecture/frontend/pages.md`
- Consumers: `public/js/admin/app.js`、`public/js/admin/index.js`、`public/pages/admin/toolbox/shell-start.html`
- Focused test: `test/toolbox-todo.test.js`

## Compatibility Constraints

- 保持 Admin 无构建 Vanilla JavaScript 和现有 `window.AdminApp.todo` 初始化边界。
- 用户已有 `admin.streamerPlanner.v1` 任务必须迁移到新存储，不能静默丢失。
- 所有用户输入继续通过 `textContent` 和 DOM API 渲染，不拼接不可信 HTML。
- 数据继续只保存在当前电脑，不新增 HTTP、WebSocket 或 IPC 合同。
- 保留键盘焦点、`aria-live`、清晰标签和 `prefers-reduced-motion` 支持。

## Design Direction

主题是给音乐直播主播使用的桌面导播单，单一工作目标是在开播前后快速看清本场内容并记录现场信息。

- Color: `#1f2937` 墨蓝文字、`#ef5d75` 开播珊瑚、`#2f8f83` 完成青绿、`#d39a43` 备忘金、`#f4f7fa` 导播台底色、`#ffffff` 内容面。
- Type: 沿用应用正文 `var(--font)`；日期时间使用 `"Segoe UI"` 等宽数字特性；标题依靠紧凑字距和字重建立层级，不加载外部字体。
- Signature: 一条贯穿开播前、直播中、下播后的“导播轨道”，场次条上的 `NEXT LIVE` 标识只在这一个位置承担强视觉记忆。
- Layout:

  ```text
  ┌ 下一场直播：日期 / 时间 / 主题 / 本场重点 ─────────────┐
  └──────────────────────────────────────────────────────┘
  ┌ 直播计划（开播前 → 直播中 → 下播后） ┐ ┌ 现场备忘 ┐
  │ 快速添加 + 常用清单                  │ │ 记一句   │
  │ ○ 任务                               │ │ 备忘卡   │
  │ ● 已完成                             │ │ 转为计划 │
  └──────────────────────────────────────┘ └──────────┘
  ```

自检：避免了常见的暖米色看板和三列通用任务卡；结构来自直播导播流程，阶段轨道、场次条和备忘转行动都对应主播实际工作，而非装饰。

## Proposed Changes

- `public/js/admin/todo.js`: 引入 v2 工作台状态、v1 迁移、场次自动保存、阶段清单、备忘增删及转计划；保留现有任务 API 的兼容入口。
- `public/pages/admin/toolbox/planner.html`: 替换三时间桶页面为场次条、直播阶段清单和备忘面板。
- `public/css/admin/other-features/streamer-planner.css`: 实现桌面优先的导播工作台布局、阶段轨道、备忘卡和窄窗口降级。
- `public/pages/admin/toolbox/shell-start.html`: 将侧栏说明改成“直播清单与现场备忘”。
- `test/toolbox-todo.test.js`: 先更新结构与迁移/持久化测试，再实现功能。
- `docs/architecture/frontend/app.md`、`docs/architecture/frontend/pages.md`: 更新 owner 文档中的存储键和功能描述。

## Milestones

1. 写出新 HTML、数据迁移和备忘行为的失败测试。验证：`node --test test/toolbox-todo.test.js` 按预期失败。
2. 实现 v2 本地状态和计划/备忘交互。验证：聚焦测试全部通过。
3. 实现桌面端导播布局并更新 owner 文档。验证：语法、文档与架构快速门禁通过。
4. 在 Electron 桌面视图中打开主播工作台，检查默认态、添加计划、添加备忘和备忘转计划；根据截图做一次视觉收敛。
5. 复查 `git diff`、`git diff --check`、`git status --short`，确认任务差异不包含用户已有的未提交文件。

## Verification

- `node --test test/toolbox-todo.test.js`
- `npm run check`
- `npm run verify:quick`
- Electron 桌面视图：下一场直播字段可保存；三阶段清单可增删勾选；备忘可新增并转计划；窄窗口不横向溢出。
- `git diff --check`
- `git status --short`

## Rollback Or Failure Handling

停止时仅检查和反向修改本计划列出的文件；保留 `admin.streamerPlanner.v1` 原始数据，不删除用户旧键。不得使用 `git reset --hard`、宽泛 checkout 或递归删除，也不得触碰当前已有的 Bilibili 用户信息文档改动。

## Discovered Scope

本次实施期间工作树同时出现了另一组未提交的启动性能、Bilibili 用户信息、Electron/服务端生命周期、性能检测和治理文档改动。这些改动不属于本计划，实施过程中未修改；最终审计应将它们与本计划列出的主播工作台文件分开查看。

## Done When

- 用户能围绕下一场直播维护场次信息、三阶段行动和现场备忘。
- 备忘能一键转为计划，旧 v1 任务能迁移且原键保持不变。
- 页面在 Electron 桌面主目标尺寸和窄窗口下可读、可键盘操作。
- 聚焦测试、语法检查和快速验证通过，owner 文档与实现一致。
- 本任务相关差异只包含本计划文件和其列出的实现、测试、owner 文档；其他并行改动保持不变。
