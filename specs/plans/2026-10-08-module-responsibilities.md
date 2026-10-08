# Module Responsibilities Implementation Plan

Status: Awaiting Verification

依据：用户要求落实当前职责审查的六项问题。

## Goal / Ownership

落实 `tmp/modularity-review-2026-10-08.md` 的六项职责整理：开播应用/媒体能力、Admin 状态与 DOM、HTTP 基础与页面/领域素材、设置提交、工作台存储/提醒、共享平台规则。现有 HTTP/WS/IPC、设置键、持久化格式、状态排序和鉴权语义保持不变。保留其他用户修改，不提交、发布或增加运行时依赖。

开始：2026-10-08 18:29:59 Asia/Shanghai。执行期间用户替换 AGENTS.md，取消原 30 分钟预算；范围仍限于六项已确认问题。前后端独立 owner 并行完成后，由父代理统一运行全仓检查，避免重型测试竞争。

## Current Behavior / Proposed Changes

- 开播配置与媒体存储在 HTTP 路由，场景反向依赖路由；提取 opening service/store/upload parser，保持两个入口各自的鉴权及 body 后复核。
- StateService 读取筛选 DOM 并显示连接状态；页面提供明确筛选输入和状态渲染，版本/重连仍由单一 owner 管理。
- http-utils 混合 JSON、页面与领域素材；拆出 page-assets、opening-media-http、gift-image-http，直接消费者改为引用对应 owner，不留反向聚合。
- settings-routes 编排时钟、WeSing、通知；提取窄 settings application operation，时钟合并放在 clock contract。
- streamer-planner 保留统一页面状态/commit，存储读写与提醒同步分别拥有失败状态和同步代次。
- utils 中平台身份/价格纯合同移至有主题的 shared 模块，Bilibili 房间及错误转换归平台；逐一迁移真实消费者，存储不依赖上层运行时。

## Milestones / Verification

- [x] F01 开播：opening config/style/upload/canvas 和 scene shared appearance 定向回归。
- [x] F02 Admin：admin-state、admin-state-ordering，明确输入与 DOM 隔离回归。
- [x] F03 HTTP：http-utils、http-server-errors、overlay-http-access、页面注入与 opening media stream 回归。
- [x] F04 设置：settings-contract，存储失败不应用配置、通知顺序和时钟样式隔离。
- [x] F05 工作台：streamer-planner，独立存储/提醒失败与异步乱序回归。
- [x] F06 工具：平台/共享规则行为与消费者回归，依赖方向检查。
- [x] 静态集成：`npm run check`、`npm run verify:architecture`、`npm run verify:docs`。
- [ ] 全仓接受：`npm test` 已运行；两项并发弹幕样式工作对应的断言待该功能完成后补验。不得将本轮结果表述为全仓通过。

## Contracts / Failure Handling / Done When

合同归属：`docs/reference/backend/server-core.md`、`docs/reference/backend/api.md`、`docs/reference/frontend/app.md` 和 `docs/architecture/engineering/legacy-boundaries.md`。只更新职责事实，不改已接受的业务规则。新增结构测试约束本轮解开的依赖，不以行数约束模块。

每批以现有测试确认基线，修复本轮回归后才进入集成。全量最多初跑一次和修复所有已知失败后的必要重跑一次；既有问题单列，不弱化断言。截止前停在安全边界，未完成验证如实保留为未结项。只逆转本任务改动，不使用 destructive reset/checkout。六项实现、相关合同、比例适当验证及最终审查完成才归档。

## Results

六项源码边界已完成，所有本次改变的行为合同保持不变；新增依赖方向、设置提交顺序、上传中撤权、提醒回复乱序及存储失败回归。

- F01：基线 30/30；拆分后 33/33。新增上传中撤权和媒体改名失败清理检查。
- F02：状态基线 25/25；相关状态/渲染/启动 44/44。`songs.js` 同期外部表单保存保护修改已保留，本次只新增筛选 getter。
- F05：controller 基线 14/14；模型、视图、controller、storage、reminders 合计 32/32。
- F06：相关消费者 54/54；原工具模块 22 个函数原文逐一比较一致，其中四个函数迁移，18 个保留；控制字符正则未变化。
- 父任务定向检查 109 项中 108 项先通过；唯一失败是新结构断言误覆盖 overlay 的其他既有路由依赖，已收窄到本次 opening 路由边界，随后架构门禁 26/26。没有删除或放宽功能断言。
- `npm run check`：1370 个 JavaScript 文件通过；之后开播媒体 HTTP 复用 store 的目录规则，已补语法和 52/52 相关回归。
- `npm run verify:architecture`：26/26；`npm run verify:docs`：10/10。文档初次失败是本计划状态行含非预期中文标点，已修正。
- 全量 `npm test` 首跑：535 个文件，两个批次合计 3861 项，3848 通过、13 失败、0 跳过；日志 `tmp/responsibilities-full-tests.log`，结构结果 `tmp/test-results/run-67GY7c/results.json`。开播 Electron、画布、页面授权、状态、设置、Bilibili 及工作台相关测试均通过。
- 其中 10 个契约文件因旁边 `lira-server` HEAD 与 `server-contract.lock.json` 不同而无法加载。已在 `tmp/` 准备锁定提交 `01fb2b47d5e081f5dd559933991ade4819eb3428` 的独立副本并验证 10 个 fixture hash；补验 13 个失败文件时，这 10 个契约文件全部通过（没有切换或修改用户的服务器仓库）。结构结果 `tmp/test-results/run-Lgfqdq/results.json`。
- 画布样式库首次与补验均在缩略图解码处失败；并发弹幕工作生成缩略图后，仅追加解码错误上下文的临时 probe 运行原用例，2/2 通过。没有改变正式测试逻辑或断言；该 probe 位于 `tmp/responsibilities-canvas-probe.cjs`。

## Remaining Verification

全量未完全通过：`test/danmaku/admin-danmaku-markup.test.js` 的固定样式枚举和 `test/danmaku/danmaku-style-ownership.test.js` 的 CSS 清单仍未包含并发加入的 `prismatic`。这两项不属于六项模块职责修复，本任务保留其他工作，不更新其断言，也不反复运行全仓。待 [柔彩弹幕计划](2026-10-08-danmaku-prismatic.md) 完成其测试后，使用锁定服务器副本重跑全量验收再归档本记录。
