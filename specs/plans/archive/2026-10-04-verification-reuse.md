# 验证结果复用

Status: Completed

## Goal

语法检查按文件复用；完整测试按已验证的输入和运行环境复用成功文件，安装器脚本回归不被无关页面样式失效。计划输出明确本次运行、复用与完整覆盖边界。

## Non-goals / Compatibility

保留现有产品修改、分组、VM/Electron 运行方式和原始 `npm test`；不提交、发布，不修改服务器契约锁、安装包最终验证或用户运行中的应用。未知 ESM、VM、动态依赖仍按全仓保守处理。

## Current Behavior / Ownership

`scripts/check-js.js` 每次启动全部语法子进程；`scripts/run-tests.js` 已有完整文件选择但没有结果缓存。测试规范归 `docs/reference/engineering/test.md`，构建边界归 `build.md`。安装器的外部编译器和插件由 `test/helpers/installer-tools.js` 选择。

## Proposed Changes / Milestones

1. 语法键包含文件字节、祖先模块配置和实际 Node；验证新增、修改、删除、失败、强制重跑及运行中变化。
2. 在原 runner 增加缓存模式与计划，保留无缓存诊断；通过 Node 完整报告建立逐文件证明，输入或工具变化、skip、过滤、不完整报告不能产生完整证明。
3. 登记五个安装器测试的具体源码输入及真实工具环境；其他文件保守。服务端契约组实时校验锁定提交和 fixture。
4. 更新规范；以合成仓库回归和相关工程测试验证正确性，不以局部成功声称全量通过。

## Verification

`npm test -- --file=test/engineering/check-js.test.js --file=test/engineering/run-tests.test.js --file=test/engineering/verification-cache.test.js`；新增缓存入口先 `--plan` 再同范围运行；`npm run verify:docs`、`git diff --check`。需要时运行安装器文件，先报告范围及耗时。

## Rollback / Done When

只撤回本任务改动，缓存可删后重跑。现有功能与发布改动保持原样；上述回归通过、文档与输入边界一致、最终差异审阅完成即结束。完整产品测试与新安装包验收不属于本次完成证明。

## 完成证据

2026-10-04：上述三个完整工程文件合计 24 项回归通过，无 skip/todo；实际源码语法与差异检查通过。回归覆盖逐文件复用、版本与模块边界、运行中变化、force 撤销、互斥、失败兄弟保留、报告完整性、完整清单重新收集、保守 ESM/VM/资产输入、嵌套 package、NSIS 实际工具、headless-shell 和锁定契约实际 fixture。初次计划检查实测 20.89 秒；复用读取缓冲区、减少逐文件重复路径查询后同范围计划为 6.71 秒，仍计算实际文件字节。

语法自动复用和 `verify:tests` 已接入，原 `npm test` 保持无缓存。产品全量 511 文件与新安装包验证没有在本任务执行；不将此工程回归宣称为产品全量验收。当前规范和操作边界由 `docs/reference/engineering/test.md`、`build.md` 维护。
