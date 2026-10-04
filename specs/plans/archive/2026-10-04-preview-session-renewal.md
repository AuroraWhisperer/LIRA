# 画布预览在正常授权续期后保持连接

**Status:** Completed

## Goal / Current Behavior

用户持续编辑时，后台正常 token 续期不能撤销画布连接。当前 `server.js` 把
`getSceneOwner` 的 authorization epoch 用作预览 owner；license manager 每次认证成功
都会增加该 epoch，中继下一次读取或交换因此删除会话，网页变为只读恢复视图。

## Ownership / Design

license manager 已有内部 `lifecycleGeneration`，正常续期保持不变，bootstrap、激活、
阻断清理和 dispose 会改变它。增加只供主进程使用的 `getAuthorizationGeneration()`
读取方法。`scene-cloud-controller.js` 在现有可信 owner 校验旁增加
`getComponentPreviewOwner(manager)`，沿用 origin/streamer scope，把 epoch 绑定到该代际。
main 注入独立 `getPreviewOwner`；server 优先使用它，保留非桌面注入的既有 fallback。

## Compatibility / Non-goals

不改变 token epoch、其他消费者、IPC/HTTP 形状、草稿格式或正式场景来源。
仍检查当前授权、账号 scope、控制器 generation、页面接管和显式 revoke。
不续活撤销的能力、不自动保存发布、不修改或重启用户运行中的安装版。

## Milestones / Verification

- [x] 用真实 license manager 合成身份和现有预览中继复现：定时续期后旧链接、读取和命令仍有效；修改前因 410 失败。
- [x] 添加并接线可信预览 owner，验证正常续期稳定；重新登录、换账号、撤销和 dispose 使旧连接失效。
- [x] 隔离 Electron 场景覆盖连续两次续期后刷新、继续编辑及保存，使用现有 fixture 和内存数据库。
- [x] 更新 `docs/reference/backend/api.md` 和 `docs/reference/desktop/auth.md`，记录准确生命周期。
- [x] 运行直接受影响的 license、scene owner、preview transport/recovery 测试和隔离 Electron 画布测试；运行 `npm run verify:quick`，独立模块体积失败见下。
- [x] 审查任务差异、`git diff --check` 和 `git status --short`，记录结果并归档。

## Failure Handling / Done When

只反向修改本任务补丁，保留此前草稿恢复修复和其他未提交工作；不 reset、不处理真实数据。
续期后的编辑测试、身份隔离测试及上述检查通过，文档一致且差异不含凭据/运行数据后完成。

## Verification Results — 2026-10-04

- `node --test test/transport/component-preview-renewal.test.js`：初始复现为正常续期后短入口返回 410；修复后的六项测试覆盖续期、待确认命令、重登、换账号、撤销、dispose 和无效代际。
- `node --test test/transport/component-preview-renewal.test.js test/transport/component-preview.test.js test/scenes/scene-cloud-controller.test.js`：新增校验用例前 59 项通过；新增校验后与 Electron 一起重跑 7 项通过。
- `node --test test/desktop/danmaku-canvas-electron.test.js test/transport/component-preview-renewal.test.js`：7 项通过；真实 Electron preload/鉴权、外部浏览器和内存数据库，连续两次续期后仍可刷新、修改并保存发布。
- `node --experimental-vm-modules --test --test-concurrency=4 test/license/license-manager-renewal.test.js test/license/license-manager-identity.test.js test/license/license-session-boundaries.test.js test/license/license-manager-revalidation.test.js test/license/license-resume.test.js test/admin/component-preview-links.test.js test/admin/component-preview-recovery.test.js test/admin/component-preview-drafts.test.js test/admin/component-preview-drafts-browser.test.js`：69 项通过。
- `npm run verify:quick`：文档 10 项与 1212 个 JavaScript 语法检查通过；架构 21 项通过，模块体积一项失败。逐项复核新增 getter/组合根各一行仍属于既有职责，在模块登记中记录理由与新上限；重跑 `npm run verify:architecture` 后唯一失败为无关的 `public/css/admin/toolbox/fan-profiles.css` 648 行超出登记的 647 行，本任务未修改该文件。
- 保留此前草稿修复和其他工作区修改。未更新、重启运行中的安装版，未发布安装包；已失效页面需要从客户端重新打开，永久修复需包含本补丁的客户端版本。
