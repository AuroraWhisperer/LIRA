# 本地弹幕外观归属实施计划

Status: Completed

## Goal

按用户 2026-10-28 的确认，统一为服务器提供事件、桌面保存和渲染外观、本地 `/scene` 输出。新增样式不再依赖服务器样式发布；同账号共享参数、重启保留、账号间隔离。

## Starting Behavior And Ownership

`danmaku-overlay-settings.js` 仍通过 license IPC 写远端；`scene-runtime.js` 从 `cloud-display-buffer.js` 的云端外观缓存取得默认值和共享参数；`scene-cloud-controller.js` 在事件入口校验样式，导致样式不兼容也阻断事件。已有配置控制器、场景通知、单一按需订阅、场景 capability 和渲染器全部可复用。

Owner：本地 `src/server/danmaku-appearance.js` 与 `src/storage/danmaku-appearance-store.js`；组合根 `scene-runtime.js`；远端事件仍属于现有 cloud controller/buffer。契约更新 ADR-0022、component-scenes 规格、overlays/API/storage 参考和工程工作流。用户入口与指南同步。

## Compatibility And Non-goals

- 账号 scope 由授权 main 提供的服务器 origin + streamerId 决定，不信任 renderer 身份。
- 新增独立 owner-scoped 外观表，通过追加迁移创建；不修改既有迁移，不批量重写场景，不把共享外观复制到每个场景。
- 首次读取承接旧远端配置；已存在的本地配置绝不被后续云端快照覆盖。迁移失败保留原数据并允许重试；异步读取重新核对账号与授权 epoch。
- 保留旧远端 HTTP/IPC 兼容接口、事件契约及 renderer core 固定快照。新流程不再写远端外观。认证、过滤规则和监控仍维持原 owner。
- 保留工作区无关修改。不提交、部署、打包或操作用户正在运行的实例。不新增服务、框架、渲染器或通用同步系统。

## Milestones

- [x] 新增本地外观 store/service 与读写管理路由；复用现有标准化，使用读取时的账号 binding 拒绝跨账号晚到写入。验证迁移幂等、重启、非法输入原子拒绝、账号隔离、旧配置只承接一次。
- [x] 场景默认值和共享外观读取本地 owner；保存通过已有通知更新输出。事件链路忽略旧外观字段，保留事件验证、撤回和游标语义。验证未知样式不阻断事件、保存不重播、多个场景仍共享订阅。
- [x] 参数面板复用配置控制器改接本地 API，授权变化清理草稿；去掉旧服务器地址，沿用现有场景源入口；场景地址不依赖旧外观接口。验证保存/失败/账号变化及桌面实际操作。
- [x] 撤回错误的强制镜像规则和工具；服务器工作区混有并行功能，保留已有旧在线源兼容实现，只取消新流程依赖和强制镜像门禁，避免回退跨任务改动。同步规范和用户说明。

## Verification

直接运行 appearance store/service、scene-display/cloud-controller/runtime、参数面板和场景入口所属 Node tests；复用现有隔离 Electron 夹具进行保存和场景消费检查。执行 `npm run verify:docs`、`npm run check`、`npm run verify:architecture` 以及 `git diff --check`。服务器有实际撤回时按其 `verify -- --plan` 选择对应完整文件，运行文档检查；不把源码验证称为部署验收。

## Failure Handling And Done When

先保存本轮起点 diff 与将改动文件的恢复副本到 `tmp/local-danmaku-appearance/`。失败局部修正，不使用 reset/checkout，不清除未知用户改动。完成要求：实际新入口不调用远端外观写接口；场景与参数面板共用本地配置；旧数据和授权边界保全；相关检查与隔离桌面证据通过；文档一致且最终差异经审阅。运行实例/真实 B 站/正式安装包未验收须单列限制。

## Evidence

实施前已读取原对话最后两轮，确认用户要求客户端统一渲染与本地场景源。最终未删除服务器已有样式；这是兼容取舍，不再把其部署作为客户端新增样式的前置条件。

- 本机 store/service、场景 runtime/display/cloud controller、迁移与启动组合：118 项通过；参数面板、账号切换与入口回归 28 项通过，补充授权观察/参数编辑 17 项通过。
- 扩展兼容检查初次 96 项中 3 项因旧画布夹具仍使用 cloud.getSettings 失败。统一更新该夹具的迁移与本机 owner，不改行为断言；后续 scene-renderer、scene-live-updates、scene-renderer-state、shared-appearance、component-source、component-preview-output 46 项全部通过。
- 最后修正首次承接与旧地址读取的重复请求：只合并同一主体/授权 generation 内进行中的普通 GET，保留带 AbortSignal 的事件订阅独立取消。所属 IPC、参数面板、cloud controller 与 CSS 归属回归 89 项通过。
- 复用隔离 Electron 夹具的画布、共享外观、手账风、雪狐和桌面授权共 9 项通过。画布保存失败断言改为本机错误并等待异步保存结束后检查可重试；其余草稿、沙箱与授权断言保留。人工通过真实 Electron 保存幽灵便笺字号 28，关闭并以同一隔离数据库重启后读回一致；指南截图来自该隔离界面，实例已关闭。
- 客户端 verify:docs 10 项、语法与 verify:architecture 28 项通过；服务器 docs:check 58 项通过。新接口、v17 表、ADR、两仓交付规则、入口帮助与用户指南已同步，更新实际保存入口截图。交互导览未引用变更入口，无需改动。
- 最终检查运行 `git diff --check` 并审阅工作区状态；原有并行参数重构、服务器功能及安装器修改保留。废弃镜像脚本/测试仅移至忽略的 tmp 恢复目录。

边界：本机外观不会自动跨电脑同步，旧服务器在线源仍用旧配置，本机输出必须保持 LIRA 运行。未操作真实主播数据、正式运行实例、B 站上游或 OBS/直播姬实播；未打包、提交、发布或部署。这些不计作本次源码和隔离验证已覆盖的结果。
