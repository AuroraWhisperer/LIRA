# 批次 B 实际复杂点实施计划

## Goal

落实复审报告第 9 节批次 B：按实际职责提取纯校验、解析、视图和诊断资源，保留状态与生命周期的单一所有者。以当前未提交工作区为基线，不覆盖批次 A/C/D 的成果。

## Current Behavior / Ownership

尚无批次 B 完成记录。目录协议与图片策略仍在 remote-catalog-cache；导入解析与云同步/背景设置仍在 import；规划器、礼物历史和弹幕 feed 混合状态与视图；诊断 CLI 混合增量日志探测；ESM 审计混合词法与作用域分析。授权和加班机仍使用多位置参数。既有定向测试作为行为基线。

## Compatibility Constraints / Non-goals

- 保留 HTTP/IPC、页面、设置和存储格式、安全转义、身份校验及请求失效规则。
- token/授权代次、结算状态、分页取消、规划器写保护、feed 定时器各保留一个所有者。
- 不修改 A 的 CSS、HTML、测试迁移文件，不修改 C 的清库及启动模块；不提交、分支或发布。
- 新前端接口使用具名 ESM，不增加 AdminApp 依赖；保留必要兼容入口。

## Milestones

- [x] 目录：新增 remote-catalog-contract.js 与 remote-catalog-image-policy.js；缓存继续独占请求合并、代次、持久化后发布。运行 remote-catalog-cache 与 remote-overtime-catalog 测试。
- [x] 管理视图：import 提取 song-import-parser、cloud-song-sync、song-background；todo 提取 todo-view 与动作处理函数；history 提取 history-view。运行 song-import-table、song-import-update-ui、cloud-runtime-sync、规划器及礼物历史相关测试。
- [x] 弹幕与分析器：feed 提取消息渲染器；esm-scope-audit 提取保持字符/换行位置的词法扫描，按字符串、模板、正则分解扫描。运行弹幕/游戏消费者和 ESM 审计相关测试。
- [x] 诊断资源：提取 WeSing 日志探测器与明确终端 setup/cleanup；保持 UTF-16 残字节、停止刷新及结束顺序。运行 wesing-playback-diagnostic 测试。
- [x] 局部整理：authenticate 与 resolveGiftSettlement 使用调用对象；renderGiftPicker 提取过滤和节点构造。运行 license-manager/license-resume、overtime-service/overtime-gift-picker 相关测试。
- [x] 更新 B 实施记录与受影响规模登记；格式化、语法、架构门禁、完整回归和最终差异审阅。

## Verification

各里程碑先运行既有测试，再运行修改后相同测试。最终运行 `npm run check`、`npm run verify:architecture`、`npm run verify:docs`、`npm test`、`git diff --check`、`git status --short`。若并行 A 造成瞬时测试失效，先检查实际所有权，不修改其迁移中的文件。记录真实结果及限制。

## Rollback / Failure Handling

只基于本任务修改前文本恢复本任务的具体补丁，不执行 reset/checkout 或全仓回滚。并发文件发生变化时重新读取并合并，不用旧整文件覆盖。

## Done When

上述职责提取完成，原消费者契约保持，相关测试通过；无新循环、越权或状态分散；报告准确记录验收与剩余函数债务；最终差异不包含本任务生成的运行数据或秘密。

## Results

批次 B 的职责提取与定向验收已完成。诊断实际文件为同目录 `scripts/wesing-log-probe.js` 与 `scripts/wesing-diagnostic-terminal.js`；规划器/历史视图、云同步/背景及纯解析器均使用具名 ESM。没有修改 A 的 CSS/HTML 或接管其测试迁移。

- 目录/授权/加班机原116项定向通过，目录1088组与初始实现差分输入一致。
- 管理端累计104项定向覆盖通过，交叉复核33项及真实ESM加载通过。
- 弹幕/分析器16项、诊断21项通过。
- `npm run check`：663个JS语法通过；`verify:architecture`：22/22；`verify:docs`：5/5；规模检查0错误。
- 完整回归1772通过、2跳过、2失败：A期间播放测试漏读拆出的CSS、管理shell测试缩短但旧规模登记未更新。后者已经A更新并通过架构复查；未更改其播放测试，完整回归没有记为全通过。
- 目标函数及剩余大型状态工厂经AST重测，更新报告第13节和函数债务；本轮不声称全部函数达标。

验收限制：没有Electron/OBS人工画面验收；使用既有DOM行为测试、真实ESM加载和兼容入口回归。完整回归中与B无关的播放CSS测试遗留失败，按用户要求保留A所有权。
