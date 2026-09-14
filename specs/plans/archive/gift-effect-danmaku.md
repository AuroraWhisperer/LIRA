# 弹幕礼物特效 Implementation Plan

**Status:** Superseded — 2026-09-14 用户取消名称触发，改为代码调用测试播放解析器；
由 [代码指令调整](gift-effect-code-commands.md) 取代。以下保留上一版实施记录（未部署）。
**Goal:** 实现 [弹幕礼物特效规格](../../gift-effect-danmaku.md)。
**Architecture:** 服务器 RoomMonitor 调用礼物领域的同步匹配器，读取已发布 schema 3
目录与租户开关；复用有能力协商的 Device SSE。Electron 沿现有授权代际接收，只转发
校验后的展示数据；独立 OBS 播放模块负责串行播放。
**Tech Stack:** 现有 Node/CommonJS、Electron、原生 ESM/CSS、WebGL，无新依赖。

## Constraints and current behavior

不得提交、发布或改动真实数据。保留两仓库已有工作区变更。当前手动接口发出 gift:effect，
但 overlay 忽略它，只播放 gift:frame；旧 effect resolver 取最大 effect ID，不能作为
新弹幕匹配的唯一性依据。新路径以目录 effectKey 判断唯一性，旧收礼流水保持原样。

## Ownership and milestones

- [x] 服务器匹配与下发：新增 `src/modules/gifts/effect-command.js`，导出
  `parseEffectCommand(text)`、`resolveEffectCommand(snapshot, query)` 和
  `createEffectCommandHandler({isEnabled,getCatalog,publish,randomUUID})`。
  `room-monitor.js` 只在实时有效场次调用注入的处理器；`monitor-manager.js` 负责租户绑定。
  `gift-event-broker.js` 的 `publishEffect` 只发给协商能力的同租户订阅。
  `device-sse.js` 支持由内部调用传入 frame 名，`device.js` 声明协商能力。
  验证：`node --test test/gift-effect-command.test.js test/bilibili-gift-event-broker.test.js test/device-sse.test.js test/room-monitor-overlay.test.js`。
- [x] 设置与桌面接收：双方现有设置契约增加可选布尔开关；客户端增加
  `src/bilibili/gift/effect-event.js` 的白名单投影，remote-license-client 解析独立 SSE
  frame，remote-gift-controller 沿现有 fence 调用 runtime 的 `publishGiftEffect`。
  页面用现有 settings API 自动保存开关，失败恢复原值。
  验证：设置 round-trip、默认关闭、非法值、旧快照、停用和换账号后的回调。
- [x] 官方播放器：新增 `public/js/overlays/gift-effect-player.js`，将 RGB/alpha
  按校验 layout 合成，单条播放，最多 3 条等待、12 秒过期、超时和错误释放。
  既有 overlay 入口把 gift:effect 交给播放器，保留边框处理。
  验证：队列与清理行为测试、页面组合和运行时定向预览。
- [x] 同步协议/需求/验收及 fixture，完成相关模块边界、语法、文档检查。
  最后检查两个仓库的任务 diff、`git diff --check`、`git status --short`。

## Failure handling and completion

匹配失败不播放、不写账本。旧服务器不发送新 frame；旧客户端不声明能力。
关闭立即阻止新事件及清空等待播放的指令特效。网络和授权复用已有停止/重连生命周期。
必要时只反向应用本任务 diff；不做 reset、checkout 或目录删除。
全部定向检查通过、协议同步、差异审阅完成后归档此计划；部署不在授权范围内。

## Verification results

- 服务端 95 项相关测试通过，覆盖匹配、真实认证 SSE、旧客户端、租户隔离、
  设置同步、账本独立性、监听生命周期和协议/架构文档约束。
- 客户端相关测试通过，覆盖媒体投影、独立 SSE frame、设置同步、停用及授权
  代际隔离、队列去重/过期/串行播放、页面组合和模块边界。
  `node scripts/check-js.js` 检查 714 个 JavaScript 文件通过。
- 使用独立临时数据目录运行实际 Electron 43，确认默认关闭、点击保存；
  浏览器实测 OBS 官方 MP4 的 RGB/alpha 合成，角落透明且主体可见，无页面错误。
  关闭立即停止播放；模拟设置保存失败后，开关恢复原值。
- 复查末次事件校验修改及协议文档：客户端定向 36 项、服务端定向 38 项通过。
  两仓库任务差异、空白错误和工作区状态已检查，无提交或部署。
- 全库体积检查仍有两处已有工作区 CSS 变更未通过：
  `public/css/admin/workspace/song.css`（781 行、未登记 review）和
  `public/css/license.css`（735 行、原上限 702）。均不属于本任务，保留原状。
  本任务涉及的两个既有 review 文件只增加组合根/回调接线；审阅后分别更新
  `src/server.js` 与 `src/electron/remote-gift-controller.js` 的精确上限。
