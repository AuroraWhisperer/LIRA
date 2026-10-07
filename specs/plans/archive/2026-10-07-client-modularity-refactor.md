# 客户端职责整理实施计划

Status: Completed。依据：本次客户端模块审查及用户要求逐项落实。完成于 2026-10-07；全量门禁的原有失败与测试副本清理限制见 Results。

## Goal

让现有模块按真实职责组织，复用同一规则和生命周期，移除已退役的产品入口；保留现有行为与数据安全边界，不为行数或形式增加抽象。

## Current Behavior / Ownership

- 画布预览：`public/js/admin/*canvas-data.js` 重复轮询；礼物心愿回退触发空 catch 门禁；场景模型已有冻结快照，stage/inspector/view 尚未充分使用。
- 加班机：`overtime.js` 同时拥有规则协调、目录投影和礼物选择器；`gifts/wish-picker.js` 已拥有独立选择器及取消能力。只复用目录、搜索和显示的公共部分，保留身份/排除规则差异。
- 已退役入口：`scene-editor.js` / `component-workspace.js` 无产品调用，参考文档明确记录。沿实际消费者检查其专有模块、CSS 和测试；共享 stage、inspector、模型、保存批次保留。
- Electron：`ipc/license-ipc.js` 混合授权、弹幕设置、歌单及背景处理；来源校验仍由统一注册入口拥有。
- 云同步：`cloud-sync-controller.js` 混合礼物互动 UI 状态与同步调度。主控制器继续独占账号代次、串行队列、设置持久确认、重试和取消；独立的互动状态通过窄接口参与。
- 粉丝档案：`fans/index.js` 动作分支混合传输、提醒、名册及编辑流程；保留单一选中项、上下文和草稿状态。

契约归属：`docs/reference/frontend/overlays.md`、`frontend/app.md`、`desktop/preload.md`、`desktop/main.md`。保护测试分别在 `test/admin/`、`test/overtime/`、`test/license/`、`test/cloud-sync/`、`test/gifts/`、`test/fan-profiles/`。

## Constraints / Non-goals

不改变 HTTP/WS/IPC、页面 URL、持久化格式、授权、来源校验、账号隔离或启动关闭顺序。不增加依赖、构建步骤、进程或通用框架。不提交、分支、发布。不机械拆分 main/server/remote-gift/license-manager，也不合并跨运行时镜像契约。保留此前用户改动；任务前文本快照位于 `tmp/client-modularity-refactor/baseline/`。

## Milestones

- [x] A. 明确心愿目录失败回退；在 admin 内提取两个画布数据源共用的轮询 owner。保持每类单请求、失败置空、超时及销毁取消。运行 `component-preview-providers` 和架构检查。
- [x] B. stage/inspector/view 的只读路径使用既有冻结快照，保留编辑拷贝和手势历史。运行场景模型、canvas-editing、canvas 浏览器及已有隔离 Electron 场景检查。
- [x] C. 提取加班机礼物选择器，复用已有目录角色 helper 及共同的图片按钮。保留两种选择器不同的搜索、取消和身份规则。运行 overtime 与 gift-wishes 相关测试。
- [x] D. 删除已退役入口和确实专有的实现、样式及测试；更新测试分组和当前参考。保留共享组件和历史记录。核对运行时引用及当前画布测试覆盖。
- [x] E. 按授权、弹幕设置、歌单/背景职责整理 IPC 处理器和转换；统一来源校验、错误过滤和通道名不变。运行 license/overlay/welcome/pk/background 测试。
- [x] F. 提取礼物互动状态与提交结果，保持账号代次及串行任务 owner；运行 cloud-sync 全部本地测试和 gift-interaction-controls。
- [x] G. 提取粉丝编辑/业务动作，并归并传输动作到已有 transfer-ui；保留账号与选择状态单一归属。运行 fan-profiles 相关测试。
- [x] H. 更新 owning 文档；逐项审查最终改动。运行 `npm run check`、`npm run verify:architecture`、`npm test`、`git diff --check` 并记录真实结果和环境限制。

## Verification / Failure Handling

基线：providers/config-controller/scene-model/module-boundaries 共 59 项，58 通过，仅心愿空 catch 门禁失败。实现按批运行直接相关测试；浏览器/桌面测试使用仓库隔离夹具。完整测试失败先区分任务引入和原有环境/契约问题，不能削弱断言或改无关功能。回滚仅逆转本任务改动，使用任务前快照核对，不覆盖其他用户改动。

## Done When

所有里程碑都有实现或基于消费者证据的保留结论；公共行为与状态所有权一致；无新重复请求/事件绑定；相关测试与要求的检查有真实结果；文档、测试分组、最终 diff 与工作区状态已核对。完成后归档计划。

## Results

- A/B：providers、模型和 ESM 边界 37/37；canvas-editing、浏览器画布与隔离 Electron 弹幕画布 17/17。模型的 `getSnapshot/subscribeSnapshot` 已存在，本次让只读消费者使用它们；图层列表原有签名缓存已避免纯拖动重建，不重复实现。
- C：overtime 前端 6/6，选择器与许愿 38/38。`overtime.js` 从约 580 行降到 217 行；目录和选择器移入有独立状态的 owner。搜索请求、空态与取消合同不同，未强行合并；共享 `picker-option.js` 的图片、按钮和选择事件，复用既有目录角色逻辑。
- D：删除 4 个无产品消费者的 JS、专有 CSS 和两组旧入口测试，清理旧 inspector 分支；当前画布、发布、保存批次和 ESM 边界 41/41。运行时代码及当前参考无退役模块引用；保留场景模型、模板数据和 HTTP 契约。
- E：IPC 主入口从约 581 行降到 230 行，子注册器不接触原始 `ipcMain`，公共脱敏继续共用。相关授权/弹幕/欢迎/PK/背景 25/25；原安全源码检查扩展至所有拆出模块。
- F：cloud-sync 与 gift-interaction-controls 100/100。提取互动状态后主控制器约 551 行；持久待传、dirty/revision 和账户代次相互约束，继续由一个同步 owner 管理。已有 songs owner、remote-gift、license-manager、main/server 及跨运行时镜像合同没有仅为行数再拆分。
- G：fan-profiles 138/138，包含提交防重、失败留稿、分步确认与解绑回归。表单 owner 约 58 行、档案动作约 48 行，备份/导出归并到既有 transfer；页面继续独占请求上下文和选中项。
- 最终检查：`npm run check` 1339 个 JS 通过；`npm run verify:architecture` 19/19；`git diff --check` 通过。已有 Electron 两组画布用例均通过真实桥接、保存、发布和重新打开验证。
- 全量 `npm test` 实际执行 3818 项（原生进程组 3 项 + 主组 3815 项），首次 3737 通过、81 失败。用任务前源码构造独立副本，复跑 20 个失败文件，其中 77 项在本次改动前以相同原因失败：旧样式/资源清单、过时 UI/主进程夹具、已有画布重开/样式/草稿回执断言、打包排除、场景大小与计划状态格式等。未修改这些无关功能或削弱断言。
- 本次引入的 3 项检查失败已修正：加班机源码断言跟随新 owner、已退役测试的规格证据链接、互动状态方法改为 `confirmState` 避免原生 `confirm` 禁用检查的误命中。后续 cloud-sync、互动控制、Admin runtime、UI surface 合计 108/108；`npm run verify:docs` 9/10，规格证据已通过，仅任务前已有 `2026-10-06-woodland-frame-avatar.md` 状态标签格式仍失败。原生 Windows 所属进程查询首次超时，隔离重跑 3/3。没有将局部复跑描述为全量绿灯。
- 对照副本测试还因未复制历史 archive 链接及打包测试子进程传输报错出现 3 项副本专属失败，这些不计入上述 77 项同原因复现。日志与逐项对照在 `tmp/client-modularity-refactor/`。
- 测试环境：服务端当前检出与客户端锁定提交不一致，使用仓库 `tmp/` 下独立 detached 测试 worktree（`01fb2b47d5e081f5dd559933991ade4819eb3428`），通过 `LIRA_SERVER_ROOT` 指向；没有切换服务端用户工作区。完成后确认干净并移除该 worktree。
- 最终按任务前文本快照审查本次修改，保留其他已有和并行任务改动；未提交、建分支或发布。临时 `baseline-runtime` 的递归清理被自动审批以 `blocked by policy` 拒绝，副本留在仓库 `tmp/`；未改用其他方式绕过。
