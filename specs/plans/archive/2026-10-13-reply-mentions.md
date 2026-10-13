# 菜单与弹幕回复对象实施计划

Status: Completed

## 目标与边界

菜单固定回复“签到、抽签、礼物特效、礼物查询、盲盒查询”。签到、抽签、AI、点歌回复、精确自定义、关键词自定义和查询回复的每个发送分段都关联原弹幕发送者；正文切分保留昵称预算。保留既有开关、冷却、租户与发送来源校验，不改变定时弹幕或其他自动播报。

## 当前行为与所有权

- 修改前 Server `src/modules/danmaku/fixed-reply-service.js` 动态生成菜单，精确回复没有传递 `replyUid`/`username`；已有串行分批与取消机制。实际入口 `src/modules/bilibili/room-monitor.js` 也需要透传完整昵称，已一并补齐并通过入口测试。
- Live `src/server/bilibili-client.js` 点歌及关键词回复传递目标，但没有启用 `mentionEveryChunk`。
- 签到/抽签、查询的服务器任务及 AI 桌面任务已携带回复目标，复用已有实现与回归。
- Server 规范归属 `docs/protocol/fixed-replies.md`、REQ-BOT-002、AC-BOT-002；Live 参考归属 `docs/reference/backend/bilibili/danmaku.md`、`docs/reference/desktop/main.md`、`docs/reference/frontend/app.md`，用户说明在 `usage-guide-danmaku-replies.html`。

## 兼容约束

不变更 HTTP/IPC、持久格式、身份解析或授权；保留 `menuCommands` 的旧客户端读写兼容，但固定菜单不再消费其内容。保留当前未提交的查询回复页面修改及本聊天先前的列表展示修改。无需更换进程、依赖或架构。

## 实施与验证

- [x] 扩展既有测试：固定菜单精确匹配、每段目标 UID/昵称与长度、不同观众及无效目标；点歌和关键词路径传入逐段提及标记。发送器缺少 UID 或昵称时拒绝自动回复，保证不退回普通广播。旧代码已复现缺少逐段标记、错误菜单及缺少目标的失败。
- [x] 服务端菜单改为固定文字；`segmentsFor(text, limit = 40)` 接受扣除完整昵称后的预算，精确回复入队传 `replyUid: event.uid, username: event.username`。定时分支沿用默认预算。
- [x] 桌面两条自动回复调用增加 `mentionEveryChunk: true`；内置菜单列表展示实际固定文案，同步帮助、参考与服务器规范。
- [x] Live：`node --test test/bots/custom-reply-service.test.js test/danmaku/danmaku-sender-service.test.js test/ai/ai-assistant-delivery.test.js test/bots/fixed-reply-frontend.test.js` 41 项通过；`test/danmaku/danmaku-client.test.js` 10 项、`test/bilibili/bilibili-danmaku-send.test.js` 3 项通过。
- [x] Server：使用已有 `tmp/danmaku-efficiency/node-runtime/node-v24.18.0-win-x64/node.exe` 执行 `node --test test/fixed-reply.test.js test/daily-bot-runtime.test.js test/gift-chat.test.js test/bilibili-api.test.js` 129 项通过；`test/independent-monitoring.test.js` 8 项通过；`npm run docs:check` 对应五文件命令 55 项通过。
- [x] 两仓差异与状态审阅，执行 `git diff --check`；Live 文档检查首次发现计划使用中文状态字段，归档时改用标准 `Status`，最终重跑 `npm run verify:docs`。不提交、不发布，不发送真实直播弹幕。

## 失败处理与完成条件

失败时只修复本任务所属原因，用聚焦检查验证；撤回仅针对本任务差异，保留已有修改。完成标准为固定菜单与页面一致，七类回复具有原发送者的原生回复目标，长回复每段预算正确，相关测试与文档门禁通过并审阅差异。合成验证不等同于真实直播间发送验收。
