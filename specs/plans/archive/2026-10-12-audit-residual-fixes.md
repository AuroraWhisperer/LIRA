# 审计剩余三项隐患修复计划

Status: Completed

## Goal

按用户 2026-10-12 最新指示，修复工具初始化失败恢复、安装包摘要同步阻塞、服务器礼物分析菜单遮挡。前三项礼物线索停止追查；第四项只说明其实际名称为粉丝档案「特别关注」，不修改行为。

## Current Behavior / Ownership

- `public/js/admin/toolbox-lifecycle.js` 在同步 init 成功前标记 initialized；失败后仅清 loaded。需要结合 `app.js` loaders 和工具 owner 的监听清理处理半初始化，不能只重试而重复绑定。所属文档为 `docs/reference/frontend/app.md`，沿用 toolbox 测试。
- `src/electron/license/build-integrity.js` 同步读取整个 app.asar 并计算 SHA256；`license-manager.js` authenticate 和 `license-activation.js` 同步消费结果。所属文档为 `docs/reference/desktop/main.md`，测试为 `test/engineering/build-integrity.test.js`、`test/license/`。
- 服务器 `public/streamer/` 礼物分析空数据卡片遮挡原生菜单底部，已有 `e2e/streamer-gift-history-filters.spec.js` 及截图证据；仅修复样式和鼠标可达性。

## Compatibility Constraints

不提交、部署或更新安装版。保留现有未提交修改、用户数据、HTTP/IPC/授权响应及摘要格式。摘要仍读取实际 app.asar，不缓存成功结果、不跳过校验；错误继续返回 unverified。新增异步等待后使用既有生命周期检查，失效操作不发送授权请求或暂存激活密钥。工具失败恢复不新增定时重试或重复事件。菜单不改变日期计算。

## Proposed Changes / Milestones

- [x] 工具 owner：同步 init 失败后禁止重复调用半初始化实例，复用确认框提供重新加载管理页；用户确认后由旧页面销毁资源，在新页面恢复。模块下载失败仍可原地重试；覆盖失败反馈、取消/确认、共享入口无重复监听。
- [x] 摘要 owner：`getBuildInfo` 改为异步分块读取，复用一个64KiB缓冲区更新 SHA256，并在 finally 关闭文件；两个现有调用方 await 并检查当前生命周期。覆盖摘要相等、读失败、事件循环可响应及等待中失效。
- [x] 菜单 owner：修正裁剪/叠放上下文，使短卡片下菜单可见且鼠标可点；完整相关浏览器文件验证日期筛选保持正确。
- [x] 集成：审阅任务差异，同步 owner 参考与外部审计处理记录，执行相关门禁并归档。

## Verification

客户端使用 `node --experimental-vm-modules --test` 执行上述完整测试文件及授权启动/续期/激活相关消费者；原有 Electron-as-Node 测试确认 original-fs 对 app.asar 的读取。用实际安装包只读测量摘要耗时与定时器响应，不修改或启动安装版。工具使用现有 DOM fixture；服务器沿用 verify runner，先同范围 `--plan` 再完整相关浏览器文件。客户端最终 `npm run verify:docs`、`npm run check`、`npm run verify:architecture`；两仓 `git diff --check`、`git status --short`。测试期间不编辑参与文件，不运行无关全仓功能套件。

## Documentation / Failure Handling

实际检查发现7类工具均可能先绑定匿名监听，且没有完整初始化回滚接口。逐一补回滚会扩大到约15个owner文件，因此采用明确的管理页重载恢复，而非伪装成安全的原地初始化重试；不自动重载，不重启后端。

变更只涉及失败恢复和内部执行方式，用户入口不变；用户指南只在操作说明确实变化时更新。失败先定位具体用例，回退仅撤销本轮修改，保留其他任务差异。前三项礼物线索记为用户暂缓，不能写成已证明无缺陷。

## Done When

三项实现通过所属回归，授权等待失效有测试、菜单有实际鼠标证据；参考文档和报告一致，最终差异检查完成，未增加无关保护或扩展功能。

## 验证与交付记录

- 工具：两个完整文件 `toolbox-lifecycle.test.js`、`frontend-admin-startup.test.js` 14/14通过，使用已有 VM/DOM fixture；没有把模拟异常当成真实用户故障频率证明。恢复对话框说明未保存编辑影响，日常入口不变，指南无需改动。
- 摘要：10个完整文件114/114通过，含 Electron-as-Node 实际 raw ASAR 摘要、非整块尾部、读取失败关闭、每次读取当前文件、等待中失效及签名/续期相关消费者。最终只读检查实际安装包48,203,639字节耗时37.72ms，期间37次定时器、最大间隔1.62ms，摘要一致；不是完整桌面应用或冷盘基准。
- 初始 ReadStream 分块方案仍存在重复 Buffer 分配造成的20–73ms同步停顿；经有限对比定位后改为单缓冲区直接异步读取。未使用缓存或删除完整性检查。
- 菜单：只改服务器 `dual-charts.css` 的展开时溢出及既有右对齐优先级；history完整15项通过，dual charts同CSS输入16项成功记录由验证器复用。主代理实际查看320/1440px截图，末项可见，鼠标命中正确；原规范已要求不裁剪，无需另改规范/指南。
- 客户端语法1479文件、架构27项通过。首轮架构检查指出本次增加的空catch，显式处理存在性失败后所属16项及完整27项通过；未放宽门禁。
- 文档与最终差异检查的结果记入外部审计 `residual-fixes-results.json`。方向明细及日志保存在两仓忽略的 `tmp/audit-residual-fixes-2026-10-12/`。没有提交、部署、更新安装版或操作用户当前应用。
