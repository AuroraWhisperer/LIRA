# 画布短地址与连接生命周期修正

**Status:** Completed

后续用户要求继续缩短入口，地址长度与入口元数据实现由 [46 字符入口计划](2026-10-02-compact-canvas-address.md) 更新；以下保留本轮历史验证结果。

## Goal

编辑页地址只携带一个短入口能力；客户端仍持有相同控制器时重复打开、网页刷新和短暂断线可以继续编辑。直播场景地址在成功应用后及时显示。

## Current Behavior / Ownership

- `component-preview-dialog.js` 每次打开先撤销全部连接，并将所有组件的 UUID、token、draftKey 序列化进 URL。
- `component-preview-sessions.js` 已支持闲置暂停、原客户端恢复、命令去重和页面接管；沿用这些机制。
- `canvas-overlay-source.js` 只在首次读取、页签点击或窗口 focus 时刷新，未订阅同一客户端中的发布成功。
- 服务协议归属 `docs/reference/backend/api.md`，入口归属 `docs/reference/frontend/pages.md`。测试使用已有内存场景与隔离 Electron fixture。

## Compatibility / Non-goals

- 保留旧长链接解析、组件能力隔离、Host/Origin 闸门、管理鉴权和账号/generation 撤销。
- 短入口使用独立 256 位随机能力，以 base64url 编码，只通过 fragment 与 Authorization 交付；映射随内存会话清理，不改数据库或正式 `/scene` 来源协议。
- 不自动发布未保存草稿，不改变真实客户端数据；保留现有主题等未提交修改。
- 不改变“一次仅有一个页面编辑”的接管规则；旧页可以刷新接管，不重放已接受的保存。

## Milestones

- [x] 短链接：管理端绑定已验证的组件会话，浏览器解析短入口；断开后的同标签刷新仍能用不含凭据的恢复元数据找到本地草稿。
  - 验证：入口长度、错误能力、账号/generation 切换和 revoke；旧链接兼容。
- [x] 会话复用：同一批 controller/generation 重用现有 relay 和短入口，按新入口更新选中组件及尺寸；创建中重复点击不重复注册、轮询或数据订阅。
  - 验证：多次打开、切换入口、旧页刷新后编辑、断线重试、显式关闭停止请求。
- [x] 场景地址：成功发布通知地址模块刷新，失败继续提示未发布。
  - 验证：真实 Electron fixture 中发布前无来源、发布后显示可复制来源且重复打开不结束会话。
- [x] 同步协议文档，审查最终差异并归档计划。

## Verification

直接运行受影响的 transport、preview recovery/browser/output/controller 测试与 `test/desktop/danmaku-canvas-electron.test.js`。
鉴于新增能力协议，补跑 `npm run verify:quick`；不运行无关完整业务套件。
最终 `git diff --check`、`git status --short` 并审查本次文件差异。

## Rollback / Done When

失败时保留草稿与既有正式来源；仅反向编辑本次补丁，不重置其他工作。
以上行为测试通过、文档与实现一致、差异中无真实数据或凭据时完成。测试过程与限制记录在本计划。

## Verification Results — 2026-10-02

- `node --test test/transport/component-preview.test.js test/desktop/danmaku-canvas-electron.test.js`：16 项通过。使用临时目录、内存 SQLite、真实 Electron preload/管理请求鉴权和独立浏览器；发布成功仅请求一次场景来源，失败不显示未发布地址。重复打开的地址相同且小于 130 字符。
- `node --experimental-vm-modules --test test/admin/component-preview-canvas-controller.test.js test/admin/component-preview-registry.test.js test/admin/component-preview-output.test.js`：23 项通过。
- `node --experimental-vm-modules --test --test-concurrency=3 test/admin/component-preview-links.test.js test/admin/component-preview-drafts-browser.test.js test/admin/component-preview-recovery.test.js test/admin/component-preview-browser.test.js`：12 项通过。最后的短入口取消/旧链接兼容补充测试再次单独通过；经 about:blank 完整导航，避免只变更 fragment 的同文档导航产生假阳性。
- `node --experimental-vm-modules --test test/engineering/run-tests.test.js test/admin/component-preview-remote.test.js test/admin/frontend-admin-toolbox.test.js test/songs/frontend-song-board.test.js`：22 项通过。
- `verify:quick` 的文档、全库语法检查通过（1180 个 JS）；架构检查发现新文件的空 catch，修正后 `npm run verify:architecture` 22 项通过，相关语法及浏览器恢复测试重新通过。计划状态格式检查也已修正。
- Impeccable 针对此次 UI 模块的机械检查返回空问题列表；`git diff --check` 通过。
- 未控制用户正在运行的客户端，未打包、发布或连接真实直播间。既有已撤销入口仍需从更新后的客户端重新打开；同账号活跃连接之后可复用和刷新。正式 `/scene` 来源 URL 与持久化格式保持兼容。
