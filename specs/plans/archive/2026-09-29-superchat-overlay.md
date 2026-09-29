# 固定弹幕样式的独立 SC 展示实施计划

状态：Completed（2026-09-29）。六款造型、真实 SC 事件、本地预览和 B 站配色已实现并完成针对性验证。未部署，未在真实直播姬/OBS 或付费直播事件上验收。

## 目标与边界

六款固定样式（ranked、bubble、signal、minimal、transparent、identity）各自显示独立 SC，完整保留原文和金额。经典为矩形；气泡为金额贴签；深色面板为左金额切角板；蝴蝶结为对称细饰；透明文字保留开口细框；头像横卡为左侧伸出的头像和连续底板。头像/昵称仅在各自设计需要时出现，无强制 SC 字样或感谢套话。

真实网页源仍由 LIRA Server 提供，适用于直播姬、OBS 及其他网页源。本机只同步共享渲染与合成预览，不扩展旧本地捕捉/存储链。三种随机样式不新增 SC 展示。不改变普通弹幕、礼物、自动发送感谢、鉴权、租户选择、数据库格式、设置键及页面 URL。

## 当前实现与责任

- Server `src/modules/bilibili/room-monitor.js` 收到 SC 后只调用 `history/event-store.recordSuperChat`；该既有 INSERT OR IGNORE 返回 changes，可作为首次接收判据，无需第二套去重。
- Server `src/lib/bilibili-danmaku.js` 负责公开显示字段投影；`public/overlay/app.js` 接收 SSE 并维护场次；共享 feed 负责布局与淘汰；message-renderer 负责无副作用 DOM。
- Client `public/js/overlays/danmaku.js` 的本机合成预览复用 feed/renderer，样式在 `public/css/overlays/danmaku/`。两仓分别发布资源，不新增运行时依赖。
- 契约由 Server `docs/protocol/public-overlay-api.{md,openapi.json}`、fixtures、REQ-BILI-006 与 AC-BILI-005 维护；Client 说明在 `docs/reference/frontend/overlays.md`。

## 配色依据

B 站官方说明确认各房间价格档位可能不同：<https://live.bilibili.com/blackboard/live-superchat-intro-web.html>。公开配置响应记录见 <https://dd-center.github.io/BiliSC-WebAPI-Doc/#avv1superchatconfig>。标准档位的背景/主色/金额色依次为：

| 金额 | background_color | background_bottom_color | background_price_color |
| --- | --- | --- | --- |
| 2 / 30 | #EDF5FF | #2A60B2 | #7497CD |
| 50 | #DBFFFD | #427D9E | #7DA4BD |
| 100 | #FFF1C5 | #E2B52B | #ECCF75 |
| 500 | #FFEAD2 | #E09443 | #E8AF79 |
| 1000 | #FFE7E4 | #E54D4D | #EE8B8B |
| 2000 | #FFD8D8 | #AB1A32 | #C86A7A |

当前匿名配置接口要求登录，不能把历史配置响应称为本日所有房间的配置。真实事件优先透传经过严格 #RRGGBB 校验的上游三个颜色；仅缺失值使用金额档位回退。用户补充明确 2 元共用 30 元蓝色，50 元以下使用第一档。正文采用中性白/黑确保可读，不使用自创价格色、滤镜或混色。

## 实施与验收

- [x] Server 增量 `superchat` 事件：首次入库、当前直播场次且有效原文/正金额才发布；保留原文/换行、金额、显示昵称/受信头像与可选颜色，无 UID/上游 ID/raw。同 ID 原文与 JPN 包只展示一次，离线/重连不回放。测试实际隔离数据库、租户 broker 和公开 schema。
- [x] 两仓 renderer 添加独立 SC DOM；新 CSS 只作用于 SC。六款设计按金额采用上游色值；同页普通/礼物不变化。固定预览增加完整 SC 示例，随机预览保持原样；验证原文纯文本、金额边界、颜色优先级与坏色值回退。
- [x] 更新 requirement、acceptance、协议、OpenAPI、fixture、参考文档；执行直接相关 Node 测试和现有浏览器测试入口，真实网页源渲染六款、六档、窄区域长文；检查触及文件 diff 与两仓 git diff --check/status。

## 兼容与回退

SSE 新增事件类型，旧网页忽略未知类型；现有网页资源按内容版本发布，不需要用户修改源地址。颜色字段可选以兼容缺失色值；不会把 SC 转成普通弹幕或礼物。现有历史写入失败行为保持。只回退本任务的明确代码/文档片段，不覆盖两仓既有大量未提交变更。无需迁移、部署或提交。

完成条件：以上复选项全部通过并记录命令、实际结果和真实直播验证的限制；完成后归档本计划。


## 验证记录

Client 最终 20/20 通过：

```powershell
node --experimental-vm-modules --test test/danmaku/danmaku-superchat-renderer.test.js test/danmaku/danmaku-overlay-renderer.test.js test/danmaku/danmaku-local-preview.test.js test/danmaku/danmaku-style-ownership.test.js test/danmaku/danmaku-overlay-fullscreen.test.js test/danmaku/danmaku-snapshot-stability.test.js
```

Server 初轮 60/60 通过，覆盖真实隔离 SC 历史去重、租户 broker、现有礼物、公开 SSE、原文渲染及协议：

```powershell
node --require ./test/support/test-mode.cjs --test test/overlay-superchat.test.js test/overlay-superchat-renderer.test.js test/overlay-message-renderer.test.js test/overlay-protocol-contract.test.js test/overlay-preview.test.js test/overlay-gift.test.js test/room-monitor-overlay.test.js test/overlay-public-sse.test.js
```

后续针对最终代码与契约检查：

```powershell
node --require ./test/support/test-mode.cjs --test test/overlay-superchat.test.js test/overlay-superchat-renderer.test.js test/overlay-protocol-contract.test.js test/overlay-preview.test.js test/overlay-static.test.js test/overlay-layout.test.js test/documentation-governance.test.js test/architecture-governance.test.js test/room-monitor-errors.test.js test/history-event-store.test.js
```

结果 72/74：已同步新事件 union 的 governance 断言并单独重跑 `node --require ./test/support/test-mode.cjs --test --test-name-pattern='Public overlay OpenAPI' test/documentation-governance.test.js`，1/1 通过。剩余失败是未触及的 `docs/superpowers/plans/2026-09-29-gift-composition.md` 缺少 lifecycle notice，不属于 SC，本次保留原文件。源码 800 行门禁、规范元数据与链接检查通过。

浏览器使用现有隔离测试服务器（3239 端口、sc-20260929 临时数据），礼物检查通过，SC 最后一次 1/1 通过：

```powershell
$env:LIRA_GAMES_BROWSER_PORT='3239'
$env:LIRA_GAMES_BROWSER_RUN_ID='sc-20260929'
node node_modules/@playwright/test/cli.js test e2e/overlay-superchat.spec.js e2e/overlay-gift.spec.js
node node_modules/@playwright/test/cli.js test e2e/overlay-superchat.spec.js
```

SC 包含六款造型、七个金额、2 元自有色覆盖、来源窗口/画布两种 360×640 长原文、360×240 整体适配、透明细框、独立头像/昵称和随机样式排除；正常礼物仍通过。首轮边框断言因 CSS zoom 的像素取整由 1px 得到小数，改为检查可见细线及精确颜色后通过，未改边框视觉。

两仓 `git diff --check` 通过。新增资源均为源代码/协议夹具/测试；截图与任务前文件快照位于工作区外的 Codex visualization 目录。所有任务测试进程已退出，没有提交或部署，没有使用真实用户数据/真实付费 SC。本地预览由模块测试验证，服务器实际页面由 Chromium 合成 SSE 验证；不把它称作直播姬或 OBS 实机验证。
