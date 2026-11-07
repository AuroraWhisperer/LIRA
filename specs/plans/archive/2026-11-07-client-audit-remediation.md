# 客户端审计问题修复计划

Status: Completed

范围：2026-11-07 客户端审计确认的 F1–F8，用户已要求全部处理。

## Goal

修复失败跳转和持续礼物流的状态错误，消除画布、隐藏盲盒页、空礼物对账、失败封面、图片导出及歌词换行的已证实重复工作。保留原有播放、统计、编辑保存、导出及歌词显示语义，以回归和原审计场景的计数建立证据。

## Non-goals / Compatibility

- 不扩展到审计未确认的候选问题，不重构无关模块，不改变公开 HTTP/WS/IPC 契约或数据格式。
- 保留现有未提交改动，不提交、分支、发布，不控制用户正在运行的客户端。
- 使用合成数据库、歌曲与目录。临时脚本和证据位于仓库 `tmp/client-remediation-2026-11-07/`，报告在 `output/`。
- 保留 Electron context isolation、会话、授权、关闭清理和数据路径边界。

## Current Behavior

审计报告 `output/client-code-audit-2026-11-07.md` 记录完整调用链和复现。20 场景、60 次拖动造成 7,560 次整场景复制；1,000 次普通礼物造成隐藏盲盒页 1,000 次聚合；100 次空对账造成 100 次 SUM；4 秒失效封面产生 19 次请求；1,000 张图片重复索引同一目录 1,000 次；歌词 199 次换行调用 159,200 次 class toggle。队列与连续礼物流另有已复现的状态正确性问题。

222 项原有相关测试通过但未覆盖上述触发场景。修复需要扩展拥有者现有测试，不以旧测试通过替代回归证据。

## Ownership / Proposed Changes

| 范围 | 拥有者与消费者 | 测试与技术文档 |
| --- | --- | --- |
| F1 队列失败提交 | `public/js/playback/features/queue-operations.js` 复用 `playback-controls.js` 成功后的 playlistIndex 提交 | playback-app 相关测试；`docs/reference/frontend/playback.md` |
| F2/F4 盲盒刷新 | `public/js/admin/gifts/blindbox-analysis.js`、`blindbox.js`；复用事件总线、页面生命周期与已有 `top=10` API | `test/gifts/frontend-blindbox*.test.js`；`docs/reference/frontend/app.md` |
| F3 画布状态 | `component-preview-canvas-controller.js` 在预设变更通知中维护标题/dirty；view 一次状态渲染复用同一快照 | `test/admin/component-preview-canvas-controller.test.js`、已有画布浏览器测试；app.md 画布段 |
| F4/F5 礼物版本 | `src/storage/gift-query-store.js` 等存储拥有者统一内容版本；盲盒与冲刺消费者各使用依赖数据的版本 | gift-query/statistics/analysis、存储与远端对账测试；storage.md、bilibili/gift.md |
| F6 封面失败 | `public/js/playback/ui/fullscreen.js` 保留当前 URL 的失败状态，更换 URL 后可恢复 | fullscreen 相关测试与浏览器探针；playback.md |
| F7 导出目录 | `src/electron/gift-export-controller.js`、`public/js/overlays/gift-export.js` 每任务一次目录初始化、每图仅传图片项 | 已有礼物导出控制器/渲染测试；desktop 相关 reference |
| F8 歌词换行 | `public/js/lyrics/desktop-lyric-renderer.js` 只更新受活动行/可见窗口变化影响的节点 | 既有歌词 renderer/browser 测试；playback.md 必要说明 |

## Milestones / Verification

- [x] 播放与歌词：失败及过时跳转不裁剪，成功才提交；同 URL 失败不重复加载，新 URL 正常加载；歌词顺序播放、seek、时间轴与设置变化一致。
- [x] 管理页：连续事件在有界等待内刷新；慢请求不中途反复取消；隐藏标脏、恢复补一次；请求参数限制榜单投影，手动筛选与关闭仍隔离迟到响应。
- [x] 存储及导出：缓存仅被相关数据变更失效；验证事务回滚、外部写入、来源切换、更正/删除，不能用行数/最大时间近似内容版本；导出每任务一次索引，保留失败清理与图片项顺序。
- [x] 画布：缓存元数据随改名、保存、放弃、重新读取、新建、删除正确变化，返回值不暴露可变内部对象；拖动中非当前场景的整文档复制为 0。
- [x] 集成：重跑审计触发场景并保存计数；检查相邻消费者及技术文档，执行文档、语法与架构门禁，再完成 diff/status 审查。

定向命令在各模块确定测试文件后追加实际记录。画布初始范围：

```powershell
node --experimental-vm-modules --test test/admin/component-preview-canvas-controller.test.js test/admin/component-config-controller.test.js test/admin/component-preview-output.test.js test/admin/component-preview-contracts.test.js test/admin/component-preview-recovery.test.js
node tmp/client-remediation-2026-11-07/probe-canvas.cjs
npm run verify:quick
git diff --check
git status --short
```

不默认运行整库/安装器/真实云服务。若改动跨越更广契约，先记录理由再扩展检查。全量测试期间不编辑被测文件。

## Documentation / User Guidance

技术 reference 随内部状态、失效或刷新事实一起更新；操作入口、字段和设置不变时，不改用户指南、交互引导与截图。各模块收尾需明确此判断。保留原审计报告作为修复前证据，修复后结果单独记录。

## Rollback / Failure Handling

先保留原始基线与各模块定向 diff。失败时检查拥有者及复现，不修改无关用户内容；必要时仅反向应用本任务补丁。不使用 reset、整文件 checkout 或批量删除。上一轮被策略拒绝的 scratch 清理不再尝试。

## Done When

八项均有实现与对应回归/计数证据；无已知未解释失败，相关契约及文档同步；检查最终 diff、空白和状态，仅包含本任务预期改动。测试限制如实记录，不承诺未执行的真实账号或发布验收。

## Progress

- 已核对工作区原有改动、根与 scoped AGENTS、测试规则及审计报告。
- 按原授权并行分配播放、管理页和存储/导出；主代理负责画布及整合复核。存储缓存唯一由同一任务修改，避免 F4/F5 各自实现版本。
- F3 新增回归先复现未选中场景被复制，再修复；61 项画布控制器、保存/冲突/恢复与真实浏览器输出相关测试通过。原 20 场景/60 次拖动探针复跑：7,560 → 120 次整文档复制，非活动场景 6,840 → 0，序列化字符 102,804,480 → 1,631,760；最终位置仍正确变化。结果在 `tmp/client-remediation-2026-11-07/canvas-results.json`。预设列表 refresh 仅发现新增场景，重新读取已有场景继续使用原 reload 语义。
- 画布远端连接、浏览器及草稿恢复另 33 项通过，F3 共 94 项。没有修改通用配置 controller，原快照与订阅隔离保持不变。
- F1/F6/F8：100 项 Node 回归和 12 项浏览器测试/探针通过；失败跳转保持 b/c/d 队列，下一首 b；封面 19 → 1 次 HTTP；歌词 159,200 → 1,389 次 class 操作，实际变化仍 1,389。完整命令见 `tmp/client-audit-fixes-2026-11-07/playback/fix-report.md`。
- F2/F4：30 项相关回归通过；240 次连续事件 60 秒内新增刷新由 0 变为 120，慢请求不被事件打断。隐藏的 1,000 次事件产生 0 次请求，恢复可见补一次。错误读取不自行无限重试。
- F4/F5/F7：44 项查询、盲盒、保留及导出控制器回归和 3 项真实浏览器横幅测试通过。追加盲盒资格/昵称更正断言后所属 11 项重跑通过。空对账 100 次聚合扫描降为 0，目录索引 1,000 次降为 1，生成脚本载荷 111,680,890 → 196,516 字节。实际独立 Electron PNG 验证退出 0，透明合图、白底分图、40 条分页、末行像素及合并卡片通过。
- F4 真实页面片段与原生 MutationObserver 核验：初次未激活、折叠、分析覆盖、导航离开各 1,000 事件产生 0 次首页请求，恢复各 1 次；迟到结果隔离与 pagehide 清理通过，runtime errors 为 0。headless 环境未提供真实文档背景切换，visibilitychange 分支由 Node 回归验证。
- 独立只读复核聚合触发器、缓存 key、事务/外部连接/来源替换及画布元数据快照隔离，未发现新的可证实缺陷。
- 最终共 280 项不同的定向回归测试、3 项浏览器计数探针通过；架构 30/30、文档 10/10、全仓 1,763 个 JS 语法及 diff 空白检查通过。文档门禁早期计划状态格式失败已改为规范 Status 行后解决。没有运行整库测试或真实账号/云端/安装器验收。
- 技术参考六份已同步；操作入口、参数、公开协议和数据格式不变，指南与导览无需修改。原有未提交内容保留，未提交、打包或发布。完整修复记录在仓库 `output/client-code-audit-fixes-2026-11-07.md`。
