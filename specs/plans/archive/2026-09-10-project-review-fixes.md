# Project Review Fixes Implementation Plan

**Status:** Complete, 2026-09-10. 修复、完整验证及最终差异审查已通过。

**Goal:** 修复报告 F1–F7 与图标资源路径问题，保留现有功能及安全边界。

**Architecture:** 在现有服务、播放控制器和页面通信层修复各自拥有的状态与资源；不增加服务、框架或依赖。

**Tech Stack:** Node.js 24+、CommonJS 后端、Vanilla JavaScript ES modules、Electron 43、node:test。

## Global Constraints

- 不改变公共 HTTP/WebSocket/IPC 格式、数据库 schema、设置键或已有页面 URL。
- 保持 token 轮换、Host/Origin 校验、Electron context isolation 与秘密保护。
- 不访问真实用户数据；不提交、分支、发布；保留其他人的修改。
- 本仓库 `PLANS.md` 与用户“先报告再修改”优先于技能默认目录、提交和二次确认流程。

## Current Behavior And Ownership

检查结果及复现见 [报告](../../../docs/reports/2026-09-10-project-review-and-fixes.md)。

| 项目 | Owner / Consumers | Contract | Focused tests |
| --- | --- | --- | --- |
| F1 | `src/overtime/overtime-service.js`、`src/server/domain-services.js` / data routes | `docs/architecture/backend/overtime.md` | `test/overtime-service.test.js` 及真实 domain-services 清空集成回归 |
| F2/F7 | `src/server/http-utils.js`、`src/server/http-server.js` / OBS HTML、WS | `docs/architecture/backend/server-core.md`、`docs/architecture/frontend/comms.md` | 页面 token 注入/会话恢复、升级请求、本地重启重连回归 |
| F3/F4 | `public/js/playback/features/`、组合控制器 / 播放页面 | `docs/architecture/frontend/playback.md` | `test/playback-quality.test.js`、`test/playback-queue-behavior.test.js` |
| F5 | `src/music/providers/netease-provider.js` / playlist write service | `docs/architecture/backend/music/netease-provider.md` | `test/netease-provider.test.js` |
| F6 | `src/ai/ai-assistant-service.js` / AI store、回复管线 | `docs/architecture/backend/ai.md` | `test/ai-assistant-service.test.js` |
| P1 | `package.json` / Electron 主窗口 | `docs/architecture/engineering/build.md` | `test/packaging-scope.test.js` |

## Milestones And Proposed Changes

- [x] 先保存现有功能与问题报告；此时不改业务代码。
- [x] F3/F4：Luna 保留播放控制器的代际所有权，补齐清空 wiring、音质切换与迟到 metadata/play 回调有效性；使用曲目副本避免旧流元数据污染。修复前两个时序回归失败，修复后通过；35 项播放聚焦检查通过，后补跨曲/迟到 play 回归所在音质文件 4/4 通过；主代理已检查实际 diff。
- [x] F1：增加内部 `reloadState`，全部清空成功后同步运行时。实际清空逻辑只在完整成功后的默认行重建阶段重置加班机，部分提交不重置计时状态，因此部分失败不重载。真实 domain-services、部分提交和假时钟回归通过。
- [x] F5：共用 `getLikedPlaylistId` 解析；特殊目标成功写入真实数字 ID，缺失时不写入任意歌单；已有 Provider 回归通过。
- [x] F6：上下文在查缓存前固定；`reply-v2` JSON 键覆盖 uid、观众名、问题、上下文、配置与不可用工具集合，沿用 store 哈希存储；串用、上下文/人格/端点变化、正常命中回归通过。
- [x] F2：现有注入包装层仅为 OBS 页面启用单飞/超时/可取消的会话探测；同源 API 401 或本地 WS 关闭后确认 401 再刷新。两个真实隔离 runtime 同端口重启、旧 token 仍拒绝、刷新后恢复 WebSocket/API 的回归通过。
- [x] F7：升级入口捕获 URL 解析错误并返回 400；畸形 Host/URL 后合法 upgrade 仍可处理的回归通过。
- [x] P1：打包清单包含 `build/icon.png`，使用当前 electron-builder 的实际 FileMatcher 验证 buildResources 默认排除不会再移除图标，原始大图仍排除；不生成或发布安装包。
- [x] 更新受影响的 owner 文档与报告，完成全量验证、差异审查及计划归档。`npm run verify` 通过：文档 5/5、语法 577 个 JS、架构 13/13、完整测试 1354/1354；`git diff --check` 通过。没有提交或发布，并行修改保留。

## Verification

先运行各组新增回归确认能捕获现有缺陷，再实施最小修复并运行直接相关测试。现有 `node:test` 和 VM 前端 helper 足够，不增加测试框架。

```powershell
node --experimental-vm-modules --test test/playback-quality.test.js test/playback-queue-behavior.test.js
node --experimental-vm-modules --test test/overtime-service.test.js test/netease-provider.test.js test/ai-assistant-service.test.js test/overlay-socket.test.js test/packaging-scope.test.js
npm run verify
git diff --check
git status --short
```

新增 HTTP/清空/会话恢复测试加入其所属聚焦命令及完整测试发现。全量门禁只在全部修改收敛后运行；如果失败，只修复本次引入或阻塞验收的问题。

验证记录：首轮全量门禁在架构检查发现注入脚本空 catch，已将网络失败明确转换为 false 并由刷新分支消费。重新运行 19 项架构与会话恢复检查通过，随后完整 `npm run verify` 通过；未放宽架构债务基线。

## Non-goals

不扩展功能、重构邻近模块、改变远端服务器、改造登录、安装依赖或发布。真实外部服务和 OBS/Electron GUI 未联调的限制必须如实记录。

## Rollback Or Failure Handling

测试失败时保留证据，只检查所属修改。需要撤回时按 diff 撤销本任务对应的行；不 reset、checkout 或删除用户数据。持久化格式不变，不需要数据迁移或逆迁移。

## Done When

报告中每项确认缺陷均有修复与有效回归；路径资源匹配；相应契约文档一致；完整门禁及 diff/status 审查通过；报告写入最终结果和实际限制。
