# 点赞、分享与关注感谢实施计划

Status: Completed

用户要求三类互动各自具备开关与词库；源码交付、定向回归、隔离桌面验证、文档同步和最终审查完成。

## 目标与边界

在桌面「弹幕互动 → 欢迎答谢」加入三项独立控制，提供可编辑默认文案；云端只在收到本房间可识别观众的个人互动后随机选择对应词库发送。复用已认证 RoomMonitor、租户云设置和统一发送队列，不新增连接，不更改累计点赞、进场欢迎或礼物答谢。不提交、部署或操作真实账号。

## 当前实现与所有权

- Server `src/lib/bilibili-entry.js` 已解码 INTERACT_WORD/V2，但只返回进场；LIKE_INFO_V3_CLICK 尚未进入答谢链路。
- Server `src/lib/fixed-reply-settings.js` / `streamer-sync-settings.js`、`cloud-settings-store.js` 拥有配置与租户持久化；FixedReplyService 及 RoomEventHandler 拥有实时触发与本场取消。
- Live `src/shared/fixed-reply-contract.js`、既有 license fixed-reply IPC 和 display-settings-protocol 拥有窄参数与公开投影；Admin 复用词库编辑弹窗及现有样式。
- 契约：Server fixed-replies.md、两份 OpenAPI、fixture、需求与验收；Live desktop/main.md、preload.md、frontend/app.md/pages.md；用户指导在 usage-guide-danmaku-replies.html。

## 设计与兼容

新增 like/share/follow 各自的 ThanksEnabled（默认 false）和 ThanksMessages（0–30 条、每条 1–120 Unicode 字、禁止控制字符）六个字段，沿用既有云设置 partial patch。旧客户端省略保留；旧服务端全部缺失时禁用新增 UI，既有功能继续；部分缺失拒绝为无效响应。桌面和服务器均校验输入，界面使用 DOM/textContent，不拼接观众输入为 HTML。

个人点赞取 LIKE_INFO_V3_CLICK，关注和分享取 INTERACT_WORD/V2 的 2/3，兼容命令后缀。复用现有 protobuf 解码与 UID/房间校验；入场和累计总数不会触发感谢。每条普通文案支持 {username}，沿用观众称呼解析；同观众同类 30 秒冷却，队列容量与 60 秒期限有界。下播、离线、换房、换账号或关闭对应开关取消旧任务，其他类别不受影响。

## 实施与验证

- [x] 解析与运行时：扩展现有解析/FixedReplyService；在 bilibili-entry、fixed-reply、overlay-entry 套件验证事件类型、重复抑制、分类词库、冷却、关闭/下播取消及租户隔离。
- [x] 配置与桌面：扩展现有 patch/投影和三类编辑 UI；IPC 用例覆盖非法输入及旧服务器；既有隔离 Electron fixture 验证保存、重载、失败草稿与三个开关。
- [x] 同步契约与指导；运行 Live `npm run verify:docs`、定向 Node/Electron、`npm run verify:architecture`，Server `npm run docs:check` 与相关完整 Node 文件。
- [x] 检查两仓库任务 diff、`git diff --check`、`git status --short`。既有未提交修改以 tmp/interaction-thanks-baseline 作为本次比较基线，仅审查本任务增量。

## 失败处理与完成条件

失败保留草稿、展示未确认状态，账号切换丢弃旧回包。只回退本任务行，不重置工作区。三种配置可独立保存，合成事件仅触发对应感谢、实际桌面流程验证通过、文档与测试同步且最终 diff 审查完成即交付源码。未向真实直播间发消息、未上线必须明确报告。

## 验证记录

- Server：`bilibili-entry`、`fixed-reply`、`overlay-entry`、`danmaku-send-scheduler` 四个完整 Node 文件 63/63；补充 `cloud-sync-http`、`overlay-entry`、`welcome-lifecycle`、`room-monitor-continuous`、`independent-monitoring` 五个文件 39/39。采用 `node scripts/run-with-node.cjs --require ./test/support/test-mode.cjs --test` 入口，数据库、时钟及事件均隔离。
- Live：`node --experimental-vm-modules --test` 执行 fixed-reply-settings-ipc、fixed-reply-frontend、cloud-fixed-reply-projection、fixed-reply-editor-electron 四文件 22/22；末次刷新状态提示修正后重跑相关 frontend/Electron 两文件 14/14，三个修改 JS 的语法检查通过。
- Server `npm run docs:check` 59/59；Live `npm run verify:architecture` 29/29。Live 文档初次 9/10，唯一失败为本计划中文状态标签无法识别；修正后 `npm run verify:docs` 10/10。
- 实际隔离 Electron 验证三组开关、词库编辑保存、失败保留草稿、重载恢复及每次操作单个窄 patch；匿名 `/admin` 保持 401。自有实例已关闭，截图在 `tmp/interaction-thanks-review/`。视觉审查结论 ship，无本次范围内缺陷；沿用现有设计系统，无须新增设计文档。
- 两仓库 `git diff --check` 通过，`git status --short` 已检查，无暂存或本任务运行数据进入 diff；末次解析器缩进修正后 `node --check src/lib/bilibili-entry.js` 通过。未运行全仓业务套件。
- 技术参考、用户指南、需求验收、OpenAPI 与 fixture 同步；词库和时段欢迎的并行任务修改保留。未使用真实账号发送，未提交、打包或部署；实际生效需配套发布客户端与服务器，真实 B 站事件/发送仍需上线环境验收。
