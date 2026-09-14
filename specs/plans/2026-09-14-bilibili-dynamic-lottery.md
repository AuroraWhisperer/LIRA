# Bilibili Dynamic Lottery Implementation Plan

> 执行约定：按下面的任务逐项实现、验证和更新状态。遵守仓库 AGENTS.md；计划位置使用仓库规定的 `specs/plans/`，不自动创建分支、提交或发布。M0/M1 已开始实施；未勾选条目仍未完成对应验证。

**Goal:** 在 LIRA 桌面完成主播自有动态的截止后采集、关注检测、可选规则抽奖和结果留档，并能打开独立浏览器页面开奖、全屏公示及保存图片。

**Architecture:** 复用 Electron 内嵌 Node、固定路径 HTTP 和 SQLite。动态抽奖服务通过窄端口访问账号、限速请求及存储，renderer 仅展示与提交操作；新增独立 `lotteryDb`。浏览器通过同一进程按需启动的独立回环 HTTP 端口访问本轮控制/展示能力，复用同一个领域服务。

**Tech Stack:** Electron 43、Node.js 24+、CommonJS 后端、原生 ESM 前端、原生 CSS、`node:sqlite`、`node:crypto`、`node:test`。

**Status:** Draft / 当前简化客户端流程已接入、未测试，2026-09-14。已有独立登录和 M0/M1 基础，本轮接入三个条件、采集、持久随机顺序、按需关注核验/递补及历史结果。按用户要求未运行测试，不声称已经验证真实来源。以下旧 M2–M4 多奖项、领奖、导出、公示网页及全面恢复验收仍未完成；最新范围以本节及[设计与实施报告](../bilibili-dynamic-lottery_design.md)顶部补充为准。

## 2026-09-14 当前实施：客户端评论交集抽奖

最新用户要求直接接入客户端百宝箱，并明确本轮不运行测试。此节优先于下面旧里程碑中的测试和来源预先开放约定；旧 M2–M4 的多奖项、领奖、导出和独立网页展示不在本轮范围。

- 目标：复用已有“动态抽奖”标签及独立登录，提供链接、中奖人数（1–100）和点赞/转发/关注作者三个开关。主评论按 UID 去重；评论截止自动固定为创建采集任务的时刻，点赞/转发是采集时的互动名单，关注是核验时的关系，不声称可还原历史关系或无时间戳的历史互动。
- 来源：动态评论与 reaction 分页通过专用账号、统一串行预算调用；同时选点赞/转发时一次分页事务保存两种证据。视频解析为视频评论区；视频分享数不充当可枚举转发用户，不能可靠取得视频点赞/转发名单时明确拒绝该组合。
- 随机与保存：后台完成所选来源采集后才能冻结交集；使用 crypto.randomInt 的 Fisher–Yates 均匀洗牌，先持久化一次顺序，再依序核验。确认为非粉丝才递补；未知/报错暂停原位置；重试和重启不重排。人数不足明确报告，不无限循环。
- 所有权：领域 rules/draw/service 管理资格及活动；现有 lotteryDb 的 store 加入轮次/顺序/核验事务，不改 v1 表格式。server runtime 负责组装、可信 scope 与关闭排空；固定 HTTP 入口沿用管理鉴权，renderer 不能提交候选人、UID 身份或随机顺序。
- 兼容：不改变直播登录、安装包、其他工具箱页、云同步和旧数据库清理行为。抽奖历史留在独立本地库；不自动运行真实账号请求，启动只恢复为暂停状态。接口异常保留数据并暂停，不静默降级规则。
- 实施：① 来源/规则与持久开奖；② runtime、受保护路由及关闭排空；③ 客户端控件、进度、历史和结果；④ 相关合同与最终差异复核。
- 验证：按用户要求，本轮不运行单测、脚本检查、客户端或 B站实测。仅阅读实现、格式化当前新增源码并执行 `git diff --check`、`git status --short`；交付标明未测试。不使用前一轮通过结果证明本轮可用。
- 完成标准：上述代码链路和客户端操作完整接入，错误与恢复路径明确，来源限制可见，改动范围审阅完成；真实可用性保留待测，不把整个原报告标为验收完成。

**实施记录：** 已接入 rules/service/draw、独立 draw-store、server runtime 和三个受保护固定路由；共用 reaction 页在一个事务中保存所需来源，冻结成员和顺序先落盘，每个资格结果、授奖及游标同事务推进。随机算法不在 renderer 执行；最近 50 个活动和中断进度可读取，需手动继续。视频点赞/分享明确不可用；评论 10 万证据上限、循环游标、互动数量不足均暂停而非截断开奖。frontend-design 仅用于沿用现有 token 的规则表单、进度和结果布局。本轮未运行任何自动测试、客户端/浏览器验证、B站真实请求或打包。

## 2026-09-14 补充：抽奖专用登录

用户明确要求抽奖账号与现有直播 B站账号互不影响。本次先交付独立登录入口，不把这一项等同于 M2–M4 完成，也不提前开放未经实测的关注来源。

- Electron 新增专用认证所有者，按可信 LIRA `streamerId` 的 SHA-256 隔离 `persist:bilibili-dynamic-lottery-<hash>` 与 `dynamic-lottery-auth/<hash>/cookies.enc`；继续使用 `safeStorage`，不导入直播 Cookie，不导出明文，不参与云同步。
- 复用受限登录窗口，增加标题和取消生命周期；独立 IPC 仅允许主窗口、主 frame、精确本地 origin 调用，只返回登录状态及十进制 UID。Cookie UID 仅供显示，动态作者与关系仍须 provider 的受控在线验证。
- 工具箱新增“动态抽奖 / 抽奖专用账号”，支持登录、退出和状态刷新；普通浏览器明确提示需桌面版。退出和授权切换取消旧窗口、隔离在途结果，使旧抽奖会话失效。
- 实施顺序：1）专用加密存储和会话 → 隔离/恢复/退出/身份切换测试；2）IPC、preload、桌面生命周期和工具箱 → 来源检查/脱敏/交互测试；3）更新合同并检查 diff → 相关测试、`npm run check`、`npm run verify:architecture`、`npm test`、`npm run verify:docs`、`git diff --check`。
- 不修改直播登录、现有云端同步、安装包或真实账号数据；真实作者扫码与粉丝关系验证另记结果，登录失败不影响其他功能启动。
- [x] 专用登录及隔离测试完成。
- [x] 桌面/工具箱接入与合同更新完成，记录实际验证结果。

**本项验证记录：** 98/98 个相关测试通过，包含专用凭据与原直播凭据隔离、加密恢复/损坏恢复、重复登录、取消/退出、跨身份及在途读取失效、IPC 来源/脱敏、工具箱及停机排空。隔离浏览器中以合成账号检查登录/退出/刷新、导航折叠和键盘切换、普通浏览器不可登录提示；1280×720 与 1024×680 下控件及说明无裁切，测试浏览器与临时回环服务已关闭，未操作真实账号。架构检查 22/22；完整测试 1897 项，1892 通过、4 跳过、1 失败（工作区既有 `frontend-admin-layout.test.js:43` 礼物布局预期不匹配，本项未改该布局）。真实 Electron 作者扫码、本人动态和粉丝关系仍未验证；本项不等于完整抽奖交付。

## Global Constraints

- 保持模块化单体；不新增常驻进程、框架、前端构建步骤或运行时依赖。
- 业务状态由后端管理，SQL 与事务由 store 管理；HTTP 和 renderer 不能决定资格或中奖者。
- 凭据只在 Electron/后端内部流动，保留 context isolation、safeStorage、分区与 HTTP 鉴权。
- `streamerId` 从可信授权身份取得；B站 UID 必须经账号接口验证，不以 URL、roomId 或前端字段建立权限。
- 所有上游实际请求共享调度，包括账号验证、WBI 参数、分页、关注及重试；默认并发 1。
- 数据状态未知不能当作未参与/未关注，部分名单不能正式开奖。
- 时间资格由互动发布时间决定，截止后发布的排除；首版只做截止后正式采集，不要求预览步骤。
- 采集由主播点击按钮并确认后发起；截止时间只作资格边界，不创建定时执行。采集完成后等待手动开奖，页面打开和重启均不自动开始任务。
- 跨奖项重复、是否补抽、补抽方式及领奖时限由主播在开抽前选择并锁定，不能在算法或数据库中写死全局不重复。
- 浏览器不得取得管理 token、Cookie 或完整候选顺序；权限隔离依据报告 ADR-DYNAMIC-06，不靠隐藏按钮。
- 所有参与 ID 使用十进制字符串；测试只使用合成数据、隔离临时库与专门测试账号。
- 保留工作区其他变更；现有迁移只追加，运行时数据与凭据不进入仓库。

## Current Behavior and Ownership

已确认的现有入口：

| 所有者 | 本任务的接入方式 |
| --- | --- |
| `src/electron/dynamic-lottery-auth.js`、`src/electron/main.js` | 抽奖专用 Cookie 与会话；组合根传入可信授权身份，不复用直播凭据 |
| `src/electron/license/license-manager.js` | 使用已有 `getCloudSyncIdentity()`、`getAuthorizationEpoch()`，不改授权规则 |
| `src/bilibili/wbi-signer.js` | 将签名计算提取为可复用纯函数；现有带网络调用的导出保持兼容 |
| `src/server/api-routes.js` | 注册新的固定路径路由模块，不修改路由匹配机制或公开免鉴权列表 |
| `src/server/api-context.js`、`src/server/runtime-api-context.js` | 仅注入抽奖服务的窄 facade |
| `src/storage/database.js`、`database-migrations.js` | 注册新库及独立迁移命名域，不把抽奖规则写入 settings |
| `src/server/admin-page.js`、`public/js/admin/app.js` | 注册工具箱片段和命名 ESM 初始化函数，沿用 index.js 现有入口 |
| `src/electron/main.js`、`src/electron/external-url-policy.js` | 沿用已允许回环地址交系统浏览器打开的路径，仅打开后端返回的本轮 URL，不扩展任意 HTTP 导航 |
| `src/server/http-utils.js`、`src/server/runtime-transport.js` | 当前向 HTML 注入管理 token；新展示端口不得复用该注入或通用静态托管，不修改主服务的免鉴权列表 |

开始实施前重新检查这些入口的当前版本，因为仓库有其他正在进行的改动；只针对接入点调整，不恢复或覆盖其他工作。

## Shared Interfaces

以下为各任务共享的最小数据合同；字段只能由其拥有者产生。时间统一为 UTC 毫秒，UI 使用北京时间。

```js
// 仅内部。getContext() 返回的 cookieHeader 不进入其他 DTO、日志或数据库。
// AuthContext = { streamerId, authorizationEpoch, sessionEpoch, cookieHeader }
// VerifiedOwner = { streamerId, ownerUid, sessionEpoch }

// Target = {
//   dynamicId, ownerUid, commentOid, commentType, publishedAtMs,
//   capabilities: { comment, repost, like, relation, threadReplies, level }
// }
// 每个 capability = { available, canEnumerate, hasEventTime, reason }

// Evidence = {
//   source: 'comment' | 'repost' | 'like', recordId, uid,
//   occurredAtMs: number | null, text: string | null,
//   parentId: string | null, level: number | null
// }
// Page = { records: Evidence[], nextCursor: string | null, ended: boolean }
// Relation = {
//   state: 'eligible' | 'ineligible' | 'unknown', checkedAtMs, reason,
//   attribute: number | null, subjectUid, ownerUid
// }

// Rules = {
//   schemaVersion: 1, entryAction, requiredActions: [], commentScope: 'root',
//   startsAtMs, endsAtMs, keyword: { mode: 'none' | 'contains' | 'equals', value },
//   excludeText: '', requireFollow: false, minLevel: null, excludeUids: [],
//   prizes: [{ id, label, count }], allowCrossPrizeWins: false,
//   claimWindowHours: 72, // null 表示关闭领奖时限
//   replacement: 'ordered' // 'none' | 'ordered' | 'random'
// }
// 同一奖项内每 UID 至多一次；全部名额合计至多 100。
// PresentationSession = { roundId, mode: 'control' | 'display', expiresAtMs }
// 内部还绑定可信 streamerId/epoch；随机凭据不进入普通活动 DTO、日志或数据库。
// PresentationState = {
//   roundId, revision, status, updatedAtMs, title, dynamicId,
//   rulesSummary, participantCount, progress,
//   results: [{ awardId, prizeId, prizeLabel, uid, nickname, drawnAtMs, status }]
// }
// results 初抽须整轮完成后提供，后续逐个加入完成的补抽批次；
// 未完成批次只提供进度，补抽过程中仍可展示上一版已完成结果及其版本。
```

采集来源状态使用报告中的 `exhausted / partial / restricted / unknown`；只有 provider 明确返回 `ended: true` 才可能转 exhausted。顶层业务码、分页字段缺失、未知互动类型或丢失精度的 ID 都必须先报错，不能由上层补成默认值。

抽奖领域对 runtime 暴露 `createTask(input)`、`listTasks(query)`、`actOnTask(input)`、`listParticipants(query)`、`startDraw(input)`、`actOnAward(input)`、`getResult(query)`、`exportResult(query)`、`dispose()`。runtime 在每次调用时取得可信身份并检查所属范围；这些名字对应八个活动 HTTP 入口和生命周期。runtime 另通过 `actOnPresentation(input)` 装配第九个入口，签发/撤销网页会话；展示模块只得到 `getState` 和 `draw` 窄回调，不得到完整服务或 store。

## Task 1 / M0：证明来源能力并建立读取适配器

**新增：** `src/bilibili/dynamic-lottery/link.js`、`provider.js`、`src/electron/dynamic-lottery-session.js`、`test/dynamic-lottery-provider.test.js`、`test/dynamic-lottery-session.test.js`、`test/bilibili-wbi-signer.test.js`。

**修改：** `src/bilibili/wbi-signer.js`，仅提取纯计算并由旧导出调用，以便新 provider 的所有网络都受调度。

**接口：**

```js
normalizeDynamicLink(text); // -> { url, dynamicId, needsRedirect }
createLotterySession({ getCookieHeader, getIdentity, getAuthorizationEpoch });
// -> { getContext(), invalidate(), dispose() }
createLotteryProvider({ request, getContext, nowMs });
// -> { inspectDynamic(url, signal), readPage(input), readRelation(uid, signal) }
// inspectDynamic -> { target: Target, owner: VerifiedOwner }
// readPage({ target, source, cursor, signal }) -> Page
buildBilibiliWbiQuery(params, mixinKey, nowMs); // 新增纯函数 -> query string
createBilibiliWbiMixinKey(imgUrl, subUrl); // 新增纯函数 -> mixinKey
```

- [ ] 为链接白名单、超大 ID、越界短链、非本人动态、缺失分页字段、关系方向和会话切换建立合成输入测试。链接不得接受用户信息段、非 HTTPS、非默认端口或任意子域；b23 跳转至多 5 次且逐跳验证。
- [ ] 按原字段实现最小解析。JSON 中优先使用字符串 ID；数值 ID 只接受安全整数，不能用已失真的 Number 再转 String。单次请求超时 20 秒、响应体上限 4 MiB；超出即失败，不把已读片段作为有效页。
- [ ] 评论的 recordId 使用实际评论 ID，转发优先使用实际转发记录 ID。只有没有独立事件 ID 的当前态互动名单，才可使用 `来源:动态ID:UID` 作为本地去重键；它不是平台事件 ID，不能据此推导次数或时间。未知 UID 不填成 0，无法解释的记录使来源保持未完成。
- [ ] 抽出 WBI 的密钥组合和 query 计算纯函数，旧 `signBilibiliWbiParams(params, headers)` 保留其原参数和结果。新 provider 自己通过注入的 `request` 取得账号信息和签名材料，不调用旧 helper 中绕过预算的 fetch。
- [ ] 会话适配器同时观察授权 epoch 与认证 Cookie 的会话变化，产生内部递增 sessionEpoch；清空或更换认证身份立即使旧异步结果失效，不因昵称、头像等资料变化重置业务身份。
- [ ] 按参考扩展实现签名关系查询，以参与 UID 为 mid，在已验证主播登录态读取经受控测试确认的 be_relation 方向。成功响应中 2/6 为已关注、0 为未关注、128 单独判拉黑；缺字段和未知值不能默认 0，也不能用大于 0 代表粉丝。
- [ ] 使用专门测试账号及其自有动态，在既定低速预算内核对：至少两页一级评论、本人/非本人、观众单向关注、主播单向关注、互粉、未关注、取关后更新和账号切换；对关注列表隐藏的参与账号也检查此关系查询的真实结果。合成异常另覆盖拉黑、未知字段、登录失效和限流。只记录脱敏结构和能力结论，不保存 Cookie 或真实参与人列表为单测样例。
- [ ] 关注检测正常是/否与方向验证是开放关注条件的前置要求，不能用“支持手动确认”替代；当前接口失败先修复并重测。点赞/转发分别检查分页、时间字段和时间单位，无可信事件时间不能开放有截止时间的活动条件。
- [ ] 将验证日期、账号角色、动态类型、页数、结束语义、已知限制和失败原因更新到报告的能力结论。若只能取得热门/截断名单，关闭该来源正式开奖能力。

测试例子（断言报告要求，不伪造已经实测的 B站响应）：

```js
const assert = require('node:assert/strict');
const { normalizeDynamicLink } = require('../src/bilibili/dynamic-lottery/link');
assert.equal(
  normalizeDynamicLink('https://t.bilibili.com/9007199254740993123').dynamicId,
  '9007199254740993123',
);
assert.throws(() => normalizeDynamicLink('https://bilibili.com.evil.invalid/opus/1'));
assert.throws(() => normalizeDynamicLink('http://127.0.0.1/opus/1'));
```

**验证：** `node --test test/dynamic-lottery-provider.test.js test/dynamic-lottery-session.test.js test/bilibili-wbi-signer.test.js test/bilibili-auth-profile.test.js`。首先观察新用例因能力缺失失败，实现后全部通过；真实来源验证单独记录，不以单测替代。

**退出条件：** 至少评论枚举和所需关注语义经验证可用，或报告明确指出本次环境不能交付哪一种活动。没有证据的来源不进入 M3 对外功能。

## Task 2 / M1：存储、调度和采集恢复

**新增：** `src/storage/dynamic-lottery-schema.js`、`dynamic-lottery-store.js`、`src/bilibili/dynamic-lottery/request-scheduler.js`、`collection-service.js`、`test/dynamic-lottery-store.test.js`、`test/dynamic-lottery-scheduler.test.js`、`test/dynamic-lottery-collection.test.js`。

**修改：** `src/storage/database.js`、`src/storage/database-migrations.js`、`docs/architecture/backend/storage.md`。

**接口：**

```js
createDynamicLotteryStore(lotteryDb); // -> 窄 store，迁移由数据库工厂完成
runDynamicLotteryMigrations(lotteryDb); // database-migrations.js 新增独立入口
// store.commitPage({ taskId, scanId, source, expectedCursor, page, sessionEpoch })
// store.getScan(scanId), store.getEvidence(scanId), store.getTask(taskId)
// store.requestBudget = { reserve(input), finish(input), setHold(input), get(input) }
createRequestScheduler({ fetchImpl, budgetStore, clock });
// -> { request({ scope, kind, url, init, signal }), pause(scope, reason), dispose() }
// clock = { nowMs(), sleep(ms, signal) }
createCollectionService({ store, provider, getContext, clock });
// -> { start({ taskId }), pause(taskId), resume(taskId), dispose() }
// start 只创建截止后正式批次；截止前仅准备规则。
```

- [ ] 在数据库工厂注册 `lotteryDb` 文件，通过独立 `runDynamicLotteryMigrations` 运行命名域 `lottery_db` 的 v1，创建报告列出的九类表与关联约束。members 保持每 UID 一条基础证据，orders 保存各作用域/批次的顺序，awards 独立记录每次授奖，避免跨奖项允许重复时覆盖领奖状态。新库打开和迁移单独捕获错误：关闭新连接、记录脱敏原因并返回 `lotteryDb: null`，由新 runtime 明确禁用功能。旧五库的初始化/失败路径和已有迁移步骤保持不变；schema 查询跳过不可用连接。
- [ ] 先测试分页事务：模拟写完证据、尚未更新游标时抛错，重开临时库后两者都未提交；再次提交同页只产生一份证据。写入前检查 taskId/scanId/来源/expectedCursor/sessionEpoch，防止旧请求覆盖新批次。
- [ ] 调度器只包装单个实际 HTTP 请求，不包装整个业务操作。provider 先 await 经调度的账号/签名辅助请求，再 await 分页请求，避免并发 1 时发生嵌套队列自锁。
- [ ] 出站前原子预留本机及账号预算；失败、重试都计数，缓存命中不计数。按报告实施请求间隔、批次休息、小时预算、429 探测及人工暂停；不对登录失败和验证挑战执行普通网络重试。
- [ ] 用可注入时钟验证限流，无真实 sleep。预算与最早恢复时间落盘，重新启动或删除活动不能重置；取消尚未出站的等待不能产生网络请求。
- [ ] 只在收到主播确认后提交的 collectFinal 操作且已经截止时，从首游标创建正式 scanId；不挂接截止时间的自动启动回调，移除 collectPreview 和 preview 模式。页提交后才推进检查点；游标失效就标记旧批次失败并重建，不能混合两个批次。按证据 occurredAtMs 判断报名时间，不能以请求/入库时间判断迟到；采集完成只更新为 ready，不调用 draw。
- [ ] 开始/结束每个请求时核对会话；切换账号时 abort 在途请求，迟到响应不得落盘。退出时关闭 timer 和任务，再关闭数据库。

分页核心顺序（伪代码，store 的 commitPage 是一个事务）：

```text
读取任务的来源检查点和当前可信会话
通过 provider 取得一页；每个 HTTP 已由 request-scheduler 调度
再次核对会话和活动版本
commitPage：断言旧游标 -> 按稳定键写证据 -> 更新游标/覆盖状态 -> 提交
只有该来源明确结束，才写 exhausted
所有必要来源 exhausted 后，最终批次才允许转 ready
```

**验证：** `node --test test/dynamic-lottery-store.test.js test/dynamic-lottery-scheduler.test.js test/dynamic-lottery-collection.test.js test/database-maintenance.test.js`。用 3 页合成输入覆盖重复置顶、重复游标、空异常页、时间过滤、取消、崩溃、重启和账号切换；检查无真实网络调用。

**退出条件：** 采集范围与进度可恢复、预算可解释、会话不串用、旧用户库升级及重复启动通过。此阶段不提供正式抽奖按钮。

## Task 3 / M2：规则、冻结与随机抽取

**新增：** `src/bilibili/dynamic-lottery/rules.js`、`draw-service.js`、`service.js`、`test/dynamic-lottery-rules.test.js`、`test/dynamic-lottery-draw.test.js`。

**修改：** `src/storage/dynamic-lottery-store.js`，添加轮次与核验/领奖事务；不更改已经发布的迁移步骤。

**接口：**

```js
makeDefaultRules({ startsAtMs, endsAtMs, ownerUid }); // -> Rules
buildCandidatePool({ evidenceBySource, coverage, rules, ownerUid });
// -> { members: [{ uid, evidenceId }], exclusions: [{ uid, reason }], unresolved: [] }
// unresolved 为缺失必要资格证据的 UID/原因；存在时不能完成冻结，不归入 exclusions
createUniformOrder(uids, randomIntFn); // -> UID[]，生产默认 node:crypto.randomInt
createDrawService({ store, provider, getContext, clock, randomIntFn });
// -> { freeze(input), start(input), actOnAward(input), getResult(input), dispose() }
createDynamicLotteryService({ store, collection, draw, provider, getContext, clock });
// -> Shared Interfaces 中列出的九个 facade 方法
```

- [ ] 按报告校验规则：不支持的条件、未来正式采集、无可靠时间的必要来源、零/负/小数名额、合计超过 100 个名额均失败。不允许跨奖项重复时比较总名额与池大小，允许时逐项比较；claimWindowHours 只接受 null 或正整数小时，replacement 只接受 none/ordered/random。名单/规则已锁定后不允许原地修改。
- [ ] 实现“先筛评论，后按 UID 去重”，不同 UID 的同文口令均保留；按最早合格评论确定展示证据。范围缺失时不生成候选池。
- [ ] 冻结保存规则副本、final scanId、规范化 UID 集合及 SHA-256 摘要。摘要输入格式为固定版本的规则序列化及排序 UID 列表；报告明确该摘要只检查记录一致性，不能证明未暗中重抽。
- [ ] Fisher–Yates 使用 `crypto.randomInt(0, i + 1)`，不使用随机 sort。不允许跨奖项重复时共用一个活动顺序；允许时按奖项依次生成独立顺序，不把同一排列从头复用于所有奖项。每批完整顺序提交前不查询其关注、不展示候选；提交后任何重试沿相同顺序继续。
- [ ] 逐个核验候选。明确不符合者记录当前作用域及理由并推进；未知者保存当前批次/索引并暂停；已通过者按奖项顺序授奖。资格、名额占用、授奖与推进索引在同一事务完成；根据设置检查全活动或单奖项的历史中奖 UID。按活动串行推进，不跨过暂停批次。
- [ ] 领奖、放弃、逾期和补抽追加事件，操作指定 awardId/批次而不只指定 UID。初抽须整轮确定后才可 publish，补抽须对应批次完成后才可 publish；公示时间不能晚于当前时间。时限为 null 时无截止且 expire 返回 409，否则每批分别从公示时间计算，未到期 expire 返回 409；仅切换网页公示模式不启动领奖计时。
- [ ] 补抽只接受已记录放弃/逾期的空缺。none 拒绝；ordered 继续对应活动/奖项原序未处理部分；random 从冻结池排除所选作用域内曾中奖、已明确核验不合格的 UID，再创建有独立 requestId 的 generation。新补抽序列先保存再查关注，不能通过失败重试重新随机。补抽获奖记录通过 replacedAwardId 关联旧记录，各名额至多一条有效授奖。
- [ ] 所有写操作检查 expectedRevision；同一个 requestId 同参返回旧结果、异参拒绝。整轮中止保留原记录，不能以中止重置为新的随机顺序。

规则测试例子：

```js
const assert = require('node:assert/strict');
const { makeDefaultRules, buildCandidatePool } = require('../src/bilibili/dynamic-lottery/rules');
const rules = makeDefaultRules({ startsAtMs: 0, endsAtMs: 1000, ownerUid: '999' });
rules.keyword = { mode: 'equals', value: '参加抽奖' };
const records = [
  { source: 'comment', recordId: '1', uid: '101', occurredAtMs: 10, text: '来了', parentId: null, level: 3 },
  { source: 'comment', recordId: '2', uid: '101', occurredAtMs: 20, text: '参加抽奖', parentId: null, level: 3 },
  { source: 'comment', recordId: '3', uid: '102', occurredAtMs: 30, text: '参加抽奖', parentId: null, level: 2 },
];
const pool = buildCandidatePool({
  evidenceBySource: { comment: records }, coverage: { comment: 'exhausted' },
  rules, ownerUid: '999',
});
assert.deepEqual(pool.members.map((member) => member.uid).sort(), ['101', '102']);
```

公平性测试采用可枚举的小样本性质，不依赖随机跑很多次的概率阈值：

```js
const assert = require('node:assert/strict');
const { createUniformOrder } = require('../src/bilibili/dynamic-lottery/draw-service');
const permutations = new Set();
for (let first = 0; first < 3; first += 1) {
  for (let second = 0; second < 2; second += 1) {
    const picks = [first, second];
    const order = createUniformOrder(['1', '2', '3'], (min, max) => {
      const pick = picks.shift();
      assert.ok(pick >= min && pick < max);
      return pick;
    });
    assert.equal(new Set(order).size, 3);
    permutations.add(order.join(','));
  }
}
assert.equal(permutations.size, 6);
```

**验证：** `node --test test/dynamic-lottery-rules.test.js test/dynamic-lottery-draw.test.js test/dynamic-lottery-store.test.js`。以固定顺序 `[101,102,103]` 验证：101 不符合、102 未知、103 符合时停在 102；重启后先核验 102。用两个奖项覆盖跨项重复开/关、池大小只满足单项的不同结果、三种补抽设置、关闭领奖时限和补抽批次独立截止。补抽随机源调用次数在重试/恢复后不增加；并发双击、授奖后断连、同键异参和发布重试均需覆盖。时间用例包含截止前一秒、截止时刻、后一秒，以及次日采集仍使用同一截止。

**退出条件：** 每条 P0 规则有可解释输出，均匀无放回性质成立，恢复/补位不会改变已提交机会。

## Task 4 / M3：桌面与独立网页、导出和清理

**新增：** `src/server/dynamic-lottery-runtime.js`、`src/server/routes/dynamic-lottery-routes.js`、`public/pages/admin/toolbox/dynamic-lottery.html`、`public/js/admin/dynamic-lottery.js`、`public/css/admin/other-features/dynamic-lottery.css`。

**网页新增：** `src/server/dynamic-lottery-presentation.js`、`public/pages/dynamic-lottery.html`、`public/js/dynamic-lottery/index.js`、`public/js/dynamic-lottery/poster.js`、`public/css/dynamic-lottery.css`。独立端口只提供明确列出的页面/脚本/CSS 及两个 API，复用本地 CSS token，不使用通用文件服务或管理页面的 token 注入。

**修改：** `src/electron/main.js`、`src/server.js`、`src/server/api-routes.js`、`src/server/api-context.js`、`src/server/runtime-api-context.js`、`src/server/admin-page.js`、`public/js/admin/app.js`、`public/pages/admin/toolbox/shell-start.html`、`public/css/styles-admin.css`。在 shell-start 的直播互动组添加 `data-other-feature` 按钮，对应新片段的 `data-other-feature-panel`；沿用 `other.js` 的现有发现与切换机制，不改其侧栏算法。

**清理接入：** `src/storage/database-maintenance.js`、`src/storage/database-clear-coordinator.js`、`src/storage/database-clear-operations.js`、`src/storage/database-clear-result.js`、`src/server/domain-services.js`、`src/server/api-context.js`、`src/server/routes/data-routes.js`、`public/js/admin/settings-operations.js`。沿用 `clearAllData` 的既有位置参数，通过可选 options 传入新库和可信当前所属范围；不从 HTTP 请求接收数据库或所属身份。数据路由调用新 runtime 的暂停/等待能力后才清理，不只暂停旧礼物/加班机写入器。

**新增测试：** `test/dynamic-lottery-routes.test.js`、`test/dynamic-lottery-runtime.test.js`、`test/frontend-dynamic-lottery.test.js`、`test/dynamic-lottery-export.test.js`、`test/dynamic-lottery-presentation.test.js`。

**接口：**

```js
createDynamicLotteryRuntime({ db, authSession, clock, fetchImpl });
// -> { service, actOnPresentation(input), dispose() }
// 仅 runtime 接收基础设施；网页模块经以下窄回调复用同一领域服务。
createLotteryPresentation({ getState, draw, validateSession, nowMs, randomBytes });
// -> { open({ roundId, mode, trustedScope }), revoke(input), dispose() }
// 首次 open 才监听 127.0.0.1:0，返回实际端口和 fragment 凭据组成的 URL。
initDynamicLottery({ root, api }); // 命名 ESM；-> { dispose() }
// api 使用现有本地鉴权请求；不直连 B站，不接收 Cookie 或未来候选顺序
initLotteryPresentation({ root }); // 独立网页 ESM；-> { dispose() }
renderLotteryPosterPages(resultSnapshot); // 浏览器 Canvas，固定快照逐页生成 PNG
```

- [ ] 按报告的九个主服务固定路径注册，保持全部鉴权，不改 PUBLIC_API_PATHS。创建返回 202 与草稿 ID，解析由任务执行；更新/开始长操作返回任务状态，UI 通过本地 GET 查询，不保持数十分钟 HTTP 请求。
- [ ] 接入授权与会话 adapter；历史查询先按可信 streamerId 检查所有权，展示记录绑定的 ownerUid；在线操作额外要求当前已验证 B站 UID 匹配。旧账号历史可以只读，不因 B站登出删除或泄露给其他 LIRA 主播；跨主播返回 404。普通独立服务模式不能绕过桌面凭据边界。
- [ ] UI 提供活动规则、采集名单、开奖领奖三块区域。重复中奖用允许/不允许，补抽用关闭/沿原顺序/重新随机，领奖时限用开关与时长；解释例子按报告生成，锁定后只读。截止前提示何时可采集，不出现必须先预览的步骤。其余 loading、空名单、未知总量、名单不全、身份失效、限流、核验暂停、完成和中止均有具体文案。
- [ ] “采集名单”先显示包含动态、截止时间及当前规则的确认弹窗，确认才提交带 expectedRevision 的 collectFinal，取消不提交。推进时钟越过截止、首次打开页面、轮询和重启均不启动名单采集；完成采集或打开独立网页也不自动调用 draw，须点击“开始开奖”。用对应前端/任务用例断言这些操作没有触发名单读取或随机抽取；链接解析所需的详情读取单独计量。
- [ ] 页面可见且任务运行时每 2 秒读取本地摘要；离开页面取消轮询，重新进入恢复读取。点击暂停立即显示操作已提交，1 秒内反馈本地状态；候选动画不能触发额外随机或关系请求。
- [ ] 名单每页 50 条，文本使用 textContent。未做全员核验时显示“未核验”，不能以参与人数作为合格粉丝数；状态筛选仅作用于已知本地证据。
- [ ] 增加“在浏览器开奖”和“只展示结果”按钮，向已鉴权 POST /presentation 请求后端生成 URL，再沿用现有窗口打开策略交给系统浏览器。新端口绑定回环、按固定表服务资源与 API，主服务 session token 不传入此模块。监听失败仅影响网页入口，软件内已准备的抽奖任务可继续。
- [ ] 会话使用 32 字节随机凭据、内存绑定轮次/身份/权限/epoch 和 4 小时有效期，URL fragment 仅供首次交接；网页移入当前标签页 sessionStorage 后清理地址栏，请求通过认证头传递。实现 Host/Origin、禁止 CORS、no-store/no-referrer 和 CSP；禁止任意文件路径和 iframe 嵌入，不把凭据输出到异常/URL日志中。
- [ ] 独立 GET state 只返回 PresentationState，POST action 仅允许 control 会话的 draw；runtime 从会话恢复可信身份并执行与桌面相同的当前权限、revision、截止/冻结、冷却及幂等检查。display 会话写操作返回 403，未知轮次/跨范围不能借请求参数切换目标；网页不提供规则修改、领奖或补抽接口。
- [ ] 网页展示开奖前、核验中、暂停、完成和失联状态。页面可见时每 2 秒轮询本地，包括完成后继续接收补抽更新；隐藏时停止，返回页面立即取最新版本。同一轮两个网页与桌面同时开始只产生一份顺序；刷新不重抽，关闭网页不取消任务。软件内发起补抽后，同步显示新批次进度。
- [ ] 公示模式隐藏所有操作栏，但不会自动标已发布。正式 PNG 只从完成批次的一次固定结果快照生成，1920 × 1080 自动分页并标版本与页码；Canvas 排版测量文字宽度、换行长昵称，保留 UID 和奖项。使用系统中文字体和本地绘制，不加载远程图片污染 Canvas；逐页保存、逐页释放资源，不批量触发浏览器拦截的自动下载。
- [ ] 公示 CSV 仅含轮次、奖项、中奖 UID/昵称、公示及核验时间；转义逗号、引号、换行和公式前缀。完整 JSON 作为显式本地留档选择，包含规则、来源范围、证据/候选记录，排除凭据与原始 HTTP 头。
- [ ] 所有活动删除先撤销对应网页会话、暂停/终止在途操作，按所属范围事务删除；新增抽奖数据的全局清理沿用现有协调器与部分提交报告。清理确认文案列出新范围，冷却预算保留；不得发生“界面说清空成功、抽奖记录仍在”的不一致。
- [ ] 组合根按照“撤销网页会话与停止接收新请求 → 取消任务与网络 → 等待已开始的短事务 → 释放任务和展示端口资源 → 关闭数据库”结束，不调整现有播放器 flush 与 Electron 安全顺序。身份切换也撤销相关网页会话；重启不恢复旧凭据。

路由拒绝用例明确包含：无 token、无桌面主体、错误 streamerId 所属任务、伪造 ownerUid、旧 revision、未知 action、同一 requestId 不同参数，以及未完成来源时调用 draw。测试必须断言拒绝后既无上游调用也无存储变更。

展示端口另覆盖：未绑定任意网卡、错误 Host/Origin、读凭据调用 draw、控制凭据调用非白名单动作、跨轮次参数、过期/撤销/登出/重启凭据、路径穿越及获取 /admin。确认主服务拒绝展示来源跨域读取，页面/资源/报错不包含管理 token、Cookie 或未中奖名单；不能只测“界面没有按钮”。

**验证：** `node --experimental-vm-modules --test test/dynamic-lottery-routes.test.js test/dynamic-lottery-runtime.test.js test/frontend-dynamic-lottery.test.js test/dynamic-lottery-export.test.js test/dynamic-lottery-presentation.test.js test/admin-page-composition.test.js test/toolbox-sidebar.test.js test/database-clear-all.test.js test/data-clear-all-recovery.test.js test/server-lifecycle.test.js test/electron-main-modules.test.js test/local-media-access.test.js`。

**退出条件：** 在真实 Electron 中用专门测试账号完成评论+关注、暂停恢复、按所选方式补抽，并从较小软件窗口打开系统浏览器全屏开奖。验证双页/桌面并发后结果一致；用 100 个合成名额及长昵称检查每页 PNG 清晰、无漏人/截字/版本混合，现场截图不含凭据或内部名单。记录浏览器和 LIRA 的资源增量；不拿真实用户数据做压力测试。

## Task 5 / M4：经过验证后增加其他条件

**修改：** 前述 provider、rules、collection-service、service、UI 与对应测试；不引入第二套采集/随机实现。

- [ ] 点赞/转发各自读取 M0 能力结果，验证全部必要来源的遍历、可信事件时间和未知类型处理；通过后启用主要来源及交集条件。无可信时间则禁用截止活动中的该条件，不允许静默改成采集时可见。统计次数不能代替名单，只有前几页不能作为完整来源。
- [ ] 联合条件按 UID 集合计算，每 UID 仍一次；重复来源只抓一次。同一互动接口若混合返回点赞与转发，共用一次扫描，但分别记录覆盖结论。未知任一必要条件不自动取消该条件。
- [ ] 增加显式全员关注核验，先给出按未核验人数计算的请求量和时间；与其他任务共享预算，支持暂停，结果包含 checkedAtMs，不声称等于开奖时全员状态。正式候选核验仍取得当次证据。
- [ ] 仅在列表提供可信等级时增加可选等级下限；字段缺失者停在待核验，不以 0 代替。默认关闭该筛选。
- [ ] 楼中楼能力具备明确线程分页和结束语义后才开放；按线程完整遍历，仍先筛评论再 UID 去重。批量请求费用必须计入预估，不能只采用顶层返回的回复预览。

交集验证例：评论 UID `{1,2,3}`、转发 `{2,3,4}`、点赞 `{3,4}`，三条件均已完成时只有 UID `3` 入池；点赞来源 partial 时应拒绝生成正式池，不能返回空池或仅按前两个条件开奖。

**验证：** 重新运行 provider、collection、rules、scheduler、draw 和 frontend-dynamic-lottery 聚焦测试，并用专门动态核对启用的每一来源。未具备证据的增强能力保持不可用，报告写明限制。

## Verification and Release Evidence

每个任务先写必要的行为测试，看到预期失败后实施最小变更；不要用真实网络代替确定性测试。上面给出的命令在其对应新增文件存在后执行，不应在本次仅编写文档时运行不存在的测试。

M3 涉及身份、持久化、生命周期和清理合同，需要以下最终检查；M4 若未改这些合同，优先使用受影响检查。

```powershell
npm run verify:docs
npm run check
npm run verify:architecture
npm run verify:modularity
npm test
git diff --check
git status --short
```

同时更新实际新增的主服务/展示端口 HTTP 注册表、数据库及迁移事实、桌面登录/生命周期接入、前端页面入口与 AI 路由表中的 literal paths。不要因增加新模块直接扩大模块大小基线或标记未验证能力 Implemented。

性能记录至少包含 CPU 型号、内存、系统、Node/Electron/浏览器版本、OBS 是否同时运行、样本量、LIRA 与浏览器分别的内存/CPU 增量、事件循环延迟和暂停响应。按报告的 10,000 名目标及 100,000 名本地压力样本验证，另测多页公示图生成；既有系统卡顿不能简单归为显卡不足，新增模块超出目标则优化分批处理后重测。

## Rollback Or Failure Handling

验证阶段来源不支持：关闭对应能力，保留能力结论；不通过代理池、切换账号或抓热门样本继续开奖。

开发失败：停止本模块 runtime；只恢复当前任务拥有的代码差异，不使用 reset/blanket checkout。新库保存，不删除历史来回退；迁移只追加修正，旧版本不识别的新库不得自动销毁。

升级/运行时失败：未开始的任务暂停；已冻结的记录可查看；需要在线资格但接口不可用时保持待核验。抽奖数据库初始化失败时禁用新功能并给出具体原因，处理所有已打开连接；不得带着未迁移的 store 运行，也不应因可隔离的新功能故障关闭点歌与播放。

新增数据库按 Task 2 采用独立初始化错误边界；`lotteryDb: null` 时 runtime 返回明确不可用状态并阻止创建任务，不能把异常吞掉后返回正常 store。故障注入覆盖打开失败、迁移失败和关闭，原五库的既有错误语义不受影响。

## Done When

- [ ] 报告中适用于交付阶段的规则与验收项目都有对应实现和通过证据，来源能力结论已更新。
- [ ] 截止后采集及迟到排除、准确关注检测、异常恢复、开奖幂等、重复中奖与领奖/补抽选项完成端到端验证。
- [ ] 独立浏览器全屏开奖、多页公示 PNG、桌面同步、限定本轮的控制/只读权限及会话撤销得到验证。
- [ ] 多账号所属范围、凭据隔离、清理与迁移、退出顺序和资源目标得到验证。
- [ ] 最后一次差异、状态与检查结果已记录，没有混入其他任务内容、运行数据或秘密。
- [ ] M3 仅评论/关注通过时将规格标记 In Progress，注明已交付能力；用户接受范围全部验证后才标记 Implemented。上游受限而缺少已接受能力时保留 In Progress 并说明，除非用户明确调整范围。
- [ ] 仅在用户明确要求时提交或发布；计划完成后按仓库规范移至 `specs/plans/archive/`。
