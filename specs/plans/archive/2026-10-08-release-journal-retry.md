# 发布前迁移日志占用修复

Status: Completed

## Goal and evidence

v5.1.3 统一验证中，`scene-runtime.test.js` 在启动替换 `.cache-layout-v1.json` 时出现 `EPERM`。让短暂日志占用可恢复，持续占用仍中止启动，保持原迁移日志与文件可续作。

## Ownership and constraints

`src/storage/data-directory-migration.js` 的 `writeJournal` 独占同步日志发布；参考 `src/storage/component-style-store.js` 已有的准备文件重命名重试。消费者是启动时的浏览器和缓存迁移。保持日志格式、迁移次序、冲突检查、活动进程保护、临时文件清理及同步调用接口，不重放数据目录移动，不修改用户数据或增加依赖。

## Implementation and verification

- [x] 在 `test/storage/data-directory-migration.test.js` 注入 `EPERM` / `EBUSY`，覆盖恢复成功、持续失败及其他错误立即失败。记录临时日志来源和移动次数，确认只重试同一准备文件且数据仅移动一次。
- [x] 运行上述文件确认临时占用失败；在 `writeJournal` 内将 `renameSync` 包入最多四次重试，仅接受 `EPERM` / `EBUSY`，间隔为 50/100/150/200ms，使用既有同步 `Atomics.wait` 模式。
- [x] 定向运行迁移与场景启动测试，复核源/目标字节、pending 日志和失败清理；将边界写入 `docs/reference/backend/storage.md`。
- [x] 发布其余失败项全部收敛后执行 `npm run verify` 并复核 diff。

新增占用用例修复前 4 项失败、2 项通过；修复后迁移文件全部 15 项通过。记录位于 `tmp/release-5.1.3/journal-before.log` 与 `journal-after.log`。最终场景启动、迁移、图层样式替换及礼物画布合并定向检查 27 项全部通过，见 `tmp/release-5.1.3/focused-final.log`。

## Failure handling and done when

重试耗尽或遇到其他错误时沿原路径抛出并清理临时日志；保留原 pending 日志，不绕过启动检查。回退仅移除本次重命名重试与配套断言。完成条件是确定性失败复现、修复后相关检查通过、全量发布门禁通过及本次 diff 审阅完成。

## Release blocker: Windows process lookup

第二轮统一验证主组 3,894 项通过，但独立原生组两项在 5 秒截止时失败。分段诊断显示 WMI TCP 查询之后的 `Win32_Process` 筛选仍枚举进程，耗时约 0.6–0.95 秒；按已知 PID 直接绑定 WMI 对象约 0.07–0.08 秒。原生提供程序累计延迟触发安全拒绝，并非主组并发造成。

最小改动由 `src/server/local-process-owner.js` 拥有：仅把进程筛选改为按 `Win32_Process.Handle` 键绑定；TCP 精确端点查询、同一用户 SID、路径/创建时间证明、5 秒总截止及失败拒绝均不变。不增加重试、放宽超时或降低整套并发。消费者为 `local-instance.js` 与 `lifecycle.js`；合同同步 `docs/reference/backend/server-core.md`。

- [x] 在原生测试注入进程枚举延迟，旧实现 5,022ms 超时；按 PID 绑定后同一条件 968ms 通过，并保留异用户 SID 拒绝，见 `native-before.log` / `native-after.log`。
- [x] 合并原生与本地实例安全测试，原生 4 项、安全 20 项通过，覆盖优雅退出、精确端点、令牌和 PID/路径边界。
- [x] 通过统一验证，复核 diff 后归档；失败则继续定向诊断，不覆盖本次发布前的用户改动。

回退仅恢复原 `Win32_Process` 查询及对应测试夹具；不修改 Windows 服务、真实用户进程或系统配置。

## Third gate and environment correction

第三轮原生 4 项通过；主组出现两处浏览器断言竞态及 `license-gate.test.js` 进程无错误输出退出。浏览器修复为等待原生共享字号实际加载完成（注入受控延迟并验证加载期间禁止编辑），以及将冲突提示定位到画布状态容器。合并三份失败文件 14 项通过；授权及相邻测试/安装器并发组合 45 项通过。授权进程额外隔离/并发 42 次未复现，不能据此声称已修复该进程故障。

环境核对发现主机 Node 24.15.0 属于已知 Windows TCP 原生崩溃版本，症状与 [Node #63620](https://github.com/nodejs/node/issues/63620) 一致，修复已由 [#62561](https://github.com/nodejs/node/pull/62561) 回移至 24.16.0。缺少该次崩溃转储，不能直接确诊为同一缺陷；先纠正这个已确认存在的运行时缺陷，再以完整门禁结果判定发布。使用 `tmp/release-5.1.3/runtime/node-v24.21.0-win-x64` 的官方便携包，SHA-256 对照官方清单通过，不改系统安装或依赖。旧版 15 秒 HTTP 压力诊断通过，仅说明该故障不能稳定触发；新版须运行同一诊断与授权测试后再统一验收。

## Remaining native query delay

新版 Node 的同一 HTTP 压力诊断完成 241,047 请求，授权 2 项通过；第四轮原生端口查询仍超时，证明按 PID 绑定仅减少部分开销，未解决 TCP WMI 提供程序延迟。用户明确要求并行处理后，由子代理负责端口查询 owner、原生测试及后端合同；主代理收齐门禁结果与发布收尾。

最小方案评估为在原有 5 秒总截止的 PowerShell 子进程内使用系统 `netstat` 数字 TCP 表，按完整本地地址/端口、远端地址/端口和状态精确匹配。只接受有效且无歧义的 PID，再执行原有 WMI 按 PID 绑定、用户 SID、创建时间与路径校验。畸形表、命令失败及不匹配均拒绝；不信任对端报告、不使用强制终止回退、不增加进程或运行时依赖。实施前用实际端口对照读取结果与耗时，实施后验证监听、已建立连接、错误端点、用户隔离和受控输入。

实现已完成：原生与安全 25 项通过，真实旧实例优雅关闭约 1.07 秒；在 256 路并发连接变动、累计 18,051 条连接下，6 次监听/已连接端点查询全部返回正确 PID，耗时 846–895ms。见 `tmp/release-5.1.3/native-netstat.log` 与 `native-churn.log`。第四轮统一验收主组 3,894 项全部通过；等待带最终原生实现的门禁。

最终结果：第五轮 `npm run verify` 在 Node 24.21.0 下通过，10 个锁定契约夹具、1,352 个 JavaScript 文件语法、原生 5 项与主组 3,894 项均通过，无跳过或取消。主测试组约 180 秒，原生组约 6.5 秒，记录见 `tmp/release-5.1.3/verify-final-5.log`。发布文件逐项 SHA-256 与本轮验收快照一致；已复核修复 diff。归档之后仅补文档门禁，不再重复全量。
