# 客户端第二轮优化修复

**Status:** Completed

日期：2026-10-03。

## Goal

重新核验第二轮审查的 A1–A6，仅修复当前仍存在的资源留存、重复渲染/查询/复制、身份映射重复及无入口的快捷档案分支。

## Non-goals

不修改服务器仓库、公开 HTTP/WS/IPC、持久化格式、认证或 Electron 主进程生命周期；不实施尚无测量证据的 StateService 序列化与 banner 索引建议；不调整已有 Toast 字号改动。不提交或发布。

## Current Behavior

当前工作区复跑原报告的真实模块隔离复现：移除 100 个 select 后仍有 100 个 document pointerdown 监听；20 次纯诊断更新导致最近礼物 20 次及盲盒 40 次 innerHTML 写入；50 条低价礼物枚举 100,000 个目录项；5,100 首歌曲的分页 concat 复制历史前缀 132,600 项。两份排名转换逐字段相同；快捷档案仅剩自身定义，与规格取消队列入口一致。

## Ownership / Compatibility

- A1：`public/js/shared/select-menu.js` 拥有增强控件，粉丝表单和画布 inspector 是消费者。原生 value/selectedIndex、reset、键盘/焦点及动态 options 不变；同轮 DOM 移动不视为销毁。
- A2/A3：`public/js/admin/state-renderer.js` → `app.js` → `gifts/index.js`；图片更新继续由 `gifts/recent.js` 的目录订阅负责；盲盒目录/在售/配置/展开继续由 `gifts/blindbox.js` 和 `settings-blindbox.js` 负责。保留设置先填充、通知去重、数量/金额修正和配置草稿。
- A4：`public/js/playback/content/loader.js` 的局部累计数组；保留顺序、offset、seenPages、错误与平台选择。
- A5：两个 danmaku poller 只共享纯 DTO 转换，来源标签和轮询状态机不变。严格保留 `currentRoomVerified === true` 与无灯牌 null。
- A6：`public/js/admin/fans/index.js`、对应 HTML/CSS 与 `docs/reference/frontend/app.md`；遵循 `specs/fan-profiles.md`。保留普通编辑器、展开/收起、IPC find action、存储和初始化去重。
- 以现有未提交工作区为基线，特别保留 `app.js`、参考文档及所有不相关改动。

## Milestones / Proposed Changes

- [x] A1：将外部 pointerdown/reset 监听收敛到文档级委托；离树后断开实例 observer，重新插入时恢复原增强实例。核对并删除无消费者的 `refreshEnhancedSelect`。用真实 Electron DOM 检查重复创建/移除、移动、重新插入、reset、键盘和 option/value 同步。
- [x] A3/A4：金额检查移到图片查询之前；分页使用 `const allTracks = []` 和 `for (const track of tracks) allTracks.push(track)`。追加价格边界/无查询断言，重跑已有分页用例。
- [x] A2：把 `changedKeys` 传至礼物 renderer；子视图按字段分发，映射状态单独刷新；继续由目录与展开事件直接更新列表。用实际列表断言无关更新不写 DOM、数据修正/目录/配置会刷新及通知不丢失。
- [x] A5：新增 `src/bilibili/danmaku/rank-identity-hint.js`，把现有转换原样迁移为 `toRankIdentityHint(userMeta)`，两个 poller 具名 require。重跑 poller 用例并核对身份未知/已核实转换保持原样。
- [x] A6：删除无消费者的快捷入口、专属 DOM/CSS；普通编辑器仍挂载 body，初始化继续只执行一次。重跑两个粉丝前端测试文件及页面组合检查。

## Verification

逐项运行直接相关的 Node 测试；测试新建回归先确认失败。最终定向组合：

```powershell
node --experimental-vm-modules --test --test-concurrency=4 test/admin/admin-state-renderer.test.js test/admin/admin-state-ordering.test.js test/admin/frontend-admin-runtime.test.js test/admin/frontend-admin-startup.test.js test/admin/admin-page-composition.test.js test/playback/frontend-playback.test.js test/gifts/frontend-blindbox-mapping-state.test.js test/gifts/gift-artwork-identity.test.js test/gifts/gift-banner-feed.test.js test/bilibili/bilibili-user-info-pollers.test.js test/bilibili/bilibili-fans-medal-poller.test.js test/fan-profiles/frontend-fan-profiles.test.js test/fan-profiles/frontend-fan-profiles-view.test.js test/ui/frontend-select-menu-overflow.test.js
npm run verify:quick
git diff --check
git status --short
```

新增回归文件列入对应定向运行。隔离 Electron QA 只加载真实 renderer 模块和合成 DOM/数据，所有临时文件/独立 userData/sessionData 位于 `tmp/`，不启动用户主应用或读取真实数据。

## Rollback / Done When

失败时检查并修正当前项；若需要撤销，只反向应用本任务补丁，保留用户已有改动。所有确认项完成、相关检查通过、参考文档准确且 diff 无运行数据后完成；记录真实验收限制，不声称 CPU/FPS 或零风险保证。

## Evidence

- 原隔离复现在修改前确认了 A1–A4；新增生命周期、图标早返回及礼物分发回归在旧代码上失败、修复后通过。
- 最终 19 个定向测试文件：123 项通过、0 失败、0 跳过。除上述命令列出的文件，还运行 `test/ui/frontend-select-menu-lifecycle.test.js`、`test/gifts/frontend-gift-panel.test.js`、`test/gifts/frontend-blindbox-mapping-refresh.test.js`、`test/gifts/frontend-blindbox-admin.test.js` 和 `test/ui/frontend-toast.test.js`。
- `npm run verify:quick`：文档治理 9 项、1192 个 JavaScript 文件语法、架构/模块边界 22 项全部通过。
- Electron 43 隔离窗口：100 次下拉框替换、50 次实际粉丝编辑器打开/关闭后，document pointerdown/reset 各 1 个，实例 observer 数量不增长。断开节点减少对应 observer，重新挂载恢复且不重复包装。键盘选择、Escape/Tab/外部关闭、焦点返回、原生 reset（含外置 form 关联）、value/selectedIndex 及 option 更新通过；截图确认编辑器和菜单可见。
- 礼物回归：首次渲染后，20 次诊断和 20 次直播状态更新导致两个列表 innerHTML 写入均为 0；同 ID 数量/金额修正、图片目录、配置草稿仍刷新，映射状态仅更新文字，通知仍收到修正后的记录。
- 核对 A2 依赖时同步补齐：初始盲盒目录渲染等待现有图片目录加载，配置输入主动更新预览；不再依赖下一次无关状态推送。
- A5 转换内容与原两份实现逐字段一致，保留严格布尔判断、灯牌 null 和各 poller 的来源/状态机。A6 生产代码、页面和样式已无快捷入口引用；正常档案测试与表单交互通过。
- 已审查本次 diff、未跟踪新增文件，以及 `app.js`/参考文档相对任务开始备份的差异。`git diff --check` 通过，原有修改保留，无生成或运行数据加入源码 diff；无提交、分支或发布。

日志、隔离 Electron 主程序、合成数据结果和截图在 `tmp/client-round-two-fixes/`。自有 Electron 进程与临时 HTTP 服务已关闭。隐藏窗口的首轮压力检查因计时器节流超时，清理该自有进程后改为按 MutationObserver 微任务交付再验证，上述结果来自成功完成的一轮。

验收限于真实 renderer 模块、合成数据和隔离 Electron DOM，不宣称真实账号/服务器、完整画布业务流程或 OBS/直播姬实播验收。原报告记录的 Toast 字号静态断言与既有用户样式冲突没有改动；本次通过的是相关 Toast 行为测试。两项待测优化仍不作为确定缺陷实施，未声称 CPU、堆字节或 FPS 改善。
