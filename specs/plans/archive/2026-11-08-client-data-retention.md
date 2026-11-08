# Client Data Retention Implementation Plan

**Status:** Completed

**Goal:** 回收客户端确实失去用途的文件，控制缓存和异常退出残留，同时保留正常显示、离线资源、用户素材及恢复能力。

**Architecture:** 继续由上传、礼物缓存、公共资源、音频组件各自的 owner 管理文件。共享文件回收只负责受限目录、普通文件、名称白名单和时间判定；引用和兼容性由调用方决定。无新进程、依赖、数据库迁移或 HTTP/IPC 契约。

**Tech Stack:** Node.js 24 CommonJS、Electron、现有 node:test 与 tmp/ 隔离夹具。

## Constraints and current evidence

- 用户要求修复，但不能影响正常使用；不对真实安装数据执行清理，不构建、安装或发布。
- 保留所有现有工作区修改；本任务仅修改回收 owner、相关测试和说明。
- 已有音乐缓存上限、日志轮换、数据库保留、素材库显式清理保持原行为。
- 审计确认上传选择清空/替换不释放旧文件；下载 finally 不能覆盖强制终止；礼物图片未有过期冗余文件回收。
- 公共资源的旧摘要 URL 属于兼容合同；音频恢复守护可跨桌面退出继续工作。没有可靠存活/引用证据时保留完成版本，不能为了总量上限破坏旧来源或恢复。
- browser 包含授权和用户资料；本任务不清登录分区、不改变 Chromium 会话或数据库历史。

## Owners and implementation

### 1. Safe file maintenance

- [x] 在 `src/shared/file-retention.js` 实现受限的普通文件回收：验证目录及条目不是链接、仅匹配明确的生成名称、删除前重新检查文件与保护集合；保留未知文件，锁定/不可读时跳过。由 owner 提供保留期与保护集合，避免抽象领域规则。
- [x] 在现有礼物、公共资源和音频准备流程补齐超过 24 小时的临时文件/暂存清理；不删除其他实例当前任务、正式资源、未知目录、音频路由恢复记录。
- [x] 扩展现有 `test/desktop/cdn-resource-library.test.js`、`test/desktop/audio-component-manager.test.js` 和 `test/gifts/remote-gift-image-cache.test.js` 验证重启清残留、未知/链接保护及离线复用请求数。

### 2. Uploaded media ownership

- [x] `src/server/uploaded-media-retention.js` 复用 scenes 和 componentPreviews 的全账号引用访问，读取 settings 和素材库配置，保留草稿、发布、预览命令及备份/恢复在途资源。引用或索引不可读时不删除。
- [x] 只回收生成名称匹配、超过 30 天且无引用的文本图片、开播音乐/角色文件；在实际上传/清空操作和素材管理访问时触发，限制扫描频率，不增加后台轮询。
- [x] `opening-service.js` 的设置提交失败只回滚本次新文件，保持原选择可读；通知失败不能回滚已提交媒体。
- [x] 扩展上传和素材备份既有测试，并为全账号/未保存/在途引用、旧孤立文件、链接与读取失败增加聚焦回归。

### 3. Gift image cache

- [x] 在缓存 owner 为已脱离当前目录和 last-good 映射、且 30 天未使用的可重建图片增加回收；当冗余候选超出缓存预算时优先回收最旧候选。
- [x] 保护当前目录、历史 last-good、下载任务和本次会话已解析/使用的图片；目录/索引异常时保守跳过，不能把失败下载转为反复下载当前整库。
- [x] 复用现有 initializer 的完整快照做维护，不另发远程请求；测试当前/旧回退图片、并发下载、冷暖缓存、离线与退出。

## Documentation and verification

- `docs/reference/backend/storage.md` 更新文件保留规则；`docs/guides/component-style-packages.md` 和应用内场景指南只补充受影响的上传素材保留说明，既有手动素材包清理入口不变。
- 各任务先运行对应回归复现，再执行实现及同组回归。文件保护行为在 owning Node 层验证，不启动真实客户端或操作用户数据。
- 集成检查：相关上传/场景备份、礼物缓存/initializer、CDN、音频组件 suite；`npm run verify:docs`、`npm run verify:architecture`、`npm run check`，以及最终 touched diff、`git diff --check`、`git status --short`。本次不改变外部协议，不跑两仓契约或无关完整套件。

## Failure handling and done when

文件回收失败不得阻断正常下载/上传或启动。引用不完整时保留数据，下次相关操作可重试。回滚仅针对本任务差异，不使用全仓 reset/checkout。完成需验证保留与删除两端、同步文档、说明刻意保留的兼容数据，并审阅最终差异；不以磁盘总量必须固定作为验收条件。

## Completion evidence — 2026-11-08

- 自动维护采用相关操作触发，每小时最多一次，不新增定时器或服务器/CDN 请求。礼物缓存采用 512 MiB 软预算，只对至少 24 小时未用的无引用候选额外淘汰；受保护文件、兼容版本和用户资料允许超过预算。所有引用由 `local-asset-references.js` 汇集，引用不可读时跳过。
- 上传失败回滚、陈旧残留及冗余礼物图片先观察到回归失败，再完成实现并通过复验。新备份流用例验证：只有图片、没有素材包的备份，在场景移除引用后仍保留文件；取消流后释放占用，超过保留期可回收。
- 43 项文件维护/CDN/音频/礼物检查、58 项上传/场景/备份/礼物集成检查、35 项服务及 Electron 启动/生命周期检查均通过。最后的异常处理和缓存微调后，40 项相关回归、7 项备份流检查及最终 26 项礼物检查通过；上述分组包含重叠，不累加为独立用例数。
- 运行命令采用 `node --test --test-reporter=spec`，主要 suites 为 `test/shared/file-retention.test.js`、`test/scenes/uploaded-media-retention.test.js`、`test/scenes/scene-text-media.test.js`、`test/scenes/component-library-transfer.test.js`、`test/scenes/component-library-maintenance.test.js`、`test/overlays/opening-media-store.test.js`、`test/overlays/opening-independent-settings.test.js`、`test/overlays/opening-upload-api.test.js`、`test/gifts/remote-gift-image-cache.test.js`、`test/gifts/gift-catalog-initializer.test.js`、`test/gifts/gift-image-resources.test.js`、`test/desktop/cdn-resource-library.test.js`、`test/desktop/audio-component-manager.test.js`。
- 生命周期 suites 为 `test/server/server-lifecycle.test.js`、`test/server/server-cleanup-failures.test.js`、`test/server/server-smoke.test.js`、`test/desktop/electron-main-modules.test.js`、`test/desktop/electron-startup.test.js`、`test/desktop/electron-startup-data.test.js`。
- `npm run check`：1,790 个 JavaScript 文件语法通过；后续改动文件各自 `node --check` 通过。`npm run verify:architecture`：30/30 通过；初次空 catch 门禁失败已修正，未修改债务基线。`npm run verify:docs`：10/10 通过。
- 存储参考、素材包使用指南和应用内场景指南已同步；README/交互导览的入口与步骤不变，无需修改。已审阅本任务新增文件和差异，`git diff --check` 通过；保留其他进行中改动，不纳入本任务完成声明。
- 没有运行安装版数据清理、重启用户客户端、提交、构建安装包或发布。代码需在重建/更新后的客户端生效；验证限于隔离测试，不声明实播或全仓完整测试套件通过。
