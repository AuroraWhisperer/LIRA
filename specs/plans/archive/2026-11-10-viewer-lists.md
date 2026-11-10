# 观众名单接口与超过 100 人的补充

Status: Completed

## 目标与证据

修正小游戏及同类观众选择链路的旧接口、错误分页和称呼，并使用 B 站当前实际开放的名单补充前 100 名之外的人。2026-11-10 对房间 1881598656 的只读采样：贡献值与进房时间两种在线榜各返回 100 人，合并为 112 个 UID；第二页和 page_size=200 仍不能取得完整名单。官方页面配置提供这两种排序。总人数不等于开放身份数量。

## 所有权与范围

- Live：`src/bilibili/danmaku/api-client.js` 和 `online-rank-poller.js` 负责榜单请求及快照；小游戏继续合并当前连接最近十分钟的弹幕观众。
- Server：`src/modules/bilibili/api.js` 负责同一上游接口；`src/modules/danmaku/overlay-viewers.js` 合并两种排序。共享消费者 `pk-report-snapshot.js` 修正裁成 50 行和重复翻页，仅统计贡献值排序的 100 行，避免把进房顺序用作贡献排名。
- 契约：Live 的 Bilibili / HTTP / preload 参考及小游戏说明；Server 的 overlay-filters、PK 协议、Device OpenAPI 与对应 requirement / acceptance。
- 不增加独立连接、轮询器、依赖或持久化。历史发布记录及历史协议名保留其历史含义。本次不发布、部署或操作用户运行中的应用。

## 兼容与失败处理

- 本地轮询仍为 60 秒；一次刷新最多两次上游请求，并发调用共享整个刷新。任一成功名单可用，两路均失败保留旧快照，成功空名单清空，停止/换连接丢弃迟到结果。
- Device 旧客户端仍默认接收最多 150 人；新客户端显式请求 `limit=200`，支持两份各 100 人的并集。旧服务器忽略新查询参数时仍可返回旧格式。租户、房间、凭据与 IPC 来源校验不变。
- 不使用粉丝牌全量成员、日榜或周榜冒充当前在场观众，不承诺完整覆盖安静或未对外提供身份的观众。
- 修改失败时检查两仓库本任务文件的差异，只修正或撤销本任务行；保留并行任务的修改。

## 实施与验证

1. [x] 双排序合并与旧称呼清理；以合成数据验证 UID 去重、超过 100 人、部分/全部失败、空结果、并发与旧连接失效。
2. [x] 同步 Server 观众读取、PK 单次贡献榜采样及旧客户端数量兼容；运行 bilibili-api、overlay-viewers、overlay-settings-routes、pk-report、pk-report-service 相关文件和客户端 IPC 测试。
3. [x] 更新现行协议与用户说明；运行 Live `npm run verify:docs`、Server `npm run docs:check`，无关失败单独记录如下。
4. [x] 使用生产代码对用户提供房间只读验证名单并集与实际请求次数，检查两仓库 touched diff、`git diff --check` 与 `git status --short`。

完成结果：本任务实现及相关检查通过，现行源码、测试和参考文档中已清除旧接口、错误分页和“高能榜”误称；历史发布记录和原始平台协议记录保留其历史含义。证据明确区分“超过 100 人可用”与“完整在线名单”。仓库级检查中的其他任务失败按隔离规则记录，不修改对方文件或宣称全绿。

## 验证记录

- Live：`node --experimental-vm-modules --test test/bilibili/bilibili-user-info-pollers.test.js test/bilibili/bilibili-user-info-service.test.js test/bilibili/bilibili-user-meta.test.js test/danmaku/danmaku-client.test.js test/danmaku/danmaku-overlay-filters-ipc.test.js test/games/game-routes.test.js test/games/frontend-games.test.js`，55/55 通过。
- Server：`node scripts/run-with-node.cjs --require ./test/support/test-mode.cjs --test test/bilibili-api.test.js test/overlay-viewers.test.js test/overlay-settings-routes.test.js test/pk-report.test.js test/pk-report-service.test.js`，105/105 通过。
- 生产 `BilibiliDanmakuClient` 只读采样房间 1881598656：两次并发刷新共发出两次 HTTP 请求；两路均 HTTP 200/code 0，各 100 人，贡献值排序总人数 176，合并为 111 个不同 UID。进房时间排序的 count 为 0，不影响名单。未启动客户端、WebSocket 或修改运行数据。
- 复核发现配置房间已变化、旧连接仍有弹幕到达时可重新填入旧候选。已在候选 owner 拒绝此类记录；`node --test test/games/game-routes.test.js test/games/game-streamer-role.test.js` 14/14 通过。
- Live `npm run verify:docs` 10/10 通过。Server `npm run docs:check` 为 59/60，通过了本次相关协议检查；唯一失败为并行任务新建的 `docs/superpowers/plans/2026-11-10-responsibility-refactor.md` 缺少 lifecycle notice。该文件不属于本任务，按仓库规则保留并记录，不能把这一项宣称为通过。
- 两仓库 `git diff --check` 通过；已审查本任务源码、测试、现行契约与用户说明差异，保留所有并行修改。只读研究下载和测试日志位于各自根目录 tmp，未进入变更；没有启动或重启用户应用，没有提交、打包或部署。
