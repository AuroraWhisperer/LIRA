# 恢复第六种固定弹幕样式

**Goal:** 将历史「身份横卡」作为第六种固定位置弹幕恢复，与「直播气泡」并存。

**Architecture:** 新增 `danmakuOverlayStyle=identity`，沿用 `/api/settings` 保存与 snapshot 同步、`/danmaku` 页面和共享消息 renderer。独立 CSS 恢复 `8c4c52c^` 的右侧头像、四档底色和 624×640 等比缩放画布，复用现有缩放计算。

**Tech Stack:** Vanilla JavaScript ES modules、原生 CSS、Node.js `node:test`。

## Non-goals / Compatibility

- 保留 `ranked` 的直播气泡及其他既有选项、默认 `signal`、设置键、网页地址、消息协议与身份判定。
- 不改变数据库格式、授权、头像代理、共享消息组件或 Electron 生命周期。
- 保留工作区既有修改；不提交、分支或发布。

## Current Behavior / Ownership

当前为五种固定位置样式及一种全屏随机样式。Admin 在 `public/js/admin/danmaku-tool.js` 与 `public/pages/admin/toolbox/danmaku.html` 定义选项；`src/server/settings-contract.js` 校验设置值；`public/js/overlays/danmaku.js` 接收快照并渲染。历史 `ranked` 在 v4.0.4 中被直播气泡替换。

契约文档：`docs/architecture/backend/storage.md`、`docs/architecture/frontend/{app,overlays,pages}.md`。路由沿用 `src/server/routes/settings-routes.js`。

## Milestones / Verification

- [x] 扩展既有设置测试接受 `identity`；Admin 测试断言第六个固定选项和共七个选项；CSS ownership 测试纳入独立文件。先验证这些断言失败。
- [x] 在 Admin、服务端白名单、overlay 白名单同步加入 `identity`；固定位置选择器改为六列，保留已有窄容器三列规则。添加 `public/css/overlays/danmaku/identity.css` 并接入 CSS 入口。
- [x] 恢复 600px 等宽、92px 最小高度横卡及四身份色、右侧渐隐头像；兼容当前表情与礼物 DOM。礼物沿用横卡文字排版，不额外添加装饰。
- [x] 同步上述 owner 文档和直接相关帮助文本。
- [x] 运行 `node --experimental-vm-modules --test test/danmaku-overlay-settings.test.js test/danmaku-style-ownership.test.js test/danmaku-overlay.test.js test/danmaku-overlay-renderer.test.js test/danmaku-overlay-fullscreen.test.js test/danmaku-feed-buffer.test.js test/frontend-admin-danmaku.test.js`。查看 `/danmaku?preview=1&style=identity` 的真实样本布局，并对照 `ranked`；使用现有设置路由测试验证保存和广播，不修改真实用户设置。
- [x] 运行 `node --test test/governance-docs.test.js`、`git diff --check`，审查本任务相对修改前快照的 diff 和 `git status --short`。

## Rollback / Done When

若失败，只撤销本任务新增的枚举、选项、CSS 及相关文档/测试改动，对照临时保存的修改前文件保护既有编辑，不使用 reset 或整文件回退。

完成条件：固定位置弹幕第六项显示「身份横卡」，可保存、预览并通过快照同步；四身份横卡布局恢复，原 `ranked` 不变；相关测试通过、文档一致且差异审查完成。

## Verification Results

- 完成。上述七个相关测试文件连同 `test/frontend-usage-guide.test.js`、`test/governance-docs.test.js` 共 40 项通过。
- 初始新增断言先验证为四项失败；实现后全部通过。身份横卡回归覆盖独立选择器、四档底色、右侧头像布局与历史尺寸。
- 在临时数据目录的独立运行时验证：Admin 第六个固定选项可保存；已打开的 `/danmaku` 页面经 snapshot 自动切换为 `identity`。
- 浏览器实际预览五条样本完整可见，头像全部位于右侧，正文无横向溢出；`ranked` 仍为左侧圆头像直播气泡。
- Impeccable 检查仅提示原有发送结果提示条的边框，未改动该无关样式。
- `git diff --check` 通过；相对修改前文件快照审查完成，未引入运行数据、敏感文件或生成素材。
- 当前用户运行的是独立打包版；工作区改动需进入后续构建才能反映到该程序。
