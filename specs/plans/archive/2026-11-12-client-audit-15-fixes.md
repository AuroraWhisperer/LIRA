# 客户端 15 项审计问题修复计划

Status: Completed

目标：落实用户“直接修复”的指令，修复本轮 C01–C15，保留既有及并行修改，并以相关完整测试文件验证。

本轮报告位于 `D:/Work/lira-audit/client-code-audit-2026-11-12/report.md`；它提供复现证据，当前要求仍以现行规格和参考文档为准。另一份 `2026-11-12-client-audit-fixes.md` 属于并行 F1–F7 任务，本计划不覆盖它。

## 边界与基线

- 延续 Electron + 本机 Node 模块化单体、CommonJS/原生 ESM、现有控制器及测试夹具；不新增运行依赖或通用框架。
- 不提交、推送、打包发布、操作真实账号/运行数据或控制用户客户端。安装数据位置保持已接受的安装目录旁策略。
- 保留账号、房间、连接 attempt、异步请求代次等已有隔离。未变的 HTTP/WS/IPC 输出契约不扩展。
- 临时快照和日志在 `tmp/client-audit-fixes-2026-11-12/`；`before/` 是任务开始时文本副本，用于区分已有修改。不能用整体 checkout/reset 回滚。
- 当前树的 C04/C12/C13 已包含并行修复：核对其完整链路和有效测试，满足目标时只验证，不另写一套实现或重复测试。

## 分工、最小改动与验收

- [x] **桌面账号与安装（C01/C02/C10，desktop 代理）**
  - owner：`src/electron/main.js`、`desktop-auth-controller.js`、`cloud-sync-controller.js`、B 站云同步控制器及现有账号持久化；安装 owner 为 `package.json` 与 `build/installer*.nsh`。
  - 交互登录从开始到完成携带同一 LIRA owner，owner 变化使旧任务失效；B 站待传退出意图按账号持久保存，云端删除成功确认才清除，启动先恢复退出意图再决定拉取。同一 owner 显式重新登录成功可以覆盖自己的退出意图；本次不扩展登录 dirty 的跨进程保证。
  - 安装模式及目标目录需能以普通权限写入安装旁运行目录；不依靠永久提权或擅自搬迁全部存档。
  - 复用 cloud-sync / desktop-auth / installer 现有测试与夹具，分别验证切号迟到、失败后重启、目标权限及升级兼容。同步 `docs/reference/desktop/main.md` 与 `docs/reference/engineering/build.md` 中实际变化的契约。
- [x] **B 站与音乐后端（C07/C09/C11/C12，backend 代理）**
  - `src/server/bilibili-runtime.js` 用当前受保护连接的标准房间 scope 查身份；保持配置切房及账号变化保护。
  - `src/music/qq-client-capture.js` 的 `getLyricState()` 输出已校验采样速率。
  - `src/bilibili/danmaku-client.js` 的当前开播重连失败分支恢复已有房间的 history poller，保留 attempt 检查和退避。
  - 核对已存在的 `src/server/routes/playback-routes.js` 封面转交及 runtime 校验。
  - 完整文件：`queue-random-request.test.js`、`qq-client-capture.test.js`、`danmaku-reconnect-backoff.test.js`，再补直接消费者 `danmaku-client` / `bilibili-runtime` / `external-music-following`。参考文档已准确的行为不重复改写。
- [x] **管理与共享控件（C03/C04/C05/C08/C14/C15，admin 代理）**
  - `settings-operations.js` 删除对已退役 wsStatus 的依赖，使用现有按钮等待反馈和 shutdown 状态通知；核对 `settings-form.js` 的本地绑定已先于远端摘要完成。
  - `ai-assistant-settings.js` 阻止早于当前保存的 GET 覆盖表单；扩展现有保存/读取竞态场景。
  - Node/浏览器 `component-style-parameters.js` 同步补 coffee / sea-breeze / sea-breeze-random 的实际能力。
  - `games-result.js` 的按钮可用状态同步先于赢家去重；`color-picker.js` 组合 RGB 前验证全部参与通道。
  - 完整文件：settings-shutdown-ui、frontend-admin-startup、frontend-admin-ai-settings、component-style-parameters、games-overlay、frontend-color-control。颜色控件沿用隔离 Chromium，按实际输入与 change 结果验证并清理自有资源。
- [x] **播放续播与导航（C06/C13，backend 代理实现、主代理复核）**
  - `public/js/playback/features/radio-mode.js` 的当前电台拥有独立分页进度，补歌沿已读取位置继续，成功与否依据真正加入队列的数量；失败不跳过未读位置，旧会话结果不影响新会话。
  - 在既有首页和队列入口传递实际电台来源页信息，避免首批 50 首与补歌 10 首的窗口不一致；通过既有播放快照保存 `radioOffset`，旧快照默认从 0 开始。网易云按补歌批量换算分页并环回，QQ 沿用 `firstplay=0` 的继续读取语义。
  - 已有 Drawer 修复由 HomeService 的 `canGoBack()` 驱动视图；只验证当前单一历史 owner，不覆盖并行导航改动。
  - 沿用 `test/playback/playback-radio-feedback.test.js` 增加真实 provider + QueueManager 续播回归：100 首可用曲目均能被播放；已有去重结果不得误报恢复。检查 `playback-home-lifecycle.test.js` 的实际导航场景。
  - 同步 `docs/reference/frontend/playback.md` 中电台补量的事实，用户操作未变化时不另写操作指南。

## 验证顺序与关闭条件

1. 按现有审计复现确认当前故障；已有并行修复复用其现有有效覆盖。
2. 分区先集中完成代码、对应测试和契约修订，暂停相关输入改动再执行完整文件。测试期间不修改输入，失效结果不能登记为通过。
3. 主代理收齐本次 touched 清单，对照 before 副本复核；复用输入未变的成功结果，只补直接消费者或失效检查。命令使用 `npm test -- --file=<文件> --list` 查看范围后执行相同文件集合；直接 Node/VM 的完整文件命令同样记录准确范围。
4. 最后执行必要语法检查、`npm run verify:architecture`、`npm run verify:docs` 和 `git diff --check`。不恢复其他任务暂停的完整验收，不以局部通过称为完整发布验收。
5. 15 项均有明确修复/既有修复确认及相关证据，规范和指南影响已核对，最终差异只包含本任务所需修改。真实安装、硬件和平台验收若未进行则明确说明。

失败时先定位实际 owner 和无效输入，只调整任务相关补丁，保留所有其他编辑。最终结果写入独立修复记录，原审计证据不覆写为“修复后”。

## 完成记录

2026-11-12 完成 C01–C15：12 项本轮新增修复，C04/C12/C13 沿用已存在的并行实现并验证。没有新增运行依赖或通用框架。C01 的取消清理交接竞态和 C10 的双安装上下文静默提权分支经交叉复核补齐。

- 29 个相关完整测试文件，最终有效结果合计 366 例通过，零跳过：管理/控件 74，B 站/音乐后端 75，播放 116，桌面/安装 101。桌面合计复用未改变输入的迁移 25 例、卸载 15 例，认证和安装目录/更新分别以最后 47/14 例结果为准；不重复计数多次执行。
- 语法 1,883 文件通过（本轮新跑 21、复用 1,862），架构 29/29、文档 10/10、最终差异检查通过。没有执行或宣称完整发布验收。
- 53 个分区触及文件的最终哈希与交付清单一致，无收尾漂移；独立补丁排除并行文档与组合根 hunk。根目录 `tmp/client-audit-fixes-2026-11-12/` 保存原始结果、修复前文本和分区证据。
- 技术参考、云同步规格/验收、安装 ADR 和实际入门指南已同步；其他用户操作未变，未重复改写指南。
- 真实 Chromium 控件、隔离 Electron、SQLite 重开和编译执行的 NSIS 权限夹具通过；没有真实 B 站/音乐账号、硬件、用户安装或整包升级验收。未提交、推送、打包或发布。

完整交付及逐项证据：[修复报告](D:/Work/lira-audit/client-code-audit-2026-11-12/fix-report.md)。原审计报告保留历史结论。
