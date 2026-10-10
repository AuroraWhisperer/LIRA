# 弹幕渐隐边选择实施计划

Status: Completed

保留原因：记录上下边明确选择与旧 `single` 值的兼容决定，以及跨客户端/服务端的隔离验证证据。当前行为以实现参考和公开直播协议为准。

## 目标与边界

所有固定弹幕样式的边缘处理提供两端渐隐、上边渐隐、下边渐隐、直接切断。明确选择的上/下边不随滚动方向改变。复用现有逐样式参数、草稿、保存和遮罩，不改变布局、消息生命周期、渐隐宽度或随机/飘窗行为。

## 当前行为与所有权

现有 `single` 只能随滚动方向处理移出端。Live `public/js/shared/danmaku-style-options.js`、`src/shared/danmaku-style-options.js` 与 Server `public/overlay/style-options.js`、`src/lib/overlay-style-options.js` 拥有参数校验及有效值；两仓 `motion.css` 拥有遮罩。管理页片段（同时供画布使用）和独立预览消费有效值。

## 兼容与实施

- 扩展已有 `edgeFade` 枚举，新增 `top | bottom`，保留 `single` 读取/保存兼容。有效值层将旧 `single` 解析为当时滚动方向的上/下边；缺失值保持流霞双端、其他样式移出端默认。不迁移持久化，不改变鉴权或租户边界。
- 替换两个界面的单端选项及帮助文案；上下边遮罩显式优先于滚动方向。
- 同步 Server 三份 OpenAPI、公开直播协议、需求/验收，Live 实现参考、流霞规格、参数指南与应用内说明。入口与引导步骤不变，不修改无关说明或历史计划。
- 两仓均有大量已有修改，编辑前将任务相关文件复制到仓库 `tmp/danmaku-fade-edge/before/`；失败时仅逆转本任务增量，不重置用户改动，不提交或部署。

## 里程碑与验证

- [x] 扩展现有参数/协议测试：所有固定样式接受上下边；非法值和非固定布局仍拒绝；旧单端与缺省值兼容。
- [x] 实现参数、界面与两仓遮罩；扩展已有独立预览、保存服务、Electron 画布、浏览器覆盖双向滚动与保存重读。
- [x] 同步文档，完成聚焦检查和最终增量审阅。

计划命令：

```text
Live: node --experimental-vm-modules --test test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-local-preview.test.js test/danmaku/danmaku-style-ownership.test.js test/danmaku/admin-danmaku-markup.test.js test/danmaku/danmaku-overlay-ipc.test.js
Live: node --test --test-name-pattern='prismatic can be selected' test/desktop/danmaku-canvas-electron.test.js
Live: npm run verify:docs
Server: node --require ./test/support/test-mode.cjs --test test/overlay-style-options.test.js test/overlay-settings-service.test.js test/overlay-protocol-contract.test.js
Server: node node_modules/@playwright/test/cli.js test e2e/overlay-style-options.spec.js
Server: npm run docs:check
Both: git diff --check; git status --short
```

Server 使用符合仓库版本限制的已有 `tmp/runtime/node-v24.15.0/node.exe`。Electron 沿用隔离测试夹具，不启动用户桌面实例；服务端浏览器沿用隔离测试数据。

## 完成条件

四个界面选项与上下边实际遮罩一致；明确选择不受滚动方向影响，保存重读和重置通过；旧记录可读；本地与服务端契约一致；相关测试和文档检查通过，增量无无关修改。生产部署不属于本次工作。

## 验证记录

- 扩展后的客户端参数测试先确认 2 项预期失败（不接受 `top` 以及旧有效值仍为 `single`）；实现后客户端聚焦检查 27/27 通过。
- 隔离 Electron 用例 1/1 通过：真实桌面桥保存/重读下边选择，画布预览验证上下边在两个滚动方向的实际 CSS 遮罩、直接切断和恢复默认。截图已检查，测试数据与应用进程由夹具清理。
- Server 参数、持久化服务与 OpenAPI 检查 21/21，完整样式浏览器文件 35/35；其中边缘用例遍历 10 种固定样式、5 个协议值和两个滚动方向，保留各样式渐隐宽度。
- Live 文档检查 10/10，Server 文档检查 49/49；三份 OpenAPI 与编辑前副本结构比较，仅变更各 10 个固定样式的 `edgeFade` 枚举与描述。界面检测无发现。
- 技术参考、协议、规格、需求/验收与用户指南已同步；入口和操作步骤未变，README、交互式引导及架构决策无需修改。
- 无生产部署或真实实播验收；正式来源使用新增值需要同步发布服务端。保留原有未提交修改。
