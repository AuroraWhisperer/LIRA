# 后端重复计算第二轮审计与修复计划

Status: Complete

## 目标

继续用户要求的全量审计，并按“全部修复”完成本轮确认的非必要重复计算。沿真实入口核查调用次数、冷/热状态和失败恢复，用合成数据验证收益和行为等价；未经验证的候选不计为缺陷。前一轮五项修复及证据见 [归档计划](2026-11-08-backend-redundant-work-fixes.md)。

## 边界与兼容

只处理本仓库客户端及其 Node 后端，不改远程 Server，不提交、发版、操作真实用户数据库或正在运行的桌面。保持现有公共 HTTP/WS/IPC 兼容、持久化格式、认证隔离、事件顺序和恢复能力。工作区已有大量改动；每个文件编辑前用 `tmp/backend-audit-round2-2026-11-08/checkpoint.cjs <文件>` 保存当前内容，保存初始 Git patch 和暂存区，不覆盖他人修改。

## 现状、职责与方案

以下候选已用真实模块和合成数据确认；在拥有者内部减少工作，不把必要的鉴权、数据一致性检查或首次载入计作冗余。

| 方向 | 源码拥有者 / 消费者 | 最小方案与验证 |
| --- | --- | --- |
| 粉丝投影 | `src/fans/profile-projection.js`、`profile-service.js` / list、reminders、calendar | 核实 1000 项 LRU 对连续全表遍历的抖动，以及身份时间变化对会员计算的影响；按实际派生依赖复用，保留逐日/账号/会员事实失效。`test/fan-profiles/fan-profile-projection.test.js`、`fan-profile-list-queries.test.js`、`fan-profiles-pressure.test.js`。 |
| 粉丝批量导入 | `src/fans/profile-transfer.js`、`src/storage/fan-profile-store.js` | 核实 replace 每次 remove 重扫 roster 模板；若成立，把重复清理合并到 store 的同一事务，保持导入回滚、模板关系及恢复结果。`test/fan-profiles/fan-profiles-transfer.test.js`、`fan-roster-storage.test.js`。 |
| 加班恢复 | `src/storage/overtime-store.js`、`src/overtime/` | 核实每 100 条批次重复扫描已结算前缀；只在真实证据支持时引入一次恢复过程内的有序读取边界，保留失败重试、补事件和幂等结算。`test/overtime/overtime-settlement.test.js`、`overtime-state-failures.test.js`。 |
| 小游戏与场景 | `src/games/`、`src/server/scene-extra-display.js`、场景前端 / game patches、scene dataVersions | 核实聊天携带未变画布/积分，以及逐答案排序；按现有版本协议选择性投影，保留旧客户端完整响应、正确排名、聊天和新画布同步。`test/games/game-transport.test.js`、`games-load.test.js`、`test/scenes/scene-extra-components.test.js`、场景前端回归。 |
| 主代理补查 | `src/server/` 状态组装、预览中继、菜单同步、场景事件 | 追踪未被前三组覆盖的高频内部读取；检查已有去重，真实调用计数成立后再改拥有者。主代理独占 `src/server.js` 接线。 |

前三组由已有子代理分别负责；主代理交叉复核、串行测量及集成。文档拥有者按实际实现同步 `docs/reference/backend/storage.md`、`overtime.md`、`api.md`、`ws.md`、相关 frontend reference；写入共同文档前协调。界面操作与用户功能未变时用户指南保持原样并说明原因。

## 里程碑

- [x] 完成第二轮证据及反证：粉丝全表缓存抖动/无关身份更新、批量恢复模板扫描、加班恢复前缀扫描、小游戏画布/积分投影与逐答案全榜、云菜单完整游戏读取、礼物窗口重复复制、礼物样式整库复制与逐样式解析。各组记录真实入口及排除方向。
- [x] 对每个确认问题实现最小修复；新增有价值的行为/计数回归，使用实际 owner 的隔离合成数据。
- [x] 交叉审查修复，验证变更/账号切换/失败和旧消费者，保留前一轮修复结果。
- [x] 串行执行最终性能探针；运行受影响测试及语法、架构、文档门禁；记录实际命令和结果。
- [x] 复核相对本轮 baseline 的 diff、`git diff --check`、`git status --short` 和暂存区，产出结果报告并归档计划。

## 验证与完成标准

新增确认项：`scene-gift-events` 的 200 条窗口在 100 次无关场景读取中重复复制 20000 条；使用显式 `incrementalParts=1` 能力和既有 dataVersions 后为 0，前端同时保留省略窗口的事件游标。该显式能力也门控游戏嵌套稀疏字段，防止旧页面自动确认未知新键后丢失内容；旧服务器忽略新 query，新页面首次仍发 `{}`。小游戏比分按 40ms 合并，聊天逐条即时交付，回合/停止取消旧定时器。门槛未达的普通低频答题不声称数倍收益。

礼物样式链追加 `src/storage/component-style-index.js` / store 的 `listMediaStyleIds(type)`，继续执行原文件指纹和恢复校验，按索引内容复用媒体 ID 集合；`frame-config.js` 每笔礼物解析一次触发映射。300 样式 / 100 笔礼物：完整索引复制100→0，映射解析30000→100。`test/server/gift-frame-style-triggers.test.js` 和既有 gift-frame-config 行为案例先复现失败后通过；索引外部修改、备份恢复、高版本拒绝一起验证。

主代理独立比较本轮前/后的粉丝投影，800 个时间、账号、窗口、会员/提醒事实组合输出一致。前后端礼物与场景 98 项、样式 41 项及真实服务云菜单 5 项先行通过；修改冻结后统一运行 34 个相关文件，426/426 通过，以上开发运行不重复累计。用户界面与操作步骤保持原样，指南不需编辑。

各领域使用 `node --experimental-vm-modules --test <相关文件>`，根代理在修改停止后运行 `npm run check`、`npm run verify:architecture`、`npm run verify:docs`。不默认启动完整测试库或外部平台。探针放 `tmp/backend-audit-round2-2026-11-08/`，证明新旧业务结果一致及实际次数/字节下降，不在自动测试中断言机器耗时阈值。阶段结果记录在本计划，最终报告放 `output/`。

若失败，先定位所属模块和具体触发条件，用聚焦用例处理，不放宽断言；必要时仅逆转本轮 task-owned diff，禁止 destructive reset/checkout。完成条件是本轮全部已确认缺陷已修复、相应回归与计数证据通过、未确认线索有反证/限制记录、合同文档同步且最终 diff 范围清楚。

## 完成证据

本轮已确认项全部修复，最终报告为 [第二轮修复与验证](../../../output/backend-redundant-work-round2-2026-11-08.md)。粉丝 2000 档案热读取预处理 40000→0 次、耗时约 6.10×；5000 档案替换的模板候选 12502499→5000、整体约 7.78×；加班 10 万历史/1 万补偿扫描 19505099→200000、完整恢复约 3.71×。游戏 6000 点/4 来源的聊天刷新正文缩小约 16.63×，1000 答案/2 秒的投影正文缩小约 17.91×；50 ms 一条时没有合并收益。300 礼物样式/100 笔礼物的五轮交错中位数 2864.868→32.975 ms，约 86.88×。均为合成路径，非整个应用加速承诺。

独立交叉审查还复现并修复未落盘退避被 pending(0) 覆盖的忙重试，定时器实测从 0 ms 变为 1000 ms，普通新礼物仍正常立即结算。保留原单 timer、事务和幂等约束。未移除鉴权与恢复核验。

最终命令：`node tmp/backend-audit-round2-2026-11-08/root/integration.cjs`（34 文件、426/426）；`npm run check`（1790 文件）；`npm run verify:architecture`（30/30）；`npm run verify:docs`（10/10）；`git -c core.safecrlf=false diff --check`。架构首轮提示 overtime 的空 catch 豁免已过期，删除该条目后通过，规则未放宽。命令参数与日志保留于 `tmp/backend-audit-round2-2026-11-08/root/`；本轮每文件基线、初始/最终 Git 差异和暂存区核对也保留。

26 个源码、15 个测试文件及 8 份技术参考同步；界面操作和数据格式不变，用户指南无需修改。没有剩余已确认 finding；未证实或必要计算有分组反证。未修改远程 Server，未实播、读取真实用户库、控制现有桌面、提交、打包或发布。归档保留跨域调用次数、兼容协商与失败恢复的验收证据。
