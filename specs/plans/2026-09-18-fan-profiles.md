# Fan Profiles Implementation Plan

**Goal:** 按首发范围交付本地私密粉丝档案及可靠自动联动。

**Architecture:** 同一 songDb 中原子记录成功点歌；独立档案领域服务经窄 IPC 提供给主窗口。Server 持久化租户内身份/会员事实，经设备认证的增量 API 传给桌面。

**Tech Stack:** Node.js 24+、Electron 43、SQLite、Vanilla JS ESM、原生 CSS；不新增依赖。

## 约束与现状

用户报告有未提交修改，保持原样。Server 有既存未跟踪 `.impeccable/`，不改动。旧 requests 无归属，通用本地 token 被 OBS 共用；因此私人档案走主窗口 IPC，旧记录先确认归属。精确期限仍缺上游证据，首发同步上舰观察并提供人工有效期。无提交、分支或部署。

## 里程碑

- [x] 存储与领域：`src/storage/fan-profile-migration.js`、`fan-profile-store.js`、`fan-record-store.js`；`src/fans/profile-service.js`、`validation.js`、`membership.js`、`reminders.js`、`dates.js`。接口 `createFanProfileService({store, now})` 返回 `execute(scope, action, input)`；store 事务同时提交记录和游标。验证迁移重入、身份隔离、修订与会员/提醒口径。
- [x] 点歌：requests 追加稳定 UUID/归属/身份类型；queue store 在成功事务内保存完整快照，拒绝请求无档案副本。验证清理后仍可读、编号重用不误去重、旧流水显式认领、原始事实修订。
- [x] 私有 IPC 与备份：主窗口来源校验；controller 固定授权代次；完整备份预览/恢复前快照；列表字段导出。验证跨账号、外部 frame、OBS 和过期异步响应无法读写。
- [x] Server 事实契约：租户持久化、稳定事件 ID、身份命名空间、游标恢复；更新 requirements/acceptance/protocol/OpenAPI/fixtures，双方协议测试。验证重放、隔离、旧服务兼容和无期限观察。
- [x] 桌面界面：百宝箱入口、档案/提醒、同一个概览/互动/音乐/大航海面板、已有记录编辑、备份恢复及点歌快捷入口。验证虚构资料端到端与普通桌面宽度，失败保留输入。
- [ ] 收尾：更新归属文档，执行直接受影响测试、`npm run check`、`npm run verify:architecture`、`npm run verify:docs`、`npm test` 与 Server 相关测试；检查 diff、`git diff --check`、`git status --short`。

## 验证例子

```js
// 隔离数据库，虚构身份；截至 09-18 不应把年底计入当前天数。
assert.equal(summarizeMembership(records, '2026-09-18').totalDays, 18);
// 同一稳定事件重复提交只留一份；账号 B 无法读取账号 A 的档案。
assert.equal(service.execute(scopeA, 'detail', { id }).songs.length, 1);
assert.throws(() => service.execute(scopeB, 'detail', { id }));
```

## 失败与回退

迁移在 SQLite 事务内失败回滚；不删除现有数据。人工保存使用修订号避免迟到覆盖，失败保留表单。未知远端能力保留本地功能并标明同步不可用。备份恢复有持久化前快照；失败整批回滚。仅审阅/撤销本任务 diff，不执行 destructive reset 或 blanket checkout。

## Done When

首发验收通过、私密边界保持、两端契约一致、测试与最终 diff 审查完成。文档记录无法获得的上游证据和真实运行环境限制，不将模拟验证当成生产验证。

## 执行记录

2026-09-18：确认实施范围与 IPC 隔离方案；直接事务归档优于引入可丢失的事后回调，不增加后台归档队列。

2026-09-18：第一、二阶段实现完成。列表、编辑、提醒、转移/恢复、会员计算与 Server 事实导入分别留在其所属模块；所有新增源文件小于 600 行。相同 UID/open_id 严格分开，队列状态变化使用同一数据库事务更新历史副本，但“已处理”不推断为“已演唱”。补录累计天数不生成没有历史日期依据的较小里程碑提醒。分页中迟到的旧会员事实附带最新身份快照，避免自动建档时倒退昵称。

### 验证结果

| 检查 | 实际结果 |
| --- | --- |
| Live：`node --test test/fan-profiles-*.test.js` | 76/76 通过；覆盖 A01–A30 对应的身份、修订、日期、提醒、归档、恢复及 IPC 行为 |
| Live：受影响的迁移、退出顺序、Electron 模块及 license gate 测试 | 37/37 通过 |
| Live：`npm run check` | 873 个 JavaScript 文件语法检查通过；最后的日期/协议修正另跑受影响语法检查及上述 76 项测试 |
| Live：`npm run verify:docs` | 前次 5/5 通过；最终重跑为 4/5：并行工作新增 `specs/cloud-daily-bots.md` 尚未登记索引。本任务的粉丝档案规格已登记，未改动其他任务的规格 |
| Live：`npm run verify:architecture` | 21 项通过，1 项失败：既有并行改动中的 `test/ui-edit-state.test.js` 为 833 行，超过其评审上限 739；本任务未修改该文件或放宽其上限 |
| Live：`npm test` | 2374 项，2369 通过、4 跳过、1 失败；唯一失败同上。此次全量运行之后的日期/分页修正已由 76 项聚焦测试重新验证 |
| Server：`npm test` | 1631/1631 通过；最后格式整理后再跑事实协议及契约治理测试，31/31 通过 |
| 两端最终范围检查 | 已检查本任务 diff、`git diff --check` 和工作区状态；保留无关修改与未跟踪文件 |

Live 全量测试采用环境变量 `LIRA_SERVER_ROOT=D:/Work/lira-audit/current-review-2026-09-18/remediation-2026-09-18/server-contract-fixture`，指向现有、匹配 `server-contract.lock.json` 的契约夹具工作区；该固定版本的五项兼容夹具检查通过。新增 fan-facts v1 另由两端相同虚构夹具验证。未擅自更改锁定版本、创建提交或部署 Server。

### Electron 桌面验收记录

使用真实 Electron 43、应用预加载和主窗口 IPC、隔离临时 SQLite 与虚构身份，在 1280×860 窗口验证；没有连接真实账号资料。以下为实际检查，不代表生产账号或真实平台流量验收。

| 行为/状态 | 功能与界面证据 |
| --- | --- |
| 百宝箱导航、列表、四个详情页、长昵称 | 进入档案并切换概览/互动/音乐/大航海；双栏布局可用，无横向页面溢出 |
| 新增及编辑记录 | 表单保存后详情更新；制造并发修订冲突后显示错误且保留未保存输入，取消不会覆盖新版本 |
| 基线与提醒 | 只填天数及截至日期可以保存；生日提醒处理后进入历史。最后发现的补录较小里程碑问题以领域回归测试验证修正 |
| 完整备份与恢复 | 导出实际 JSON 文件；导入显示两份冲突，明确选择替换后恢复成功，并保留恢复前快照 |
| 点歌快捷档案 | 已有档案打开、切音乐页、返回后队列保持；新身份建档后直接显示快捷档案；展开进入同一详情。修复隐藏百宝箱容器使对话框不可见的问题 |
| 音乐摘要有/无资料 | 有成功点歌记录时显示单行摘要；新建空资料档案不显示音乐空卡片 |
| 渲染错误与视觉检查 | 实际桌面截图确认快捷档案可见，测试期间无 pageerror；设计规则扫描无发现 |

### 待完成门禁与发布限制

收尾门禁仍因上述无关文件长度、并行新增规格索引失败而保持未勾选，计划不归档、规格不标记 Implemented。功能实现与其直接检查已完成；应由对应并行改动的负责人处理后重跑相关门禁。未使用真实直播验证；自动事实同步需要后续部署本次 Server 改动，旧 Server 不支持时保持本地功能并提示同步不可用。上游无经核实的会员期限时仍只保存观察事实，不估算到期日。第三阶段、外部表格导入、云端私密资料同步不在本次范围。
