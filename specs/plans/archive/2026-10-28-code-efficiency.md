# 2026-10-28 代码效率候选实施计划

> **For agentic workers:** 按本计划的独立 owner 并行实施，由主代理整合与验收；遵循仓库现有工具与风险分级，不引入额外执行框架。

**Status:** Completed

**Goal:** 按 `tmp/code-efficiency-audit-2026-10-28.md` 复核报告减少已确认的重复工作，保持统计结果、授权、安全、编辑隔离和弹幕时序。

**Architecture:** 修改现有 owner 内部实现，保留模块化单体、现有端口与协议。按统计存储、场景服务、弹幕输出、管理端四组划分文件所有权，主代理统一维护文档和最终验证。

**Tech Stack:** Node.js 24+、SQLite、Vanilla JavaScript ESM/CommonJS、Electron 43、node:test。

## 约束与范围

- 用户授权按照复核报告并行修改；初始工作区 `git status --short` 为空。
- 不改变 HTTP/WS/IPC、持久化格式、设置键、数据归属或鉴权；不新增依赖、进程、缓存层或框架。
- E-03、E-05、E-11 已被报告撤回，不删规范化后总大小检查、输出完成授权复核或未证明等价的布局测量。
- 保留手势基准克隆、撤销/重做、cold migration 的账号检查与最终读取、统计读事务及 retention summary 合并。
- E-04、E-09、E-13、E-14 与 D-01～D-05 是可选项；只有局部实现足够简单且证据充分时处理，其余记录理由。
- 不使用真实用户数据、账号或外部服务；测试产物统一放仓库 `tmp/`。不提交、建分支、发布或重启用户应用。

## 当前行为与所有权

| 分组 | 报告项 / owner | 消费者与验证 | 文档 owner |
| --- | --- | --- | --- |
| 统计 | E-01；`src/storage/gift-query-store.js` | gift query/statistics service；`test/gifts/gift-query-service.test.js`、`test/gifts/gift-statistics-service.test.js`、既有隔离查询探针 | `docs/reference/backend/storage.md`；B1 未结项 |
| 场景服务 | E-06、E-07、E-08；`src/scenes/scene-service.js`、`src/scenes/cloud-display-buffer.js`、`src/server/danmaku-appearance.js` | scene runtime/output、appearance callers；对应 scenes/danmaku tests | `docs/reference/backend/ws.md`、场景/弹幕 owning reference |
| 弹幕输出 | E-10、E-12；`public/js/overlays/danmaku.js`、`public/js/overlays/danmaku-floating.js` | legacy WS、floating feed；`test/danmaku/` 对应 suite 与真实播放 | `docs/reference/frontend/danmaku-motion.md`、`docs/reference/frontend/overlays.md` |
| 管理端与可选清理 | E-02、可选 E/D 项；`public/js/admin/scene-document-model.js` 及报告列出的各 owner | 场景模型/controller、回复规则编辑器、诊断页及导出消费者 | `docs/reference/frontend/app.md` 等现有事实 owner |

报告提供操作计数及既有测试证据，但没有证明生产性能故障。E-01 的三个聚合承担不同结果，先比较方案和收益；E-10/E-12 保留等待、移除、上限与权威快照语义。

## 并行里程碑

### 1. 统计查询（代理一）

- [x] 检查过滤、summary/top/bucket 分组、retention summary 合并与隔离探针。
- [x] 在现有 store 内比较最小等价方案；只有结果一致且合成成本有改善才保留实现。
- [x] 运行 gift query/statistics 相关测试与相同规模前后探针，报告 SQL、结果和计时限制。

### 2. 场景服务（代理二）

- [x] 只投影 visible 输出条目的外观，保留 component 目标强制可见。
- [x] 对同 epoch 无变化 connecting/offline 返回无更新，保留 reset、旧连接拒绝和事件处理。
- [x] warm appearance read 复用第一次结果；cold migration 保留最终读取与 binding 检查。
- [x] 复用既有 tests，覆盖隐藏→显示、epoch 与 warm/cold 边界。

### 3. 弹幕输出（代理三）

- [x] 合并同帧 floating 追加后的测量，保留新条目占位、等待和移除时序。
- [x] legacy 未变外观跳过 setter；仅在严格等价的尾部追加情形复用 append，其余走权威 render。
- [x] 运行相关 feed/floating/snapshot/style tests，并提供真实播放的密集到达与文本稳定证据。

### 4. 管理端与可选项（主代理）

- [x] E-02 在 change 内建立旧条目索引，保留克隆、验证和通知隔离；运行 scene model/notification tests。
- [x] 全仓确认 D-01～D-05 消费者后删除确实无用的包装/导出，保留有用工厂和内部 helper。
- [x] 评估 E-04、E-09、E-13、E-14 的最小改动；不为计数引入复杂接口、长期索引或细粒度订阅协议。

## 整合与验证

- 每位实施者先复现所属问题，再检查 touched diff 并运行受影响 tests；不得修改其他分组拥有的文件。
- 主代理统一维护本计划与当前文档，检查技术事实与用户指南影响；公开操作不变时说明无需更新指南。
- 待所有代码停止编辑后运行受影响 suites 的联合验证，使用 `node --experimental-vm-modules --test` 和明确文件列表；不因跨文件而默认运行全仓 suite。
- 运行 `npm run check`、`npm run verify:docs`；实现碰到模块边界或新增模块时再运行对应架构门禁。
- 最终检查 `git diff`、`git diff --check` 与 `git status --short`，确保无运行数据、秘密或意外文件。

## 失败处理与完成条件

方案不等价或收益不足时只撤销本任务自己的局部修改并记录证据，保留现有 owner 与安全检查，不使用破坏性 Git 回滚。

全部实施项通过对应行为验证；候选有明确处置与证据；运动代码完成实际播放验证；技术事实及用户说明无误导；最终差异已审查，才关闭本计划。

## 实际结果

### 逐项处置

| 报告项 | 实际结果 |
| --- | --- |
| E-01 | 单次请求用 MATERIALIZED CTE 共用筛选行，保持三种 SQL 聚合、原指标算法和 retention 合并。12 组来源、时间范围与文本筛选对照结果严格一致；查询计划由 3 次访问 gift_events 改为 1 次及 3 次请求内结果扫描。 |
| E-02 | change 内建立旧条目 Map；32 项共享 clock 手势探针的 find predicate 从 1056 降至 528，JSON 克隆/序列化次数保持原样，撤销与通知隔离测试通过。 |
| E-06 | 外观只读取已发布可见条目；单组件强制可见、隐藏后重新显示发布的当前外观均有覆盖。 |
| E-07 | 同 connectionEpoch 的重复 connecting/offline 不再产生变更通知；新 epoch、旧事件拒绝和 owner 隔离保留。 |
| E-08 | warm read 从 2 次 store.get 降到 1 次；cold migration 仍等待完成、复核 binding 并读最终配置。 |
| E-10 | floating 的 appendBatch 在本帧整批加入后测量；50 项加 10 项的 width/height getter 总数从 1000 降到 100。单条追加仍同步，容量、等待、退出与销毁保持。 |
| E-12 | 仅 legacy WS 短路未变规范化外观，完整前缀匹配的纯尾部快照复用 append；其他快照仍权威 render。非 legacy 仍保持原单次外观规范化路径。 |
| E-13 | clean 且同原始输入的规则列表跳过重建，编辑与 reset 失效；保留 dirty/saving 与发送后状态刷新。 |
| E-14 | 每次 merge 临时建立 ID Set，保留首条、批内去重和顺序；不维护长期索引，也不改变原裁剪规则。 |
| D-01～D-05 | 全仓与 namespace 消费核查后删去两个 toast 包装、CSS 常量和两个未用 helper 导出，保留工厂与 countCoveredDays 等有效内部实现。 |
| E-04、E-09 | 保持可选观察。保存读入仍承担浏览器源解密失败语义；range 刷新涉及重新显示后的几何，报告没有实际瓶颈或等价省略证据。不为低频计数新增存储接口或几何缓存。 |
| E-03、E-05、E-11 | 按复核报告撤回结论，不修改。规范化前后总上限、同步重入后的输出授权复核及原尺寸测量保留。 |

### 成本对照与运行时

隔离磁盘 SQLite、20 类礼物、混合盲盒、每档 7 次读取，后 6 次中位数如下；不是冷磁盘或 Electron 实测预算。

| 行数 | 原统计 | 共用筛选行 |
| ---: | ---: | ---: |
| 10000 | 40.51 ms | 33.58 ms |
| 50000 | 712.40 ms | 457.04 ms |
| 100000 | 1436.46 ms | 913.81 ms |

未采用进一步的指标预计算，以保留现有异常与溢出处理。B1 的剩余桌面主线程预算在 `specs/plans/open-items.md` 继续跟踪，不引入 worker。

Chromium headless 1280×720 实际播放 floating/comet 密集到达、长正文、礼物和加载完成的表情；旧节点和 Animation、正文宽高、字号及 top 均稳定，SC 保持排除。实际 `/danmaku` WS 尾部快照保留旧节点，更正内容触发重建，pageerror 为空。浏览器/context 和两个自有预览 server 已关闭；没有使用或重启用户应用，没有 OBS/哔哩哔哩直播姬真实直播验收。

### 已执行验证

- 23 个受影响文件联合 `node --experimental-vm-modules --test`：363 项通过，0 失败、0 跳过。覆盖 gift query/statistics/retention、scene service/display/browser-source/runtime-events/cloud-controller、appearance、floating/snapshot/feed-motion/style、scene model/notifications、gift audit、两个 toast 工厂、会员和 Bilibili helper 消费者。
- `node --test --test-name-pattern='CustomReply' test/danmaku/danmaku-panel-edit-state.test.js`：8 项通过，覆盖 clean 重复加载、保存/失败、并发编辑和 reset。
- 最后收窄非 legacy 路径后，floating、snapshot-stability、feed-motion、style-options、local-preview 五份测试重新运行：109 项通过。
- 代理额外验证 `danmaku-feed-buffer.test.js` 与 `frontend-danmaku-overlay-filters.test.js`，与相关四份 suite 合计 97 项通过；这些数字有重叠，不相加为独立用例数。
- `npm run check`：1680 份 JS 语法检查通过，其中实际执行 23 份、复用已有有效证明 1657 份。
- 技术参考同步 API 的可见外观投影、storage 查询实现、overlays 的批量与 legacy 快照行为、app 的规则加载；测试补足实际风险。用户入口、步骤、设置与可见限制不变，使用指南与应用内引导无需修改。
- `npm run verify:docs`：10 项通过；`git diff --check` 通过，最终差异与状态已审查，只有本任务源码、测试和文档。没有提交、打包、发布或访问真实账号/生产数据。

隔离探针、联合测试日志、截图与 JSON 均位于仓库 `tmp/code-efficiency-implementation-2026-10-28/`，不进入受维护源码；原审计报告继续描述修改前基线。
