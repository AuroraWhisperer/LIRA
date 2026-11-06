# 客户端大文件职责拆分实施计划

Status: Completed — 2026-11-06，四处职责拆分及相关回归完成；无关全局门禁限制见执行记录。

## 目标与当前行为

复核大文件审查中的五个候选，只提取具有独立职责和消费者的完整行为，保持现有客户端功能。按目录并行实施，主代理集中审查与回归。行数只用于发现候选，不作为拆分验收条件。

已确认 `src/server.js` 在装配之外拥有云快照、菜单合并和同步通知状态；弹幕参数合同混入 DOM 应用；Electron 云调度器混入设置与凭据的专属协议；粉丝入口重复承担已有档案动作模块应拥有的工作流。历史迁移仅略超审查线且低频稳定，本次保留，避免增加无收益的数据迁移风险。其余大文件的统一生命周期、组合根和生成数据边界沿用审查结论。

## 范围与兼容约束

- 只涉及 Live 客户端，不修改独立 LIRA Server，不改变 HTTP、IPC、WebSocket、页面、持久化或字段合同。
- 保留授权代次、账号隔离、pending 确认、dirty/revision 判定、串行队列、取消、SSE 和统一重试的单一所有者。
- 服务初始化/失败清理/关闭次序、菜单通知合并、选中项和上下文防迟到规则保持原样。
- 不新增依赖、框架、服务、全局变量、通用可变 context 袋或仅转发的抽象；优先扩充现有所有者。
- 当前工作区有大量既存改动，以 `tmp/client-responsibility-refactor-2026-11-06/baseline/` 的任务开始快照区分本次改动；不提交、重置或覆盖其他任务内容。

## 所有权与并行分工

| 批次 | 代码与消费者 | 文档 | 回归范围 |
| --- | --- | --- | --- |
| 服务运行时（主代理） | `src/server.js` → `src/server/cloud-sync-runtime.js`；既有 runtime/API facade | `docs/reference/backend/server-core.md` | cloud-runtime-sync、cloud-room-account、danmaku-menu；server lifecycle/cleanup/smoke/publication |
| 弹幕合同（子代理） | `public/js/shared/danmaku-style-options.js` 与浏览器应用模块；`public/js/overlays/danmaku.js`、镜像生成器及直接消费者 | `docs/reference/frontend/overlays.md` | 参数合同、镜像一致性、现有实际 DOM/排版浏览器测试 |
| 桌面云协议（子代理） | `src/electron/cloud-sync-controller.js` 与 settings/Bilibili scope 协作者；已有 song sync 为边界参照 | `docs/reference/desktop/main.md` | cloud-sync 下账号隔离、设置恢复、凭据、请求次数、歌曲恢复与响应校验 |
| 粉丝操作（子代理） | `public/js/admin/fans/index.js`、既有 `profile-actions.js`；UI 状态仍留入口 | `docs/reference/frontend/app.md` | frontend-fan-profiles 及直接相关 view/roster/transfer 测试 |

子代理先独立复核必要性，再运行当前相关测试建立基线后实施；禁止跨目录整理或运行全套。共享计划、路线表及最终门禁由主代理维护。提醒横幅和历史迁移不在本次默认拆分范围。

## 实施与验证里程碑

- [x] 各批次确认接口和状态边界，记录变更前相关测试结果。
- [x] 服务云同步行为连同菜单签名、合并标记、订阅及映射状态归位；保留运行时门面与现有调用次序。
- [x] 弹幕 DOM 应用离开纯合同，更新所有导入和源加载夹具，确保 Node 镜像只含纯规则。
- [x] 桌面仅提取 scope 专属协议；公共生命周期、账号身份、串行调度和 revision 状态仍集中。
- [x] 粉丝完整档案操作归入既有 action 模块；不引入第二份选中项、上下文或编辑器状态。
- [x] 独立审查各批次差异、消费者及回归，修复本次引入的问题。
- [x] 所有写入停止后执行合并聚焦回归、架构/语法/文档门禁并检查最终 diff/status；全局门禁的无关失败已定位和记录。

主要命令：

```powershell
$taskTests = @(rg --files test/server test/cloud-sync -g '*.test.js') + @(
  'test/fan-profiles/frontend-fan-profiles.test.js',
  'test/fan-profiles/frontend-fan-profiles-view.test.js',
  'test/fan-profiles/frontend-fan-calendar.test.js',
  'test/danmaku/danmaku-style-options.test.js',
  'test/danmaku/danmaku-local-preview.test.js',
  'test/danmaku/danmaku-entry-display.test.js',
  'test/danmaku/danmaku-typography-browser.test.js',
  'test/danmaku/danmaku-feed-motion.test.js',
  'test/desktop/desktop-auth-diagnostics.test.js',
  'test/gifts/gift-interaction-controls.test.js'
)
node --experimental-vm-modules --test --test-concurrency=4 @taskTests
node scripts/sync-danmaku-style-options.cjs --check
npm run check
npm run verify:architecture
npm run verify:docs
git diff --check
git status --short
```

DOM/浏览器测试复用现有隔离夹具，不操作用户正在运行的 Electron，也不以普通浏览器替代桌面权限验证。测试文件由 `rg` 与显式列表共同传给 Node。预期相关测试全通过；若基线已有失败，单独诊断并记录，不放宽断言、不反复盲跑。

## 同步、失败处理与完成条件

模块所有权变化同步上述当前参考文档和必要路线表；行为、操作步骤和 UI 无变化，用户指南无需改动。现有测试保持行为断言，只为新模块路径调整加载方式；只有发现明确覆盖缺口才补测试。

失败时停止依赖该批次的后续工作，比较任务快照与当前文件，仅撤回或修复本任务的片段，不使用整仓还原。最终完成要求：四个确认边界完成且无新增的已知回归；相关测试和门禁结果如实记录；无未解释的状态/清理变化；无运行数据进入 diff；文档一致；已检查本次差异与既存工作区改动。

## 执行记录

- 2026-11-06：复核候选并保存任务开始快照。历史迁移保留；四个目录批次准备并行实施。
- 2026-11-06：四批完成。服务基线 105/105；粉丝前后 46/46；弹幕前后 63/63（含现有 Chromium 排版与动效）；Electron 协议前后 78/78，另认证退出回归 9/9。菜单新增一项通知合并/关闭取消行为测试；初次运行因测试监听调用不完整假 settings 的序列化失败，已限定为观察通知，原有真实运行时测试继续验证菜单内容，菜单文件 5/5 通过。
- 服务适配器、Electron 协议和粉丝动作分别经过另一子代理只读审查；主代理检查所有批次。未发现新增缺陷。settings/Bilibili 通过同步 revision 回调保留原落盘与播种次序；弹幕函数体原样移动到 `public/js/overlays/danmaku-style-application.js`，镜像生成器和 Node 镜像无需变化，检查通过。
- 快照后发现另一个进行中的任务修改了 `src/server.js` 的礼物 artwork 注入。该片段保留，未纳入本次职责拆分；最终检查以当前整合内容为准。
- 集中回归：上述命令 329/329 通过，无失败、取消或跳过；运行期间未修改本次源文件。语法脚本 1,737 份通过（4 份执行、1,733 份使用内容匹配的既有缓存），参数镜像检查和 `git diff --check` 通过。
- 架构门禁 27/28：唯一失败是 `public/js/admin/overtime.js` 已无空 catch，但 `test/engineering/module-boundaries.test.js` 仍保留其旧债务基线。任务开始的 `pre-existing.patch` 已包含该文件空 catch 改为 `catch (error) { showError(error); }`，基线测试文件本轮未改；这是既存的无关失配，不修改或放宽断言。其余依赖/ESM/规模规则通过。
- 文档门禁首轮 9/10：本计划采用中文状态标签，校验器只接受 `Status:`。已修正标签，保留真实失败记录并复验。
- 文档复验仍为 9/10：本计划状态问题已消除，剩余为其他进行中任务的 `2026-11-06-gift-motion-effects.md` 同样缺少可识别的 `Status:` 标签。该计划不属于本任务，未修改；参考链接、路线表和文档合同检查均通过。
- 最终保留历史迁移、Electron 主入口和其余统一状态机；四处拆分只调整内部责任归属，HTTP/IPC、持久化、用户操作和外观不变，用户指南无需修改。产品源代码、测试调整、五份职责参考及计划差异均已复核，既存/并行任务内容保留，无提交或发布。
