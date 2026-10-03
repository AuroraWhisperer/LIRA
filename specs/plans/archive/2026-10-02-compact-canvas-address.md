# 进一步缩短画布地址

**Status:** Completed

## Goal / Current Behavior

用户明确认为上一轮小于 130 字符仍过长。本次将四位端口下完整编辑地址缩至 46 字符：`http://127.0.0.1:3000/c#<22字符随机码>`。现有长路径、组件及尺寸 query 均不再出现在新入口。

## Ownership / Proposed Changes

- `src/server/http-utils.js` 新增 `/c` 页面别名，复用原页面组合、主题和权限处理。
- `component-preview-sessions.js` 的 link/resolve 保存初始选中组件及尺寸；同组控制器按入口组件保留至多五个稳定链接，改变入口不撤销其他入口。
- 新短入口使用 16 个随机字节的 base64url（128 位、22 字符），不使用顺序号或可枚举别名。组件自身凭据仍为 256 位；原管理、Host/Origin、租约、账号/generation 和撤销边界不变。
- `component-preview-dialog.js` 按入口缓存异步链接请求，避免重复点击重复申请；`component-preview-link.js` 读取服务端的入口元数据，兼容旧长链接与 43 字符入口解析。
- 协议表归属 `docs/reference/backend/api.md`，页面入口归属 `docs/reference/frontend/pages.md`。

## Non-goals / Compatibility

不改变正式 `/scene` 直播源地址、持久化格式、组件保存/发布、页面接管或草稿恢复规则。不动其他未提交的主题等工作。旧 `/component-preview` 页面入口继续可用。

## Milestones / Verification

- [x] 服务端短入口与元数据：transport 测试验证 22 字符、重复申请稳定、不同组件入口独立、非法组件/尺寸和撤销。
- [x] 页面别名和消费端：browser/output/recovery 测试验证完整长度不超过 47（五位测试端口）、无 query、原尺寸和组件选择、刷新/旧入口/断开恢复。
- [x] 隔离 Electron 验证外部导航、保存、短地址复用和原鉴权；页面主题别名检查。
- [x] 文档、架构、相关语法检查与最终 `git diff --check`、`git status --short`，完成后归档。

命令沿用现有 `node --experimental-vm-modules --test` 受影响用例、`npm run verify:docs`、`npm run verify:architecture`。本轮不修改 Electron 权限实现，不重复无关完整业务套件。

## Failure Handling / Done When

失败时仅逆向本次修改，保留既有草稿、运行数据和用户变更。新 URL 达到长度约束且上述直接测试通过、协议文档同步、差异审查完成后结束。

## Results — 2026-10-02

- transport/component-preview、transport/client-theme-html、admin/component-preview-links、output、browser、drafts-browser、recovery 合并运行 40 项通过。
- desktop/danmaku-canvas-electron 与 admin/ui-edit-state 合并运行 30 项通过。旧 UI mock 同步为 link 握手，校验实际选择而不再解析已移出的 URL 参数。
- `npm run verify:docs` 9 项、`npm run verify:architecture` 22 项通过；五个改动源文件分别 `node --check` 通过。
- 复用了页面 owner 和现有 relay；无新依赖、数据库或 Electron 权限实现。完整地址四位端口 46 字符，五位测试端口不超过 47。
- 仍为源码修改，未打包发布，也未控制用户正在使用的客户端。保留其他未提交变更。
