# 星语装饰图案 Implementation Plan

**Status:** Complete

**Goal:** 在星语参数中提供四角星、爱心、圆角方块、五角星、小花、月牙、蝴蝶结七款图案，预览和直播来源一致。

**Architecture:** 复用既有 `styleOptions` 校验、草稿、保存和发布链路；星语 CSS 负责图案。客户端与相邻 `lira-server` 的共享合同、浏览器应用及主题同步扩展。

**Tech Stack:** Vanilla JavaScript、原生 CSS/SVG、现有 Node/Playwright 测试。

## 边界与当前行为

- 当前星语只绘制四角星，装饰位于昵称、礼物金额、SC 昵称和金额旁；由 CSS 遮罩与同轮廓 clip-path 实现。
- 新字段 `styleOptions.starlight.decorationShape` 接受 `sparkle|heart|square|star|flower|moon|bow`；缺失或恢复默认为 `sparkle`。其他样式拒绝该字段。
- 保持字体、颜色、闪烁、滚动、消息内容、布局、鉴权及租户边界。没有数据迁移、新依赖或发布操作。
- 工作区已有大量修改，编辑前保存任务相关文件的快照到 `tmp/starlight-shapes/before/`，仅核对和回退本任务增量。

## 所有权与消费者

- 客户端 `src/shared/danmaku-style-options.js` 和 `public/js/shared/danmaku-style-options.js`：校验、默认和样式应用。
- 客户端 `public/js/admin/danmaku-parameter-view.js`、`public/js/overlays/danmaku-preview-appearance.js` 及对应 HTML：组件/画布共用参数、独立预览。
- 客户端 `public/css/overlays/danmaku/starlight.css` 和服务端 `public/overlay/styles/starlight.css`：七款统一剪影。
- 服务端 `src/lib/overlay-style-options.js`、`public/overlay/style-options.js` 与三份 OpenAPI 的 `OverlayStyleOptions`：正式来源合同。
- 文档 owner：客户端 `docs/reference/frontend/overlays.md`、`docs/guides/component-style-parameters.md`；服务端 `docs/protocol/public-overlay-api.md`，需求和验收仅补关联行为。

## 实施与验证

- [x] 扩展既有样式参数测试矩阵与草稿/预览测试，再接入四份合同及两个参数入口。

  ```js
  { starlight: { decorationShape: 'heart' } }
  // styleOptionsFor('starlight', {}) -> decorationShape: 'sparkle'
  // applyStyleOptions -> body.dataset.decorationShape
  ```

- [x] 为六款新增图案提供内置 SVG 和等比 clip-path 降级，同步正式来源；扩展星语浏览器测试，验证已有消息即时换形、内容与节点不变、恢复默认、遮罩降级和减少动态效果。
- [x] 同步技术合同、参数指南、服务端需求/验收与 OpenAPI；运行以下受影响检查并记录结果。

客户端：`node --experimental-vm-modules --test test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-local-preview.test.js test/danmaku/danmaku-panel-edit-state.test.js test/danmaku/server-danmaku-settings.test.js`；`npm run verify:docs`。

服务端：`npm run verify -- --node test/overlay-style-options.test.js --node test/overlay-settings-service.test.js --node test/overlay-protocol-contract.test.js --browser e2e/overlay-starlight.spec.js`，先同范围 `--plan`；`npm run docs:check`。

最终检查两仓库任务增量、`git diff --check`、`git status --short`；通过现有浏览器输出检查七款小尺寸图案。

## 完成条件与失败处理

七款图案可切换、保存、恢复默认，旧设置保持四角星；普通弹幕/礼物/SC 同步换形；聚焦验证通过、文档一致。失败时定位本任务增量，不覆盖已有修改，不操作用户数据和正在运行的应用。安装包和线上服务器更新不在本次范围。

## 验证记录

- 客户端参数合同、预览、参数面板和保存链路：54/54；样式所有权、参数标记与使用指南：19/19。文档门禁 10/10，归档后再次检查链接和计划索引。
- 服务端合同、设置保存和 OpenAPI：33/33；星语布局/消息单元测试 2/2；文档检查 57/57。
- 星语浏览器完整文件最终 6/6：七款图形、当前消息节点稳定、恢复默认、减少动态效果、原有上下滚动及缩放。小花最后调整为圆瓣后重跑该完整文件，全部通过。
- 首次新增浏览器用例误将系统提示计入三类消息，已限定真实消息节点；减少动态效果按实际运行中动画判断，兼容公共 motion CSS 的极短动画规则，未改动原动效。
- 已查看七款图案在 15px、26px 和放大尺寸下的截图及爱心普通弹幕/礼物/SC 合成场景；两端七组 SVG/clip-path 定义一致。
- 原有测试继续覆盖消息内容、金额、布局与租户发布；无需数据库迁移或调整架构、交互引导流程。参数指南、内置帮助和技术合同已同步。
- 未提交、打包或部署。验证使用隔离测试数据，不控制用户运行中的客户端。
