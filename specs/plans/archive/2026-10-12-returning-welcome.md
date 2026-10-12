# 久别重逢欢迎与参数布局

Status: Completed

依据：2026-10-12 当前用户需求；使用 writing-plans，按本仓 PLANS.md 在当前会话实施，不提交或部署。

## 目标与边界

新增第四张「久别重逢」卡片、独立开关和客套话词库。四卡两列两行，双输入同行。距离上次记录的进场严格超过 24 小时才触发，天数向下取整；首次记录不推测。服务器仍只发送一条首次欢迎，个人欢迎词优先，随后久别、高荣耀、普通欢迎；二次问候不变。默认关闭新增开关。不新增阈值配置、消息通道或客户端发送者。

## 当前行为、归属与兼容

当前没有进场时间持久化；welcome-service 管理首次/二次阶段，welcome-options 与 welcome-settings 管理租户配置。新增 storage/viewer-visits 只保留租户库内的房间/UID/最后进场 UTC 毫秒，不存昵称或事件历史。监控有效期间记录有效进场，包括欢迎关闭、荣耀不足和冷却期间；避免把这些来访误判成缺席。不同房间隔离，重启保留，无历史不补造。

V2 增量字段 returningEnabled/returningMessages，V1 投影不变；旧 V2 缺少两字段时仅禁用新项。主进程严格校验，失败和迟到回包保留草稿。沿用原开关依赖、来源取消、昵称/舰队/注音和 40 UTF-16 长度限制。超长优先移除客套话保留天数，再沿用完整昵称短句。

## 实施与验证

- [x] 服务器：viewer-visits 与 streamer-storage 迁移；welcome-options、welcome-service、welcome-messages；扩展 welcome-stages/settings/HTTP 测试，补时间边界、重启、房间/租户隔离、关闭期间记录与重复进场案例。
- [x] 客户端：shared/welcome-settings-contract、admin/danmaku-welcome*.js、欢迎 HTML/CSS；扩展 frontend-welcome 与 welcome-settings-ipc，使用既有隔离 Electron fixture 验证两列布局、同排输入、开关、词库保存、旧服务器与失败草稿。
- [x] 同步服务器 viewer-welcome/OpenAPI/fixture、需求/验收、数据边界和 ADR 扩展；客户端 desktop/preload、desktop/main 与 frontend/pages、内置指南与参数截图。交互导览/README 没有需调整的欢迎入口或规则，保持原内容。
- [x] 执行两仓直接相关测试及文档门禁、客户端架构门禁；检查任务 diff、git diff --check 与 status，确认无运行数据进入变更。

命令：服务器 `node --require ./test/support/test-mode.cjs --test test/welcome*.test.js test/viewer-names.test.js`（显式展开文件）及 `npm run docs:check`；客户端 `node --experimental-vm-modules --test test/settings/frontend-welcome.test.js test/settings/welcome-settings-ipc.test.js test/desktop/fixed-reply-editor-electron.test.js`、`npm run verify:docs`、`npm run verify:architecture`。桌面 QA 通过项目 Playwright/node_repl 或既有测试，合成数据位于 tmp/，不启动用户主应用。

## 失败处理与完成标准

失败仅修正本任务改动，保留已有未提交内容；禁止重置或覆盖。兼容字段缺失不得误报成功。完成标准：规则、配置和四卡布局落实，针对性证据通过，文档与真实实现一致。未部署不声称线上已生效；上游未接收到的进场不推断。

## 完成证据与限制

2026-10-12 完成，未提交、部署或替换用户正在运行的客户端。

- 服务器七个欢迎/观众相关完整测试文件共 51 项通过。系统 Node 24.21 不符合仓库限制，实际使用已有 `tmp/danmaku-efficiency/node-runtime/node-v24.18.0-win-x64/node.exe`。初次生命周期替身缺少新存储边界，补充该边界替身后 6 项全部通过；业务/存储案例仍使用真实隔离 SQLite。
- 客户端欢迎 UI/IPC 31 项通过；welcome-editor、fixed-reply-editor、daily-bot-editor 三个真实隔离 Electron 测试通过。常用 1058px 内容窗口确认两列四卡、双输入同行、同行按钮对齐、独立写入、失败草稿及旧端禁用。额外通过 node_repl/Playwright 目视检查，匿名 /admin 返回 401；沿用实际 preload、认证和 IPC，未触及用户数据。
- 客户端架构门禁 27 项通过；设计机械扫描无发现。技术文档、协议、需求/验收和内置指南/截图同步。服务端文档门禁 54/55：当时已有礼物保留任务的 `src/storage/gift-retention-store.js` 尚未接入，导致可达性检查失败。客户端完整文档门禁中的自身计划状态格式已修正，链接/活动计划定向 3 项通过；既有 gift-retention 规格把计划路径作为 Runtime Evidence，仍导致规格索引检查失败。未修改这两个无关事项。
- 两仓 diff 空白检查通过；生成的检查目录/中间图仅保留于忽略的 tmp/。正式指南截图为合成数据。隔离 Electron 已关闭，三个自动化用例自行清理临时目录。
- 不声称真实 B 站发送或线上部署验收；首次记录不提示历史天数，监听中断期间未收到的来访不能补记。旧服务器保持原欢迎功能，更新两端后可手动开启默认关闭的新项。
