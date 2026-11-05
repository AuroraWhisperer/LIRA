# 点歌板结果提示实施计划

Status: Complete

## 目标与范围

所有内置点歌板及复用队列渲染器的资源样式，在顶部显示「点歌人 点歌 歌名 成功/失败」。成功为浅绿底绿字，失败为浅红底红字；字号、内边距和高度随当前主文本变化。提示保留四秒，新结果替换旧结果。普通聊天、取消点歌和页面初次加载不弹提示。

不调整点歌规则、队列排序、持久化、登录或远程服务器契约，不新增配置项和连接。

## 当前行为与归属

`src/music/queue-service.js` 拥有队列，`src/server/domain-services.js` 组装入口。弹幕/SC 的成功和拒绝结果由 `bilibili-message-handler.js` 返回，目前只有成功触发快照。手动添加由 `queue-routes.js` 接入。`overlay-projection.js` 与 `scene-components.js` 将队列交付给独立来源和场景，前端 `queue.js` 统一驱动六套样式，`queue-theme.js` 映射各样式字号。

技术契约归属：`docs/reference/backend/music/services.md`、`docs/reference/backend/ws.md`、`docs/reference/frontend/overlays.md`。用户说明归属：`public/pages/admin/toolbox/usage-guide-song.html`；交互引导入口不变。

## 实施与验证

- [x] 队列 owner 保留一条带唯一 ID、时间和展示文案字段的临时结果，补充只含展示字段的投影；接入观众弹幕/SC、随机与手动点歌，拒绝结果也通知现有链路。验证队列 owner、B 站入口与投影相关测试，确保拒绝不写队列、普通聊天不发新结果。
- [x] 在队列面板加入独立提示节点，复用当前样式字号和字体；按结果 ID 去重、按绝对过期时间隐藏、初始快照不重放，卸载清理计时器。验证前端结果状态流与既有队列测试，并通过隔离浏览器源查看六套样式、长文本和字号变化。
- [x] 同步技术参考和应用内说明；运行 `npm run verify:docs`、受影响模块边界检查、`git diff --check`，检查最终任务 diff 和 `git status --short`。无关全库门禁失败详见验证证据。

## 兼容与回退

队列快照仅增加可选 `requestResult`，不修改旧字段、设置键、鉴权或持久化。结果在本次运行的队列 context 中存活，页面刷新不补播旧提示。保留当前工作区的其他修改，失败时只用定向补丁撤回本任务内容；临时 QA 文件放在根目录 `tmp/`，仅关闭本任务启动的夹具和浏览器。

## 完成条件

成功/拒绝均能到达独立来源和场景；所有内置风格使用当前主文字号显示提示；不因普通状态刷新重复弹出；相关检查、文档同步和最终 diff 审查完成。真实 B 站、OBS/哔哩哔哩直播姬实播与打包不属于本次隔离验证。

## 验证证据

- 八个直接相关测试文件 94/94 通过，结果在 `tmp/test-results/run-YiPgPh/results.json`。包含结果过期/替换、拒绝不入队、普通聊天与取消不创建结果、文本安全、初始快照不重播、重复快照不续时、卸载计时器清理，以及既有随机请求、场景投影和通知回归。
- 隔离 CUA 浏览器预览确认六套风格的绿/红提示；主字号从 22px 调为 36px 后提示随之变化。经典风格使用最终的歌曲字号，实际测得歌曲与提示均为 14px；长歌名换行后完整显示，提示层高于标题和装饰。截图位于 `tmp/queue-request-notice/`，夹具服务已关闭。
- 七个修改的 JavaScript 模块通过 `node --check`；`git diff --check` 通过。Impeccable detector 的五项提示均属于原有字体、边条或滚动样式，本次按用户截图保留提示边条。
- `npm run verify:architecture` 为 27/28；既有未跟踪文件 `public/js/admin/client-settings.js` 的空 catch 被门禁拒绝，不属于本任务修改。
- 文档链接、计划状态和归属检查通过；`npm run verify:docs` 验证时为 9/10，其他工作同步新增的 `GET/POST /api/now-playing/config` 尚未登记到 API 文档，导致全库接口文档门禁失败。本任务无新增 HTTP 路由。已同步点歌队列、WebSocket 原因、点歌板参考与应用内说明；没有新增操作入口，引导及既有静态操作截图无需改动。
- 保留工作区其他修改，未提交、分支、打包或发布。
