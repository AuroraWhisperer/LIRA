# 隐蔽重复计算优化实施计划

Status: Completed

## 目标与边界

落实本次审查确认的五项重复工作：混合画布静态数据、当天礼物及身份资料、服务端固定回复、迎宾配置和屏蔽匹配。以同组合成数据的操作计数证明减少，并保证显示结果、更新可见性、取消和恢复语义。两仓现有未提交改动全部保留；不提交、发布、修改真实用户数据或重启运行实例。

使用 writing-plans 的分阶段验证方法；按本仓 PLANS.md 维护位置与生命周期，直接在当前会话执行。用户已授权实现，不另设执行方式确认。

## 设计与所有权

1. 服务端配置与匹配：`src/storage/cloud-settings-store.js`、`welcome-settings.js` 及其 danmaku 服务；复用原始配置未变化时的解析/准备结果，屏蔽规则按已缓存配置建立 UID 集合和小写关键词。每次读取仍观察当前已提交配置，事务/回滚不污染缓存；不缓存权限。相关协议为 fixed-replies、viewer-welcome、overlay-filters。
2. 画布：SceneService、scene-components、scene-extra-display 与 display-source/scene-source/lyric-window 拥有可选的静态数据版本协商。旧请求保持完整响应；新消费者仅在已接收对应版本时省略未变歌单和整首歌词，播放状态照常更新。首次、输出失败/撤销、整页重载、发布切换、owner 变化均恢复完整所需数据。仅通知流重连时继续保留健康输出的已接收内容。参考 `backend/api.md`、`frontend/overlays.md`。
3. 礼物：本地 gift query 的现有变更标识避免不变历史的重复分页；远端 gift-card-profiles 增加向后兼容的内容版本协商，旧服务/客户端仍走完整分页。卡片数据准备复用历史和身份版本，身份独立更新、头像失败重试、跨日、来源变化和清空仍可见。涉及服务端专用 Device 端点规范和 OpenAPI、本地 gift 与 overlay 参考，不改变账户或可见字段范围。

## 验证阶段

- [x] 服务端三项：扩展 fixed-reply、welcome 与 overlay-filters 既有套件，覆盖未变化计数、配置修改、回滚、租户与返回值隔离；执行完整受影响文件，重跑审查的 server probe 对照。
- [x] 画布：扩展 scene-extra-components、scene-service、scene-source 与 renderer-state 既有测试，证明每种静态数据只准备/传输一次且修改立即更新，授权/失败/旧客户端保持正确；混合画布执行实际浏览器源检查。
- [x] 礼物：扩展 gift-card-runtime、gift-banner-feed、gift-query 与服务器 gift-card-profiles 既有用例，覆盖内容变更、跨页更新、旧服务完整分页、头像恢复和同来源新增；计数对照确认分页与聚合减少。
- [x] 同步 owning 规范、OpenAPI、参考；用户入口、配置和操作不变，指南无须修改。客户端 `npm run verify:docs`、`npm run verify:architecture`、`npm run check`，服务器 `npm run docs:check` 及相关完整 Node 套件通过。
- [x] 两仓本轮 diff、`git diff --check` 和状态已核对，无临时数据/秘密进入源码；保留已有修改并归档次数证据。

## 失败处理与完成条件

先保留旧/新兼容路径，再增加有明确计数及失效断言的覆盖。失败在所属模块定位，不同时编辑正在测试的文件，不扩展修复无关存量问题。必要的读取、写入、授权与关键词包含匹配不计为消失。测量材料存放两仓 `tmp/hidden-recompute-review-20261024/`；实际命令、计数及限制随阶段补记。五项均实现并通过相关验证、文档一致、最终 diff 审阅后才完成。

## 实施结果与证据（2026-10-24）

| 同组合成负载下的操作 | 改前 | 改后 |
| --- | ---: | ---: |
| 5000 首歌曲、500 行歌词、100 次场景读取：歌曲行复制 | 500000 | 5000 |
| 同场景：源歌词正文读取 | 50000 | 500 |
| 同场景：完整 JSON 输出字节 | 83897454 | 879839 |
| 5000 条今日礼物、20 次刷新：本地历史页请求（含确认） | 1000 | 69 |
| 同礼物：历史传输/重新分组行数 | 100000 | 5000 |
| 同礼物：云端身份页请求（含确认） | 500 | 44 |
| 同礼物：云端身份传输行数 | 100000 | 5000 |
| 1000 条不匹配弹幕：固定回复配置 JSON 解析 | 32000 | 7 |
| 同弹幕：配置 SELECT | 5000 | 2000 |
| 1000 次冷却拒绝进场：迎宾配置 JSON 解析 | 2000 | 2 |
| 同进场：配置 SELECT / 必需到访写入 | 4000 / 1000 | 3000 / 1000 |
| 1000 条未屏蔽弹幕、500 UID：规则 UID 条目读取 | 500000 | 500 |
| 同弹幕、200 关键词：关键词小写转换 | 200000 | 200 |

UID 匹配仍执行 1000 次 Set 查询，消息小写转换与包含匹配仍按需执行。分页减少包含第一次完整扫描之后的 19 次轻量确认。计数来自实际 owner 函数和合成输入，不是生产 CPU 或整机性能百分比；本地真实 SQLite 的 5000 行回归和场景 gift-feed 也得到 69 次历史请求。

本地礼物内容版本使用连接内临时触发器，避免同步状态写入导致重扫；现有独立读事务仍拒绝嵌套事务，不扩展事务契约。可见时间上界对应的最后记录参与版本，未来时间记录随着时钟推进出现时仍更新。服务器复用已迁移的账本 integrity_revision，不增加持久表或迁移。完整分页过程中发生变更时不确认该轮版本。

验证记录位于两仓同名 tmp 目录：`client-after.cjs/json`、`server-after.cjs/json` 保存改后同负载结果，原 `*-probe.cjs`、`*-results.json` 保留基线。客户端 scene-service/source/http/renderer-state/extra-components/live-updates、gift-query/display-query/banner-feed/card-runtime/frontend-feed/routes/export-controller、license manager/remote/budget 和 overlay HTTP/projection 相关完整文件均已运行；失败夹具已修正并按受影响文件复验。浏览器验证覆盖混合歌单/歌词的部分更新与重载、身份独立变化、金额门槛、静态卡片头像重试、连续滚动与释放。未新增独立 QA 运行框架或操控用户实例。

服务端 fixed-reply、welcome-settings/service/stages/lifecycle、overlay-filters、gift-card-profiles 完整文件通过，最后补充的配置存储故障与条件 HTTP 响应验证也通过；数据读取仍遵循同租户、当日、syncEpoch，外部数据库提交与回滚有针对性覆盖。客户端语法检查覆盖 1648 文件，架构 28 项；两仓文档及服务端 OpenAPI 门禁通过。未运行两仓全量业务套件、生产负载或真实账号实播。

技术参考、Device 协议/OpenAPI、相关服务端规范和验收同步；产品入口、设置、操作与架构边界未改变，需求、ADR 和用户指南无新增行为需要更新。改动未提交、打包或部署；远端身份条件读取需服务端部署相应版本，旧服务继续完整分页。
