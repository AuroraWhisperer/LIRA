# 弹幕非正文文字参数

**Status:** Complete

## Goal

逐款核对内置弹幕的非正文文字，按实际用途提供字体、字号、颜色控制；客户端与画布共用控件、保存和场景输出。没有覆盖的文字保持现有字号与设计。

## Current Behavior / Ownership

- `public/js/shared/danmaku-style-options.js` 拥有字段与校验，脚本生成 `src/shared/danmaku-style-options.js`。现有字段主要覆盖正文，非正文尺寸大多在各款 CSS 中固定。
- `public/js/shared/danmaku-parameter-controls.js` 同时供客户端和画布使用；`danmaku-appearance-draft.js` 拥有草稿、切换与重置。
- `public/js/overlays/danmaku-style-application.js` 为预览与场景应用样式；各款 renderer/CSS 是文字分组的依据。
- `src/server/danmaku-appearance.js` 与本机账号 store 保持保存所有权，不增加远端样式合同。
- 参考文档 owner 为 `docs/reference/frontend/overlays.md`；操作说明在 `public/pages/admin/toolbox/usage-guide-toolbox-danmaku-gifts.html`。

## Compatibility / Non-goals

保留已有正文默认字号、已存参数、所有消息与排版默认值。新增可选覆盖字段，未设置即原样式，不迁移旧数据。按昵称、身份文字、金额、时间、事件标签及样式专属提示拆分；同用途的消息类型合并控制。图片字样不假装为可编辑文字。不调整动效、资源下载、消息订阅、鉴权或服务器。保留任务开始时已有的其他修改，不提交、不建分支。

## Proposed Changes / Milestones

- [x] 建立逐款文字目标清单，接入可选字段校验及 Node 镜像。验证字段仅对有对应文字的样式开放，旧配置和恢复默认不改变原字号。
- [x] 在共用参数区展示非正文分组，应用覆盖到实际文字节点。默认不注入覆盖，切换和重置清除旧覆盖；新消息沿用同一规则，不添加观察器、订阅或请求。
- [x] 扩展现有合同、排版浏览器和隔离 Electron 用例：逐款渲染聊天／礼物／上舰／SC；验证分组独立、正文不受影响、默认可恢复；从客户端和画布编辑并保存到本机场景。
- [x] 更新参数合同与操作说明，完成相关检查、diff 与状态审阅。

## Verification

- `node scripts/sync-danmaku-style-options.cjs --check`
- `node --experimental-vm-modules --test test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-appearance.test.js test/danmaku/danmaku-panel-edit-state.test.js test/danmaku/danmaku-typography-browser.test.js test/desktop/danmaku-canvas-electron.test.js`：51 项通过。
- 修正桌面用例的 Playwright 超时参数位置后，单独重跑 `node --experimental-vm-modules --test test/desktop/danmaku-canvas-electron.test.js`：2 项通过。
- 最终逐款复检 `node --test --test-name-pattern="each built-in style edits non-body text" test/danmaku/danmaku-typography-browser.test.js`：通过。
- `npm run verify:docs`；相关 JS 语法检查；`git diff --check` 与 `git status --short`。
- 复用隔离夹具，不访问真实账号数据；临时截图和检查记录置于 `tmp/`。

## Evidence

- 47 款内置样式、162 个实际文字组，覆盖普通观众、粉丝／大航海、主播、聊天、礼物、上舰、支持 SC 的款式及 Twitter／幽灵便笺外框。逐组检查字体、字号和颜色可修改，不影响正文或其他组，取消后计算样式恢复原值。
- 桌面通过真实控件设置昵称 Georgia、22px、`#123abc` 并保存；画布读到相同配置，改为 27px、金额 18px，保存并应用后重开保留。正式本机场景接收合成聊天与 SC，昵称为 Georgia／27px／`#123abc`，金额为 18px。
- 人工检查桌面分组、画布参数与预览。验证期间隔离夹具授权过期，按夹具的正常续期入口恢复后完成场景验证；不修改应用授权规则。
- 字段镜像检查、13 个相关 JavaScript 语法检查、文档门禁 10 项及 `git diff --check` 通过，Impeccable 检测无发现。文档首轮因本计划状态标签格式失败，改为仓库要求的 `Status:` 后通过。技术参考、逐样式参数指南与应用内指南已同步；导览只描述入口，入口未变，无需修改。旧截图未展示新增分组，原有操作仍有效；新增操作以文字说明。
- 使用账号和数据目录均为隔离夹具，未访问真实账号、打包或替换运行中的客户端。并行圣诞兼容性及其他既有修改不属于本任务。
- 最终差异和状态已审阅，暂存区未改动。已关闭自有 Electron、浏览器和预览服务器，并清理隔离运行数据；截图与检查记录留在仓库 `tmp/danmaku-text-controls/`。

## Rollback / Done When

失败时按目标分组定位，不修改不相关行为；仅反向撤销本任务新增字段、控件、覆盖及测试文档。逐款目标有实际渲染证据、两入口编辑保存与场景输出通过、默认外观保留、文档同步且最终 diff 审阅后完成。
