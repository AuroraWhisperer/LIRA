# 预览等待中同步画布的发布修复

Status: Completed

## Goal / Current Behavior

v6.1.0 发布审查在 `canvas-gift-components` 复现：已打开礼物感谢画布后，再从客户端预览大航海感谢，新的定位请求没有发出。`syncCanvas()` 取消正在进行的空闲 exchange，重发成功后仍收到原等待的 `undefined`，把成功同步误判为失败。最初 7 文件聚焦检查 34 项，31 通过，另两项场景输出失败正由发布主线程独立排查连接池与模拟桌面环境。

## Scope / Ownership

- 修复 owner：`public/js/admin/component-preview-dialog.js` 的 exchange 串行结果传播；不改变中继 HTTP 契约、20 秒等待、取消及重试规则。
- 消费者：`syncCanvas()`、礼物感谢和导入样式的复用画布定位。
- 覆盖：扩展既有 `test/admin/component-preview-recovery.test.js`，在已观察到的 canvas 空闲请求期间调用同步，保留断线、回执丢失和草稿恢复断言；重跑关联 links 与 canvas 行为。
- 参考：`docs/reference/frontend/app.md` 的预览同步说明；用户操作入口及使用指南不变。

## Compatibility / Non-goals

保留用户现有改动、账号与会话隔离、权限与凭据、画布内容和配置键。只传播真正完成的同步结果，不通过延长超时、降低断言或新建传输协议绕过失败。连接池调查由发布主线程负责，不控制用户桌面、真实数据或上游服务。

## Milestones / Verification

- [x] 增补既有恢复用例中的确定性等待同步复现；修复前确认失败。
- [x] 最小修复并同步技术参考；恢复、links 相关用例通过。
- [x] `node --check public/js/admin/component-preview-dialog.js`、回归文件语法、`git diff --check`、触及差异及状态核对；记录聚焦证据，交给发布主线程统一完整验证。
- [x] 发布主线程处理独立的连接槽问题后，重跑 `canvas-gift-components`，再执行统一完整验收。

## Failure Handling / Done When

失败时保留证据于根 `tmp/`，只修改本任务片段，不回滚其他会话改动。同步不再误报、复用画布行为与既有恢复断言通过、文档一致且最终差异复核后完成；完整发布验收由主线程记录。

## Results

- 确定性复现：既有恢复用例先读取 canvas session ID，编辑画布并观察该 session 的空闲 `waitMs > 0` 请求，再执行 `syncCanvas()`。修复前 0.49 秒失败，错误为「画布同步失败」。根因是 Promise `.finally()` 不会用回调返回值替换原 Promise 的空结果。
- 改为异步串行等待，清理当前在途状态后返回补发同步的 Promise；失败及取消仍由原 exchange owner 处理。
- `npm test -- --file=test/admin/component-preview-recovery.test.js --file=test/admin/component-preview-links.test.js`：8/8，通过断线、丢失回执、草稿、定位及新同步回归；结果 `tmp/test-results/run-g4jbql/results.json`。
- 其他前端消费者 6 文件 20/20：新动效实际发布播放、心动盲盒来源/周期、大航海事件隔离、礼物媒体释放、管理页运行时与共享外观；结果 `tmp/test-results/run-rXqRsy/results.json`。
- 两份 JS 语法与 `git -c core.safecrlf=false diff --check` 通过；技术参考同步，用户操作和指南不变。
- `canvas-gift-components` 的两项输出超时另有 HTTP 连接槽证据：API 返回正确，iframe 保持 interactive、脚本尚未下载；只关闭编辑页即由超时变成 1.63 秒通过。主线程已接手模拟桌面、外部编辑页和输出页的连接隔离对照与修复；不能据此削弱内容断言或只延长超时。
- 未执行完整验证、真实直播或发布；这些由发布主线程继续。

## 范围更新：合并预览等待

2026-11-06 发布复核确认第二项产品缺陷：同一个画布页面为每个组件维持 20 秒 read，桌面为每个组件维持 exchange；五条空闲读取与场景 SSE 可占满同源 HTTP/1 连接，导致新场景 iframe 模块无法加载。仅为模拟桌面创建独立浏览器 context 后，两项原集成测试仍在原位置失败（`tmp/test-results/run-SiHOKu/results.json`）；只关闭编辑页面则恢复，不能通过改夹具或增加超时处理。

### 最小方案与所有权

- 在现有 `/api/component-preview` 增加只供空闲等待的 `read-batch`、`exchange-batch`。请求 `{action,entries,waitMs}`，每项保留单条请求的会话身份、attachment、revision 与 ACK；响应 `{updates:[{id,...原单条结果}],waitMs}`。任一成员变化即结束整组等待。单条读写、命令、保存、公开页面 URL 与持久化均不变。
- 服务端 `component-preview-sessions.js`、路由及传输测试拥有逐项鉴权、非空/唯一/有界成员、取消和换 owner/attachment 的全部等待释放。每条浏览器项必须证明自己的 token，桌面批量仍验证原桌面会话；批量不接受 state/display 写入，不扩大原请求字节预算。
- 前端新增 `component-preview-poll-batch.js`，在同一个窗口合并在途空闲请求；新成员加入或成员取消时中止旧等待并重组，其余调用继续等待。网页 `component-preview-page.js` / `component-preview-remote.js` 和桌面 `component-preview-dialog.js` 各持有一组；只有 `waitMs > 0` 走批量路径。
- 不引入服务、依赖或新的订阅通道，不改等待上限，不用高频短轮询替代。保留各组件草稿、命令编号、回执、错误恢复与前述同步 Promise 修复。
- 同步后端 API 和前端实现参考；用户入口及操作步骤不变，用户指南无需新增步骤。

### 验证与失败处理

- [x] 服务端验证：任意成员变化唤醒；逐项权限及 attachment；重复/超量/非法请求；请求取消、撤销及 owner 变化清理；单条兼容。
- [x] 客户端验证：同窗只保留一条等待、加入/取消重组不丢 Promise、dispose 清理；复用恢复/定位与画布业务断言。
- [x] 原 `canvas-gift-components` 同浏览器预览与输出全部通过，不放宽内容、子请求或时限断言。
- [x] 所有代理停止修改后冻结输入，运行一次 `npm run verify`，包含真实 NSIS 场景；若失败按发布指南集中定向处理后再验收。
- [x] 最终检查差异、`git diff --check`、状态及无运行数据/秘密，完成版本说明；提交、推送与 `release:win` 由发布指南继续执行。

失败时保留已有合成复现，不发布未验收输入；只撤回本任务片段，不重置现有改动。完成条件为上述回归及完整发布门禁通过，边界与文档一致；真实直播软件和 CDN 同步继续如实列为外部验收。

### 合并后的聚焦证据

- 服务端 transport/renewal 40/40（`run-bc7wcS`），新增四项批量回归修复前失败；HTTP 等待中撤权仍返回 423，退出不等待轮询期限。
- 批量客户端与既有 remote 13/13（`run-GStNYy`）；恢复、定位和共享画布消费者 15/15（`run-TE2Gfr`）。五组件空闲两秒只观察到一条请求，原保存排空、丢回执和迟到选择断言保留。
- 原同 context 的 `canvas-gift-components` 三项全部通过（`run-FiP1bx`）：心动盲盒、冲刺真实输出，以及礼物/大航海不同图层的预览、保存和事件分流。未拆开 context 或修改内容断言。
- 关联测试同步：无效来源由本地校验阻止发布，改为观察焦点返回无效输入；发布回执展开批量结果。来源与拖拽两文件 15/15（`run-ESEPWE`），负坐标发布和重载断言保留。
- 许愿用例遵守已接受的参数审计和组件指南，使用三条已保存合成许愿，保留 1→3→1 自动高度、图片、真实进度与发布断言；目录请求为零。慢回执只阻塞实际新增图层的同步，避免误抓 20 秒空闲请求；两项 2/2（`run-6VaUrx`）。

## 完整验收首轮与媒体队列缺口

冻结输入后执行 `npm run verify`：10 份服务器契约和 1,756 个 JS 文件语法通过，独立原生检查 5/5；主测试 5,112 项中 5,110 通过、2 失败、0 跳过（`run-zKV2rQ`）。验收起止路径及 SHA-256 清单一致，没有运行期间修改被测文件。

- `resource-style-settings-electron` 的航海旗帜仍找旧“调整样式”按钮。当前已接受的资源样式指南要求直接完整设置条目并展开“外观设置”；只改用例操作，保留原生参数、失败草稿、独立保存及重载断言，真实 Electron 2/2 通过（`run-xkO13s`）。
- `component-style-library` 的媒体礼物夹具先仍使用旧 `woodland-bloom` 事件；改为真实 `imported` 主题和目标 `styleIds` 后仍确定失败（`run-JhKRGL`），确认还有产品缺口：组件分流通过后，`gift-frame-queue.js` 的主题白名单仍拒绝 `imported`。
- 最小修复在播放队列 owner 接受已定义的导入主题，核对全部消费者；复用实际图片/视频播放及去重、reset、opening 生命周期回归，不更改已有林间花信或旧独立 WS 的交付边界。此前分流 helper 测试不能代替实际队列播放。
- 所有已知失败修复并定向通过后才再次完整验收；本轮不是并发偶发失败，不以孤立重试或延长时间解决。
- 第三项产品缺陷仅在队列主题白名单新增 `imported`，媒体夹具使用当前样式身份，原 FIFO 用例纳入导入主题；全部队列消费者已核对，旧 WS 和林间花信播放器的边界保持。实际媒体、队列和场景事件 19/19（`run-oDZ84N`）通过；正确事件但未修队列时仍在 10.2 秒失败，修复后实际图片、视频及生命周期通过。
- 两个完整验收失败文件合并复测 11/11、0 跳过（`run-C3JjOL`），包含真实 Electron。全部已知失败已有对应修复及定向证据，再次冻结输入运行完整门禁。运行时为官方 `latest-v24.x` 的 Node 24.22.2，缓存 ZIP 的 SHA-256 与官方清单一致。

## 最终验收与交付边界

最终 `npm run verify` 通过：10 份固定服务器契约、1,756 个 JS 文件语法、5,112 项主测试及独立 5 项 Windows 原生检查全部通过，0 失败、0 跳过；包含文档、架构、真实 Electron 与原生 NSIS 安装/迁移/卸载。结果 `tmp/test-results/run-8W90NK/results.json`，实时日志 `tmp/release-6.1.0/verify-final.log`。起止 516 个变更路径和 SHA-256 一致，没有边测边改。

基线为 `v6.0.2`（`7900fe4f`），版本及说明已准备为 6.1.0。此次确认并修复同步结果丢失、预览等待占满 HTTP/1 连接、导入媒体队列拒绝主题三项产品缺陷；旧测试按当前契约和界面步骤同步，未延长超时或削弱业务断言。技术参考同步，用户操作未新增；已有新功能指南一并纳入发布差异。归档仅调整此记录和索引，另运行文档门禁；不使已冻结的生产代码验收失效。

本计划完成本地修复及发布准备。正式安装包构建、最终验包、Git 提交和 GitHub 标签/附件交付由发布指南接续；CDN 原名 EXE/新旧 blockmap/latest.yml 手工同步、真实 OBS／直播姬播放及旧客户端实机升级仍属于独立验收，不以合成测试或 GitHub 发布代替。
