# Current Test Failures Implementation Plan

**Status:** Completed

## Goal

修复当前工作区可复现的失败测试，区分过期夹具、过期预期与真实实现缺陷，保留有效的行为与边界断言。

## Current Behavior And Ownership

2026-10-07 离线基线：3423 项，3393 通过，30 失败。完整日志位于 `tmp/test-failure-fixes/offline-baseline.log`。
失败涉及 admin 初始化/组件预览、弹幕设置/快照、时钟运行时、Electron 关闭夹具、Moonlit 打包/导入、场景请求边界及计划状态。
测试与夹具由 `test/` 拥有；分组由 `scripts/run-tests.js` 拥有；打包清单由 `package.json` 拥有。

## Constraints And Non-goals

保留现有未提交修改；不提交、建分支、发布或修改真实用户数据。保持公开协议、权限、持久化格式和桌面生命周期。
不以删除、跳过或放宽有效断言消除失败。只修复本次复现的原因，不扩展历史审查事项。

## Milestones And Verification

- [x] 补齐 admin/弹幕/时钟模拟环境的新依赖与 DOM 能力，运行对应失败文件；关闭夹具显式建模新依赖。
- [x] 对照样式包和场景文档合同修复资源清单、预期与边界输入；运行 packaging-scope、component-styles、component-preview 和 governance-docs。
- [x] 将 background-filters-electron 登记到 desktop；复现 browser 组并修复实际失败，再执行离线、浏览器和桌面组。
- [x] 核验锁定服务器 fixture；在隔离目录补齐可用的锁定检出后运行 contracts。安装器组按既有隔离入口检查。
- [x] 检查本次增量、`git diff --check` 和 `git status --short`，记录准确结果及环境限制。

## Changes And Evidence

- 产品层仅补齐 `package.json` 的 Moonlit 点歌板资源打包排除项，并移除套装分类内重复的标题。
- 测试同步当前的预览聚焦协议、头像展示、调色分组、样式导入能力及 Moonlit 字体预设；保留保存、发布、授权、隔离、尺寸和资源边界断言。
- 预览测试等待组件尺寸回报落到画布后再检查或保存，避免读取旧几何尺寸；套装用例等待编辑器挂载。完整 Moonlit 用例实测持续推进超过 60 秒，超时预算调整为 90 秒。
- 场景请求边界输入按 UTF-8 字节预算生成，仍验证 75%–100% 合法边界与超限拒绝。
- 打包配置测试把第三方多段 stdout 日志转为 `t.diagnostic`，修复复现过的 Node 测试通信反序列化失败，不修改构建实现。
- 工作期间其他任务新增了背景调色用例。离线数量从基线 3423 调整为 3427，包含一个 Electron 用例移出 offline 及同期新增用例，并非删除失败测试。

最终按既有分组执行 `node scripts/run-tests.js <group> --test-reporter=tap`：

| 分组 | 通过 | 失败 / 取消 / 跳过 | 日志（仓库根目录相对路径） |
| --- | ---: | --- | --- |
| offline | 3427 | 0 / 0 / 0 | `tmp/test-failure-fixes/offline-final-3.log` |
| browser | 213 | 0 / 0 / 0 | `tmp/test-failure-fixes/browser-final-2.log` |
| desktop | 12 | 0 / 0 / 0 | `tmp/test-failure-fixes/desktop-final.log`，独立批次 3 + 9 |
| installer | 42 | 0 / 0 / 0 | `tmp/test-failure-fixes/installer-final.log` |
| contracts | 109 | 0 / 0 / 0 | `tmp/test-failure-fixes/contracts.log` |

contracts 使用 `LIRA_SERVER_ROOT=tmp/test-failure-fixes/server-contract` 对应的绝对路径；该隔离检出锁定在 `01fb2b47d5e081f5dd559933991ade4819eb3428`，契约校验器的 10 项 fixture 哈希全部通过。未修改服务端原工作区或版本锁。

`npm run check`、`npm run verify:docs`、`git diff --check` 与最终工作区状态检查通过。无提交、发布或真实数据操作；临时日志、快照及服务器检出保留在忽略的 `tmp/` 内供复核。

## Remaining Observation

中间运行偶发 Windows `EPERM` 目录重命名/素材导入失败，相关测试单独复测及最终完整离线分组通过。这不证明外部文件占用已永久消失；本次没有通过重试整个存储提交、放宽断言或跳过用例掩盖它。若后续再次出现，应保留具体 filesystem 错误继续定位。

## Rollback And Done When

改前快照位于 `tmp/test-failure-fixes/before/`；仅撤销本次增量，不覆盖之前的修改。
所有可运行分组通过；无法运行的依赖须明确记录，不更改契约锁以绕过校验。完成后将本计划归档并更新索引。
