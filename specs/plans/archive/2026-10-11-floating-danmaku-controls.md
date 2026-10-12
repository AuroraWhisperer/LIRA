# 飘窗速度与分散参数实施计划

状态：Completed（2026-10-11；仅本地实现，未提交或部署）

## Goal

所有飘窗样式提供 1–100 的飘动速度与分散程度，默认均为 50。速度对应当前默认的 1/3、1、3 倍；分散 100 在整个可用高度内最大化到最近现有弹幕的边缘距离，包括上下边界，不使用卡片高度倍数上限。

## Non-goals

不改变固定/区域随机布局，不新增样式，不提交或部署，不覆盖工作区已有修改。

## Current Behavior / Ownership

`public/js/overlays/danmaku-floating.js` 和 Server `public/overlay/danmaku-floating.js` 拥有共同的水平运动，当前随机高度不避让。桌面参数 owner 为 `public/js/admin/danmaku-parameter-view.js`，独立预览为 `danmaku-preview-appearance.js`，转换与草稿由 `shared/danmaku-appearance-draft.js` 承担。客户端两个 `danmaku-style-options.js`、Server 两个 `overlay-style-options.js` / `style-options.js` 校验保存字段。Server `app.js` 和客户端 `danmaku.js` 传递动态参数。

## Compatibility Constraints

保留 `speedPixelsPerSecond` 的 20–600 整数存储和接口契约，只有编辑速度时将 1–100 的指数刻度转换为整数像素/秒；其他编辑不裁剪旧值。新增仅 floating/comet 接受的 `floatingDispersion`（1–100 整数，缺失默认 50）。既有 `dispersion` 仍只属于区域随机样式。当前样式独立保存、恢复默认及授权流程保持原契约。

## Proposed Changes

- 转换：`round(120 * 3 ** ((value - 50) / (value <= 50 ? 49 : 50)))`；逆转换用于显示，旧范围外速度保留并标识旧值。
- 位置：按实时矩形边缘距离构造允许的纵向区间，二分求最大可用距离。分散档位线性插值基础间隙与最大距离，从满足门槛的区间均匀选位；100 逼近全局最远位置。第一条均匀随机，在线调分散只影响新消息。
- 运动：同一 feed 等速移动以保持相对位置；保留变速连续性与完整离场。无空位时最多等待 2 秒，每 100ms 重试；仍沿用 50 条总量上限，清空/销毁释放全部资源。
- 界面：复用参数滑块；速度及分散放在基本参数，随机参数维持原位置。
- 同步本地 Server 的校验、正式画面消费和协议字段；不改远程部署。

## Milestones / Verification

- [x] 参数契约、转换和几何算法；`node --experimental-vm-modules --test test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-floating.test.js` 验证边界、最远上下/中间空隙、实时位置、连续变速、拥挤和释放。
- [x] 桌面、独立预览及 Server 集成；现有 `danmaku-local-preview.test.js`、`danmaku-canvas-electron.test.js` 与 Server `overlay-floating.test.js` / `overlay-settings-service.test.js` / `e2e/overlay-floating.spec.js` 覆盖编辑、保存、恢复、应用与显示。
- [x] 更新客户端技术参考、应用内使用说明、Server protocol/OpenAPI、requirement/acceptance；已执行文档及静态检查，保留下述并行工作区限制。未改变架构职责；无关指南及导览内容仍准确，不重复修改。

## Verification Results

- 客户端：`node --experimental-vm-modules --test test/danmaku/danmaku-floating.test.js test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-local-preview.test.js` 当次 26 项通过。随后预览连续更新修改后，单独运行 `danmaku-local-preview.test.js`，14 项通过（包含同期新增的身份图片用例）。
- 桌面：`node --experimental-vm-modules --test --test-name-pattern='browser canvas keeps' test/desktop/danmaku-canvas-electron.test.js`，1 项通过；隔离 Electron 与真实桌面桥验证两款飘窗的滑块、保存及重新加载。
- Server：Node 24.18.0 下运行 `node --require ./test/support/test-mode.cjs --test test/overlay-floating.test.js test/overlay-settings-service.test.js test/overlay-protocol-contract.test.js`，21 项通过；`npm run docs:check`，53 项通过。
- Server 浏览器：Node 24.18.0、现有隔离 fixture 和独立端口下运行 `node node_modules/@playwright/test/cli.js test e2e/overlay-floating.spec.js --workers=1`，完整文件 11 项通过。边界按 1px 绘制精度验证（`offsetHeight` 与实际绘制存在小数差异），纯几何测试保持 0.001px 精度。
- 客户端静态：`npm run check`，1,452 个 JS 文件通过；界面 detector 未报告问题。诊断用临时 picker 断言与堆栈输出已移除。
- 补充回归：`admin-danmaku-markup.test.js`、`danmaku-overlay-renderer.test.js`、`danmaku-panel-edit-state.test.js` 当次 16 通过、1 失败；失败为并行新增青雾后随机样式计数仍预期 5、实际 6，未扩大本任务修复范围。
- 客户端 `npm run verify:docs` 归档后重跑仍为 9 通过、1 失败，原因是并行任务 `2026-10-11-danmaku-mist.md` 的活动计划状态；当前及历史文档两组链接检查通过。未修改其他任务计划来消除该失败。
- 已核对本任务的双仓差异；两仓 `git diff --check` 通过，桌面测试文件语法检查通过。临时材料位于忽略的 `tmp/` 内，既有及并行任务改动保留。
- 正式服务器及真实直播未部署或验证；所列结果仅覆盖本地工作区与隔离运行环境。旧速度兼容、全域最远位置和在线调节连续性是本记录保留的产品裁决与验收证据。

## Rollback / Done When

只按本任务 diff 撤销新增字段、控件和算法，不重置整个文件或工作区。上述行为及兼容测试通过，说明与实际实现一致，最终差异不含临时截图、运行数据或秘密后完成。桌面检查使用现有独立 Electron fixture 和 tmp 目录，不操作用户运行中的应用。
