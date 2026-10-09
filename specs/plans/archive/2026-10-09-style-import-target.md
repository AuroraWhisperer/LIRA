# 样式包按入口导入

Status: Completed

## 目标与边界

ZIP 只能从匹配的组件或套装入口导入；不匹配时接口返回 400，并提示正确的「添加组件 → 分类 → 添加样式 / 导入套装」路径。图片、视频、HTML/CSS 的直接添加、已有场景、存储格式及授权规则不变。不提交、不创建分支。

## 当前行为与归属

- `public/js/admin/component-style-library.js` 目前在检查包后自行分类、取消暂存；接口缺少当前入口。
- `src/server/component-style-library.js` 拥有 ZIP 检查和安装；`src/storage/component-style-store.js` 的 `describe` 已拥有按完整历史成员判定套装的规则，直接复用。
- `src/server/routes/component-style-routes.js` 同时服务管理与画布能力入口；`public/js/admin/component-style-api.js` 负责传输。
- 接口合同：`docs/reference/backend/api.md`；用户说明：`docs/guides/component-style-packages.md`、内置 `usage-guide-obs.html`。交互引导入口不变，无需修改。

## 实施与验证

- [x] 接口增加必填 `target`：inspect 查询参数、install JSON 字段；值为组件类型或 `suite`。缺失/无效返回 400。内部库的既有无入口调用保留用于受信安装与测试夹具。
- [x] 检查阶段先通过 `store.describe(pack)` 核对入口，再暂存；失败清理本次暂存。安装在每次授权/重试后重新读取待安装包并核对当前分类，再写入。错误返回正确入口；不以客户端的 isSuite 判断作为依据。
- [x] 前端两阶段发送 `target: type || 'suite'`，移除重复的分类拒绝逻辑，直接展示服务端错误。保留更新包身份确认。
- [x] 在已有组件样式接口测试中覆盖套装误入背景、背景误入套装、组件错类、同类变体、漏传/无效 target、安装再次校验、历史套装缩减成员及失败不落库。在已有浏览器测试中验证入口参数及错误提示显示。
- [x] 同步接口与使用说明；运行 `node --test test/scenes/component-styles.test.js test/scenes/woodland-style-package.test.js test/scenes/component-web-import.test.js`、受影响样式库浏览器测试、`npm run verify:docs`、`npm run verify:architecture` 和受影响文件语法检查。
- [x] 检查任务差异、`git diff --check`、`git status --short`，保留工作区原有未提交修改。完成后归档本计划。

## 失败处理与完成条件

检查失败不写入索引、不留下本次 pending；安装拒绝保留可取消的暂存，不触碰现有版本。若验证失败，定位本次改动原因，仅修正任务拥有的差异。上述匹配、引导、兼容测试通过且文档同步、差异审查完成即结束；不扩展到全量套件或更改授权/存储边界。

## 完成证据（2026-10-09）

- 新的入口回归先在原实现复现失败（无 target 的 inspect 错误返回 200），修改后通过。
- 三个接口测试文件共 48 项：首次 47 通过，单组件弹幕夹具误传 suite；改为 danmaku 后完整 `component-styles.test.js` 20 项通过，其余两文件 28 项已通过。最终差异审查将损坏包/资源错误测试也改为其正确分类，保留原拒绝原因的覆盖；这 3 项定向复跑通过。
- `node --test --test-name-pattern='style libraries|suite management' test/admin/component-style-library.test.js`：2 项通过。
- `node --test --test-name-pattern='canvas suite imports appear' test/admin/canvas-component-suites.test.js`：1 项通过，真实画布套装检查/安装并刷新，未重复渲染。
- `node --test test/desktop/woodland-style-import-electron.test.js`：1 项通过。真实 Electron 在背景入口拒绝全屏礼物感谢包并显示正确路径，无确认弹窗、无安装或 pending 遗留；随后正确入口通过原生选择器正常安装、重复导入和画布使用。
- 8 个修改的 JavaScript 文件语法检查、`npm run verify:architecture`（26 项）、`npm run verify:docs`（10 项）通过。文档门禁最初提示计划状态标签不符合格式，已改为 `Status:` 并通过。
- API、前端职责说明、素材包指南、内置使用文档已同步。背景作者清单、交互引导的入口和参数不变，无需修改。未执行全量套件或打包。
- 已审查任务差异、差异空白检查及工作区状态；已有用户改动保留，未产生需要交付的临时素材、秘密或运行数据。
