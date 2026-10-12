# 审计后五项产品裁决实施计划

Status: Completed

用户于 2026-10-12 确认全部按建议执行。

## Goal

关闭 AI 立即取消未完成回复；账号或房间变化取消在途随机点歌；歌词性能降至静态后可逐级恢复。保留本轮旧来源礼物补结算和官方公开工具品牌域名，并明确相应约定。

## Current Behavior

AI 开关目前只控制新任务准入；随机点歌昵称读取完成后可能混用新房间身份；歌词 manual 档可恢复但 static 档没有恢复分支。加班机已按 enableEpoch 划分结算轮次，公开工具按现行 REQ-UX-003 使用官方域名。证据见外部审计 remediation.md 与所属回归测试。

## Ownership And Boundaries

| 交付 | Owner / 消费者 | 文档与测试 |
| --- | --- | --- |
| AI 立即停用 | src/ai/ai-assistant-service.js、async-coordinator.js、现有配置保存入口；admin AI 设置 | docs/reference/backend/ai.md；test/ai/ai-assistant-*.test.js、ai-routes.test.js、frontend-admin-ai-settings.test.js |
| 随机点歌取消 | src/server/bilibili-runtime.js、routes/queue-routes.js；src/electron/desktop-auth-controller.js 与 main.js 私有 provider 身份代次；src/storage/settings-store.js 仅内存房间变更代次；现有随机点歌调用方 | docs/reference/backend/api.md、backend/storage.md、desktop/auth.md；test/songs/queue-random-request.test.js、相关 settings/runtime 与 desktop-auth-controller 测试 |
| 歌词恢复 | public/js/shared/lyric-performance.js、lyric-frame-scheduler.js；desktop-lyric-renderer.js | docs/reference/frontend/overlays.md、playback.md；test/lyrics/lyric-performance.test.js 与实际 renderer 检查 |
| 结算边界保留 | src/overtime/overtime-service.js、overtime-store.js（原则上不改） | docs/reference/backend/overtime.md；现有 test/overtime/ |
| 官方工具链接保留 | 服务器 public/site、public/admin、public/games（不改运行时） | 服务器 docs/requirements/system-rules.md REQ-UX-003 |

## Compatibility Constraints

保留已有未提交修改；不提交、发布或更新安装版。已发送 AI 内容不撤回；重新启用不补发旧回复；关闭 AI 不作为应用 shutdown。正常账号续期/重连不取消随机点歌，已入队歌曲不删除。歌词尊重系统减少动画设置，保留现有轻度降级行为。加班机关闭后重新启用划分结算轮次，累计时间重置保持独立操作。保持既有 HTTP 响应结构与授权边界。

## Milestones

- [x] AI：复用现有取消/队列生命周期，在保存关闭状态后失效排队、生成、分段和重试；更新设置说明与使用指导。回归必须覆盖关闭再开启后旧任务不发送、正常新任务可发送、shutdown 仍有效。
- [x] 随机点歌：在 runtime 所属异步流程复核账号/房间上下文，变化后返回现有失败结构并提示重试；避免只比较最终值遗漏切走再切回。回归覆盖昵称读取期间换号、换房及正常请求成功。
- [x] 歌词：增加静态到低效果再到完整动画的稳定恢复，恢复阶段重新累计健康帧，保留再次卡顿降级和 reduced-motion。覆盖各档转换及实际 renderer 消费。
- [x] 保留规则：核对现有加班机生命周期测试与官方地址规范；补足约定，不新增保护逻辑。
- [x] 集成：审阅各方向差异、执行文档与相关静态门禁，更新外部 remediation.md 和完成记录。

## 实施发现

- 现有账号 session revision 会在打开登录窗口、同 UID 导入 Cookie 时递增，直接用于随机点歌会误取消。仅在桌面认证 owner 记录真实登录状态/UID 变化，并通过私有 provider 给随机点歌读取；保留原 session revision 的其他消费者语义，覆盖切走再切回。
- 两项保留行为已有所属测试：加班机状态/结算 14 项、公开语言及品牌链接 5 项通过。只补技术约定及加班机使用说明，不改运行时。
- 实际歌词页面验证发现 33.3ms 时间戳量化与精确 1000/30 门槛造成正常帧被跳过，形成约 50ms 帧并误降级，阻止连续健康恢复。修正 scheduler 比较的亚毫秒精度，仍报告实际 elapsed，不修改目标帧率；增加量化与真实长帧覆盖。
- 房间保存后可能等待 WeSing 配置应用，再通知 Bilibili runtime；只在 configure 观察房间会漏掉该等待期间的切走再切回。因此在 settings-store 成功写入时记录仅内存的 room revision，单项、批量、账号换绑清空统一覆盖；同值及回滚不递增。runtime 读取该 owner 的代次，保留其他消费者原有应用/广播时序，不新增持久字段。

## Verification

各方向使用仓库 Node 24+，执行相关完整测试文件：`node --experimental-vm-modules --test <所属测试文件>`。歌词使用已存在运行时检查路径；需要 Electron 时遵循隔离数据与工具规则。AI/随机点歌使用本地假依赖与隔离临时状态，不连接真实服务。根代理最终运行 `npm run verify:docs`、相关语法/架构门禁；服务器只改文档时运行 `npm run docs:check`。所有编辑停止后执行两仓 `git diff --check` 与 `git status --short`。

## Non-goals / Failure Handling

不扩大到证据不足线索、原审计以外菜单遮挡、真实平台测试、完整产品性能验收或发布。失败先定位所属用例，不以重复全量运行替代诊断；回退仅撤销本轮所加语句，保留已有改动和用户数据。

## Done When

三个行为变更通过针对性测试，两个保留规则文档准确，用户指导及技术契约同步；最终差异已审阅，验证及未覆盖条件记录完整。

## 完成证据

- AI：12 个完整文件，136 个独立用例均有通过记录。初次批次唯一失败为新增路由夹具缺少默认空 trigger/URL，修正夹具后所属文件 9/9 通过；未为此改生产代码。
- 随机点歌：18 个完整文件、去重 175 项通过，含真实隔离 Electron 认证。初批唯一失败为新文案断言没有适应现有 toast 去句尾句号，修正期望后所属文件通过；settings owner 最后改动后的 8 文件 69/69。
- 歌词：5 个完整文件 30/30；实际浏览器源生产 renderer 在原生 rAF 下验证 static→manual 的 150 健康帧、再 30 帧恢复 WAAPI、再次卡顿降档和 reduced-motion 保持静态。所有隔离浏览器已关闭。
- 保留行为：加班机 14/14、公开品牌/语言链接 5/5。只同步约定与必要用户指导，无运行时修改。
- 客户端语法 1467 文件通过（22 实际检查、1445 缓存复用），架构 27/27，文档 10/10；计划首次因状态与说明写在同一行未被状态解析器识别，已按现有格式修正，没有改门禁。
- 服务器文档 55/55；默认 Node 24.21 被既有支持范围拒绝，换用支持的 Node 24.18 与既有 test-mode preload 后先通过所属协议 10 项，再通过全部文档门禁。未修改运行时版本政策。

完整命令、文件清单及限制保存于客户端 `tmp/audit-product-decisions-2026-10-12/{ai,random,lyrics,retained}-results.json`；公开交付记录为 `D:/Work/lira-audit/full-system-2026-10-12/remediation.md`。未提交、部署、打包或修改安装版。未覆盖真实模型/B站写入、完整 Electron 应用操作与硬件加速性能基准；原歌词硬件验收缺口保留。证据不足线索及原47项以外菜单遮挡不在本轮范围。
