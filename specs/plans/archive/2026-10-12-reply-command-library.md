# 内置回复词库与年月查询

Status: Completed

## 目标与边界

按用户后续裁决，新增独立的“查询回复”类型，覆盖礼物／盲盒及具体礼物名称的统计查询。沿用真实账本动态生成，词库展示触发写法与回复说明，不作为固定文本上传。查询开关复用现有 `giftStatsQueryEnabled` 与 `gifts/interaction-controls.js`，礼物页入口与弹幕页同步。自定义回复保留固定文本和菜单，不混入动态查询；原有八项顺序保持，新项在最后一行。

日期增加上月／上个月、去年、1—12 月、四位年份和指定年月（例如 2026 年 3 月）。只写月份以请求时北京时间年份解释，年月边界左闭右开；同一实际周期共享查询冷却，不同月份／年份独立。拒绝不存在的月份；保留观众查本人、真实房主查全房、来源取消和相对时间标签保护。

用户已明确这些功能不属于自定义回复，应独立分类；动态统计格式保持不变，不新建模板协议。

## 所有权与实施

- 服务端 `src/lib/gift-chat-command.js` 拥有时间解析；`gift-chat-service.js` 沿用权限、冷却、统计和队列。扩展 `test/gift-chat.test.js` 的现有边界／真实汇总测试，并更新 `fixed-reply-service.js` 菜单及其测试。
- 桌面 `danmaku-query-replies.js` 只展示查询词库，沿用 `danmaku-fixed-replies.js` 的统一展开区、分页及搜索。通过 `fixed-reply-frontend.test.js` 验证查询与自定义独立、查询开关复用及单次保存，隔离 Electron 检查实际界面。
- 礼物交互协议及需求／验收、桌面使用指南与技术参考同步；没有新 IPC、设置键、数据库或权限边界。

## 完成检查

- [x] 时间解析与真实统计定向测试通过，既有语法兼容。
- [x] 独立查询词库包含 45 条常用时间、1—12 月及年月示例，用户自定义保存保持原合同。
- [x] 桌面定向测试及隔离界面检查通过，技术文档和使用指南同步。
- [x] 两仓文档检查、任务 diff 和工作区状态复核。保留其他聊天全部改动，不提交或部署。

## 验证证据

2026-10-12：服务端使用项目现有 Node 24.18.0 运行 `test/gift-chat.test.js` 与 `test/fixed-reply.test.js`，81 项通过；真实 SQLite 覆盖个人／房主、礼物／盲盒／具体名称、时间边界、房间隔离、高水位和 final 等待。冷却同期间共享、不同年月分开，上月／去年相对标签跨期取消保留。`npm run docs:check` 55 项通过。

客户端 `fixed-reply-frontend`、`gift-interaction-controls` 与 `frontend-usage-guide` 最终 34 项通过，`frontend-admin-danmaku` 7 项通过；既有 `daily-bot-frontend` 5 项也通过。同屏操作证明两处查询开关双向同步，每次只写一次查询字段，自动答谢与自定义词库不受影响。

隔离 `fixed-reply-editor-electron` 和 `daily-bot-editor-electron` 两项通过；真实生产 admin、preload 和 IPC 通过合成服务验证，匿名 admin 返回 401。实际截图复核独立总览、年份搜索和只读词库；指南截图为 `public/img/usage-guide/E/danmaku-query-replies.png`。测试进程及本轮临时目录已清理。

客户端文档门禁 10 项、两仓 `git diff --check` 通过；独立复核结论可交付，无实质问题。技术参考、服务端规范与验收、两处用户指南及新截图已同步；交互引导没有相关逐项操作，无需修改。无新增 IPC、数据库或持久字段，OpenAPI／架构不变。未提交、部署或向真实 B 站发送；运行新语法需同步更新服务端。
