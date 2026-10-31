# 观众取消点歌开关实施计划

**Status:** Awaiting Verification

**Goal:** 在「点歌规则 → 接收与排队」增加默认开启的「允许观众取消点歌」，保存后控制两种取消指令。

**Architecture:** 复用现有点歌控制设置的默认值、标量校验、settings 文本存储及账号同步。在 Bilibili 指令桥接层检查开关；music 队列继续拥有归属核验与删除。Server 只保存认证租户的可选设置。

**Tech Stack:** CommonJS、原生 ESM/HTML、SQLite settings、Electron。

## 当前行为、所有者与兼容边界

- 当前取消指令默认可用，`src/bilibili/bilibili-message-handler.js` 调用 `queue.cancel`，已验证本人最后一首、完整歌名、身份隔离和实时/历史去重。
- 新键 `songRequestCancelEnabled`：客户端存 `'true'/'false'`，云端为 boolean，默认 true；旧配置缺字段仍开启，旧同步快照省略字段保留已存值，非法批次不部分保存。
- 设置 owner：Live `src/shared/song-request-settings.js`；Server `src/lib/streamer-sync-settings.js`。表单 owner：`public/pages/admin/song/request-rules.html` 与 `public/js/admin/settings-form.js`；通用表单回填已按设置键匹配控件。
- 关闭只拒绝取消命令，不改现有队列、点歌准入、管理员删除、冷却、归属和去重规则。沿用原接口、存储格式及租户边界，不迁移数据库，不添加依赖。
- 保留两个仓库已有并行修改，不提交、发布、部署或使用真实账号数据。交互式引导介绍主入口，内容不受影响。

## 实施与验证

- [x] 扩展现有测试：缺省/显式开启可取消；关闭后两种指令均拒绝且队列、冷却不变；设置保存/重建、非法标量、旧快照省略、表单一次提交及 Server 租户隔离。
- [x] 实现共享默认与布尔归一化、现有表单中的开关及提交字段；取消分支首先检查 `settings.songRequestCancelEnabled === 'false'`，返回明确拒绝原因并接入诊断。
- [x] Server 可选设置加入默认值、boolean 集合、两份 OpenAPI 的输入/输出和标量 fixture；同步 Live API/storage/danmaku/应用内说明与 Server requirement/acceptance/protocol。
- [x] Live：`node --experimental-vm-modules --test test/settings/settings-contract.test.js test/settings/frontend-song-request-settings.test.js test/songs/queue-service.test.js test/bilibili/bilibili-diagnostics.test.js test/admin/frontend-admin-shell.test.js`。
- [x] Server：`node scripts/run-with-node.cjs --require ./test/support/test-mode.cjs --test test/cloud-state-sync.test.js test/settings-input-contract.test.js test/cloud-sync-http.test.js`。
- [x] 同步消费者：`node --experimental-vm-modules --test test/cloud-sync/cloud-sync-controller.test.js test/cloud-sync/cloud-runtime-sync.test.js`。
- [x] Server `npm run docs:check`；复用现有隔离桌面检查方式验证开关位置、默认值、保存及回填；不控制用户运行中的应用。
- [x] Live `npm run verify:docs`：2026-10-28 复核为 10/10 通过，原并行 RIPPLOID 计划缺少 Status 的阻断已消失。
- [x] 两仓审阅任务 diff、`git diff --check` 与状态，确认临时文件仅在 tmp、没有敏感或运行数据进入 diff。

## 失败处理与完成条件

检查失败时只修正本任务具体 hunks，保留用户和并行变更，不使用破坏性回滚。开关出现在点歌规则、默认开启、关闭与重新开启均立即按保存值执行，设置持久化和兼容同步测试及文档检查通过后完成。记录本地验证范围，真实直播与生产同步部署单独说明。

## 验证记录

- 2026-10-27：新增 Live 四项筛选测试与 Server 一项现有持久化用例在实现前失败；实现后上述 Live 59 项、Server 37 项完整相关测试文件通过。
- 复用文档截图的真实 Electron/preload/runtime 夹具，独立 tmp 数据与 userData、随机端口、窗口隐藏。导航前 `/license` 和 `/admin` HTTP 200；新控件唯一且位于「接收与排队」，默认 true，未保存选择不改变运行值，关闭保存一次后刷新为 false，重开保存一次后刷新为 true。说明包含两种指令，四列桌面布局正常。Electron PID 27544 已关闭，合成数据/profile/截图与启动脚本已验证路径并清理。
- 旧规则截图仍作为 SC 与点歌间隔的示例，未声称涵盖全部开关；新增操作以正文与控件说明同步。交互式引导入口、数据库 schema、架构、发布契约锁不变。
- 账号同步消费者 20/20 通过（Live 合计 79 项相关测试）；Server 37 项相关测试与 57 项文档/协议检查通过。Live 文档检查 9/10，失败仅为并行 RIPPLOID 计划缺少状态；本计划保留 Awaiting Verification，剩余复验范围仅为 Live 文档门禁。
- 两仓任务 diff 与空白检查已核对，既有及并行变更保留。未打包、提交、部署或连接真实直播间；跨设备账号同步上线还需部署配套 Server 字段，本机开关与持久化已验证。
