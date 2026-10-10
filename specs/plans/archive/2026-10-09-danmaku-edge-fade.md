# 固定弹幕边缘处理实施计划

Status: Completed

保留原因：记录跨客户端/服务端的新增保存字段、旧样式默认兼容决策和隔离验证证据。当前行为以两仓的实现参考与 overlay 协议为准。

## 目标与边界

固定弹幕的常规参数增加“边缘处理”：两端渐隐、单端渐隐、直接切断。柔彩气泡默认上下两端渐隐，其他固定样式保持已有的移出端渐隐；单端随滚动方向切换。随机及飘窗样式不开放此参数。不改消息生命周期、淘汰规则、租户隔离或样式装饰。

## 当前行为与所有权

- 两仓 `motion.css` 对平滑固定列表使用 32px 移出端遮罩；`starlight.css` 覆盖为 24px。柔彩气泡目前沿用单端处理。
- Live 的 `public/js/shared/danmaku-style-options.js` / `src/shared/danmaku-style-options.js` 与 Server 的 `public/overlay/style-options.js` / `src/lib/overlay-style-options.js` 拥有逐样式契约。
- Admin `danmaku-parameter-view.js` 和独立预览 `danmaku-preview-appearance.js` 消费同一参数契约，保存仍走既有外观草稿及服务器设置流程。
- Server `OverlayStyleOptions` OpenAPI（public/device）及 `docs/protocol/public-overlay-api.md` 是线协议描述；Live `docs/reference/frontend/overlays.md` 是实现说明。

## 契约与兼容

新增可选 `styleOptions.<固定样式>.edgeFade`，枚举 `both | single | none`。缺失时柔彩气泡使用 `both`，其他固定样式使用 `single`；空样式对象恢复默认。随机和飘窗样式拒绝该字段。保留每种样式的原渐隐宽度。旧 PUT 省略 `styleOptions` 保留已有值，不迁移旧数据，不更改契约版本锁。

## 实施与验证

- [x] 在已有契约、设置服务与真实浏览器/Electron 用例中增加默认值、非法值、保存重读、恢复默认和方向切换覆盖。
- [x] 四份合同加入校验和默认；浏览器应用到 `data-edge-fade`，公共 motion CSS 选择遮罩，星语仅声明自身渐隐宽度。
- [x] 常规参数和独立预览增加同一选择框，复用现有草稿和重置；确认随机/飘窗隐藏。
- [x] 同步三份 OpenAPI（public/device/management）、服务端 requirement/acceptance、客户端实现参考、柔彩规格及使用指南。README/新手导览的入口与既有步骤不变，无需重写。
- [x] 运行以下针对性检查，审查任务增量与两仓 `git diff --check`；状态复核随归档收尾执行。

实际验证命令：

```text
Live: node --experimental-vm-modules --test test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-local-preview.test.js test/danmaku/danmaku-style-ownership.test.js test/danmaku/admin-danmaku-markup.test.js test/danmaku/danmaku-overlay-ipc.test.js
Live: node --test --test-name-pattern='prismatic can be selected' test/desktop/danmaku-canvas-electron.test.js
Live: npm run verify:docs
Server: node --require ./test/support/test-mode.cjs --test test/overlay-style-options.test.js test/overlay-settings-service.test.js test/overlay-protocol-contract.test.js
Server: node node_modules/@playwright/test/cli.js test e2e/overlay-style-options.spec.js
Server: npm run docs:check
```

## 失败处理与完成条件

两仓均有其他未提交改动；记录编辑前文件副本到各自 `tmp/`，只逆转本任务增量。使用已有隔离测试，不启动用户正式桌面或连接真实账号。完成条件：三个选项可预览、保存重读、恢复默认；本地与正式来源呈现一致，旧样式保持默认；针对性检查通过、文档一致、最终增量审阅完成。无需提交或部署。

## 验证记录

- 客户端针对性检查 27/27；隔离 Electron 柔彩气泡用例 1/1，验证默认、切断保存重读、画布切换与恢复默认。最终截图等待加载状态结束及第二条合成弹幕后拍摄，已检查控件布局与底部渐隐；未访问真实用户数据。
- 服务端参数及协议 19/19；保存服务 2/2，含租户单次通知、原子拒绝和旧写入保留。首次保存测试因系统 Node 24.21.0 超出服务器支持范围而未启动，改用既有 `tmp/runtime/node-v24.15.0/node.exe` 后通过；后续服务器浏览器及文档检查也使用该运行时。
- 服务端完整 `overlay-style-options.spec.js` 35/35，覆盖十种固定样式的三种模式及双向滚动、星语 24px 和其他 32px 渐隐、恢复默认和随机/飘窗无遮罩。
- Live `verify:docs` 10/10，Server `docs:check` 49/49；计划初稿状态标签不符合现有检查格式，改为 `Status:` 后通过。归档后补跑 Live 文档检查。
- UI detector 无新增发现。两仓 `git diff --check` 通过；三份 OpenAPI 与任务开始副本比较，仅增加 `edgeFade` 字段。技术文档、协议、验收及用户指南同步；无新增架构或入口，ADR/README/新手导览保持有效。
- 未提交、发布或部署；服务端代码需随客户端更新，线上浏览器源才能接收此新增参数。本次未运行真实实播或版本锁门禁。
