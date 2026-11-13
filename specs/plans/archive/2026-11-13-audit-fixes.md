# 2026-11-13 审计问题修复计划

Status: Completed

依据：用户要求修复本轮审计确认的 13 项问题；历史证据见仓库根 output/lira-code-audit-2026-11-13.md。

## 目标与边界

修复 AUD-01–13 的可达失败场景，保留现有公开接口、存储格式、认证隔离和用户的并行礼物修改。继续使用当前模块 owner、原生 JS/CSS、现有 Node/Chromium/NSIS 测试；不新增依赖、服务或通用框架。此次不提交、不打包发布、不操作真实账号/数据或正在运行的桌面实例。审计中的未确认观察不在修复范围。

## 当前行为

已执行隔离复现，确认安装器误删混合目录、备份预算不一致、编辑/播放/转盘迟到回执、撤回 SC 继续命令分发、下载 Promise 未处理、重启与安装双动作、WeSing 重试及监视器恢复遗漏、盲盒来源校正遗漏、原生 modal 颜色输入阻断和 IPC warning 丢失。现有测试没有覆盖这些具体组合。测试固定 server 使用 tmp/code-audit-2026-11-13/server-contract，不修改相邻用户 checkout。

## 所有权、修改和验证

### M1 安装目录安全（AUD-01；storage_scenes_audit）

- Owner：build/installer-per-user.nsh、installer-uninstall.nsh 及相关安装宏；消费者为首次安装、升级与卸载。
- 首次安装拒绝非空未知目录；卸载只删除明确归属的应用资源，保留混入的未知文件；兼容已有合法安装、data/logs/updates 与旧版升级路径。
- 回归扩展 test/engineering/installer-directory.test.js、installer-uninstall.test.js 及需要的 migration/update 现有夹具，真实合成目录确认外来文件保留。
- 文档 owner：docs/reference/engineering/build.md 及相关安装/卸载指南，按实际行为同步；不操作用户安装目录。

### M2 桌面更新、warning 与 modal 颜色（AUD-05、06、12、13；music_audit）

- Owner：src/electron/update-manager.js、desktop-lifecycle.js 与现有组合处、ipc/dynamic-lottery-auth-ipc.js；public/js/shared/color-picker.js。
- 消费嵌套 downloadPromise 的失败；普通重启在更新已就绪时只安排一个最终动作并保留播放排空；透传既有公开 warning；picker 跟随活动 modal 输入归属。
- 回归扩展 update-manager、desktop-update/lifecycle、动态抽奖 IPC 和 frontend-color-control 既有测试；使用隔离浏览器证明 dialog 内及退出后均能改色。
- 文档 owner：docs/reference/desktop/main.md、auth.md；颜色仅恢复既有操作，检查是否存在需要同步的具体说明。

### M3 歌词恢复与撤回准入（AUD-04、07、08；bilibili_ai_overtime_audit）

- Owner：src/music/wesing-capture-engine.js、wesing-monitor.js；src/bilibili/danmaku/message-handlers.js、src/server/bilibili-client.js。
- 无本地缓存也沿用已有在线歌词退避；监视器异常退出后手动检测可有界恢复；已撤回 SC 的拒绝阻断后续新增命令，不改变普通重复消息及已接纳歌曲语义。
- 回归扩展 test/wesing/wesing-capture-refresh.test.js、wesing-lifecycle.test.js 和 test/bilibili/bilibili-superchat.test.js/相关入口套件；验证请求次数、停止后无重启及撤回先到顺序。
- 文档 owner：docs/reference/backend/music/wesing.md、backend/bilibili/gift.md。上游与真实客户端版本不做在线验收。

### M4 备份与前端状态顺序（AUD-02、03、09、10；主对话；AUD-11 委派 music_audit）

- Owner：src/fans/profile-transfer.js、profile-service.js、public/js/admin/fans/transfer-ui.js；public/js/playback/features/playback-controls.js；public/js/admin/games-wheel.js、gifts/blindbox-stats.js、blindbox-analysis.js 及既有 state 事件边界。
- 统一完整备份导出/恢复预算，不能把不可恢复数据作为成功备份交付；保留身份/事务/恢复点保护。合并预览沿用 beginIntent；音质响应采用最新播放位置；spin 回执遵循广播顺序；盲盒源和重连失效旧结果。
- 回归扩展 fan-profiles-transfer、frontend-fan-profiles、playback-quality、frontend-wheel-draft、frontend-gifts/frontend-blindbox-admin 现有套件；覆盖实际失败行为而非源码扫描。
- 文档 owner：docs/reference/backend/storage.md、desktop/preload.md、frontend/app.md、frontend/playback.md 及粉丝使用说明。storage.md 与 app.md 已有用户改动，仅修改任务相关段落。

### M5 全量暴露的旧数据迁移发布失败（storage_scenes_audit）

- 第二轮全量中真实 Electron 在完整旧数据复制后的目录发布返回 EPERM，同轮其余 5682 项通过。失败安全停止并保留源数据，但阻止启动；未确定具体持有句柄的进程，不将其归因于特定安全软件。
- Owner：src/electron/desktop-user-data.js。复用同文件 Chromium 分区迁移已有的 5 次、50/100/150/200ms 有界重命名重试，只处理 EPERM/EBUSY；不重复复制，目标已出现立即停止，源实例锁持有到发布结束，永久失败保留原安全停止行为。
- 扩展 test/desktop/desktop-user-data.test.js 的现有迁移测试并执行真实 Electron 并发验证；独立复核数据安全，更新 desktop/main.md 相关事实。测试断言及全套并发范围不放宽。

## 兼容与协调

- 各组只编辑分配的源码/测试；共享文档修改前与主对话协调，主对话负责计划及索引。保留已有 staged/unstaged 内容。
- 备份限制需在读取 owner 后确定一致预算，不能仅把前端阈值调大或取消全部保护；不改变既有备份格式。
- 安装器旧版本卸载行为须特别核对，新增准入不能被当作已解决既有混合目录的删除。
- 所有测试使用现有隔离夹具和 tmp；不清理上轮被策略拒绝的临时目录。

## 验证与完成条件

- [x] 各组先用现有套件/审计复现确认失败，再完成最小修复并通过对应回归；记录准确命令及结果。
- [x] 主对话复核各组 diff、覆盖遗漏和技术/用户文档同步；所有 13 项有实现与证据映射。
- [x] 全部代码及当前文档停止编辑后执行 npm run verify:docs、npm run check、npm run verify:architecture。
- [x] 使用隔离固定 server 执行 npm test -- --require-full；运行前后哈希核对，不在套件期间修改文件。若失败先集中诊断并聚焦验证，再决定重跑。
- [x] 最终 git diff --check、git status --short 与任务 diff 审阅通过；无真实数据、秘密或生成物进入源代码差异。
- [x] 计划记录验证结果和真实发行/账号/硬件限制；完成后按 PLANS.md 归档，说明正式测试、契约与用户指南同步结果。

## 实施记录

- AUD-02 保持现有 16 MiB / 10000 份外部备份支持范围，导出按实际美化 JSON 的 UTF-8 字节预检；超限明确停止导出，避免交付不可恢复文件。恢复请求为确认摘要等封套额外留 1 KiB；内部恢复点不经过新增的外部文件字节门。
- M4 粉丝备份/编辑意图/音质进度的 3 文件 79 项通过，转盘 Chromium 4 项通过；独立复核未发现阻断问题。AUD-11 委派 music_audit，state/盲盒摘要/分析的 3 文件 23 项通过，独立复核确认隐藏与关闭不产生多余请求，旧来源响应不能回填。
- M3 首次回归 5 项失败，修复后扩大到直接消费者发现一次重复 monitor.start，已在 owner 修正；最终 12 文件 130 项通过，无跳过。无本地缓存仍使用已有歌词退避，不新增轮询器；已撤回 SC 明确拒绝后阻断新增命令。
- M2 初版 6 套件 73 项通过；独立复核使用实际 NsisUpdater 确认同步最终退出会截断 EACCES 的异步 elevate 回退。现已用固定一轮 setImmediate 交接修正，仅安装动作启用，不引入任意 Promise 或新计时器；实际更新库在正常排空和截止触发下均先完成启动回退/退出事件再最终 exit。60 项相关桌面回归通过，无跳过。
- M1 先确认未知非空目录及个人文件误删的红灯；新增真实 builder 调用顺序回归发现活动 CHECK_APP_RUNNING 宏内部不能替换 uninstallOldVersion，改用 build/nsis/installUtil.nsh 顶层 include 适配。新包安全卸载器覆盖同目录/换目录/登记变化/启动失败；安装前拒绝 resources/locales 及子树的重解析点与不可读取目录，避免保留的链接影响后续解包。最后 5 文件 61 项通过，无跳过；目录专门回归 2 项通过。
- 独立固定服务器契约门禁 npm run verify:contracts 已通过全部 10 份 fixture，使用仓库锁定的 67119e81a3f5f49470ed2b191f6552556d0a704e。
- 全局首轮门禁通过：文档 10/10，架构 30/30，语法 1896 文件（36 本次执行、1860 复用相同内容的有效校验记录）。首次完整测试执行 685 文件 / 5683 项，5679 通过、4 失败、无跳过，耗时 206.51 秒；前后 3647 路径哈希完全一致。失败集中于三文件：粉丝视图旧夹具缺少 beginIntent；新卸载文件清单通过 require('electron') 读取路径，触发运行时分组门禁；audio-multiple 的双原生进程共享追加日志出现计数竞争，正在定位并发复现。先集中修正和聚焦验证，再重跑全套。
- 粉丝视图夹具补齐既有 beginIntent 注入，未改变渲染/转义/合并策略断言；frontend-fan-profiles-view 与 frontend-fan-profiles 共 49 项通过。
- 安装器文件清单改为通过 require.resolve('electron/package.json') 定位 dist，不加载 Electron 运行入口；原运行分组规则与严格断言未变，installer-uninstall + run-tests 共 32 项通过。
- audio-multiple 在不改业务和时序的 12 个原生并发场景中复现一次共享日志丢行，退出/备份断言均通过。夹具改为按真实 PID 分别写入退出记录，保留逐进程收到一次事件的断言，生产进程控制未改；原 27 场景与 12 次 stress 两文件同时运行，文件并发 8、各自场景并发 3，41 项通过、0 失败/跳过，耗时 58.4 秒。首次全量的三处根因均已明确并有聚焦通过证据，所有编辑再次冻结，开始第二次完整测试。
- 第二次全量执行 685 文件 / 5683 项，5682 通过、1 失败、无跳过，192.03 秒；3647 路径前后哈希一致。首轮三处失败全部解决。唯一失败为真实 Electron 主数据迁移的目录重命名 EPERM，已明确为发布未沿用同 owner 有界重试的可靠性缺口，按 M5 最小修复；不以重复全套碰运气。
- M5 的 4 个发布边界场景先出现 2 个预期失败，复用已有私有发布策略后通过；旧数据 Node / 真实 Electron / 启动数据共 29 项通过，另对原真实 Electron 用例进行 8 路并发，16 项通过且断言不变。永久失败仍停止，目标竞争不覆盖，最多等待 500ms 且复制一次；仅主数据迁移获得已有分区的重试能力，没有修改磁盘格式或用户步骤。
- 最终完整验证：`LIRA_SERVER_ROOT=tmp/code-audit-2026-11-13/server-contract npm test -- --require-full`，685/685 文件，5687/5687 通过，0 失败/取消/跳过/todo，192.29 秒；日志 tmp/audit-fixes-2026-11-13/full-3.log，结构化结果 tmp/test-results/run-E6thOA/results.json。运行前后 3647 个维护路径哈希一致，HEAD 未变。此前两次完整运行的失败原因、最小修正和聚焦证据均在上文保留。
- 最终全局门禁：文档 10/10、架构 30/30、固定版本服务契约 10 份通过；1896 个 JavaScript 文件语法通过（最终重检 2 个变更文件，其余复用内容一致的有效记录）。任务差异及新源码已复核，git diff --check 通过。当前完整结果基于未提交工作区，保留用户礼物样式等并行改动。
- 同步结果：正式测试扩展到真实失败组合，安装/备份/桌面/音乐/前端技术参考已同步；安装、卸载和粉丝备份用户说明更新。其余修复恢复现有操作，没有新入口、配置或视觉布局，因此导览与截图不变。
- 完成原 AUD-01–13，并额外修复全量验证暴露的主数据迁移发布问题。交付报告为仓库根 output/lira-code-audit-fixes-2026-11-13.md；历史审计报告保留修复前证据，并指向该报告。归档只整理完成证据，不再修改已验证业务代码。

## 验证边界

使用合成数据、隔离 Node/Chromium/Electron/NSIS 夹具和固定服务契约，不操作真实账号、真实安装目录或用户正在运行的应用。未执行正式签名安装包的旧版升级或真实 B 站/WeSing/OBS/直播姬持续实播验收；不提交、打包或发布。现有安装版只有使用后续新包升级后才获得安装器保护。未知旧程序残留保守保留，外部粉丝备份继续支持 16 MiB / 10000 份，超限明确拒绝导出；没有宣称支持更大的备份。

## 失败处理

遇到权限/策略拒绝遵守限制；不绕过。实现失败时按本任务基线和逐文件差异撤销自己的变更，保留用户并行内容，禁止 reset/blanket checkout。无法验证的真实安装、账号或硬件条件明确列出，不伪报为执行通过。
