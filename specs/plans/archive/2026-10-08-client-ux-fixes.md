# 客户端明确体验问题修复计划

状态：Completed（已确认的直接修复范围）。来源：2026-10-08 用户要求先修能够直接判断的错误，其余产品选择留待讨论；允许子代理并行。其余产品选择列于末尾，不代表已获准实施。

## 目标与边界

修复已审查确认的表单、焦点、筛选和错误恢复问题，让界面明确反映当前状态并保护用户输入。复用现有组件与测试，不改变服务端权限、HTTP/IPC 契约、数据库、持久化格式、实际播放策略或启动清队列规则。

本轮不决定“下一首”应立即播放还是插队，不实现导入去重规则、导航重组、工作台备份或全局关闭草稿协调。开播/画布相关文件已有其他任务改动，先核对现状，避免覆盖或重新实现。

## 当前证据与所有者

此前隔离运行复现了转盘未保存仍按旧配置运行、歌曲草稿覆盖、导出失败不能重试、隐藏播放器可获焦、歌手筛选收缩、网页价格筛选被清空、后台操作失败无反馈及轮询丢焦点。复核发现网页礼物库的部分筛选重置是明确规范，移出直接修复范围；全屏底部可见播放条仍应可操作。审查记录位于根 tmp/ux-audit-20261008-Y8R9re/ux-audit.md。

| 工作包 | 所有者与主要文件 | 验证 |
| --- | --- | --- |
| 桌面编辑与状态 | public/js/admin/songs.js、games-wheel.js、gifts/wishes.js、gifts/export-preview.js | 歌库筛选、礼物导出/许愿相关既有测试，必要时补行为回归 |
| 播放与焦点 | public/js/admin/forms.js、gifts/history.js、public/js/playback/operations/playlist-operations.js、core/event-handlers.js、ui/playback-bar.js、对应 markup | 现有 playback/shared UI/history 测试及隔离 Electron 键盘复现 |
| 网页控制台 | lira-server/public/admin、streamer；必要的 shared HTTP 展示辅助 | 登录/密码重置、admin-streamer-detail、browser-data-flows、song-page-appearance 等受影响文件 |
| 明确文案与保护 | 加班机确认、过期引导、点歌队列术语、开播自动保存反馈；lira-server 公开页面说明与小游戏重置对象 | frontend-overtime、frontend-admin-queue、frontend-usage-guide、frontend-opening-runtime 和对应网页浏览器场景 |

共享文件由单个工作包拥有；所有代理在当前工作树工作，保留用户已有修改。开始前源码快照在 tmp/ux-fixes-20261008-bxAuek/before/，仅用于辨别本轮差异。

## 实施步骤

- [x] 桌面编辑：转盘脏状态禁止开始并提示保存；歌曲/许愿切换前保护草稿；筛选候选不被自身筛选值消除；沿现有导出任务生命周期恢复失败重试。
- [x] 焦点：全屏初始/循环/恢复焦点，收起区域不可交互；避免全局空格抢占原生控件；歌单弹窗/礼物抽屉与源切换控件按已有语义补齐。队列内 Escape 关闭队列并保留全屏，可见点歌通知继续可操作，隐藏时跳过。
- [x] 网页控制台：使用既有 runAction 处理繁忙、防重复和失败；复制失败可手动处理；退出失败不假装成功；状态/轮询保留阅读和焦点；补密码及限流说明。网页外观明确草稿、保存与放弃。
- [x] 独立小修：加班机维持原有重置结果并增加事前确认；修正引导和队列文案；开播自动保存持续反馈并可重试；公开歌单说明复制后发送的步骤；小游戏明确重置对象。礼物库组合筛选与实际重置范围留待产品讨论。
- [x] 汇总：复核代理 diff 与本轮快照，跑受影响检查，复现核心桌面键盘/编辑路径，记录未决定事项及现存验证限制。

## 验证与完成条件

按工作包选择现有 Node/浏览器文件，不默认运行两仓全量。桌面 Node 测试使用 `node --experimental-vm-modules --test <受影响文件>`；服务器沿既有 test-mode 与 Playwright 入口。实际命令、结果和限制完成时写入本文件。

Done when：明确行为得到修复、受影响检查通过或已有外部限制得到说明；没有改变留待讨论的产品策略；业务代码差异经过复核；两个仓库执行 git diff --check 和 git status --short，区分已有改动。不提交、不部署。

## 失败与回退

某项出现产品语义歧义就保留现状并登记待讨论，继续独立工作。若验证出现问题，在拥有模块修复；需要回退时只逐段回退本轮差异，绝不覆盖快照之后的用户工作或执行批量 checkout/reset。

## 修复阶段确认的边界

- F13：lira-server 的 REQ/AC 明确切换背包筛选会清除价格条件，这是一项产品规则选择，本轮不改礼物库筛选。
- F09：全屏歌词下可见的底部播放条与打开的队列属于合法交互区域，焦点范围包含它们，只隔离被遮盖的工作区。
- F22：登录/重置页有极简可见文案要求。本轮改善动态错误与字段提示，常驻说明留待确认。
- F23：盲盒的存储错误还包括配额不足，现有清理分支仍可能清除有效存档。本轮只如实标记“清除存档”；存储恢复与清档确认不在直接修复范围。
- 开播界面复用当前工作树已有的每样式配置与同步实现，只补自动保存反馈和重试，未重写其他任务的改动。

## 实际验证

下列为本轮实际执行记录，不是要求以后每次变更都重跑的清单。

### 桌面定向检查

- `node --experimental-vm-modules --test --test-concurrency=3 test/games/frontend-wheel-draft.test.js test/games/frontend-games.test.js test/songs/frontend-song-editor.test.js test/songs/song-request-form.test.js test/songs/song-library-filter.test.js test/gifts/frontend-gift-export-settings.test.js test/gifts/gift-export-controller.test.js test/gifts/frontend-gift-wishes.test.js`：66/66。最后歌曲取消焦点修复后，完整 `frontend-song-editor.test.js` 2/2 再通过。
- `node --experimental-vm-modules --test test/admin/frontend-admin-layout.test.js test/playback/frontend-playback.test.js test/playback/playback-wesing.test.js test/gifts/frontend-gift-history.test.js test/gifts/frontend-gift-history-recovery.test.js`：41/41。
- `node --experimental-vm-modules --test test/admin/shared-ui-interactions.test.js test/gifts/frontend-gift-history-selection.test.js`：7/7；最终队列 Escape 与通知键盘补丁后，完整 `shared-ui-interactions.test.js` 1/1、`frontend-admin-layout.test.js` 11/11 再通过。
- `node --experimental-vm-modules --test test/playback/frontend-playback.test.js test/playback/playback-queue-behavior.test.js test/playback/playback-state-actions.test.js`：21/21。
- `node --experimental-vm-modules --test test/overtime/frontend-overtime.test.js test/admin/interactive-tour.test.js test/songs/frontend-admin-queue.test.js test/admin/frontend-usage-guide.test.js`：46/46。最后引导文案修正后，完整 `interactive-tour.test.js` 16/16 再通过。
- `node --experimental-vm-modules --test test/overtime/overtime-gift-picker.test.js` 对应 7 项通过。共享 fixture 的契约文件初次被当前 sibling 的版本差异阻断；准备临时的固定提交 `01fb2b47d5e081f5dd559933991ade4819eb3428` 检出，通过原校验后 `overtime-gift-picker-contract.test.js` 3/3 通过，未更改锁定契约或用户 checkout。
- `node --experimental-vm-modules --test test/overlays/frontend-opening-runtime.test.js`：17/17，覆盖等待、保存中继续编辑、失败保留与直接重试。
- `node --experimental-vm-modules --test test/engineering/esm-module-boundaries.test.js`：5/5；`node --check public/js/shared/modal-focus.js` 通过。
- 新增的 `games/frontend-wheel-draft`、`songs/frontend-song-editor` 已加入既有 `scripts/run-tests.js` 的 browser 分组。

### 网页定向检查

- 控制台四个 Node 文件 `browser-http-client`、`admin-live-state`、`admin-password-reset-state`、`admin-surface-boundary` 初轮 45 项通过。新增迟到读取状态场景后，完整 `admin-live-state` 27 项通过。
- 控制台七个浏览器文件 `browser-data-flows`、`admin-streamer-detail`、`admin-streamer-password`、`login-design`、`password-reset-design`、`song-page-appearance`、`song-page-title` 共 93 个不同场景取得通过证据。交叉审阅发现的退出 401 二次确认及旧请求覆盖连接状态已修复；最终受影响的 appearance/data-flows 34 项、detail/data-flows 48 项通过。详细命令和运行目录见根 tmp/ux-fixes-20261008-bxAuek/web-console-report.md。
- `npx playwright test e2e/public-song-header.spec.js e2e/song-request-copy.spec.js --workers=2`，独立端口 65413、run ID `ux-song-help-20261008`：24/24，含 1440/390/320px 的说明可见性、布局和原复制语义。
- 小游戏先查看相同 `verify --plan`，执行 `npm run verify -- --node none` 加七个 `--browser`：`constellation-echo.spec.js`、`spirit-pact.spec.js`、`treasure-house-rules.spec.js`、`offline-games.spec.js`、`blind-box-simulator.spec.js`、`blind-box-presentation.spec.js`、`blind-box-history.spec.js`，独立端口 65413、run ID `ux-game-labels-20261008`。首次 118/119；新增配额错误断言揭示真实清档语义，修正文案后完整 `blind-box-simulator.spec.js` 33/33，其他六文件 86/86 不受最后修正影响。仅更新受按钮文字影响的三个星座截图基线并视觉检查。
- 归档后最终文档检查：桌面 `npm run verify:docs` 10/10，服务端 `npm run docs:check` 47/47。两仓 `git diff --check` 无错误，`git status --short` 已核对；工作树包含本轮及其他任务的修改，未将其混作本轮产出。

### 真实 Electron 与最终检查

使用现有 `scripts/usage-guide-shots/electron-fixture.cjs`：真实 Electron/preload/本机服务/桌面请求授权，所有数据库、用户 profile 和远端回复均为本轮合成夹具。打开前授权 `/license`、`/admin` 均为 200。1280×720 目标窗口的实际内容区域为 1280×722，控件区域无横向溢出。

实际点击/按键验证：加班机默认取消、取消保留倒计时、接受变为目标时长；全屏初始焦点、Tab 循环、原生 Space、收起 inert；礼物抽屉嵌套确认及列表/导出前后恢复；开播保存模拟 503 后重试成功；最终全屏队列 Escape 关闭队列、保持全屏并回到队列按钮。截图和 electron-evidence.json 留于根 tmp/ux-fixes-20261008-bxAuek/。

隔离桌面与浏览器测试进程已关闭，临时契约 worktree 已移除。删除本轮 tmp 运行数据目录的命令被自动审批以 `blocked by policy` 拒绝；保留该目录，未用其他方式绕过。测试截图与修复前快照同样保留在忽略的 tmp/。

所有业务差异已按工作包与本轮前置快照复核，保留其他任务和用户已有修改；未提交、发布、修改真实账号或操作用户运行中的应用。未执行真实音乐账号、B 站或 OBS/直播姬实播验收。

## 产品讨论清单（本轮明确排除）

1. F01：“下一首播放”真正插到下一首，或改名为立即播放。
2. F15：点歌导入是否按请求 ID 跳过已经导入的请求。
3. D01：重启恢复点歌队列，或自动清空。
4. F06/F07：桌面全局草稿退出检查与自动保存/显式保存/场景应用边界。
5. F13：礼物库筛选是否继续沿现行规则清除价格等条件。
6. F23：小游戏资源恢复、历史保留、清档确认和临时存储错误恢复方式。
7. D02：跨功能设置导航归属；D04：工作台本机数据备份和迁移范围。
8. F22：是否改变极简登录/重置页面规范，增加常驻规则说明。

用户可读的修复与建议在根 tmp/ux-fixes-20261008-bxAuek/client-ux-fixes.md；上述建议未写成已接受需求。
