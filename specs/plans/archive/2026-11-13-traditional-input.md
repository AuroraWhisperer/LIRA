# 简繁等价的弹幕输入识别实施计划

Status: Completed

用户要求点歌及其他依赖弹幕文字匹配的功能支持繁体。

## 目标与当前行为

原先指令、关键词、歌库和游戏答案直接比较汉字，简繁差异会漏识别；现已补齐等价比较。
匹配双方采用同一纯字符规范化，显示、保存、AI 提问正文和用户身份仍保留原文。
不新增运行依赖、转换服务请求、数据库迁移或协议字段；不提交、打包或部署。

## Owner 与交付边界

- `src/shared/chinese-text.js` 与静态字表：无副作用的简繁比较工具；固定 OpenCC 字表版本并附许可，不接管通用 cleanText。
- 本地点歌：`src/bilibili/bilibili-message-handler.js`、`src/music/` 的歌名/随机条件/队列判断，`src/storage/song-store.js` 仅提供等价查询。
- 本地其他输入：命令去重、关键词回复、AI 触发和对话指令、猜画答案及投票选项。保留精确优先，等价冲突时不猜测。
- `D:/Work/lira-server` 的 `src/lib/` 和 `src/modules/`：签到、抽签、完整匹配、菜单、礼物查询和礼物特效的实际执行。字表随两个独立交付包内置，不运行时跨仓导入。
- 补漏：Live 歌库手输搜索与字段筛选、Server 公开歌单及主播歌库搜索。Server 的 `public/shared/chinese-text.js` 是浏览器和 Node 共用的单一 UMD 实现，网页加载内置静态脚本，沿用既有歌单数据与查询请求。
- 契约：Live 的 `docs/reference/backend/bilibili/danmaku.md`、音乐服务参考、AI 与小游戏参考；Server 的 daily-bots、fixed-replies、gift-effect-commands、gift-interaction 协议及 public-song-filters 要求。用户指南补充简繁等价说明。
- 测试：现有 songs、bots、ai、games 与 Server 对应 owner 测试，新增共享字表行为测试。

## 兼容约束

保持已有未提交改动。身份、昵称、UID、持久化礼物键及授权边界不规范化。
指令识别、重复命令占用及冷却使用相同的比较规则；原始文字和配置不改写。
歌名先保留原文精确命中，再等价匹配；自动补全不因简繁漏算候选而误选。
投票保留精确命中；若多个选项规范化后相同，则不通过变体推断选项。

## 里程碑与验证

1. [x] 固定字表及共享函数 `toSimplifiedChinese(value)`；覆盖常见简繁、多对一与补充平面字符。
2. [x] 点歌指令、库内匹配、随机条件、黑名单、去重与取消等价识别；复用 songs/bilibili/music 的 owner 测试，保留原文断言。
3. [x] 本地回复、AI 和小游戏；复用 bots/ai/games 测试，检查简繁配置、原文与歧义。
4. [x] 云端 owner、网页歌单和本地歌库输入等价匹配；现有 owner Node 与浏览器测试验证命令优先级、身份、筛选和原文。
5. [x] 同步上述参考、Server requirement/acceptance 与用户指南；两仓文档门禁通过，任务差异和状态已检查。

精确测试命令按最终 owner 文件记录在收尾证据。执行各自 Node test 文件，修改 JS 使用 `node --check`，文档使用 Live `npm run verify:docs` 与 Server `npm run docs:check`。
完成后两仓执行 `git diff --check`、检查任务 diff 与 `git status --short`；不运行无关完整套件。

## 失败处理与完成条件

失败先在对应 owner 的集中用例定位，不反复重跑全量。不碰真实用户数据或运行中的桌面应用。
如需撤回，仅逐段撤销本任务新增内容，保留既有改动。
上述匹配入口的集中测试通过、原文保留、文档与源码一致后完成；源码交付与服务器部署分别报告。

## 收尾证据（2026-11-13）

- Live：`node --experimental-vm-modules --test test/bots/chinese-text.test.js test/bots/fixed-reply-settings-ipc.test.js test/songs/song-request-autocomplete.test.js test/songs/song-cooldown.test.js test/songs/queue-service.test.js test/songs/random-song-filter.test.js test/songs/tag-aliases.test.js test/music/song-matcher.test.js test/bilibili/bilibili-diagnostics.test.js`，105/105 通过。
- Live：`node --test test/bots/daily-bot-commands.test.js test/bots/custom-reply-service.test.js test/games/games.test.js test/games/interactions.test.js`，44/44 通过；`node --test test/ai/ai-assistant-service.test.js test/ai/ai-conversation-continuity.test.js test/ai/ai-personas.test.js`，36/36 通过。
- Live：`node --experimental-vm-modules --test test/bilibili/message-deduplicator.test.js test/songs/song-service-boundary.test.js test/songs/song-library-filter.test.js`，21/21 通过。冷却用例增加多条既有简繁键、作用域和重启检查后，`node --test test/songs/song-cooldown.test.js` 再验 10/10 通过。共 206 个不重复的相关用例通过。
- Live：18 个改动源文件 `node --check` 通过，`npm run verify:docs` 10/10 通过。`npm run verify:architecture` 29/30：唯一失败是任务开始时已修改的 `public/js/admin/desktop-lyric-preview.js` 中 comment-only catch 超过冻结基线，本任务未改该文件，也未修改门禁。
- Server：`node scripts/run-with-node.cjs --require ./test/support/test-mode.cjs --test test/public-song-page.test.js test/daily-bot-runtime.test.js test/fixed-reply.test.js test/gift-effect-command.test.js test/gift-chat.test.js test/streamer-manage-surface.test.js`，133/133 通过；`npm run docs:check`，60/60 通过。
- Server：先执行 `npm run verify -- --browser e2e/public-song-filters.spec.js --browser e2e/streamer-workspace-states.spec.js --plan` 核对范围，再执行相同命令去掉 `--plan`，两个完整浏览器文件 29/29 通过。报告位于 Server `tmp/verification/runs/2026-11-13T10-32-50-436Z-07e51161/browser.json`。
- 两端比较表对全部 4113 个映射字符输出一致；源码差异及 `git diff --check` 已核对，保留全部原有未提交内容。没有使用真实用户数据、变更运行中的应用、提交、打包或部署。
