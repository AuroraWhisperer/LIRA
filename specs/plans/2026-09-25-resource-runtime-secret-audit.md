# 资源生命周期、生产运行时与历史秘密轻量验证

**Goal:** 对 OPEN-V01、当前生产运行时和两端仓库秘密材料建立证据；只修复实际复现的问题。

**Architecture:** 沿用既有页面、播放器、连接控制器与 Electron 窗口 owner。不扩建资源管理框架，不改变协议、数据格式或部署架构。

**Tech Stack:** Node test、真实 Electron/Chromium、现有 Linux/PM2/Node/better-sqlite3、一次性 Gitleaks。

## 约束与当前行为

- 保留两端原有未提交改动；任务开始快照位于 `.codex-tmp/audit-resources-20260925/baseline/`。
- 生产只读核验；测试使用内存或独立临时数据，不重启正常服务。
- 扫描覆盖当前非忽略文件与全部可达 Git 历史，额外核查配置/备份候选；报告不包含秘密内容，不建设 CI 扫描系统。
- 共享 overlay socket 已有幂等启动/代次/释放；礼物特效、歌词窗和礼物核对仍有独立连接实现，须用运行证据决定修改。
- GPU 驱动长期稳定性不能由单次测试推导；本轮只验应用资源拥有与释放。

## Owner / 合同 / 验证

- 页面连接：`public/js/overlays/{socket-client,gift-effects,lyric-window}.js`、`public/js/gift-audit/index.js`；对应 `docs/architecture/frontend/{overlays,comms}.md`。
- 媒体：`public/js/overlays/gift-effect-player.js`、`public/js/lyrics/desktop-lyric-renderer.js` 和播放 engine；既有 gift effect、lyric、playback 生命周期测试。
- 桌面窗口：`src/electron/` 现有 controller/shutdown owner；既有窗口与 shutdown 测试，以及隔离 Electron 浏览器源反复打开、重连和销毁检查。
- 生产：服务端 `docs/operations/deployment-runtime.md`、`ecosystem.config.cjs`、`package.json`；实际 `/proc`、PM2、健康端点、内存 SQLite 与经源码审阅的隔离测试。

## 执行步骤

- [x] 追踪创建/重连/退出路径，运行现有定向测试，并针对疑点新增可失败的回归。
- [x] 未复现资源残留或重复持有，保留所有业务资源 owner 和现有行为。
- [x] 在隔离 Electron 中验证真实页面、重复网络断开/恢复、媒体停止/错误/GPU context loss、窗口销毁；记录计数而非以总内存波动推断泄漏。
- [x] 直接读取生产进程实际 OS/解释器/参数/安全环境摘要，健康检查及无业务数据副作用测试；无需调整生产。
- [x] 完成当前文件与 Git 历史扫描，逐类复核候选；删除当前原始凭据材料，报告只留分类和位置。
- [x] 检查本轮 diff、相关门禁与证据；前两项可关闭。
- [ ] QQ 音乐/ChatGPT 历史会话有效性或全设备撤销证据尚缺，待用户确认；不能仅以删除当前文件宣布历史秘密整项关闭。

## 验证记录

新增媒体/GPU 10 项及真实 Electron 1 项通过，相关既有测试 48 + 54 + 20 项通过；生产现有隔离测试 34 项通过；文档 5 项、架构 22 项、模块化 0 errors。没有修改业务代码或生产配置。详细证据位于本轮审计目录 `resource-runtime-secret-status.md`。

隔离探针初次带入 PM2 的专属 IPC 环境导致探针退出异常，排除两项 IPC 传输变量后正常；这不是 SQLite 兼容性问题。媒体探针初版没有生成足够视频帧，且将上一轮预期 context-loss 错误计入下一轮；修正测试夹具后通过，未借此修改业务代码。

## Done When

每项均有检查范围、真实问题判断、修改说明、测试结果及用户指定状态。不存在未说明的失败、生产数据写入或测试进程残留。
